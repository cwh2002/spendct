"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

interface PasswordInputProps {
  /** 受控值，与页面表单状态绑定 */
  value: string;
  onChange: (value: string) => void;
  /** 关联外层 label 的 htmlFor */
  id?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  /** 校验失败时红边（--color-critical） */
  invalid?: boolean;
}

/**
 * 密码输入框：右侧可见性切换。
 * 切换按钮 44×44（h-11 等高），满足移动端最小触控尺寸；
 * 红边由 invalid 条件渲染，避免与默认边框工具类产生样式优先级冲突。
 */
export function PasswordInput({
  value,
  onChange,
  id,
  placeholder,
  autoComplete,
  disabled = false,
  invalid = false,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={`h-11 w-full rounded-(--radius-md) border bg-(--color-surface) px-3.5 pr-12 text-base text-(--color-ink) transition-colors placeholder:text-(--color-ink-muted) focus-visible:ring-2 focus-visible:ring-(--color-primary) disabled:cursor-not-allowed disabled:opacity-50 ${
          invalid ? "border-(--color-critical)" : "border-(--color-border)"
        }`}
      />
      <button
        type="button"
        onClick={() => setVisible((previous) => !previous)}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-(--radius-md) text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary)"
      >
        {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  );
}
