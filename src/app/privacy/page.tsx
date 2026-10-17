import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Code2,
  Database,
  GraduationCap,
  ListChecks,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { CAPABILITIES, isCapabilityActive } from "@/lib/capabilities";
import { featureFlags } from "@/lib/feature-flags";
import {
  VISIBILITY_ROWS,
  visibilityTone,
  type VisibilityRow,
  type VisibilityTone,
} from "@/lib/privacy-visibility";

export const metadata: Metadata = {
  title: "隐私说明",
  description:
    "SpendCT 数据可见性对照表：账单解析与体检默认在浏览器内完成，追问时 AI 可见统计与最近明细快照，服务器只转发、不留存。",
};

/* ---------------- 对照表展示层（单一数据源：@/lib/privacy-visibility） ---------------- */

type CellValue = VisibilityRow["browser"] | VisibilityRow["llm"] | VisibilityRow["server"];

/** 单元格短标签与强调色：永不看到=安全绿、部分出浏览器=警示黄、本地=主文字 */
const VALUE_META: Record<CellValue, { label: string; color: string }> = {
  "local-only": { label: "只存在你的浏览器里", color: "text-(--color-ink)" },
  computed: { label: "在浏览器里算出", color: "text-(--color-ink-secondary)" },
  aggregated: { label: "只看到统计结果", color: "text-(--color-warning-ink)" },
  hashed: { label: "只看到打码代号", color: "text-(--color-warning-ink)" },
  detail: { label: "看到统计与最近明细", color: "text-(--color-warning-ink)" },
  relay: { label: "只转发 · 不留存", color: "text-(--color-ink-secondary)" },
  never: { label: "永不看到", color: "text-(--color-good-ink)" },
  "-": { label: "—", color: "text-(--color-ink-muted)" },
};

interface ToneMeta {
  row: string;
  dot: string;
  swatch: string;
  label: string;
  desc: string;
}

/** 三种行色调：本地计算（ok 绿）/ 部分出浏览器（warn 黄）/ 永不上传（good 绿） */
function toneMeta(tone: VisibilityTone): ToneMeta {
  switch (tone) {
    case "never":
      return {
        row: "bg-(--color-good)/8",
        dot: "bg-(--color-good)",
        swatch: "bg-(--color-good)",
        label: "永不上传",
        desc: "任何情况下都不会离开你的浏览器",
      };
    case "llm":
      return {
        row: "bg-(--color-warn)/12",
        dot: "bg-(--color-warn)",
        swatch: "bg-(--color-warn)",
        label: "部分出浏览器",
        desc: "只会以统计、打码代号或追问明细快照的形态离开浏览器",
      };
    default:
      return {
        row: "bg-(--color-ok)/8",
        dot: "bg-(--color-ok)",
        swatch: "bg-(--color-ok)",
        label: "只在本地计算",
        desc: "只在你自己的浏览器里产生和使用",
      };
  }
}

const LEGEND_TONES: VisibilityTone[] = ["local", "llm", "never"];

/** 隐私承诺三卡（与首页三承诺同口径，落到三端视角） */
const PROMISE_CARDS = [
  {
    icon: MonitorSmartphone,
    title: "你的浏览器：一切计算在本地",
    body: "账单只在你自己的浏览器里打开和分析，六步体检全部在本地完成；一键删除账单就彻底清除，云端没有任何副本。",
  },
  {
    icon: Bot,
    title: "AI 助手：默认只看统计，追问时可见明细",
    body: "AI 默认只能看到按档位归类的金额和打码后的商户名；本地答不了的追问会收到汇总统计与最近 150 笔明细快照（见第 24 行）。另有三条例外，我们都如实列出：格式兜底片段、商户分类文本、账单截图。",
  },
  {
    icon: Server,
    title: "云端服务器：只转发，零存储",
    body: "云端服务器只负责转发，不保存、不记日志、不记录账单内容；导出文件直接在本地生成并下载。",
  },
] as const;

export default function PrivacyPage() {
  return (
    <Container className="py-10 md:py-14">
      {/* 页头：一句话口径 */}
      <header className="max-w-3xl">
        <p className="flex items-center gap-2 text-sm font-medium text-(--color-brand-600)">
          <ShieldCheck className="size-4" aria-hidden />
          你的数据，谁看得到、谁看不到
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">隐私说明</h1>
        <p className="mt-4 text-lg leading-relaxed text-(--color-ink-secondary)">
          一句话承诺：
          <strong className="font-semibold text-(--color-ink)">
            账单解析与体检默认都在你的浏览器里完成
          </strong>
          。 本地答不了的追问会把统计与最近 150 笔明细快照交给 AI
          分析；服务器只做转发、零存储——我们说到做到，宁可少承诺。
        </p>
      </header>

      {/* ① 数据可见性对照表 */}
      <section aria-label="数据可见性对照表" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 className="text-xl font-bold md:text-2xl">数据可见性对照表</h2>
            <p className="mt-2 text-sm text-(--color-ink-secondary)">
              {VISIBILITY_ROWS.length} 项数据，谁看得到、谁看不到，一眼看清；行底颜色对应下方图例。
            </p>
          </div>
          {/* 三色图例 */}
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs" aria-label="行底标图例">
            {LEGEND_TONES.map((tone) => {
              const meta = toneMeta(tone);
              return (
                <li key={tone} className="flex items-center gap-2">
                  <span className={`size-2.5 shrink-0 rounded-full ${meta.swatch}`} aria-hidden />
                  <span className="font-medium text-(--color-ink)">{meta.label}</span>
                  <span className="text-(--color-ink-muted)">{meta.desc}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* 表格容器：内部滚动承载 24 行，sticky 表头依赖此滚动上下文；
            移动端同一容器提供横向滚动 */}
        <div className="mt-4 max-h-[min(62vh,600px)] overflow-auto rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm)">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-(--color-surface) text-left shadow-(--shadow-sm)">
                <th
                  scope="col"
                  className="w-12 border-b border-(--color-border) px-4 py-3 font-semibold text-(--color-ink-muted) tabular-nums"
                >
                  #
                </th>
                <th
                  scope="col"
                  className="min-w-[200px] border-b border-(--color-border) px-4 py-3 font-semibold"
                >
                  数据项
                </th>
                <th
                  scope="col"
                  className="min-w-[170px] border-b border-(--color-border) px-4 py-3 font-semibold"
                >
                  你的浏览器
                </th>
                <th
                  scope="col"
                  className="min-w-[170px] border-b border-(--color-border) px-4 py-3 font-semibold"
                >
                  AI 大模型
                </th>
                <th
                  scope="col"
                  className="min-w-[170px] border-b border-(--color-border) px-4 py-3 font-semibold"
                >
                  云端服务器
                </th>
              </tr>
            </thead>
            <tbody>
              {VISIBILITY_ROWS.map((row, i) => {
                const meta = toneMeta(visibilityTone(row));
                return (
                  <tr
                    key={row.item}
                    className={`border-b border-(--color-border) transition-colors last:border-0 hover:bg-(--color-surface-2)/70 ${meta.row}`}
                  >
                    <td className="px-4 py-3 align-top text-xs text-(--color-ink-muted) tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="flex items-start gap-2 font-medium text-(--color-ink)">
                        <span
                          className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${meta.dot}`}
                          aria-hidden
                        />
                        {row.item}
                      </span>
                      {row.note ? (
                        <p className="mt-1.5 pl-4 text-xs leading-relaxed text-(--color-ink-muted)">
                          {row.note}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`font-medium ${VALUE_META[row.browser].color}`}>
                        {VALUE_META[row.browser].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`font-medium ${VALUE_META[row.llm].color}`}>
                        {VALUE_META[row.llm].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`font-medium ${VALUE_META[row.server].color}`}>
                        {VALUE_META[row.server].label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-(--color-ink-muted)">
          账单解析与体检默认都在你的浏览器里计算；追问在线兜底时 AI 会收到统计与最近 150
          笔明细快照（第 24 行）； 其余路径 AI 只看统计结果（含预算与预测汇总，见第 22
          行）；服务器只做转发、不留存。 表中第 13、19、20、24 行是四处例外，我们都如实列出。
        </p>
      </section>

      {/* ② 隐私承诺三卡 */}
      <section aria-label="隐私承诺" className="mt-14">
        <h2 className="text-xl font-bold md:text-2xl">三端各看到什么</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {PROMISE_CARDS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)"
            >
              <span className="grid size-10 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
                <Icon className="size-5 text-(--color-primary)" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold text-(--color-ink)">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ③ 项目介绍 · 团队 */}
      <section aria-label="项目介绍与团队" className="mt-14">
        <h2 className="text-xl font-bold md:text-2xl">关于项目</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm) lg:col-span-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <Database className="size-5 text-(--color-primary)" aria-hidden />
              SpendCT · 消费CT —— 账单体检与消费洞察平台
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
              传智杯 AI Web 挑战赛参赛作品。把微信、支付宝导出的账单 CSV 拖进浏览器，
              六步体检（清洗、画像、异常、订阅陷阱、环比归因、年度报告）自动跑完， AI
              负责把统计结果讲成看得懂的结论。
            </p>
            <dl className="mt-4 space-y-3.5 text-sm leading-relaxed">
              <div>
                <dt className="font-semibold text-(--color-ink)">面向谁</dt>
                <dd className="mt-0.5 text-(--color-ink-secondary)">
                  在意「钱花到哪了」的大学生与年轻上班族，尤其是被自动续费、深夜冲动消费困扰的人。
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-(--color-ink)">核心能力</dt>
                <dd className="mt-0.5 text-(--color-ink-secondary)">
                  六步体检之外，还有订阅雷达（自动续费逐笔核对、下次扣费倒计时）、预算中心 （12
                  类目预算与下月预测）、消费日历（支出热力图与流水）、省钱挑战（今日支出打卡）、
                  年度报告（健康指数与 1080×1920 海报）、成就体系（13 枚按真实行为解锁的徽章）。
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-(--color-ink)">技术架构</dt>
                <dd className="mt-0.5 text-(--color-ink-secondary)">
                  Next.js + React 19 + TypeScript 构建界面；DuckDB-WASM
                  在浏览器内完成全部账单聚合分析； IndexedDB 本地持久化账户、账本与成就。
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-(--color-ink)">隐私设计</dt>
                <dd className="mt-0.5 text-(--color-ink-secondary)">
                  账单解析与体检默认全部在浏览器本地完成；本地答不了的追问按最小必要原则发送统计与
                  明细快照，服务器只转发、不留存。数据可见性对照表见本页下方。
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-(--color-ink)">开源与交付</dt>
                <dd className="mt-0.5 text-(--color-ink-secondary)">
                  源码随参赛提交公开（MIT 协议），8 份设计文档覆盖架构、隐私、管线、RAG-MCP、UIUX、
                  路线图与契约，从设计到实现全程可查。
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)">
              <h3 className="flex items-center gap-2 font-semibold">
                <Users className="size-5 text-(--color-primary)" aria-hidden />
                团队
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
                由 SpendCT 团队开发与维护，专注大学生的消费健康。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ④ 12 大能力一览（静态版，与首页能力卡同数据源，A17 增补三卡） */}
      <section aria-label="能力一览" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold md:text-2xl">12 大能力一览</h2>
          <p className="flex items-center gap-1.5 text-sm text-(--color-ink-muted)">
            <ListChecks className="size-4" aria-hidden />
            与首页能力卡同数据源
          </p>
        </div>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {CAPABILITIES.map((cap) => {
            const active = isCapabilityActive(cap);
            const Icon = cap.icon;
            return (
              <li
                key={cap.id}
                className={`rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) ${
                  active ? "" : "opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
                    <Icon className="size-4.5 text-(--color-primary)" aria-hidden />
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      active
                        ? "bg-(--color-primary-soft) text-(--color-brand-600)"
                        : "bg-(--color-warn-soft) text-(--color-warning-ink)"
                    }`}
                  >
                    {active ? cap.tier : "即将上线"}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-(--color-ink)">{cap.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-(--color-ink-secondary)">
                  {cap.desc}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ⑤ 底部互链 */}
      <section aria-label="延伸阅读" className="mt-14">
        <div className="grid gap-4 md:grid-cols-2">
          {featureFlags.learn ? (
            <Link
              href="/learn"
              className="group flex items-center gap-4 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm) transition-colors hover:border-(--color-primary)"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
                <GraduationCap className="size-5 text-(--color-primary)" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-(--color-ink)">知识课堂</span>
                <span className="mt-1 block text-sm text-(--color-ink-secondary)">
                  150+ 可核验案例：订阅陷阱、预付风险、消费维权。
                </span>
              </span>
              <ArrowRight
                className="size-5 shrink-0 text-(--color-ink-muted) transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          ) : null}

          <div className="flex items-center gap-4 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)">
            <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
              <Code2 className="size-5 text-(--color-primary)" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-(--color-ink)">开源与透明</span>
              <span className="mt-1 block text-sm text-(--color-ink-secondary)">
                源码与设计文档即将公开，地址确定后第一时间更新。
              </span>
            </span>
          </div>
        </div>
      </section>
    </Container>
  );
}
