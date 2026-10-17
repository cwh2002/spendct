/**
 * 消费日历页（08 修订案 A15 第四部分）e2e：DEMO_MODE=mock 下走演示动线
 * （无体检记录，lastRun 为空）——覆盖页面加载、热力图容器渲染、流水行出现、
 * 搜索过滤、方向筛选与空态提示。
 * 消费日历页受 AuthGuard 保护，每个用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过），再进入 /calendar。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

test.describe("消费日历页（/calendar）", () => {
  test("页面加载：标题、热力图容器、口径说明与流水行出现", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "消费日历", level: 1 })).toBeVisible();
    // 演示动线：热力图按 aria-label 暴露语义（与商户统计视图同口径）
    await expect(page.getByRole("img", { name: "消费日历热力图" })).toBeVisible();
    await expect(page.getByText(/颜色越深花得越多/)).toBeVisible();
    // 流水行出现（演示流水 100 行，首屏全量渲染）
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    // 深夜徽标与收入行在演示流水里确定性存在（见 calendar-demo.ts 时分秒点缀口径）
    await expect(page.locator("tbody").getByText("深夜", { exact: true }).first()).toBeVisible();
  });

  test("搜索框按商户 / 类目关键字过滤流水（客户端过滤）", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/calendar");
    const search = page.getByRole("searchbox", { name: "搜索流水" });
    await search.fill("美团外卖");
    // 过滤后所有行的商户列都含关键字（关键字不命中任何类目名，只有商户匹配）
    const merchantCells = page.locator("tbody tr td:nth-child(3)");
    const count = await merchantCells.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(merchantCells.nth(i)).toContainText("美团外卖");
    }
    // 无匹配空态 + 清除筛选按钮，点击后恢复全量流水
    await search.fill("不存在的商户");
    await expect(page.getByText("没有匹配的流水")).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    expect(await rowsCount(page)).toBeGreaterThan(0);
  });

  test("方向筛选：收入档只留收入行，支出档只留支出行", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/calendar");
    const tbody = page.locator("tbody");
    // 收入档：演示流水每 9 笔 1 笔收入，收入商户池确定性存在
    await page.getByRole("button", { name: "收入", exact: true }).click();
    await expect(tbody.getByText("奖学金到账", { exact: true }).first()).toBeVisible();
    await expect(tbody.getByText("支出", { exact: true })).toHaveCount(0);
    // 支出档：反向断言
    await page.getByRole("button", { name: "支出", exact: true }).click();
    await expect(tbody.getByText("支出", { exact: true }).first()).toBeVisible();
    await expect(tbody.getByText("收入", { exact: true })).toHaveCount(0);
  });

  test("热力图数据表切换：按日期列出每日支出与合计", async ({ page }) => {
    await loginDemo(page);
    await page.goto("/calendar");
    await page.getByRole("button", { name: "切换到数据表视图" }).click();
    await expect(page.getByRole("columnheader", { name: "日期" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "支出（元）" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "合计" })).toBeVisible();
  });
});

/** 流水行数（等待渲染完成后的当前可见行数） */
async function rowsCount(page: Page): Promise<number> {
  await expect(page.locator("tbody tr").first()).toBeVisible();
  return page.locator("tbody tr").count();
}
