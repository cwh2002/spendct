"use client";

import { motion } from "framer-motion";
import { useEffect, useEffectEvent, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, X } from "lucide-react";
import type { Capability } from "@/lib/capabilities";
import { useMounted } from "@/lib/use-mounted";

interface ComingSoonModalProps {
  capability: Capability;
  onClose: () => void;
}

/**
 * P2 能力卡的静态介绍弹层：标题 + 一句话介绍 + 国赛窗口上线说明。
 * Esc / 点击遮罩 / 关闭按钮三种方式关闭；
 * 打开时锁定页面滚动并把焦点收进弹层（Tab 循环），关闭后焦点还给触发元素。
 * 内容经 createPortal 挂到 body，避开页面内层叠上下文。
 */
export function ComingSoonModal({ capability, onClose }: ComingSoonModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // 服务端快照 false：SSR 首帧不渲染 portal；挂载后为 true 再渲染，避免直接引用 document
  const mounted = useMounted();
  // 关闭回调始终取最新值：退出动画期间父组件重渲染产生新 onClose 时，不重复执行焦点/滚动副作用
  const closeEvent = useEffectEvent(onClose);

  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeEvent();
        return;
      }
      // Tab 焦点圈定在弹层内，避免焦点跑到遮罩后面的页面
      if (event.key !== "Tab" || !dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first && last) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [mounted]);

  if (!mounted) return null;

  const Icon = capability.icon;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="relative w-full max-w-md rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-lg)"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)"
          >
            <Icon className="size-5" />
          </span>
          <h3 id={titleId} className="min-w-0 flex-1 pt-1.5 text-lg font-semibold text-(--color-ink)">
            {capability.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid size-10 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition hover:bg-(--color-surface-2) hover:text-(--color-ink)"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-(--color-ink-secondary)">{capability.desc}</p>

        <div className="mt-4 flex items-start gap-2.5 rounded-(--radius-md) bg-(--color-primary-soft) px-3.5 py-3">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-(--color-primary)" aria-hidden />
          <p className="text-sm leading-relaxed text-(--color-ink-secondary)">
            <span className="font-semibold text-(--color-ink)">国赛窗口上线。</span>
            当前为省赛窗口版本，先把体检主链路做完整；该能力开放后会从这里直接进入。
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-full bg-(--color-btn-primary) text-sm font-medium text-white transition hover:bg-(--color-btn-primary-hover)"
        >
          知道了
        </button>
      </motion.div>
    </div>,
    document.body,
  );
}
