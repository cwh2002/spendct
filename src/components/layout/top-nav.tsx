"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check, HeartPulse, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Container } from "./container";
import { ThemeToggle } from "./theme-toggle";
import { readPausedCheckpoint } from "@/components/checkup/checkpoint-bar";
import { useAuth } from "@/lib/account/store";
import { DEMO_SUBSCRIPTIONS } from "@/lib/demo-data";
import {
  buildBudgetSnapshot,
  countUnread,
  deriveNotifications,
  loadRealNotifData,
  markAllNotifRead,
  markNotifRead,
  readBudgetOverrides,
  readManualEntries,
  readNotifStorage,
  type NotificationItem,
  type NotifBudgetSnapshot,
  type NotifSubscription,
} from "@/lib/notifications";
import { usePipeline, type LastRunSummary } from "@/lib/pipeline/store";
import { useMounted } from "@/lib/use-mounted";

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/upload", label: "体检" },
  { href: "/insights?view=ledger", label: "账本" },
  // 订阅雷达已并入洞察页第 5 视图（/insights?view=subscriptions），
  // 顶栏入口让位给消费日历页（A15 第四部分）
  { href: "/calendar", label: "日历" },
  { href: "/report", label: "报告" },
  // 以下三项为 A17 修订新增（放在「报告」之后）
  { href: "/challenge", label: "挑战" },
  { href: "/goals", label: "攒钱" },
  { href: "/poster", label: "海报" },
] as const;

/**
 * 路由激活判断：带查询参数的入口（如 /insights?view=ledger）只比较路径部分，
 * 首页必须精确匹配，否则 "/" 前缀会吞掉所有路由。
 */
function isActivePath(pathname: string, href: string): boolean {
  const target = href.split("?")[0] ?? href;
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
}

function NavLinks({ className }: { className: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className={className}>
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-full items-center px-2 text-sm font-medium transition-colors lg:px-3 ${
              active
                ? "text-(--color-primary)"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {item.label}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-(--color-primary)"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function AuthArea() {
  const { status, user } = useAuth();

  // 会话恢复完成前不渲染，避免登录按钮与头像之间闪跳
  if (status === "loading") return null;

  if (status === "authed" && user) {
    const name = user.nickname || user.username;
    return (
      <Link
        href="/me"
        title="个人中心"
        className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-full bg-linear-to-br from-(--color-primary) to-(--color-brand-700) text-sm font-semibold text-white"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-24 truncate text-sm font-medium lg:inline">{name}</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1 md:gap-2">
      <Link
        href="/login"
        className="rounded-full px-3 py-2 text-sm font-medium text-(--color-brand-600) transition-colors hover:bg-(--color-primary-soft)"
      >
        登录
      </Link>
      <Link
        href="/register"
        // 8 项入口后注册按钮延后到 lg 断点（宽度预算见 NavLinks 注释）
        className="hidden h-9 items-center rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) lg:inline-flex"
      >
        注册
      </Link>
    </div>
  );
}

/** 通知时间展示：今天的显示「HH:mm」，更早的显示「M月D日」 */
function formatNotifTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 顶栏通知铃铛（F13）：
 * 三类通知（订阅临近扣费 / 预算使用率 / 断点续跑）全部由本地数据派生，
 * 无任何网络请求；开关与已读 id 共用 localStorage 单键（spendct:notif:v1）。
 * 真实体检完成后从 DuckDB 拉订阅与预算快照，尚未体检时走内置数据口径。
 */
/** 挂载前的派生结果：首帧两端同口径渲染空铃铛（不读任何本地存储） */
const EMPTY_NOTIFS: NotificationItem[] = [];

function NotificationBell() {
  const lastRun = usePipeline((s) => s.lastRun);
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState(() => readNotifStorage());
  // 真实数据异步加载：记录来源 run，只有与当前 lastRun 同源才采用，
  // 避免上一次体检的数据渲染到新结果上（subscriptions 页同款口径）
  const [realData, setRealData] = useState<{
    run: LastRunSummary;
    subs: NotifSubscription[];
    budget: NotifBudgetSnapshot | null;
  } | null>(null);

  // 体检结果切换时在渲染期同步清空：不在 effect 里同步 setState 触发级联
  // 渲染（React 官方「按 props 调整 state」模式），下方 memo 的 run 身份比对兜底
  const [dataRun, setDataRun] = useState(lastRun);
  if (dataRun !== lastRun) {
    setDataRun(lastRun);
    setRealData(null);
  }

  useEffect(() => {
    if (!lastRun) return;
    let cancelled = false;
    loadRealNotifData()
      .then((data) => {
        if (!cancelled) setRealData({ run: lastRun, ...data });
      })
      .catch(() => {
        // 拉取失败按「无订阅、无预算」处理：内置通知不会混进真实模式
        if (!cancelled) setRealData({ run: lastRun, subs: [], budget: null });
      });
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 下拉展开期间按 Escape 收起
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items = useMemo<NotificationItem[]>(() => {
    // 挂载前不派生：断点/预算覆盖/手动记账/已读集都来自本地存储，
    // 派生还依赖系统时钟（notifId 按本机日历日生成），服务器与客户端
    // 口径可能不同；首帧两端统一渲染空铃铛，挂载后再按真实存储派生
    if (!mounted) return EMPTY_NOTIFS;
    const checkpoint = readPausedCheckpoint();
    // 真实口径：数据与当前体检结果同源才采用
    if (realData && realData.run === lastRun) {
      return deriveNotifications({
        subscriptions: realData.subs,
        budget: realData.budget,
        checkpoint,
        settings: storage.settings,
      });
    }
    // 内置/加载中口径：订阅取内置订阅的固定倒计时，预算按内置月支出 + 手动记账快照
    return deriveNotifications({
      subscriptions: DEMO_SUBSCRIPTIONS.map((sub) => ({
        id: sub.id,
        amountCents: sub.amountCents,
        nextChargeInDays: sub.nextChargeInDays,
      })),
      budget: buildBudgetSnapshot({
        category90d: null,
        windowMonths: 3,
        overrides: readBudgetOverrides(),
        manualEntries: readManualEntries(),
      }),
      checkpoint,
      settings: storage.settings,
    });
  }, [realData, lastRun, storage, mounted]);

  const unread = countUnread(items, storage.read);

  return (
    <div className="relative">
      <button
        type="button"
        title="通知中心"
        aria-label={unread > 0 ? `通知中心，${unread} 条未读` : "通知中心"}
        aria-expanded={open}
        onClick={() => {
          // 每次展开重读存储：设置页的开关改动会即时反映到派生结果
          setStorage(readNotifStorage());
          setOpen((v) => !v);
        }}
        className="relative grid size-10 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-(--color-alert) px-1 text-[10px] leading-4 font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* 透明遮罩承接外部点击关闭（面板自身点击不冒泡到遮罩） */}
          <div
            aria-hidden
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-lg">
            <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
              <span className="text-sm font-semibold">通知中心</span>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    markAllNotifRead(items.map((i) => i.id));
                    setStorage(readNotifStorage());
                  }}
                  className="flex items-center gap-1 text-xs text-(--color-primary) transition-colors hover:underline"
                >
                  <Check className="size-3.5" aria-hidden />
                  全部已读
                </button>
              ) : null}
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  暂无通知
                </li>
              ) : (
                items.map((item) => {
                  const isRead = storage.read.includes(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          // 点击即标记已读：同一天同一规则只出一条，读一次即消
                          markNotifRead(item.id);
                          setStorage(readNotifStorage());
                        }}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <span
                          aria-hidden
                          className={`mt-1.5 size-2 shrink-0 rounded-full ${
                            isRead ? "bg-transparent" : "bg-(--color-primary)"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {item.body}
                          </span>
                          <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
                            {formatNotifTime(item.ts)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-surface)/85 backdrop-blur-md">
      <Container>
        <div className="flex h-14 items-center gap-3 md:h-16">
          <Link href="/" aria-label="消费CT 首页" className="flex items-center gap-2">
            <HeartPulse className="size-6 text-(--color-health)" aria-hidden />
            <span className="text-lg font-bold tracking-tight">消费CT</span>
          </Link>

          {/* 移动端隐藏：分段导航由底部 tab bar 承担（05 §1.1）。
              8 项入口的宽度预算（A17 三新页）：md 断点链接 px-2、隐私文案
              缩成图标、注册按钮隐藏（lg 恢复），左右两侧合计约 670px < 768px */}
          <NavLinks className="hidden h-full flex-1 items-center justify-center gap-1 md:flex" />

          <div className="ml-auto flex items-center gap-1 md:gap-2">
            <Link
              href="/privacy"
              className="flex items-center gap-1 rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-(--color-border-strong) dark:text-slate-300"
            >
              <Lock className="size-3.5" aria-hidden />
              {/* 8 项入口后文案只在 xl 断点展示，md/lg 只留图标（宽度预算见 NavLinks 注释） */}
              <span className="hidden xl:inline">本地计算 · 零存储</span>
            </Link>
            <ThemeToggle />
            <NotificationBell />
            <AuthArea />
          </div>
        </div>
      </Container>
    </header>
  );
}
