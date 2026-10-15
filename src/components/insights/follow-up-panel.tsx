"use client";

import {
  ChevronLeft,
  MessageSquare,
  MousePointerClick,
  PanelRightClose,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";

import { ChatBubbles, ThinkingBubbles } from "@/components/assistant/chat-bubbles";
import { useChatPipeline } from "@/lib/assistant/use-chat-pipeline";
import { EXAMPLE_QUESTIONS } from "@/lib/chat/qa-engine";

/**
 * 追问面板：洞察页右侧的账单问答区。
 *
 * 问答管线已抽取到 use-chat-pipeline（08 修订案 A12），本组件只保留
 * 面板外壳：锚点确认条、空态示例问题、输入框与快捷键。三条路径
 * （闲聊分流 → 本地规则 → 在线兜底）与工具徽章/思考计划渲染均来自
 * 共享管线与 ChatBubbles 气泡层，与全局智能助理同一套口径。
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

export function FollowUpPanel({
  ref,
  open,
  collapsed,
  anchor,
  onClose,
  onToggleCollapsed,
  onCancelAnchor,
}: FollowUpPanelProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { turns, thinking, submit } = useChatPipeline({ enableCasePath: false });

  const hasSession = turns.length > 0;

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  // 新消息 / 思考态出现时滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking]);

  function handleSubmit() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    void submit(text, anchor);
  }

  /** 空态问题建议 chips：点击即提交（用户气泡由管线统一追加） */
  function handleChipClick(question: string) {
    if (thinking) return;
    void submit(question, anchor);
  }

  function askFromAnchor() {
    if (!anchor || thinking) return;
    const anchorAtAsk = anchor;
    const text = `围绕「${anchorAtAsk.label}」展开追问`;
    onCancelAnchor();
    void submit(text, anchorAtAsk);
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
          <ChatBubbles turns={turns} />
        )}

        {thinking ? <ThinkingBubbles state={thinking} /> : null}
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
