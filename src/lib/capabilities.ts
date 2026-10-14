/**
 * 10 大能力卡墙单一数据源（08 §2.2 F01）：
 * 首页卡墙与 /privacy 静态版共用此清单，避免两处维护漂移。
 * 档位口径：P1 = 省赛窗口上线；P2 = 国赛窗口（入口带「即将上线」角标）。
 */
import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  Download,
  GraduationCap,
  Lock,
  PenLine,
  PiggyBank,
  Stethoscope,
  Trophy,
  Wallet,
  WandSparkles,
} from "lucide-react";

import { featureFlags } from "@/lib/feature-flags";

export type CapabilityTier = "P1" | "P2";

export interface Capability {
  /** 稳定标识，卡片锚点与埋点使用 */
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  /** 跳转目标；null 表示无路由（P2 未上线，点击弹静态介绍层） */
  href: string | null;
  tier: CapabilityTier;
  /** 关联的功能开关；开关关闭时卡片灰显「即将上线」（08 §2.3） */
  flag?: keyof typeof featureFlags;
}

const LIST: Capability[] = [
  {
    id: "checkup",
    title: "六步体检",
    desc: "从整理账单到年度报告，六步自动扫完。",
    icon: Stethoscope,
    href: "/checkup",
    tier: "P1",
  },
  {
    id: "subscriptions",
    title: "订阅雷达",
    desc: "自动揪出连续小额扣费，附下次扣费倒计时。",
    icon: BellRing,
    href: "/subscriptions",
    tier: "P1",
  },
  {
    id: "budget",
    title: "预算中心",
    desc: "12 类预算环 + 超支贴士 + 下月预测。",
    icon: Wallet,
    href: "/budget",
    tier: "P1",
    flag: "budget",
  },
  {
    id: "quick-entry",
    title: "快速记账",
    desc: "一句话记一笔：金额、类别与收支自动识别，确认即入账。",
    icon: PenLine,
    href: "/budget#quick",
    tier: "P1",
    flag: "budget",
  },
  {
    id: "poster",
    title: "年度海报",
    desc: "一键生成年度账单海报，保存到手机随时分享。",
    icon: WandSparkles,
    href: "/report",
    tier: "P1",
    flag: "reportStory",
  },
  {
    id: "achievements",
    title: "成就段位",
    desc: "五档消费段位 + 12 枚成就徽章，完成条件即自动解锁。",
    icon: Trophy,
    href: "/report#achievements",
    tier: "P1",
    flag: "achievements",
  },
  {
    id: "tips",
    title: "省钱贴士",
    desc: "学生权益、隐藏优惠搜罗，贴士直接贴合你的账单。",
    icon: PiggyBank,
    href: null,
    tier: "P2",
  },
  {
    id: "learn",
    title: "知识课堂",
    desc: "150+ 可核验案例：订阅陷阱、预付风险、消费维权。",
    icon: GraduationCap,
    href: "/learn",
    tier: "P2",
    flag: "learn",
  },
  {
    id: "export",
    title: "数据导出",
    desc: "一键导出表格文件，全程在你本地完成。",
    icon: Download,
    href: "/settings",
    tier: "P1",
  },
  {
    id: "privacy",
    title: "隐私可见",
    desc: "你的数据谁能看到、谁看不到，一张表说清。",
    icon: Lock,
    href: "/privacy",
    tier: "P1",
  },
];

/** 卡片是否可跳转：P1 且对应开关未关闭 */
export function isCapabilityActive(cap: Capability): boolean {
  if (cap.tier === "P2") return false;
  if (cap.flag && featureFlags[cap.flag] === false) return false;
  return true;
}

export const CAPABILITIES: readonly Capability[] = LIST;
