import { AuthGuard } from "@/components/auth/route-guard";
import { GoalsView } from "@/components/goals/goals-view";
import { Container } from "@/components/layout/container";

/**
 * 攒钱目标中心页（修订案 A17 第二个新功能页）：
 * 目标 + 按月存入 + 月结余估算进度与预计达成月。页面壳保持服务端渲染，
 * 数据装载与交互全部在客户端组件 GoalsView 内完成
 * （DuckDB-WASM 只在浏览器运行，页面无需服务端数据）。
 * 数据页统一包 AuthGuard：未登录跳登录页。
 */
export default function GoalsPage() {
  return (
    <AuthGuard>
      <Container wide className="py-8">
        <GoalsView />
      </Container>
    </AuthGuard>
  );
}
