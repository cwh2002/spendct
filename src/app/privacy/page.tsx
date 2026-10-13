import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Code2,
  Coins,
  Database,
  ExternalLink,
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
    "SpendCT 数据可见性对照表：账单明细不出浏览器，大模型仅见聚合摘要与脱敏结果，服务器只转发、零存储。",
};

/* ---------------- 对照表展示层（单一数据源：@/lib/privacy-visibility） ---------------- */

type CellValue = VisibilityRow["browser"] | VisibilityRow["llm"] | VisibilityRow["server"];

/** 单元格短标签与强调色：永不=安全绿、聚合/哈希=警示黄、本地=主文字 */
const VALUE_META: Record<CellValue, { label: string; color: string }> = {
  "local-only": { label: "仅本地", color: "text-(--color-ink)" },
  computed: { label: "本地计算", color: "text-(--color-ink-secondary)" },
  aggregated: { label: "聚合可见", color: "text-(--color-warning-ink)" },
  hashed: { label: "仅哈希占位", color: "text-(--color-warning-ink)" },
  relay: { label: "转发 · 不落盘", color: "text-(--color-ink-secondary)" },
  never: { label: "永不", color: "text-(--color-good-ink)" },
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
        desc: "任何网络出口都不会出现",
      };
    case "llm":
      return {
        row: "bg-(--color-warn)/12",
        dot: "bg-(--color-warn)",
        swatch: "bg-(--color-warn)",
        label: "部分出浏览器",
        desc: "仅聚合/脱敏形态，或经服务器内存转发",
      };
    default:
      return {
        row: "bg-(--color-ok)/8",
        dot: "bg-(--color-ok)",
        swatch: "bg-(--color-ok)",
        label: "本地计算",
        desc: "只在浏览器内产生与使用",
      };
  }
}

const LEGEND_TONES: VisibilityTone[] = ["local", "llm", "never"];

/** 隐私承诺三卡（与首页三承诺同口径，落到三端视角） */
const PROMISE_CARDS = [
  {
    icon: MonitorSmartphone,
    title: "浏览器：一切计算在本地",
    body: "账单明细只进浏览器内的 DuckDB-WASM 与 OPFS，六阶段体检的模板 SQL 全部在本地执行；一键删除账单即彻底清除，服务端没有任何副本。",
  },
  {
    icon: Bot,
    title: "大模型：只见聚合与脱敏",
    body: "大模型只接收分箱金额、哈希商户名与聚合摘要。仅有三条如实登记的例外：≤6KB 格式兜底片段、商户分类文本、OCR 截图。",
  },
  {
    icon: Server,
    title: "服务器：只转发，零存储",
    body: "Next.js API 仅做模型接入层转发：不落盘、不记日志、不记录账单内容；导出文件在内存中构建、本地下载。",
  },
] as const;

/** 技术栈清单（口径以 docs/01-architecture.md 为准） */
const STACK: { name: string; role: string }[] = [
  { name: "Next.js 16", role: "全栈框架：页面路由 + API 接入层" },
  { name: "React 19", role: "界面渲染" },
  { name: "DuckDB-WASM", role: "浏览器内 SQL 分析引擎，明细本地计算" },
  { name: "ECharts", role: "证据图表渲染（声明式 ChartSpec）" },
  { name: "DeepSeek-V3", role: "主脑模型：洞察叙事与聚合 SQL" },
  { name: "Qwen · SiliconFlow", role: "轻任务：交易分类、格式兜底、审稿" },
  { name: "GLM-4V-Flash", role: "OCR：账单截图识别" },
  { name: "Tailwind CSS 4 · zod · Zustand", role: "设计令牌、输出契约校验、前端状态" },
];

export default function PrivacyPage() {
  return (
    <Container className="py-10 md:py-14">
      {/* 页头：一句话口径 */}
      <header className="max-w-3xl">
        <p className="flex items-center gap-2 text-sm font-medium text-(--color-brand-600)">
          <ShieldCheck className="size-4" aria-hidden />
          隐私信任收口 · 与 docs/02-data-privacy.md 同口径
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">隐私说明</h1>
        <p className="mt-4 text-lg leading-relaxed text-(--color-ink-secondary)">
          一句话口径：<strong className="font-semibold text-(--color-ink)">明细不出浏览器</strong>。
          大模型只见聚合摘要与脱敏结果，服务器只做转发、零存储——承诺与真实数据出口一致，宁可少承诺。
        </p>
      </header>

      {/* ① 数据可见性对照表 */}
      <section aria-label="数据可见性对照表" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 className="text-xl font-bold md:text-2xl">数据可见性对照表</h2>
            <p className="mt-2 text-sm text-(--color-ink-secondary)">
              {VISIBILITY_ROWS.length} 项数据在浏览器、大模型、服务器三端的可见口径，行底标对应下方图例。
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

        {/* 表格容器：内部滚动承载 23 行，sticky 表头依赖此滚动上下文；
            移动端同一容器提供横向滚动 */}
        <div className="mt-4 max-h-[min(62vh,600px)] overflow-auto rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm)">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-(--color-surface) text-left shadow-(--shadow-sm)">
                <th scope="col" className="w-12 border-b border-(--color-border) px-4 py-3 font-semibold text-(--color-ink-muted) tabular-nums">
                  #
                </th>
                <th scope="col" className="min-w-[200px] border-b border-(--color-border) px-4 py-3 font-semibold">
                  数据项
                </th>
                <th scope="col" className="min-w-[170px] border-b border-(--color-border) px-4 py-3 font-semibold">
                  浏览器（本地）
                </th>
                <th scope="col" className="min-w-[170px] border-b border-(--color-border) px-4 py-3 font-semibold">
                  LLM（DeepSeek / Qwen / GLM）
                </th>
                <th scope="col" className="min-w-[170px] border-b border-(--color-border) px-4 py-3 font-semibold">
                  服务器（Next.js API）
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
                        <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                        {row.item}
                      </span>
                      {row.note ? (
                        <p className="mt-1.5 pl-4 text-xs leading-relaxed text-(--color-ink-muted)">{row.note}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`font-medium ${VALUE_META[row.browser].color}`}>
                        {VALUE_META[row.browser].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`font-medium ${VALUE_META[row.llm].color}`}>{VALUE_META[row.llm].label}</span>
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
          口径与 docs/02-data-privacy.md 第二章（§8 定稿表，全项目唯一维护点）一致：明细数据只在浏览器
          DuckDB-WASM 内计算；大模型只见聚合摘要与脱敏结果（含预算/预测聚合摘要，见第 22 行），另有三条如实登记的
          例外（第 13/19/20 行）；服务器只做转发、零存储。
        </p>
      </section>

      {/* ② 隐私承诺三卡 */}
      <section aria-label="隐私承诺" className="mt-14">
        <h2 className="text-xl font-bold md:text-2xl">三端各看到什么</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {PROMISE_CARDS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)">
              <span className="grid size-10 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
                <Icon className="size-5 text-(--color-primary)" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold text-(--color-ink)">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ③ 项目介绍与技术栈 · 团队 · 费用说明 */}
      <section aria-label="项目与技术栈" className="mt-14">
        <h2 className="text-xl font-bold md:text-2xl">项目与技术栈</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm) lg:col-span-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <Database className="size-5 text-(--color-primary)" aria-hidden />
              SpendCT · 消费CT —— 账单体检与消费洞察平台
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
              上传微信/支付宝账单，六阶段体检（清洗、画像、异常、订阅陷阱、环比归因、年度报告）全部在本地
              DuckDB-WASM 中跑完，大模型只负责把聚合结果讲成可审阅的结论。传智杯 AI WEB 赛道 · 方向 8 参赛作品。
            </p>
            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {STACK.map((item) => (
                <div key={item.name}>
                  <dt className="text-sm font-semibold text-(--color-ink)">{item.name}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-(--color-ink-muted)">{item.role}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)">
              <h3 className="flex items-center gap-2 font-semibold">
                <Users className="size-5 text-(--color-primary)" aria-hidden />
                团队
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
                SpendCT 出品 · 传智杯 AI WEB 赛道参赛团队。
              </p>
              <p className="mt-2 text-xs text-(--color-ink-muted)">成员名单与分工在答辩材料中补充。</p>
            </div>

            <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm)">
              <h3 className="flex items-center gap-2 font-semibold">
                <Coins className="size-5 text-(--color-primary)" aria-hidden />
                费用说明
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-ink-secondary)">
                模型调用预算{" "}
                <span className="font-medium text-(--color-ink) tabular-nums">¥30–100</span>，硬上限{" "}
                <span className="font-medium text-(--color-ink) tabular-nums">¥150</span>
                （口径：<code className="font-(--font-mono) text-xs">docs/finance.md</code>）。费用纪律：
                六阶段模板 SQL 本地计算零模型调用；OCR 按次计费；密钥只存服务端环境变量。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ④ 10 大能力一览（静态版，与首页能力卡同数据源） */}
      <section aria-label="能力一览" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold md:text-2xl">10 大能力一览</h2>
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
                <p className="mt-1 text-xs leading-relaxed text-(--color-ink-secondary)">{cap.desc}</p>
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

          <a
            href="https://github.com/your-org/spendct"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-4 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-sm) transition-colors hover:border-(--color-primary)"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
              <Code2 className="size-5 text-(--color-primary)" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-(--color-ink)">开源仓库（占位）</span>
              <span className="mt-1 block text-sm text-(--color-ink-secondary)">
                源码与设计文档开源；GitHub 主仓 + Gitee 镜像，地址答辩前配置。
              </span>
            </span>
            <ExternalLink className="size-5 shrink-0 text-(--color-ink-muted)" aria-hidden />
          </a>
        </div>
      </section>
    </Container>
  );
}
