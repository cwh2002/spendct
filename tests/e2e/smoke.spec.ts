/**
 * 全路由冒烟：公开 5 页 + 受保护 11 页逐个打开，断言无 console error 且页面挂载出主标题。
 * 数据页强制登录（WP1）后口径更新：/upload /checkup /insights /calendar /report
 * /challenge /goals /poster /budget /me /settings 游客态一律重定向到
 * /login?next=<原路径>，这 11 页断言落在重定向后的 URL 上（同时验证 next
 * 回跳参数存在）；公开 5 页（首页/登录/注册/课堂/隐私）断言 h1 可见。
 * 顶栏跳转、旧订阅页重定向两个登录态用例开头先以演示账户登录（helpers.loginDemo，
 * mock 模式下验证码留空即过）；另含登录页图形验证码冒烟（canvas 挂载 + mock 放行）。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

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
  { path: "/learn", name: "课堂" },
  { path: "/privacy", name: "隐私" },
];

const PROTECTED_PAGES = [
  "/upload",
  "/checkup",
  "/insights",
  "/calendar",
  "/report",
  "/challenge",
  "/goals",
  "/poster",
  "/budget",
  "/me",
  "/settings",
];

for (const route of GUEST_PAGES) {
  test(`公开页「${route.name}」渲染正常且无 console error`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(route.path);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("顶栏新增挑战/攒钱/海报三个入口可跳转（A17）", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  // 三个入口都指向数据页（受 AuthGuard 保护）：先登录再回首页点导航
  await loginDemo(page);
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
  // 洞察页受 AuthGuard 保护：登录后旧链接重定向仍落在订阅视图
  await loginDemo(page);
  await page.goto("/subscriptions");
  await expect(page).toHaveURL(/\/insights\?view=subscriptions/);
  await expect(page.locator("h1").first()).toBeVisible();
  // 订阅视图渲染出识别结果摘要（演示动线为内置订阅列表）
  await expect(page.getByRole("heading", { name: "订阅雷达" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("登录页图形验证码冒烟：canvas 挂载、mock 模式留空直接登录", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/login");

  // 验证码 DOM 挂载：自绘 canvas（语义 role="img"）与输入框可见
  const captchaCanvas = page.locator('canvas[role="img"][aria-label="图形验证码"]');
  await expect(captchaCanvas).toBeVisible();
  await expect(page.locator("#login-captcha")).toBeVisible();

  // 换一张：点刷新按钮重绘验证码，不得产生 console error
  await page.getByRole("button", { name: "刷新验证码" }).click();
  expect(errors).toEqual([]);

  // mock 放行路径：验证码留空直接登录（DEMO_MODE=mock 下 mockBypass 恒通过），
  // 账号密码用演示账户，登录后按 URL 进入个人中心
  await page.locator('input[placeholder="3-20 位小写字母、数字或下划线"]').fill("demo");
  await page.locator('input[placeholder="请输入密码"]').fill("demo123");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/me/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

for (const path of PROTECTED_PAGES) {
  test(`受保护页 ${path} 游客态重定向到登录页且带 next 回跳参数`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    // 既验证重定向目标，又验证 next 回跳参数存在（登录后应回跳原页面）
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(errors).toEqual([]);
  });
}
