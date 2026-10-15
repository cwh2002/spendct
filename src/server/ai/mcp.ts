/**
 * MCP 客户端接入层（唯一，07 契约 §18/§19、04 §9-§11）。
 *
 * 主站 → spendct-mcp（Streamable HTTP）的客户端侧装配：
 *   - 连接单例：MCP_SERVER_URL 缺失或连接失败（5s 超时）时整体降级，
 *     30s 冷却期内不重复尝试，避免每次追问都空等；
 *   - 工具装配：tools/list → ai SDK 工具（inputSchema 直接透传 JSON Schema）；
 *   - 单工具防护（04 §11 唯一口径）：4s 超时、1s/2s/4s 指数退避、
 *     连续失败 2 次移出工具集并注入禁用声明、失败以 {ok:false} 信封进入
 *     上下文（流不中断）；
 *   - query_bill_db_metadata 为协议演示工具，由 /api/followup 确定性调用
 *     （不进模型工具集），经 callMcpTool 直接执行。
 *
 * ai@7.0.137 实测不导出任何 MCP 客户端（07 §19 W4D1 spike 结论），
 * 故基于 @modelcontextprotocol/sdk 客户端自建。
 */
import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { jsonSchema, tool, type JSONSchema7, type Tool } from "ai";

import { getFallbackTool, LLM_FALLBACK_TOOL_NAMES } from "./mcp-fallback";

/** 连接超时（07 §13 /api/mcp 行口径：5s 连接超时） */
export const MCP_CONNECT_TIMEOUT_MS = 5_000;
/** 单工具执行超时 */
export const MCP_TOOL_TIMEOUT_MS = 4_000;
/** 指数退避序列（毫秒），重试耗尽后返回失败信封 */
export const MCP_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];
/** 连续失败移除阈值（04 §11：连续失败 2 次 → 从工具集移除） */
export const MCP_MAX_CONSECUTIVE_FAILURES = 2;
/** 连接失败后的重试冷却：期间 getMcpTools 直接返回 unavailable */
export const MCP_CONNECT_RETRY_COOLDOWN_MS = 30_000;

/** 服务端 MCP 四工具真实名（模型可调用的三工具 + 协议演示工具） */
export const MCP_TOOL_NAMES = [
  "get_school_calendar",
  "get_weather",
  "get_promo_calendar",
  "query_bill_db_metadata",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** 不进模型工具集的工具：query_bill_db_metadata 由路由确定性调用 */
const ROUTE_ONLY_TOOLS: readonly string[] = ["query_bill_db_metadata"];

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带超时地等待一个 Promise；超时抛 TimeoutError（附带 reason 供上层区分） */
export class McpTimeoutError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "McpTimeoutError";
    this.reason = reason;
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpTimeoutError(reason)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────── 信封与退避（纯逻辑，单测覆盖） ───────────────────────────

export interface ToolEnvelope {
  ok: boolean;
  error?: { code?: string; message?: string };
}

/** 解析工具信封文本；不是合法 JSON 或缺少 ok 字段时按失败信封兜底 */
export function parseToolEnvelope(text: string): ToolEnvelope {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      const envelope = parsed as ToolEnvelope;
      return { ok: envelope.ok === true, error: envelope.error };
    }
  } catch {
    // 落到兜底失败信封
  }
  return { ok: false, error: { code: "upstream_error", message: "工具返回不可解析" } };
}

/** 组装失败信封文本（与 mcp-server/src/types.ts 的 failResult 同构） */
export function failEnvelopeText(code: string, message: string, retryAfterSec?: number): string {
  const error: { code: string; message: string; retryAfterSec?: number } = { code, message };
  if (retryAfterSec !== undefined) error.retryAfterSec = retryAfterSec;
  return JSON.stringify({ ok: false, error });
}

export interface BackoffCallOptions {
  /** 退避毫秒序列；序列长度 = 重试次数 */
  backoffMs: readonly number[];
  /** 每次尝试的调用；返回工具信封文本 */
  call: () => Promise<string>;
  /** 该错误是否值得退避重试（false = 立即放弃） */
  isRetryable: (error: unknown) => boolean;
  /** 放弃前的兜底信封（通常带 retryAfterSec 与重试次数说明） */
  fallbackText: (lastError: string, retriesUsed: number) => string;
}

export interface BackoffCallResult {
  text: string;
  retriesUsed: number;
}

/**
 * 指数退避执行器：尝试 1 次 + backoffMs.length 次重试。
 * 某次调用正常返回（无论信封 ok 与否）即结束；重试耗尽后回退兜底信封。
 */
export async function callWithBackoff(options: BackoffCallOptions): Promise<BackoffCallResult> {
  let lastError = "未知错误";
  for (let attempt = 0; attempt <= options.backoffMs.length; attempt++) {
    if (attempt > 0) await sleep(options.backoffMs[attempt - 1] ?? 0);
    try {
      const text = await options.call();
      return { text, retriesUsed: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!options.isRetryable(error)) {
        return { text: options.fallbackText(lastError, attempt), retriesUsed: attempt };
      }
    }
  }
  return { text: options.fallbackText(lastError, options.backoffMs.length), retriesUsed: options.backoffMs.length };
}

/** 单工具失败计数：连续失败达到阈值即移除（04 §11） */
export class ToolFailureTracker {
  private consecutiveFailures = 0;
  private removed = false;

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /** 记录一次失败，返回是否因达到阈值而刚被移除 */
  recordFailure(threshold: number): boolean {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= threshold) {
      this.removed = true;
      return true;
    }
    return false;
  }

  isRemoved(): boolean {
    return this.removed;
  }
}

/** 工具被移除后注入上下文的禁用声明 */
export const TOOL_REMOVED_NOTICE =
  "（该工具已连续失败两次，本次会话内禁用，请勿再尝试调用，如实告知用户该背景信息暂时不可用）";

// ─────────────────────────── 连接单例与工具装配 ───────────────────────────

interface ConnectedClient {
  client: Client;
}

let connectedMemo: ConnectedClient | null = null;
let connectingPromise: Promise<ConnectedClient | null> | null = null;
let lastConnectFailureAt = 0;
let lastConnectFailureReason = "未连接";

function mcpServerUrl(): string | null {
  return process.env.MCP_SERVER_URL?.trim() || null;
}

function connectFailureReason(): string {
  if (mcpServerUrl() === null) return "未配置 MCP_SERVER_URL";
  return `MCP 服务器不可用（${lastConnectFailureReason}）`;
}

/** 连接单例：成功即缓存；失败进入 30s 冷却（冷却期内不再尝试） */
async function connect(): Promise<ConnectedClient | null> {
  if (connectedMemo) return connectedMemo;
  const url = mcpServerUrl();
  if (url === null) return null;
  if (Date.now() - lastConnectFailureAt < MCP_CONNECT_RETRY_COOLDOWN_MS) return null;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const client = new Client({ name: "spendct-web", version: "1.0.0" });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, "连接 MCP 服务器超时（5s）");
      connectedMemo = { client };
      return connectedMemo;
    } catch (error) {
      lastConnectFailureAt = Date.now();
      lastConnectFailureReason = error instanceof Error ? error.message : String(error);
      void client.close().catch(() => {});
      return null;
    } finally {
      connectingPromise = null;
    }
  })();
  return connectingPromise;
}

/** 工具执行结果（统一文本信封，供 SSE 事件与模型上下文共用） */
export interface McpToolOutcome {
  text: string;
  retriesUsed: number;
}

interface McpToolRuntimeState {
  tracker: ToolFailureTracker;
}

const toolStates = new Map<string, McpToolRuntimeState>();

function stateOf(name: string): McpToolRuntimeState {
  let state = toolStates.get(name);
  if (!state) {
    state = { tracker: new ToolFailureTracker() };
    toolStates.set(name, state);
  }
  return state;
}

/** 是否值得退避重试：仅超时 / 网络错误 / 协议内部错误；参数错误立即放弃 */
function isRetryableMcpError(error: unknown): boolean {
  if (error instanceof McpTimeoutError) return true;
  if (error instanceof Error && error.name === "McpError") {
    const code = (error as Error & { code?: number }).code;
    return code !== -32602; // 参数校验错误不重试
  }
  return true;
}

/**
 * 从 callTool 结果取文本内容。SDK 的返回类型在 tsgo 下解析为 unknown
 * （zod 推导的递归联合），这里以运行时守卫取 text 类型分片，不依赖类型层。
 */
function extractToolText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
}

/** callTool 结果的 isError 标记（协议错误结果），同样运行时守卫读取 */
function isToolErrorResult(result: unknown): boolean {
  return Boolean(
    result && typeof result === "object" && (result as { isError?: unknown }).isError,
  );
}

/**
 * 调用 MCP 工具（含退避与两败移除）。永不抛错：
 * 失败以 {ok:false} 信封文本返回，由调用方注入上下文（流不中断）。
 */
export async function callMcpTool(
  name: McpToolName,
  args: Record<string, unknown>,
): Promise<McpToolOutcome> {
  const connected = await connect();
  if (!connected) {
    return {
      text: failEnvelopeText("unavailable", connectFailureReason()),
      retriesUsed: 0,
    };
  }

  const state = stateOf(name);
  if (state.tracker.isRemoved()) {
    return {
      text: failEnvelopeText("unavailable", `工具 ${name} 已在本会话禁用`) + TOOL_REMOVED_NOTICE,
      retriesUsed: 0,
    };
  }

  const outcome = await callWithBackoff({
    backoffMs: MCP_RETRY_BACKOFF_MS,
    isRetryable: isRetryableMcpError,
    call: async () => {
      const result = await withTimeout(
        connected.client.callTool({ name, arguments: args }),
        MCP_TOOL_TIMEOUT_MS,
        `工具 ${name} 调用超时（4s）`,
      );
      const text = extractToolText(result);
      if (isToolErrorResult(result)) {
        // 服务端以协议错误结果返回（本工具链不会出现，防御处理）：按失败信封返回，不重试
        return text || failEnvelopeText("upstream_error", `工具 ${name} 返回错误结果`);
      }
      if (!text) throw new Error(`工具 ${name} 返回空内容`);
      return text;
    },
    fallbackText: (lastError, retriesUsed) =>
      failEnvelopeText(
        "upstream_error",
        `工具 ${name} 调用失败（重试 ${retriesUsed} 次后放弃）：${lastError}`,
        (MCP_RETRY_BACKOFF_MS.at(-1) ?? 0) / 1000,
      ),
  });

  const envelope = parseToolEnvelope(outcome.text);
  if (envelope.ok) {
    state.tracker.recordSuccess();
  } else if (state.tracker.recordFailure(MCP_MAX_CONSECUTIVE_FAILURES)) {
    // 刚达到移除阈值：在信封后注入禁用声明（模型读到即可停止再调用）
    return { ...outcome, text: `${outcome.text}\n${TOOL_REMOVED_NOTICE}` };
  }
  return outcome;
}

/** 把 MCP 工具包装为 ai SDK 工具（tools/list 的 JSON Schema 经 jsonSchema 包装后透传） */
function buildAiTool(mcpName: string, description: string, inputSchema: unknown): Tool {
  return tool({
    description:
      `${description} 返回 JSON 信封：成功 {ok:true,data}，失败 {ok:false,error:{code,message}}。` +
      `失败不影响回答流程：把失败原因如实转述给用户即可，不要假装调用成功。`,
    inputSchema: jsonSchema<Record<string, unknown>>(
      (inputSchema ?? { type: "object", properties: {} }) as JSONSchema7,
    ),
    execute: async (args) => {
      const outcome = await callMcpTool(mcpName as McpToolName, args);
      return outcome.text;
    },
  });
}

export interface McpToolSetResult {
  /** connected＝真实 MCP 工具；local-fallback＝本地静态回退工具；unavailable＝完全无工具 */
  status: "connected" | "local-fallback" | "unavailable";
  reason?: string;
  /** ai SDK 工具集，键 = MCP 真实工具名 */
  tools: Record<string, Tool>;
}

/**
 * 装配模型可调用的工具集（校历/天气/大促日历三工具，L1→L2 降级链）：
 *   L1 连接 MCP 服务器，tools/list → ai SDK 工具（JSON Schema 透传）；
 *   L2 连接失败 → 本地静态回退工具（mcp-fallback，静态日历 + 诚实降级天气）；
 *   读取工具表失败 → 同样落到 L2。
 * 追问流在两条路径下都照常进行（降级原因由路由记入 run:complete.degraded）。
 */
export async function getMcpTools(): Promise<McpToolSetResult> {
  const connected = await connect();
  if (!connected) {
    return buildFallbackToolSet(connectFailureReason());
  }
  try {
    const listed = await withTimeout(
      connected.client.listTools(),
      MCP_CONNECT_TIMEOUT_MS,
      "读取 MCP 工具表超时（5s）",
    );
    const tools: Record<string, Tool> = {};
    for (const listedTool of listed.tools) {
      if (!MCP_TOOL_NAMES.includes(listedTool.name as McpToolName)) continue;
      if (ROUTE_ONLY_TOOLS.includes(listedTool.name)) continue;
      if (stateOf(listedTool.name).tracker.isRemoved()) continue;
      tools[listedTool.name] = buildAiTool(
        listedTool.name,
        listedTool.description ?? "",
        listedTool.inputSchema ?? { type: "object", properties: {} },
      );
    }
    return { status: "connected", tools };
  } catch (error) {
    return buildFallbackToolSet(
      `读取 MCP 工具表失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** L2 本地回退工具集：静态日历两工具 + 诚实降级天气工具（协议演示工具不入模型集） */
function buildFallbackToolSet(reason: string): McpToolSetResult {
  const tools: Record<string, Tool> = {};
  for (const name of LLM_FALLBACK_TOOL_NAMES) {
    const fallback = getFallbackTool(name);
    if (!fallback) continue;
    tools[name] = tool({
      description: fallback.description,
      inputSchema: jsonSchema<Record<string, unknown>>(fallback.inputSchema as JSONSchema7),
      execute: async (args) => fallback.execute(args),
    });
  }
  return { status: "local-fallback", reason, tools };
}

/** 仅测试使用：重置连接与失败计数状态 */
export function resetMcpClientForTest(): void {
  connectedMemo = null;
  connectingPromise = null;
  lastConnectFailureAt = 0;
  lastConnectFailureReason = "未连接";
  toolStates.clear();
}
