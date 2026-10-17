/**
 * 关键动线端到端：内置账单导入 → 六阶段真实管线 → 洞察卡流 + 演示账户登录。
 * 全程浏览器内 DuckDB-WASM 真实执行（793 行内置交易），无任何 mock。
 * 断言链条：上传页自动装配并跳体检 → 体检自动运行并跳洞察 → 真实卡（card_ 前缀）挂载。
 * 上传/体检/洞察页受 AuthGuard 保护，用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过）。
 */
import { expect, test } from "@playwright/test";

import { loginDemo } from "./helpers";

test("内置账单走通 上传 → 体检 → 洞察 全动线", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // 0) 数据页强制登录：先以演示账户登录，登录后进入受保护的动线页面
  await loginDemo(page);

  // 1) 上传页 ?sample=1 自动装配内置账单（1000 行），停在字段映射确认步骤；
  //    点击「开始体检」触发真实导入（清洗 → initDataset → 写 store），完成后自动跳体检页
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  // 导入腿首次触发 DuckDB-WASM 引擎加载（38MB 自托管 wasm），全量并行时
  // 各用例是全新浏览器上下文、无 HTTP 缓存，按 service.ts 的
  // 120s 初始化预算给足断言窗口
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });

  // 2) 体检页自动起跑真实管线，完成后倒计时自动跳洞察页
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // 3) 真实洞察卡挂载（cardId 前缀，与内置卡 ins- 前缀区分），六阶段至少 3 张
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });
  const count = await page.locator("[id^='insight-card_']").count();
  expect(count).toBeGreaterThanOrEqual(3);

  expect(errors).toEqual([]);
});

test("演示账户登录后进入个人中心", async ({ page }) => {
  await loginDemo(page);
  await expect(page.locator("h1").first()).toBeVisible();
});
