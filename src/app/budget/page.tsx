"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  PencilLine,
  Table,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth/route-guard";
import { chartInk, cssVar, EChart } from "@/components/charts/e-chart";
import type { ECOption } from "@/components/charts/e-chart";
import { Container } from "@/components/layout/container";
import { DEMO_BUDGET, DEMO_FORECAST } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { mockBudgetAdvice, type MockBudgetAdvice } from "@/lib/llm/mock-narratives";
import { parseQuickEntryText } from "@/lib/llm/quick-entry-rule";
import { usePipeline } from "@/lib/pipeline/store";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

/** 12 类唯一枚举（07 §3）：与 quick-entry zod schema 的 CATEGORIES 同口径，后续统一到 src/lib/schema */
const CATEGORIES_12 = [
  "餐饮",
  "交通",
  "购物",
  "娱乐",
  "居住",
  "通讯",
  "医疗",
  "教育",
  "人情",
  "金融",
  "订阅",
  "其他",
] as const;

/**
 * 手动记账本地存储键（06 §7 修订案 A1 允许的 UI 状态类键）：
 * 手动账单行进入 DuckDB transactions 表前先落在 localStorage，
 * 账本页接通后合并展示（source='manual' 口径）。
 */
const KEY_MANUAL = "spendct:manual-entries";
/** 分类预算覆盖值：{ 类别: 预算分 }，demo 预算为缺省值 */
const KEY_BUDGET = "spendct:budget:v1";

/** 快速记账示例：点一下自动带入并解析，零学习成本 */
const QUICK_EXAMPLES = ["中午食堂花了 15", "昨天打车 23.5", "兼职赚了 200", "月初房租 1500"];

interface ManualEntry {
  id: string;
  ts: string; // YYYY-MM-DD
  direction: "expense" | "income";
  category: string;
  amountCents: number;
  note: string;
}

/** 未来月演示外推系数：下月 ×0.9、再下月 ×0.81，模拟季节回落（demo 模式口径） */
const MONTH_FACTORS = [1, 0.9, 0.81] as const;

type Severity = "ok" | "warn" | "over";

const SEVERITY_META: Record<Severity, { label: string; cssVarName: string; textClass: string }> = {
  ok: { label: "预算健康", cssVarName: "--color-good", textClass: "text-(--color-good-ink)" },
  warn: { label: "接近预算上限", cssVarName: "--color-warning", textClass: "text-(--color-warning-ink)" },
  over: { label: "已超支", cssVarName: "--color-critical", textClass: "text-(--color-critical-ink)" },
};

function severityOf(ratio: number): Severity {
  if (ratio < 0.8) return "ok";
  if (ratio < 1) return "warn";
  return "over";
}

/** 分 → 元展示：金额全站以分存储，展示统一转元并做千分位（05 §3.2 tabular-nums） */
function fmtYuan(cents: number, digits = 2): string {
  return (cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

/** ISO 日期 → 「10月13日」短格式（手动记账列表与入账横幅用） */
function fmtDateCN(iso: string): string {
  const parts = iso.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function toDateInput(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 金额输入框展示：整数元不带小数（15），非整带两位（15.5） */
function formatAmountInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** localStorage 读写统一兜底：隐私模式下抛异常时降级为内存态，不阻塞页面 */
function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 写入失败静默降级：界面照常工作，仅本次数据不持久化
  }
}

/* —— 快速记账：解析统一走 src/lib/llm/quick-entry-rule（单一来源，06 §⑥.1） —— */

interface QuickDraft {
  amount: string; // 元，输入框字符串
  direction: "expense" | "income";
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
}

type ParseOutcome = { ok: true; draft: QuickDraft } | { ok: false; reason: string };

/** 规则解析结果 → 可编辑草稿：金额从分转输入框字符串，日期已由规则解析填好 */
function draftFromRule(text: string, todayIso: string): ParseOutcome {
  const result = parseQuickEntryText(text, todayIso);
  if (!result.parseable) return { ok: false, reason: result.reason ?? "没识别出金额，请补一句数字" };
  return {
    ok: true,
    draft: {
      amount: formatAmountInput(result.amountCents ?? 0),
      direction: result.direction ?? "expense",
      category: result.category ?? "其他",
      date: result.dateIso ?? todayIso,
      note: text.slice(0, 60),
    },
  };
}

/** 分类预算条渐变：颜色跟实体不跟排名（05 §3.1.3 八槽顺序取用），超支态统一红系 */
const SLOT_PAIRS: Record<string, [number, number]> = {
  餐饮: [3, 6],
  购物: [2, 4],
  交通: [1, 7],
  娱乐: [5, 8],
  居住: [6, 3],
  通讯: [1, 3],
  医疗: [8, 2],
  教育: [7, 5],
  人情: [8, 4],
  金融: [4, 2],
  订阅: [7, 1],
  其他: [4, 6],
};

function gradientOf(category: string): string {
  const pair = SLOT_PAIRS[category] ?? [4, 6];
  const a = pair[0] ?? 4;
  const b = pair[1] ?? 6;
  // CSS 变量经 var() 在绘制期解析，暗色切换无需 JS 重算
  return `linear-gradient(90deg, var(--color-chart-${a}), var(--color-chart-${b}))`;
}

/* —— 真实数据动线（波 4：真实优先 + demo 兜底） —— */

/**
 * 白名单确定性聚合 SQL（07 §6 窄文法，代码常量、零用户输入拼接）：
 * - 月度支出：v_monthly_summary 近 12 月。白名单禁止日期函数与算术，
 *   日期窗口无法在 SQL 内表达，用 ORDER BY month DESC + LIMIT 12 取最近 12 行，
 *   JS 侧回排升序；
 * - 分类支出：v_category_monthly 按（类目 × 月）聚合，ORDER BY month DESC + LIMIT 48
 *   （12 类 × 4 月 = 48 行，50 行结果上限内），JS 侧截最近 3 个自然月（≈90 天）
 *   后按类目求和。
 * 列按位置读取（SELECT 列表顺序即 Object.values 顺序，与管线引擎 spec.ts 同口径；
 * 白名单文法不支持 AS 别名，聚合列名为 DuckDB 默认名）。
 */
const SQL_MONTHLY_LAST_12M =
  "SELECT month, SUM(expense_cents) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 12";

const SQL_CATEGORY_MONTHLY_RECENT =
  "SELECT category, month, SUM(expense_cents) FROM v_category_monthly GROUP BY category, month ORDER BY month DESC LIMIT 48";

/** 分类支出窗口：最近 3 个自然月（≈90 天；白名单语法内可达的最近似口径） */
const CATEGORY_WINDOW_MONTHS = 3;
/** 预测历史长度：近 6 月真实支出 */
const FORECAST_HISTORY_MONTHS = 6;
/** 预测外推长度：未来 3 月（与 DEMO_FORECAST 长度一致） */
const FORECAST_HORIZON_MONTHS = 3;

/** 真实月度支出行（v_monthly_summary 聚合结果） */
interface RealMonthRow {
  /** YYYY-MM（本地时区，与 date_iso 的月份语义对齐） */
  monthKey: string;
  expenseCents: number;
}

/** 真实数据装载结果：null = 该模块查询失败或无数据，页面回退 demo 对应字段 */
interface RealBudgetData {
  /** 近 12 月月度支出（升序） */
  monthly: RealMonthRow[] | null;
  /** 类目 → 近 90 天支出（分） */
  category90d: Record<string, number> | null;
  /** 90 天窗口实际覆盖的自然月数（数据不足 3 个月时按实际月数折算月均） */
  categoryWindowMonths: number;
}

const EMPTY_REAL_DATA: RealBudgetData = {
  monthly: null,
  category90d: null,
  categoryWindowMonths: CATEGORY_WINDOW_MONTHS,
};

/** 预测序列：demo 与真实两条动线共用形状 */
interface ForecastView {
  months: string[]; // YYYY-MM
  valuesCents: number[];
  /** 是否来自真实数据外推（决定文案与免责声明口径） */
  real: boolean;
  /** 参与拟合的历史月数（demo 为 0） */
  historyMonths: number;
  /** 线性趋势斜率：分/月（demo 为 0） */
  slopeCentsPerMonth: number;
}

/** 选中月份的预算视图（真实与 demo 动线共用渲染形状） */
interface MonthBudgetView {
  categories: Array<{ category: string; budgetCents: number; actualCents: number }>;
  totalBudgetCents: number;
  totalActualCents: number;
}

/** DuckDB 聚合金额 → 分：BIGINT 在 wasm 各版本可能返回 bigint/number/string，统一收口 */
function rowCents(value: unknown): number {
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Math.round(Number(value) || 0);
  return 0;
}

/** DuckDB TIMESTAMP（JS Date 或字符串）→ YYYY-MM（本地口径，与管线 fmtMonth 一致） */
function monthKeyOf(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : typeof value === "string"
          ? new Date(value)
          : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → 本地月初 Date；非法输入返回 null */
function parseMonthKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

/** 月份键平移 offset 个月（跨年自动进位），解析失败时原样返回 */
function shiftMonthKey(key: string, offset: number): string {
  const base = parseMonthKey(key);
  if (!base) return key;
  return monthKeyOf(new Date(base.getFullYear(), base.getMonth() + offset, 1));
}

/**
 * 近 6 月真实支出 → 未来 3 月线性趋势外推（确定性算法，替代 DEMO_FORECAST 固定系数）。
 * 口径：x = 月序号（0..n-1），y = 月支出（分），最小二乘拟合 y = a + b·x，
 * 外推 y(x_last + k)，k = 1..3。边界：
 * - 历史不足 2 个月：b = 0，退化为近期均值（recent_mean）；
 * - 外推值为负：截断为 0（支出不可能为负，防线性趋势退化）；
 * - 历史为空（查询失败）：返回 null，由调用方兜底 DEMO_FORECAST。
 */
function extrapolateForecast(history: RealMonthRow[]): ForecastView | null {
  const base = history.slice(-FORECAST_HISTORY_MONTHS);
  if (base.length === 0) return null;
  const n = base.length;
  const meanX = (n - 1) / 2;
  const meanY = base.reduce((sum, row) => sum + row.expenseCents, 0) / n;
  let denominator = 0;
  let numerator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    denominator += dx * dx;
    numerator += dx * ((base[i]?.expenseCents ?? 0) - meanY);
  }
  const slope = denominator > 0 ? numerator / denominator : 0;
  const lastKey = base[n - 1]?.monthKey ?? "";
  const months: string[] = [];
  const valuesCents: number[] = [];
  for (let k = 1; k <= FORECAST_HORIZON_MONTHS; k += 1) {
    const predicted = meanY + slope * (n - 1 - meanX + k);
    months.push(shiftMonthKey(lastKey, k));
    valuesCents.push(Math.max(0, Math.round(predicted)));
  }
  return {
    months,
    valuesCents,
    real: true,
    historyMonths: n,
    slopeCentsPerMonth: Math.round(slope),
  };
}

/**
 * 真实动线分类行组装（分类预算覆盖模块口径）：
 * - 已用 actualCents = 近 90 天支出 ÷ 窗口自然月数（「本月支出速率」的月均估计；
 *   不用残缺当月行、不用 90 天总额——页面预算单位是「每月」，总额会与月预算错口径）；
 * - 预算 budgetCents = 本地覆盖 ?? DEMO_BUDGET 同类目默认 ?? 月均基线（向上取整到元）。
 *   预算本身暂无真实数据源（budgets 表本轮无写入方），演示默认档延续为可编辑起点，
 *   用户编辑经 overrides 持久化覆盖（07 §17 允许项）；
 * - 类目集合 = 近 90 天有支出的类目 ∪ 用户已设覆盖的类目（预算覆盖口径）；
 * - 各分类预算占比 = budgetCents / 总预算；覆盖值 = 已用 / 预算（使用率），渲染层计算。
 */
function buildRealCategories(
  category90d: Record<string, number>,
  windowMonths: number,
  overrides: Record<string, number>,
): MonthBudgetView["categories"] {
  const demoBudget = new Map(DEMO_BUDGET.categories.map((c) => [c.category, c.budgetCents]));
  const names = new Set([...Object.keys(category90d), ...Object.keys(overrides)]);
  const divisor = Math.max(windowMonths, 1);
  return [...names]
    .map((category) => {
      const monthlyAvg = Math.round((category90d[category] ?? 0) / divisor);
      const baseline = Math.ceil(monthlyAvg / 100) * 100;
      return {
        category,
        budgetCents: overrides[category] ?? demoBudget.get(category) ?? baseline,
        actualCents: monthlyAvg,
      };
    })
    .filter((row) => row.actualCents > 0 || row.budgetCents > 0);
}

/* —— 超支贴士（budget-advice 任务） —— */

type AdviceAction = MockBudgetAdvice["actions"][number];

/** 超支贴士生成态：budget-advice 任务（真实动线专用；demo 动线维持模板文案） */
interface AdviceState {
  status: "loading" | "streaming" | "done";
  headline: string;
  advice: string;
  actions: AdviceAction[];
}

/**
 * live 流式文本无结构化字段：headline 用阈值规则句（与 mock 同口径），
 * actions 按 severity 推导（ok 无动作 / warn 看明细 / over 调预算+看明细）。
 */
function actionsForSeverity(severity: Severity): AdviceAction[] {
  if (severity === "ok") return [];
  if (severity === "warn") return ["view_detail"];
  return ["adjust_budget", "view_detail"];
}

/**
 * live 流式提示词（确定性拼装，数字全部来自当前页面聚合数据）：
 * 不携带明细行与身份信息（02 §1.2 脱敏口径），金额展示层转元与模型交互。
 */
function buildAdvicePrompt(view: MonthBudgetView, ratio: number): string {
  const lines = view.categories
    .filter((c) => c.budgetCents > 0)
    .map(
      (c) =>
        `${c.category}：已用 ¥${fmtYuan(c.actualCents, 0)} / 预算 ¥${fmtYuan(c.budgetCents, 0)}（${fmtPct(c.actualCents, c.budgetCents)}%）`,
    );
  return [
    "以下是本月预算执行数据（金额单位：元）。",
    `总预算 ¥${fmtYuan(view.totalBudgetCents, 0)}，已用 ¥${fmtYuan(view.totalActualCents, 0)}，使用率 ${Math.round(ratio * 100)}%。`,
    ...lines,
    "请基于以上数字给出简洁的中文预算建议，只给方向性建议，不虚构输入之外的数字。",
  ].join("\n");
}

/* —— 子组件 —— */

interface ToastState {
  id: number;
  text: string;
  kind: "ok" | "error";
}

function ToastView({ toast }: { toast: ToastState }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      exit={{ opacity: 0, y: 6, x: "-50%" }}
      className="fixed bottom-20 left-1/2 z-[60] md:bottom-8"
      role="status"
    >
      <div className="flex items-center gap-2 rounded-full border border-(--color-border) bg-(--color-surface) px-4 py-2.5 shadow-(--shadow-lg)">
        {toast.kind === "ok" ? (
          <CheckCircle2 className="size-4 shrink-0 text-(--color-good)" aria-hidden />
        ) : (
          <AlertCircle className="size-4 shrink-0 text-(--color-critical)" aria-hidden />
        )}
        <span className="text-sm font-medium text-(--color-ink)">{toast.text}</span>
      </div>
    </motion.div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "critical" }) {
  return (
    <div className="rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) px-3 py-3">
      <p className="text-xs text-(--color-ink-muted)">{label}</p>
      <p
        className={`mt-1 truncate text-lg font-semibold tabular-nums ${
          tone === "critical" ? "text-(--color-critical-ink)" : "text-(--color-ink)"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

interface BudgetEditModalProps {
  category: string;
  budgetCents: number;
  onSave: (cents: number) => void;
  onClose: () => void;
}

function BudgetEditModal({ category, budgetCents, onSave, onClose }: BudgetEditModalProps) {
  const [prevBudget, setPrevBudget] = useState(budgetCents);
  const [amount, setAmount] = useState(formatAmountInput(budgetCents));
  const [error, setError] = useState("");

  // 预算值变化（父级覆盖值刷新）时重置输入：渲染期按条件调整状态，
  // 是 React 官方支持的 props → state 同步方式，不产生级联渲染
  if (prevBudget !== budgetCents) {
    setPrevBudget(budgetCents);
    setAmount(formatAmountInput(budgetCents));
    setError("");
  }

  // Esc 关闭 + 打开时聚焦金额输入：弹层基本键盘可达性
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    const yuan = Number(amount);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      setError("金额需要大于 0");
      return;
    }
    onSave(Math.round(yuan * 100));
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: "spring", duration: 0.35, bounce: 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-label={`调整「${category}」预算`}
        className="w-full max-w-sm rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-lg)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-(--color-ink)">调整「{category}」预算</h2>
            <p className="mt-1 text-xs text-(--color-ink-muted)">每月预算（元）</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid size-8 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2)"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) px-3 focus-within:border-(--color-primary)">
            <span className="text-sm text-(--color-ink-muted)">¥</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              autoFocus
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError("");
              }}
              className="h-11 w-full bg-transparent text-base font-medium tabular-nums outline-none"
              aria-label="每月预算金额（元）"
            />
          </div>
          {error ? <p className="mt-1.5 text-xs text-(--color-critical-ink)">{error}</p> : null}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-(--color-ink-muted)">
          改完对本月和接下来两个月生效，之前的月份不能改。
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2)"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="h-10 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
          >
            保存
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* —— 页面主体 —— */

function BudgetContent() {
  const [monthOffset, setMonthOffset] = useState(0);
  // 本地持久化值用惰性初始化读取：AuthGuard 在水合完成前只渲染加载态，
  // 本组件仅在客户端挂载，首读 localStorage 不会造成 SSR 水合不一致
  const [overrides, setOverrides] = useState<Record<string, number>>(() =>
    loadJson<Record<string, number>>(KEY_BUDGET, {}),
  );
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [adviceDismissed, setAdviceDismissed] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // 快速记账
  const [entryText, setEntryText] = useState("");
  const [draft, setDraft] = useState<QuickDraft | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<ManualEntry | null>(null);
  const [entries, setEntries] = useState<ManualEntry[]>(() => {
    const list = loadJson<unknown>(KEY_MANUAL, []);
    return Array.isArray(list) ? (list as ManualEntry[]) : [];
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    setToast({ id: Date.now(), text, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  // —— 真实数据动线（波 4：真实优先 + demo 兜底） ——
  // 最近一次体检运行结果（内存态）：null = 尚无体检记录（含刷新后内存丢失），
  // 整页维持 DEMO_BUDGET / DEMO_FORECAST 动线不动
  const lastRun = usePipeline((s) => s.lastRun);
  const [realData, setRealData] = useState<RealBudgetData>(EMPTY_REAL_DATA);
  // demo 动线（无体检记录）时忽略残留装载结果：渲染期派生，避免在 effect 内同步 setState 重置
  const liveRealData = lastRun ? realData : EMPTY_REAL_DATA;

  // 真实数据装载：lastRun 存在时读 DuckDB 聚合视图（与体检同一单例连接、同一内存数据集）。
  // 任一模块查询失败 → 该模块保持 null → 对应模块兜底 DEMO_BUDGET / DEMO_FORECAST（模块级降级）
  useEffect(() => {
    if (!lastRun) return; // demo 动线：不查库
    let cancelled = false;
    void (async () => {
      const loaded: RealBudgetData = { ...EMPTY_REAL_DATA };
      try {
        // 数据集在本次会话内由体检管线装入内存库（sample 自动 initDataset，
        // upload 由上传页完成），这里只做只读聚合；连接初始化失败 → 两模块兜底 demo
        const conn = await getDuckDB();
        try {
          const result = await runWhitelistedAggregate(conn, SQL_MONTHLY_LAST_12M);
          const rows = (result.rows as Record<string, unknown>[])
            .map((row) => {
              const values = Object.values(row);
              return { monthKey: monthKeyOf(values[0]), expenseCents: rowCents(values[1]) };
            })
            .filter((row) => row.monthKey !== "")
            .reverse(); // SQL 侧 month DESC → 升序
          if (rows.length > 0) loaded.monthly = rows;
        } catch {
          // 月度查询失败 → monthly 保持 null，预测模块兜底 DEMO_FORECAST
        }
        try {
          const result = await runWhitelistedAggregate(conn, SQL_CATEGORY_MONTHLY_RECENT);
          const rows = (result.rows as Record<string, unknown>[])
            .map((row) => {
              const values = Object.values(row);
              return {
                category: String(values[0] ?? ""),
                monthKey: monthKeyOf(values[1]),
                expenseCents: rowCents(values[2]),
              };
            })
            .filter((row) => row.category !== "" && row.monthKey !== "");
          // JS 侧截最近 3 个自然月（≈90 天）并按类目求和；数据不足 3 个月按实际月数
          const windowKeys: string[] = [];
          const byCategory: Record<string, number> = {};
          for (const row of rows) {
            if (!windowKeys.includes(row.monthKey)) {
              if (windowKeys.length < CATEGORY_WINDOW_MONTHS) {
                windowKeys.push(row.monthKey);
              } else {
                continue; // 更早的月份（month DESC 序）落在窗口外
              }
            }
            byCategory[row.category] = (byCategory[row.category] ?? 0) + row.expenseCents;
          }
          if (windowKeys.length > 0 && Object.values(byCategory).some((v) => v > 0)) {
            loaded.category90d = byCategory;
            loaded.categoryWindowMonths = windowKeys.length;
          }
        } catch {
          // 分类查询失败 → category90d 保持 null，分类预算模块兜底 DEMO_BUDGET
        }
      } catch {
        // getDuckDB 初始化失败：双模块兜底 demo，页面照常可用
      }
      if (!cancelled) setRealData(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 选中月份的分类数据：真实动线用近 90 天月均支出（预算 = 覆盖 ?? 演示默认 ?? 月均基线），
  // demo 动线用 DEMO_BUDGET；未来月实际值按系数外推（两条动线同规则），预算叠加本地覆盖值
  const month = useMemo<MonthBudgetView>(() => {
    const factor = MONTH_FACTORS[monthOffset] ?? 1;
    const source = liveRealData.category90d
      ? buildRealCategories(liveRealData.category90d, liveRealData.categoryWindowMonths, overrides)
      : DEMO_BUDGET.categories.map((c) => ({
          category: c.category,
          budgetCents: overrides[c.category] ?? c.budgetCents,
          actualCents: c.actualCents,
        }));
    const categories = source.map((c) => ({
      category: c.category,
      budgetCents: c.budgetCents,
      actualCents: Math.round(c.actualCents * factor),
    }));
    const totalBudgetCents = categories.reduce((sum, c) => sum + c.budgetCents, 0);
    const totalActualCents = categories.reduce((sum, c) => sum + c.actualCents, 0);
    // 超支类目置顶，其余按使用率降序
    const sorted = [...categories].sort((a, b) => {
      const ratioA = a.budgetCents > 0 ? a.actualCents / a.budgetCents : 0;
      const ratioB = b.budgetCents > 0 ? b.actualCents / b.budgetCents : 0;
      const overA = a.actualCents > a.budgetCents;
      const overB = b.actualCents > b.budgetCents;
      if (overA !== overB) return overA ? -1 : 1;
      return ratioB - ratioA;
    });
    return { categories: sorted, totalBudgetCents, totalActualCents };
  }, [monthOffset, overrides, liveRealData]);

  // 下月预测：真实动线用近 6 月真实支出线性趋势外推，demo 动线用 DEMO_FORECAST 固定外推
  const forecastView = useMemo<ForecastView>(() => {
    if (liveRealData.monthly) {
      const real = extrapolateForecast(liveRealData.monthly);
      if (real) return real;
    }
    return {
      months: [...DEMO_FORECAST.months],
      valuesCents: [...DEMO_FORECAST.valuesCents],
      real: false,
      historyMonths: 0,
      slopeCentsPerMonth: 0,
    };
  }, [liveRealData]);

  const ratio = month.totalBudgetCents > 0 ? month.totalActualCents / month.totalBudgetCents : 0;
  const severity = severityOf(ratio);
  const remainingCents = month.totalBudgetCents - month.totalActualCents;
  const monthLabels = useMemo(() => {
    const now = new Date();
    return MONTH_FACTORS.map((_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return `${d.getMonth() + 1}月`;
    });
  }, []);

  // 本月手动记账笔数（本地账本口径）
  const monthEntryCount = useMemo(() => {
    const prefix = toDateInput(new Date()).slice(0, 7);
    return entries.filter((e) => e.ts.startsWith(prefix)).length;
  }, [entries]);

  // 最近手动记账（倒序 5 条）：入账后列表即时更新，每笔的去向一目了然
  const recentEntries = useMemo(
    () =>
      [...entries]
        .sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? 1 : -1) : a.ts < b.ts ? 1 : -1))
        .slice(0, 5),
    [entries],
  );

  // 当前展示月份的手动记账汇总：与体检账单分开统计，避免两个口径混淆
  const shownMonthManual = useMemo(() => {
    const base = new Date();
    const d = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthEntries = entries.filter((e) => e.ts.startsWith(key));
    const incomeCents = monthEntries
      .filter((e) => e.direction === "income")
      .reduce((sum, e) => sum + e.amountCents, 0);
    const expenseCents = monthEntries
      .filter((e) => e.direction === "expense")
      .reduce((sum, e) => sum + e.amountCents, 0);
    return { count: monthEntries.length, incomeCents, expenseCents };
  }, [entries, monthOffset]);

  function handleParse(text: string = entryText) {
    setParseError(null);
    setLastSaved(null);
    const outcome = draftFromRule(text, toDateInput(new Date()));
    if (!outcome.ok) {
      setParseError(outcome.reason);
      return;
    }
    setDraft(outcome.draft);
  }

  function handleConfirmSave() {
    if (!draft) return;
    const yuan = Number(draft.amount);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      showToast("金额需要大于 0", "error");
      return;
    }
    const amountCents = Math.round(yuan * 100);
    if (amountCents > 1e9) {
      showToast("金额超出可记录范围", "error");
      return;
    }
    const entry: ManualEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: draft.date,
      direction: draft.direction,
      category: draft.category,
      amountCents,
      note: draft.note.slice(0, 60),
    };
    const next = [...entries, entry];
    setEntries(next);
    saveJson(KEY_MANUAL, next);
    // 入账反馈：绿色横幅 + 下方「最近记账」列表即时出现这笔（替代一闪而过的 toast）
    setLastSaved(entry);
    setDraft(null);
    setEntryText("");
    inputRef.current?.focus();
  }

  function handleDeleteEntry(id: string) {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveJson(KEY_MANUAL, next);
    if (lastSaved?.id === id) setLastSaved(null);
  }

  function handleSaveBudget(category: string, cents: number) {
    const next = { ...overrides, [category]: cents };
    setOverrides(next);
    saveJson(KEY_BUDGET, next);
    setEditTarget(null);
    showToast("预算已更新");
  }

  // 预算环：环形进度 + 中心数值（超支时环满格以状态色警示）
  const ringOption = useCallback((): ECOption => {
    const used = Math.min(Math.max(ratio, 0), 1) * 100;
    const remain = Math.max(100 - used, 0);
    const ringColor = cssVar(SEVERITY_META[severity].cssVarName, cssVar("--color-primary"));
    const trackColor = cssVar("--color-surface-2", "#eef0f4");
    return {
      series: [
        {
          type: "pie",
          radius: ["72%", "90%"],
          startAngle: 90,
          silent: true,
          label: { show: false },
          emphasis: { scale: false },
          data: [
            { value: used, itemStyle: { color: ringColor } },
            { value: remain, itemStyle: { color: trackColor } },
          ],
        },
      ],
    };
  }, [ratio, severity]);

  // 预算与实际对比：两组柱 + 图例（≥2 系列必配图例），数值轴为元
  const barOption = useCallback((): ECOption => {
    const t = chartInk();
    const budgetColor = cssVar("--color-chart-1");
    const actualColor = cssVar("--color-chart-2");
    return {
      grid: { left: 8, right: 8, top: 40, bottom: 0, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 16,
        textStyle: { color: t.inkSecondary, fontSize: 12 },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(128,128,128,0.08)" } },
        backgroundColor: t.surface,
        borderColor: t.line,
        textStyle: { color: t.ink },
        valueFormatter: (v) => `¥${Number(v).toFixed(2)}`,
      },
      xAxis: {
        type: "category",
        data: month.categories.map((c) => c.category),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: t.line } },
        axisLabel: { color: t.inkSecondary, fontSize: 12 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.inkMuted, formatter: "¥{value}" },
        splitLine: { lineStyle: { color: t.line } },
      },
      series: [
        {
          name: "预算",
          type: "bar",
          data: month.categories.map((c) => c.budgetCents / 100),
          barWidth: 12,
          itemStyle: { color: budgetColor, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "实际",
          type: "bar",
          data: month.categories.map((c) => c.actualCents / 100),
          barWidth: 12,
          itemStyle: { color: actualColor, borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [month]);

  // 下月预测：单系列折线（标题即系列名，不加图例），y 轴缩放起点避免形状失真；
  // 数据源为 forecastView（真实外推或 DEMO_FORECAST），其余渲染规则不变
  const forecastOption = useCallback((): ECOption => {
    const t = chartInk();
    const lineColor = cssVar("--color-chart-1");
    const labels = forecastView.months.map((mStr) => `${Number(mStr.split("-")[1] ?? "")}月`);
    return {
      grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: t.surface,
        borderColor: t.line,
        textStyle: { color: t.ink },
        valueFormatter: (v) => `¥${Number(v).toFixed(2)}`,
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: t.line } },
        axisLabel: { color: t.inkMuted },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: t.inkMuted, formatter: "¥{value}" },
        splitLine: { lineStyle: { color: t.line } },
      },
      series: [
        {
          name: "预测月支出",
          type: "line",
          data: forecastView.valuesCents.map((c) => c / 100),
          smooth: true,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 2, color: lineColor },
          itemStyle: { color: lineColor, borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: lineColor, opacity: 0.12 },
        },
      ],
    };
  }, [forecastView]);

  const forecastAvgYuan = Math.round(
    forecastView.valuesCents.reduce((sum, v) => sum + v, 0) /
      Math.max(forecastView.valuesCents.length, 1) /
      100,
  );

  // 超支贴士：demo 动线用模板文案（数字按当前数据实时计算）；真实动线接 budget-advice
  // 任务生成（先 /api/ai/task 模板 JSON，live 模式转 /api/ai/chat 流式，本地模板兜底）
  const dining = month.categories.find((c) => c.category === "餐饮");
  const diningPct = dining ? fmtPct(dining.actualCents, dining.budgetCents) : 0;
  const adviceVisible = severity === "over" && !adviceDismissed;
  // 贴士生成结果按「生成键」缓存：月份或数据视图变化即失效（渲染期派生），
  // 避免在 effect 内同步 setState 重置旧贴士，也避免切换月份时闪旧文案
  const [adviceRun, setAdviceRun] = useState<{ key: string; state: AdviceState } | null>(null);
  const adviceKey = `${monthOffset}:${month.totalActualCents}:${month.totalBudgetCents}`;
  const advice = adviceRun && adviceRun.key === adviceKey && adviceVisible ? adviceRun.state : null;

  // 贴士「调整预算」按钮目标：当前视图超支金额最大的类目（缺省餐饮）
  const adviceTargetCategory = useMemo(() => {
    let target = "餐饮";
    let maxOver = Number.NEGATIVE_INFINITY;
    for (const c of month.categories) {
      const over = c.actualCents - c.budgetCents;
      if (over > maxOver) {
        maxOver = over;
        target = c.category;
      }
    }
    return target;
  }, [month]);

  // 贴士生成链：demo 动线不生成；真实动线贴士可见时执行。
  // 链路口径：resolveLlmMode 的判定由两个 route 在服务端完成——
  // ① POST /api/ai/task（08 §⑦ 唯一承载端点）：mock → mockBudgetAdvice(ratio) JSON 同步返回，
  //    live → 结构化输出 T49 未接入返回 501，转流式；
  // ② POST /api/ai/chat：live 走 streamLlmText，text/plain 原始流逐 chunk 解码追加；
  // ③ 网络硬故障 → 本地同步 mockBudgetAdvice(ratio)（mock-narratives 纯函数客户端安全；
  //    无密钥场景服务端 resolveLlmMode 已判 mock，不会走到这里）
  useEffect(() => {
    if (!adviceVisible || !lastRun) return; // demo 动线：模板文案维持现状
    const controller = new AbortController();
    let active = true;

    const finishLocal = () => {
      if (!active) return;
      const local = mockBudgetAdvice(ratio);
      setAdviceRun({
        key: adviceKey,
        state: {
          status: "done",
          headline: local.headline,
          advice: local.advice,
          actions: local.actions,
        },
      });
    };

    void (async () => {
      setAdviceRun({
        key: adviceKey,
        state: {
          status: "loading",
          headline: "正在生成建议…",
          advice: "",
          actions: [],
        },
      });
      try {
        const taskRes = await fetch("/api/ai/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: "budget-advice", input: { ratio } }),
          signal: controller.signal,
        });
        if (taskRes.ok) {
          const payload = (await taskRes.json()) as {
            ok?: boolean;
            data?: Partial<MockBudgetAdvice>;
          };
          const data = payload?.data;
          if (data && typeof data.headline === "string" && typeof data.advice === "string") {
            if (!active) return;
            setAdviceRun({
              key: adviceKey,
              state: {
                status: "done",
                headline: data.headline,
                advice: data.advice,
                actions: Array.isArray(data.actions)
                  ? data.actions.filter(
                      (a): a is AdviceAction =>
                        a === "adjust_budget" || a === "view_detail" || a === "dismiss",
                    )
                  : [],
              },
            });
            return;
          }
        }
        // live 流式：逐 chunk 解码追加到贴士文本（真实 token 流，非定时器动画）
        const chatRes = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: "budget-advice",
            messages: [{ role: "user", content: buildAdvicePrompt(month, ratio) }],
          }),
          signal: controller.signal,
        });
        if (!chatRes.ok || !chatRes.body) throw new Error("预算建议流不可用");
        if (!active) return;
        setAdviceRun({
          key: adviceKey,
          state: {
            status: "streaming",
            headline: mockBudgetAdvice(ratio).headline,
            advice: "",
            actions: actionsForSeverity(severity),
          },
        });
        const reader = chatRes.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          if (!active) return;
          setAdviceRun((prev) =>
            prev && prev.key === adviceKey && prev.state.status === "streaming"
              ? { key: adviceKey, state: { ...prev.state, advice: accumulated } }
              : prev,
          );
        }
        if (!active) return;
        setAdviceRun((prev) =>
          prev && prev.key === adviceKey && prev.state.status === "streaming"
            ? { key: adviceKey, state: { ...prev.state, status: "done" } }
            : prev,
        );
      } catch {
        finishLocal();
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [adviceVisible, lastRun, month, ratio, severity, adviceKey]);

  return (
    <Container wide className="py-8 md:py-10">
      {/* 页头 */}
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-(--color-ink) md:text-3xl">预算中心</h1>
          {/* 数据源徽标：诚实标注真实/演示动线（05 §5.1 不放假数据），真实动线在本次会话内跟随体检结果 */}
          <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[11px] text-(--color-ink-muted)">
            {lastRun
              ? `真实数据 · ${lastRun.source === "sample" ? "示例账单" : "上传账单"}`
              : "演示数据"}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-ink-secondary)">
          在这里定每月预算、一句话记账、看超支提醒和下月走势。所有数据只保存在你自己的浏览器里，别人看不到。
        </p>
      </header>

      <div className="space-y-6">
        {/* 快速记账（/budget#quick 锚点，scroll-mt 避开 sticky 顶栏） */}
        <section id="quick" aria-label="快速记账" className="scroll-mt-24">
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold text-(--color-ink)">
                <Zap className="size-4.5 text-(--color-primary)" aria-hidden />
                快速记账
              </h2>
              <span className="text-xs text-(--color-ink-muted)">一句话记一笔，金额、类别和日期会自动识别，记完就出现在下方「最近记账」里</span>
            </div>

            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleParse();
              }}
            >
              <input
                ref={inputRef}
                value={entryText}
                onChange={(e) => {
                  setEntryText(e.target.value);
                  if (parseError) setParseError(null);
                  if (lastSaved) setLastSaved(null);
                }}
                maxLength={200}
                placeholder="例如「中午食堂花了 15」「兼职赚了 200」"
                aria-label="记账内容"
                className="h-11 min-w-0 flex-1 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) px-3.5 text-sm text-(--color-ink) outline-none transition-colors placeholder:text-(--color-ink-muted) focus:border-(--color-primary)"
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-(--radius-md) bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
              >
                识别
              </button>
            </form>

            {/* 常用例子点一下即带入解析，零学习成本 */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-(--color-ink-muted)">试试：</span>
              {QUICK_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setEntryText(example);
                    handleParse(example);
                  }}
                  className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary) transition-colors hover:border-(--color-primary) hover:text-(--color-primary)"
                >
                  {example}
                </button>
              ))}
            </div>

            {/* 解析失败的原因直接显示在输入框下方，不再是一闪而过的提示 */}
            {parseError ? (
              <p
                className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-(--color-critical-ink)"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {parseError}
              </p>
            ) : null}

            <AnimatePresence>
              {draft ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-(--color-ink)">确认这笔账</h3>
                      <button
                        type="button"
                        onClick={() => setDraft(null)}
                        aria-label="关闭确认卡"
                        className="grid size-8 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2)"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-(--color-ink-muted)">识别结果可以直接改，确认后这笔账就算记上了</p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs text-(--color-ink-secondary)">金额（元）</span>
                        <div className="mt-1 flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 focus-within:border-(--color-primary)">
                          <span className="text-sm text-(--color-ink-muted)">¥</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0.01"
                            value={draft.amount}
                            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                            className="w-full bg-transparent text-sm tabular-nums outline-none"
                            aria-label="金额（元）"
                          />
                        </div>
                      </label>

                      <div>
                        <span className="text-xs text-(--color-ink-secondary)">方向</span>
                        <div className="mt-1 flex h-11 rounded-(--radius-md) bg-(--color-surface-2) p-1" role="radiogroup" aria-label="收支方向">
                          {(["expense", "income"] as const).map((d) => (
                            <button
                              key={d}
                              type="button"
                              role="radio"
                              aria-checked={draft.direction === d}
                              onClick={() => setDraft({ ...draft, direction: d })}
                              className={`flex-1 rounded-[6px] text-sm font-medium transition-colors ${
                                draft.direction === d
                                  ? "bg-(--color-surface) text-(--color-ink) shadow-(--shadow-sm)"
                                  : "text-(--color-ink-muted) hover:text-(--color-ink-secondary)"
                              }`}
                            >
                              {d === "expense" ? "支出" : "收入"}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="block">
                        <span className="text-xs text-(--color-ink-secondary)">类别</span>
                        <select
                          value={draft.category}
                          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                          className="mt-1 h-11 w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-ink) outline-none focus:border-(--color-primary)"
                          aria-label="类别"
                        >
                          {CATEGORIES_12.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="text-xs text-(--color-ink-secondary)">日期</span>
                        <input
                          type="date"
                          value={draft.date}
                          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                          className="mt-1 h-11 w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-ink) outline-none focus:border-(--color-primary)"
                          aria-label="日期"
                        />
                      </label>

                      <label className="block sm:col-span-2">
                        <span className="text-xs text-(--color-ink-secondary)">备注</span>
                        <input
                          type="text"
                          value={draft.note}
                          maxLength={60}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                          className="mt-1 h-11 w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-ink) outline-none focus:border-(--color-primary)"
                          aria-label="备注"
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDraft(null)}
                        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2)"
                      >
                        <ArrowLeft className="size-4" aria-hidden />
                        修改
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmSave}
                        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
                      >
                        <Check className="size-4" aria-hidden />
                        确认入账
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* 入账成功横幅：说明这笔记到了哪里（日期、收支、金额、类别） */}
            <AnimatePresence>
              {lastSaved ? (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 flex items-start gap-2 rounded-(--radius-md) border border-(--color-good)/40 bg-(--color-good)/10 px-3 py-2.5"
                  role="status"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-(--color-good-ink)" aria-hidden />
                  <p className="text-sm text-(--color-ink)">
                    已记一笔：{fmtDateCN(lastSaved.ts)} ·{" "}
                    <span className={lastSaved.direction === "income" ? "text-(--color-good-ink)" : ""}>
                      {lastSaved.direction === "income" ? "收入" : "支出"} ¥{fmtYuan(lastSaved.amountCents)}
                    </span>{" "}
                    · {lastSaved.category} · {lastSaved.note}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* 最近记账列表：每笔的去向都落在这里，可单笔删除 */}
            <div className="mt-4 border-t border-(--color-border) pt-3">
              <p className="flex items-baseline justify-between gap-2 text-xs text-(--color-ink-muted)">
                <span>
                  最近记账 · 本月已记{" "}
                  <span className="font-semibold tabular-nums text-(--color-ink-secondary)">{monthEntryCount}</span>{" "}
                  笔
                </span>
                <span>仅保存在这台设备的浏览器里</span>
              </p>
              {recentEntries.length > 0 ? (
                <ul className="mt-2 divide-y divide-(--color-border)">
                  {recentEntries.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-2">
                      <span className="w-16 shrink-0 text-xs tabular-nums text-(--color-ink-muted)">
                        {fmtDateCN(entry.ts)}
                      </span>
                      <span
                        className={`w-20 shrink-0 text-sm font-medium tabular-nums ${
                          entry.direction === "income" ? "text-(--color-good-ink)" : "text-(--color-ink)"
                        }`}
                      >
                        {entry.direction === "income" ? "+" : "-"}¥{fmtYuan(entry.amountCents)}
                      </span>
                      <span className="shrink-0 rounded-full bg-(--color-surface-2) px-2 py-0.5 text-xs text-(--color-ink-secondary)">
                        {entry.category}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-(--color-ink-muted)">{entry.note}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteEntry(entry.id)}
                        aria-label={`删除这笔：${entry.note || entry.category} ${fmtYuan(entry.amountCents)} 元`}
                        className="grid size-7 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-critical)/10 hover:text-(--color-critical-ink)"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 rounded-(--radius-md) bg-(--color-surface-page) px-3 py-3 text-xs text-(--color-ink-muted)">
                  还没有手动记的账——在上面说一句话记一笔，比如「中午食堂花了 15」。
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 本月总览 + 下月预测 */}
        <div className="grid gap-6 lg:grid-cols-5">
          <section aria-label="本月总览" className="lg:col-span-3">
            <div className="h-full rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold text-(--color-ink)">本月总览</h2>
                <div className="flex rounded-full bg-(--color-surface-2) p-1" role="group" aria-label="月份切换">
                  {(["本月", "下月", "再下月"] as const).map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={monthOffset === i}
                      onClick={() => setMonthOffset(i)}
                      className={`h-8 rounded-full px-3 text-xs font-medium transition-colors ${
                        monthOffset === i
                          ? "bg-(--color-surface) text-(--color-ink) shadow-(--shadow-sm)"
                          : "text-(--color-ink-muted) hover:text-(--color-ink-secondary)"
                      }`}
                    >
                      {label}
                      <span className="ml-1 opacity-70">{monthLabels[i]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {monthOffset > 0 ? (
                <p className="mt-2 text-xs text-(--color-ink-muted)">
                  {lastRun
                    ? "下月数字根据最近 90 天的月均支出估算，每月按 9 折递减"
                    : "未来月份是示例估算，每月按 9 折递减"}
                </p>
              ) : null}

              <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
                <div className="relative size-44 shrink-0 sm:size-48">
                  <EChart
                    option={ringOption}
                    height={192}
                    className="size-full"
                    ariaLabel={`${monthLabels[monthOffset]}预算已用 ${(ratio * 100).toFixed(1)}%`}
                  />
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="text-center">
                      <p className="text-3xl font-bold tabular-nums text-(--color-ink)">
                        {(ratio * 100).toFixed(1)}%
                      </p>
                      <p className={`mt-1 text-sm font-medium ${SEVERITY_META[severity].textClass}`}>
                        {SEVERITY_META[severity].label}
                      </p>
                      <p className="mt-0.5 text-xs tabular-nums text-(--color-ink-muted)">
                        已用 ¥{fmtYuan(month.totalActualCents, 0)} / ¥{fmtYuan(month.totalBudgetCents, 0)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="w-full flex-1 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <StatTile label="已用" value={`¥${fmtYuan(month.totalActualCents, 0)}`} />
                    <StatTile label="预算" value={`¥${fmtYuan(month.totalBudgetCents, 0)}`} />
                    <StatTile
                      label={remainingCents >= 0 ? "剩余" : "超支"}
                      value={`¥${fmtYuan(Math.abs(remainingCents), 0)}`}
                      tone={remainingCents >= 0 ? undefined : "critical"}
                    />
                  </div>
                  <p className="text-xs text-(--color-ink-muted)">
                    {shownMonthManual.count > 0 ? (
                      <>
                        本月手动记账{" "}
                        <span className="font-semibold tabular-nums text-(--color-ink-secondary)">
                          {shownMonthManual.count}
                        </span>{" "}
                        笔（单独统计，不计入上方预算数字）：收入{" "}
                        <span className="tabular-nums text-(--color-good-ink)">
                          ¥{fmtYuan(shownMonthManual.incomeCents, 0)}
                        </span>{" "}
                        · 支出{" "}
                        <span className="tabular-nums text-(--color-ink-secondary)">
                          ¥{fmtYuan(shownMonthManual.expenseCents, 0)}
                        </span>{" "}
                        <a href="#quick" className="text-(--color-primary) hover:underline">
                          查看明细
                        </a>
                      </>
                    ) : (
                      <>
                        本月还没有手动记账，{" "}
                        <a href="#quick" className="text-(--color-primary) hover:underline">
                          去快速记账记一笔
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-sm leading-relaxed text-(--color-ink-secondary)">
                    {severity === "ok" && `预算执行健康，剩余 ¥${fmtYuan(remainingCents, 0)} 可灵活支配。`}
                    {severity === "warn" && `已接近本月预算上限，未来支出建议对照分类预算执行。`}
                    {severity === "over" && `已超出本月预算 ¥${fmtYuan(-remainingCents, 0)}，建议调整预算或控制支出。`}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section aria-label="下月预测" className="lg:col-span-2">
            <div className="flex h-full flex-col rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold text-(--color-ink)">
                  <TrendingUp className="size-4.5 text-(--color-primary)" aria-hidden />
                  下月预测
                </h2>
              </div>

              <EChart
                option={forecastOption}
                height={180}
                className="mt-3"
                ariaLabel="未来三个月支出预测折线图"
              />

              {forecastView.real ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">
                    根据你最近 {forecastView.historyMonths} 个月的实际支出走势估算：未来三个月月均支出约 ¥
                    {forecastAvgYuan.toLocaleString("zh-CN")}
                    {forecastView.slopeCentsPerMonth === 0
                      ? "，走势基本持平"
                      : `，预计每月${forecastView.slopeCentsPerMonth > 0 ? "多花" : "少花"} ¥${fmtYuan(Math.abs(forecastView.slopeCentsPerMonth), 0)}`}
                    。这个估算只延续过去的走势，临时的大额花销和你的计划没算进去。
                  </p>
                  <p className="mt-2 text-xs text-(--color-ink-muted)">自动估算，仅供参考</p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">
                    按季节规律估算：未来三个月月均支出约 ¥{forecastAvgYuan.toLocaleString("zh-CN")}
                    ，11 月受购物节影响略高、1 月回落。临时的大额花销没算进去。
                  </p>
                  <p className="mt-2 text-xs text-(--color-ink-muted)">自动估算，仅供参考</p>
                </>
              )}
            </div>
          </section>
        </div>

        {/* 分类预算网格 */}
        <section aria-label="分类预算">
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-sm)">
            <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3 sm:p-6 sm:pb-3">
              <h2 className="font-semibold text-(--color-ink)">分类预算</h2>
              <p className="text-xs text-(--color-ink-muted)">点击类别调整预算，保存后对本月至未来两月生效</p>
            </div>
            <div className="divide-y divide-(--color-border) px-2 pb-2 sm:px-3">
              {month.categories.map((c) => {
                const isOver = c.actualCents > c.budgetCents;
                const overCents = c.actualCents - c.budgetCents;
                const ratioC = c.budgetCents > 0 ? c.actualCents / c.budgetCents : 0;
                return (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => setEditTarget(c.category)}
                    className="group w-full rounded-(--radius-md) px-3 py-3.5 text-left transition-colors hover:bg-(--color-surface-page) sm:px-4"
                    aria-label={`调整${c.category}预算，已用 ${fmtPct(c.actualCents, c.budgetCents)}%`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-medium text-(--color-ink)">{c.category}</span>
                        {isOver ? (
                          <span className="shrink-0 rounded-full bg-(--color-critical)/10 px-2 py-0.5 text-[11px] font-semibold text-(--color-critical-ink)">
                            超支 ¥{fmtYuan(overCents, 0)}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
                        <span className="text-(--color-ink-muted)">已用 ¥{fmtYuan(c.actualCents, 0)}</span>
                        <span className={isOver ? "font-semibold text-(--color-critical-ink)" : "font-semibold text-(--color-ink)"}>
                          {isOver ? `超支 ¥${fmtYuan(overCents, 0)}` : `剩余 ¥${fmtYuan(c.budgetCents - c.actualCents, 0)}`}
                        </span>
                        <PencilLine
                          className="size-3.5 text-(--color-ink-muted) opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-(--color-surface-2)">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${Math.min(ratioC, 1) * 100}%`,
                          background: isOver
                            ? "linear-gradient(90deg, var(--color-critical), var(--color-serious))"
                            : gradientOf(c.category),
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs tabular-nums text-(--color-ink-muted)">
                      <span>预算 ¥{fmtYuan(c.budgetCents, 0)}</span>
                      <span>使用率 {fmtPct(c.actualCents, c.budgetCents)}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 超支贴士：demo 动线用示例文案；真实动线接 budget-advice 任务生成
            （模板 JSON / 流式逐字 / 本地兜底） */}
        <AnimatePresence>
          {adviceVisible ? (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              aria-label="超支贴士"
            >
              <div className="rounded-(--radius-lg) border border-(--color-critical)/25 bg-(--color-critical)/[0.04] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-semibold text-(--color-critical-ink)">
                    <AlertTriangle className="size-4.5" aria-hidden />
                    超支贴士
                  </h2>
                  {!lastRun || !advice || advice.status !== "done" ? (
                    <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[11px] text-(--color-ink-muted)">
                      {!lastRun ? "示例建议" : "正在生成建议…"}
                    </span>
                  ) : null}
                </div>
                {lastRun ? (
                  advice ? (
                    <>
                      <p className="mt-3 text-sm font-medium text-(--color-ink)">
                        {advice.status === "loading" ? "正在生成建议…" : advice.headline}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-(--color-ink)">
                        {advice.advice}
                        {advice.status === "streaming" ? "▍" : null}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {advice.actions.includes("adjust_budget") ? (
                          <button
                            type="button"
                            onClick={() => setEditTarget(adviceTargetCategory)}
                            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--color-primary-soft) px-4 text-sm font-medium text-(--color-brand-600) transition-colors hover:bg-(--color-primary-soft)/70 dark:text-(--color-brand-600)"
                          >
                            调整预算
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setAdviceDismissed(true)}
                          className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
                        >
                          忽略
                        </button>
                      </div>
                      <p className="mt-3 text-[11px] text-(--color-ink-muted)">
                        建议根据你本月的预算数据自动生成，数字都来自你的账单，请结合实际情况判断。
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-3 text-sm leading-relaxed text-(--color-ink)">正在生成建议…</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAdviceDismissed(true)}
                          className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
                        >
                          忽略
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <p className="mt-3 text-sm leading-relaxed text-(--color-ink)">
                      餐饮类已用 {diningPct}%，主要增量来自外卖。建议将外卖预算拆出单独上限，或启用周五自带餐计划
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditTarget("餐饮")}
                        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--color-primary-soft) px-4 text-sm font-medium text-(--color-brand-600) transition-colors hover:bg-(--color-primary-soft)/70 dark:text-(--color-brand-600)"
                      >
                        调整预算
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdviceDismissed(true)}
                        className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
                      >
                        忽略
                      </button>
                    </div>
                    <p className="mt-3 text-[11px] text-(--color-ink-muted)">
                      当前展示的是示例建议。上传账单完成体检后，这里会换成针对你的数据的建议。
                    </p>
                  </>
                )}
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {/* 预算与实际对比 */}
        <section aria-label="预算与实际对比">
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-(--color-ink)">预算与实际对比</h2>
              <div className="flex rounded-full bg-(--color-surface-2) p-1" role="group" aria-label="视图切换">
                <button
                  type="button"
                  aria-pressed={view === "chart"}
                  onClick={() => setView("chart")}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                    view === "chart" ? "bg-(--color-surface) text-(--color-ink) shadow-(--shadow-sm)" : "text-(--color-ink-muted) hover:text-(--color-ink-secondary)"
                  }`}
                >
                  <BarChart3 className="size-3.5" aria-hidden />
                  图表
                </button>
                <button
                  type="button"
                  aria-pressed={view === "table"}
                  onClick={() => setView("table")}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                    view === "table" ? "bg-(--color-surface) text-(--color-ink) shadow-(--shadow-sm)" : "text-(--color-ink-muted) hover:text-(--color-ink-secondary)"
                  }`}
                >
                  <Table className="size-3.5" aria-hidden />
                  数据表
                </button>
              </div>
            </div>

            <div className="mt-4">
              {view === "chart" ? (
                <EChart option={barOption} height={280} ariaLabel="各分类预算与实际支出对比柱状图" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-(--color-border) text-left text-xs text-(--color-ink-muted)">
                        <th scope="col" className="py-2 pr-3 font-medium">类别</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">预算</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">实际</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">差额</th>
                        <th scope="col" className="py-2 text-right font-medium">使用率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--color-border)">
                      {month.categories.map((c) => {
                        const diff = c.actualCents - c.budgetCents;
                        const over = diff > 0;
                        return (
                          <tr key={c.category}>
                            <td className="py-2.5 pr-3 font-medium text-(--color-ink)">{c.category}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-(--color-ink-secondary)">
                              ¥{fmtYuan(c.budgetCents, 0)}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-(--color-ink-secondary)">
                              ¥{fmtYuan(c.actualCents, 0)}
                            </td>
                            <td
                              className={`py-2.5 pr-3 text-right tabular-nums ${
                                over ? "font-medium text-(--color-critical-ink)" : "text-(--color-good-ink)"
                              }`}
                            >
                              {over ? `+¥${fmtYuan(diff, 0)}` : `-¥${fmtYuan(-diff, 0)}`}
                            </td>
                            <td className={`py-2.5 text-right tabular-nums ${over ? "font-medium text-(--color-critical-ink)" : "text-(--color-ink-secondary)"}`}>
                              {fmtPct(c.actualCents, c.budgetCents)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {editTarget ? (
          <BudgetEditModal
            category={editTarget}
            budgetCents={month.categories.find((c) => c.category === editTarget)?.budgetCents ?? 0}
            onSave={(cents) => handleSaveBudget(editTarget, cents)}
            onClose={() => setEditTarget(null)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{toast ? <ToastView toast={toast} /> : null}</AnimatePresence>
    </Container>
  );
}

export default function BudgetPage() {
  return (
    <AuthGuard>
      <BudgetContent />
    </AuthGuard>
  );
}
