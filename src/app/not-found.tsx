import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-6xl font-bold text-(--color-primary)">404</p>
      <h2 className="text-xl font-semibold">页面不存在</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        链接可能已失效，回到首页继续你的账单体检。
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center rounded-full bg-(--color-primary) px-6 font-medium text-white transition hover:opacity-90"
      >
        回到首页
      </Link>
    </div>
  );
}
