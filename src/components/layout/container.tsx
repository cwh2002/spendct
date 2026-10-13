import type { ReactNode } from "react";

interface ContainerProps {
  /** 仪表盘等数据密集页用宽容器（max-w-7xl），营销页用默认窄容器 */
  wide?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * 页面内容容器：水平居中 + 左右留白（16px 移动 / 24px 平板 / 32px 桌面，05 §1.1）。
 * 纯展示组件、无客户端逻辑，保持服务端渲染。
 */
export function Container({ wide = false, className = "", children }: ContainerProps) {
  return (
    <div
      className={`mx-auto px-4 sm:px-6 lg:px-8 ${wide ? "max-w-7xl" : "max-w-6xl"} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
