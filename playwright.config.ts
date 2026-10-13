import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端验收配置：本地 dev server + 桌面 Chromium 单浏览器。
 * 关键动线（上传 → 体检 → 洞察）依赖浏览器内 DuckDB-WASM 真实执行，
 * 全部走真实 UI、不注入 mock——与单测的 fake conn 分层互补（07 §19 验证策略）。
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
