// 洞察页冒烟验证（开发用，不入 CI）：加载 /insights 检查客户端渲染与关键交互
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

// 1. 卡片流
await page.goto(`${BASE}/insights`, { waitUntil: "networkidle" });
const cardCount = await page.locator("article[id^='insight-']").count();
console.log("cards:", cardCount);
const canvasCount = await page.locator("canvas").count();
console.log("canvases:", canvasCount);

// 2. 视图切换 → 图表廊
await page.getByRole("button", { name: "图表廊" }).click();
await page.waitForURL("**/insights?view=gallery");
console.log("gallery url ok");

// 3. 账本汇总
await page.getByRole("button", { name: "账本汇总" }).click();
await page.waitForURL("**/insights?view=ledger");
await page.waitForSelector("text=明细表");
const rowCount = await page.locator("tbody tr").count();
console.log("ledger rows:", rowCount);

// 4. 数据表切换（第一张图表卡）
await page.getByRole("button", { name: "数据表" }).first().click();
await page.waitForTimeout(300);

// 5. 回到卡片流，深挖锚点 → 追问面板展开
await page.getByRole("button", { name: "卡片流" }).click();
await page.waitForSelector("article[id^='insight-']");
await page.getByRole("button", { name: "深挖" }).first().click();
await page.waitForSelector("text=已锚定");
console.log("anchor bar ok");

// 6. 追问按钮 → 演示回答
await page.getByRole("button", { name: "追问", exact: true }).click();
await page.waitForSelector("text=演示回答", { timeout: 5000 });
console.log("demo answer ok");

// 7. 键盘：t 切换数据表
await page.keyboard.press("j");
await page.keyboard.press("t");
await page.waitForTimeout(300);

// 8. 收藏
await page.getByRole("button", { name: "收藏此洞察" }).first().click();
await page.getByRole("button", { name: /收藏夹/ }).click();
await page.waitForSelector("text=收藏的洞察");
console.log("favorites panel ok");

// 9. 暗色切换后 ECharts 重绘（直接切 html class）
await page.evaluate(() => document.documentElement.classList.add("dark"));
await page.waitForTimeout(500);
console.log("dark toggle ok");

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
