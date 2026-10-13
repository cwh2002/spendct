"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * /privacy 错误边界：与全局 error.tsx 同模式。
 * 对照表是静态数据源，渲染异常基本只会发生在依赖文件缺失时，给出可重试的降级界面。
 */
export default function PrivacyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 错误边界内保留错误日志，便于定位渲染期异常
  useEffect(() => {
    console.error("隐私说明页渲染失败：", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold">页面出了点问题</h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
        数据可见性对照表加载失败。你的账单数据不受影响——明细只保存在浏览器本地。
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
          className="inline-flex h-10 items-center rounded-full border border-slate-300 px-6 font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}
