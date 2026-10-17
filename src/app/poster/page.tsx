import { AuthGuard } from "@/components/auth/route-guard";
import { PosterStudio } from "@/components/poster/poster-studio";
import { Container } from "@/components/layout/container";

/**
 * 年度海报分享页（修订案 A17 第三个新功能页）：
 * 三款样式 + 自定义标语 + 预览/下载/分享，与报告页共用海报数据层。
 * 页面壳保持服务端渲染，绘制与交互全部在客户端组件 PosterStudio 内完成
 * （Canvas 只在浏览器可用，页面无需服务端数据）。
 * 数据页统一包 AuthGuard：未登录跳登录页。
 */
export default function PosterPage() {
  return (
    <AuthGuard>
      <Container wide className="py-8">
        <PosterStudio />
      </Container>
    </AuthGuard>
  );
}
