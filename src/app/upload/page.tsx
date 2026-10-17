import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthGuard } from "@/components/auth/route-guard";
import { Container } from "@/components/layout/container";
import { UploadWorkspace } from "./upload-workspace";

export const metadata: Metadata = {
  title: "上传账单",
  description: "上传微信 / 支付宝账单文件，本地识别去重，开始全流程 AI 体检。",
};

/**
 * Suspense 边界是 Next 16 的硬要求：UploadWorkspace 读 useSearchParams
 * （?sample=1 自动演示、?next= 回跳），预渲染期读 URL 的客户端组件
 * 必须包在 Suspense 内，否则构建报 blocking-prerender-client-hook。
 * fallback 只承担「等待 URL 就绪」的瞬间，路由级加载态由 loading.tsx 负责。
 * 整页包 AuthGuard：未登录跳登录页，登录后按 next（含查询串）回跳继续操作。
 */
export default function UploadPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<UploadPageSkeleton />}>
        <UploadWorkspace />
      </Suspense>
    </AuthGuard>
  );
}

/** Suspense 骨架：与真实布局同构，避免 URL 就绪瞬间的版面跳动 */
function UploadPageSkeleton() {
  return (
    <Container className="pb-16 md:pb-20">
      <div className="py-8 md:py-10">
        <div className="h-8 w-40 animate-pulse rounded-(--radius-md) bg-(--color-surface-2)" />
        <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded-(--radius-sm) bg-(--color-surface-2)" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="h-[420px] animate-pulse rounded-(--radius-card) bg-(--color-surface-2) lg:col-span-2" />
        <div className="h-[420px] animate-pulse rounded-(--radius-card) bg-(--color-surface-2) lg:col-span-3" />
      </div>
    </Container>
  );
}
