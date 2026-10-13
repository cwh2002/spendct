import { Container } from "@/components/layout/container";

/** 路由级加载态：骨架屏贴合页面结构（页头 + 仪表/指标 + 故事卡），避免布局跳动 */
export default function Loading() {
  return (
    <Container wide className="py-8">
      <div className="flex items-center gap-3">
        <span className="size-11 animate-pulse rounded-(--radius-md) bg-(--color-surface-2)" />
        <div className="flex flex-col gap-2">
          <span className="h-6 w-40 animate-pulse rounded bg-(--color-surface-2)" />
          <span className="h-4 w-80 max-w-full animate-pulse rounded bg-(--color-surface-2)" />
        </div>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <span className="h-72 animate-pulse rounded-(--radius-lg) bg-(--color-surface-2) lg:col-span-2" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-3">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-36 animate-pulse rounded-(--radius-lg) bg-(--color-surface-2)" />
          ))}
        </div>
      </div>
      {[0, 1].map((i) => (
        <span key={i} className="mt-4 block h-56 animate-pulse rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface)" />
      ))}
    </Container>
  );
}
