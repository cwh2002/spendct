/**
 * 攒钱目标中心（A17）端到端动线：演示数据路径下
 * 结余/类目卡 → 创建目标 → 存入一笔 → 进度更新 → 刷新持久。
 * 目标列表持久化在 localStorage（spendct:goals:v1），刷新后仍在。
 * 攒钱页受 AuthGuard 保护，用例开头先以演示账户登录（helpers.loginDemo，
 * mock 模式下验证码留空即过），再进入 /goals。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("攒钱目标：创建 → 存入 → 进度更新 → 刷新持久", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginDemo(page);
  await page.goto("/goals");
  await expect(page.getByRole("heading", { name: "攒钱目标" })).toBeVisible();

  // 演示口径的结余卡与类目卡（role 定位避开玩法说明里的同词句）
  await expect(page.getByRole("heading", { name: "预计月结余" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "月均支出 TOP" })).toBeVisible();

  // 创建目标：名称 + 金额（目标月输入框挂载后已默认 12 个月后）
  await page.locator("#goal-name").fill("测试目标");
  await page.locator("#goal-amount").fill("300");
  await page.getByRole("button", { name: "创建目标" }).click();
  await expect(page.getByRole("heading", { name: "测试目标" })).toBeVisible();
  await expect(page.getByText(/^0%$/).first()).toBeVisible();

  // 存入 100 → 进度 33%（100/300）
  await page.locator('input[aria-label^="存入金额"]').fill("100");
  await page.getByRole("button", { name: "存入", exact: true }).click();
  await expect(page.getByText(/^33%$/).first()).toBeVisible();
  await expect(page.getByText(/已存/).first()).toBeVisible();

  // 刷新持久：目标与存入记录仍在
  await page.reload();
  await expect(page.getByRole("heading", { name: "测试目标" })).toBeVisible();
  await expect(page.getByText(/^33%$/).first()).toBeVisible();

  expect(errors).toEqual([]);
});
