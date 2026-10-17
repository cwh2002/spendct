"use client";

import Link from "next/link";
import { useEffect } from "react";

/** 路由级错误边界：沿用全局 error 页的兜底模式（保留日志 + 重试 + 回首页） */
export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("数据管理页渲染失败：", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold">页面出了点问题</h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
        你的数据集不受影响，可以重试，或回到首页。
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="h-10 rounded-full bg-(--color-primary) px-6 font-medium text-white transition hover:opacity-90"
        >
          重试
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-full border border-slate-300 px-6 font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}
