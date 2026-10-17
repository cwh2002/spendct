/**
 * /api/followup —— 追问在线兜底端点（SSE，07 契约 §2/§13/§18 + 修订案 A9）。
 *
 * 与 /api/ai/chat（text/plain 纯转发）的分工：本端点承载追问面板第三路
 * 「在线兜底」并叠加 MCP 工具层——回答以协议 §2 事件流返回：
 *   - run:start / run:complete：会话边界（cards 恒为空数组，追问不落洞察卡；
 *     degraded 数组记录 MCP 降级原因）；
 *   - plan：回答前的思考计划（协议第 21 类事件，08 修订案 A12；live 由
 *     assistant-plan 结构化生成、mock 脚本化两档，面板渲染「思考计划」块）；
 *   - tool:start / tool:end：每次工具调用的起止（面板工具徽章数据源）；
 *   - stage:thinking（stage="followup"）：回答文本增量（复用思考文案事件，
 *     宽松发射，不经过协议校验）；
 *   - error / abort：异常与客户端中止。
 *
 * 心跳：live 档 LLM 首 token / 工具等待可能超过客户端 30s 流内停滞窗，
 * 服务端周期性发 SSE 注释心跳帧（「: keepalive」），客户端映射为 keepalive
 * 事件重置停滞计时——注释帧对浏览器标准解析器不可见，不污染协议事件流。
 *
 * 流程：
 *   0. 发射 plan 事件（mock 两档脚本 / live 结构化生成，失败静默跳过）；
 *   1. 若 body 带 sessionSchema 快照（07 §18 协议演示工具），先确定性调用
 *      query_bill_db_metadata 回执（不进模型工具集，与模型决策解耦）；
 *   2. DEMO_MODE=mock：问题命中大促关键词 → 脚本化演示流（get_promo_calendar
 *      工具事件 + promo 档文案）；否则回 chat 兜底文案（与旧 /api/ai/chat
 *      mock 口径一致）；
 *   3. live：装配 MCP 三工具（连接失败整体降级并记入 degraded）→
 *      streamChatWithTools 逐 part 映射事件。
 *
 * 隐私口径（08 修订案 A8/A14 延伸）：消息里的汇总统计与最近明细快照只转发给
 * LLM 与 MCP（账单库元数据回执只含聚合元数据），服务端零存储、不记日志；
 * 深度分析模式（analysisMode="deep"）发送全期统计与最近明细两条上下文，
 * 出口与本端点既有口径一致，不新增任何数据出口。
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { generateLlmObject, LlmExhaustedError, mockTextStream, resolveLlmMode, streamChatWithTools } from "@/lib/llm/client";
import { mockAssistantPlan } from "@/lib/llm/mock-narratives";
import { PlanEventSchema } from "@/lib/protocol/events";
import { sessionSchemaSchema } from "@/lib/schema/session-schema";
import { getFallbackTool } from "@/server/ai/mcp-fallback";
import {
  callMcpTool,
  getMcpTools,
  MCP_TOOL_TIMEOUT_MS,
  parseToolEnvelope,
} from "@/server/ai/mcp";

export const runtime = "nodejs";

const FollowupRequestSchema = z.strictObject({
  question: z.string().min(1).max(500),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (messages) => messages.reduce((total, message) => total + message.content.length, 0) <= 8000,
      { message: "消息总长度不能超过 8000 字" },
    ),
  sessionSchema: sessionSchemaSchema.optional(),
  datasetSource: z.enum(["upload", "sample"]).optional(),
  /** 深度分析模式（08 修订案 A14）：mock 走 deep 档演示流，live 追加深度分析指令 */
  analysisMode: z.enum(["standard", "deep"]).optional(),
});

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
};

/** mock 演示流：命中这些关键词才走大促日历工具演示，否则回兜底文案 */
const PROMO_KEYWORDS = ["双11", "双十一", "双12", "双十二", "大促", "促销", "年货", "618"];

function isPromoQuestion(question: string): boolean {
  return PROMO_KEYWORDS.some((word) => question.includes(word));
}

/** live 思考计划生成超时（毫秒）：计划是展示层增强，超时即放弃、不拖慢主回答流 */
const PLAN_GENERATE_TIMEOUT_MS = 8_000;

/** 心跳帧间隔（毫秒）：远小于客户端 30s 流内停滞窗，留足网络抖动余量 */
const KEEPALIVE_INTERVAL_MS = 10_000;

/** 计划步骤可引用的工具名（模型可调用的 MCP 三工具；与 mcp.ts MCP_TOOL_NAMES 同源） */
const PLAN_TOOL_HINT = "get_school_calendar（校历）、get_weather（城市天气）、get_promo_calendar（大促日历）";

/** 工具入参摘要：截断的 JSON 串，供工具徽章展示调用意图（不含敏感字段） */
function argsDigest(args: unknown): string {
  const text = JSON.stringify(args);
  return text.length <= 120 ? text : `${text.slice(0, 117)}...`;
}

interface ToolCallTiming {
  startedAt: number;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "BAD_REQUEST", message: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = FollowupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "BAD_REQUEST", message: "参数校验失败" }, { status: 400 });
  }
  const { question, messages, sessionSchema, datasetSource, analysisMode } = parsed.data;

  const encoder = new TextEncoder();
  const runId = `fup-${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();
  const now = () => Date.now();
  // 心跳与关闭标记提升到流对象外层：cancel()（客户端断开）也要能停掉心跳，
  // start 内所有收尾路径统一走 closeStream() 保证心跳定时器不泄漏
  let streamClosed = false;
  let heartbeat: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const degraded: string[] = [];
      /** 统一收尾：标记关闭并清掉心跳，再关闭流（只执行一次） */
      function closeStream() {
        if (streamClosed) return;
        streamClosed = true;
        if (heartbeat !== null) clearTimeout(heartbeat);
        controller.close();
      }
      /** 心跳帧自续期调度：流未关闭且客户端未中止时每 10s 发一帧注释心跳 */
      function scheduleHeartbeat() {
        if (streamClosed || request.signal.aborted) return;
        heartbeat = setTimeout(() => {
          if (streamClosed || request.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            return; // 流已关闭：enqueue 抛错即停，不再续期
          }
          scheduleHeartbeat();
        }, KEEPALIVE_INTERVAL_MS);
      }
      scheduleHeartbeat();
      // 单次回答内工具调用的起止计时：key = toolCallId（live）或工具名（确定性调用）
      const timings = new Map<string, ToolCallTiming>();

      function sendToolStart(key: string, tool: string, digest: string) {
        timings.set(key, { startedAt: now() });
        send({ t: "tool:start", ts: now(), runId, tool, argsDigest: digest });
      }

      function sendToolEnd(key: string, tool: string, ok: boolean, errorReason?: string) {
        const timing = timings.get(key);
        send({
          t: "tool:end",
          ts: now(),
          runId,
          tool,
          ok,
          ms: timing ? now() - timing.startedAt : 0,
          ...(errorReason !== undefined ? { errorReason } : {}),
        });
        timings.delete(key);
      }

      function sendTextDelta(text: string) {
        send({ t: "stage:thinking", ts: now(), runId, stage: "followup", text });
      }

      try {
        send({
          t: "run:start",
          ts: now(),
          runId,
          datasetTxHash: sessionSchema?.datasetTxHash ?? null,
          source: datasetSource ?? "sample",
          stageOrder: [],
        });

        // —— 第 0 步：思考计划（plan 事件，08 修订案 A12）——
        // mock：脚本化两档（promo 档第一步挂日历工具名，与徽章联动）；
        // live：assistant-plan 结构化生成，失败/超时静默跳过——计划是
        // 展示层增强，任何异常都不阻断主回答流
        const mode = resolveLlmMode();
        if (mode === "mock") {
          // 深度分析演示档用通用计划（deep 档文案不涉及大促工具，避免计划与徽章脱节）
          const plan = mockAssistantPlan(!(analysisMode === "deep") && isPromoQuestion(question));
          send({ t: "plan", ts: now(), runId, goal: plan.goal, steps: plan.steps });
        } else if (!request.signal.aborted) {
          try {
            const plan = await Promise.race([
              generateLlmObject(
                "assistant-plan",
                PlanEventSchema.pick({ goal: true, steps: true }),
                `用户问题：${question}\n可用工具：${PLAN_TOOL_HINT}\n步骤里的 tool 字段只能填上述工具名，用不到工具就不填。`,
              ),
              // 计划生成超时兜底：放弃计划，让主回答流尽快开始
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("plan generation timeout")), PLAN_GENERATE_TIMEOUT_MS),
              ),
            ]);
            if (request.signal.aborted) {
              send({ t: "abort", ts: now(), runId, reason: "client-aborted" });
              closeStream();
              return;
            }
            send({ t: "plan", ts: now(), runId, goal: plan.goal, steps: plan.steps });
          } catch {
            // 密钥缺失 / 上游异常 / 超时：不发射 plan 事件，主回答流照常
          }
        }

        // —— 第 1 步：协议演示工具（确定性回执，与模型决策解耦）——
        if (sessionSchema) {
          sendToolStart("bill-meta", "query_bill_db_metadata", argsDigest(sessionSchema));
          const outcome = await callMcpTool("query_bill_db_metadata", sessionSchema);
          let envelope = parseToolEnvelope(outcome.text);
          if (!envelope.ok && envelope.error?.code === "unavailable") {
            // MCP 不可达 → 本地严格校验回执（L2，口径与 MCP 服务端一致）
            envelope = parseToolEnvelope(
              getFallbackTool("query_bill_db_metadata")?.execute(sessionSchema) ?? outcome.text,
            );
          }
          sendToolEnd(
            "bill-meta",
            "query_bill_db_metadata",
            envelope.ok,
            envelope.ok ? undefined : envelope.error?.code,
          );
          if (!envelope.ok) degraded.push("mcp:query_bill_db_metadata");
        }

        // —— 第 2 步：回答生成（mock 演示流 / live 工具流，mode 已在第 0 步判定）——
        if (mode === "mock") {
          if (analysisMode === "deep") {
            // 深度分析演示档（08 修订案 A14）：脚本化文案演示产品口径，
            // 不虚构具体账单数字——DEMO_MODE=mock 下与真实动线口径明确区分
            const reader = mockTextStream("chat", { stage: "deep" }).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done || request.signal.aborted) break;
              sendTextDelta(new TextDecoder().decode(value));
            }
          } else if (isPromoQuestion(question)) {
            // 脚本化演示：先模拟 get_promo_calendar 调用（演示口径与数据文件一致），
            // 再逐片推送 promo 档文案；工具事件为演示模拟，非真实 MCP 调用
            sendToolStart("demo-promo", "get_promo_calendar", argsDigest({ date: "2026-10-21" }));
            await new Promise((resolve) => setTimeout(resolve, 80));
            sendToolEnd("demo-promo", "get_promo_calendar", true);
            const reader = mockTextStream("chat", { stage: "promo" }).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done || request.signal.aborted) break;
              sendTextDelta(new TextDecoder().decode(value));
            }
          } else {
            const reader = mockTextStream("chat", {}).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done || request.signal.aborted) break;
              sendTextDelta(new TextDecoder().decode(value));
            }
          }
          if (request.signal.aborted) {
            send({ t: "abort", ts: now(), runId, reason: "client-aborted" });
          } else {
            send({
              t: "run:complete",
              ts: now(),
              runId,
              cards: [],
              elapsedMs: now() - startedAt,
              ...(degraded.length > 0 ? { degraded } : {}),
            });
          }
          closeStream();
          return;
        }

        // live：装配 MCP 工具集（连接失败 → 空工具集 + 降级记录，流照常）
        const toolSet = await getMcpTools();
        if (toolSet.status !== "connected") {
          degraded.push(`mcp:${toolSet.status}:${toolSet.reason ?? "unknown"}`);
        }

        const parts = await streamChatWithTools({
          messages,
          tools: toolSet.tools,
          deep: analysisMode === "deep",
        });
        for await (const part of parts) {
          if (request.signal.aborted) {
            send({ t: "abort", ts: now(), runId, reason: "client-aborted" });
            closeStream();
            return;
          }
          if (part.type === "tool-call") {
            sendToolStart(part.toolCallId, part.toolName, argsDigest(part.input));
          } else if (part.type === "tool-result") {
            if (part.preliminary) continue; // 多步流里的中间结果，只报最终一次
            const envelope = parseToolEnvelope(
              typeof part.output === "string" ? part.output : String(part.output ?? ""),
            );
            sendToolEnd(
              part.toolCallId,
              part.toolName,
              envelope.ok,
              envelope.ok ? undefined : envelope.error?.code,
            );
          } else if (part.type === "tool-error") {
            sendToolEnd(part.toolCallId, part.toolName, false, "tool-error");
          } else if (part.type === "text-delta") {
            sendTextDelta(part.text);
          } else if (part.type === "error") {
            // 流内错误 part：把已收到的内容留在面板上，另发 error 事件收尾
            send({
              t: "error",
              ts: now(),
              runId,
              code: "NETWORK_OFFLINE",
              message: "在线服务流中断",
              retryable: true,
            });
            closeStream();
            return;
          }
        }
        send({
          t: "run:complete",
          ts: now(),
          runId,
          cards: [],
          elapsedMs: now() - startedAt,
          ...(degraded.length > 0 ? { degraded } : {}),
        });
        closeStream();
      } catch (error) {
        if (request.signal.aborted) {
          send({ t: "abort", ts: now(), runId, reason: "client-aborted" });
        } else if (error instanceof LlmExhaustedError) {
          send({
            t: "error",
            ts: now(),
            runId,
            code: "LLM_EXHAUSTED",
            message: "在线服务暂不可用（未配置对应模型密钥）",
            retryable: false,
          });
        } else if (error instanceof Error && error.name === "McpTimeoutError") {
          send({
            t: "error",
            ts: now(),
            runId,
            code: "TIMEOUT",
            message: `工具调用超时（${MCP_TOOL_TIMEOUT_MS / 1000}s）`,
            retryable: true,
          });
        } else {
          send({
            t: "error",
            ts: now(),
            runId,
            code: "NETWORK_OFFLINE",
            message: "在线服务请求失败",
            retryable: true,
          });
        }
        closeStream();
      }
    },
    cancel() {
      // 客户端中止（面板卸载或超时）：清掉心跳定时器并标记关闭，
      // start 内通过 request.signal 感知并收尾
      streamClosed = true;
      if (heartbeat !== null) clearTimeout(heartbeat);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
