"use client";

/** 强度档位：0 弱 / 1 中 / 2 强，数值越大越强 */
export type PasswordLevel = 0 | 1 | 2;

const WEAK = {
  label: "弱",
  hint: "至少 8 位，并同时包含字母与数字",
  bar: "bg-(--color-critical)",
  text: "text-(--color-critical-ink)",
} as const;

const MEDIUM = {
  label: "中",
  hint: "已含字母与数字，加入特殊字符（如 !@#）更强",
  bar: "bg-(--color-warning)",
  text: "text-(--color-warning-ink)",
} as const;

const STRONG = {
  label: "强",
  hint: "长度、字母数字与特殊字符齐备",
  bar: "bg-(--color-good)",
  text: "text-(--color-good-ink)",
} as const;

const LEVEL_META = [WEAK, MEDIUM, STRONG] as const;

/** 按档位取文案与配色；枚举分支取值，规避索引越界带来的 undefined 分支 */
function metaFor(level: PasswordLevel): (typeof LEVEL_META)[number] {
  if (level === 2) return STRONG;
  if (level === 1) return MEDIUM;
  return WEAK;
}

/**
 * 客户端密码强度分档：≥8 位且含字母与数字为「中」，再加特殊字符为「强」。
 * 档位规则与注册页提交校验共用，避免两处口径漂移。
 */
export function passwordLevelOf(password: string): PasswordLevel {
  const longEnough = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!(longEnough && hasLetter && hasDigit)) {
    return 0;
  }
  return /[^a-zA-Z0-9]/.test(password) ? 2 : 1;
}

/**
 * 三档色条 + 当前档位说明。密码为空时不渲染（表单尚未开始填写）。
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (password.length === 0) {
    return null;
  }
  const level = passwordLevelOf(password);
  const meta = metaFor(level);

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden>
        {LEVEL_META.map((_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index <= level ? meta.bar : "bg-(--color-surface-2)"
            }`}
          />
        ))}
      </div>
      <p className={`mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs ${meta.text}`}>
        <span className="font-medium">{meta.label}</span>
        <span className="text-(--color-ink-muted)">· {meta.hint}</span>
      </p>
    </div>
  );
}
