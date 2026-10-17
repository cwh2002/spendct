"use client";

/**
 * 账单问答管线（追问面板与智能助理共用的 React 状态层，08 修订案 A12）。
 *
 * 从追问面板抽取的三路管线，一次提问按顺序尝试，命中即停：
 *   0. 输入闸门（checkChatInput）——注入特征直接回固定拒绝话术（A12）；
 *   1. 闲聊分流（classifySmallTalk）——「你好」「你是谁」直接回定稿文案；
 *   2. 本地规则（qa-engine）——意图解析 + 白名单聚合 SQL 读取账单数据，
 *      数字全部来自查询结果（「已按你的账单数据计算」脚注）；
 *   2.5 本地案例检索（仅智能助理，enableCasePath）——问题不构成账单查询时
 *      查本地案例库（TF-IDF 零 API），命中挂「本地案例库」脚注（A12）；
 *   3. 在线兜底——本地答不了的拼「汇总统计 + 最近明细快照 + 案例参考」，
 *      POST /api/followup（SSE），逐事件映射工具徽章、思考计划与回答文本
 *      （08 修订案 A9/A12）。
 *
 * 与组件的协作：本 hook 只管理轮次与思考态；输入框、锚点、滚动与快捷键
 * 由两个面板各自持有。浏览器安全约束同 qa-engine：时钟与存储只在提交
 * 事件里触碰，渲染路径不执行查询。
 */
import { useEffect, useRef, useState } from "react";

import { buildCaseRefsText, buildHistoryMessages, computeDetailBudget, DEEP_CONTEXT_PREFIX, DETAIL_CONTEXT_PREFIX, DETAIL_MIN_LENGTH, MESSAGE_BUDGET, ONLINE_CONTEXT_PREFIX, TARGETED_CONTEXT_PREFIX } from "@/lib/assistant/chat-context";
import { checkChatInput, GUARD_BLOCKED_REPLY } from "@/lib/assistant/input-guard";
import { isBillQuestion } from "@/lib/assistant/bill-signal";
import { mapErrorCode, onlineErrorNote, onlineFailureTipText } from "@/lib/assistant/online-failure-text";
import { streamFollowup, type FollowupPlanStep } from "@/lib/assistant/stream-followup";
import {
  analyzeQuestion,
  answerLocalQuestion,
  asRowList,
  buildAggregateContext,
  buildDetailContext,
  createDuckDbDetailSnapshot,
  createDuckDbRunner,
  createDuckDbSchemaSnapshot,
  DATASET_EMPTY_TEXT,
  ENGINE_READ_ERROR_TEXT,
  type QaIntent,
  type SqlRunner,
} from "@/lib/chat/qa-engine";
import { buildDeepAnalysisContext } from "@/lib/chat/deep-analysis";
import {
  buildTargetedDetailContext,
  buildTargetedDetailPlan,
  buildTargetedDetailSql,
  createTargetedDetailRunner,
} from "@/lib/chat/targeted-detail";
import { getDuckDB } from "@/lib/duckdb/service";
import { searchLocalCases } from "@/lib/assistant/local-cases";
import { createStallTimer } from "@/lib/assistant/stall-timer";
import { restorePipelineSnapshot } from "@/lib/persistence/pipeline-persistence";
import { classifySmallTalk, SMALL_TALK_ANSWER } from "@/lib/llm/small-talk";
import { valAt } from "@/lib/pipeline/stages/spec";
import { usePipeline } from "@/lib/pipeline/store";
import type { SessionSchema } from "@/lib/schema/session-schema";
import { getToolLabel } from "@/lib/tools/registry";

/** 思考计划（plan 事件，A12）：在线回答前的规划清单 */
export interface ChatPlan {
  goal: string;
  steps: FollowupPlanStep[];
}

/** 案例参考（本地检索或 /api/rag 响应，非模型生成文本） */
export interface ChatCaseRef {
  caseId: string;
  title: string;
  snippet: string;
}

/** 工具徽章：tool:start 生成（待定态），tool:end 补齐 ok/ms/errorReason */
export interface ChatToolBadge {
  id: string;
  tool: string;
  label: string;
  argsDigest?: string;
  ok?: boolean;
  ms?: number;
  errorReason?: string;
}

/** 会话的一轮气泡 */
export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** 回答来源脚注：local＝本地规则；cases＝本地案例库；live＝在线服务；deep＝深度分析（A14） */
  note?: "local" | "cases" | "live" | "deep";
  /** 在线回答实际发送了账单统计段（live/deep 脚注按组合标注实际发送内容） */
  sentStats?: boolean;
  /** 在线回答实际发送了账单明细分（与 sentStats 组合决定脚注文案；定向明细 A15 归入明细分） */
  sentDetails?: boolean;
  /** 闲聊定稿回答（打招呼/询问身份）：不挂任何来源脚注 */
  smallTalk?: boolean;
  /** 输入被闸门拦截（A12）：气泡挂拦截脚注 */
  guarded?: boolean;
  /** 在线回答的思考计划（plan 事件，A12） */
  plan?: ChatPlan;
  /** 回答挂的案例参考（检索响应，非模型生成文本） */
  ragRefs?: ChatCaseRef[];
  /** 在线回答挂的工具徽章（tool:start/tool:end 事件） */
  toolBadges?: ChatToolBadge[];
}

/** 思考态：data＝读取本地账单数据；cases＝检索本地案例库；live＝等待在线服务 */
export type ChatThinkingState = "data" | "cases" | "live";

/** 管线选项（A12）：两个面板按各自定位开启不同路径 */
export interface ChatPipelineOptions {
  /** 本地案例检索路径（智能助理开；锚点追问面板关，保持数据优先定位） */
  enableCasePath?: boolean;
  /** 输入闸门（两个面板都开；关闭仅用于测试诊断） */
  enableGuard?: boolean;
}

/**
 * 商户 Top50 名单查询（08 修订案 A15）：固定白名单聚合 SQL，经 runWhitelistedAggregate
 * 预检执行。商户名单是定向明细里唯一的用户参数来源——名单只来自数据库查询，
 * 绝不直接取用户原文当参数。
 */
const TOP_MERCHANT_NAMES_SQL =
  "SELECT merchant, SUM(amount_cents) FROM transactions WHERE direction = 'expense' AND status = 'paid' GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 50";

/** 查询支出 Top50 商户名单，取出名字字符串数组供定向明细做可信商户匹配 */
async function fetchTopMerchantNames(runSql: SqlRunner): Promise<string[]> {
  const rows = asRowList(await runSql(TOP_MERCHANT_NAMES_SQL));
  return rows
    .map((row) => String(valAt(row, 0) ?? "").trim())
    .filter((name) => name.length > 0);
}

/**
 * 流内停滞超时（毫秒）：响应首字节到达后，距上一次收到任何流事件超过
 * 该时长即中止。用停滞而非固定总时限——流式输出持续到达时计时不断重置，
 * 慢而健康的回答（deep 档计划生成 + 工具调用 + 长生成）不会被总时限误杀；
 * 只有服务完全沉默才中止，避免思考态卡死面板（A18 实测 30s 总时限曾把
 * 首击编译的正常回答误杀成「需连接在线服务」提示）。
 */
const ONLINE_STALL_TIMEOUT_MS = 30_000;

/**
 * 响应前停滞超时（毫秒）：从发起在线兜底到响应首字节之间的等待上限。
 * 该阶段没有任何事件可证明活跃（本地上下文构建、RAG 检索、schema 快照、
 * 主 fetch 含 Next dev 首击编译），共用同一窗口，所以用比流内更宽的
 * 120s——覆盖 A18 实测超 30s 的首击编译，又不让 fetch 永久悬挂卡死
 * 思考态。首字节到达后由 reset 收紧到 ONLINE_STALL_TIMEOUT_MS。
 */
const ONLINE_PRE_RESPONSE_TIMEOUT_MS = 120_000;

/** 中断回答的补注文案：流已收到内容时追加，区别于「服务不可达」的整段提示 */
const INTERRUPTED_NOTE = "\n\n（回答中断：等待在线服务响应超时，请再问一次。）";

/**
 * 提问前等待会话恢复的上限（毫秒）：IndexedDB 与 DuckDB 初始化异常悬挂时，
 * 提问不会永久卡死——超时后按未恢复口径继续走管线（本地规则答「还没有
 * 账单数据」或在线兜底按空统计处理），恢复任务在后台自行落定。
 * 上限必须盖过健康路径的恢复耗时：刷新后 DuckDB-WASM 冷启动 + 行数据重放
 * 实测约 26s（dev 模式，首击编译更慢）。热修复五轮把上限从 60s 提到
 * 150s——它还必须盖过 duckdb/service 的 DUCKDB_INIT_TIMEOUT_MS（120s），
 * 否则慢设备上恢复跑到 90s+ 时会被 60s 竞速误杀，健康数据集被误答
 * 「还没有账单数据」。
 */
const RESTORE_WAIT_MS = 150_000;

export interface ChatPipeline {
  turns: ChatTurn[];
  thinking: ChatThinkingState | null;
  /**
   * 提交一条问题（非空、已 trim）；anchor 供槽位补全，可传 null。
   * options.deep（A14）：跳过本地规则与案例检索，直接走在线兜底并携带
   * 全期统计上下文——由追问面板的「深度分析」开关逐次传入。
   */
  submit(
    text: string,
    anchor: { id: string; label: string } | null,
    options?: { deep?: boolean },
  ): Promise<void>;
  /** 清空会话（智能助理「新对话」按钮） */
  reset(): void;
}

/** 案例检索命中时的本地回答文案（数据来自检索结果，非模型文本） */
function caseAnswerText(cases: ChatCaseRef[]): string {
  const titles = cases.map((c) => `《${c.title}》`).join("、");
  return `本地案例库里有 ${cases.length} 条相关攻略：${titles}。这些来自真实维权案例与平台规则，供你参考，具体以对应平台最新规则为准。`;
}

export function useChatPipeline(options: ChatPipelineOptions = {}): ChatPipeline {
  const enableCasePath = options.enableCasePath ?? false;
  const enableGuard = options.enableGuard ?? true;

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [thinking, setThinking] = useState<ChatThinkingState | null>(null);
  const seqRef = useRef(0);
  // 本地 SQL 执行器惰性创建：首次提问才接线，渲染路径不触碰存储与时钟
  const runnerRef = useRef<ReturnType<typeof createDuckDbRunner> | null>(null);
  // 在线请求的中止句柄与组件存活标记：卸载后不再触碰任何状态
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  // 挂载时置存活标记、卸载时中止在线请求（StrictMode 下 effect 重挂载会
  // 先清理再执行，必须在此重新置 true，否则存活标记永久卡在 false）
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /** 惰性取得本地 SQL 执行器（首次提问时创建，之后复用同一条接线） */
  function getRunner() {
    if (!runnerRef.current) runnerRef.current = createDuckDbRunner();
    return runnerRef.current;
  }

  function appendTurn(turn: Omit<ChatTurn, "id">) {
    seqRef.current += 1;
    // 先把序号固化到局部变量再进 updater：同一批同步提交里的多次追加
    // 会在 updater 执行时读到最终序号，导致重复 key
    const id = seqRef.current;
    setTurns((prev) => [...prev, { ...turn, id }]);
  }

  /** 流式分片累积：只更新目标 id 气泡的文本 */
  function updateTurnText(turnId: number, text: string) {
    setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, text } : turn)));
  }

  /**
   * 整段流结束后挂上在线来源脚注（深度分析挂 deep 脚注，其余挂 live），
   * 并记录实际发送的账单数据段组合：统计/明细按各自查询结果条件发送，
   * 脚注必须如实标注「已发送账单统计」「已发送账单明细」或两者都在时的合称。
   * 定向明细（A15）归入明细分：发送了定向段或快照段都算「已发送账单明细」
   */
  function markTurnOnline(
    turnId: number,
    deep: boolean,
    sent: { stats: boolean; details: boolean },
  ) {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId
          ? { ...turn, note: deep ? "deep" : "live", sentStats: sent.stats, sentDetails: sent.details }
          : turn,
      ),
    );
  }

  /** plan 事件落位：思考计划挂到目标气泡 */
  function setTurnPlan(turnId: number, plan: ChatPlan) {
    setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, plan } : turn)));
  }

  /**
   * 在线兜底：拼汇总上下文（非空才拼）、案例参考、最近对话与 sessionSchema
   * 快照，POST /api/followup（SSE），经 streamFollowup 逐事件映射：
   *   - tool:start / tool:end：维护工具徽章（待定 / 成功 / 失败三态）；
   *   - plan：思考计划挂气泡（A12）；
   *   - text-delta：回答文本增量，累积回填最后一条回答气泡；
   *   - complete / error / abort：流收尾。
   * deep（A14/A15）：上下文换为全期统计（buildDeepAnalysisContext），另按问题
   * 识别检索条件直连查询定向明细（A15），与最近明细快照（A8）分成三条消息
   * 发送，各自不超过单条 4000 字上限；回答挂 deep 来源脚注。
   * 请求失败 / 流异常时落到本地提示气泡；组件卸载触发的中止直接静默返回。
   */
  async function runOnlineFallback(question: string, deep = false) {
    setThinking("live");
    const controller = new AbortController();
    abortRef.current = controller;
    // 停滞超时保险：响应前阶段（本地上下文构建 / RAG / schema / 主 fetch 含
    // dev 首击编译）无事件可证明活跃，用 120s 长窗口；首字节到达后 reset
    // 收紧到 30s 流内停滞窗口（每收到事件再重置，慢而健康的回答不会被
    // 总时限误杀）；服务完全沉默时中止，防止思考态卡死面板
    const stallTimer = createStallTimer(ONLINE_PRE_RESPONSE_TIMEOUT_MS, () => {
      controller.abort();
    });
    // 中止收尾的共享状态：内容与占位气泡跨阶段使用，收尾只执行一次
    let finished = false;
    let accumulated = "";
    let turnId: number | null = null;

    /** 停滞超时的统一收尾：已有内容保留并追加中断补注；无内容撤占位补超时分档提示 */
    function finishAborted() {
      if (finished) return;
      finished = true;
      if (!aliveRef.current) return;
      if (accumulated.trim() !== "" && turnId !== null) {
        updateTurnText(turnId, `${accumulated}${INTERRUPTED_NOTE}`);
      } else if (turnId !== null) {
        setTurns((prev) => prev.filter((turn) => turn.id !== turnId));
        appendTurn({
          role: "assistant",
          text: onlineFailureTipText("TIMEOUT"),
        });
      } else {
        appendTurn({
          role: "assistant",
          text: onlineFailureTipText("TIMEOUT"),
        });
      }
    }

    // 中止原因分流：组件卸载 → 静默返回；停滞超时 → finishAborted 统一收尾
    function bailIfStopped(): boolean {
      if (!aliveRef.current) return true;
      if (controller.signal.aborted) {
        finishAborted();
        return true;
      }
      return false;
    }

    try {
      // 统计上下文：deep 用全期聚合（A14），日常兜底用本月/近 90 天汇总；
      // 任何一组统计查不到就由引擎省略该组，空串表示没有任何可发送的统计
      let context = "";
      try {
        context = deep
          ? await buildDeepAnalysisContext(getRunner())
          : await buildAggregateContext(getRunner());
      } catch {
        context = "";
      }
      // 定向明细（08 修订案 A15，仅 deep 档）：按问题识别月份/年份/商户/类目/
      // 深夜条件，直连查询与问题直接相关的明细，让追问真正读取原始账单数据；
      // 任何一步失败静默跳过该段，不阻断主链路
      let targeted = "";
      if (deep) {
        try {
          const merchantNames = await fetchTopMerchantNames(getRunner());
          const plan = buildTargetedDetailPlan(question, merchantNames);
          const sql = buildTargetedDetailSql(plan);
          if (sql) {
            const text = await buildTargetedDetailContext(createTargetedDetailRunner(getDuckDB), plan);
            if (text.length > 0) targeted = text;
          }
        } catch {
          targeted = "";
        }
      }
      // RAG 检索提前到明细快照之前（热修复五轮）：案例参考段长度必须计入
      // 快照预算——此前 refs 从不入预算，deep 档满配上下文 + 案例参考可把
      // 消息总长推到 8000 以上触发接口 400（A18 实测 8242 字被参数校验
      // 拒绝，用户只看到笼统的「需要连接在线服务」）。检索层产出、非模型
      // 生成，防幻觉引用；失败/超时静默跳过，不阻断在线兜底主链路
      let ragCases: ChatCaseRef[] = [];
      try {
        const ragResponse = await fetch("/api/rag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: question, topK: 3 }),
          signal: controller.signal,
        });
        if (ragResponse.ok) {
          const envelope = (await ragResponse.json()) as {
            ok: boolean;
            data?: { cases?: ChatCaseRef[] };
          };
          if (envelope.ok) ragCases = envelope.data?.cases ?? [];
        }
      } catch {
        ragCases = [];
      }
      if (bailIfStopped()) return;
      const refs = buildCaseRefsText(ragCases);

      // 明细快照：最近 150 笔收支明细（08 修订案 A8），读不到则省略该段。
      // deep 模式统计 / 定向明细 / 明细分三条消息发送；明细预算按总预算
      // 扣除统计段、定向段、案例参考段、前缀、本轮问题与历史预留后取剩余，
      // 保证全部消息总长不超接口预算（统计 ≤2400、定向 ≤2500）；预算低于
      // DETAIL_MIN_LENGTH 时省略快照段（气泡脚注按实际发送标注）
      let details = "";
      const detailBudget = computeDetailBudget({ deep, context, targeted, refs, question });
      if (detailBudget >= DETAIL_MIN_LENGTH) {
        try {
          details = await buildDetailContext(createDuckDbDetailSnapshot(), detailBudget);
        } catch {
          details = "";
        }
      }
      if (bailIfStopped()) return;
      const combined = [context, targeted, details].filter(Boolean).join("\n");
      // 统计与明细都拿不到（未导入账单或引擎读不到数据）：不空手转在线。
      // 数据集在但上下文查询全部失败时答「读取异常」，不误指「还没有账单数据」
      if (!combined) {
        setThinking(null);
        const hasDataset = usePipeline.getState().datasetTxHash !== null;
        appendTurn({
          role: "assistant",
          text: hasDataset ? ENGINE_READ_ERROR_TEXT : DATASET_EMPTY_TEXT,
          note: "local",
        });
        return;
      }

      // sessionSchema 聚合快照（07 §18 协议演示工具回执）：只含列元数据与统计
      const txHash = usePipeline.getState().datasetTxHash;
      let sessionSchema: SessionSchema | null = null;
      if (txHash) {
        try {
          sessionSchema = await createDuckDbSchemaSnapshot(txHash)();
        } catch {
          sessionSchema = null;
        }
      }
      if (bailIfStopped()) return;

      const messages: { role: "user" | "assistant"; content: string }[] = [];
      if (deep) {
        // 深度分析：全期统计 / 定向明细（A15）/ 明细快照分三条消息，各自语义完整
        if (context) {
          messages.push({ role: "user", content: `${DEEP_CONTEXT_PREFIX}${context}` });
        }
        if (targeted) {
          messages.push({ role: "user", content: `${TARGETED_CONTEXT_PREFIX}${targeted}` });
        }
        if (details) {
          messages.push({ role: "user", content: `${DETAIL_CONTEXT_PREFIX}${details}` });
        }
      } else if (combined) {
        messages.push({ role: "user", content: `${ONLINE_CONTEXT_PREFIX}${combined}` });
      }
      if (refs) {
        messages.push({ role: "user", content: refs });
      }
      // 历史预算必须扣掉本轮问题长：buildHistoryMessages 恒在末尾追加问题、
      // 不占预算（用户刚输入的内容不能被裁掉），不在这里先扣就会溢出
      const budget =
        MESSAGE_BUDGET -
        messages.reduce((sum, m) => sum + m.content.length, 0) -
        question.length;
      messages.push(...buildHistoryMessages(turns, question, budget));

      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          messages,
          ...(sessionSchema ? { sessionSchema } : {}),
          datasetSource: usePipeline.getState().source ?? undefined,
          analysisMode: deep ? "deep" : "standard",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 503（服务不可用）/ 502（上游异常）/ 400（参数校验）→ 按原因分档的
        // 本地提示气泡：code 决定分档，detail 只带 HTTP 状态码。服务端
        // message（400 时含 zod 校验细节）是排障字段，只进控制台不上气泡
        let code: string | undefined;
        try {
          const body = (await response.json()) as { code?: string; message?: string };
          code = body.code;
          if (body.message) console.warn("[followup]", response.status, body.message);
        } catch {
          // 非 JSON 响应体（网关错误页等）：只按 HTTP 状态提示
        }
        const kind = code ? mapErrorCode(code) : "HTTP_ERROR";
        appendTurn({
          role: "assistant",
          text: onlineFailureTipText(
            kind === "UNKNOWN" ? "HTTP_ERROR" : kind,
            String(response.status),
          ),
        });
        return;
      }
      // 响应已到：停滞计时从首字节重新起算，并把窗口从响应前的 120s 长窗
      // 收紧到流内 30s（响应前的本地上下文 / RAG / 首击编译等共享 120s 预算）
      stallTimer.reset(ONLINE_STALL_TIMEOUT_MS);

      // 先追加一条空的回答气泡，随分片累积更新文本，流结束后再挂在线来源脚注。
      // bubbleId 是占位气泡创建后的非空引用：外层 finishAborted 继续用可空的
      // turnId 判空收尾，此处往后的正常流分支都改用 bubbleId 保证类型收窄
      seqRef.current += 1;
      turnId = seqRef.current;
      const bubbleId = turnId;
      setTurns((prev) => [...prev, { id: bubbleId, role: "assistant", text: "" }]);

      // 工具徽章：badges 为已完结调用，pending 为进行中；同名工具按后进先出配对
      const badges: ChatToolBadge[] = [];
      const pending: ChatToolBadge[] = [];
      let badgeSeq = 0;
      const flushBadges = () => {
        setTurns((prev) =>
          prev.map((turn) => (turn.id === bubbleId ? { ...turn, toolBadges: [...badges, ...pending] } : turn)),
        );
      };

      let outcome: "complete" | "error" | "abort" | null = null;
      // SSE error 事件的 code/message（热修复五轮）：流收尾时按 code 分档提示
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      for await (const event of streamFollowup(response)) {
        if (bailIfStopped()) return;
        // 每收到一个事件就重置停滞计时：持续产出的慢流永远不会被误杀
        stallTimer.reset();
        if (event.type === "tool-start") {
          badgeSeq += 1;
          pending.push({
            id: `tool-${badgeSeq}`,
            tool: event.tool,
            label: getToolLabel(event.tool),
            argsDigest: event.argsDigest,
          });
          flushBadges();
        } else if (event.type === "tool-end") {
          const index = pending.findLastIndex((badge) => badge.tool === event.tool);
          if (index !== -1) {
            const finished = pending[index];
            if (finished) {
              finished.ok = event.ok;
              finished.ms = event.ms;
              if (event.errorReason !== undefined) finished.errorReason = event.errorReason;
              badges.push(finished);
            }
            pending.splice(index, 1);
            flushBadges();
          }
        } else if (event.type === "plan") {
          setTurnPlan(bubbleId, { goal: event.goal, steps: event.steps });
        } else if (event.type === "text-delta") {
          accumulated += event.text;
          updateTurnText(bubbleId, accumulated);
        } else if (event.type === "complete") {
          outcome = "complete";
          break;
        } else if (event.type === "error") {
          errorCode = event.code;
          errorMessage = event.message;
          outcome = "error";
          break;
        } else if (event.type === "abort") {
          outcome = "abort";
          break;
        }
      }

      if (outcome === "abort") return; // 服务端已感知中止：静默返回
      if (outcome === "complete") {
        // 流正常收尾：最终文本与徽章落定，挂在线来源脚注与案例参考
        updateTurnText(bubbleId, accumulated);
        flushBadges();
        markTurnOnline(bubbleId, deep, {
          stats: context.length > 0,
          details: details.length > 0 || targeted.length > 0,
        });
        if (ragCases.length > 0) {
          setTurns((prev) =>
            prev.map((turn) => (turn.id === bubbleId ? { ...turn, ragRefs: ragCases } : turn)),
          );
        }
        return;
      }
      if (outcome === "error") {
        // 服务端显式报错：无内容撤掉占位气泡补分档提示；已有内容追加中断
        // 补注（热修复五轮：此前半截回答静默保留，用户看不到任何出错迹象）
        if (accumulated.trim() === "") {
          setTurns((prev) => prev.filter((turn) => turn.id !== bubbleId));
          appendTurn({
            role: "assistant",
            text: onlineFailureTipText(mapErrorCode(errorCode), errorMessage),
          });
        } else {
          updateTurnText(bubbleId, `${accumulated}${onlineErrorNote(errorCode)}`);
        }
        return;
      }
      // 流干净收尾但没等到 run:complete：按已收内容兜底；零内容则撤占位气泡
      if (accumulated.trim() === "") {
        setTurns((prev) => prev.filter((turn) => turn.id !== bubbleId));
        appendTurn({
          role: "assistant",
          text: onlineFailureTipText("NETWORK_OFFLINE"),
        });
        return;
      }
      updateTurnText(bubbleId, accumulated);
      flushBadges();
      markTurnOnline(bubbleId, deep, {
        stats: context.length > 0,
        details: details.length > 0 || targeted.length > 0,
      });
      if (ragCases.length > 0) {
        setTurns((prev) =>
          prev.map((turn) => (turn.id === bubbleId ? { ...turn, ragRefs: ragCases } : turn)),
        );
      }
    } catch {
      // 组件卸载触发的中止 → 静默返回；停滞超时 → finishAborted 统一收尾
      // （已有内容保留并追加中断补注、无内容撤占位补整段提示，只执行一次）；
      // 其余网络异常 / 流中断 → 撤掉空占位气泡并补本地提示
      if (!aliveRef.current) return;
      if (controller.signal.aborted) {
        finishAborted();
        return;
      }
      setTurns((prev) =>
        prev.filter((turn) => !(turn.role === "assistant" && turn.text === "" && !turn.note)),
      );
      appendTurn({
        role: "assistant",
        text: onlineFailureTipText("NETWORK_OFFLINE"),
      });
    } finally {
      stallTimer.clear();
      if (aliveRef.current) setThinking(null);
    }
  }

  /**
   * 转在线兜底前的最后一道本地闸门：没有账单数据时直接本地作答。
   * restoreTimedOut（会话恢复在 RESTORE_WAIT_MS 内未落定）时数据集可能
   * 还在库中、只是没重建完：按「读取异常」提示，不误指「还没有账单数据」
   */
  async function fallToOnline(text: string, deep = false, restoreTimedOut = false) {
    if (usePipeline.getState().datasetTxHash === null) {
      setThinking(null);
      appendTurn({
        role: "assistant",
        text: restoreTimedOut ? ENGINE_READ_ERROR_TEXT : DATASET_EMPTY_TEXT,
        note: "local",
      });
      return;
    }
    await runOnlineFallback(text, deep);
  }

  /**
   * 回答问题的主管线（两个面板共用），按顺序尝试各条路径：
   * 闸门 → 闲聊分流 → 本地规则 → 本地案例（仅助理）→ 在线兜底。
   * 锚点随问题一起交给引擎，用于补全类目 / 时间窗等槽位。
   * deep（A14）：闸门照常拦截注入，之后跳过闲聊 / 本地规则 / 案例检索，
   * 直接转在线兜底——用户显式选择了大模型分析，本地路径不再抢答。
   */
  async function submit(
    text: string,
    anchor: { id: string; label: string } | null,
    options?: { deep?: boolean },
  ) {
    // 用户提问气泡由管线统一追加：两个面板的提交入口（输入框/示例 chips/锚点）
    // 都走本函数，避免各自维护用户气泡的重复逻辑
    appendTurn({ role: "user", text });
    if (enableGuard) {
      const verdict = checkChatInput(text);
      if (verdict.blocked) {
        appendTurn({ role: "assistant", text: GUARD_BLOCKED_REPLY, guarded: true });
        return;
      }
    }

    // 闲聊分流在恢复等待之前：打招呼 / 询问身份是零数据依赖的同步定稿回复，
    // 不需要等会话恢复，也不置位思考态（恢复悬挂时闲聊绝不无谓等待 15s）。
    // deep 档除外：A14 契约是「跳过闲聊分流/本地规则/本地案例直连在线兜底」
    // （07 §13），开启深度分析时即使是闲聊也按用户显式选择交给大模型
    const smallTalkKind = classifySmallTalk(text);
    if (smallTalkKind && !options?.deep) {
      appendTurn({ role: "assistant", text: SMALL_TALK_ANSWER[smallTalkKind], smallTalk: true });
      return;
    }

    // 刷新后的会话恢复可能在飞行中（IndexedDB → DuckDB 重建）：本地规则、
    // 深度分析与在线兜底的上下文都依赖数据集，先等恢复落定再走管线，
    // 避免「恢复未完成 → 本地答不了 → 误转在线」的瞬态错答（A18 实测）。
    // 内存态已有数据集时是零成本 no-op；恢复失败保持未导入口径，不阻断提问。
    //
    // 思考态前置到恢复等待之前：UI 闸门（disabled={thinking !== null}）在恢复
    // 飞行期间同样生效，防止并发提交造成管线交错（A18 审查结论）。等待设
    // RESTORE_WAIT_MS 上限——IndexedDB 与 DuckDB 初始化异常悬挂时提问不会
    // 永久卡死，超时后按未恢复口径继续走管线（本地规则答「还没有账单数据」
    // 或在线兜底按空统计处理），恢复任务在后台自行落定。
    setThinking("data");
    // 记录恢复是否在 RESTORE_WAIT_MS 内落定：超时/异常时数据集可能仍在
    // 库中只是尚未重建，「还没有账单数据」的本地作答要改按「读取异常」区分
    let restoreTimedOut = false;
    try {
      const restored = await Promise.race([
        restorePipelineSnapshot().then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), RESTORE_WAIT_MS)),
      ]);
      restoreTimedOut = !restored;
    } catch {
      restoreTimedOut = true; // 恢复模块自身已吞错，这里仅防御未来签名变化
    }
    if (!aliveRef.current) return;

    if (options?.deep) {
      await fallToOnline(text, true, restoreTimedOut);
      return;
    }

    let intent: QaIntent | null = null;
    try {
      intent = analyzeQuestion(text, anchor);
    } catch {
      intent = null; // 解析异常按未识别处理，转后续路径
    }
    if (intent) {
      // 数据未导入时直接答「还没有账单数据」，不必为探空初始化 DuckDB-WASM；
      // 恢复超时则按「读取异常」提示（数据集在库但尚未重建完成）
      if (usePipeline.getState().datasetTxHash === null) {
        setThinking(null);
        appendTurn({
          role: "assistant",
          text: restoreTimedOut ? ENGINE_READ_ERROR_TEXT : DATASET_EMPTY_TEXT,
          note: "local",
        });
        return;
      }
      try {
        const answer = await answerLocalQuestion(getRunner(), intent, anchor);
        if (!aliveRef.current) return;
        if (answer.kind === "unhandled") {
          await fallToOnline(text, false, restoreTimedOut);
        } else {
          setThinking(null);
          appendTurn({ role: "assistant", text: answer.text, note: "local" });
        }
        return;
      } catch {
        // 本地查询失败（数据库接线 / 白名单拒绝等）→ 转在线兜底
        await fallToOnline(text, false, restoreTimedOut);
        return;
      }
    }

    // 本地案例检索（仅智能助理，A12）：账单查询之外的常识/攻略类问题先查
    // 本地案例库，零 API 调用；未命中或分数不足再转在线。账单问题信号
    // 闸门（热修复五轮）：本地规则弃权的账单问法（如「上上上个月花费
    // 多少费用」超时间窗词表）跳过案例检索直转在线——否则会被 TF-IDF 的
    // 通用词误中维权案例，用攻略回答账单问题
    if (enableCasePath && !isBillQuestion(text)) {
      setThinking("cases");
      try {
        const found = searchLocalCases(text);
        if (found.length > 0) {
          setThinking(null);
          appendTurn({
            role: "assistant",
            text: caseAnswerText(found),
            note: "cases",
            ragRefs: found,
          });
          return;
        }
      } catch {
        // 检索异常按未命中处理，转在线兜底
      }
    }
    await fallToOnline(text, false, restoreTimedOut);
  }

  function reset() {
    setTurns([]);
    setThinking(null);
  }

  return { turns, thinking, submit, reset };
}
