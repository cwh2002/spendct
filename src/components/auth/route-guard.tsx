"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/account/store";

/**
 * 受保护路由的守卫：未登录跳转 /login 并带 next 回跳参数。
 * 挂载时若会话尚未恢复（仍为 loading）则触发 hydrate；
 * hydrate 内部有单次守卫，与布局层的启动调用不会重复执行。
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const status = useAuth((state) => state.status);
  const hydrate = useAuth((state) => state.hydrate);
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") {
      void hydrate();
    }
  }, [status, hydrate]);

  useEffect(() => {
    if (status === "guest") {
      // 取 window.location 而非 usePathname：连查询串一起回跳
      // （如 /upload?sample=1，登录后演示导入继续生效）
      const { pathname, search } = window.location;
      router.replace("/login?next=" + encodeURIComponent(pathname + search));
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4" aria-label="正在恢复会话">
          <div className="border-t-primary size-10 animate-spin rounded-full border-2 border-slate-200 dark:border-slate-800" />
          <div className="h-3 w-32 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (status === "guest") {
    // 跳转 effect 生效前渲染空内容，避免受保护页面闪出
    return null;
  }

  return <>{children}</>;
}
