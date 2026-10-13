"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * /upload 路由错误边界：与根 error.tsx 同一交互规格（重试 / 回首页），
 * 文案落到上传场景，强调「文件不会被上传，本地状态不受影响」。
 */
export default function UploadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 错误边界内保留错误日志，便于定位渲染期异常
  useEffect(() => {
    console.error("上传页渲染失败：", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold text-(--color-ink)">上传页出了点问题</h2>
      <p className="max-w-md text-sm text-(--color-ink-secondary)">
        文件只在浏览器本地解析，你的账单数据不受影响。可以重试，或回到首页重新开始。
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="h-10 rounded-full bg-(--color-primary) px-6 font-medium text-white transition hover:opacity-90"
        >
          重试
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-full border border-(--color-border-strong) px-6 font-medium text-(--color-ink-secondary)"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}
