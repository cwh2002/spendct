/**
 * PDF 汇编素材采集：把核心页面截图到 scripts/.shots/（不入库，见 .gitignore）。
 *
 * 用法：先起 dev server（pnpm dev），再 `node scripts/capture-shots.mjs`。
 * 采集顺序与页面依赖：
 *   1) 游客态静态页（首页/登录/注册/课堂/隐私）；
 *   2) 示例账单全动线（上传 → 真实六阶段管线 → 洞察真实卡），订阅/报告沿
 *      顶导航点击做 SPA 跳转——保留同页会话的 DuckDB 单例与管线 store，
 *      页面查询真实聚合数据（整页 goto 会重载丢失内存态，见 runner 注释）；
 *   3) 演示账户登录后访问受保护页（个人中心/设置/预算）；
 *   4) 独立上下文的演示模式体检页（分阶段计时器，适合展示思考过程）。
 * 统一 1600×900 视口，暗色样张在洞察页会话内拍摄后立即切回亮色。
 */
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
// fileURLToPath 会正确解码中文路径（URL pathname 不解码，直接用会落到 %E8 字面目录）
const OUT_DIR = `${fileURLToPath(new URL(".", import.meta.url))}.shots/`;

const shots = [];

/** 页面截图：等 h1 挂载后执行（部分页有异步图表回填，额外留 400ms 稳定时间） */
async function shot(page, name) {
  await page.locator("h1").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}${name}.png` });
  shots.push(name);
  console.log(`✓ ${name}.png`);
}

/** 顶导航点击（SPA 跳转，保会话内存态）：目标页 h1 挂载后截图 */
async function navShot(page, linkName, shotName) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: linkName }).click();
  await shot(page, shotName);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

// ── 1) 游客态静态页 ──────────────────────────────────────────────
await page.goto(`${BASE}/`);
await shot(page, "01-home");

await page.goto(`${BASE}/login`);
await shot(page, "02-login");

await page.goto(`${BASE}/register`);
await shot(page, "03-register");

await page.goto(`${BASE}/learn`);
await shot(page, "09-learn");

await page.goto(`${BASE}/privacy`);
await shot(page, "10-privacy");

// ── 2) 示例账单全动线（真实管线） ───────────────────────────────
await page.goto(`${BASE}/upload?sample=1`);
await page.getByRole("button", { name: "示例账单" }).waitFor();
// 等自动装配完成（字段映射确认步骤出现「开始体检」按钮）
await page.getByRole("button", { name: "开始体检" }).waitFor({ timeout: 30_000 });
await shot(page, "04-upload");

await page.getByRole("button", { name: "开始体检" }).click();
await page.waitForURL(/\/checkup/, { timeout: 60_000 });
// 管线刚起跑：停留 1.5s 捕捉前序阶段运行中的思考面板
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT_DIR}05-checkup-real.png` });
shots.push("05-checkup-real");
console.log("✓ 05-checkup-real.png");

await page.waitForURL(/\/insights/, { timeout: 120_000 });
await page.locator("[id^='insight-card_']").first().waitFor({ timeout: 60_000 });
await shot(page, "06-insights-real");

// 暗色模式样张（真实卡上验证暗色图表桥接），拍完切回亮色
await page.getByRole("button", { name: "切换到暗色模式" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT_DIR}11-insights-dark.png` });
shots.push("11-insights-dark");
console.log("✓ 11-insights-dark.png");
await page.getByRole("button", { name: "切换到亮色模式" }).click();
await page.waitForTimeout(400);

// 订阅/报告沿导航 SPA 跳转，查询真实聚合数据
await navShot(page, "订阅", "07-subscriptions");
await navShot(page, "报告", "08-report");

// ── 3) 演示账户登录 → 受保护页 ───────────────────────────────────
await page.goto(`${BASE}/login`);
await page.locator('input[placeholder="3-20 位小写字母、数字或下划线"]').fill("demo");
await page.locator('input[placeholder="请输入密码"]').fill("demo123");
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/me/, { timeout: 15_000 });
await shot(page, "12-me");

await page.goto(`${BASE}/settings`);
await shot(page, "13-settings");

await page.goto(`${BASE}/budget`);
await shot(page, "14-budget");

await ctx.close();

// ── 4) 演示模式体检页（独立上下文，分阶段计时器展示思考过程） ──
const demoCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const demoPage = await demoCtx.newPage();
await demoPage.goto(`${BASE}/checkup`);
await demoPage.waitForTimeout(4000);
await demoPage.screenshot({ path: `${OUT_DIR}15-checkup-demo.png` });
shots.push("15-checkup-demo");
console.log("✓ 15-checkup-demo.png");
await demoCtx.close();

await browser.close();
console.log(`完成：共 ${shots.length} 张，输出目录 ${OUT_DIR}`);
