"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Database,
  FileSpreadsheet,
  GraduationCap,
  LogOut,
  Pencil,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Trophy,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AuthGuard } from "@/components/auth/route-guard";
import { AchievementWall } from "@/components/achievements/achievement-wall";
import { Container } from "@/components/layout/container";
import { LocalDataBanner } from "@/components/me/local-data-banner";
import { ACHIEVEMENT_DEFS, useUnlockedIds } from "@/lib/achievements";
import { PBKDF2_ITERATIONS, hashPassword, validateNickname, validatePassword } from "@/lib/account/auth";
import { deleteBook, listBooks, openDb, upsertUser } from "@/lib/account/db";
import { useAuth } from "@/lib/account/store";
import type { BookRecord, UserRecord } from "@/lib/account/types";
import { DEMO_ACCOUNT_META } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { featureFlags } from "@/lib/feature-flags";
import { discardDatasetForBook } from "@/lib/persistence/pipeline-persistence";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import { useRankTier } from "@/lib/rank";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

/** 当前激活账本在本机存储中的键，与数据管理页共用 */
const ACTIVE_BOOK_KEY = "spendct:active-book";

/** 演示口径的累计体检次数：与演示成就解锁状态一致；正式接入后由体检记录统计 */
const DEMO_CHECKUP_COUNT = 3;

/* ---------------- 数据概览真实统计（DuckDB 白名单聚合） ---------------- */

/**
 * 三条聚合 SQL 均为代码常量（07 §6 文法：必须 GROUP BY，行数 ≤50）：
 * - 累计笔数：按 direction 分组计数后求和（含收入/退款行，与内置 793 笔同口径）；
 * - 本月支出：账单最近一个月的支出合计；
 * - 累计结余：全部月份的收入 − 支出。
 */
const SQL_TOTAL_TX = "SELECT direction, COUNT(*) FROM transactions GROUP BY direction";
const SQL_LATEST_MONTH =
  "SELECT month, SUM(expense_cents) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 1";
const SQL_TOTALS =
  "SELECT month, SUM(income_cents), SUM(expense_cents) FROM v_monthly_summary GROUP BY month";

/**
 * DuckDB 聚合值兜底转数值（与账本页同口径）：BIGINT → bigint、INTEGER → number、
 * HUGEINT/SUM → 128 位大数对象（Number() 经 valueOf 转数值）。不可解析时兜底 0。
 */
function toCents(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** 真实统计结果：以 lastRun 对象身份打标，运行切换后旧批次整体失效 */
interface RealStats {
  run: LastRunSummary;
  txCount: number | null;
  monthExpenseCents: number | null;
  surplusCents: number | null;
}

function readActiveBookId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_BOOK_KEY);
  } catch {
    return null;
  }
}

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
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

/** 新盐：16 字节随机 hex，与注册流程同规格（修改密码时更换盐，避免同密码同哈希） */
function randomSaltHex(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  let out = "";
  for (const byte of salt) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/* ---------------- 数据概览 KPI ---------------- */

interface StatTileProps {
  label: string;
  icon: LucideIcon;
  value: number;
  format: (value: number) => string;
  hint: string;
}

/**
 * KPI 数字块：600ms 缓动滚动到目标值；系统开启「减少动态效果」时
 * 直接渲染终值，跳过动画。
 */
function StatTile({ label, icon: Icon, value, format, hint }: StatTileProps) {
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(0);
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    if (reduced) return; // 系统要求减少动态效果：渲染期直接显示终值，跳过动画
    const controls = animate(motionValue, value, { duration: 0.6, ease: "easeOut" });
    return () => controls.stop();
  }, [reduced, motionValue, value]);

  // 动画帧回调更新展示值；回调来自外部动画系统，符合 effect 订阅模式
  useMotionValueEvent(motionValue, "change", (latest) => {
    setAnimatedValue(latest);
  });

  const text = format(reduced ? value : animatedValue);

  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-(--color-ink-secondary)">{label}</span>
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-full bg-(--color-primary-soft) text-(--color-primary)"
        >
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold text-(--color-ink) tabular-nums md:text-[28px]">
        {text}
      </p>
      <p className="mt-1 text-xs text-(--color-ink-muted)">{hint}</p>
    </div>
  );
}

/* ---------------- 弹层基座 ---------------- */

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** 页面内弹层：移动端底部抽屉、桌面居中；打开时锁定背景滚动，Esc 或遮罩关闭 */
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

/* ---------------- 编辑资料弹层 ---------------- */

const inputClass =
  "h-11 w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-ink) placeholder:text-(--color-ink-muted) focus:border-(--color-primary)";

interface EditProfileModalProps {
  user: UserRecord;
  onClose: () => void;
  /** 保存成功后回传更新记录：父层写入 store 并关闭弹层 */
  onSaved: (updated: UserRecord) => void;
}

/**
 * 编辑资料：昵称走 upsertUser 落库；密码修改在弹层内闭环
 * （旧密码校验 → 新盐重哈希 → upsertUser），账户模块暂不提供独立改密接口。
 */
function EditProfileModal({ user, onClose, onSaved }: EditProfileModalProps) {
  const [nickname, setNickname] = useState(user.nickname);
  const [nicknameMsg, setNicknameMsg] = useState<string | null>(null);
  const [nicknameBusy, setNicknameBusy] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function saveNickname() {
    setNicknameMsg(null);
    const trimmed = nickname.trim();
    try {
      validateNickname(trimmed);
    } catch (error) {
      setNicknameMsg(error instanceof Error ? error.message : "昵称不合法");
      return;
    }
    if (trimmed === user.nickname) {
      setNicknameMsg("昵称没有变化");
      return;
    }
    setNicknameBusy(true);
    try {
      const updated: UserRecord = { ...user, nickname: trimmed };
      await upsertUser(updated);
      onSaved(updated);
    } catch {
      setNicknameMsg("保存失败，请重试");
      setNicknameBusy(false);
    }
  }

  async function savePassword() {
    setPasswordMsg(null);
    if (!oldPassword) {
      setPasswordMsg("请输入旧密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg("两次输入的新密码不一致");
      return;
    }
    try {
      validatePassword(newPassword);
    } catch (error) {
      setPasswordMsg(error instanceof Error ? error.message : "新密码不符合要求");
      return;
    }
    setPasswordBusy(true);
    try {
      const oldHash = await hashPassword(oldPassword, user.salt, user.iterations);
      if (oldHash !== user.passwordHash) {
        setPasswordMsg("旧密码不正确");
        setPasswordBusy(false);
        return;
      }
      const salt = randomSaltHex();
      const passwordHash = await hashPassword(newPassword, salt, PBKDF2_ITERATIONS);
      const updated: UserRecord = { ...user, salt, passwordHash, iterations: PBKDF2_ITERATIONS };
      await upsertUser(updated);
      onSaved(updated);
    } catch {
      setPasswordMsg("保存失败，请重试");
      setPasswordBusy(false);
    }
  }

  return (
    <Modal title="编辑资料" onClose={onClose}>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="edit-nickname" className="block text-sm font-medium">
            昵称
          </label>
          <input
            id="edit-nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={16}
            autoComplete="nickname"
            className={`mt-1.5 ${inputClass}`}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            {nicknameMsg ? (
              <p role="status" className="text-xs text-(--color-critical-ink)">
                {nicknameMsg}
              </p>
            ) : (
              <p className="text-xs text-(--color-ink-muted)">1-16 个字符，仅保存在本机</p>
            )}
            <button
              type="button"
              onClick={() => void saveNickname()}
              disabled={nicknameBusy}
              className="inline-flex h-11 shrink-0 items-center rounded-(--radius-md) bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:opacity-60"
            >
              保存昵称
            </button>
          </div>
        </div>

        <hr className="border-(--color-border)" />

        <div>
          <p className="text-sm font-medium">修改密码</p>
          <div className="mt-2 space-y-2.5">
            <input
              type="password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              placeholder="旧密码"
              autoComplete="current-password"
              aria-label="旧密码"
              className={inputClass}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="新密码（至少 6 位，含字母与数字）"
              autoComplete="new-password"
              aria-label="新密码"
              className={inputClass}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="确认新密码"
              autoComplete="new-password"
              aria-label="确认新密码"
              className={inputClass}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            {passwordMsg ? (
              <p role="status" className="text-xs text-(--color-critical-ink)">
                {passwordMsg}
              </p>
            ) : (
              <p className="text-xs text-(--color-ink-muted)">修改后立即生效</p>
            )}
            <button
              type="button"
              onClick={() => void savePassword()}
              disabled={passwordBusy}
              className="inline-flex h-11 shrink-0 items-center rounded-(--radius-md) bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:opacity-60"
            >
              更新密码
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- 删除确认弹层 ---------------- */

interface ConfirmModalProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** 二次确认弹层：危险操作统一走这里，确认按钮红色 */
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

/* ---------------- 删除账户确认弹层（输入昵称确认） ---------------- */

interface DangerAccountModalProps {
  expectedNickname: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** 危险操作按商业惯例要求输入昵称确认，避免误触直接清空本地账户 */
function DangerAccountModal({ expectedNickname, busy, onConfirm, onClose }: DangerAccountModalProps) {
  const [value, setValue] = useState("");
  const confirmed = value.trim() === expectedNickname;

  return (
    <Modal title="删除本地账户数据" onClose={onClose}>
      <p className="mt-3 text-sm leading-relaxed text-(--color-ink-secondary)">
        此操作将删除当前账户记录、会话与个人配置，不可撤销。已上传的账单保留在浏览器本地，不受影响。
      </p>
      <label htmlFor="confirm-nickname" className="mt-4 block text-sm font-medium">
        输入「{expectedNickname}」以确认
      </label>
      <input
        id="confirm-nickname"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={expectedNickname}
        autoComplete="off"
        className={`mt-1.5 ${inputClass}`}
      />
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
          disabled={!confirmed || busy}
          className="inline-flex h-11 items-center rounded-(--radius-md) bg-(--color-critical) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          确认删除
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 快捷入口 ---------------- */

interface QuickLinkDef {
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** 关联功能开关：关闭时灰显「即将上线」 */
  flag?: keyof typeof featureFlags;
  /** 「新功能」角标 */
  isNew?: boolean;
}

const QUICK_LINKS: readonly QuickLinkDef[] = [
  { href: "/budget", label: "预算中心", desc: "12 类预算环与超支提醒", icon: Wallet, flag: "budget" },
  { href: "/settings", label: "数据管理", desc: "账单 · 导出 · 偏好", icon: Database },
  { href: "/learn", label: "知识课堂", desc: "订阅陷阱与维权案例", icon: GraduationCap, flag: "learn", isNew: true },
  { href: "/report", label: "年度报告", desc: "消费年报与年度海报", icon: BarChart3 },
  { href: "/insights?view=subscriptions", label: "订阅雷达", desc: "连续扣费监控与倒计时", icon: BellRing },
  { href: "/privacy", label: "隐私说明", desc: "数据可见性对照表", icon: ShieldCheck },
];

/* ---------------- 页面主体 ---------------- */

function SectionHeading({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-5 text-(--color-primary)" aria-hidden />
      <div>
        <h2 className="text-lg font-bold text-(--color-ink)">{title}</h2>
        <p className="text-xs text-(--color-ink-muted)">{sub}</p>
      </div>
    </div>
  );
}

function MeContent() {
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const router = useRouter();

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
        // IndexedDB 不可用时按空账本展示，不阻塞页面其余内容
        return [];
      }
    },
    enabled: user !== null,
  });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteBookTarget, setDeleteBookTarget] = useState<BookRecord | null>(null);
  const [deleteBookBusy, setDeleteBookBusy] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // 成就与段位都属客户端本地数据：订阅式读取，SSR 首帧与服务器同口径
  const unlockedIds = useUnlockedIds();
  const rank = useRankTier();

  // 数据概览真实统计：体检后按 lastRun 从 DuckDB 装载；渲染期按 run 身份
  // 同步清空（不在 effect 里同步 setState），未体检/查询失败保持内置口径
  const lastRun = usePipeline((s) => s.lastRun);
  const [realStats, setRealStats] = useState<RealStats | null>(null);
  const [statsRun, setStatsRun] = useState(lastRun);
  if (statsRun !== lastRun) {
    setStatsRun(lastRun);
    setRealStats(null);
  }

  useEffect(() => {
    if (!lastRun) return;
    let cancelled = false;
    void (async () => {
      const conn = await getDuckDB();
      // 单块查询失败只影响该块，其余保持真实值（与账本页同款模块级降级）
      const load = async <T,>(
        sql: string,
        map: (rows: Record<string, unknown>[]) => T,
      ): Promise<T | null> => {
        try {
          const result = await runWhitelistedAggregate(conn, sql);
          return map(result.rows as Record<string, unknown>[]);
        } catch {
          return null;
        }
      };
      const [txCount, monthExpenseCents, surplusCents] = await Promise.all([
        load(SQL_TOTAL_TX, (rows) => rows.reduce((sum, row) => sum + toCents(Object.values(row)[1]), 0)),
        load(SQL_LATEST_MONTH, (rows) =>
          rows[0] ? toCents(Object.values(rows[0] ?? {})[1]) : null,
        ),
        load(SQL_TOTALS, (rows) => {
          let income = 0;
          let expense = 0;
          for (const row of rows) {
            const values = Object.values(row);
            income += toCents(values[1]);
            expense += toCents(values[2]);
          }
          return income - expense;
        }),
      ]);
      if (!cancelled) setRealStats({ run: lastRun, txCount, monthExpenseCents, surplusCents });
    })().catch(() => {
      // DuckDB 不可用（数据库未落库等）时保持内置口径，不阻塞页面
    });
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 瓦片数据源：真实统计与当前体检结果同源才采用，否则回退内置数据
  const stats = realStats && realStats.run === lastRun ? realStats : null;

  const handleProfileSaved = useCallback(
    (updated: UserRecord) => {
      // hydrate 有单次执行守卫，不会重读库；直接写 store 刷新当前会话的用户
      useAuth.setState({ user: updated });
      setEditOpen(false);
      showToast("资料已更新");
    },
    [showToast],
  );

  function setActiveBook(id: string) {
    try {
      localStorage.setItem(ACTIVE_BOOK_KEY, id);
    } catch {
      // 隐私模式禁 localStorage：本次会话内仍可切换，仅不持久化
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
      // 账本删除即数据删除（08 修订案 A18）：联动清除本地持久化的数据集与体检结果
      await discardDatasetForBook(target.id);
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
      showToast(`已删除账本「${target.name}」`);
    } catch {
      setDeleteBookBusy(false);
      showToast("删除失败，请重试");
    }
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  async function handleDeleteAccount() {
    if (!user) return;
    setDangerBusy(true);
    try {
      const db = await openDb();
      // 清空该账户的会话与用户记录；books 数据集按约定保留
      const tx = db.transaction("sessions", "readwrite");
      const sessionKeys = await tx.store.index("by-userId").getAllKeys(user.id);
      for (const key of sessionKeys) {
        await tx.store.delete(key);
      }
      await tx.done;
      await db.delete("users", user.id);
      await logout();
      router.replace("/login");
    } catch {
      setDangerBusy(false);
      showToast("删除失败，请重试");
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-8 pb-4">
      {/* 页面头 */}
      <header>
        <h1 className="text-2xl font-bold text-(--color-ink)">个人中心</h1>
        <p className="mt-1 text-sm text-(--color-ink-secondary)">
          账户、成就与账本一览——所有数据只保存在你的浏览器里
        </p>
      </header>

      {/* 账本归属提示：说明「换账户不会换账本」，可直接关闭 */}
      <LocalDataBanner />

      {/* 账户卡 */}
      <section
        aria-label="账户信息"
        className="relative overflow-hidden rounded-(--radius-xl) bg-linear-to-br from-(--color-primary) to-(--color-brand-700) p-6 text-white shadow-(--shadow-md) md:p-8"
      >
        {/* 装饰圆：纯视觉层次，不承载信息 */}
        <div aria-hidden className="absolute -top-16 -right-16 size-52 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -right-8 -bottom-24 size-44 rounded-full bg-white/5" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="grid size-[60px] shrink-0 place-items-center rounded-full bg-white/20 text-2xl font-bold ring-2 ring-white/40"
            >
              {(user.nickname || "U").slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h2 className="truncate text-xl font-bold md:text-2xl">{user.nickname}</h2>
                <span className="font-(--font-mono) text-sm text-white/70">@{user.username}</span>
                {/* 段位徽章：title 承载段位说明，屏幕阅读器可读 */}
                <span
                  title={rank.desc}
                  className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium ring-1 ring-white/25"
                >
                  <Trophy className="size-3.5" aria-hidden />
                  {rank.name}
                  <span className="text-white/60">Lv.{rank.tier}</span>
                </span>
              </div>
              <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-white/80">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4" aria-hidden />
                  {formatDate(user.createdAt)} 注册
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Stethoscope className="size-4" aria-hidden />
                  体检 {DEMO_CHECKUP_COUNT} 次
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Trophy className="size-4" aria-hidden />
                  解锁成就 {unlockedIds.length} 枚
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-full bg-white/15 px-4 font-medium transition-colors hover:bg-white/25 sm:self-auto"
          >
            <Pencil className="size-4" aria-hidden />
            编辑资料
          </button>
        </div>
      </section>

      {/* 数据概览 */}
      <section aria-label="数据概览" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatTile
          label="账本数"
          icon={BookOpen}
          value={books.length}
          format={formatCount}
          hint={booksLoading ? "读取中…" : "保存在本机"}
        />
        <StatTile
          label="累计笔数"
          icon={ReceiptText}
          value={stats?.txCount ?? DEMO_ACCOUNT_META.totalTransactions}
          format={formatCount}
          hint={stats ? "按当前账单统计" : `覆盖 ${DEMO_ACCOUNT_META.monthsCovered} 个月`}
        />
        <StatTile
          label="本月支出"
          icon={Wallet}
          value={stats?.monthExpenseCents ?? DEMO_ACCOUNT_META.currentMonthExpenseCents}
          format={formatYuan}
          hint={stats ? "账单最近一个月" : "内置数据 · 9 月"}
        />
        <StatTile
          label="累计结余"
          icon={PiggyBank}
          value={stats?.surplusCents ?? DEMO_ACCOUNT_META.savedCents}
          format={formatYuan}
          hint={stats ? "收入 − 支出（全部账单）" : "收入 24,000 − 支出 20,800"}
        />
      </section>

      {/* 成就墙 */}
      {featureFlags.achievements ? (
        <section aria-label="成就墙">
          <div className="mb-3">
            <SectionHeading
              icon={Trophy}
              title="成就墙"
              sub={`已解锁 ${unlockedIds.length}/${ACHIEVEMENT_DEFS.length} 枚徽章，完成条件即自动解锁`}
            />
          </div>
          <AchievementWall unlockedIds={unlockedIds} />
        </section>
      ) : null}

      {/* 我的账本 */}
      <section aria-label="我的账本">
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionHeading icon={BookOpen} title="我的账本" sub="上传的账单都归在这里" />
          <Link
            href="/upload"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            上传新账单
          </Link>
        </div>

        {booksLoading ? (
          <div className="space-y-3" aria-label="账本加载中">
            <div className="h-20 animate-pulse rounded-(--radius-lg) bg-(--color-surface-2)" />
            <div className="h-20 animate-pulse rounded-(--radius-lg) bg-(--color-surface-2)" />
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-dashed border-(--color-border-strong) bg-(--color-surface) px-6 py-12 text-center">
            <FileSpreadsheet className="size-8 text-(--color-ink-muted)" aria-hidden />
            <p className="font-medium text-(--color-ink)">还没有账本——去上传第一份账单</p>
            <p className="max-w-sm text-xs text-(--color-ink-muted)">
              支持微信 / 支付宝的账单文件，也可以先用内置账单体验
            </p>
            <Link
              href="/upload"
              className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
            >
              去上传
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {books.map((book) => {
              const isActive = book.id === activeBookId;
              return (
                <li
                  key={book.id}
                  className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-sm) sm:flex-row sm:items-center"
                >
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)"
                  >
                    <BookOpen className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-(--color-ink)" title={book.id}>
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
                        className="inline-flex h-11 items-center rounded-(--radius-md) border border-(--color-primary-soft) bg-(--color-primary-soft) px-3 text-sm font-medium text-(--color-primary)"
                      >
                        当前账本
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
        )}
      </section>

      {/* 快捷入口 */}
      <section aria-label="快捷入口">
        <div className="mb-3">
          <SectionHeading icon={ChevronRight} title="快捷入口" sub="常用功能直达" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {QUICK_LINKS.map((def) => {
            const disabled = def.flag !== undefined && featureFlags[def.flag] === false;
            const iconBox = (
              <span
                aria-hidden
                className="grid size-10 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)"
              >
                <def.icon className="size-5" aria-hidden />
              </span>
            );
            const badge = def.isNew ? (
              <span className="rounded-full bg-(--color-accent)/15 px-1.5 py-0.5 text-[10px] font-semibold text-(--color-accent)">
                新功能
              </span>
            ) : null;
            const content = (
              <>
                {iconBox}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium text-(--color-ink)">
                    {def.label}
                    {badge}
                    {disabled ? (
                      <span className="rounded-full bg-(--color-surface-2) px-1.5 py-0.5 text-[10px] font-medium text-(--color-ink-muted)">
                        即将上线
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-(--color-ink-muted)">
                    {def.desc}
                  </span>
                </span>
              </>
            );
            const sharedClass =
              "flex min-h-[72px] items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-3.5 shadow-(--shadow-sm)";
            return disabled ? (
              <div key={def.href} aria-disabled className={`${sharedClass} opacity-55`}>
                {content}
              </div>
            ) : (
              <Link
                key={def.href}
                href={def.href}
                className={`${sharedClass} transition-colors hover:border-(--color-border-strong)`}
              >
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      {/* 账户操作与危险区 */}
      <section aria-label="账户操作">
        <div className="mb-3">
          <SectionHeading icon={LogOut} title="账户操作" sub="登出或删除本机账户数据" />
        </div>
        <div className="space-y-4">
          <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-5">
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-border) px-4 font-medium transition-colors hover:border-(--color-border-strong)"
            >
              <LogOut className="size-4" aria-hidden />
              登出
            </button>
          </div>
          <div className="rounded-(--radius-card) border border-(--color-critical)/40 bg-(--color-surface) p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-(--color-critical-ink)" aria-hidden />
              <h2 className="text-lg font-bold text-(--color-critical-ink)">删除本地账户数据</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-ink-secondary)">
              删除当前账户、会话与个人配置，不可撤销。已上传的账单保留在浏览器本地，不受影响；重新注册后即可继续使用。
            </p>
            <button
              type="button"
              onClick={() => setDangerOpen(true)}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-(--radius-md) border border-(--color-critical) px-4 font-medium text-(--color-critical-ink) transition-colors hover:bg-(--color-critical)/10"
            >
              <Trash2 className="size-4" aria-hidden />
              删除账户数据
            </button>
          </div>
        </div>
      </section>

      {/* 弹层 */}
      {editOpen ? (
        <EditProfileModal user={user} onClose={() => setEditOpen(false)} onSaved={handleProfileSaved} />
      ) : null}
      {deleteBookTarget ? (
        <ConfirmModal
          title="删除账本？"
          description={
            <>
              将删除账本「{deleteBookTarget.name}」的记录；本地保存的该账本账单数据与体检结果会一并清除。
            </>
          }
          confirmLabel="确认删除"
          busy={deleteBookBusy}
          onConfirm={() => void handleDeleteBook()}
          onClose={() => setDeleteBookTarget(null)}
        />
      ) : null}
      {dangerOpen ? (
        <DangerAccountModal
          expectedNickname={user.nickname}
          busy={dangerBusy}
          onConfirm={() => void handleDeleteAccount()}
          onClose={() => setDangerOpen(false)}
        />
      ) : null}

      {/* 轻提示 */}
      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 truncate rounded-full bg-(--color-ink) px-4 py-2.5 text-sm whitespace-nowrap text-(--color-surface) shadow-(--shadow-lg) md:bottom-8"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export default function MePage() {
  return (
    <AuthGuard>
      <Container wide className="py-6 md:py-10">
        <MeContent />
      </Container>
    </AuthGuard>
  );
}
