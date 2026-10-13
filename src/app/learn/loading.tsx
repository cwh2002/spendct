export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-slate-500 dark:text-slate-400">
      <div className="flex items-center gap-3">
        <span className="size-2 animate-pulse rounded-full bg-(--color-primary)" />
        <span className="size-2 animate-pulse rounded-full bg-(--color-primary) [animation-delay:150ms]" />
        <span className="size-2 animate-pulse rounded-full bg-(--color-primary) [animation-delay:300ms]" />
        <span className="ml-2 text-sm">正在加载知识课堂…</span>
      </div>
    </div>
  );
}
