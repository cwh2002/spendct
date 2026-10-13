/**
 * 登录/注册的骨架屏组件（无客户端逻辑，可服务端渲染）：
 * - AuthFormSkeleton 复刻 AuthShell 两栏结构，供 loading.tsx 使用；
 * - AuthCardSkeleton 只占位表单卡内容，供页面内 Suspense 兜底使用
 *   （此时 AuthShell 已挂载，只需补卡内脉冲条）。
 */
export function AuthCardSkeleton() {
  return (
    <div role="status" aria-label="正在加载表单">
      <div className="flex justify-center">
        <div className="h-7 w-32 animate-pulse rounded-md bg-(--color-surface-2)" />
      </div>
      <div className="mx-auto mt-3 h-4 w-52 animate-pulse rounded bg-(--color-surface-2)" />
      <div className="mt-8 h-4 w-16 animate-pulse rounded bg-(--color-surface-2)" />
      <div className="mt-2 h-11 animate-pulse rounded-(--radius-md) bg-(--color-surface-2)" />
      <div className="mt-5 h-4 w-16 animate-pulse rounded bg-(--color-surface-2)" />
      <div className="mt-2 h-11 animate-pulse rounded-(--radius-md) bg-(--color-surface-2)" />
      <div className="mt-6 h-11 animate-pulse rounded-(--radius-md) bg-(--color-primary)/50" />
      <div className="mt-6 h-3 w-full animate-pulse rounded bg-(--color-surface-2)" />
    </div>
  );
}

export function AuthFormSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row" aria-label="正在加载登录页" role="status">
      {/* 左品牌区骨架：桌面端占位，移动端隐藏 */}
      <div
        aria-hidden
        className="hidden flex-col justify-between bg-linear-to-br from-(--color-primary) to-(--color-brand-700) p-12 lg:flex lg:w-[44%] xl:w-1/2 xl:p-16"
      >
        <div className="h-11 w-40 animate-pulse rounded-(--radius-lg) bg-white/20" />
        <div className="space-y-4">
          <div className="h-8 w-72 animate-pulse rounded-md bg-white/25" />
          <div className="h-8 w-56 animate-pulse rounded-md bg-white/25" />
          <div className="mt-8 space-y-3">
            <div className="h-9 w-64 animate-pulse rounded-full bg-white/15" />
            <div className="h-9 w-56 animate-pulse rounded-full bg-white/15" />
            <div className="h-9 w-60 animate-pulse rounded-full bg-white/15" />
          </div>
        </div>
        <div className="h-4 w-72 animate-pulse rounded bg-white/15" />
      </div>

      {/* 右表单卡骨架 */}
      <div className="flex flex-1 items-center justify-center bg-(--color-surface-page) px-4 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-md rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-6 shadow-(--shadow-md) sm:p-8">
          <AuthCardSkeleton />
        </div>
      </div>
    </div>
  );
}
