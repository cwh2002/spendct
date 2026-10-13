import { Container } from "@/components/layout/container";

/** 路由级加载态：骨架屏贴合页面结构（页头 + 统计行 + 双列卡墙），避免布局跳动 */
export default function Loading() {
  return (
    <Container className="py-8">
      <div className="flex items-center gap-3">
        <span className="size-11 animate-pulse rounded-(--radius-md) bg-(--color-surface-2)" />
        <div className="flex flex-col gap-2">
          <span className="h-6 w-32 animate-pulse rounded bg-(--color-surface-2)" />
          <span className="h-4 w-72 max-w-full animate-pulse rounded bg-(--color-surface-2)" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-24 animate-pulse rounded-(--radius-lg) bg-(--color-surface-2)" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-80 animate-pulse rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface)"
          />
        ))}
      </div>
    </Container>
  );
}
