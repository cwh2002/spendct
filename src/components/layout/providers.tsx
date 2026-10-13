"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/account/store";

/**
 * 会话恢复：只在浏览器挂载后执行一次（空依赖数组），
 * 读 IndexedDB 校验上次会话并把用户放回内存 store。
 * store 的 hydrate 自带一次执行守卫，StrictMode 双挂载安全。
 */
function AuthBootstrap() {
  useEffect(() => {
    void useAuth.getState().hydrate();
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
