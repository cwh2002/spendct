"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  CAPTCHA_HEIGHT,
  CAPTCHA_LENGTH,
  CAPTCHA_WIDTH,
  drawCaptcha,
  generateCaptchaCode,
  verifyCaptcha,
} from "@/lib/auth/captcha";

export interface CaptchaFieldHandle {
  /** 表单提交时调用：通过返回 true；失败换图并返回 false，错误提示由字段自身展示 */
  verify: () => boolean;
}

interface CaptchaFieldProps {
  /** 关联外层 label 的 htmlFor */
  id: string;
  /** 演示模式放行：留空即通过（e2e 与零密钥演示，生产环境不传） */
  mockBypass?: boolean;
  disabled?: boolean;
}

/**
 * 图形验证码输入：输入框 + 自绘 canvas + 刷新按钮。
 * 挂载后生成并绘制首张验证码（SSR 首帧画布空白，水合后再画，无水合风险）；
 * 点画布或刷新按钮换图；校验失败自动换图并清空输入，防止连续试错。
 */
export const CaptchaField = forwardRef<CaptchaFieldHandle, CaptchaFieldProps>(function CaptchaField(
  { id, mockBypass = false, disabled = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const refresh = useCallback(() => {
    const next = generateCaptchaCode(CAPTCHA_LENGTH);
    setCode(next);
    setInput("");
    setInvalid(false);
  }, []);

  // 挂载后生成首张验证码
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 验证码更新后重绘画布
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && code) {
      drawCaptcha(canvas, code);
    }
  }, [code]);

  useImperativeHandle(
    ref,
    () => ({
      verify: () => {
        // 演示模式（DEMO_MODE=mock）放行：不校验、不提示，留空直接通过
        if (mockBypass) {
          return true;
        }
        if (verifyCaptcha(input, code)) {
          setInvalid(false);
          return true;
        }
        // 先换图再置错误态：refresh 会清掉 invalid，顺序不能反
        refresh();
        setInvalid(true);
        return false;
      },
    }),
    [mockBypass, input, code, refresh],
  );

  return (
    <div>
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          type="text"
          value={input}
          onChange={(event) => {
            // 输入即归一化：大写 + 仅字符集内字符，长度封顶
            setInput(
              event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, CAPTCHA_LENGTH),
            );
            if (invalid) {
              setInvalid(false);
            }
          }}
          placeholder="不区分大小写"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={`h-11 min-w-0 flex-1 rounded-(--radius-md) border bg-(--color-surface) px-3.5 text-base tracking-widest text-(--color-ink) transition-colors placeholder:tracking-normal placeholder:text-(--color-ink-muted) focus-visible:ring-2 focus-visible:ring-(--color-primary) disabled:opacity-50 ${
            invalid ? "border-(--color-critical)" : "border-(--color-border)"
          }`}
        />
        <button
          type="button"
          onClick={refresh}
          aria-label="换一张验证码"
          title="看不清？点此换一张"
          disabled={disabled}
          className="h-11 shrink-0 overflow-hidden rounded-(--radius-md) border border-(--color-border) transition-colors hover:border-(--color-border-strong) disabled:opacity-50"
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="图形验证码"
            style={{ width: CAPTCHA_WIDTH, height: CAPTCHA_HEIGHT }}
          />
        </button>
        <button
          type="button"
          onClick={refresh}
          aria-label="刷新验证码"
          disabled={disabled}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-(--radius-md) border border-(--color-border) text-(--color-ink-muted) transition-colors hover:text-(--color-ink-secondary) disabled:opacity-50"
        >
          <RefreshCw className="size-4.5" aria-hidden />
        </button>
      </div>
      {invalid ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-(--color-critical-ink)">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          验证码不正确，已换一张，请重新输入
        </p>
      ) : null}
    </div>
  );
});
