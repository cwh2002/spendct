"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { lockBodyScroll, unlockBodyScroll } from "./scroll-lock";

export interface ThinkingSheetProps {
  open: boolean;
  onClose: () => void;
  /** 内容区：ThinkingPanel（flex-1 由本组件给足高度） */
  children: ReactNode;
}

/**
 * 移动端思考面板底部抽屉（05 §1.4 移动端布局：思考面板收进 bottom sheet）。
 * 桌面（lg+）面板固定在右列，本组件只在移动端由入口按钮唤出。
 */
export function ThinkingSheet({ open, onClose, children }: ThinkingSheetProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="思考过程"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col rounded-t-(--radius-xl) bg-(--color-surface) shadow-(--shadow-lg)"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-(--color-border)" />
              <button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                aria-label="关闭思考面板"
                className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-(--color-ink-secondary) transition hover:bg-(--color-surface-2)"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-3 pt-2">{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
