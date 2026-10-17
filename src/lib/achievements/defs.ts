/**
 * 成就徽章单一数据源（WP8 §8a 从 src/lib/achievements.ts 原样迁入，数据不变）：
 * 13 枚徽章的定义清单。判定逻辑在 rules.ts（12 枚快照判定 + annual-poster 事件解锁），
 * 解锁集读写与订阅在 achievements.ts（存储层 + barrel 转发）。
 * 本文件只放静态定义与图标，任何地方引用都拿同一份对象。
 */

import {
  BellRing,
  Bookmark,
  CalendarCheck,
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
  {
    id: "first-checkup",
    name: "首次体检",
    desc: "完成第一次六阶段账单体检",
    plain: "跑完六步体检",
    icon: Stethoscope,
  },
  {
    id: "sub-hunter",
    name: "揪出订阅刺客",
    desc: "体检中发现至少 1 项沉默订阅",
    plain: "发现沉默订阅",
    icon: BellRing,
  },
  {
    id: "streak-7",
    name: "连续记账 7 天",
    desc: "连续 7 天完成快速记账",
    plain: "连续记账 7 天",
    icon: Flame,
  },
  {
    id: "budget-master",
    name: "预算大师",
    desc: "最近 3 个月支出不超预算",
    plain: "近 3 月不超预算",
    icon: Wallet,
  },
  {
    id: "annual-poster",
    name: "年度海报",
    desc: "生成并下载一张年度账单海报",
    plain: "生成年度海报",
    icon: WandSparkles,
  },
  {
    id: "early-bird",
    name: "早起鸟",
    desc: "在早晨 6 点前完成一次体检",
    plain: "早 6 点前体检",
    icon: Sunrise,
  },
  {
    id: "night-guard",
    name: "夜归人",
    desc: "识别一笔深夜冲动消费并采纳建议",
    plain: "拦住深夜冲动单",
    icon: Moon,
  },
  {
    id: "saver",
    name: "省钱达人",
    desc: "采纳建议后月支出下降 5%",
    plain: "建议生效省 5%",
    icon: PiggyBank,
  },
  {
    id: "scholar",
    name: "学生权益通",
    desc: "激活 1 项学生权益",
    plain: "激活学生权益",
    icon: GraduationCap,
  },
  {
    id: "cleaner",
    name: "一尘不染",
    desc: "多次导入账单，账本依旧干净（累计 100 条）",
    plain: "导入账单不乱账",
    icon: Sparkles,
  },
  {
    id: "questioner",
    name: "十万个为什么",
    desc: "对洞察卡发起 10 次追问",
    plain: "追问洞察 10 次",
    icon: MessageCircleQuestion,
  },
  {
    id: "collector",
    name: "收藏家",
    desc: "收藏 10 张洞察卡",
    plain: "收藏 10 张卡",
    icon: Bookmark,
  },
  {
    id: "challenge-streak",
    name: "七日打卡王",
    desc: "连续完成 7 天省钱挑战打卡",
    plain: "连续打卡 7 天",
    icon: CalendarCheck,
  },
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
