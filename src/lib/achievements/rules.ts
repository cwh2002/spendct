/**
 * 成就判定规则层（WP8 §8a）：13 枚徽章里除 annual-poster（报告页生成海报时事件解锁）
 * 之外，其余 12 枚全部按快照真实判定。
 *
 * 规则函数全部是纯函数：只吃 AchievementSnapshot 入参，不读 Date.now、不碰
 * localStorage、不依赖模块状态，同一条快照任何时候判定结果一致，可直接单测。
 * 快照由 sync.ts buildSnapshotFromStorage 组装：存储侧字段（体检次数/手动记账/
 * 挑战打卡）读 localStorage，视图侧字段（预算月表/月度支出/沉默订阅/收藏数等）
 * 由页面数据装载后以 overrides 传入。
 *
 * 连续口径统一复用省钱挑战的 streakOf（从今天往回数，今天没记录时从昨天起算），
 * 与挑战页「连续打卡 N 天」的展示口径一致。
 */

import { daysBetween } from "@/lib/insights/challenge-sql";
import { streakOf } from "@/lib/insights/challenge-store";

import { ACHIEVEMENT_DEFS } from "./defs";

/** 一张被采纳的洞察卡（深夜冲动卡等），month 为采纳月 YYYY-MM */
export interface AdoptedCard {
  cardId: string;
  stage: string;
  month: string;
}

/** 单月预算执行情况（预算页真实月度数据），month 为 YYYY-MM */
export interface BudgetMonth {
  month: string;
  budgetCents: number;
  expenseCents: number;
}

/** 单月实际支出（省钱达人基线与对比月共用），month 为 YYYY-MM */
export interface MonthExpense {
  month: string;
  expenseCents: number;
}

/**
 * 判定快照：一次 recheck 需要的全部输入。today 由组装方传入（本地日期），
 * 规则函数内部禁止 Date.now，避免同一天跨零点判定结果漂移。
 */
export interface AchievementSnapshot {
  /** 本地日期 YYYY-MM-DD，连续类规则以它为基准往回数 */
  today: string;
  /** 累计完成体检次数（runner 每次真实跑完管线后自增） */
  checkupCount: number;
  /** 最近一次体检的小时（0-23），null 表示没有体检记录 */
  lastCheckupHour: number | null;
  /** 是否命中沉默订阅（订阅页用 hasSilentSubscription 判好传入） */
  silentSubscription: boolean;
  /** 有手动记账（expense）的日期集合，YYYY-MM-DD 去重 */
  manualDays: string[];
  /** 预算月表（真实月度数据，可能乱序/多月） */
  budgetMonths: BudgetMonth[];
  /** 已采纳的洞察卡 */
  adopted: AdoptedCard[];
  /** 逐月实际支出（含采纳前后各月） */
  monthlyExpenses: MonthExpense[];
  /** 已激活学生权益数 */
  activatedBenefits: number;
  /** 累计清理的重复记录条数 */
  dedupeSkippedTotal: number;
  /** 对洞察卡发起追问的次数 */
  followupCount: number;
  /** 收藏的洞察卡张数 */
  favoriteCount: number;
  /** 挑战打卡日期集合，YYYY-MM-DD 去重 */
  challengeCheckins: string[];
}

/**
 * 沉默订阅判定：扣费日期按升序排好后，存在相邻两条间隔超过 90 天即视为
 * 「曾经按月扣、后来很久没动静」的沉默订阅；少于 2 条没有间隔可言，直接 false。
 * 纯函数：只吃日期序列，排序在副本上进行，不改入参。
 */
export function hasSilentSubscription(charges: string[]): boolean {
  if (charges.length < 2) return false;
  const sorted = [...charges].sort();
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined && daysBetween(prev, cur) > 90) return true;
    prev = cur;
  }
  return false;
}

/**
 * 全量判定：按 ACHIEVEMENT_DEFS 顺序逐枚判定，返回命中徽章 id 列表。
 * annual-poster 固定排除（事件解锁，不走规则判定）。
 */
export function evaluateAchievements(snap: AchievementSnapshot): string[] {
  const hits: string[] = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if (def.id === "annual-poster") continue;
    if (ruleFor(def.id)(snap)) hits.push(def.id);
  }
  return hits;
}

/** id → 判定函数；未知 id 防御性返回恒 false（defs 新增徽章但漏写规则时不误解锁） */
function ruleFor(id: string): (snap: AchievementSnapshot) => boolean {
  switch (id) {
    case "first-checkup":
      return ruleFirstCheckup;
    case "early-bird":
      return ruleEarlyBird;
    case "sub-hunter":
      return ruleSubHunter;
    case "streak-7":
      return ruleStreak7;
    case "budget-master":
      return ruleBudgetMaster;
    case "night-guard":
      return ruleNightGuard;
    case "saver":
      return ruleSaver;
    case "scholar":
      return ruleScholar;
    case "cleaner":
      return ruleCleaner;
    case "questioner":
      return ruleQuestioner;
    case "collector":
      return ruleCollector;
    case "challenge-streak":
      return ruleChallengeStreak;
    default:
      return () => false;
  }
}

/** 首次体检：跑过一次完整体检即命中（次数只增不减，命中后永久保持） */
function ruleFirstCheckup(snap: AchievementSnapshot): boolean {
  return snap.checkupCount >= 1;
}

/** 早起鸟：最近一次体检发生在早晨 6 点前（小时 <6，5:59 命中、6:00 不命中） */
function ruleEarlyBird(snap: AchievementSnapshot): boolean {
  return snap.lastCheckupHour !== null && snap.lastCheckupHour < 6;
}

/** 揪出订阅刺客：订阅页装载时判好的沉默订阅标记直接采信 */
function ruleSubHunter(snap: AchievementSnapshot): boolean {
  return snap.silentSubscription === true;
}

/** 连续记账 7 天：手动记账日期连续 ≥7 天，口径与挑战页 streakOf 完全一致 */
function ruleStreak7(snap: AchievementSnapshot): boolean {
  return streakOf(snap.manualDays, snap.today) >= 7;
}

/**
 * 预算大师：按月排序取最近 3 个月的预算执行，月数 ≥3 且每个月支出都不超预算。
 * 只判最近 3 个月（更早的超支月不翻旧账），不要求 3 个月物理相邻——
 * 口径跟随「最近 3 月」的字面意思，排序后取末尾 3 条。
 */
function ruleBudgetMaster(snap: AchievementSnapshot): boolean {
  if (snap.budgetMonths.length < 3) return false;
  const recent = [...snap.budgetMonths]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .slice(-3);
  return recent.every((m) => m.expenseCents <= m.budgetCents);
}

/** 夜归人：采纳过深夜冲动消费（stage === "anomaly"）的洞察卡 */
function ruleNightGuard(snap: AchievementSnapshot): boolean {
  return snap.adopted.some((card) => card.stage === "anomaly");
}

/**
 * 省钱达人：采纳非空，且存在一个月晚于基线月、该月支出不高于基线月的 95%。
 * 基线月 = 最早采纳月；账单月表没覆盖该月（典型：数据只到上上月、本月采纳）
 * 时退到最早采纳月之后第一个有数据的月（采纳后的支出水平近似基线）。整数分
 * 比较 ×100 <= ×95（不引入浮点，恰好省 5% 也命中，与徽章文案「下降 5%」一致）。
 * 退位后仍无基线则不可判，直接不命中——月度数据缺月只影响可判性，绝不误判。
 */
function ruleSaver(snap: AchievementSnapshot): boolean {
  if (snap.adopted.length === 0) return false;
  let earliest = snap.adopted[0]?.month;
  for (const card of snap.adopted) {
    if (earliest !== undefined && card.month < earliest) earliest = card.month;
  }
  if (earliest === undefined) return false;
  const baseMonth = snap.monthlyExpenses
    .filter((m) => m.month >= earliest)
    .sort((a, b) => (a.month < b.month ? -1 : 1))[0];
  if (baseMonth === undefined) return false;
  return snap.monthlyExpenses.some(
    (m) => m.month > baseMonth.month && m.expenseCents * 100 <= baseMonth.expenseCents * 95,
  );
}

/** 学生权益通：激活过至少 1 项学生权益 */
function ruleScholar(snap: AchievementSnapshot): boolean {
  return snap.activatedBenefits >= 1;
}

/** 一尘不染：累计清理重复记录 ≥100 条 */
function ruleCleaner(snap: AchievementSnapshot): boolean {
  return snap.dedupeSkippedTotal >= 100;
}

/** 十万个为什么：对洞察卡发起追问 ≥10 次 */
function ruleQuestioner(snap: AchievementSnapshot): boolean {
  return snap.followupCount >= 10;
}

/** 收藏家：收藏洞察卡 ≥10 张 */
function ruleCollector(snap: AchievementSnapshot): boolean {
  return snap.favoriteCount >= 10;
}

/** 七日打卡王：挑战打卡连续 ≥7 天，口径与挑战页 streakOf 完全一致 */
function ruleChallengeStreak(snap: AchievementSnapshot): boolean {
  return streakOf(snap.challengeCheckins, snap.today) >= 7;
}
