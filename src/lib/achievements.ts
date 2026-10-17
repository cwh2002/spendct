/**
 * 成就徽章模块入口（WP8 §8a 改造）：数据定义与判定拆到 src/lib/achievements/
 * 四个子模块（defs/rules/progress/sync），本文件只留存储层与订阅机制，并把
 * 子模块的全部导出原样转发（barrel）——页面原有的 "@/lib/achievements" 引用
 * 零改动。
 *
 * 解锁状态持久化在 localStorage "spendct:achievements:v1"，纯 ID 数组
 * （兼容 { ids: [...] } 旧形态）。写入有两条路径：
 * - 事件解锁：unlockAchievement（报告页生成年度海报 annual-poster）；
 * - 规则重算：sync.recheckAll → applyRecheck 并集写回（其余 12 枚）。
 *
 * 演示回退已删除：无本地记录一律返回 []（服务端同样 []，不再写演示集），
 * 13 枚徽章全部按真实行为解锁，新访客成就墙全锁是正常初始态。
 * 注意：本函数在服务端与客户端返回不同值（服务端没有本地存储），
 * 组件渲染期应改用 useUnlockedIds() 订阅式读取，避免 SSR 水合不一致。
 */

import { useSyncExternalStore } from "react";

export const ACHIEVEMENT_STORAGE_KEY = "spendct:achievements:v1";

/**
 * 读本地解锁集。存储结构兼容两种形态：纯 ID 数组、
 * 或 { ids: string[] } 对象（解锁时间字段暂未消费）。
 * 解析失败或无记录时返回 null，由调用方决定回退策略。
 */
export function readStored(): string[] | null {
  try {
    const raw = localStorage.getItem(ACHIEVEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const candidate = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as { ids?: unknown }).ids)
        ? (parsed as { ids: unknown[] }).ids
        : [];
    return candidate.filter((id): id is string => typeof id === "string");
  } catch {
    // 存储不可用（隐私模式）或内容损坏：按无记录处理
    return null;
  }
}

/** 读取已解锁成就 ID。无本地记录一律返回 []（服务端同样 []，不再写演示集） */
export function getUnlockedIds(): string[] {
  if (typeof window === "undefined") return [];
  return readStored() ?? [];
}

/* ---- 订阅式读取：SSR 首帧渲染空集（与服务器同口径），水合后再读本地集合 ---- */

const achievementListeners = new Set<() => void>();

/** 快照缓存：useSyncExternalStore 要求 getSnapshot 返回稳定引用 */
let achievementSnapshotCache: string[] | null = null;

/** 服务器与首帧快照：空集与服务器渲染一致，水合后立即替换为真实解锁集 */
const EMPTY_ACHIEVEMENT_IDS: string[] = [];

function subscribeAchievements(onChange: () => void): () => void {
  achievementListeners.add(onChange);
  // 跨标签页解锁（storage 事件）；同页解锁由 unlockAchievement/commitUnlockedIds 直接通知
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACHIEVEMENT_STORAGE_KEY) {
      achievementSnapshotCache = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    achievementListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getAchievementSnapshot(): string[] {
  if (achievementSnapshotCache === null) {
    achievementSnapshotCache = getUnlockedIds();
  }
  return achievementSnapshotCache;
}

/**
 * 组件内读取已解锁成就（外部存储订阅）。服务端与水合首帧为空集，
 * 挂载后替换为本地集合——解锁徽章的弹入动画正好由「空 → 真实」的
 * key 变化触发，与成就墙的动画设计一致。
 */
export function useUnlockedIds(): string[] {
  return useSyncExternalStore(
    subscribeAchievements,
    getAchievementSnapshot,
    () => EMPTY_ACHIEVEMENT_IDS,
  );
}

/**
 * 解锁一枚成就并持久化，返回更新后的解锁集。
 * 报告页生成海报后调用（annual-poster），同时通知订阅组件重渲染，
 * 成就墙据此对新徽章播放弹入动画。已解锁的重复调用原样返回，不重复落盘。
 */
export function unlockAchievement(id: string): string[] {
  const current = getUnlockedIds();
  if (current.includes(id)) return current;
  return commitUnlockedIds([...current, id]);
}

/**
 * 整集覆盖写入并通知订阅者：unlockAchievement 与 sync.applyRecheck 共同的
 * 落盘路径，缓存失效 + 通知只在这一处。
 */
export function commitUnlockedIds(ids: string[]): string[] {
  const next = [...ids];
  try {
    localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式不可写：解锁仅本次会话生效
  }
  achievementSnapshotCache = next;
  for (const listener of achievementListeners) listener();
  return next;
}

/* ---- barrel：转发子模块全部导出（含类型），对外仍只用 "@/lib/achievements" 一个入口 ---- */

export * from "./achievements/defs";
export * from "./achievements/rules";
export * from "./achievements/progress";
export * from "./achievements/sync";
