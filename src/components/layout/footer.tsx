import Link from "next/link";
import { HeartPulse, Lock } from "lucide-react";
import { Container } from "./container";
import { featureFlags } from "@/lib/feature-flags";

// /learn 随功能开关下线时，快捷链接同步隐藏（05 §1.1）
const QUICK_LINKS: { href: string; label: string }[] = [
  { href: "/upload", label: "上传体检" },
  { href: "/privacy", label: "隐私说明" },
  ...(featureFlags.learn ? [{ href: "/learn", label: "知识课堂" }] : []),
  { href: "/me", label: "个人中心" },
];

/**
 * 页脚（05 §1.1）：品牌 + 快捷链接 + 数据说明三栏。
 * 快捷链接两行两列（上传体检/隐私说明、知识课堂/个人中心），竖排过长（用户实机反馈）。
 * 数据说明收敛为一行结论，细节统一指向 /privacy，避免全站重复隐私长文。
 * 移动端隐藏：底部 tab bar 已占据导航位，避免双份导航与底部遮挡。
 * 纯静态内容，保持服务端渲染。
 */
export function Footer() {
  return (
    <footer className="hidden border-t border-(--color-border) md:block">
      <Container className="py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="flex items-center gap-2 text-lg font-bold tracking-tight text-(--color-ink)">
              <HeartPulse className="size-5 text-(--color-health)" aria-hidden />
              消费CT
            </p>
            <p className="mt-2 max-w-xs text-sm text-(--color-ink-secondary)">
              给你的账单做一次 AI 体检：先体检、你审阅、账单本地处理。
            </p>
          </div>

          <nav aria-label="快捷链接">
            <h3 className="text-sm font-semibold text-(--color-ink)">快捷链接</h3>
            {/* 两行两列；learn 关闭时仅剩 3 项，第二行自然只剩 1 项，可接受 */}
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-(--color-ink-secondary) transition-colors hover:text-(--color-primary)"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="text-sm font-semibold text-(--color-ink)">数据说明</h3>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-(--color-ink-secondary)">
              <Lock className="size-4 text-(--color-health)" aria-hidden />
              账单本地计算 · 服务端零存储
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-(--color-border) pt-4 text-xs text-(--color-ink-muted)">
          © 2026 SpendCT · 参赛作品
        </div>
      </Container>
    </footer>
  );
}
