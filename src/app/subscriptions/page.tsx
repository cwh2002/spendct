import { redirect } from "next/navigation";

/**
 * 旧「订阅雷达」独立页：页面主体已迁入洞察页第 5 视图
 * （src/components/insights/subscription-view.tsx，/insights?view=subscriptions）。
 * 本文件保留路由并整体重定向——收藏夹、站内旧链接与历史分享都不会 404，
 * 落地页与原页内容一致（读数据、渲染、交互全部保留）。
 */
export default function SubscriptionsPage() {
  redirect("/insights?view=subscriptions");
}
