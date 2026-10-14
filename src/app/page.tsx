import Link from "next/link";
import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowRight,
  BellRing,
  BookOpen,
  Check,
  Cpu,
  FileSpreadsheet,
  GitCompareArrows,
  Lock,
  PieChart,
  ScanLine,
  ScanSearch,
  Server,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Container } from "@/components/layout/container";
import { AuthCtaBand } from "@/components/home/auth-cta-band";
import { CapabilityWall } from "@/components/home/capability-wall";
import { HeroAuthArea } from "@/components/home/hero-auth";
import { ResumeBanner } from "@/components/home/resume-banner";
import { SIX_STAGES, STAGE_DISPLAY_NAMES, type StageId } from "@/lib/pipeline/stage";

/* 六步预览的图标映射：顺序与展示名全部来自 pipeline/stage，本页不复制文案 */
const STAGE_ICONS: Record<StageId, LucideIcon> = {
  clean: FileSpreadsheet,
  profile: PieChart,
  anomaly: TriangleAlert,
  subscription: BellRing,
  attribution: GitCompareArrows,
  annual: BookOpen,
};

const ORDERED_STAGES: StageId[] = [...SIX_STAGES].sort(
  (a, b) => STAGE_DISPLAY_NAMES[a].order - STAGE_DISPLAY_NAMES[b].order,
);

/* 隐私三承诺条：一句话口径，完整对照表在 /privacy */
const PRIVACY_PROMISES = [
  { icon: Lock, text: "账单解析与体检在浏览器内完成" },
  { icon: ShieldCheck, text: "追问时才向 AI 发送统计与最近明细" },
  { icon: ScanSearch, text: "数据一键导出、一键删除" },
] as const;

/* 「怎么做到的」三节点：你的设备 → AI 助手 → 云端转递 */
const ARCH_NODES = [
  { icon: Cpu, title: "你的设备", body: "账单只在这里打开和分析，不联网也能用" },
  { icon: Sparkles, title: "AI 助手", body: "本地答不了时，收到统计与最近 150 笔明细快照" },
  { icon: Server, title: "云端服务器", body: "只负责转递，不保存任何内容" },
] as const;

const VALUE_PROPS = ["AI 先体检", "你审阅追问", "账单本地处理"] as const;

export default function HomePage() {
  return (
    <main className="relative">
      {/* Hero 顶部渐变装饰：纯装饰层，暗色下压低透明度避免抢内容 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-105 bg-linear-to-b from-(--color-primary-soft)/80 via-(--color-primary-soft)/30 to-transparent dark:from-(--color-primary-soft)/50 dark:via-(--color-primary-soft)/15"
      />

      <Container>
        {/* Hero：一句话主张 + 三入口 + 登录态 */}
        <section className="flex flex-col items-center pt-16 pb-12 text-center sm:pt-20 sm:pb-16 lg:pt-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-(--color-border) bg-(--color-surface) px-4 py-1.5 text-sm text-(--color-ink-secondary) shadow-(--shadow-sm)">
            <ScanLine className="size-4 text-(--color-primary)" aria-hidden />
            支持微信 / 支付宝导出的账单文件
          </p>

          <h1 className="mt-6 max-w-3xl text-4xl leading-tight font-bold tracking-tight text-(--color-ink) sm:text-5xl lg:text-6xl">
            给你的账单做一次 <span className="text-(--color-primary)">AI 体检</span>
          </h1>

          <ul aria-label="价值主张" className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {VALUE_PROPS.map((item) => (
              <li
                key={item}
                className="inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm font-medium text-(--color-ink-secondary)"
              >
                <Check className="size-3.5 text-(--color-primary)" aria-hidden />
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-5 max-w-2xl text-base leading-relaxed text-(--color-ink-secondary) sm:text-lg">
            自动扫描你的每一笔消费：哪里花多了、哪些订阅在偷偷扣费、下个月会怎样。
            先体检、后追问——明细永远只留在你的浏览器里。
          </p>

          <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center sm:gap-4">
            <Link
              href="/upload"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white shadow-(--shadow-md) transition hover:bg-(--color-btn-primary-hover)"
            >
              <Upload className="size-4" aria-hidden />
              上传账单，开始体检
            </Link>
            <Link
              href="/upload?sample=1"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-(--color-border-strong) bg-(--color-surface) px-6 text-sm font-medium text-(--color-ink) transition hover:border-(--color-primary)"
            >
              <Sparkles className="size-4 text-(--color-primary)" aria-hidden />
              先用内置账单体验
              <span className="text-(--color-ink-muted)">快速体验</span>
            </Link>
          </div>

          <p className="mt-5 text-sm text-(--color-ink-secondary)">
            三步上手：
            <span className="font-semibold text-(--color-ink)">
              ① 上传账单 → ② 自动体检 → ③ 逐条看分析
            </span>
          </p>

          <div className="mt-5 flex justify-center">
            <HeroAuthArea />
          </div>

          <div className="mt-4 w-full max-w-3xl">
            <ResumeBanner />
          </div>
        </section>
      </Container>

      {/* 隐私三承诺条 */}
      <section aria-label="隐私承诺">
        <Container>
          <ul className="grid gap-4 rounded-(--radius-card) bg-(--color-primary-soft) px-6 py-5 sm:grid-cols-3 sm:gap-6">
            {PRIVACY_PROMISES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-(--color-surface) text-(--color-primary) shadow-(--shadow-sm)"
                >
                  <Icon className="size-4" />
                </span>
                <span className="text-sm font-medium text-(--color-ink)">{text}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* 十大能力卡墙 */}
      <section aria-label="十大能力" className="py-14 sm:py-20">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-(--color-ink) sm:text-3xl">
              十项能力，覆盖从体检到复盘
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary) sm:text-base">
              从六步体检、订阅雷达、预算中心，到年度海报与成就段位——带「即将上线」角标的能力会陆续开放。
            </p>
          </div>
          <div className="mt-8 sm:mt-10">
            <CapabilityWall />
          </div>
        </Container>
      </section>

      {/* 六步预览：静态 mini stepper，移动端横向滚动 */}
      <section aria-label="六步体检" className="pb-14 sm:pb-20">
        <Container>
          <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-5 py-8 sm:px-8 sm:py-10">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-bold tracking-tight text-(--color-ink)">
                六步体检，一次跑完
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">
                六步依次自动完成，每条分析都可以确认、质疑、深挖。
              </p>
            </div>
            {/* w-max + min-w-full：内容放不下时整体左对齐可横滚，放得下时居中，避免居中裁掉左侧 */}
            <div className="mt-8 overflow-x-auto">
              <ol className="mx-auto flex w-max min-w-full items-start justify-center">
                {ORDERED_STAGES.map((id, index) => {
                  const { name, subtitle, order } = STAGE_DISPLAY_NAMES[id];
                  const Icon = STAGE_ICONS[id];
                  return (
                    <li key={id} className="flex shrink-0 items-start">
                      <div className="flex w-20 flex-col items-center gap-2 text-center sm:w-24">
                        <span className="relative grid size-12 place-items-center rounded-full border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm)">
                          <Icon className="size-5 text-(--color-primary)" aria-hidden />
                          <span
                            aria-hidden
                            className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-(--color-primary) font-mono text-[10px] font-bold text-white"
                          >
                            {order}
                          </span>
                        </span>
                        <span className="text-sm font-semibold text-(--color-ink)">{name}</span>
                        <span className="hidden text-xs text-(--color-ink-muted) sm:block">
                          {subtitle}
                        </span>
                      </div>
                      {index < ORDERED_STAGES.length - 1 ? (
                        <ArrowRight
                          aria-hidden
                          className="mx-2 mt-4 size-4 shrink-0 text-(--color-ink-muted) sm:mx-3"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </Container>
      </section>

      {/* 「怎么做到的」展示条 */}
      <section aria-label="怎么做到的" className="pb-14 sm:pb-20">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-(--color-ink)">
              你的数据为什么安全
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">
              三个环节各司其职：账单只在你的设备上分析，AI 只看统计结果，云端只做转递。
            </p>
          </div>

          <ul className="mt-8 flex flex-col gap-2 md:flex-row md:items-stretch">
            {ARCH_NODES.map(({ icon: Icon, title, body }, index) => (
              <Fragment key={title}>
                {index > 0 ? (
                  <li aria-hidden className="grid shrink-0 place-items-center py-1 md:px-2">
                    <ArrowDown className="size-5 text-(--color-ink-muted) md:hidden" />
                    <ArrowRight className="hidden size-5 text-(--color-ink-muted) md:block" />
                  </li>
                ) : null}
                <li className="flex flex-1 items-start gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 md:flex-col md:items-center md:px-3 md:py-5 md:text-center">
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-(--color-surface-2) text-(--color-primary)"
                  >
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-(--color-ink)">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-(--color-ink-muted)">{body}</p>
                  </div>
                </li>
              </Fragment>
            ))}
          </ul>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-(--color-ink-muted)">
            <Lock className="size-3.5" aria-hidden />
            账单明细不会上传到任何服务器，全程只在你的设备上处理
          </p>
        </Container>
      </section>

      {/* 底部收口：登录/注册或回到体检 */}
      <AuthCtaBand />
    </main>
  );
}
