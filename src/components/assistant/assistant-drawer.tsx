"use client";

/**
 * 智能助理「小鲸」：全局悬浮入口 + 聊天抽屉（08 修订案 A12）。
 *
 * 与洞察页追问面板共用同一套问答管线（use-chat-pipeline）与气泡层
 * （ChatBubbles），区别在管线选项与入口形态：
 *   - enableCasePath：本地案例检索路径开启——账单查询之外的攻略/常识类
 *     问题先查本地案例库（TF-IDF 零 API），命中即答并挂「本地案例库」脚注；
 *   - 语音输入（Web Speech，仅支持该能力的浏览器显示麦克风入口）；
 *   - 输入闸门（注入拦截）与追问面板同开。
 *
 * 本地优先口径（AI 安全与可控性落点）：账单数据问题在浏览器内用白名单
 * SQL 确定性回答，只有复杂问题才请求在线模型；回答气泡上的脚注（本地/
 * 案例/在线）如实标注每条回答的来源。
 *
 * 挂载点：Shell 客户端层（所有非登录页），桌面悬浮右下、移动端全屏抽屉。
 */
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, RotateCcw, Send, Sparkles, X } from "lucide-react";

import { ChatBubbles, ThinkingBubbles } from "@/components/assistant/chat-bubbles";
import { useChatPipeline } from "@/lib/assistant/use-chat-pipeline";
import { useSpeechInput } from "@/lib/assistant/use-speech-input";
import { featureFlags } from "@/lib/feature-flags";
import { EXAMPLE_QUESTIONS } from "@/lib/chat/qa-engine";

/** 空态示例问题：前三条为账单数据问题（本地引擎），末条为攻略问题（本地案例检索） */
const WELCOME_CHIPS = [
  ...EXAMPLE_QUESTIONS.slice(0, 3),
  "健身房年卡开业三个月就关门了怎么办",
];

/** 助理名称（全站唯一展示名） */
const ASSISTANT_NAME = "智能助理";

/** 输入框上方的语音提示行（仅识别出错时显示） */
function SpeechErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-1.5 text-[11px] text-(--color-warning-ink)">{text}</p>;
}

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { turns, thinking, submit, reset } = useChatPipeline({
    enableCasePath: true,
    enableGuard: true,
  });
  // 语音识别结果只写入输入框（用户确认后发送），不直接提交
  const speech = useSpeechInput((text) => setInput((prev) => (prev ? `${prev} ${text}` : text)));

  // 新消息 / 思考态出现时滚动到底部；打开抽屉时聚焦输入框
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function handleSubmit() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    void submit(text, null);
  }

  function handleChipClick(question: string) {
    if (thinking) return;
    void submit(question, null);
  }

  function handleReset() {
    reset();
    inputRef.current?.focus();
  }

  const voiceEnabled = featureFlags.voice !== false && speech.supported;

  return (
    <>
      {/* 悬浮入口：桌面右下、移动端在 tab bar 上方 */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "关闭智能助理" : "打开智能助理"}
        title={ASSISTANT_NAME}
        className="fixed right-4 bottom-20 z-50 grid size-13 place-items-center rounded-full bg-(--color-primary) text-white shadow-(--shadow-lg) transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:size-14"
      >
        {open ? (
          <X className="size-5" aria-hidden />
        ) : (
          <Sparkles className="size-5" aria-hidden />
        )}
        {!open && turns.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4.5 place-items-center rounded-full bg-(--color-warn) px-1 text-[10px] font-bold leading-4 text-white tabular-nums">
            {turns.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          aria-label={ASSISTANT_NAME}
          className="fixed inset-x-3 bottom-24 top-16 z-50 flex flex-col overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-lg) md:inset-x-auto md:right-6 md:bottom-24 md:top-auto md:h-[600px] md:max-h-[calc(100vh-140px)] md:w-[400px]"
        >
          {/* 头部：名称 + 本地优先口径 + 新对话 */}
          <div className="flex items-center justify-between gap-2 border-b border-(--color-border) px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--color-primary-soft)">
                <Sparkles className="size-4 text-(--color-primary)" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{ASSISTANT_NAME}</h2>
                <p className="truncate text-[11px] text-(--color-ink-muted)">
                  本地优先 · 复杂问题才请求在线模型
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReset}
                aria-label="新对话"
                title="新对话"
                className="grid size-9 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink)"
              >
                <RotateCcw className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭智能助理"
                className="grid size-9 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink)"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* 对话区 */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5">
            {turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-(--color-primary-soft)">
                  <Sparkles className="size-6 text-(--color-primary)" aria-hidden />
                </span>
                <p className="text-sm font-semibold">账单问题，直接问我</p>
                <p className="text-xs leading-relaxed text-(--color-ink-secondary)">
                  能算的问题都在你的浏览器里算完；算不了的复杂问题才会请求在线模型，每次都会如实标注
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  {WELCOME_CHIPS.map((question) => (
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

          {/* 输入区：语音 + 文本 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="border-t border-(--color-border) p-3"
          >
            <div className="flex items-end gap-2">
              {voiceEnabled ? (
                <button
                  type="button"
                  onClick={speech.toggle}
                  aria-label={speech.state === "listening" ? "停止语音输入" : "开始语音输入"}
                  title={
                    speech.state === "listening"
                      ? "正在收听，点击结束"
                      : "语音输入（音频由浏览器语音服务转写，本项目不接收音频）"
                  }
                  className={`grid size-11 shrink-0 place-items-center rounded-full border transition-colors ${
                    speech.state === "listening"
                      ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-primary)"
                      : "border-(--color-border) bg-(--color-surface) text-(--color-ink-muted) hover:text-(--color-ink)"
                  }`}
                >
                  {speech.state === "listening" ? (
                    <MicOff className="size-4" aria-hidden />
                  ) : (
                    <Mic className="size-4" aria-hidden />
                  )}
                </button>
              ) : null}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={2}
                placeholder="问账单、问攻略，例如：这个月餐饮花了多少？"
                aria-label="智能助理输入框"
                className="min-h-11 flex-1 resize-none rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-2) px-3 py-2.5 text-sm text-(--color-ink) placeholder:text-(--color-ink-muted) focus-visible:outline-2 focus-visible:outline-(--color-brand-600)"
              />
              <button
                type="submit"
                disabled={!input.trim() || thinking !== null}
                aria-label="发送消息"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-(--color-primary) text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:opacity-40"
              >
                <Send className="size-4" aria-hidden />
              </button>
            </div>
            <SpeechErrorLine text={speech.errorText} />
            <p className="mt-2 text-[11px] text-(--color-ink-muted)">
              Enter 发送 · Shift+Enter 换行 · 每条回答都标注来源（本地计算 / 本地案例 / 在线生成）
            </p>
          </form>
        </section>
      ) : null}
    </>
  );
}
