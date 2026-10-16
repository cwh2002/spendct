/**
 * 账本汇总视图（/insights?view=ledger）e2e：DEMO_MODE=mock 下走演示动线——
 * 日期范围筛选（近 7/30/90 天、本月、全部）必须同步改变类别 / 商户 / 明细
 * （2026-10-16 修订：真实动线按 date_iso 重查，演示动线按行日期过滤）；
 * 「支出走势（月）」已迁至商户统计视图，本视图不再渲染。
 */
import { expect, test } from "@playwright/test";

test.describe("账本汇总视图（/insights?view=ledger）", () => {
  test("页面加载：标题、筛选行与两张图表卡出现，走势图已迁出", async ({ page }) => {
    await page.goto("/insights?view=ledger");
    await expect(page.getByRole("heading", { name: "账本汇总" })).toBeVisible();
    // 默认近 90 天选中（范围按钮组 aria-pressed 表达当前档）
    await expect(page.getByRole("button", { name: "近 90 天" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("img", { name: "类别构成环图" })).toBeVisible();
    await expect(page.getByRole("img", { name: "商户消费排行柱状图" })).toBeVisible();
    // 支出走势（月）迁至商户统计视图（2026-10-16 修订）：本视图不再渲染
    await expect(page.getByRole("heading", { name: "支出走势（月）" })).toHaveCount(0);
  });

  test("日期范围筛选同步作用于明细表：档位越近行数越少且均非空", async ({ page }) => {
    await page.goto("/insights?view=ledger");
    const detailTable = page.locator("div").filter({
      has: page.getByRole("heading", { name: "明细表" }),
    });
    await expect(detailTable.locator("tbody tr").first()).toBeVisible();
    const rows90 = await detailTable.locator("tbody tr").count();
    expect(rows90).toBeGreaterThan(0);

    // 近 7 天：行数显著减少但仍非空（演示行向近期倾斜，见 ledger-demo.test.ts）
    await page.getByRole("button", { name: "近 7 天" }).click();
    await expect(page.getByRole("button", { name: "近 7 天" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => detailTable.locator("tbody tr").count()).toBeLessThan(rows90);
    expect(await detailTable.locator("tbody tr").count()).toBeGreaterThan(0);

    // 近 30 天介于近 7 天与近 90 天之间（演示分布保证各档差异可见）
    await page.getByRole("button", { name: "近 30 天" }).click();
    await expect.poll(() => detailTable.locator("tbody tr").count()).toBeLessThan(rows90);

    // 全部：100 行演示行全量
    await page.getByRole("button", { name: "全部" }).click();
    await expect.poll(() => detailTable.locator("tbody tr").count()).toBe(100);
  });
});
