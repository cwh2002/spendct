"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BellRing, Home, Upload, UserRound } from "lucide-react";

const TABS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/upload", label: "体检", icon: Upload },
  { href: "/insights?view=ledger", label: "账本", icon: BarChart3 },
  { href: "/subscriptions", label: "订阅", icon: BellRing },
  { href: "/me", label: "我的", icon: UserRound },
] as const;

/** 与顶部导航同规则：查询参数入口只比较路径部分，首页精确匹配 */
function isActivePath(pathname: string, href: string): boolean {
  const target = href.split("?")[0] ?? href;
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
}

/**
 * 移动端底部 tab bar（< md 显示，05 §1.1）。
 * 高 56px + env(safe-area-inset-bottom)：内边距让内容区避开 iPhone 底部手势条，
 * 主内容区在 Shell 里预留 pb-20 防止被遮挡。
 * /budget 与 /learn 不设 tab 项，从首页能力卡与个人中心进入。
 */
export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border) bg-white/95 backdrop-blur-md md:hidden dark:bg-slate-950/95"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex h-14">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  active ? "text-(--color-primary)" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
