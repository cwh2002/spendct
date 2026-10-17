/**
 * 预算页快速记账反馈闭环端到端：入账后本月总览「已用」与汇总行即时联动，删除后回落。
 * 页面级断言兜底「记了账但图表数字不变」回归（manual-merge 链路：shownMonthManual
 * 聚合 → mergeManualExpenses 并入分类视图 → 总览瓦片/环/柱状图共源）。
 * 预算页受 AuthGuard 保护，用例开头先以演示账户登录（helpers.loginDemo，
 * mock 模式下验证码留空即过），再进入 /budget 走记账动线。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

/** 「¥1,234」 → 1234（瓦片展示为整数元） */
function parseYuan(text: string): number {
  return Number(text.replace(/[^0-9.]/g, ""));
}

async function usedTileYuan(page: Page): Promise<number> {
  const tile = page
    .locator('section[aria-label="本月总览"]')
    .getByText("已用", { exact: true })
    .locator("..");
  return parseYuan(await tile.locator("p").nth(1).innerText());
}

test("快速记账入账后总览数字联动，删除后回落", async ({ page }) => {
  await loginDemo(page);
  await page.goto("/budget");
  await expect(page.locator("#quick")).toBeVisible();

  const before = await usedTileYuan(page);

  // 一句话记账 → 识别 → 确认入账
  await page.getByLabel("记账内容").fill("中午食堂花了 15");
  await page.getByRole("button", { name: "识别" }).click();
  await page.getByRole("button", { name: "确认入账" }).click();

  // 反馈闭环：绿色横幅 + 最近记账列表 + 总览汇总行
  await expect(page.getByRole("status")).toContainText("已记一笔");
  await expect(page.locator("#quick")).toContainText("中午食堂花了 15");
  await expect(page.locator('section[aria-label="本月总览"]')).toContainText(/手动记账\s*1\s*笔/);

  // 图表数字联动：已用瓦片 +15 元
  const after = await usedTileYuan(page);
  expect(after).toBe(before + 15);

  // 删除这笔后数字回落
  const row = page.locator("#quick li", { hasText: "中午食堂花了 15" });
  await row.getByRole("button").click();
  await expect(page.locator('section[aria-label="本月总览"]')).toContainText(/还没有手动记账/);
  expect(await usedTileYuan(page)).toBe(before);
});
