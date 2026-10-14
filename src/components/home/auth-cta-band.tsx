"use client";

import Link from "next/link";
import { useAuth } from "@/lib/account/store";
import { Container } from "@/components/layout/container";

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-white px-8 text-sm font-medium text-(--color-brand-700) transition hover:bg-white/90";

const OUTLINE_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-white/60 px-8 text-sm font-medium text-white transition hover:bg-white/10";

/**
 * 首页底部收口带：渐变底大卡，按登录态切换文案与按钮。
 * 会话恢复完成前渲染等高占位，避免两套文案闪跳。
 */
export function AuthCtaBand() {
  const { status, user } = useAuth();
  const authed = status === "authed" && user;

  return (
    <section aria-label="开始体检" className="pb-16 sm:pb-20">
      <Container>
        <div className="rounded-(--radius-card) bg-linear-to-br from-(--color-primary) to-(--color-brand-700) px-6 py-12 text-center sm:px-12 sm:py-16">
          {status === "loading" ? (
            <div className="min-h-32" aria-hidden />
          ) : authed ? (
            <>
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                欢迎回来，{user.nickname || user.username}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
                你的账本、体检结果和分析结论都还在——继续上次的分析，或开始一次新的体检。
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/me" className={PRIMARY_BUTTON}>
                  进入个人中心
                </Link>
                <Link href="/upload" className={OUTLINE_BUTTON}>
                  开始体检
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                免费开始你的账单体检
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
                不用注册任何开发者账号，账单明细也不会离开你的浏览器。体检跑完，每一条结论立刻可见，还能继续追问。
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/register" className={PRIMARY_BUTTON}>
                  免费注册
                </Link>
                <Link href="/login" className={OUTLINE_BUTTON}>
                  已有账号，登录
                </Link>
              </div>
            </>
          )}
        </div>
      </Container>
    </section>
  );
}
