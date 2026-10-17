"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/account/store";
import { recheckAll } from "@/lib/achievements";

/**
 * 会话恢复：只在浏览器挂载后执行一次（空依赖数组），
 * 读 IndexedDB 校验上次会话并把用户放回内存 store。
 * store 的 hydrate 自带一次执行守卫，StrictMode 双挂载安全。
 * 恢复完成后做一次成就全量校正（WP8 §8c）：登录与刷新两条动线
 * 都会走到这里，把本地行为数据与解锁集重新对齐。
 */
function AuthBootstrap() {
  useEffect(() => {
    void useAuth
      .getState()
      .hydrate()
      .then(() => recheckAll())
      .catch(() => {
        // 会话恢复失败（隐私模式无 IndexedDB）：成就校正与账户无关，照常执行
        recheckAll();
      });
  }, []);
  return null;
}

/**
 * 客户端全局 Provider 挂载点（01 §5.2）：
 * TanStack Query 只管「完成态请求数据」（RAG 检索 / MCP 工具 / 健康检查），
 * 流水线运行态与洞察卡集合走 Zustand 切片，不经过这里。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap />
      {children}
    </QueryClientProvider>
  );
}
