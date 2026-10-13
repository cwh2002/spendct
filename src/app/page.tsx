import Link from "next/link";
import { FileSpreadsheet, Lock, ScanSearch, ShieldCheck } from "lucide-react";

const SIX_STAGES = [
  { id: "clean", name: "清洗", sub: "解析与去重" },
  { id: "profile", name: "消费画像", sub: "类目·时段·渠道" },
  { id: "anomaly", name: "异常检测", sub: "冲动·退款·深夜" },
  { id: "subscription", name: "订阅陷阱扫描", sub: "扣费刺客" },
  { id: "attribution", name: "环比归因", sub: "涨跌来源" },
  { id: "annual", name: "年度报告", sub: "数据故事" },
] as const;

const PRIVACY_PROMISES = [
  {
    icon: Lock,
    title: "账单不出浏览器",
    body: "明细在浏览器内的 DuckDB-WASM 中计算，服务端只做 AI 转发，从不见明细。",
  },
  {
    icon: ShieldCheck,
    title: "AI 只见脱敏摘要",
    body: "发给大模型的只有分箱金额与哈希商户名，任何情况下都拼不回你的账单。",
  },
  {
    icon: ScanSearch,
    title: "AI 先体检，你来审",
    body: "先给结论，再给证据。每一张洞察卡都可确认、质疑、深挖，数据一键删除。",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6">
      {/* Hero：一句话主张 + 双入口 */}
      <section className="flex flex-col items-center pt-20 pb-14 text-center">
        <p className="mb-4 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          支持微信 / 支付宝账单 CSV · 也支持截图 OCR
        </p>
        <h1 className="max-w-3xl text-4xl leading-tight font-bold tracking-tight md:text-5xl">
          给你的账单做一次 <span className="text-(--color-primary)">AI 全身体检</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
          六阶段流水线扫描你的每一笔消费：哪里花多了、哪些订阅在偷偷扣费、下个月会怎样。
          先体检，后追问——账单数据永远只留在你的浏览器里。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/upload"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-(--color-primary) px-7 font-medium text-white transition hover:opacity-90"
          >
            <FileSpreadsheet className="size-4" />
            上传账单，开始体检
          </Link>
          <Link
            href="/upload?sample=1"
            className="inline-flex h-11 items-center rounded-full border border-slate-300 bg-white px-7 font-medium text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            加载示例账单，先看看效果
          </Link>
        </div>
      </section>

      {/* 六阶段一览 */}
      <section aria-label="六阶段体检" className="pb-16">
        <ol className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {SIX_STAGES.map((stage, i) => (
            <li
              key={stage.id}
              className="rounded-(--radius-card) border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="text-sm font-semibold text-(--color-primary)">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 font-semibold">{stage.name}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{stage.sub}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 隐私三承诺 */}
      <section aria-label="隐私承诺" className="pb-20">
        <h2 className="mb-6 text-center text-2xl font-bold">你的账单，只有你能看见</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PRIVACY_PROMISES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-(--radius-card) border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <Icon className="size-6 text-(--color-primary)" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          完整的「数据可见性对照表」见 <Link href="/privacy" className="underline">隐私说明</Link>
        </p>
      </section>
    </main>
  );
}
