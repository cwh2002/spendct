import { AuthGuard } from "@/components/auth/route-guard";
import { CalendarView } from "@/components/calendar/calendar-view";
import { Container } from "@/components/layout/container";

/**
 * 消费日历页（08 修订案 A15 第四部分）：
 * 每日支出热力图 + 逐笔时间轴流水。页面壳保持服务端渲染，
 * 数据装载与交互全部在客户端组件 CalendarView 内完成
 * （DuckDB-WASM 只在浏览器运行，页面无需服务端数据）。
 * 数据页统一包 AuthGuard：未登录跳登录页。
 */
export default function CalendarPage() {
  return (
    <AuthGuard>
      <Container wide className="py-8">
        <CalendarView />
      </Container>
    </AuthGuard>
  );
}
