import { chromium } from "@playwright/test";

const PANEL = 'aside[aria-label="追问面板"]';
const log = (...a) => console.log("[repro]", ...a);

const run = await chromium.launch();
const page = await run.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

async function dumpPanel(label) {
  await page.waitForTimeout(800);
  const text = await page.locator(PANEL).innerText().catch(() => "<panel not found>");
  log(`=== ${label} ===`);
  log(text);
}

async function ask(q) {
  const input = page.getByLabel("追问输入框");
  await input.fill(q);
  await input.press("Enter");
  log(`asked: ${q}`);
}

// FRESH PAGE, NO DATA: direct /insights without upload
log("step 1: goto /insights (fresh, no data)");
await page.goto("http://localhost:3000/insights", { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(1500);

// Q1 identity
await ask("你好，你是谁？");
await page.waitForTimeout(1500);
await dumpPanel("after Q1 (identity)");

// Q2 unparseable -> online fallback -> DuckDB cold init inside buildAggregateContext
await ask("帮我看看我的消费习惯");
await page.waitForTimeout(30000);
await dumpPanel("after Q2 (unparseable, 30s wait)");

// Q3 bill question -> datasetTxHash null short-circuit
await ask("这个月花了多少");
await page.waitForTimeout(8000);
await dumpPanel("after Q3 (bill question, no data)");

// Q4 anchor 深挖 flow: click first 深挖, then 追问 button
const delve = page.getByRole("button", { name: /深挖/ }).first();
if (await delve.count()) {
  await delve.click();
  await page.waitForTimeout(800);
  const follow = page.getByRole("button", { name: "追问", exact: true }).first();
  await follow.click().catch(() => log("WARN: no 追问 button"));
  await page.waitForTimeout(15000);
  await dumpPanel("after Q4 (anchor 追问, 15s wait)");
} else {
  log("WARN: no 深挖 button found");
}

log("console errors:", JSON.stringify(consoleErrors, null, 2));
await run.close();
