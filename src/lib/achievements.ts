/**
 * 成就徽章单一数据源（F10：12 枚，确定性规则判定）。
 * 解锁状态持久化在 localStorage "spendct:achievements:v1"：
 * 当前版本由演示集初始化并支持 unlockAchievement 增量解锁；
 * 正式版可改为每次体检完成后按规则重算（例如 sub-hunter 要求命中 ≥1 项沉默订阅，
 * streak-7 要求连续 7 天有记账记录），重算结果覆盖同一存储键即可。
 * 无本地记录时回退演示数据解锁集并写入，保证离线评审有内容。
 */

import {
  BellRing,
  Bookmark,
  Flame,
  GraduationCap,
  MessageCircleQuestion,
  Moon,
  PiggyBank,
  Sparkles,
  Stethoscope,
  Sunrise,
  Wallet,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { DEMO_ACHIEVEMENTS } from "@/lib/demo-data";

export interface AchievementDef {
  /** 稳定标识，与解锁集合/埋点共用 */
  id: string;
  name: string;
  /** 一句话解锁条件，展示在徽章弹层与成就墙提示里 */
  desc: string;
  /** 徽标下的通俗解释（10 字内）：按真实解锁口径写，与 desc 同义但更口语 */
  plain: string;
  icon: LucideIcon;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  { id: "first-checkup", name: "首次体检", desc: "完成第一次六阶段账单体检", plain: "跑完六步体检", icon: Stethoscope },
  { id: "sub-hunter", name: "揪出订阅刺客", desc: "体检中发现至少 1 项沉默订阅", plain: "发现沉默订阅", icon: BellRing },
  { id: "streak-7", name: "连续记账 7 天", desc: "连续 7 天完成快速记账", plain: "连续记账 7 天", icon: Flame },
  { id: "budget-master", name: "预算大师", desc: "连续 3 个月支出不超预算", plain: "连续 3 月不超预算", icon: Wallet },
  { id: "annual-poster", name: "年度海报", desc: "生成并下载一张年度账单海报", plain: "生成年度海报", icon: WandSparkles },
  { id: "early-bird", name: "早起鸟", desc: "在早晨 6 点前完成一次体检", plain: "早 6 点前体检", icon: Sunrise },
  { id: "night-guard", name: "夜归人", desc: "识别一笔深夜冲动消费并采纳建议", plain: "拦住深夜冲动单", icon: Moon },
  { id: "saver", name: "省钱达人", desc: "采纳建议后月支出下降 5%", plain: "建议生效省 5%", icon: PiggyBank },
  { id: "scholar", name: "学生权益通", desc: "激活 1 项学生权益", plain: "激活学生权益", icon: GraduationCap },
  { id: "cleaner", name: "一尘不染", desc: "累计清理 100 条重复记录", plain: "清理 100 条重复", icon: Sparkles },
  { id: "questioner", name: "十万个为什么", desc: "对洞察卡发起 10 次追问", plain: "追问洞察 10 次", icon: MessageCircleQuestion },
  { id: "collector", name: "收藏家", desc: "收藏 10 张洞察卡", plain: "收藏 10 张卡", icon: Bookmark },
];

/** 规格兼容别名：title/condition 分别镜像 name/desc，供按旧字段名引用的页面使用 */
export interface Achievement extends AchievementDef {
  title: string;
  condition: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = ACHIEVEMENT_DEFS.map((def) => ({
  ...def,
  title: def.name,
  condition: def.desc,
}));

const ACHIEVEMENT_STORAGE_KEY = "spendct:achievements:v1";

/**
 * 读本地解锁集。存储结构兼容两种形态：纯 ID 数组、
 * 或 { ids: string[] } 对象（解锁时间字段暂未消费）。
 * 解析失败或无记录时返回 null，由调用方决定回退策略。
 */
function readStored(): string[] | null {
  try {
    const raw = localStorage.getItem(ACHIEVEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const candidate = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { ids?: unknown }).ids)
        ? (parsed as { ids: unknown[] }).ids
        : [];
    return candidate.filter((id): id is string => typeof id === "string");
  } catch {
    // 存储不可用（隐私模式）或内容损坏：按无记录处理
    return null;
  }
}

/**
 * 读取已解锁成就 ID。未写过本地记录时返回演示解锁集并把演示集写入，
 * 这样「生成海报解锁成就」等后续写入可以继续叠加，而不是每次回退重来。
 * 注意：本函数在服务端与客户端返回不同值（服务端没有本地存储），
 * 组件渲染期应改用 useUnlockedIds() 订阅式读取，避免 SSR 水合不一致。
 */
export function getUnlockedIds(): string[] {
  if (typeof window === "undefined") return [...DEMO_ACHIEVEMENTS.unlockedIds];
  const stored = readStored();
  if (stored) return stored;
  const demo = [...DEMO_ACHIEVEMENTS.unlockedIds];
  try {
    localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(demo));
  } catch {
    // 隐私模式不可写：演示集仅本次会话生效
  }
  return demo;
}

/* ---- 订阅式读取：SSR 首帧渲染空集（与服务器同口径），水合后再读本地集合 ---- */

const achievementListeners = new Set<() => void>();

/** 快照缓存：useSyncExternalStore 要求 getSnapshot 返回稳定引用 */
let achievementSnapshotCache: string[] | null = null;

/** 服务器与首帧快照：空集与服务器渲染一致，水合后立即替换为真实解锁集 */
const EMPTY_ACHIEVEMENT_IDS: string[] = [];

function subscribeAchievements(onChange: () => void): () => void {
  achievementListeners.add(onChange);
  // 跨标签页解锁（storage 事件）；同页解锁由 unlockAchievement 直接通知
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
  return useSyncExternalStore(subscribeAchievements, getAchievementSnapshot, () => EMPTY_ACHIEVEMENT_IDS);
}

/**
 * 解锁一枚成就并持久化，返回更新后的解锁集。
 * 报告页生成海报后调用（annual-poster），同时通知订阅组件重渲染，
 * 成就墙据此对新徽章播放弹入动画。
 */
export function unlockAchievement(id: string): string[] {
  const current = getUnlockedIds();
  if (current.includes(id)) return current;
  const next = [...current, id];
  try {
    localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式不可写：解锁仅本次会话生效
  }
  achievementSnapshotCache = next;
  for (const listener of achievementListeners) listener();
  return next;
}
