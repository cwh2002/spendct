/**
 * 省钱挑战打卡（A17）与今日支出手动输入（WP4 §4a）端到端动线：
 * 演示数据路径（无体检结果）下 选类目 → 定预算 → 开始挑战 →
 * 打卡今日 → 已打卡态 → 刷新持久 → 撤销回退；进行中挑战的今日卡
 * 「记今日支出」保存后即时叠加进今日支出并附「含手动记录」小注，
 * 手动账本与预算页同键持久化（localStorage spendct:manual-entries），
 * 刷新后仍在。
 * 挑战记录持久化在 localStorage（spendct:challenge:v1），刷新后仍在。
 * 挑战页受 AuthGuard 保护，用例开头先以演示账户登录（helpers.loginDemo，
 * mock 模式下验证码留空即过），再进入 /challenge。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

/** 从今日卡支出行文本解析金额（分）：文本形如「今日支出 ¥12.50 / 预算 ¥20.00 …」 */
function todayCentsFrom(text: string): number {
  const yuan = text.match(/今日支出 ¥([\d,.]+)/)?.[1] ?? "";
  expect(yuan).not.toBe("");
  return Math.round(parseFloat(yuan.replace(/,/g, "")) * 100);
}

test("省钱挑战：开始挑战 → 打卡 → 刷新持久 → 撤销", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginDemo(page);
  await page.goto("/challenge");
  await expect(page.getByRole("heading", { name: "省钱挑战" })).toBeVisible();

  // 未开始：选类目（chip 带 aria-pressed），选完展示基线说明
  await page.getByRole("button", { name: "餐饮", exact: true }).click();
  await expect(page.getByRole("button", { name: "餐饮", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 填每日预算并开始
  await page.locator("#challenge-quota").fill("20");
  await page.getByRole("button", { name: "开始挑战" }).click();

  // 进行中：概览四宫格与今日卡出现（exact 匹配避开副标题/玩法说明里的同词句）
  await expect(page.getByText("进行天数", { exact: true })).toBeVisible();
  await expect(page.getByText("连续打卡", { exact: true })).toBeVisible();
  await expect(page.getByText("累计节省", { exact: true })).toBeVisible();

  // 打卡今日 → 已打卡态；再点撤销 → 回到未打卡
  await page.getByRole("button", { name: "打卡今日" }).click();
  await expect(page.getByText("已打卡").first()).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByRole("button", { name: "打卡今日" })).toBeVisible();

  // 打卡后刷新：记录持久化在 localStorage，页面回到已打卡态
  await page.getByRole("button", { name: "打卡今日" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "省钱挑战" })).toBeVisible();
  await expect(page.getByText("已打卡").first()).toBeVisible();
  await expect(page.getByText("进行天数")).toBeVisible();

  expect(errors).toEqual([]);
});

test("进行中挑战：今日卡手动记支出 → 即时更新 → 刷新持久", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginDemo(page);
  await page.goto("/challenge");
  await expect(page.getByRole("heading", { name: "省钱挑战" })).toBeVisible();

  // 启动挑战（照抄首个用例动线：选类目 → 定预算 → 开始）
  await page.getByRole("button", { name: "餐饮", exact: true }).click();
  await expect(page.getByRole("button", { name: "餐饮", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#challenge-quota").fill("20");
  await page.getByRole("button", { name: "开始挑战" }).click();
  await expect(page.getByText("进行天数", { exact: true })).toBeVisible();

  // 今日卡支出行：全页唯一含「今日支出 ¥」的文本节点（金额在派生层已含手动账，
  // 嵌套祖先同样命中该正则，first() 取最内层 p，口径同「已打卡」.first()）
  const todayLine = page.getByText(/今日支出 ¥/).first();
  await expect(todayLine).toBeVisible();
  const beforeCents = todayCentsFrom(await todayLine.innerText());

  // 记今日支出 12.5 元：保存走 upsert（当日同类目覆盖/追加），与预算页同键账本
  await page.getByLabel("手动记录今日支出金额（元）").fill("12.5");
  await page.getByRole("button", { name: "保存" }).click();

  // 即时联动：回填「已记」按钮、「含手动记录」小注出现、今日支出金额 +12.50
  await expect(page.getByRole("button", { name: "已记 ¥12.50 · 修改" })).toBeVisible();
  await expect(page.getByText("含手动记录", { exact: true })).toBeVisible();
  await expect
    .poll(async () => todayCentsFrom(await todayLine.innerText()))
    .toBe(beforeCents + 1250);

  // 刷新持久：手动账本在 localStorage（spendct:manual-entries），金额与小注仍在
  await page.reload();
  await expect(page.getByRole("heading", { name: "省钱挑战" })).toBeVisible();
  await expect(page.getByRole("button", { name: "已记 ¥12.50 · 修改" })).toBeVisible();
  await expect(page.getByText("含手动记录", { exact: true })).toBeVisible();
  await expect
    .poll(async () => todayCentsFrom(await todayLine.innerText()))
    .toBe(beforeCents + 1250);

  expect(errors).toEqual([]);
});
