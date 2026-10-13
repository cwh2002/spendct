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
import { featureFlags } from "@/lib/feature-flags";
import { buildCleanCsv } from "@/lib/import/parse-csv";
import type { BillRow } from "@/lib/import/types";

const ACTIVE_BOOK_KEY = "spendct:active-book";
const THEME_STORAGE_KEY = "spendct:theme";
const NOTIF_STORAGE_KEY = "spendct:notif:v1";
const DEMO_MODE_KEY = "spendct:demo";
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

/* ---------------- 通知开关 ---------------- */

interface NotifSettings {
  subDue: boolean;
  budgetOver: boolean;
  resume: boolean;
}

const DEFAULT_NOTIF: NotifSettings = { subDue: true, budgetOver: true, resume: true };

function readNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return { ...DEFAULT_NOTIF, ...(parsed as Partial<NotifSettings>) };
      }
    }
  } catch {
    // 内容损坏：回默认
  }
  return { ...DEFAULT_NOTIF };
}

/* ---------------- 导出演示数据 ---------------- */

interface ExportCategoryDef {
  category: string;
  merchants: readonly string[];
  minCents: number;
  maxCents: number;
  /** 抽样权重：类目占比贴近演示消费画像 */
  weight: number;
}

const EXPORT_CATEGORY_POOL: readonly ExportCategoryDef[] = [
  { category: "餐饮", merchants: ["美团外卖", "瑞幸咖啡", "肯德基", "海底捞", "兰州拉面", "喜茶"], minCents: 800, maxCents: 9000, weight: 30 },
  { category: "购物", merchants: ["淘宝", "京东", "拼多多", "优衣库", "永辉超市"], minCents: 1500, maxCents: 32000, weight: 24 },
  { category: "交通", merchants: ["滴滴出行", "地铁出行", "高德打车", "哈啰单车"], minCents: 150, maxCents: 4500, weight: 15 },
  { category: "娱乐", merchants: ["万达影城", "Steam", "腾讯视频", "网易云音乐"], minCents: 1200, maxCents: 12000, weight: 10 },
  { category: "居住", merchants: ["国家电网", "燃气缴费", "水费缴纳"], minCents: 3000, maxCents: 26000, weight: 8 },
  { category: "通讯", merchants: ["中国移动", "中国联通"], minCents: 2000, maxCents: 12000, weight: 5 },
  { category: "医疗", merchants: ["益丰药房", "社区诊所"], minCents: 1000, maxCents: 20000, weight: 3 },
  { category: "教育", merchants: ["当当书店", "得到课程"], minCents: 2000, maxCents: 18000, weight: 2 },
  { category: "人情", merchants: ["微信红包", "生日礼物"], minCents: 2000, maxCents: 20000, weight: 1 },
  { category: "其他", merchants: ["便利店", "打印店"], minCents: 300, maxCents: 5000, weight: 2 },
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
 * 演示导出样本：12 个月 × 40 行 + 订阅扣费行（与 DEMO_SUBSCRIPTIONS 同口径）。
 * 真实数据集接通后，此函数替换为 DuckDB 查询结果，其余导出链路不变。
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

function ConfirmModal({ title, description, confirmLabel, busy, onConfirm, onClose }: ConfirmModalProps) {
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
  onConfirm: () => void;
  onClose: () => void;
}

/** 导出前隐私提示：文件在本机组装、不经服务端、明确行数 */
function ExportConfirmModal({ format, rowCount, onConfirm, onClose }: ExportConfirmModalProps) {
  return (
    <Modal title={format === "csv" ? "导出 CSV" : "导出 JSON"} onClose={onClose}>
      <ul className="mt-4 space-y-2.5">
        <li className="flex items-start gap-2 text-sm text-(--color-ink-secondary)">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-(--color-down)" aria-hidden />
          文件在你的浏览器内直接组装，全程不经过任何服务器
        </li>
        <li className="flex items-start gap-2 text-sm text-(--color-ink-secondary)">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-(--color-down)" aria-hidden />
          不落盘：仅通过浏览器下载到你的设备
        </li>
        <li className="flex items-start gap-2 text-sm text-(--color-ink-secondary)">
          <Info className="mt-0.5 size-4 shrink-0 text-(--color-primary)" aria-hidden />
          本次将导出 <span className="font-semibold tabular-nums">{rowCount}</span> 行数据
          （标准六列，金额单位：分）
        </li>
      </ul>
      <p className="mt-3 rounded-(--radius-md) bg-(--color-surface-2) px-3 py-2 text-xs text-(--color-ink-muted)">
        当前为演示数据口径：导出内容为内置样本。接入真实数据集后导出真实明细。
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
          className="inline-flex h-11 items-center gap-1.5 rounded-(--radius-md) bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
        >
          <Download className="size-4" aria-hidden />
          确认导出
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

  const [notif, setNotif] = useState<NotifSettings>(() => readNotifSettings());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [demoMode, setDemoMode] = useLocalStorageFlag(DEMO_MODE_KEY, true);
  const [plainMerchant, setPlainMerchant] = useLocalStorageFlag(PLAIN_MERCHANT_KEY, false);
  const [colorblind, setColorblind] = useLocalStorageFlag(COLORBLIND_KEY, false);

  const [exportTarget, setExportTarget] = useState<"csv" | "json" | null>(null);
  const [deleteBookTarget, setDeleteBookTarget] = useState<BookRecord | null>(null);
  const [deleteBookBusy, setDeleteBookBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const exportRows = useMemo(() => buildDemoExportRows(), []);

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
    const next = { ...notif, ...patch };
    setNotif(next);
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 忽略
    }
  }

  function setActiveBook(id: string) {
    try {
      localStorage.setItem(ACTIVE_BOOK_KEY, id);
    } catch {
      // 忽略：本次会话内仍生效
    }
    setActiveBookId(id);
    showToast("已切换当前数据集");
  }

  async function handleDeleteBook() {
    if (!deleteBookTarget || !user) return;
    const target = deleteBookTarget;
    setDeleteBookBusy(true);
    try {
      await deleteBook(target.id);
      if (activeBookId === target.id) {
        try {
          localStorage.removeItem(ACTIVE_BOOK_KEY);
        } catch {
          /* 忽略 */
        }
        setActiveBookId(null);
      }
      setDeleteBookTarget(null);
      setDeleteBookBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["books", user.id] });
      showToast(`已删除数据集「${target.name}」`);
    } catch {
      setDeleteBookBusy(false);
      showToast("删除失败：本地存储不可用，请重试");
    }
  }

  function handleExport() {
    if (!exportTarget) return;
    const format = exportTarget;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (format === "csv") {
        // BOM 前缀：让 Excel 按 UTF-8 打开中文表头不出现乱码
        downloadFile(`﻿${buildCleanCsv(exportRows)}`, `spendct-export-${stamp}.csv`, "text/csv;charset=utf-8");
      } else {
        downloadFile(
          JSON.stringify(exportRows, null, 2),
          `spendct-export-${stamp}.json`,
          "application/json;charset=utf-8",
        );
      }
      setExportTarget(null);
      showToast(`已开始下载 spendct-export-${stamp}.${format}`);
    } catch {
      showToast("导出失败：文件组装异常，请重试");
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
          数据集、导出与偏好——数据始终只在本机
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
          <span className="block truncate font-(--font-mono) text-xs text-(--color-ink-muted)">
            @{user.username}
          </span>
        </span>
        <span className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary)">
          进入个人中心
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>

      {/* 数据集管理 */}
      <SectionCard
        icon={Database}
        title="数据集管理"
        sub="账单数据集保存在浏览器本地，可切换、可删除"
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
                <p className="text-xs text-(--color-ink-muted)">当前数据集</p>
                <p className="truncate font-medium text-(--color-ink)">{currentBook.name}</p>
                <p className="mt-0.5 truncate text-xs text-(--color-ink-muted)">
                  <span className="font-(--font-mono)">#{currentBook.id.slice(0, 8)}</span>
                  <span className="mx-1.5">·</span>
                  {currentBook.rowCount} 笔
                  <span className="mx-1.5">·</span>
                  {formatDate(currentBook.createdAt)} 导入
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteBookTarget(currentBook)}
                aria-label={`删除数据集 ${currentBook.name}`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-(--radius-md) border border-(--color-border) text-(--color-ink-muted) transition-colors hover:border-(--color-critical) hover:text-(--color-critical-ink)"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) px-6 py-10 text-center">
            <FileSpreadsheet className="size-8 text-(--color-ink-muted)" aria-hidden />
            <p className="font-medium text-(--color-ink)">还没有数据集</p>
            <p className="max-w-sm text-xs text-(--color-ink-muted)">
              上传账单后，数据集会出现在这里，可导出 CSV/JSON 或一键删除
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
                      <p className="truncate text-sm font-medium text-(--color-ink)">{book.name}</p>
                      {isActive ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-(--color-primary-soft) px-2 py-0.5 text-[10px] font-semibold text-(--color-primary)">
                          <Check className="size-3" aria-hidden />
                          当前
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-(--color-ink-muted)">
                      {book.rowCount} 笔
                      <span className="mx-1.5">·</span>
                      {formatDate(book.createdAt)} 导入
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
                      aria-label={`删除数据集 ${book.name}`}
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
          <p className="mt-4 text-xs text-(--color-ink-muted)">还没有其他数据集</p>
        )}
      </SectionCard>

      {/* 数据导出 */}
      <SectionCard
        icon={Download}
        title="数据导出"
        sub="标准六列格式，在浏览器内直接组装并触发下载"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setExportTarget("csv")}
            className="inline-flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
          >
            <FileText className="size-4" aria-hidden />
            导出 CSV
          </button>
          <button
            type="button"
            onClick={() => setExportTarget("json")}
            className="inline-flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-border) px-4 text-sm font-medium transition-colors hover:border-(--color-border-strong)"
          >
            <FileJson className="size-4" aria-hidden />
            导出 JSON
          </button>
        </div>
      </SectionCard>

      {/* 通知开关 */}
      <SectionCard
        icon={Bell}
        title="通知"
        sub="偏好只写 localStorage（spendct:notif:v1），不离开本机"
      >
        <div className="divide-y divide-(--color-border)">
          <SwitchRow
            label="订阅扣费临近"
            desc="下次扣费前 1 天提醒"
            checked={notif.subDue}
            onChange={(next) => updateNotif({ subDue: next })}
          />
          <SwitchRow
            label="预算超支"
            desc="类目支出超出预算时提醒"
            checked={notif.budgetOver}
            onChange={(next) => updateNotif({ budgetOver: next })}
          />
          <SwitchRow
            label="断点续跑"
            desc="检测到未完成的体检时提醒"
            checked={notif.resume}
            onChange={(next) => updateNotif({ resume: next })}
          />
        </div>
      </SectionCard>

      {/* 偏好 */}
      <SectionCard icon={Sun} title="偏好" sub="主题、演示模式与显示选项">
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
              label="演示模式"
              desc="全局使用演示数据（评审演示用，可随时关闭）"
              checked={demoMode}
              onChange={setDemoMode}
            />
            <SwitchRow
              label="商户名明文还原"
              desc="商户笔数 ≥5 时显示原始商户名（默认显示脱敏哈希）"
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
      <SectionCard icon={Info} title="关于" sub="版本与常用链接">
        <div className="flex items-center gap-3">
          <HeartPulse className="size-8 text-(--color-health)" aria-hidden />
          <div>
            <p className="font-bold text-(--color-ink)">消费CT · SpendCT</p>
            <p className="text-xs text-(--color-ink-muted)">v0.1.0</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-(--color-ink-secondary)">
          Next.js 16 · React 19 · DuckDB-WASM · ECharts 6 —— 账单明细只在本机计算
        </p>
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
              P2
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
          onConfirm={handleExport}
          onClose={() => setExportTarget(null)}
        />
      ) : null}
      {deleteBookTarget ? (
        <ConfirmModal
          title="删除数据集？"
          description={
            <>
              将删除数据集「{deleteBookTarget.name}」的记录，不可撤销。请确认不再需要该数据集。
            </>
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
