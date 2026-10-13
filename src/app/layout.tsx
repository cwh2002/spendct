import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/layout/providers";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
