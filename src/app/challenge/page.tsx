import { ChallengeView } from "@/components/challenge/challenge-view";
import { Container } from "@/components/layout/container";

/**
 * 省钱挑战打卡页（修订案 A17 第一个新功能页）：
 * 挑类目定每日预算，打卡 21 天。页面壳保持服务端渲染，
 * 数据装载与交互全部在客户端组件 ChallengeView 内完成
 * （DuckDB-WASM 只在浏览器运行，页面无需服务端数据）。
 */
export default function ChallengePage() {
  return (
    <Container wide className="py-8">
      <ChallengeView />
    </Container>
  );
}
