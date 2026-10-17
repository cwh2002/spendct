"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronRight,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  HeartPulse,
  Info,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AuthGuard } from "@/components/auth/route-guard";
import { Container } from "@/components/layout/container";
import { useAuth } from "@/lib/account/store";
import { deleteBook, listBooks } from "@/lib/account/db";
import type { BookRecord } from "@/lib/account/types";
import { DEMO_SUBSCRIPTIONS } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { featureFlags } from "@/lib/feature-flags";
import { buildCleanCsv } from "@/lib/import/parse-csv";
import type { BillRow } from "@/lib/import/types";
import { readNotifStorage, writeNotifSettings, type NotifSettings } from "@/lib/notifications";
import {
  discardDatasetForBook,
  discardInMemoryDataset,
} from "@/lib/persistence/pipeline-persistence";
import { usePipeline } from "@/lib/pipeline/store";

const ACTIVE_BOOK_KEY = "spendct:active-book";
const THEME_STORAGE_KEY = "spendct:theme";
const PLAIN_MERCHANT_KEY = "spendct:plain-merchant";
const COLORBLIND_KEY = "spendct:colorblind";

/* ---------------- 通用工具 ---------------- */

function readActiveBookId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_BOOK_KEY);
  } catch {
    return null;
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 导入时间展示：当天显示「今天 14:30」，更早的显示日期 */
function formatImportedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return `今天 ${date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`;
  }
  return formatDate(timestamp);
}

/** 偏好开关持久化：值存 "1"/"0"，缺省视为开启（默认体验完整） */
function useLocalStorageFlag(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  // 页面内容仅在会话恢复后渲染（客户端），懒初始化可直接读本地存储
  const [value, setValue] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      // 隐私模式禁 localStorage：保持默认值
      return initial;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // 存储失败不影响本次会话内的开关状态
      }
    },
    [key],
  );

  return [value, update];
}

/* ---------------- 主题三态 ---------------- */

type ThemeMode = "light" | "dark" | "system";

const THEME_OPTIONS: readonly { value: ThemeMode; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

function readThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // 忽略：按跟随系统处理
  }
  return "system";
}

/**
 * 应用主题：与布局层防闪脚本同一机制（写 spendct:theme + 切 html.dark）。
 * 跟随系统时不落存储，让首帧脚本回退 prefers-color-scheme。
 */
function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  try {
    if (mode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 忽略
  }
}

/* ---------------- 通知开关 ----------------
 * 存储键与读写逻辑统一收在 src/lib/notifications.ts（F13 通知中心同源），
 * 本页只消费：设置写入必须经 writeNotifSettings 合并已读数组，避免覆盖。 */

/* ---------------- 导出数据（真实优先 + 内置兜底） ---------------- */

interface ExportCategoryDef {
  category: string;
  merchants: readonly string[];
  minCents: number;
  maxCents: number;
  /** 抽样权重：类目占比贴近学生消费画像（与内置账单生成器同口径） */
  weight: number;
}

/**
 * 学生消费画像口径（与内置账单生成器的新参数一致）：
 * 权重即类目支出占比（餐饮 42%、购物 11.5%……），金额区间取均值的 0.4~1.6 倍，
 * 均匀分布期望恰为均值（餐饮 20 元、购物 60 元、交通 10 元、娱乐 40 元、
 * 居住 150 元、通讯 40 元、医疗 50 元、教育 80 元、人情 30 元、金融 100 元、其他 15 元）。
 * 权重合计 90.9，订阅扣费行单独追加，其余支出占比由订阅补齐。
 */
const EXPORT_CATEGORY_POOL: readonly ExportCategoryDef[] = [
  {
    category: "餐饮",
    merchants: ["美团外卖", "瑞幸咖啡", "肯德基", "海底捞", "兰州拉面", "喜茶"],
    minCents: 800,
    maxCents: 3200,
    weight: 42,
  },
  {
    category: "购物",
    merchants: ["淘宝", "京东", "拼多多", "优衣库", "永辉超市"],
    minCents: 2400,
    maxCents: 9600,
    weight: 11.5,
  },
  {
    category: "交通",
    merchants: ["滴滴出行", "地铁出行", "高德打车", "哈啰单车"],
    minCents: 400,
    maxCents: 1600,
    weight: 6.3,
  },
  {
    category: "娱乐",
    merchants: ["万达影城", "Steam", "腾讯视频", "网易云音乐"],
    minCents: 1600,
    maxCents: 6400,
    weight: 7,
  },
  {
    category: "居住",
    merchants: ["国家电网", "燃气缴费", "水费缴纳"],
    minCents: 6000,
    maxCents: 24000,
    weight: 7.2,
  },
  {
    category: "通讯",
    merchants: ["中国移动", "中国联通"],
    minCents: 1600,
    maxCents: 6400,
    weight: 4.5,
  },
  {
    category: "医疗",
    merchants: ["益丰药房", "社区诊所"],
    minCents: 2000,
    maxCents: 8000,
    weight: 1.8,
  },
  {
    category: "教育",
    merchants: ["当当书店", "得到课程", "中国大学MOOC"],
    minCents: 3200,
    maxCents: 12800,
    weight: 5.4,
  },
  {
    category: "人情",
    merchants: ["微信红包", "生日礼物"],
    minCents: 1200,
    maxCents: 4800,
    weight: 2.6,
  },
  {
    category: "金融",
    merchants: ["招商银行信用卡", "基金定投", "保险缴费"],
    minCents: 4000,
    maxCents: 16000,
    weight: 0.9,
  },
  { category: "其他", merchants: ["便利店", "打印店"], minCents: 600, maxCents: 2400, weight: 1.7 },
];

/** 确定性伪随机：同种子同序列，保证同一评审周期内导出内容可复现 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 内置导出样本（回退路径）：12 个月 × 40 行 + 订阅扣费行（与 DEMO_SUBSCRIPTIONS 同口径）。
 * 只有数据集未落库（尚未导入账单）或 DuckDB 查询失败时才走这里；
 * 有数据集时导出链路直接读 transactions 真实明细（见 loadExportRowsFromDuckDB）。
 */
function buildDemoExportRows(): BillRow[] {
  const rows: BillRow[] = [];
  const rand = mulberry32(20261013);

  for (const sub of DEMO_SUBSCRIPTIONS) {
    for (const charge of sub.charges) {
      rows.push({
        dateIso: charge.date,
        category: "订阅",
        merchant: `订阅服务·${sub.merchantRef}`,
        channel: "wechat",
        direction: "expense",
        amountCents: charge.amountCents,
      });
    }
  }

  const totalWeight = EXPORT_CATEGORY_POOL.reduce((sum, def) => sum + def.weight, 0);
  for (let month = 0; month < 12; month++) {
    for (let index = 0; index < 40; index++) {
      const roll = rand() * totalWeight;
      let cursor = 0;
      let picked = EXPORT_CATEGORY_POOL[0]!;
      for (const def of EXPORT_CATEGORY_POOL) {
        cursor += def.weight;
        if (roll < cursor) {
          picked = def;
          break;
        }
      }
      // 起始月为 2025-10，前三个月落在 2025 年
      const year = month < 3 ? 2025 : 2026;
      const monthNumber = ((10 + month - 1) % 12) + 1;
      const day = 1 + Math.floor(rand() * 28);
      rows.push({
        dateIso: `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        category: picked.category,
        merchant: picked.merchants[Math.floor(rand() * picked.merchants.length)]!,
        channel: rand() < 0.5 ? "wechat" : "alipay",
        direction: "expense",
        amountCents: picked.minCents + Math.floor(rand() * (picked.maxCents - picked.minCents)),
      });
    }
  }
  return rows;
}

/** 单页导出行数：分页遍历上限，避免一次性物化全部结果 */
const EXPORT_PAGE_SIZE = 5000;

/** transactions 明细行 → 标准账单行（导出复用 import 域 BillRow 形状） */
function mapExportRow(row: Record<string, unknown>): BillRow {
  const amount = row.amount_cents;
  const note = row.note;
  const rawRef = row.raw_ref;
  return {
    dateIso: String(row.date_iso ?? ""),
    category: String(row.category ?? "其他"),
    merchant: String(row.merchant ?? ""),
    // 渠道契约只有 wechat/alipay 两值；manual 等其余来源导出时归入 wechat
    channel: row.channel === "alipay" ? "alipay" : "wechat",
    // 收支契约只有 expense/income；neutral 等其余方向按支出导出
    direction: row.direction === "income" ? "income" : "expense",
    amountCents: typeof amount === "bigint" ? Number(amount) : Number(amount) || 0,
    ...(typeof note === "string" && note !== "" ? { note } : {}),
    ...(typeof rawRef === "string" && rawRef !== "" ? { rawRef } : {}),
  };
}

/**
 * 从 DuckDB 分页导出真实账单明细。
 * 表名与列名都是建库常量（schema/bill.ts TRANSACTION_COLUMNS），零用户输入拼接；
 * 导出属本地允许项，直接 conn.query 遍历，不受白名单 50 行上限约束。
 * 排序键 date_iso：导出期间数据集不变，OFFSET 分页顺序稳定，不重不漏。
 */
async function loadExportRowsFromDuckDB(): Promise<BillRow[]> {
  const conn = await getDuckDB();
  const rows: BillRow[] = [];
  for (;;) {
    const table = await conn.query(
      `SELECT date_iso, category, merchant, channel, direction, amount_cents, note, raw_ref ` +
        `FROM transactions ORDER BY date_iso LIMIT ${EXPORT_PAGE_SIZE} OFFSET ${rows.length}`,
    );
    const batch = table.toArray() as Record<string, unknown>[];
    if (batch.length === 0) break;
    for (const row of batch) rows.push(mapExportRow(row));
    if (batch.length < EXPORT_PAGE_SIZE) break;
  }
  return rows;
}

/** Blob → <a download> 触发浏览器下载；文件在内存中组装，不落盘 */
function downloadFile(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- 通用 UI 件 ---------------- */

interface SwitchRowProps {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

/** 开关行：整行可点（触控目标 ≥44px），轨道/滑块纯装饰，状态经 aria 暴露 */
function SwitchRow({ label, desc, checked, onChange }: SwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-(--color-ink)">{label}</span>
        {desc ? (
          <span className="mt-0.5 block text-xs text-(--color-ink-muted)">{desc}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-(--color-btn-primary)" : "bg-(--color-border-strong)"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

function SectionCard({
  icon: Icon,
  title,
  sub,
  children,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)"
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-5 text-(--color-primary)" aria-hidden />
        <div>
          <h2 className="text-lg font-bold text-(--color-ink)">{title}</h2>
          <p className="text-xs text-(--color-ink-muted)">{sub}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ---------------- 弹层 ---------------- */

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
    >
      <button
        type="button"
        aria-label="关闭弹层"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div className="relative w-full max-w-md rounded-t-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-lg) sm:rounded-(--radius-xl)">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-(--color-ink)">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid size-10 place-items-center rounded-full text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-2)"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function ConfirmModal({
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">{description}</p>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center rounded-(--radius-md) border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex h-11 items-center rounded-(--radius-md) bg-(--color-critical) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 导出确认弹层 ---------------- */

interface ExportConfirmModalProps {
  format: "csv" | "json";
  rowCount: number;
  /** 真实明细还在从 DuckDB 读取中：确认键禁用并显示读取态 */
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** 导出前隐私提示：文件在本机生成、不经服务端、明确条数 */
function ExportConfirmModal({
  format,
  rowCount,
  loading,
  onConfirm,
  onClose,
}: ExportConfirmModalProps) {
  return (
    <Modal title={format === "csv" ? "导出表格文件" : "导出备份文件"} onClose={onClose}>
      <ul className="mt-4 space-y-2.5">
        <li className="flex items-start gap-2 text-sm text-(--color-ink-secondary)">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-(--color-down)" aria-hidden />
          文件会在你的浏览器里生成，不会经过任何服务器
        </li>
        <li className="flex items-start gap-2 text-sm text-(--color-ink-secondary)">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-(--color-down)" aria-hidden />
          文件会直接下载到你的设备，不会上传
        </li>
        <li className="flex items-start gap-2 text-sm text-(--color-ink-secondary)">
          <Info className="mt-0.5 size-4 shrink-0 text-(--color-primary)" aria-hidden />
          本次将导出 <span className="font-semibold tabular-nums">{rowCount}</span> 条账单
        </li>
      </ul>
      <p className="mt-3 rounded-(--radius-md) bg-(--color-surface-2) px-3 py-2 text-xs text-(--color-ink-muted)">
        未导入自己的账单时，这里导出的内容仅用于功能预览；导入你自己的账单后，会导出你的真实明细。
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center rounded-(--radius-md) border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="inline-flex h-11 items-center gap-1.5 rounded-(--radius-md) bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:opacity-60"
        >
          <Download className="size-4" aria-hidden />
          {loading ? "正在读取账单…" : "确认导出"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 页面主体 ---------------- */

function SettingsContent() {
  const user = useAuth((state) => state.user);

  // 页面内容仅在会话恢复后渲染（客户端），懒初始化可直接读本地存储
  const [activeBookId, setActiveBookId] = useState<string | null>(() => readActiveBookId());
  // 账本列表走请求态管理：查询自持加载态，删除后失效重取
  const queryClient = useQueryClient();
  const { data: books = [], isLoading: booksLoading } = useQuery({
    queryKey: ["books", user?.id ?? null],
    queryFn: async () => {
      if (!user) return [];
      try {
        return await listBooks(user.id);
      } catch {
        // IndexedDB 不可用时按空数据集展示，不阻塞页面其余内容
        return [];
      }
    },
    enabled: user !== null,
  });

  const [notif, setNotif] = useState<NotifSettings>(() => readNotifStorage().settings);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [plainMerchant, setPlainMerchant] = useLocalStorageFlag(PLAIN_MERCHANT_KEY, false);
  const [colorblind, setColorblind] = useLocalStorageFlag(COLORBLIND_KEY, false);

  const [exportTarget, setExportTarget] = useState<"csv" | "json" | null>(null);
  const [deleteBookTarget, setDeleteBookTarget] = useState<BookRecord | null>(null);
  const [deleteBookBusy, setDeleteBookBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 导出数据源：数据集已落库（上传账单或内置账单体检）时从 DuckDB 读真实明细，
  // 否则回退内置样本；读取中/失败都以 null 表示回退态，导出链路不中断
  const datasetTxHash = usePipeline((s) => s.datasetTxHash);
  const lastRun = usePipeline((s) => s.lastRun);
  const [realExportRows, setRealExportRows] = useState<BillRow[] | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  // 数据源切换（新数据集/新体检/清空）时在渲染期同步重置导出态：不在 effect
  // 里同步 setState，避免级联渲染（React 官方「按 props 调整 state」模式，
  // 守卫下一次渲染不再命中即自动退出）
  const [exportSource, setExportSource] = useState({ txHash: datasetTxHash, run: lastRun });
  if (exportSource.txHash !== datasetTxHash || exportSource.run !== lastRun) {
    setExportSource({ txHash: datasetTxHash, run: lastRun });
    setRealExportRows(null);
    setExportLoading(datasetTxHash !== null || lastRun !== null);
  }

  useEffect(() => {
    if (!datasetTxHash && !lastRun) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await loadExportRowsFromDuckDB();
        if (!cancelled) setRealExportRows(rows);
      } catch {
        // 查询失败（数据集未落库/Worker 不可用）：保持内置样本回退
        if (!cancelled) setRealExportRows(null);
      } finally {
        if (!cancelled) setExportLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [datasetTxHash, lastRun]);

  const exportRows = useMemo(() => realExportRows ?? buildDemoExportRows(), [realExportRows]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600);
  }, []);

  // 主题三态与导航栏 ThemeToggle 同机制：任何入口改 html.dark 都回读存储保持选中态一致
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeMode(readThemeMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // 色弱模式：给 html 打标记类，图表层读取后启用 decal 纹理
  useEffect(() => {
    document.documentElement.classList.toggle("colorblind", colorblind);
  }, [colorblind]);

  function updateNotif(patch: Partial<NotifSettings>) {
    setNotif((prev) => ({ ...prev, ...patch }));
    // 经 notifications 库读-改-写：开关与已读集合共用一个存储对象，整体覆盖会冲掉已读
    writeNotifSettings(patch);
  }

  function setActiveBook(id: string) {
    try {
      localStorage.setItem(ACTIVE_BOOK_KEY, id);
    } catch {
      // 忽略：本次会话内仍生效
    }
    setActiveBookId(id);
    showToast("已切换当前账本");
  }

  async function handleDeleteBook() {
    if (!deleteBookTarget || !user) return;
    const target = deleteBookTarget;
    setDeleteBookBusy(true);
    try {
      await deleteBook(target.id);
      // 账本删除即数据删除（08 修订案 A18）：与个人中心同口径联动清除持久化
      // 数据集，防止刷新后 restorePipelineSnapshot 把已删数据复活
      await discardDatasetForBook(target.id);
      if (activeBookId === target.id) {
        try {
          localStorage.removeItem(ACTIVE_BOOK_KEY);
        } catch {
          /* 忽略 */
        }
        setActiveBookId(null);
        // 内存联动：当前账本被删，其他数据页无需刷新即回到演示/空态
        await discardInMemoryDataset();
      }
      setDeleteBookTarget(null);
      setDeleteBookBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["books", user.id] });
      showToast(`已删除账本「${target.name}」`);
    } catch {
      setDeleteBookBusy(false);
      showToast("删除失败，请重试");
    }
  }

  function handleExport() {
    if (!exportTarget || exportLoading) return;
    const format = exportTarget;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (format === "csv") {
        // BOM 前缀：让 Excel 按 UTF-8 打开中文表头不出现乱码
        downloadFile(
          `﻿${buildCleanCsv(exportRows)}`,
          `spendct-export-${stamp}.csv`,
          "text/csv;charset=utf-8",
        );
      } else {
        downloadFile(
          JSON.stringify(exportRows, null, 2),
          `spendct-export-${stamp}.json`,
          "application/json;charset=utf-8",
        );
      }
      setExportTarget(null);
      showToast(format === "csv" ? "已开始下载账单表格文件" : "已开始下载账单备份文件");
    } catch {
      showToast("导出失败：文件生成出错，请重试");
    }
  }

  if (!user) return null;

  const currentBook = books.find((book) => book.id === activeBookId);

  return (
    <div className="space-y-4 pb-4 md:space-y-6">
      {/* 页面头 */}
      <header>
        <h1 className="text-2xl font-bold text-(--color-ink)">数据管理</h1>
        <p className="mt-1 text-sm text-(--color-ink-secondary)">
          账单、导出与偏好——数据始终只在本机
        </p>
      </header>

      {/* 账户入口 */}
      <Link
        href="/me"
        className="flex items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) transition-colors hover:border-(--color-border-strong)"
      >
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-(--color-primary) to-(--color-brand-700) text-sm font-semibold text-white"
        >
          {(user.nickname || "U").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-(--color-ink)">
            {user.nickname}
          </span>
          <span className="block truncate text-xs font-(--font-mono) text-(--color-ink-muted)">
            @{user.username}
          </span>
        </span>
        <span className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary)">
          进入个人中心
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>

      {/* 我的账单数据 */}
      <SectionCard
        icon={Database}
        title="我的账单数据"
        sub="导入的账单保存在你的浏览器里，可以切换或删除"
      >
        {currentBook ? (
          <div className="rounded-(--radius-lg) border border-(--color-primary-soft) bg-(--color-primary-soft)/40 p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)"
              >
                <Database className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-(--color-ink-muted)">当前账本</p>
                <p className="truncate font-medium text-(--color-ink)" title={currentBook.id}>
                  {currentBook.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-(--color-ink-muted)">
                  已导入 {currentBook.rowCount} 条账单 · {formatImportedAt(currentBook.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteBookTarget(currentBook)}
                aria-label={`删除账本 ${currentBook.name}`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-(--radius-md) border border-(--color-border) text-(--color-ink-muted) transition-colors hover:border-(--color-critical) hover:text-(--color-critical-ink)"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) px-6 py-10 text-center">
            <FileSpreadsheet className="size-8 text-(--color-ink-muted)" aria-hidden />
            <p className="font-medium text-(--color-ink)">还没有账本</p>
            <p className="max-w-sm text-xs text-(--color-ink-muted)">
              上传账单后，账本会出现在这里，可导出表格文件或一键删除
            </p>
            <Link
              href="/upload"
              className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
            >
              <Upload className="size-4" aria-hidden />
              去上传账单
            </Link>
          </div>
        )}

        {books.length > 0 ? (
          <ul className="mt-4 divide-y divide-(--color-border)">
            {books.map((book) => {
              const isActive = book.id === activeBookId;
              return (
                <li key={book.id} className="flex min-h-[60px] items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className="truncate text-sm font-medium text-(--color-ink)"
                        title={book.id}
                      >
                        {book.name}
                      </p>
                      {isActive ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-(--color-primary-soft) px-2 py-0.5 text-[10px] font-semibold text-(--color-primary)">
                          <Check className="size-3" aria-hidden />
                          当前
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-(--color-ink-muted)">
                      已导入 {book.rowCount} 条账单 · {formatImportedAt(book.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isActive ? (
                      <span
                        aria-disabled
                        className="inline-flex h-11 items-center rounded-(--radius-md) bg-(--color-primary-soft) px-3 text-sm font-medium text-(--color-primary)"
                      >
                        使用中
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveBook(book.id)}
                        className="inline-flex h-11 items-center rounded-(--radius-md) border border-(--color-border) px-3 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteBookTarget(book)}
                      aria-label={`删除账本 ${book.name}`}
                      className="grid h-11 w-11 place-items-center rounded-(--radius-md) border border-(--color-border) text-(--color-ink-muted) transition-colors hover:border-(--color-critical) hover:text-(--color-critical-ink)"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : booksLoading ? (
          <div className="mt-4 h-14 animate-pulse rounded-(--radius-md) bg-(--color-surface-2)" />
        ) : (
          <p className="mt-4 text-xs text-(--color-ink-muted)">还没有其他账本</p>
        )}
      </SectionCard>

      {/* 数据导出 */}
      <SectionCard
        icon={Download}
        title="数据导出"
        sub="把当前账单明细导出成文件，方便用 Excel 打开或自行备份"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setExportTarget("csv")}
            className="inline-flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
          >
            <FileText className="size-4" aria-hidden />
            导出为表格文件（可用 Excel 打开）
          </button>
          <button
            type="button"
            onClick={() => setExportTarget("json")}
            className="inline-flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
          >
            <FileJson className="size-4" aria-hidden />
            导出备份文件
          </button>
        </div>
      </SectionCard>

      {/* 通知开关 */}
      <SectionCard
        icon={Bell}
        title="通知"
        sub="通知偏好只保存在你的本机浏览器里，不会上传到服务器"
      >
        <div className="divide-y divide-(--color-border)">
          <SwitchRow
            label="订阅扣费临近"
            desc="下次扣费前 3 天内提醒"
            checked={notif.subDue}
            onChange={(next) => updateNotif({ subDue: next })}
          />
          <SwitchRow
            label="预算使用提醒"
            desc="预算使用率达到 80% 时提醒"
            checked={notif.budgetOver}
            onChange={(next) => updateNotif({ budgetOver: next })}
          />
          <SwitchRow
            label="继续上次体检"
            desc="体检没做完就退出时，提醒你回来接着做"
            checked={notif.resume}
            onChange={(next) => updateNotif({ resume: next })}
          />
        </div>
      </SectionCard>

      {/* 偏好 */}
      <SectionCard icon={Sun} title="偏好" sub="主题与显示选项">
        <div className="space-y-4">
          {featureFlags.dark ? (
            <div>
              <p className="text-sm font-medium text-(--color-ink)">主题</p>
              <div
                role="radiogroup"
                aria-label="主题"
                className="mt-2 inline-flex rounded-full border border-(--color-border) bg-(--color-surface-2) p-1"
              >
                {THEME_OPTIONS.map((option) => {
                  const active = themeMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => applyTheme(option.value)}
                      className={`inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${
                        active
                          ? "bg-(--color-surface) text-(--color-ink) shadow-(--shadow-sm)"
                          : "text-(--color-ink-secondary) hover:text-(--color-ink)"
                      }`}
                    >
                      <option.icon className="size-4" aria-hidden />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="divide-y divide-(--color-border)">
            <SwitchRow
              label="显示完整商户名"
              desc="默认会隐藏商户名的一部分以保护隐私，打开后显示完整名称"
              checked={plainMerchant}
              onChange={setPlainMerchant}
            />
            <SwitchRow
              label="色弱模式"
              desc="图表叠加纹理区分系列，色觉障碍友好"
              checked={colorblind}
              onChange={setColorblind}
            />
          </div>
        </div>
      </SectionCard>

      {/* 关于 */}
      <SectionCard icon={Info} title="关于" sub="常用入口">
        <div className="flex items-center gap-3">
          <HeartPulse className="size-8 text-(--color-health)" aria-hidden />
          <div>
            <p className="font-bold text-(--color-ink)">SpendCT · 让每一笔账都花得明白</p>
            <p className="text-xs text-(--color-ink-muted)">账单明细只在你的设备上计算</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <Link
            href="/budget"
            className={`inline-flex h-11 items-center gap-1.5 font-medium text-(--color-brand-600) ${
              featureFlags.budget ? "hover:underline" : "pointer-events-none opacity-50"
            }`}
          >
            <Wallet className="size-4" aria-hidden />
            预算中心
            {featureFlags.budget ? null : (
              <span className="rounded-full bg-(--color-surface-2) px-1.5 py-0.5 text-[10px] font-medium text-(--color-ink-muted)">
                即将上线
              </span>
            )}
          </Link>
          <Link
            href="/learn"
            className={`inline-flex h-11 items-center gap-1.5 font-medium text-(--color-brand-600) ${
              featureFlags.learn ? "hover:underline" : "pointer-events-none opacity-50"
            }`}
          >
            <GraduationCap className="size-4" aria-hidden />
            知识课堂
            <span className="rounded-full bg-(--color-accent)/15 px-1.5 py-0.5 text-[10px] font-semibold text-(--color-accent)">
              新功能
            </span>
          </Link>
          <Link
            href="/privacy"
            className="inline-flex h-11 items-center gap-1.5 font-medium text-(--color-brand-600) hover:underline"
          >
            <ShieldCheck className="size-4" aria-hidden />
            隐私说明
          </Link>
        </div>
      </SectionCard>

      {/* 弹层 */}
      {exportTarget ? (
        <ExportConfirmModal
          format={exportTarget}
          rowCount={exportRows.length}
          loading={exportLoading}
          onConfirm={handleExport}
          onClose={() => setExportTarget(null)}
        />
      ) : null}
      {deleteBookTarget ? (
        <ConfirmModal
          title="删除账本？"
          description={
            <>将删除账本「{deleteBookTarget.name}」，删除后无法恢复。请确认不再需要这份账本。</>
          }
          confirmLabel="确认删除"
          busy={deleteBookBusy}
          onConfirm={() => void handleDeleteBook()}
          onClose={() => setDeleteBookTarget(null)}
        />
      ) : null}

      {/* 轻提示 */}
      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-(--color-ink) px-4 py-2.5 text-sm whitespace-nowrap text-(--color-surface) shadow-(--shadow-lg) md:bottom-8"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <Container className="py-6 md:py-10">
        <SettingsContent />
      </Container>
    </AuthGuard>
  );
}
