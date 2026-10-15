/**
 * 商户统计视图（08 修订案 A13）e2e：DEMO_MODE=mock 下走演示动线——
 * 覆盖视图入口切换、排名图渲染、数据表切换、商户搜索过滤与数据来源脚注。
 */
import { expect, test } from "@playwright/test";

test.describe("商户统计视图（/insights?view=merchants）", () => {
  test("从洞察页切换商户统计 tab，渲染排名图与数据来源脚注", async ({ page }) => {
    await page.goto("/insights");
    await page.getByRole("button", { name: "商户统计" }).click();
    await expect(page).toHaveURL(/view=merchants/);
    await expect(page.getByRole("heading", { name: "商户统计" })).toBeVisible();
    // 演示动线：图表按 aria-label 暴露语义
    await expect(page.getByRole("img", { name: "商户支出排名柱状图" })).toBeVisible();
    await expect(page.getByText(/内置数据 · 共 \d+ 个商户/)).toBeVisible();
  });

  test("切换数据表：展示全量商户行（商户 / 总额 / 笔数 / 占比 / 均笔 / 追问）", async ({ page }) => {
    await page.goto("/insights?view=merchants");
    await page.getByRole("button", { name: "切换到数据表视图" }).click();
    await expect(page.getByRole("columnheader", { name: "商户 / 支付单位" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "总额（元）" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "占全账单" })).toBeVisible();
    // 演示商户池必含的商户行（exact：行内「追问」按钮的 cell 名是「追问美团外卖」）
    await expect(page.getByRole("cell", { name: "美团外卖", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "京东商城", exact: true })).toBeVisible();
  });

  test("数据表行「追问」按钮与柱子点击同一锚点协议（键盘可达入口）", async ({ page }) => {
    await page.goto("/insights?view=merchants");
    await page.getByRole("button", { name: "切换到数据表视图" }).click();
    await page.getByRole("button", { name: "追问美团外卖" }).click();
    // 追问面板出现锚点确认条，标签与图表锚点同口径（商户 + 合计 + 占比）
    await expect(page.getByText("已选中：", { exact: false })).toBeVisible();
    await expect(page.getByText(/美团外卖 合计 ¥\d+\.\d{2} · 占全账单 \d+(\.\d)?%/)).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByText("已选中：", { exact: false })).toHaveCount(0);
  });

  test("商户搜索过滤图表与数据表", async ({ page }) => {
    await page.goto("/insights?view=merchants");
    await page.getByRole("button", { name: "切换到数据表视图" }).click();
    const search = page.getByRole("searchbox", { name: "搜索商户" });
    await search.fill("京东");
    await expect(page.getByRole("cell", { name: "京东商城", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "美团外卖", exact: true })).toHaveCount(0);
    // 无匹配时的空态提示
    await search.fill("不存在的商户");
    await expect(page.getByText("没有匹配的商户").first()).toBeVisible();
  });

  test("从商户统计切回卡片流，筛选条与快捷键提示恢复", async ({ page }) => {
    await page.goto("/insights?view=merchants");
    await page.getByRole("button", { name: "卡片流" }).click();
    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.getByText("快捷键", { exact: false })).toBeVisible();
  });
});
