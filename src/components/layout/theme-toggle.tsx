"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { featureFlags } from "@/lib/feature-flags";

const THEME_STORAGE_KEY = "spendct:theme";

/** 主题的真实来源是 html 上的 .dark class：布局页内联脚本在首帧前打好（防闪） */
function getThemeSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * 订阅 html class 变化：除本按钮外，未来演示模式等入口也可能切换主题，
 * 用 MutationObserver 统一监听，任何入口的切换都会驱动重渲染。
 */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/**
 * 主题切换按钮。
 * 图标用 dark: 变体跟随 html class 切换而不是由 JS 状态驱动渲染，
 * 保证首屏（含服务端渲染首帧）图标与主题一致，无跳变、无闪。
 * isDark 只用于无障碍标签。
 */
export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => false);

  function toggleTheme() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    // 存储失败（隐私模式禁 localStorage）不影响本次会话内的切换
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* 忽略 */
    }
  }

  if (!featureFlags.dark) return null;

  const label = isDark ? "切换到亮色模式" : "切换到暗色模式";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="grid size-10 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Moon className="size-5 dark:hidden" aria-hidden />
      <Sun className="hidden size-5 dark:inline" aria-hidden />
    </button>
  );
}
