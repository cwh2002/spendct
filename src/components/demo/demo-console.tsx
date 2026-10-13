"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRightToLine,
  Bug,
  Moon,
  Play,
  RotateCcw,
  Wifi,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const THEME_STORAGE_KEY = "spendct:theme";

/** 演示控制台动作：按钮触发 → 派发全局事件，各页按需监听（05 §7.3） */
export const DEMO_CONSOLE_EVENT = "spendct:demo-action";

export type DemoAction =
  | "replay-pipeline"
  | "jump-last-stage"
  | "inject-error"
  | "toggle-dark"
  | "simulate-offline"
  | "restore-checkpoint";

/** 派发演示动作：控制台外（如页面内快捷键）也可复用 */
export function dispatchDemoAction(action: DemoAction) {
  window.dispatchEvent(new CustomEvent(DEMO_CONSOLE_EVENT, { detail: action }));
}

/** 跳转快捷键组（08 §12.1：b=预算中心、l=知识课堂、s=数据管理） */
const JUMP_KEYS: Record<string, string> = {
  b: "/budget",
  l: "/learn",
  s: "/settings",
};

/**
 * 演示控制台（`?` 键呼出，05 §7.3）：
 * 评委提问时的应急武器——重放流水线、跳最后阶段、注入错误、切换暗色、
 * 断网模拟、恢复断点。mock 模式下全部计算在本机完成，断网不影响任何功能。
 * 注入/跳阶段/恢复三类动作由管线页监听 DEMO_CONSOLE_EVENT 执行（波 4 接真实引擎后生效）。
 */
export function DemoConsole() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 全局 ? 键：输入框内不劫持（让位给占位符字符输入）；Esc 关闭
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const inField =
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (e.key === "?" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // 浮层打开时的跳转快捷键组（不劫持输入框，避免与正常输入冲突）
      if (!open || inField) return;
      const path = JUMP_KEYS[e.key];
      if (path) {
        setOpen(false);
        router.push(path);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, router]);

  const flashToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  function handleAction(action: DemoAction, hint: string) {
    if (action === "toggle-dark") {
      const next = !document.documentElement.classList.contains("dark");
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      } catch {
        /* 隐私模式禁 localStorage 时忽略，会话内切换不受影响 */
      }
      flashToast(next ? "已切换暗色模式" : "已切换亮色模式");
      return;
    }
    if (action === "replay-pipeline") {
      setOpen(false);
      router.push("/checkup?sample=1");
      return;
    }
    if (action === "restore-checkpoint") {
      setOpen(false);
      router.push("/checkup");
      return;
    }
    if (action === "simulate-offline") {
      flashToast(
        "Mock 模式全部计算在本机完成：现在断开网络，所有功能照常可用（可现场验证）",
      );
      return;
    }
    // 注入错误 / 跳最后阶段：派发全局事件，管线页监听执行（波 4 接真实引擎后生效）
    dispatchDemoAction(action);
    flashToast(hint);
  }

  const ACTIONS: { action: DemoAction; label: string; icon: typeof Play; hint: string }[] = [
    { action: "replay-pipeline", label: "重放流水线", icon: Play, hint: "" },
    { action: "jump-last-stage", label: "跳到最后阶段", icon: ArrowRightToLine, hint: "已请求跳到年度报告阶段" },
    { action: "inject-error", label: "注入一次错误", icon: Bug, hint: "已注入一次错误（演示错误边界与降级）" },
    { action: "toggle-dark", label: "切换暗色", icon: Moon, hint: "" },
    { action: "simulate-offline", label: "断网模拟", icon: Wifi, hint: "" },
    { action: "restore-checkpoint", label: "恢复断点", icon: RotateCcw, hint: "" },
  ];

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label="演示控制台"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-20 right-4 z-50 w-72 rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-lg) md:bottom-6"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">演示控制台</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭演示控制台"
                className="grid size-7 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2)"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <p className="mt-0.5 text-xs text-(--color-ink-muted)">
              评委提问时的应急操作 · 再次按 ? 关闭
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {ACTIONS.map(({ action, label, icon: Icon, hint }) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => handleAction(action, hint)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) px-2 text-xs font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-ink)"
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 border-t border-(--color-border) pt-2 text-[11px] leading-relaxed text-(--color-ink-muted)">
              跳转快捷键：<kbd className="font-mono">b</kbd> 预算 ·{" "}
              <kbd className="font-mono">l</kbd> 课堂 · <kbd className="font-mono">s</kbd>{" "}
              设置
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-20 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-full bg-(--color-ink) px-4 py-2 text-center text-xs text-(--color-surface) shadow-(--shadow-lg) md:bottom-6"
          >
            {toast}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </>
  );
}
