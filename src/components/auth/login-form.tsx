"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { AccountError } from "@/lib/account/types";
import { useAuth } from "@/lib/account/store";
import { PasswordInput } from "./password-input";
import { TrustBar } from "./trust-bar";

interface FormError {
  message: string;
  /** 需要红边高亮的字段 */
  fields: ReadonlyArray<"username" | "password">;
}

/**
 * 受保护页面跳转来的 next 参数消毒：只放行站内相对路径，
 * 拦截 "//外部域名" 与 "https://..." 之类的开放跳转。
 */
function resolveNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
    return raw;
  }
  return "/me";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuth((state) => state.login);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);

  const next = resolveNext(searchParams.get("next"));
  // 跨页传递回跳参数：注册完成后仍能回到最初想去的页面
  const registerHref = `/register${next !== "/me" ? `?next=${encodeURIComponent(next)}` : ""}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setFormError({ message: "请输入用户名", fields: ["username"] });
      return;
    }
    if (!password) {
      setFormError({ message: "请输入密码", fields: ["password"] });
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      await login(trimmedUsername, password, remember);
      router.push(next);
      // 跳转后组件卸载，不再重置 submitting，避免短暂闪现旧表单
    } catch (error) {
      if (error instanceof AccountError) {
        // 账号密码类错误统一红边用户名与密码两个输入框
        setFormError({ message: error.message, fields: ["username", "password"] });
      } else {
        setFormError({ message: "登录失败，请稍后重试", fields: [] });
      }
      setSubmitting(false);
    }
  }

  const usernameInvalid = formError?.fields.includes("username") ?? false;
  const passwordInvalid = formError?.fields.includes("password") ?? false;

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">欢迎回来</h1>
        <p className="mt-2 text-sm text-(--color-ink-secondary)">
          登录后查看你的体检报告、订阅雷达与年度账单
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-(--radius-md) bg-(--color-critical) px-3.5 py-2.5 text-sm text-white"
          >
            <AlertCircle className="mt-0.5 size-4.5 shrink-0" aria-hidden />
            <span>{formError.message}</span>
          </div>
        ) : null}

        <div>
          <label htmlFor="login-username" className="text-sm font-medium text-(--color-ink)">
            用户名
          </label>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="3-20 位小写字母、数字或下划线"
            autoComplete="username"
            disabled={submitting}
            aria-invalid={usernameInvalid || undefined}
            className={`mt-1.5 h-11 w-full rounded-(--radius-md) border bg-(--color-surface) px-3.5 text-base text-(--color-ink) transition-colors placeholder:text-(--color-ink-muted) focus-visible:ring-2 focus-visible:ring-(--color-primary) disabled:opacity-50 ${
              usernameInvalid ? "border-(--color-critical)" : "border-(--color-border)"
            }`}
          />
        </div>

        <div>
          <label htmlFor="login-password" className="text-sm font-medium text-(--color-ink)">
            密码
          </label>
          <div className="mt-1.5">
            <PasswordInput
              id="login-password"
              value={password}
              onChange={setPassword}
              placeholder="请输入密码"
              autoComplete="current-password"
              disabled={submitting}
              invalid={passwordInvalid}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-(--color-ink-secondary)">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={submitting}
              className="size-4 rounded-sm accent-(--color-primary)"
            />
            记住我
          </label>
          <span className="text-xs text-(--color-ink-muted)">30 天内免登录</span>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-md) bg-(--color-btn-primary) text-[15px] font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <LoaderCircle className="size-4.5 animate-spin" aria-hidden />
              登录中…
            </>
          ) : (
            "登录"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-(--color-ink-secondary)">
        还没有账户？
        <Link
          href={registerHref}
          className="ml-1 font-medium text-(--color-brand-600) underline-offset-2 transition-colors hover:underline"
        >
          去注册
        </Link>
      </p>

      <TrustBar />
    </>
  );
}
