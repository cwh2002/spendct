/**
 * /privacy 加载态：静态页通常瞬时完成，仍按路由规范配骨架，
 * 避免慢速网络下流式渲染期间页面闪白。
 */
export default function PrivacyLoading() {
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
