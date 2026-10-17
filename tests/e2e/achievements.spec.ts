/**
 * 成就徽章真实解锁端到端（WP8 §8f）：徽章墙锁定态 → 完成动作 → 解锁态。
 *
 * 用例 1：首次体检动线——?sample=1 导入内置账单跑完整管线后，runner 收口处
 * recheckAll 判定 first-checkup，个人中心成就墙「首次体检」从锁定转解锁。
 * 用例 2：学生权益激活动线——学习页任一学生权益卡点「标记为已激活」
 * （recordProgressEvent + recheckAll，scholar），成就墙「学生权益通」解锁。
 *
 * 阈值型徽章（连续 7 天记账/打卡、累计 10 次收藏/追问等）按真实 UI 动线
 * 需要 7-10 次重复操作才解锁，判定边界已由单测覆盖（achievements-rules.test.ts
 * 每枚命中/未命中边界），e2e 只覆盖一次动作即解锁的徽章；二次导入跳过
 * 全量内置账单解锁「一尘不染」的断言在 merge-import.spec 末尾同源顺带覆盖。
 * 上传/个人中心页受 AuthGuard 保护，用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过）。
 */
import { expect, test } from "@playwright/test";

import { loginDemo } from "./helpers";

/** 成就墙内按徽章名取卡片：sr-only 状态文本随解锁态在「已解锁」/「未解锁，解锁条件：…」间切换 */
function badgeOf(page: import("@playwright/test").Page, name: string) {
  return page.locator('section[aria-label="成就墙"]').locator("li", { hasText: name });
}

test("首次体检解锁「首次体检」徽章", async ({ page }) => {
  await loginDemo(page);

  // 1) ?sample=1 自动装配内置账单 → 「开始体检」跑真实管线，完成后自动
  //    跳体检页再跳洞察页（与 pipeline.spec.ts 全动线同一写法）。导入腿
  //    首次触发 DuckDB-WASM 引擎加载（38MB 自托管 wasm），按 service.ts 的
  //    120s 初始化预算给足断言窗口
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // 2) 管线收口（runner.setRun）触发 recheckAll：成就墙「首次体检」解锁
  await page.goto("/me");
  const firstBadge = badgeOf(page, "首次体检");
  await expect(firstBadge).toContainText("已解锁");
  await expect(firstBadge).not.toContainText("未解锁");
  // 落盘佐证：解锁集写入本机成就键
  const stored = await page.evaluate(() => localStorage.getItem("spendct:achievements:v1"));
  expect(stored).toContain("first-checkup");
});

test("学习页激活学生权益解锁「学生权益通」徽章", async ({ page }) => {
  await loginDemo(page);

  // 1) 学习页任一学生权益案例卡的「标记为已激活」按钮：点击后按钮文案
  //    换成「已激活」并禁用（本机进度只记一次，所有权益卡共享同一激活态），
  //    按旧文案的 locator 不再命中，改按新状态断言
  await page.goto("/learn");
  const activate = page.getByRole("button", { name: "标记为已激活" }).first();
  await expect(activate).toBeVisible();
  await activate.click();
  await expect(page.getByRole("button", { name: "已激活" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "已激活" }).first()).toBeDisabled();

  // 2) 激活动作触发 recheckAll：成就墙「学生权益通」解锁
  await page.goto("/me");
  const scholarBadge = badgeOf(page, "学生权益通");
  await expect(scholarBadge).toContainText("已解锁");
  await expect(scholarBadge).not.toContainText("未解锁");
  const stored = await page.evaluate(() => localStorage.getItem("spendct:achievements:v1"));
  expect(stored).toContain("scholar");
});
