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

import { buildHistoryMessages, DEEP_CONTEXT_PREFIX, DETAIL_CONTEXT_PREFIX, MESSAGE_BUDGET, MESSAGE_MAX_LENGTH, ONLINE_CONTEXT_PREFIX, TARGETED_CONTEXT_PREFIX } from "@/lib/assistant/chat-context";
import { checkChatInput, GUARD_BLOCKED_REPLY } from "@/lib/assistant/input-guard";
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
  EXAMPLE_QUESTIONS,
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

/** 在线兜底失败时的本地提示：说明需要在线服务，并列出本地可回答的问题建议 */
function onlineFallbackTipText(): string {
  const lines = EXAMPLE_QUESTIONS.slice(0, 3).map((question) => `· ${question}`);
  return `这个问题需要连接在线服务才能回答。可以先试试下面这些问题：\n${lines.join("\n")}`;
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

/** 在线请求超时（毫秒）：超时即中止并落本地提示，避免思考态卡死面板 */
const ONLINE_TIMEOUT_MS = 30_000;

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
    // 超时保险：接口或上游长时间不响应时主动中止，防止思考态卡死面板
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ONLINE_TIMEOUT_MS);

    // 中止原因分流：组件卸载 → 静默返回；超时中止 → 补一条本地提示
    function bailIfStopped(): boolean {
      if (!aliveRef.current) return true;
      if (controller.signal.aborted) {
        if (timedOut) appendTurn({ role: "assistant", text: onlineFallbackTipText() });
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
      // 明细快照：最近 150 笔收支明细（08 修订案 A8），读不到则省略该段。
      // deep 模式统计 / 定向明细 / 明细分三条消息发送；明细预算扣除统计段与
      // 定向段，保证三条消息总长不超接口预算（统计 ≤2400、定向 ≤2500）
      let details = "";
      try {
        const detailBudget = deep
          ? Math.min(
              MESSAGE_MAX_LENGTH - 100,
              MESSAGE_BUDGET - context.length - targeted.length - 60,
            )
          : Math.max(0, MESSAGE_MAX_LENGTH - 100 - context.length);
        details = await buildDetailContext(createDuckDbDetailSnapshot(), detailBudget);
      } catch {
        details = "";
      }
      if (bailIfStopped()) return;
      const combined = [context, targeted, details].filter(Boolean).join("\n");
      // 统计与明细都拿不到（未导入账单或引擎读不到数据）：不空手转在线
      if (!combined) {
        setThinking(null);
        appendTurn({ role: "assistant", text: DATASET_EMPTY_TEXT, note: "local" });
        return;
      }

      // RAG 检索：取与问题相关的案例参考（检索层产出，非模型生成，防幻觉引用）；
      // 失败/超时静默跳过，不阻断在线兜底主链路
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
      if (ragCases.length > 0) {
        const refs = ragCases.map((c) => `案例参考（${c.title}：${c.snippet}）`).join("\n");
        messages.push({ role: "user", content: refs });
      }
      const budget = MESSAGE_BUDGET - messages.reduce((sum, m) => sum + m.content.length, 0);
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
        // 503（服务不可用）/ 502（上游异常）/ 400（参数校验）→ 本地提示气泡
        appendTurn({ role: "assistant", text: onlineFallbackTipText() });
        return;
      }

      // 先追加一条空的回答气泡，随分片累积更新文本，流结束后再挂在线来源脚注
      seqRef.current += 1;
      const turnId = seqRef.current;
      setTurns((prev) => [...prev, { id: turnId, role: "assistant", text: "" }]);

      // 工具徽章：badges 为已完结调用，pending 为进行中；同名工具按后进先出配对
      const badges: ChatToolBadge[] = [];
      const pending: ChatToolBadge[] = [];
      let badgeSeq = 0;
      const flushBadges = () => {
        setTurns((prev) =>
          prev.map((turn) => (turn.id === turnId ? { ...turn, toolBadges: [...badges, ...pending] } : turn)),
        );
      };

      let accumulated = "";
      let outcome: "complete" | "error" | "abort" | null = null;
      for await (const event of streamFollowup(response)) {
        if (bailIfStopped()) return;
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
          setTurnPlan(turnId, { goal: event.goal, steps: event.steps });
        } else if (event.type === "text-delta") {
          accumulated += event.text;
          updateTurnText(turnId, accumulated);
        } else if (event.type === "complete") {
          outcome = "complete";
          break;
        } else if (event.type === "error") {
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
        updateTurnText(turnId, accumulated);
        flushBadges();
        markTurnOnline(turnId, deep, {
          stats: context.length > 0,
          details: details.length > 0 || targeted.length > 0,
        });
        if (ragCases.length > 0) {
          setTurns((prev) =>
            prev.map((turn) => (turn.id === turnId ? { ...turn, ragRefs: ragCases } : turn)),
          );
        }
        return;
      }
      if (outcome === "error") {
        // 服务端显式报错：无内容撤掉占位气泡补本地提示；已有内容保留不挂脚注
        if (accumulated.trim() === "") {
          setTurns((prev) => prev.filter((turn) => turn.id !== turnId));
          appendTurn({ role: "assistant", text: onlineFallbackTipText() });
        }
        return;
      }
      // 流干净收尾但没等到 run:complete：按已收内容兜底；零内容则撤占位气泡
      if (accumulated.trim() === "") {
        setTurns((prev) => prev.filter((turn) => turn.id !== turnId));
        appendTurn({ role: "assistant", text: onlineFallbackTipText() });
        return;
      }
      updateTurnText(turnId, accumulated);
      flushBadges();
      markTurnOnline(turnId, deep, {
        stats: context.length > 0,
        details: details.length > 0 || targeted.length > 0,
      });
      if (ragCases.length > 0) {
        setTurns((prev) =>
          prev.map((turn) => (turn.id === turnId ? { ...turn, ragRefs: ragCases } : turn)),
        );
      }
    } catch {
      // 组件卸载触发的中止 → 静默返回；超时中止 → 补一条本地提示气泡（只补一次）；
      // 其余网络异常 / 流中断 → 同样补本地提示；空占位气泡一并撤掉
      if (!aliveRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      setTurns((prev) =>
        prev.filter((turn) => !(turn.role === "assistant" && turn.text === "" && !turn.note)),
      );
      appendTurn({ role: "assistant", text: onlineFallbackTipText() });
    } finally {
      clearTimeout(timeoutId);
      if (aliveRef.current) setThinking(null);
    }
  }

  /** 转在线兜底前的最后一道本地闸门：没有账单数据时直接回「先导入账单」 */
  async function fallToOnline(text: string, deep = false) {
    if (usePipeline.getState().datasetTxHash === null) {
      setThinking(null);
      appendTurn({ role: "assistant", text: DATASET_EMPTY_TEXT, note: "local" });
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

    if (options?.deep) {
      await fallToOnline(text, true);
      return;
    }

    const smallTalkKind = classifySmallTalk(text);
    if (smallTalkKind) {
      appendTurn({ role: "assistant", text: SMALL_TALK_ANSWER[smallTalkKind], smallTalk: true });
      return;
    }

    setThinking("data");
    let intent: QaIntent | null = null;
    try {
      intent = analyzeQuestion(text, anchor);
    } catch {
      intent = null; // 解析异常按未识别处理，转后续路径
    }
    if (intent) {
      // 数据未导入时直接答「还没有账单数据」，不必为探空初始化 DuckDB-WASM
      if (usePipeline.getState().datasetTxHash === null) {
        setThinking(null);
        appendTurn({ role: "assistant", text: DATASET_EMPTY_TEXT, note: "local" });
        return;
      }
      try {
        const answer = await answerLocalQuestion(getRunner(), intent, anchor);
        if (!aliveRef.current) return;
        if (answer.kind === "unhandled") {
          await fallToOnline(text);
        } else {
          setThinking(null);
          appendTurn({ role: "assistant", text: answer.text, note: "local" });
        }
        return;
      } catch {
        // 本地查询失败（数据库接线 / 白名单拒绝等）→ 转在线兜底
        await fallToOnline(text);
        return;
      }
    }

    // 本地案例检索（仅智能助理，A12）：账单查询之外的常识/攻略类问题先查
    // 本地案例库，零 API 调用；未命中或分数不足再转在线
    if (enableCasePath) {
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
    await fallToOnline(text);
  }

  function reset() {
    setTurns([]);
    setThinking(null);
  }

  return { turns, thinking, submit, reset };
}
