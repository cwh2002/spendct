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

/** 追问会话的锚点：来自洞察卡「深挖」或账本图表数据点点击 */
export interface FollowUpAnchor {
  id: string;
  label: string;
}

/** 页面通过 ref 触发「/」快捷键：聚焦追问输入框 */
export interface FollowUpPanelHandle {
  focusInput(): void;
}

interface FollowUpTurn {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** 「示例回答」说明徽标：标记基于示例账单产出的回答 */
  demoNote?: boolean;
}

/** 有会话时预置的两轮示例对话（任务规格的演示数据） */
const DEMO_TURNS: Omit<FollowUpTurn, "id">[] = [
  { role: "user", text: "外卖为什么涨了？" },
  {
    role: "assistant",
    text: "近 30 天外卖 27 笔 782 元，比前 30 天 +14%，主因是 3 笔 40 元以上订单。",
    demoNote: true,
  },
];

/** 新提交问题后的固定示例回答；接入真实分析后替换 */
const DEMO_ANSWER =
  "近 90 天该维度共 42 笔、合计 1,286 元，波动主要来自 2 笔单笔超过 200 元的订单。";

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

/** 回答完成提示：回答气泡前的一行完成状态，不展示内部执行细节 */
function AnswerDoneNote() {
  return (
    <div className="rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2.5">
      <p className="flex items-center gap-2 text-xs font-medium text-(--color-ink-secondary)">
        <CircleCheck className="size-4 shrink-0 text-(--color-good-ink)" aria-hidden />
        已根据你的问题完成分析
      </p>
    </div>
  );
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
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);
  const pendingTimer = useRef<number | null>(null);

  const hasSession = turns.length > 0;

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  // 新消息 / 思考态出现时滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  // 卸载时清理「正在思考」的定时器，避免卸载后 setState
  useEffect(
    () => () => {
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    },
    [],
  );

  function appendTurn(turn: Omit<FollowUpTurn, "id">) {
    seqRef.current += 1;
    setTurns((prev) => [...prev, { ...turn, id: seqRef.current }]);
  }

  function seedDemoTurns() {
    // 「看个例子」：把预置的两轮示例对话灌进会话
    seqRef.current += 1;
    setTurns(DEMO_TURNS.map((turn) => ({ ...turn, id: seqRef.current })));
  }

  function askFromAnchor() {
    if (!anchor) return;
    appendTurn({ role: "user", text: `围绕「${anchor.label}」展开追问` });
    onCancelAnchor();
    queueDemoAnswer();
  }

  function queueDemoAnswer() {
    // 固定示例回答 + 「示例回答」说明；接入真实分析后替换此分支
    setPending(true);
    pendingTimer.current = window.setTimeout(() => {
      appendTurn({ role: "assistant", text: DEMO_ANSWER, demoNote: true });
      setPending(false);
    }, 700);
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text || pending) return;
    appendTurn({ role: "user", text });
    setInput("");
    queueDemoAnswer();
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
                className="h-10 flex-1 rounded-full bg-(--color-primary) text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
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
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-(--color-primary-soft)">
              <Sparkles className="size-6 text-(--color-primary)" aria-hidden />
            </span>
            <p className="text-sm font-semibold">从图表开始提问</p>
            <p className="text-xs leading-relaxed text-(--color-ink-secondary)">
              点击洞察卡的「深挖」或账本图表的数据点，围绕证据继续追问；回答基于你的账单数据生成。
            </p>
            <button
              type="button"
              onClick={seedDemoTurns}
              className="mt-1 h-11 rounded-full border border-(--color-border) bg-(--color-surface) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
            >
              看个例子
            </button>
          </div>
        ) : (
          turns.map((turn, i) => {
            const isLastAssistant = turn.role === "assistant" && i === turns.length - 1;
            return (
              <div key={turn.id} className="space-y-2.5">
                {isLastAssistant ? <AnswerDoneNote /> : null}
                <div className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      turn.role === "user"
                        ? "rounded-br-sm bg-(--color-primary) text-white"
                        : "rounded-bl-sm bg-(--color-surface-2) text-(--color-ink)"
                    }`}
                  >
                    {turn.text}
                    {turn.demoNote ? (
                      <span className="mt-2 flex items-start gap-1.5 rounded-(--radius-sm) bg-(--color-warn-soft) px-2 py-1.5 text-xs leading-relaxed text-(--color-warning-ink)">
                        <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
                        示例回答：以上按示例账单计算，仅供参考
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {pending ? (
          <div className="flex justify-start" aria-label="正在生成回答">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-(--color-surface-2) px-3.5 py-3">
              <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted)" />
              <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted) [animation-delay:120ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted) [animation-delay:240ms]" />
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
            placeholder="围绕图表继续追问，例如：为什么外卖涨了？"
            aria-label="追问输入框"
            className="min-h-11 flex-1 resize-none rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-2) px-3 py-2.5 text-sm text-(--color-ink) placeholder:text-(--color-ink-muted) focus-visible:outline-2 focus-visible:outline-(--color-brand-600)"
          />
          <button
            type="submit"
            disabled={!input.trim() || pending}
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
