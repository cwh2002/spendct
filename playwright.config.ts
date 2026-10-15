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
    // e2e 固定端口 3197：与本地开发常驻的 3000 实例隔离。
    // 3000 可能以 live 模式运行（.env.local 有真实 key），mock 断言会静默失效
    baseURL: "http://localhost:3197",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next dev -p 3197",
    url: "http://localhost:3197",
    reuseExistingServer: true,
    timeout: 120_000,
    // e2e 固定跑 mock：本地 .env.local 可能配了真实 DeepSeek key，
    // 测试动线（追问兜底、体检叙事）必须可复现，不依赖外部模型
    env: { DEMO_MODE: "mock" },
  },
});
