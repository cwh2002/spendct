"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
