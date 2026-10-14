"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Database, Info, X } from "lucide-react";

/** 「账本数据保存在本机」提示条的关闭状态存储键：关闭一次后不再打扰 */
const DISMISS_KEY = "spendct:me:localdata-hint:dismissed";

/** 读取关闭标记；键不存在或不可读时视为未关闭（默认展示） */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** 「尚未读取」哨兵：与「已读取且为空（false）」区分，保证快照返回稳定缓存 */
const UNREAD: unique symbol = Symbol("local-data-hint-unread");
let cachedDismissed: boolean | typeof UNREAD = UNREAD;

/** 首次调用时完成唯一一次读取；之后返回缓存引用，避免 useSyncExternalStore 无限重渲染 */
function getDismissed(): boolean {
  if (cachedDismissed === UNREAD) {
    cachedDismissed = readDismissed();
  }
  return cachedDismissed;
}

/** 其他标签页关闭提示时同步本页；key 为空代表清空本地存储，也按未关闭处理 */
function subscribeToStorage(onChange: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key === DISMISS_KEY || event.key === null) {
      cachedDismissed = readDismissed();
      onChange();
    }
  }
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

/**
 * 账本归属提示条：个人中心顶部展示，说明「账单数据保存在本机浏览器、不随账户切换」。
 * 直接回应「注册了新账户为何还是旧数据」的困惑——账本跟浏览器走，不跟账户走。
 * localStorage 属外部状态源，用 useSyncExternalStore 订阅：服务端快照恒为
 * false 不渲染首帧，挂载后 React 换用客户端快照重渲染，无水合不一致、无闪现。
 */
export function LocalDataBanner() {
  const dismissed = useSyncExternalStore(subscribeToStorage, getDismissed, () => false);
  const [localDismissed, setLocalDismissed] = useState(false);

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 隐私模式禁 localStorage：仅本次会话内隐藏，不持久化
    }
    cachedDismissed = true;
    setLocalDismissed(true);
  }

  if (dismissed || localDismissed) return null;

  return (
    <aside
      aria-label="账本归属说明"
      className="flex flex-col gap-3 rounded-(--radius-card) border border-(--color-primary) bg-(--color-surface) p-4 shadow-(--shadow-sm) sm:flex-row sm:items-center"
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-(--color-primary-soft) text-(--color-primary)"
      >
        <Database className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-(--color-ink)">账单数据保存在本机浏览器，不随账户切换</p>
        <p className="mt-0.5 text-sm text-(--color-ink-secondary)">
          切换或重新注册账户，已导入的账单仍在——账本跟着这台浏览器走，不跟账户走。想清空可在「数据管理」删除。
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/settings"
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-(--color-border-strong) px-4 text-sm font-medium text-(--color-ink) transition hover:border-(--color-primary)"
        >
          <Info className="size-4" aria-hidden />
          数据管理
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="关闭提示"
          className="grid size-11 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition hover:bg-(--color-surface-2) hover:text-(--color-ink)"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
