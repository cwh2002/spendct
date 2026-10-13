"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, HeartPulse, Lock } from "lucide-react";
import { Container } from "./container";
import { ThemeToggle } from "./theme-toggle";
import { useAuth } from "@/lib/account/store";

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/upload", label: "体检" },
  { href: "/insights?view=ledger", label: "账本" },
  { href: "/subscriptions", label: "订阅" },
  { href: "/report", label: "报告" },
] as const;

// 未读数占位常量：通知中心落地后改为从通知存储读取
const UNREAD_COUNT = 0;

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
            className={`relative flex h-full items-center px-3 text-sm font-medium transition-colors ${
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
        className="hidden h-9 items-center rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) md:inline-flex"
      >
        注册
      </Link>
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

          {/* 移动端隐藏：分段导航由底部 tab bar 承担（05 §1.1） */}
          <NavLinks className="hidden h-full flex-1 items-center justify-center gap-1 md:flex" />

          <div className="ml-auto flex items-center gap-1 md:gap-2">
            <Link
              href="/privacy"
              className="flex items-center gap-1 rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-(--color-border-strong) dark:text-slate-300"
            >
              <Lock className="size-3.5" aria-hidden />
              <span className="hidden md:inline">数据不出浏览器</span>
            </Link>
            <ThemeToggle />
            <button
              type="button"
              title="通知中心（即将上线）"
              aria-label="通知中心（即将上线）"
              className="relative grid size-10 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Bell className="size-5" aria-hidden />
              {UNREAD_COUNT > 0 ? (
                <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-(--color-alert) px-1 text-[10px] leading-4 font-bold text-white">
                  {UNREAD_COUNT}
                </span>
              ) : null}
            </button>
            <AuthArea />
          </div>
        </div>
      </Container>
    </header>
  );
}
