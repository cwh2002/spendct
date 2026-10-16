/**
 * 全路由冒烟：16 个页面逐个打开，断言无 console error 且页面挂载出主标题。
 * 受 AuthGuard 保护的 /budget /me /settings 游客态重定向到 /login，
 * 这三页断言落在重定向后的 URL 上；其余 13 页断言 h1 可见。
 * /challenge /goals /poster 为 A17 修订新增路由。
 */
import { expect, test, type Page } from "@playwright/test";

/** 页面访问期间的 console 错误收集器：只统计 error 级，聚合到用例尾部断言 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

const GUEST_PAGES = [
  { path: "/", name: "首页" },
  { path: "/login", name: "登录" },
  { path: "/register", name: "注册" },
  { path: "/upload", name: "上传" },
  { path: "/checkup", name: "体检" },
  { path: "/insights", name: "洞察" },
  // 订阅雷达已并入洞察页第 5 视图，顶栏入口换成消费日历页（A15 第四部分）
  { path: "/calendar", name: "日历" },
  { path: "/report", name: "报告" },
  // 以下三页为 A17 修订新增
  { path: "/challenge", name: "挑战" },
  { path: "/goals", name: "攒钱" },
  { path: "/poster", name: "海报" },
  { path: "/learn", name: "课堂" },
  { path: "/privacy", name: "隐私" },
];

const PROTECTED_PAGES = ["/budget", "/me", "/settings"];

for (const route of GUEST_PAGES) {
  test(`游客页「${route.name}」渲染正常且无 console error`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(route.path);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("顶栏新增挑战/攒钱/海报三个入口可跳转（A17）", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link", { name: "挑战" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "攒钱" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "海报" })).toBeVisible();
  await nav.getByRole("link", { name: "挑战" }).click();
  await expect(page).toHaveURL(/\/challenge/);
  await expect(page.getByRole("heading", { name: "省钱挑战" })).toBeVisible();
  await nav.getByRole("link", { name: "攒钱" }).click();
  await expect(page).toHaveURL(/\/goals/);
  await expect(page.getByRole("heading", { name: "攒钱目标" })).toBeVisible();
  await nav.getByRole("link", { name: "海报" }).click();
  await expect(page).toHaveURL(/\/poster/);
  await expect(page.getByRole("heading", { name: "年度海报" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("旧订阅页 /subscriptions 重定向到洞察页订阅视图（旧链接不 404）", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/subscriptions");
  await expect(page).toHaveURL(/\/insights\?view=subscriptions/);
  await expect(page.locator("h1").first()).toBeVisible();
  // 订阅视图渲染出识别结果摘要（演示动线为内置订阅列表）
  await expect(page.getByRole("heading", { name: "订阅雷达" })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const path of PROTECTED_PAGES) {
  test(`受保护页 ${path} 游客态重定向到登录页`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });
}
