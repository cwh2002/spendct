import { ShellClient } from "./shell-client";
import { Footer } from "./footer";

/**
 * 全局应用 Shell：导航 + 主内容 + 页脚 + 移动端 tab bar 的组合层。
 * 本文件保持服务端组件：页脚作为 prop 传给客户端 ShellClient，
 * 静态页脚不会被打进客户端 JS 包。
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return <ShellClient footer={<Footer />}>{children}</ShellClient>;
}
