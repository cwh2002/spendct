"use client";

import {
  ChevronLeft,
  CircleCheck,
  MessageSquare,
  MousePointerClick,
  PanelRightClose,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";

import {
  analyzeQuestion,
  answerLocalQuestion,
  buildAggregateContext,
  createDuckDbRunner,
  DATASET_EMPTY_TEXT,
  EXAMPLE_QUESTIONS,
  type QaIntent,
} from "@/lib/chat/qa-engine";
import { classifySmallTalk, SMALL_TALK_ANSWER } from "@/lib/llm/small-talk";
import { usePipeline } from "@/lib/pipeline/store";

/**
 * 追问面板：洞察页右侧的账单问答区。
 *
 * 一次提问按顺序尝试三条路径，命中即停：
 * 1. 闲聊分流（classifySmallTalk）——「你好」「你是谁」等非账单问题直接回定稿文案；
 * 2. 本地规则（qa-engine）——意图解析 + 白名单聚合 SQL 直接读取账单数据回答，
 *    数字全部来自查询结果，答案气泡挂「已按你的账单数据计算」脚注；
 * 3. 在线兜底——本地答不了的问题，拼汇总统计上下文（只含统计、不含逐笔明细）
 *    与最近对话交给在线服务流式回答，气泡挂「在线生成 · 仅发送汇总统计」脚注；
 *    没有账单数据时不进这一环，直接回「先导入账单」。
 *
 * 与页面的协作方式保持既有契约：锚点来自洞察卡「深挖」或账本图表数据点点击，
 * 页面通过 ref 触发「/」快捷键聚焦输入框；折叠窄轨、锚点确认条、快捷键均不变。
 */

/** 追问会话的锚点：来自洞察卡「深挖」或账本图表数据点点击 */
export interface FollowUpAnchor {
  id: string;
  label: string;
}

/** 页面通过 ref 触发「/」快捷键：聚焦追问输入框 */
export interface FollowUpPanelHandle {
  focusInput(): void;
}

/** 追问会话的一轮气泡 */
interface FollowUpTurn {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** 回答来源脚注：local＝本地规则按账单数据计算；live＝在线服务返回 */
  note?: "local" | "live";
  /** 闲聊定稿回答（打招呼/询问身份）：不挂任何来源脚注 */
  smallTalk?: boolean;
}

/** 思考态：data＝读取本地账单数据；live＝等待在线服务返回 */
type ThinkingState = "data" | "live";

/** 在线兜底时夹在对话开头的汇总说明，提醒内容只含统计、不含逐笔明细 */
const ONLINE_CONTEXT_PREFIX = "以下是我的账单汇总数据（只含统计、不含逐笔明细）：\n";

/** 在线接口的消息总长上限（与 /api/ai/chat 的参数校验同口径） */
const MESSAGE_BUDGET = 8000;

/** 在线请求超时（毫秒）：超时即中止并落本地提示，避免思考态卡死面板 */
const ONLINE_TIMEOUT_MS = 30_000;

/** 在线兜底携带的最近对话轮数上限 */
const HISTORY_TURNS = 10;

interface FollowUpPanelProps {
  ref?: React.Ref<FollowUpPanelHandle>;
  /** 移动端抽屉开合；桌面恒为可见列 */
  open: boolean;
  /** 桌面折叠为窄轨（Collapsible Panel） */
  collapsed: boolean;
  anchor: FollowUpAnchor | null;
  onClose(): void;
  onToggleCollapsed(): void;
  onCancelAnchor(): void;
}

/** 在线兜底失败时的本地提示：说明需要在线服务，并列出 3 个本地可回答的问题建议 */
function onlineFallbackTipText(): string {
  const lines = EXAMPLE_QUESTIONS.slice(0, 3).map((question) => `· ${question}`);
  return `这个问题需要连接在线服务才能回答。可以先试试下面这些问题：\n${lines.join("\n")}`;
}

export function FollowUpPanel({
  ref,
  open,
  collapsed,
  anchor,
  onClose,
  onToggleCollapsed,
  onCancelAnchor,
}: FollowUpPanelProps) {
  const [turns, setTurns] = useState<FollowUpTurn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState<ThinkingState | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);
  // 本地 SQL 执行器惰性创建：首次提问才接线，渲染路径不触碰存储与时钟
  const runnerRef = useRef<ReturnType<typeof createDuckDbRunner> | null>(null);
  // 在线请求的中止句柄与组件存活标记：卸载后不再触碰任何状态
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  const hasSession = turns.length > 0;

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  // 新消息 / 思考态出现时滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking]);

  // 挂载时置存活标记、卸载时中止在线请求：流式回填与兜底提示不再触碰已卸载组件的状态。
  // 注意 StrictMode 下 effect 会「挂载→清理→再挂载」，清理会把 aliveRef 置 false，
  // 因此必须在这里（而非仅 useRef 初始值）重新置 true，否则存活标记会永久卡在 false。
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

  function appendTurn(turn: Omit<FollowUpTurn, "id">) {
    seqRef.current += 1;
    // 必须先把序号固化到局部变量再进 updater：updater 是函数式更新，
    // 若直接读 seqRef.current，同一批同步提交里的多次 appendTurn 会在
    // updater 真正执行时都读到最终序号，导致重复 key（如用户提问与闲聊
    // 回答在同一同步批内追加时塌成同一个 id）。
    const id = seqRef.current;
    setTurns((prev) => [...prev, { ...turn, id }]);
  }

  /** 流式分片累积：只更新目标 id 气泡的文本，其他轮次保持原样 */
  function updateTurnText(turnId: number, text: string) {
    setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, text } : turn)));
  }

  /** 整段流结束后挂上在线来源脚注 */
  function markTurnLive(turnId: number) {
    setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, note: "live" } : turn)));
  }

  /**
   * 最近对话映射为在线消息数组：历史气泡 + 本轮用户问题，取最近若干轮，
   * 从最旧一条开始裁剪，保证消息总长不超过接口预算（预算已扣除上下文长度）。
   */
  function buildHistoryMessages(
    currentText: string,
    budget: number,
  ): { role: "user" | "assistant"; content: string }[] {
    const current: { role: "user" | "assistant"; content: string } = {
      role: "user",
      content: currentText,
    };
    const mapped = turns
      .map((turn) => ({ role: turn.role, content: turn.text }))
      .concat([current])
      .slice(-HISTORY_TURNS);
    const kept: { role: "user" | "assistant"; content: string }[] = [];
    let used = 0;
    for (let i = mapped.length - 1; i >= 0; i -= 1) {
      const message = mapped[i];
      if (!message || message.content.length === 0) continue;
      if (used + message.content.length > budget) break;
      kept.push(message);
      used += message.content.length;
    }
    return kept.reverse();
  }

  /**
   * 在线兜底：拼汇总上下文（非空才拼）与最近对话，POST /api/ai/chat
   * 逐片读取 text/plain 回答流，累积回填到最后一条回答气泡。
   * 请求失败 / 流异常时落到本地提示气泡；组件卸载触发的中止直接静默返回。
   */
  async function runOnlineFallback(question: string) {
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
      // 汇总上下文：任何一组统计查不到就由引擎省略该组，空串表示没有任何可发送的统计
      let context = "";
      try {
        context = await buildAggregateContext(getRunner());
      } catch {
        context = "";
      }
      if (bailIfStopped()) return;
      // 没有任何可发送的统计（未导入账单或引擎读不到数据）：不空手转在线，
      // 直接本地回答「先导入账单」，避免模型因拿不到数据而答非所问
      if (!context) {
        setThinking(null);
        appendTurn({ role: "assistant", text: DATASET_EMPTY_TEXT, note: "local" });
        return;
      }

      const messages: { role: "user" | "assistant"; content: string }[] = [];
      if (context) {
        messages.push({ role: "user", content: `${ONLINE_CONTEXT_PREFIX}${context}` });
      }
      const budget = MESSAGE_BUDGET - messages.reduce((sum, m) => sum + m.content.length, 0);
      messages.push(...buildHistoryMessages(question, budget));

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "chat", messages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 503（服务不可用）/ 502（上游异常）/ 400（参数校验）→ 本地提示气泡
        appendTurn({ role: "assistant", text: onlineFallbackTipText() });
        return;
      }
      if (!response.body) throw new Error("响应没有可读取的数据流");

      // 先追加一条空的回答气泡，随分片累积更新文本，流结束后再挂在线来源脚注
      seqRef.current += 1;
      const turnId = seqRef.current;
      setTurns((prev) => [...prev, { id: turnId, role: "assistant", text: "" }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let accumulated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (bailIfStopped()) return;
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        updateTurnText(turnId, accumulated);
      }
      accumulated += decoder.decode(); // 冲刷解码器内部残留字节
      updateTurnText(turnId, accumulated);
      markTurnLive(turnId);
    } catch {
      // 组件卸载触发的中止 → 静默返回（不触碰已卸载组件的状态）；
      // 超时中止 → 补一条本地提示气泡（提示只补一次）；
      // 其余网络异常 / 流中断 → 同样补本地提示
      if (!aliveRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      appendTurn({ role: "assistant", text: onlineFallbackTipText() });
    } finally {
      clearTimeout(timeoutId);
      if (aliveRef.current) setThinking(null);
    }
  }

  /**
   * 转在线兜底前的最后一道本地闸门：没有账单数据时直接回「先导入账单」，
   * 不空手转在线（模型拿不到统计只会把问题挡回来）。
   */
  async function fallToOnline(text: string) {
    if (usePipeline.getState().datasetTxHash === null) {
      setThinking(null);
      appendTurn({ role: "assistant", text: DATASET_EMPTY_TEXT, note: "local" });
      return;
    }
    await runOnlineFallback(text);
  }

  /**
   * 回答问题的主管线（手输与锚点追问共用），按顺序尝试三条路径：
   * ① 闲聊分流 → 定稿文案；② 本地规则读账单数据回答；③ 在线兜底。
   * 锚点随问题一起交给引擎，用于补全类目 / 时间窗等槽位。
   */
  async function submitQuestion(text: string, anchorAtAsk: FollowUpAnchor | null) {
    const smallTalkKind = classifySmallTalk(text);
    if (smallTalkKind) {
      appendTurn({ role: "assistant", text: SMALL_TALK_ANSWER[smallTalkKind], smallTalk: true });
      return;
    }

    setThinking("data");
    let intent: QaIntent | null = null;
    try {
      intent = analyzeQuestion(text, anchorAtAsk);
    } catch {
      intent = null; // 解析异常按未识别处理，转在线兜底
    }
    if (intent) {
      // 数据未导入时直接答「还没有账单数据」，不必为探空初始化 DuckDB-WASM：
      // datasetTxHash 为空 ⟺ transactions 表尚未建出（导入即 setDataset），
      // 空态回答应当即时返回，冷启动下的 WASM 加载不该拖慢这条路径。
      if (usePipeline.getState().datasetTxHash === null) {
        setThinking(null);
        appendTurn({ role: "assistant", text: DATASET_EMPTY_TEXT, note: "local" });
        return;
      }
      try {
        const answer = await answerLocalQuestion(getRunner(), intent, anchorAtAsk);
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
    await fallToOnline(text);
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text || thinking) return;
    appendTurn({ role: "user", text });
    setInput("");
    void submitQuestion(text, anchor);
  }

  /** 空态问题建议 chips：点击即填入输入框并直接提交 */
  function handleChipClick(question: string) {
    if (thinking) return;
    setInput(question);
    appendTurn({ role: "user", text: question });
    void submitQuestion(question, anchor);
  }

  function askFromAnchor() {
    if (!anchor || thinking) return;
    const anchorAtAsk = anchor;
    const text = `围绕「${anchorAtAsk.label}」展开追问`;
    appendTurn({ role: "user", text });
    onCancelAnchor();
    void submitQuestion(text, anchorAtAsk);
  }

  // 桌面折叠轨：会话徽标挂在图标上，展开按钮在顶部
  if (collapsed && !open) {
    return (
      <aside
        aria-label="追问面板（已折叠）"
        className="hidden w-12 flex-col items-center gap-2 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) py-3 lg:flex"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="展开追问面板"
          title="展开追问面板"
          className="grid size-10 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink)"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={`打开追问面板（${turns.length} 轮）`}
          title="追问"
          className="relative grid size-10 place-items-center rounded-full text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2)"
        >
          <MessageSquare className="size-4.5" aria-hidden />
          {turns.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4.5 place-items-center rounded-full bg-(--color-primary) px-1 text-[10px] font-bold leading-4 text-white tabular-nums">
              {turns.length}
            </span>
          ) : null}
        </button>
        <span className="w-6 border-t border-(--color-border)" aria-hidden />
        <span className="mt-1 text-xs text-(--color-ink-muted) [writing-mode:vertical-rl]">追问</span>
      </aside>
    );
  }

  return (
    <aside
      aria-label="追问面板"
      className="flex h-full w-full flex-col border-l border-(--color-border) bg-(--color-surface) shadow-(--shadow-lg) lg:w-[360px] lg:rounded-(--radius-lg) lg:border lg:shadow-(--shadow-sm)"
    >
      <div className="flex items-center justify-between gap-2 border-b border-(--color-border) px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-(--color-primary)" aria-hidden />
          <h2 className="truncate text-sm font-semibold">追问</h2>
          {turns.length > 0 ? (
            <span className="rounded-full bg-(--color-primary-soft) px-2 py-0.5 text-xs font-medium text-(--color-brand-600) tabular-nums">
              {turns.length} 轮
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="折叠追问面板"
            title="折叠追问面板"
            className="hidden size-10 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink) lg:grid"
          >
            <PanelRightClose className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭追问面板"
            className="grid size-10 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink) lg:hidden"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5">
        {anchor ? (
          /* 选中确认条（05 §1.6 AnchorConfirmBar）：追问前可取消选中 */
          <div className="rounded-(--radius-md) border border-(--color-primary)/30 bg-(--color-primary-soft) p-3">
            <div className="flex items-start gap-2">
              <MousePointerClick className="mt-0.5 size-4 shrink-0 text-(--color-brand-600)" aria-hidden />
              <p className="min-w-0 flex-1 text-sm leading-relaxed">
                <span className="font-semibold">已选中：</span>
                {anchor.label}
              </p>
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={askFromAnchor}
                disabled={thinking !== null}
                className="h-10 flex-1 rounded-full bg-(--color-primary) text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:opacity-40"
              >
                追问
              </button>
              <button
                type="button"
                onClick={onCancelAnchor}
                className="h-10 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {!hasSession && !anchor ? (
          /* 空态：问题建议 chips（点击即填入输入框并提交），不含任何预设对话 */
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-(--color-primary-soft)">
              <Sparkles className="size-6 text-(--color-primary)" aria-hidden />
            </span>
            <p className="text-sm font-semibold">从图表开始提问</p>
            <p className="text-xs leading-relaxed text-(--color-ink-secondary)">
              点一个示例问题试试，或直接输入你想知道的账单问题
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {EXAMPLE_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => handleChipClick(question)}
                  className="rounded-full border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  turn.role === "user"
                    ? "rounded-br-sm bg-(--color-primary) text-white"
                    : "rounded-bl-sm bg-(--color-surface-2) text-(--color-ink)"
                }`}
              >
                {turn.text}
                {turn.note === "local" ? (
                  <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[11px] leading-relaxed text-(--color-ink-muted)">
                    <CircleCheck className="size-3 shrink-0 text-(--color-good-ink)" aria-hidden />
                    已按你的账单数据计算
                  </span>
                ) : null}
                {turn.note === "live" ? (
                  <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) bg-(--color-primary-soft) px-2 py-1 text-[11px] leading-relaxed text-(--color-brand-600)">
                    <Sparkles className="size-3 shrink-0" aria-hidden />
                    在线生成 · 仅发送汇总统计
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}

        {thinking ? (
          <div className="flex justify-start" aria-live="polite" aria-label="正在生成回答">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-(--color-surface-2) px-3.5 py-3">
              <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted)" />
              <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted) [animation-delay:120ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted) [animation-delay:240ms]" />
              <span className="ml-1.5 text-xs text-(--color-ink-muted)">
                {thinking === "data" ? "正在读取你的账单数据…" : "正在连接在线服务生成回答…"}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="border-t border-(--color-border) p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === "Escape" && anchor) {
                onCancelAnchor();
              }
            }}
            rows={2}
            placeholder="可以问账单问题，也可以围绕图表追问，例如：为什么外卖涨了？"
            aria-label="追问输入框"
            className="min-h-11 flex-1 resize-none rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-2) px-3 py-2.5 text-sm text-(--color-ink) placeholder:text-(--color-ink-muted) focus-visible:outline-2 focus-visible:outline-(--color-brand-600)"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking !== null}
            aria-label="发送追问"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-(--color-primary) text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:opacity-40"
          >
            <Send className="size-4" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-(--color-ink-muted)">
          Enter 发送 · Shift+Enter 换行 · Esc 取消选中
        </p>
      </form>
    </aside>
  );
}
