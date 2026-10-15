import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端验收配置：本地 dev server + 桌面 Chromium 单浏览器。
 * 关键动线（上传 → 体检 → 洞察）依赖浏览器内 DuckDB-WASM 真实执行，
 * 全部走真实 UI、不注入 mock——与单测的 fake conn 分层互补（07 §19 验证策略）。
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // 并发上限 2：导入腿（5 条动线）每个都是全新浏览器上下文 + 38MB
  // DuckDB-WASM 编译 + 1000 行落库，实测在 16GB 机器（VSCode 常驻、
  // 空载仅剩 ~3.5GB 空闲）上 workers=4 全量并行时空闲内存探底到
  // ~0.4GB，导入腿随机饿死在 120s 预算上（每次失败用例不同，属
  // 资源性 flake 而非代码缺陷）。2 并发 = 至多 2 个 wasm 导入同跑，
  // 实测稳定通过；慢机器可再降为 1。
  workers: 2,
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
