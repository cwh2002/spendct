import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCardSkeleton } from "@/components/auth/form-skeleton";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "注册",
};

/**
 * 注册页。表单组件读取 next 回跳参数（useSearchParams），
 * 必须包在 Suspense 里，否则静态预渲染阶段会缺边界而失败。
 */
export default function RegisterPage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthCardSkeleton />}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
