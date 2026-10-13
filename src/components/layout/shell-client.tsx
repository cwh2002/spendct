"use client";

import { usePathname } from "next/navigation";
import { DemoConsole } from "@/components/demo/demo-console";
import { TopNav } from "./top-nav";
import { BottomTabBar } from "./bottom-tab-bar";

interface ShellClientProps {
  /** 页脚由服务端组件传入：保持 footer 服务端渲染，不随本文件进客户端包 */
  footer: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shell 的客户端分支逻辑：当前路由是否属于登录/注册（沉浸式页）。
 * 沉浸式页只渲染主内容，不挂导航/页脚/tab bar（05 §1.1 登录注册左右分屏规格）。
 * 路由判断必须放客户端组件：服务端读不到浏览器路由状态。
 */
export function ShellClient({ footer, children }: ShellClientProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
    return <main className="flex-1">{children}</main>;
  }

  return (
    <>
      <TopNav />
      {/* pb-20：给移动端固定 tab bar（56px+安全区）留出遮挡余量 */}
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      {footer}
      <BottomTabBar />
      {/* 演示控制台：? 键呼出（05 §7.3，评委提问时的应急武器） */}
      <DemoConsole />
    </>
  );
}
