/**
 * 省钱挑战打卡（A17）端到端动线：演示数据路径（无体检结果）下
 * 选类目 → 定预算 → 开始挑战 → 打卡今日 → 已打卡态 → 刷新持久 → 撤销回退。
 * 挑战记录持久化在 localStorage（spendct:challenge:v1），刷新后仍在。
 */
import { expect, test, type Page } from "@playwright/test";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("省钱挑战：开始挑战 → 打卡 → 刷新持久 → 撤销", async ({ page }) => {
  const errors = collectConsoleErrors(page);
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
