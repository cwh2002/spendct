/**
 * 追问深度分析（08 修订案 A14）e2e：DEMO_MODE=mock 下走 deep 档演示流。
 * 覆盖：开关默认关闭与开启态提示、深度分析提问挂「深度分析」脚注与演示文案、
 * 开启状态下大促关键词问题仍走 deep 档（deep 优先于 promo 演示档）。
 */
import { expect, test, type Page } from "@playwright/test";

// 桌面 1440×900：追问面板是洞察页右侧固定列、直接可见无需点开
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

/** 页面访问期间的 console error 收集器：只统计 error 级，聚合到用例尾部断言 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

/** 装配内置账单并跑完体检，回到洞察页（与 chat.spec.ts 全动线同一写法） */
async function primeInsights(page: Page): Promise<void> {
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });
  // 等真实洞察卡挂载：账单数据已落库，避免追问抢跑读到空库
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("追问输入框")).toBeVisible();
}

test.describe("追问深度分析（A14）", () => {
  test("开关默认关闭（本地规则优先提示），开启后提示切换为发送账单统计与明细", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await primeInsights(page);

    const toggle = page.getByRole("button", { name: "深度分析" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("本地规则优先，答不了才转在线")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("开启：直接交给大模型分析，并发送账单统计与明细")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("开启深度分析提问：回答挂「深度分析」脚注与演示档文案（mock 深析流）", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await primeInsights(page);

    await page.getByRole("button", { name: "深度分析" }).click();
    const input = page.getByLabel("追问输入框");
    await input.fill("帮我深度分析一下消费结构");
    await input.press("Enter");

    // mock 深析流经 /api/followup（SSE）：回答气泡挂深度分析脚注 + deep 档演示文案
    await expect(page.getByText("深度分析 · 已发送账单统计与明细")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/深度分析演示/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("开启状态下大促关键词问题仍走深度分析档（deep 优先于 promo 演示档）", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await primeInsights(page);

    await page.getByRole("button", { name: "深度分析" }).click();
    const input = page.getByLabel("追问输入框");
    await input.fill("双11 大促期间我该怎么规划消费");
    await input.press("Enter");

    // deep 档优先：回答是深度分析演示文案而非大促日历演示文案
    await expect(page.getByText("深度分析 · 已发送账单统计与明细")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/深度分析演示/)).toBeVisible();
    await expect(page.getByText(/大促日历显示/)).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
