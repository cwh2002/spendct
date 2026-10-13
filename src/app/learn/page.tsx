"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Database,
  ExternalLink,
  FileText,
  GraduationCap,
  Lightbulb,
  Lock,
  PiggyBank,
  Scale,
  Search,
  SearchX,
  Settings2,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Container } from "@/components/layout/container";
import { CASES, CATEGORY_LABELS } from "@/lib/cases";
import type { CaseRecord } from "@/lib/cases";

/** 8 类各自的身份图标：徽标与手册卡共用，颜色中性、靠图标区分类别 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  subscription_trap: BellRing,
  prepaid_risk: CreditCard,
  minor_spending: Zap,
  consumer_rights: ShieldCheck,
  platform_rule: Settings2,
  regulation: Scale,
  spending_advice: PiggyBank,
  student_benefits: GraduationCap,
};

/** 学生权益标签中文名（04 §2 五枚可选值） */
const BENEFIT_TAG_LABELS: Record<string, string> = {
  student_cert: "学生认证",
  edu_discount: "教育优惠",
  campus_card: "校园资源",
  budget_substitute: "平价替代",
  rights_tip: "权益提示",
};

/** 金融素养知识卡：小标题 + 一句话，固定 12 条（F11 规格） */
const KNOWLEDGE_CARDS = [
  { title: "先记账，再谈预算", body: "没有一个月完整记录，任何「省一点」的结论都是猜测。" },
  { title: "50/30/20 法则", body: "必要 50%、弹性 30%、储蓄 20%；学生可调整为 60/30/10。" },
  { title: "拿铁因子", body: "每天 15 元的小额高频支出，年化约 5,475 元。" },
  { title: "每月扣费体检", body: "固定一天检查所有自动扣费签约，5 分钟止损。" },
  { title: "24 小时冷静期", body: "超过月支出 5% 的消费，放购物车一天再做决定。" },
  { title: "预付卡红线", body: "单卡充值不超过 500 元；记名卡法定限额 5,000 元。" },
  { title: "七天无理由", body: "网购商品 7 日内可退；定制、鲜活、数字商品除外。" },
  { title: "未成年人支付", body: "家长开启青少年模式与支付限额，大额充值可追回。" },
  { title: "保留凭证", body: "付款截图与订单号至少保留 6 个月，维权靠证据。" },
  { title: "分期不等于免费", body: "免息分期也有服务费口径，年化利率要自己换算。" },
  { title: "学生认证", body: "外卖、出行、视频平台学生认证通常省 20%-40%。" },
  { title: "应急金先行", body: "先存够 1 个月生活费，再考虑理财与投资。" },
] as const;

/** 防坑手册聚合入口：点击按分类过滤案例流并滚动到列表 */
const HANDBOOKS = [
  { category: "subscription_trap", title: "订阅陷阱手册", desc: "自动续费的识别、关闭与退款路径" },
  { category: "consumer_rights", title: "消费维权手册", desc: "12315 投诉与退一赔三全流程" },
  { category: "prepaid_risk", title: "预付风险手册", desc: "预付卡限额与商家跑路追偿" },
  { category: "platform_rule", title: "平台规则手册", desc: "主流平台的扣费管理与账单入口" },
] as const;

/** 命中词高亮：按子串切分（大小写不敏感），不涉及正则转义问题 */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={key++} className="rounded-sm bg-(--color-warn-soft) px-0.5 text-(--color-ink)">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function CaseCard({
  item,
  expanded,
  onToggle,
  query,
}: {
  item: CaseRecord;
  expanded: boolean;
  onToggle: () => void;
  query: string;
}) {
  const Icon = CATEGORY_ICONS[item.category] ?? FileText;
  const label = CATEGORY_LABELS[item.category] ?? item.category;

  return (
    <article className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-primary-soft) px-2.5 py-1 text-xs font-medium text-(--color-brand-600)">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </span>
        {item.benefitTags.length > 0 ? (
          <span className="flex flex-wrap justify-end gap-1">
            {item.benefitTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-(--color-border) px-2 py-0.5 text-[11px] text-(--color-ink-secondary)"
              >
                {BENEFIT_TAG_LABELS[tag] ?? tag}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2.5 text-base font-semibold leading-snug text-(--color-ink)">
        <Highlight text={item.title} query={query} />
      </h3>

      <p className={`mt-1.5 text-sm leading-relaxed text-(--color-ink-secondary) ${expanded ? "" : "line-clamp-2"}`}>
        <Highlight text={item.summary} query={query} />
      </p>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-(--color-brand-600) transition-colors hover:text-(--color-primary)"
      >
        {expanded ? "收起" : "展开全文"}
        <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {item.legalBasis ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-(--radius-md) bg-(--color-surface-page) px-3 py-2 text-xs leading-relaxed text-(--color-ink-secondary)">
          <Scale className="mt-0.5 size-3.5 shrink-0 text-(--color-ink-muted)" aria-hidden />
          <span>
            依据：<span className="font-medium text-(--color-ink)">{item.legalBasis}</span>
          </span>
        </p>
      ) : null}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
        <span className="shrink-0">来源：</span>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 font-medium text-(--color-brand-600) underline-offset-2 hover:underline"
        >
          <span className="truncate">{item.source}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      </p>
    </article>
  );
}

export default function LearnPage() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 手册卡滚动目标：scroll-mt 避开 sticky 顶栏
  const listRef = useRef<HTMLDivElement | null>(null);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return CASES.filter(
      (c) =>
        (!activeCategory || c.category === activeCategory) &&
        (!q || `${c.title}\n${c.summary}`.toLowerCase().includes(q)),
    );
  }, [q, activeCategory]);

  // 每类案例数（chips 角标），与 CASES 单一来源同步计算
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of CASES) {
      counts[c.category] = (counts[c.category] ?? 0) + 1;
    }
    return counts;
  }, []);

  function pickCategory(category: string) {
    // 再次点击当前分类 = 取消过滤（回到全部）
    setActiveCategory((prev) => (prev === category ? null : category));
  }

  function openHandbook(category: string) {
    setActiveCategory(category);
    // 等待下一帧列表按新过滤渲染后再滚动，避免滚动到旧内容
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function resetFilters() {
    setQuery("");
    setActiveCategory(null);
  }

  const categoryEntries = Object.keys(CATEGORY_LABELS);

  return (
    <Container className="py-8 md:py-10">
      {/* 页头 */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-(--color-ink) md:text-3xl">消费知识小课堂</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-ink-secondary)">
          把可核验案例变成可浏览的产品：订阅陷阱、预付风险、消费维权、学生权益，每条都带可核验来源与法条依据。
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-(--color-ink-secondary)">
          <span className="inline-flex items-center gap-1.5">
            <Database className="size-4 text-(--color-ink-muted)" aria-hidden />
            <span className="tabular-nums">{CASES.length}</span> 条案例
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="size-4 text-(--color-ink-muted)" aria-hidden />
            <span className="tabular-nums">{categoryEntries.length}</span> 类
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="size-4 text-(--color-ink-muted)" aria-hidden />
            已核验
          </span>
        </p>
      </header>

      {/* 搜索 + 分类 chips（chips 与搜索组合过滤） */}
      <div className="mt-6 space-y-3">
        <div className="relative max-w-xl">
          <Search className="absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-(--color-ink-muted)" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索案例标题或内容，如「自动续费」"
            aria-label="搜索案例"
            className="h-11 w-full rounded-full border border-(--color-border) bg-(--color-surface) pr-11 pl-10 text-sm text-(--color-ink) shadow-(--shadow-sm) outline-none transition-colors placeholder:text-(--color-ink-muted) focus:border-(--color-primary)"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清空搜索"
              className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2)"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="按类别筛选">
          <button
            type="button"
            aria-pressed={activeCategory === null}
            onClick={() => setActiveCategory(null)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
              activeCategory === null
                ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-brand-600)"
                : "border-(--color-border) bg-(--color-surface) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
            }`}
          >
            全部
            <span className="text-xs tabular-nums opacity-70">{CASES.length}</span>
          </button>
          {categoryEntries.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={activeCategory === cat}
              onClick={() => pickCategory(cat)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-brand-600)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
              }`}
            >
              {CATEGORY_LABELS[cat]}
              <span className="text-xs tabular-nums opacity-70">{categoryCounts[cat] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 案例流 + 侧栏 */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div ref={listRef} className="scroll-mt-24 lg:col-span-2" aria-label="案例列表">
          {filtered.length > 0 ? (
            <div className="space-y-4">
              <p className="text-xs text-(--color-ink-muted)">
                共 <span className="tabular-nums">{filtered.length}</span> 条结果
              </p>
              {filtered.map((item) => (
                <CaseCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                  query={query}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-(--radius-lg) border border-dashed border-(--color-border-strong) py-16 text-center">
              <SearchX className="mx-auto size-8 text-(--color-ink-muted)" aria-hidden />
              <p className="mt-3 font-medium text-(--color-ink)">没有找到相关案例——换个关键词试试</p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 inline-flex h-9 items-center rounded-full bg-(--color-primary-soft) px-4 text-sm font-medium text-(--color-brand-600) transition-colors hover:bg-(--color-primary-soft)/70"
              >
                清空筛选条件
              </button>
            </div>
          )}
        </div>

        {/* 侧栏（lg+ 展示，移动端折叠到案例流下方） */}
        <aside className="space-y-6" aria-label="知识侧栏">
          <section aria-label="金融素养小知识" className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
            <h2 className="flex items-center gap-2 font-semibold text-(--color-ink)">
              <Lightbulb className="size-4.5 text-(--color-accent)" aria-hidden />
              金融素养小知识
              <span className="ml-auto rounded-full bg-(--color-surface-2) px-2 py-0.5 text-[11px] font-medium text-(--color-ink-secondary)">
                {KNOWLEDGE_CARDS.length} 条
              </span>
            </h2>
            <ul className="mt-2 divide-y divide-(--color-border)">
              {KNOWLEDGE_CARDS.map((k) => (
                <li key={k.title} className="py-2.5">
                  <p className="text-sm font-medium text-(--color-ink)">{k.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-(--color-ink-secondary)">{k.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="防坑手册" className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
            <h2 className="flex items-center gap-2 font-semibold text-(--color-ink)">
              <BookOpen className="size-4.5 text-(--color-primary)" aria-hidden />
              防坑手册
            </h2>
            <p className="mt-1 text-xs text-(--color-ink-muted)">点击手册按主题过滤案例流</p>
            <div className="mt-3 space-y-2.5">
              {HANDBOOKS.map((h) => (
                <button
                  key={h.category}
                  type="button"
                  onClick={() => openHandbook(h.category)}
                  className={`group w-full rounded-(--radius-md) border p-3.5 text-left transition-colors ${
                    activeCategory === h.category
                      ? "border-(--color-primary) bg-(--color-primary-soft)"
                      : "border-(--color-border) hover:border-(--color-border-strong)"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-(--color-ink)">{h.title}</span>
                    <ChevronRight className="size-4 shrink-0 text-(--color-ink-muted) transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-(--color-ink-secondary)">{h.desc}</span>
                  <span className="mt-1.5 block text-[11px] tabular-nums text-(--color-ink-muted)">
                    {categoryCounts[h.category] ?? 0} 条案例
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {/* 底部数据声明条 */}
      <footer className="mt-10 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-page) p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-(--color-ink-secondary)">
          <span className="inline-flex items-center gap-1.5">
            <Database className="size-3.5 text-(--color-ink-muted)" aria-hidden />
            静态公开资料投影
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-(--color-ink-muted)" aria-hidden />
            不含任何用户数据
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="size-3.5 text-(--color-ink-muted)" aria-hidden />
            来源可核验
          </span>
          <Link
            href="/privacy"
            className="ml-auto inline-flex items-center gap-1 font-medium text-(--color-brand-600) underline-offset-2 hover:underline"
          >
            数据说明
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </footer>
    </Container>
  );
}
