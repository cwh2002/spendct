/**
 * 洞察页图表人工核对截图：内置账单走完整管线后，逐卡截图表区域 + 账本汇总 + 年度报告。
 * 用法：node scripts/screenshot-insights.mjs（需 dev server 已在 3000 端口运行）
 * 产物：.screenshots/insight-*.png（目录已在 .gitignore，不入库）
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../.screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

// 1) 内置账单走完管线
await page.goto("http://localhost:3000/upload?sample=1");
await page.getByRole("button", { name: "开始体检" }).click();
await page.waitForURL(/\/insights/, { timeout: 120_000 });

// 2) 等真实卡挂载
await page.locator("[id^='insight-card_']").first().waitFor({ state: "visible", timeout: 60_000 });
// 图表 canvas 渲染完成（每卡一张 canvas）
await page.waitForFunction(
  () => document.querySelectorAll("[id^='insight-card_'] canvas").length >= 3,
  undefined,
  { timeout: 60_000 },
);
await page.waitForTimeout(1500);

const cards = await page.locator("[id^='insight-card_']").all();
console.log(`卡片数：${cards.length}`);
for (let i = 0; i < cards.length; i++) {
  const id = await cards[i].getAttribute("id");
  await cards[i].scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cards[i].screenshot({ path: `${OUT}/insight-${i + 1}-${id}.png` });
}

// 3) 账本汇总
await page.goto("http://localhost:3000/insights?view=ledger");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/ledger.png`, fullPage: true });

// 4) 年度报告
await page.goto("http://localhost:3000/report");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/report.png`, fullPage: true });

console.log(errors.length === 0 ? "无 console error" : `console errors:\n${errors.join("\n")}`);
await browser.close();
