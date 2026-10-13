"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/account/store";

/**
 * Hero 区的登录态感知行：未登录给「登录 / 免费注册」小按钮，
 * 已登录显示欢迎语 + 头像入口。
 * 会话恢复完成前渲染等高占位，避免按钮与头像之间闪跳。
 */
export function HeroAuthArea() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <div className="h-11" aria-hidden />;
  }

  if (status === "authed" && user) {
    const name = user.nickname || user.username;
    return (
      <Link
        href="/me"
        className="group inline-flex h-11 items-center gap-2.5 rounded-full border border-(--color-border) bg-(--color-surface) py-1 pr-4 pl-1.5 transition hover:border-(--color-primary) hover:shadow-(--shadow-sm)"
      >
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-full bg-linear-to-br from-(--color-primary) to-(--color-brand-700) text-sm font-semibold text-white"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-sm font-medium text-(--color-ink)">欢迎回来，{name}</span>
        <ChevronRight
          className="size-4 text-(--color-ink-muted) transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="inline-flex h-11 items-center rounded-full px-5 text-sm font-medium text-(--color-brand-600) transition hover:bg-(--color-primary-soft)"
      >
        登录
      </Link>
      <Link
        href="/register"
        className="inline-flex h-11 items-center rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition hover:bg-(--color-btn-primary-hover)"
      >
        免费注册
      </Link>
    </div>
  );
}
