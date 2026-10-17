"use client";

import Link from "next/link";
import { useEffect } from "react";

/** 年度报告页错误边界：与全局 error.tsx 同构，文案落到本页语境 */
export default function ReportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 错误边界内保留错误日志，便于定位渲染期异常；后续接入上报服务时可复用此入口
  useEffect(() => {
    console.error("年度报告页渲染失败：", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold">年度报告暂时打不开</h2>
      <p className="max-w-md text-sm text-(--color-ink-secondary)">
        你的账单数据不受影响，可以重试，或回到首页重新开始。
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
          className="inline-flex h-10 items-center rounded-full border border-(--color-border) px-6 font-medium text-(--color-ink-secondary)"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}
