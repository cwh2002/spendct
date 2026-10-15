/**
 * RAG 引用与语义搜索端到端（04 §5.6 展示口径，DEMO_MODE=mock）：
 * ① 内置账单全动线跑完后，订阅陷阱卡的「来源」弹层出现「参考常见消费案例」
 *    （浏览器内 TF-IDF 检索同族案例，零网络零模型）；
 * ② 知识课堂搜索按 TF-IDF 语义分数排序：「免费试用」首条为扣费时点案例、
 *    「学生认证」首条为 sb-001 外卖优惠案例；
 * ③ 洞察页省钱贴士按支出 top 类目语义匹配学生权益案例并渲染。
 */
import { expect, test } from "@playwright/test";

test("内置账单全动线 → 订阅卡挂 RAG 案例引用 + 省钱贴士渲染", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // 上传页自动装配内置账单 → 体检 → 洞察（与 pipeline.spec 同动线）
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 60_000 });
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // ① 订阅卡 2（最大订阅项明细）可见，展开「来源」弹层后含 RAG 案例引用
  const subscriptionCard = page.locator("[id='insight-card_subscription_4_2']").first();
  await expect(subscriptionCard).toBeVisible({ timeout: 60_000 });
  await subscriptionCard.getByRole("button", { name: /^来源/ }).click();
  await expect(subscriptionCard.getByText("参考常见消费案例")).toBeVisible();

  // ③ 省钱贴士：按支出 top 类目语义匹配（内置账单餐饮占比最高），至少 1 条学生权益案例
  const tipsSection = page.locator("section[aria-label='省钱贴士']");
  await expect(tipsSection).toBeVisible({ timeout: 30_000 });
  expect(await tipsSection.locator("article").count()).toBeGreaterThanOrEqual(1);

  expect(errors).toEqual([]);
});

test("知识课堂搜索按语义分数排序", async ({ page }) => {
  await page.goto("/learn");
  const list = page.locator("[aria-label='案例列表']");

  // 「免费试用」：语义检索首条为扣费时点案例（st-006，分数高于 st-002）
  await page.getByLabel("搜索案例").fill("免费试用");
  await expect(list.locator("article").first().getByRole("heading", { level: 3 })).toContainText(
    "免费试用",
  );

  // 「学生认证」：首条为 sb-001 外卖优惠案例（分数 0.303，明显高于第二名）
  await page.getByLabel("搜索案例").fill("学生认证");
  await expect(list.locator("article").first().getByRole("heading", { level: 3 })).toContainText(
    "学生认证外卖优惠",
  );

  // 清空搜索回到全量浏览（60 条案例）
  await page.getByLabel("清空搜索").click();
  await expect(list.locator("article")).toHaveCount(60);
});
