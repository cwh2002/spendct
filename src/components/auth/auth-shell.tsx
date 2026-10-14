"use client";

import { motion } from "framer-motion";
import { HeartPulse, Lock, ScanSearch, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

const TRUST_POINTS = [
  { icon: Lock, text: "明细默认不出浏览器" },
  { icon: ShieldCheck, text: "追问时可见统计与明细" },
  { icon: ScanSearch, text: "每条结论你审阅" },
] as const;

/**
 * 登录/注册的沉浸式两栏布局（05 §1.1）：
 * - ≥lg：左侧品牌区（品牌渐变底 + 主张 + 信任点），右侧表单区；
 * - 移动端：单栏居中卡片，品牌区收成卡片上方的顶部品牌条。
 * Shell 已按路由隐藏导航/页脚，本组件只负责分屏内容本身。
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* 左品牌区：lg 以下隐藏，由移动端顶部品牌条承担品牌展示 */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-(--color-primary) to-(--color-brand-700) p-12 text-white lg:flex lg:w-[44%] xl:w-1/2 xl:p-16">
        {/* 装饰光斑：纯视觉层次，不承载信息 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-white/8 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-white/8 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-(--radius-lg) bg-white/15">
            <HeartPulse className="size-6" aria-hidden />
          </span>
          <span className="text-2xl font-bold tracking-tight">消费CT</span>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-3xl leading-snug font-bold tracking-tight xl:text-4xl">
            给你的账单做一次 AI 体检
          </h1>
          <p className="mt-4 max-w-md leading-relaxed text-white/75">
            上传微信 / 支付宝账单，六阶段流水线扫描每一笔消费：哪里花多了、哪些订阅在偷偷扣费、
            下个月会怎样——结论一条条过你审。
          </p>

          <ul className="mt-10 space-y-4">
            {TRUST_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="text-[15px] font-medium">{text}</span>
              </li>
            ))}
          </ul>

          {/* 产品预览：年度报告页真实截图（内置账单体检结果），矮屏隐藏以免挤占表单空间 */}
          <div className="mt-10 hidden max-w-sm overflow-hidden rounded-(--radius-xl) border border-white/15 shadow-2xl [@media(min-height:820px)]:block">
            <Image
              src="/screenshots/auth-report-hero.png"
              alt="消费CT 年度消费报告页面预览：健康指数与六维健康分析"
              width={1440}
              height={720}
              className="block w-full"
            />
          </div>
        </div>

        <p className="relative text-xs text-white/50">
          © 2026 SpendCT · 账单明细只在你自己的浏览器里计算
        </p>
      </aside>

      {/* 右表单区：表单内容由调用方（登录/注册页）注入卡片 */}
      <div className="flex flex-1 flex-col justify-center bg-(--color-surface-page) px-4 py-10 sm:px-6 lg:px-10">
        {/* 移动端顶部品牌条：桌面端品牌展示在左栏，这里只服务小屏 */}
        <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
          <HeartPulse className="size-7 text-(--color-health)" aria-hidden />
          <span className="text-xl font-bold tracking-tight text-(--color-ink)">消费CT</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="mx-auto w-full max-w-md rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-md) sm:p-8"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
