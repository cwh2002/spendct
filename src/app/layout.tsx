import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PipelineRestore } from "@/components/layout/pipeline-restore";
import { Providers } from "@/components/layout/providers";
import { Shell } from "@/components/layout/shell";
import { featureFlags } from "@/lib/feature-flags";

export const metadata: Metadata = {
  title: {
    default: "SpendCT · 消费CT —— AI 账单体检",
    template: "%s · SpendCT",
  },
  description:
    "上传账单，AI 六阶段体检：清洗、画像、异常、订阅陷阱、环比归因、年度报告。账单明细只在你自己的浏览器里计算。",
};

export const viewport: Viewport = {
  themeColor: "#2e7ce8",
};

/**
 * 防闪主题脚本：首帧绘制前读本地偏好给 html 打上 .dark（05 §3.1.6）。
 * 无存储值回退 prefers-color-scheme；隐私模式下 localStorage 会抛异常，包 try/catch。
 * 脚本必须内联在 body 最前：外部脚本到达时首帧已按亮色绘制，暗色用户会闪白。
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("spendct:theme");var dark=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(dark){document.documentElement.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {featureFlags.dark ? (
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        ) : null}
        <Providers>
          {/* 会话恢复常驻组件（08 修订案 A18）：无可见 UI，只做恢复与订阅 */}
          <PipelineRestore />
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
