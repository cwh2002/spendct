"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountError } from "@/lib/account/types";
import { getUserByUsername } from "@/lib/account/db";
import { useAuth } from "@/lib/account/store";
import { CaptchaField, type CaptchaFieldHandle } from "./captcha-field";
import { PasswordInput } from "./password-input";
import { PasswordStrengthMeter, passwordLevelOf } from "./password-strength-meter";
import { TrustBar } from "./trust-bar";

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

interface FieldErrors {
  username?: string;
  nickname?: string;
  password?: string;
  confirm?: string;
}

/** 与受保护页面守卫一致的 next 消毒：只放行站内相对路径 */
function resolveNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
    return raw;
  }
  return "/me";
}

interface RegisterFormProps {
  /** 演示模式放行验证码（DEMO_MODE=mock 时由服务端组件传入） */
  mockBypass?: boolean;
}

export function RegisterForm({ mockBypass = false }: RegisterFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const register = useAuth((state) => state.register);

  const captchaRef = useRef<CaptchaFieldHandle>(null);
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [usernameChecking, setUsernameChecking] = useState(false);
  /** 已确认被占用的用户名值：只在与当前输入完全一致时展示，编辑后自动失效 */
  const [takenUsername, setTakenUsername] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const next = resolveNext(searchParams.get("next"));
  const loginHref = `/login${next !== "/me" ? `?next=${encodeURIComponent(next)}` : ""}`;

  // 格式错误在渲染期推导，即时反馈，不依赖 effect 同步 setState
  const normalizedUsername = username.trim();
  const formatUsernameError =
    normalizedUsername.length > 0 && !USERNAME_PATTERN.test(normalizedUsername)
      ? "用户名需为 3-20 位小写字母、数字或下划线"
      : null;
  const takenUsernameError = takenUsername === normalizedUsername ? "该用户名已被占用" : null;

  // 用户名查重：输入合法时去抖 300ms 查库；setState 只发生在定时器回调里，
  // effect 主体不写状态，避免级联渲染
  useEffect(() => {
    const normalized = normalizedUsername;
    if (!USERNAME_PATTERN.test(normalized)) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setUsernameChecking(true);
      void getUserByUsername(normalized)
        .then((existing) => {
          // 结果陈旧时仍要收起 spinner；占用标记只在值匹配当前输入时生效
          setUsernameChecking(false);
          if (cancelled) {
            return;
          }
          setTakenUsername(existing ? normalized : null);
        })
        .catch(() => {
          // 本地库不可用时放行，提交阶段由注册接口的查重兜底
          setUsernameChecking(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedUsername]);

  // 注册成功 2 秒后进入个人中心；卸载时清理定时器，防止组件提前销毁后误跳转
  useEffect(() => {
    if (!success) {
      return;
    }
    const timer = setTimeout(() => router.push("/me"), 2000);
    return () => clearTimeout(timer);
  }, [success, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || success) {
      return;
    }
    const trimmedUsername = username.trim();
    const trimmedNickname = nickname.trim();

    const errors: FieldErrors = {};
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      errors.username = "用户名需为 3-20 位小写字母、数字或下划线";
    } else if (takenUsername === trimmedUsername) {
      // 查重结果可能晚于提交（如刚输入就回车），提交前再对一次本地结果
      errors.username = "该用户名已被占用";
    }
    if (trimmedNickname.length < 1 || trimmedNickname.length > 16) {
      errors.nickname = "昵称需为 1-16 个字符";
    }
    if (passwordLevelOf(password) < 1) {
      errors.password = "密码至少 8 位，且同时包含字母与数字";
    }
    if (confirm !== password) {
      errors.confirm = "两次输入的密码不一致";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    // 验证码校验：失败时字段内提示并换图，不产生顶部错误横幅
    if (!captchaRef.current?.verify()) {
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await register({ username: trimmedUsername, nickname: trimmedNickname, password });
      setSuccess(true);
      // 进入成功态后不再重置 submitting：面板已切换，无需恢复表单
    } catch (error) {
      if (error instanceof AccountError) {
        switch (error.code) {
          case "USERNAME_TAKEN":
            setFieldErrors({ username: "该用户名已被占用" });
            break;
          case "USERNAME_INVALID":
            setFieldErrors({ username: error.message });
            break;
          case "NICKNAME_INVALID":
            setFieldErrors({ nickname: error.message });
            break;
          case "WEAK_PASSWORD":
            setFieldErrors({ password: error.message });
            break;
          default:
            setFormError(error.message);
        }
      } else {
        setFormError("注册失败，请稍后重试");
      }
      setSubmitting(false);
    }
  }

  // 展示优先级：提交校验 > 输入格式 > 查重占用；查重进行中先不亮红
  const usernameError = fieldErrors.username ?? formatUsernameError ?? takenUsernameError;
  const usernameInvalid = Boolean(usernameError) && !usernameChecking;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {success ? (
        <motion.div
          key="success"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="text-center"
        >
          {/* 对勾弹入：spring 模拟「盖戳」手感，随后自动跳转 */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 17, duration: 0.28 }}
            className="mx-auto grid size-16 place-items-center rounded-full bg-(--color-good) shadow-(--shadow-md)"
          >
            <Check className="size-8 text-white" strokeWidth={3} aria-hidden />
          </motion.div>
          <h2 className="mt-5 text-xl font-bold tracking-tight">账户创建成功，已自动登录</h2>
          <p className="mt-2 text-sm text-(--color-ink-secondary)">正在进入你的体检中心…</p>

          {/* 首次使用引导：直接加载内置账单，省去自己找 CSV 的步骤 */}
          <div className="mt-6 rounded-(--radius-lg) border border-(--color-border) p-4 text-left">
            <p className="text-sm font-medium text-(--color-ink)">第一次使用？</p>
            <Link
              href="/upload?sample=1"
              className="mt-2.5 flex min-h-11 items-center justify-between gap-2 rounded-(--radius-md) bg-(--color-primary-soft) px-3.5 py-2 text-sm font-medium text-(--color-brand-600) transition-opacity hover:opacity-85"
            >
              加载内置账单，开始第一次体检
              <ArrowRight className="size-4 shrink-0" aria-hidden />
            </Link>
          </div>
        </motion.div>
      ) : (
        <motion.div key="form" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.15 }}>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">创建账户</h1>
            <p className="mt-2 text-sm text-(--color-ink-secondary)">
              账户与账单只存在你的浏览器里，几秒钟即可开始
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
            {formError ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-(--radius-md) bg-(--color-critical) px-3.5 py-2.5 text-sm text-white"
              >
                <AlertCircle className="mt-0.5 size-4.5 shrink-0" aria-hidden />
                <span>{formError}</span>
              </div>
            ) : null}

            <div>
              <label htmlFor="register-username" className="text-sm font-medium text-(--color-ink)">
                用户名
              </label>
              <div className="relative mt-1.5">
                <input
                  id="register-username"
                  type="text"
                  value={username}
                  onChange={(event) => {
                    // 输入即归一化：小写 + 仅字母数字下划线，与存储口径一致
                    setUsername(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "")
                        .slice(0, 20),
                    );
                    // 编辑即清除提交阶段留下的旧错误，让校验提示跟随输入
                    if (fieldErrors.username) {
                      setFieldErrors((previous) => ({ ...previous, username: undefined }));
                    }
                  }}
                  placeholder="3-20 位小写字母、数字或下划线"
                  autoComplete="username"
                  disabled={submitting}
                  aria-invalid={usernameInvalid || undefined}
                  className={`h-11 w-full rounded-(--radius-md) border bg-(--color-surface) px-3.5 pr-11 text-base text-(--color-ink) transition-colors placeholder:text-(--color-ink-muted) focus-visible:ring-2 focus-visible:ring-(--color-primary) disabled:opacity-50 ${
                    usernameInvalid ? "border-(--color-critical)" : "border-(--color-border)"
                  }`}
                />
                {usernameChecking ? (
                  <LoaderCircle
                    className="absolute top-1/2 right-3.5 size-4.5 -translate-y-1/2 animate-spin text-(--color-ink-muted)"
                    aria-label="正在检查用户名"
                  />
                ) : null}
              </div>
              {usernameError && !usernameChecking ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-(--color-critical-ink)">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  {usernameError}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-(--color-ink-muted)">
                  3-20 位小写字母、数字或下划线，注册后不可修改
                </p>
              )}
            </div>

            <div>
              <label htmlFor="register-nickname" className="text-sm font-medium text-(--color-ink)">
                昵称
              </label>
              <input
                id="register-nickname"
                type="text"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="报告上显示的名字，如「小王」"
                autoComplete="nickname"
                disabled={submitting}
                aria-invalid={Boolean(fieldErrors.nickname) || undefined}
                className={`mt-1.5 h-11 w-full rounded-(--radius-md) border bg-(--color-surface) px-3.5 text-base text-(--color-ink) transition-colors placeholder:text-(--color-ink-muted) focus-visible:ring-2 focus-visible:ring-(--color-primary) disabled:opacity-50 ${
                  fieldErrors.nickname ? "border-(--color-critical)" : "border-(--color-border)"
                }`}
              />
              {fieldErrors.nickname ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-(--color-critical-ink)">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  {fieldErrors.nickname}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="register-password" className="text-sm font-medium text-(--color-ink)">
                密码
              </label>
              <div className="mt-1.5">
                <PasswordInput
                  id="register-password"
                  value={password}
                  onChange={setPassword}
                  placeholder="至少 8 位，包含字母与数字"
                  autoComplete="new-password"
                  disabled={submitting}
                  invalid={Boolean(fieldErrors.password)}
                />
              </div>
              {fieldErrors.password ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-(--color-critical-ink)">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  {fieldErrors.password}
                </p>
              ) : (
                <PasswordStrengthMeter password={password} />
              )}
            </div>

            <div>
              <label htmlFor="register-confirm" className="text-sm font-medium text-(--color-ink)">
                确认密码
              </label>
              <div className="mt-1.5">
                <PasswordInput
                  id="register-confirm"
                  value={confirm}
                  onChange={setConfirm}
                  placeholder="再输入一次密码"
                  autoComplete="new-password"
                  disabled={submitting}
                  invalid={Boolean(fieldErrors.confirm)}
                />
              </div>
              {fieldErrors.confirm ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-(--color-critical-ink)">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  {fieldErrors.confirm}
                </p>
              ) : null}
            </div>

            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-2.5 text-sm text-(--color-ink-secondary)">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                disabled={submitting}
                className="mt-0.5 size-4 rounded-sm accent-(--color-primary)"
              />
              <span>
                我已阅读并同意
                <Link
                  href="/privacy"
                  className="mx-0.5 font-medium text-(--color-brand-600) underline-offset-2 hover:underline"
                >
                  隐私说明
                </Link>
                ，知晓账单数据仅存储于本机
              </span>
            </label>

            <div>
              <label htmlFor="register-captcha" className="text-sm font-medium text-(--color-ink)">
                验证码
              </label>
              <div className="mt-1.5">
                <CaptchaField
                  ref={captchaRef}
                  id="register-captcha"
                  mockBypass={mockBypass}
                  disabled={submitting}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!agreed || submitting}
              title={agreed ? undefined : "请先勾选同意隐私说明"}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-md) bg-(--color-btn-primary) text-[15px] font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="size-4.5 animate-spin" aria-hidden />
                  创建中…
                </>
              ) : (
                "创建账户"
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-(--color-ink-secondary)">
            已有账户？
            <Link
              href={loginHref}
              className="ml-1 font-medium text-(--color-brand-600) underline-offset-2 transition-colors hover:underline"
            >
              去登录
            </Link>
          </p>

          <TrustBar />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
