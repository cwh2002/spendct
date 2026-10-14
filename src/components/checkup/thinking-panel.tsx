"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  Brain,
  ChevronDown,
  Database,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThinkingEvent } from "./types";

const MAX_VISIBLE = 50;

/* ---------- 事件行渲染 ---------- */

/** 叙事打字机：真实逐字揭示。进度与文本绑定存储，text 变化时进度自然归零、
 *  流式增长（startsWith）时保持进度——两条路径都不需要 effect 内同步 setState */
function NarrativeEvent({ text, active }: { text: string; active: boolean }) {
  const [progress, setProgress] = useState<{ text: string; count: number }>({ text, count: 0 });
  const shown = active && text.startsWith(progress.text) ? Math.min(progress.count, text.length) : 0;
  const typing = active && shown < text.length;

  useEffect(() => {
    if (!active) return;
    const iv = window.setInterval(() => {
      setProgress((p) => ({
        text,
        count: text.startsWith(p.text) ? Math.min(p.count + 2, text.length) : 2,
      }));
    }, 24);
    return () => window.clearInterval(iv);
  }, [text, active]);

  // 非最新叙事立即显示全文：避免两台打字机并行（新叙事顶替旧叙事）
  const display = active ? text.slice(0, shown) : text;
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-sm leading-relaxed text-(--color-ink)">
      <Sparkles className="mt-1 size-4 shrink-0 text-(--color-primary)" aria-hidden />
      <p>
        {display}
        {typing ? (
          <span aria-hidden className="animate-pulse text-(--color-primary)">
            ▍
          </span>
        ) : null}
      </p>
    </div>
  );
}

/** SQL 事件：不再展示 SQL 原文与内部标识，只呈现一句结论式说明 + 安全徽标 */
function SqlEvent({ ev }: { ev: ThinkingEvent }) {
  return (
    <div className="mx-3 my-1.5 flex items-start gap-2 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2">
      <Database className="mt-0.5 size-4 shrink-0 text-(--color-primary)" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-(--color-ink-secondary)">{ev.text}</p>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--color-good)/10 px-2 py-0.5 text-[11px] font-medium text-(--color-good-ink)">
        <ShieldCheck className="size-3" aria-hidden />
        已通过安全检查
      </span>
    </div>
  );
}

/** RAG 案例条目：有摘要（meta）时点击展开；无摘要时只显示一行结论 */
function RagEvent({ ev }: { ev: ThinkingEvent }) {
  const [open, setOpen] = useState(false);
  if (!ev.meta) {
    return (
      <div className="mx-3 my-1.5 flex items-center gap-2 rounded-(--radius-md) border border-(--color-border) bg-(--color-primary-soft)/60 px-3 py-2">
        <ScrollText className="size-4 shrink-0 text-(--color-primary)" aria-hidden />
        <span className="min-w-0 flex-1 text-sm text-(--color-ink-secondary)">{ev.text}</span>
      </div>
    );
  }
  return (
    <div className="mx-3 my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-(--radius-md) border border-(--color-border) bg-(--color-primary-soft)/60 px-3 py-2 text-left"
      >
        <ScrollText className="size-4 shrink-0 text-(--color-primary)" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-(--color-ink-secondary)">{ev.text}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-(--color-ink-muted) transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.p
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden px-3 pt-2 pb-1 text-sm leading-relaxed text-(--color-ink-secondary)"
          >
            {ev.meta}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function EventRow({ ev, isLatestNarrative }: { ev: ThinkingEvent; isLatestNarrative: boolean }) {
  switch (ev.kind) {
    case "progress":
      // meta="cache" 是缓存命中标记（07 §10 秒出路径），用 ⚡ 徽章区分普通确定性进度
      return ev.meta === "cache" ? (
        <div className="flex items-center px-3 py-1.5 text-sm">
          <span className="inline-flex items-center gap-1 rounded-full bg-(--color-primary-soft) px-2 py-0.5 text-xs font-medium text-(--color-primary)">
            <Zap className="size-3" aria-hidden />
            {ev.text}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-(--color-ink-secondary)">
          <span className="size-1.5 shrink-0 rounded-full bg-(--color-ink-muted)" aria-hidden />
          <span className="tabular-nums">{ev.text}</span>
        </div>
      );
    case "sql":
      return <SqlEvent ev={ev} />;
    case "rag":
      return <RagEvent ev={ev} />;
    case "evidence":
      return (
        <div className="flex items-start gap-2 px-3 py-1.5 text-sm text-(--color-ink-secondary)">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-(--color-good-ink)" aria-hidden />
          <span className="tabular-nums">{ev.text}</span>
        </div>
      );
    case "tool":
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-(--color-ink-muted)">
          <Wrench className="size-4 shrink-0" aria-hidden />
          <span>{ev.text}</span>
        </div>
      );
    case "degrade":
      return (
        <div className="flex items-start gap-2 px-3 py-1.5 text-sm text-(--color-warning-ink)">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{ev.text}</span>
        </div>
      );
    case "narrative":
      return <NarrativeEvent text={ev.text} active={isLatestNarrative} />;
  }
}

/* ---------- 面板主体 ---------- */

export interface ThinkingPanelProps {
  events: ThinkingEvent[];
  /** 当前阶段名：变化时经 aria-live 公告（阶段切换是仅有的两类公告之一） */
  stageName?: string;
  /** 外部高度控制：桌面 sticky 高度 / 底部抽屉内 flex-1 */
  className?: string;
}

/**
 * 真实思考状态面板（05 §2.5 / §5.1）：
 * 只渲染真实事件流，不放伪造进度。保留最近 50 条（其余折叠计数），
 * 自动滚底，用户上滚 80px 以上暂停跟随、回到底部恢复；degrade 事件触发顶部 toast。
 */
export function ThinkingPanel({ events, stageName, className = "" }: ThinkingPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  /** 已关闭过的 degrade toast id：事件流保留历史，防止关闭后同一条反复弹出 */
  const [dismissedIds, setDismissedIds] = useState<readonly string[]>([]);

  const visible = events.slice(-MAX_VISIBLE);
  const foldedCount = Math.max(0, events.length - MAX_VISIBLE);
  let lastNarrativeId: string | null = null;
  let lastDegrade: { id: string; text: string } | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev && ev.kind === "narrative" && !lastNarrativeId) {
      lastNarrativeId = ev.id;
    }
    if (ev && ev.kind === "degrade" && !lastDegrade) {
      lastDegrade = { id: ev.id, text: ev.text };
    }
    if (lastNarrativeId && lastDegrade) break;
  }

  // degrade → toast：渲染期间派生（React 官方「state from props」模式），
  // 避免 effect 内同步 setState 引起级联渲染；已关闭的 id 不再弹出
  if (lastDegrade && toast?.id !== lastDegrade.id && !dismissedIds.includes(lastDegrade.id)) {
    setToast(lastDegrade);
  }

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // 上滚 80px 暂停自动滚底，回到底部 20px 内恢复（05 §2.5）
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist > 80) autoScrollRef.current = false;
    if (dist <= 20) autoScrollRef.current = true;
    setPinnedToBottom(dist <= 20);
  };

  useEffect(() => {
    if (autoScrollRef.current) scrollToBottom();
  }, [events]);

  // 打字机逐字增长改变内容高度：自动滚底模式下经 ResizeObserver 跟随
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (autoScrollRef.current) scrollToBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 引用稳定：供 toast 自动消失计时器依赖，避免 effect 因函数身份变化反复重建计时器
  const dismissToast = useCallback((id: string) => {
    setDismissedIds((prev) => [...prev, id].slice(-10));
    setToast(null);
  }, []);

  // toast 6s 自动消失：setState 只在计时器回调里发生，不在 effect 体里
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => dismissToast(toast.id), 6000);
    return () => window.clearTimeout(t);
  }, [toast, dismissToast]);

  return (
    <section
      aria-label="体检动态"
      className={`flex flex-col overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm) ${className}`.trim()}
    >
      {/* 无障碍公告区（视觉隐藏）：aria-live=polite 只公告步骤切换与错误，
          内容随 stageName / toast 派生变化，不逐条播报事件流 */}
      <div aria-live="polite" role="status" className="sr-only">
        {stageName ? `进入「${stageName}」步骤` : ""}
      </div>
      <div aria-live="polite" role="status" className="sr-only">
        {toast ? toast.text : ""}
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-(--color-border) px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="size-5 shrink-0 text-(--color-primary)" aria-hidden />
          <h2 className="text-sm font-semibold">体检动态</h2>
          {stageName ? (
            <span className="rounded-full bg-(--color-primary-soft) px-2 py-0.5 text-xs font-medium text-(--color-primary)">
              {stageName}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-(--color-ink-muted)">{events.length} 条动态</span>
      </div>

      {/* 降级 toast */}
      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mx-3 mt-3 flex items-start gap-2 rounded-(--radius-md) bg-(--color-warn-soft) px-3 py-2.5 text-sm text-(--color-warning-ink)"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="flex-1">{toast.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="关闭提示"
              className="grid size-8 shrink-0 place-items-center rounded-full transition hover:bg-black/5"
            >
              <X className="size-4" aria-hidden />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3">
          <div ref={contentRef}>
            {foldedCount > 0 ? (
              <p className="px-3 py-1.5 text-center text-xs text-(--color-ink-muted)">
                …（更早的 {foldedCount} 条已收起）
              </p>
            ) : null}
            {visible.map((ev) => (
              <EventRow key={ev.id} ev={ev} isLatestNarrative={ev.id === lastNarrativeId} />
            ))}
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <span className="flex gap-1.5" aria-hidden>
                  <span className="size-1.5 animate-pulse rounded-full bg-(--color-primary)" />
                  <span className="size-1.5 animate-pulse rounded-full bg-(--color-primary) [animation-delay:150ms]" />
                  <span className="size-1.5 animate-pulse rounded-full bg-(--color-primary) [animation-delay:300ms]" />
                </span>
                <p className="text-xs text-(--color-ink-muted)">正在准备，马上开始…</p>
              </div>
            ) : null}
          </div>
        </div>
        {!pinnedToBottom ? (
          <button
            type="button"
            onClick={() => {
              autoScrollRef.current = true;
              setPinnedToBottom(true);
              scrollToBottom();
            }}
            className="absolute right-3 bottom-3 z-10 flex h-11 items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface) px-3 text-xs font-medium text-(--color-ink-secondary) shadow-(--shadow-md) transition hover:border-(--color-border-strong)"
          >
            <ArrowDown className="size-4" aria-hidden />
            回到底部
          </button>
        ) : null}
      </div>
    </section>
  );
}
