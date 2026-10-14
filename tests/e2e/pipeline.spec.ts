/**
 * 关键动线端到端：内置账单导入 → 六阶段真实管线 → 洞察卡流 + 演示账户登录。
 * 全程浏览器内 DuckDB-WASM 真实执行（793 行内置交易），无任何 mock。
 * 断言链条：上传页自动装配并跳体检 → 体检自动运行并跳洞察 → 真实卡（card_ 前缀）挂载。
 */
import { expect, test } from "@playwright/test";

test("内置账单走通 上传 → 体检 → 洞察 全动线", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // 1) 上传页 ?sample=1 自动装配内置账单（1000 行），停在字段映射确认步骤；
  //    点击「开始体检」触发真实导入（清洗 → initDataset → 写 store），完成后自动跳体检页
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 60_000 });

  // 2) 体检页自动起跑真实管线，完成后倒计时自动跳洞察页
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // 3) 真实洞察卡挂载（cardId 前缀，与内置卡 ins- 前缀区分），六阶段至少 3 张
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });
  const count = await page.locator("[id^='insight-card_']").count();
  expect(count).toBeGreaterThanOrEqual(3);

  expect(errors).toEqual([]);
});

test("演示账户登录后进入个人中心", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[placeholder="3-20 位小写字母、数字或下划线"]').fill("demo");
  await page.locator('input[placeholder="请输入密码"]').fill("demo123");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/me/, { timeout: 15_000 });
  await expect(page.locator("h1").first()).toBeVisible();
});
