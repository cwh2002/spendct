export default function Loading() {
  // 与根 loading 同一视觉规格：三点脉冲 + 文案
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-(--color-ink-muted)">
      <div className="flex items-center gap-3">
        <span className="size-2 animate-pulse rounded-full bg-(--color-primary)" />
        <span className="size-2 animate-pulse rounded-full bg-(--color-primary) [animation-delay:150ms]" />
        <span className="size-2 animate-pulse rounded-full bg-(--color-primary) [animation-delay:300ms]" />
        <span className="ml-2 text-sm">加载中…</span>
      </div>
    </div>
  );
}
