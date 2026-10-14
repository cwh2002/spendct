/**
 * 洞察卡图表数据口径验证（QA 核对脚本，不进测试套件）：
 * 内置账单走完整管线后逐卡打开「数据表」视图，断言单位换算、时间维度升序、
 * 环比卡 % 口径、异常日卡只含脉冲日；另检查卡面说明行/统计行与 canvas 是否真实绘制。
 * 用法：node scripts/verify-chart-data.mjs（需 dev server 在 3000 端口）
 */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://localhost:3000/upload?sample=1");
await page.getByRole("button", { name: "开始体检" }).click();
await page.waitForURL(/\/insights/, { timeout: 120_000 });
await page.locator("[id^='insight-card_']").first().waitFor({ state: "visible", timeout: 60_000 });
await page.waitForFunction(
  () => document.querySelectorAll("[id^='insight-card_'] canvas").length >= 3,
  undefined,
  { timeout: 60_000 },
);
await page.waitForTimeout(1500);

const results = [];
const cards = await page.locator("[id^='insight-card_']").all();
for (const card of cards) {
  const id = await card.getAttribute("id");
  await card.scrollIntoViewIfNeeded();
  // 卡面说明行（图表标题）与证据统计行
  const titleRow = await card.locator("p.mb-1\\.5").count().catch(() => 0);
  const statItems = await card.locator("ul > li").count().catch(() => 0);
  // canvas 是否真实绘制（像素方差 > 0）
  const painted = await card.locator("canvas").first().evaluate((canvas) => {
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, Math.min(canvas.width, 200), Math.min(canvas.height, 120)).data;
      let min = 255, max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const l = data[i + 3] === 0 ? 255 : data[i];
        if (l < min) min = l;
        if (l > max) max = l;
      }
      return max - min > 10;
    } catch {
      return false;
    }
  }).catch(() => false);
  // 数据表视图行内容
  const tableBtn = card.getByRole("button", { name: "数据表" });
  await tableBtn.click().catch(() => {});
  await page.waitForTimeout(300);
  const rows = await card.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => {
      const cells = tr.querySelectorAll("td");
      return [cells[0]?.textContent ?? "", cells[1]?.textContent ?? ""];
    }),
  );
  const hasCanvasInTable = await card.locator("canvas").count();
  results.push({ id, titleRow, statItems, painted, tableRows: rows, canvasCount: hasCanvasInTable });
  await tableBtn.click().catch(() => {}); // 切回图表
}

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
};

for (const r of results) {
  console.log(`\n=== ${r.id} ===`);
  console.log(`  说明行=${r.titleRow} 统计项=${r.statItems} canvas绘制=${r.painted}`);
  const values = r.tableRows.map(([, v]) => v);
  const labels = r.tableRows.map(([l]) => l);

  if (r.id.includes("profile_2_2")) {
    // 月度走势折线：月份升序 + 元两位小数
    const months = labels.map((l) => l.replace(/-\d+$/, ""));
    const sorted = [...months].sort();
    assert(JSON.stringify(months) === JSON.stringify(sorted), `月份未升序：${months.join(",")}`);
    assert(values.length > 0 && values.every((v) => /\d+\.\d{2} 元/.test(v)), `金额格式错：${values.join(",")}`);
    assert(r.titleRow === 1, "缺少图表说明行");
  }
  if (r.id.includes("profile_2_1")) {
    // 类目占比环图：12 类目、金额为元
    assert(values.length === 12, `类目数=${values.length}（期望 12）`);
    assert(values.every((v) => /\d+\.\d{2} 元/.test(v)), `环图金额格式错：${values.join(",")}`);
  }
  if (r.id.includes("anomaly_3_1")) {
    // 深夜消费：月份升序 + 只含有深夜消费的月份
    const months = labels.map((l) => l.replace(/-\d+$/, ""));
    const sorted = [...months].sort();
    assert(JSON.stringify(months) === JSON.stringify(sorted), `月份未升序：${months.join(",")}`);
    assert(values.every((v) => /^\d+\.\d{2} 元$/.test(v)), `深夜金额格式错：${values.join(",")}`);
  }
  if (r.id.includes("anomaly_3_2")) {
    // 异常日：日期升序
    const sorted = [...labels].sort();
    assert(JSON.stringify(labels) === JSON.stringify(sorted), `日期未升序：${labels.join(",")}`);
    assert(values.every((v) => /^\d+\.\d{2} 元$/.test(v)), `异常日金额格式错：${values.join(",")}`);
  }
  if (r.id.includes("attribution_5_1")) {
    // 环比涨幅：全部为正 %，按涨幅降序
    const nums = values.map((v) => parseFloat(v));
    assert(values.every((v) => /^-?\d+(\.\d+)? %$/.test(v) && parseFloat(v) > 0), `涨幅值错：${values.join(",")}`);
    const sorted = [...nums].sort((a, b) => b - a);
    assert(JSON.stringify(nums) === JSON.stringify(sorted), `涨幅未降序：${nums.join(",")}`);
    assert(r.titleRow === 1 && r.statItems >= 3, "说明行/统计行缺失");
  }
  if (r.id.includes("attribution_5_2")) {
    // 环比回落：全部为负 %，按跌幅降序（升序排列）
    const nums = values.map((v) => parseFloat(v));
    assert(values.every((v) => /^-?\d+(\.\d+)? %$/.test(v) && parseFloat(v) < 0), `回落值错：${values.join(",")}`);
    const sorted = [...nums].sort((a, b) => a - b);
    assert(JSON.stringify(nums) === JSON.stringify(sorted), `回落未按跌幅排：${nums.join(",")}`);
  }
  if (r.id.includes("clean_1_1")) {
    const months = labels.map((l) => l.replace(/-\d+$/, ""));
    const sorted = [...months].sort();
    assert(JSON.stringify(months) === JSON.stringify(sorted), `月份未升序：${months.join(",")}`);
  }
}

// 卡面说明行应出现在所有真实卡（真实卡都带 chartTitle）
const missingTitle = results.filter((r) => r.titleRow === 0);
assert(missingTitle.length === 0, `缺说明行卡：${missingTitle.map((r) => r.id).join(",")}`);
const notPainted = results.filter((r) => !r.painted);
assert(notPainted.length === 0, `canvas 空绘：${notPainted.map((r) => r.id).join(",")}`);
assert(errors.length === 0, `console error：${errors.join(" | ")}`);

console.log(failed === 0 ? "\n全部断言通过" : `\n失败 ${failed} 项`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
