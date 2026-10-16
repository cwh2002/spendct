/**
 * 年度海报分享（A17）端到端动线：演示数据路径下
 * 预览 canvas 绘制 → 三样式切换 → 标语输入计数 → 下载 PNG 文件名校验。
 * 海报全程浏览器本地绘制（poster-canvas），不上传任何数据。
 */
import { expect, test, type Page } from "@playwright/test";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("年度海报：预览绘制 → 样式切换 → 标语 → 下载", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/poster");
  await expect(page.getByRole("heading", { name: "年度海报" })).toBeVisible();

  // 预览 canvas 挂载并绘制（内置数据兜底动线）
  const canvas = page.locator("canvas[aria-label='年度海报预览']");
  await expect(canvas).toBeVisible();

  // 三样式切换：aria-pressed 跟随选中态
  await page.getByRole("button", { name: "暮橙" }).click();
  await expect(page.getByRole("button", { name: "暮橙" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "夜紫" }).click();
  await expect(page.getByRole("button", { name: "夜紫" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "青屿" }).click();
  await expect(page.getByRole("button", { name: "青屿" })).toHaveAttribute("aria-pressed", "true");

  // 标语输入：10 字上限计数联动
  await page.locator("#poster-slogan").fill("少一点冲动多一点从容");
  await expect(page.getByText("10/16")).toBeVisible();

  // 下载：真实触发 PNG 下载事件，文件名带年份
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^spendct-annual-poster-2026\.png$/);

  expect(errors).toEqual([]);
});
