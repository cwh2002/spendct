/**
 * 跑 DuckDB-WASM 基准页（T1），把冷/热两轮结果打进 docs/benchmarks.md 的数据来源。
 * 用法：先启动静态服务（python -m http.server 8787 --directory public），
 *       再执行 node scripts/run-spike-benchmark.mjs
 * 结果 JSON 输出到 stdout；同时写入 public/spike/duckdb-wasm/latest-result.json 留档。
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:8787";
const PAGE = `${BASE}/spike/duckdb-wasm/`;

async function runOnce(page, label) {
  // BENCH_ROWS 可选：50000 / 100000 压力档（默认 10000 验收档）
  const rows = process.env.BENCH_ROWS;
  if (rows) {
    await page.selectOption("#rows", rows);
  }
  await page.click("#run");
  await page.waitForFunction(
    () => document.getElementById("status").textContent.includes("完成"),
    { timeout: 120000 },
  );
  const result = await page.evaluate(() => window.__spikeResult);
  if (!result) {
    throw new Error(`[${label}] 未取到页面结果`);
  }
  return result;
}

async function main() {
  // 默认用 Playwright 自带的 chromium；可用 BENCH_CHANNEL=msedge 指定系统 Edge
  const browser = await chromium.launch({
    channel: process.env.BENCH_CHANNEL || undefined,
  });
  try {
    const context = await browser.newContext();

    // 第一轮：冷加载（全新 context，无 HTTP 缓存，sessionStorage 为空）
    const coldPage = await context.newPage();
    coldPage.on("pageerror", (err) => console.error("[cold] 页面错误:", String(err)));
    await coldPage.goto(PAGE, { waitUntil: "load" });
    const cold = await runOnce(coldPage, "cold");
    await coldPage.close();

    // 第二轮：新页面先跑一次（此时 HTTP 缓存已热），再同页刷新重跑——
    // 页面自身用 sessionStorage 判定「热加载」，第二次结果即热加载口径
    const hotPage = await context.newPage();
    hotPage.on("pageerror", (err) => console.error("[hot] 页面错误:", String(err)));
    await hotPage.goto(PAGE, { waitUntil: "load" });
    await runOnce(hotPage, "hot-warmup");
    await hotPage.reload({ waitUntil: "load" });
    const hot = await runOnce(hotPage, "hot");
    await hotPage.close();

    const out = {
      capturedAt: new Date().toISOString(),
      engine: "chromium",
      cold: { rowCount: cold.rowCount, wasmLoadMs: cold.wasmLoadMs, importAggMs: cold.importAggMs, memoryMb: cold.memoryMb, aggRowCount: cold.aggRowCount, totalAmount: cold.totalAmount },
      hot: { wasmLoadMs: hot.wasmLoadMs, importAggMs: hot.importAggMs, memoryMb: hot.memoryMb },
    };
    console.log(JSON.stringify(out, null, 2));
    const rowCount = cold.rowCount ?? "10000";
    await writeFile(
      new URL(`../public/spike/duckdb-wasm/result-${rowCount}.json`, import.meta.url),
      JSON.stringify(out, null, 2),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
