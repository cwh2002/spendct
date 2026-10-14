/**
 * SSR 水合一致性回归：预置与服务器兜底冲突的本地存储（成就解锁集、段位档位），
 * 整页加载（真实 SSR + 水合）后不得出现水合不一致报错，且最终渲染本地值。
 * 覆盖用户反馈的「报告页已解锁 4/12 与本地 3/12 不一致」一类问题：
 * 本地数据只能订阅式读取（useSyncExternalStore 服务器快照），渲染期直接读
 * localStorage 或分支 typeof window 必炸。
 */
import { expect, test, type Page } from "@playwright/test";

/** 水合相关报错收集：console error/warning 与页面异常都统计 */
function collectHydrationErrors(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (/hydration|did not match/i.test(msg.text())) issues.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (/hydration|did not match/i.test(String(err))) issues.push(String(err));
  });
  return issues;
}

test.beforeEach(async ({ context }) => {
  // 页面脚本运行前写入：解锁集仅 1 枚、段位 1 档，
  // 与服务器兜底（演示集 4 枚、健康分兜底 3 档）故意冲突
  await context.addInitScript(() => {
    try {
      localStorage.setItem("spendct:achievements:v1", JSON.stringify(["first-checkup"]));
      localStorage.setItem("spendct:rank:v1", JSON.stringify({ tier: 1 }));
    } catch {
      // 隐私模式不可写：用例退化为无存储场景，仍验证渲染不报错
    }
  });
});

test("报告页：本地存储与服务器兜底冲突时水合一致", async ({ page }) => {
  const issues = collectHydrationErrors(page);
  await page.goto("/report");
  await expect(page.locator("h1").first()).toBeVisible();
  // 水合后渲染的是本地值（1 枚），而非服务器演示集（4 枚）
  await expect(page.getByText(/已解锁 1\/12 枚/).first()).toBeVisible();
  await expect(page.getByText("消费新手").first()).toBeVisible();
  expect(issues).toEqual([]);
});

test("个人中心：登录后整页加载水合一致", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[placeholder="3-20 位小写字母、数字或下划线"]').fill("demo");
  await page.locator('input[placeholder="请输入密码"]').fill("demo123");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/me/);

  // reload 走真实 SSR：游客态 /me 会被重定向，必须先登录
  const issues = collectHydrationErrors(page);
  await page.reload();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.getByText(/已解锁 1\/12 枚/).first()).toBeVisible();
  await expect(page.getByText("消费新手").first()).toBeVisible();
  expect(issues).toEqual([]);
});

test("个人中心：账本归属提示展示、可关闭且关闭状态持久化", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[placeholder="3-20 位小写字母、数字或下划线"]').fill("demo");
  await page.locator('input[placeholder="请输入密码"]').fill("demo123");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/me/);

  // 提示条默认展示：直接回答「换账户不换账本」的困惑
  const banner = page.locator('aside[aria-label="账本归属说明"]');
  await expect(banner).toBeVisible();
  await expect(banner.getByText("账单数据保存在本机浏览器，不随账户切换")).toBeVisible();

  // 关闭一次：本次会话内消失
  await banner.getByRole("button", { name: "关闭提示" }).click();
  await expect(banner).toHaveCount(0);

  // 关闭状态写入 localStorage，刷新后仍不出现（持久化）
  const issues = collectHydrationErrors(page);
  await page.reload();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator('aside[aria-label="账本归属说明"]')).toHaveCount(0);
  expect(issues).toEqual([]);
});

test("订阅页：本地提醒/标记/攻略进度与服务器空态冲突时水合一致", async ({
  context,
  page,
}) => {
  // 服务器端渲染空态（无提醒/无标记/0 步攻略），本地预置冲突记录
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        "spendct:reminder:v1",
        JSON.stringify([
          {
            id: "sub-1",
            merchantRef: "m1",
            nextChargeDate: "2026-10-20",
            amountCents: 1500,
            createdAt: 1,
          },
        ]),
      );
      localStorage.setItem("spendct:sub-labels", JSON.stringify({ "sub-1": "false-positive" }));
      localStorage.setItem("spendct:cancel-progress:v1", JSON.stringify({ "sub-1": [0, 1] }));
    } catch {
      // 隐私模式不可写：用例退化为无存储场景，仍验证渲染不报错
    }
  });

  const issues = collectHydrationErrors(page);
  await page.goto("/subscriptions");
  await expect(page.locator("h1").first()).toBeVisible();
  // 水合后渲染本地真实值，而非服务器空态
  await expect(page.getByText(/已设提醒/).first()).toBeVisible();
  await expect(page.getByText("已标记为误报").first()).toBeVisible();
  await expect(page.getByText("已完成 2/4 步").first()).toBeVisible();
  await expect(page.getByText(/距离下次扣费 \d+ 天|今天扣费/).first()).toBeVisible();
  expect(issues).toEqual([]);
});

test("首页：通知铃铛本地已读/断点与服务器兜底冲突时水合一致", async ({
  context,
  page,
}) => {
  // 服务器口径渲染的订阅扣费通知在本地已读，且本地多一个断点续跑通知
  await context.addInitScript(() => {
    try {
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      localStorage.setItem(
        "spendct:notif:v1",
        JSON.stringify({
          subDue: true,
          budgetOver: true,
          resume: true,
          read: [`sub-due-${dayKey}`],
        }),
      );
      localStorage.setItem(
        "spendct:checkpoint:v1",
        JSON.stringify({ paused: true, stage: "stage-scan", ts: Date.now() }),
      );
    } catch {
      // 隐私模式不可写：用例退化为无存储场景，仍验证渲染不报错
    }
  });

  const issues = collectHydrationErrors(page);
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible();
  // 水合后按本地口径派生（断点通知未读），角标存在且两端渲染一致
  await expect(page.locator('button[title="通知中心"]')).toHaveAttribute(
    "aria-label",
    /通知中心，\d+ 条未读/,
  );
  expect(issues).toEqual([]);
});
