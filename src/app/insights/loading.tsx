import { Container } from "@/components/layout/container";

/** 洞察页路由级骨架屏：与页面真实布局同构，避免加载完成时的大幅跳动 */
export default function Loading() {
  return (
    <Container wide>
      <div className="animate-pulse pt-6" aria-label="洞察页加载中">
        <div className="flex items-center gap-3">
          <div className="h-7 w-20 rounded-full bg-(--color-surface-2)" />
          <div className="h-10 w-72 rounded-full bg-(--color-surface-2)" />
        </div>
        <div className="mt-3 h-11 w-full max-w-3xl rounded-full bg-(--color-surface-2)" />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-80 rounded-(--radius-lg) bg-(--color-surface-2)" />
          ))}
        </div>
      </div>
    </Container>
  );
}
