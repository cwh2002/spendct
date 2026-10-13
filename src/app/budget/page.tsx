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
  Sparkles,
  Table,
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

/* —— 快速记账本地规则解析 —— */

interface QuickDraft {
  amount: string; // 元，输入框字符串
  direction: "expense" | "income";
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
}

type ParseOutcome = { ok: true; draft: QuickDraft } | { ok: false; reason: string };

/** 方向关键词：出现即判定收入（退款按收入方向记录，与导入口径一致） */
const INCOME_KEYWORDS = ["收入", "退款", "报销", "工资", "红包", "转账", "返现", "奖学金", "入账", "收到"];

/**
 * 类别关键词表（顺序即优先级，先命中先归类）：
 * 订阅置于娱乐之前，避免「视频会员充值」被「充值」误归娱乐；
 * 「红包」在方向层已判为收入，不再作为人情支出关键词。
 */
const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["餐饮", ["食堂", "外卖", "奶茶", "咖啡", "早餐", "午餐", "晚餐", "夜宵", "餐厅", "聚餐", "火锅", "烧烤", "麦当劳", "肯德基", "瑞幸", "饭"]],
  ["交通", ["地铁", "公交", "打车", "滴滴", "高铁", "火车", "机票", "飞机", "单车", "加油", "停车"]],
  ["购物", ["淘宝", "京东", "拼多多", "超市", "购物", "衣服", "鞋", "数码", "快递", "买"]],
  ["订阅", ["会员", "订阅", "续费", "包月", "包年", "季卡", "月卡"]],
  ["娱乐", ["电影", "游戏", "演唱会", "演出", "剧本杀", "KTV", "充值", "打赏", "游乐场", "直播"]],
  ["居住", ["房租", "水电", "燃气", "物业", "网费", "住宿"]],
  ["通讯", ["话费", "流量", "宽带"]],
  ["医疗", ["医院", "药", "挂号", "体检", "诊所"]],
  ["教育", ["学费", "教材", "课程", "培训", "报名", "书"]],
  ["人情", ["份子", "礼物"]],
  ["金融", ["基金", "理财", "股票", "利息"]],
];

/**
 * 一句话记账的本地规则解析：
 * 金额正则支持「15」「15 块」「15 元」「¥15」，「万」级金额直接拒绝（与 quick-entry
 * 提示词口径一致，06 §⑥.1）；日期只识别「昨天/前天」，缺省取今天。
 * LLM 解析任务接通后本函数退化为兜底，入口 UI 不变。
 */
function parseQuickText(text: string, today: Date): ParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "先输入一句话，例如「中午食堂花了 15」" };
  if (/[\d.]+\s*万/.test(trimmed)) {
    return { ok: false, reason: "暂不支持「万」级金额，请直接输入数字" };
  }
  const match = trimmed.match(/(?:[¥￥]\s*)?(\d+(?:\.\d{1,2})?)\s*(?:元|块|块钱)?/);
  const rawAmount = match?.[1] ?? "";
  const yuan = Number(rawAmount);
  if (!rawAmount || !Number.isFinite(yuan) || yuan <= 0) {
    return { ok: false, reason: "没有识别到金额，试试「中午食堂花了 15」" };
  }

  const direction = INCOME_KEYWORDS.some((k) => trimmed.includes(k)) ? "income" : "expense";

  let category = "其他";
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => trimmed.includes(w))) {
      category = cat;
      break;
    }
  }

  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (trimmed.includes("前天")) date.setDate(date.getDate() - 2);
  else if (trimmed.includes("昨天")) date.setDate(date.getDate() - 1);

  return {
    ok: true,
    draft: {
      amount: formatAmountInput(Math.round(yuan * 100)),
      direction,
      category,
      date: toDateInput(date),
      note: trimmed.slice(0, 60),
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
          预算对本月与未来两月生效；历史月份只读（06 §7 写入护栏）。
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

  // 选中月份的分类数据：未来月实际值按系数外推，预算叠加本地覆盖值
  const month = useMemo(() => {
    const factor = MONTH_FACTORS[monthOffset] ?? 1;
    const categories = DEMO_BUDGET.categories.map((c) => ({
      category: c.category,
      budgetCents: overrides[c.category] ?? c.budgetCents,
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
  }, [monthOffset, overrides]);

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

  // 本月手动记账笔数（账本接通前的本地统计口径）
  const monthEntryCount = useMemo(() => {
    const prefix = toDateInput(new Date()).slice(0, 7);
    return entries.filter((e) => e.ts.startsWith(prefix)).length;
  }, [entries]);

  function handleParse() {
    const outcome = parseQuickText(entryText, new Date());
    if (!outcome.ok) {
      showToast(outcome.reason, "error");
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
    showToast("已入账");
    setDraft(null);
    setEntryText("");
    inputRef.current?.focus();
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

  // 预算 vs 实际：两组柱 + 图例（≥2 系列必配图例），数值轴为元
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

  // 下月预测：单系列折线（标题即系列名，不加图例），y 轴缩放起点避免形状失真
  const forecastOption = useCallback((): ECOption => {
    const t = chartInk();
    const lineColor = cssVar("--color-chart-1");
    const labels = DEMO_FORECAST.months.map((mStr) => `${Number(mStr.split("-")[1] ?? "")}月`);
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
          data: DEMO_FORECAST.valuesCents.map((c) => c / 100),
          smooth: true,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 2, color: lineColor },
          itemStyle: { color: lineColor, borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: lineColor, opacity: 0.12 },
        },
      ],
    };
  }, []);

  const forecastAvgYuan = Math.round(
    DEMO_FORECAST.valuesCents.reduce((sum, v) => sum + v, 0) / DEMO_FORECAST.valuesCents.length / 100,
  );

  // 超支贴士：demo 模板文案，数字按当前数据实时计算（budget-advice 任务接入后替换为模型生成）
  const dining = month.categories.find((c) => c.category === "餐饮");
  const diningPct = dining ? fmtPct(dining.actualCents, dining.budgetCents) : 0;
  const adviceVisible = severity === "over" && !adviceDismissed;

  return (
    <Container wide className="py-8 md:py-10">
      {/* 页头 */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-(--color-ink) md:text-3xl">预算中心</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-ink-secondary)">
          月度分类预算 + 一句话快速记账 + 超支提示 + 下月预测。预算与手动账单只保存在你的浏览器本地。
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
              <span className="text-xs text-(--color-ink-muted)">试试：「中午食堂花了 15」「昨天打车 23.5」</span>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
              <Sparkles className="size-3.5" aria-hidden />
              AI 解析接入中，当前为本地规则模式
            </p>

            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleParse();
              }}
            >
              <input
                ref={inputRef}
                value={entryText}
                onChange={(e) => setEntryText(e.target.value)}
                maxLength={200}
                placeholder="一句话记一笔，如「中午食堂花了 15」"
                aria-label="记账内容"
                className="h-11 min-w-0 flex-1 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-page) px-3.5 text-sm text-(--color-ink) outline-none transition-colors placeholder:text-(--color-ink-muted) focus:border-(--color-primary)"
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-(--radius-md) bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
              >
                解析
              </button>
            </form>

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
                    <p className="mt-0.5 text-xs text-(--color-ink-muted)">解析结果可编辑，确认后写入本地账本</p>

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

            <p className="mt-3 text-xs text-(--color-ink-muted)">
              本月已手动记账 <span className="font-semibold tabular-nums text-(--color-ink-secondary)">{monthEntryCount}</span> 笔 · 数据仅存于浏览器本地
            </p>
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
                <p className="mt-2 text-xs text-(--color-ink-muted)">未来月为演示外推数据（实际值 ×0.9 逐月衰减）</p>
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
                <span className="rounded-full border border-(--color-border) px-2 py-0.5 font-(--font-mono) text-[11px] text-(--color-ink-muted)">
                  method={DEMO_FORECAST.method}
                </span>
              </div>

              <EChart
                option={forecastOption}
                height={180}
                className="mt-3"
                ariaLabel="未来三个月支出预测折线图"
              />

              <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">
                近三月季节基线外推：未来三个月月均支出约 ¥{forecastAvgYuan.toLocaleString("zh-CN")}
                ，11 月受购物节影响略高、1 月回落。预测只反映季节模式，不含一次性事件。
              </p>
              <p className="mt-2 text-xs text-(--color-ink-muted)">朴素季节外推，仅作参考，不构成建议</p>
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

        {/* 超支贴士（模板文案，budget-advice 任务接入中） */}
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
                  <span className="rounded-full border border-(--color-border) px-2 py-0.5 font-(--font-mono) text-[11px] text-(--color-ink-muted)">
                    budget-advice 任务接入中
                  </span>
                </div>
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
                    onClick={() => showToast("明细查看即将在账本页上线")}
                    className="inline-flex h-10 items-center rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2)"
                  >
                    查看明细
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
                  当前为模板文案；budget-advice 任务接入后由预算建议模型按你的数据生成建议。
                </p>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {/* 预算 vs 实际 */}
        <section aria-label="预算与实际对比">
          <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-(--color-ink)">预算 vs 实际</h2>
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
