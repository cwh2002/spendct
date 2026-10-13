import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCardSkeleton } from "@/components/auth/form-skeleton";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "登录",
};

/**
 * 登录页。表单组件读取 next 回跳参数（useSearchParams），
 * 必须包在 Suspense 里，否则静态预渲染阶段会缺边界而失败。
 */
export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthCardSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
