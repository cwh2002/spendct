// Repro: insights 追问面板 — Q1 identity answered, follow-up yields nothing?
// Runs against the already-running live dev server (http://localhost:3000, live mode).
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
page.on("requestfailed", (req) =>
  console.log(`[net] requestfailed ${req.url()} ${req.failure()?.errorText}`),
);

async function panelHtml() {
  return page
    .locator('aside[aria-label="追问面板"]')
    .innerText()
    .catch(() => "<panel not found>");
}

async function ask(text, label) {
  const input = page.getByLabel("追问输入框");
  await input.fill(text);
  await input.press("Enter");
  console.log(`\n=== asked(${label}): ${text} ===`);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const txt = await panelHtml();
    const answered = /已按你的账单数据计算|在线生成|还没有账单数据|可以围绕你的账单数据回答问题|我没有固定的模型身份/.test(txt);
    if (answered) {
      // give it a couple more seconds for streaming to finish
      await sleep(3000);
      console.log(`--- panel after answer (${label}) ---`);
      console.log(await panelHtml());
      return "answered";
    }
  }
  console.log(`--- NO ANSWER within 30s (${label}). Panel state: ---`);
  console.log(await panelHtml());
  return "no-answer";
}

try {
  await page.goto(`${BASE}/insights`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  console.log("URL:", page.url());

  // login if redirected
  if (/login/i.test(page.url())) {
    console.log("Login page detected — logging in demo/demo123");
    const u = page.locator('input[name="username"], input[autocomplete="username"], input[type="text"]').first();
    const p = page.locator('input[type="password"]').first();
    await u.fill("demo");
    await p.fill("demo123");
    await page.getByRole("button", { name: /登录|登 录/ }).first().click();
    await page.waitForURL(/insights/, { timeout: 15000 }).catch(() => console.log("did not reach /insights after login, url:", page.url()));
    await sleep(4000);
  }

  console.log("Final URL:", page.url());

  // Q1: identity question (small talk branch)
  const input = page.getByLabel("追问输入框");
  await input.waitFor({ timeout: 10000 });
  await input.fill("你是谁");
  await input.press("Enter");
  await sleep(2500);
  console.log("--- after Q1 你是谁 ---");
  console.log(await panelHtml());

  // Q2: an UNMATCHED follow-up (goes to online fallback in live mode)
  const r2 = await ask("给我一些省钱建议", "Q2 unmatched");

  // Q3: a LOCAL-INTENT follow-up (bill question, no data imported in this fresh session)
  const r3 = await ask("这个月花了多少", "Q3 local intent");

  console.log("\n=== results:", JSON.stringify({ r2, r3 }) === "" ? "n/a" : "", "Q2:", r2, "Q3:", r3);
  console.log("\n=== console errors ===");
  console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");
} finally {
  await browser.close();
}
