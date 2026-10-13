import { AuthFormSkeleton } from "@/components/auth/form-skeleton";

/** 登录路由的加载骨架：与 AuthShell 同构，避免进入页面时布局跳变 */
export default function Loading() {
  return <AuthFormSkeleton />;
}
