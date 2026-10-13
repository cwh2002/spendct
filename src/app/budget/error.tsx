"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function BudgetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 错误边界内保留错误日志，便于定位渲染期异常；后续接入上报服务时可复用此入口
  useEffect(() => {
    console.error("预算中心渲染失败：", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold">预算中心出了点问题</h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
        你的预算与记账数据不受影响——它们只保存在浏览器本地。可以重试，或回到首页。
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
