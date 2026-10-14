import Link from "next/link";

const TRUST_ITEMS = ["密码只存在你的设备上", "你的数据不留在服务器", "账单明细从不上传"] as const;

/**
 * 登录/注册卡片底部的信任条：三条本地化承诺 + 隐私说明入口。
 * 纯展示组件，无客户端逻辑，可被服务端页面直接引用。
 */
export function TrustBar() {
  return (
    <div className="mt-6 border-t border-(--color-border) pt-4">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-(--color-ink-muted)">
        {TRUST_ITEMS.map((item, index) => (
          <span key={item} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden>·</span> : null}
            {item}
          </span>
        ))}
        <span aria-hidden>·</span>
        <Link
          href="/privacy"
          className="text-(--color-brand-600) underline-offset-2 transition-colors hover:underline"
        >
          隐私说明
        </Link>
      </div>
    </div>
  );
}
