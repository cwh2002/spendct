/**
 * 追问面板问答动线端到端：真实账单的本地回答 + 空数据集的闲聊与示例问题入口
 * + 在线兜底的工具徽章动线。
 *
 * 三条动线：
 * 1. 真实账单：/upload?sample=1 自动装配内置账单 → 「开始体检」跑真实管线 →
 *    自动跳转洞察页（写法与 pipeline.spec.ts 全动线一致），随后在追问面板
 *    输入两个账单问题，验证回答直接来自本地账单数据，且「类目支出 ≤ 总支出」。
 * 2. 空数据集：直接访问 /insights（本会话未跑体检、无任何账单数据），验证
 *    面板空态的示例问题 chips 可点击提问、闲聊输入走问候文案，且无数据时
 *    本地认识与不认识的账单问法都回「还没有账单数据」引导文案（不空手转在线），
 *    并确认旧版写死的占位回答文案及其固定数字不再出现在页面上。
 * 3. 在线兜底（DEMO_MODE=mock 的确定性演示流）：真实账单装配后提问大促关键词
 *    问题（本地意图不识别）→ 面板经 /api/followup（SSE）收到脚本化工具事件与
 *    promo 档文案，回答气泡挂「在线生成」脚注与工具徽章（账单库元数据回执 +
 *    大促日历两枚，徽章来自 tool:start/tool:end 事件而非模型文本）。
 *
 * 数据真实性约束：本文件不硬编码任何金额或笔数——金额一律从回答气泡里
 * 用正则解析，再做关系校验；旧版占位文案按整页断言排除。
 * 上传/洞察页受 AuthGuard 保护，三条动线的用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过）。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

// 桌面 1440×900：追问面板是洞察页右侧固定列、直接可见无需点开；
// 关闭动画偏好，避免气泡弹跳动画干扰等待断言
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

/** 页面访问期间的 console error 收集器：只统计 error 级，聚合到用例尾部断言 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

/** 「¥1,234.56」 → 1234.56：取文本中第一个 ¥ 金额（千分位逗号兼容） */
function parseFirstYuan(text: string): number {
  const matched = text.match(/¥([0-9][0-9,.]*)/);
  const raw = matched?.[1];
  if (!raw) throw new Error(`回答文本中未找到金额：${text}`);
  return Number(raw.replace(/,/g, ""));
}

/** 洞察页右侧追问面板：aria 标签是面板容器唯一稳定锚点 */
const PANEL = 'aside[aria-label="追问面板"]';

test("真实账单：追问面板按本地账单数据回答且类目支出不超过总支出", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  // 0) 上传/洞察页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 上传页 ?sample=1 自动装配内置账单，点击「开始体检」跑真实管线，
  //    完成后自动跳体检页再跳洞察页（与 pipeline.spec.ts 全动线同一写法）
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  // 导入腿首次触发 DuckDB-WASM 引擎加载（38MB 自托管 wasm），全量并行时
  // 各用例是全新浏览器上下文、无 HTTP 缓存，按 service.ts 的
  // 120s 初始化预算给足断言窗口（与 pipeline.spec 同口径）
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // 2) 等真实洞察卡挂载（card_ 前缀）：确保账单数据已落库、洞察页数据就绪，
  //    避免追问抢跑读到空库返回「还没有账单数据」
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });
  const count = await page.locator("[id^='insight-card_']").count();
  expect(count).toBeGreaterThanOrEqual(3);

  const panel = page.locator(PANEL);
  const input = page.getByLabel("追问输入框");
  await expect(input).toBeVisible();

  // 3) 第一问：本月总支出。回答气泡是面板里最深层的 ¥ 文本元素（取最后一个匹配），
  //    金额只从气泡文本解析，不写任何固定数字
  await input.fill("这个月花了多少");
  await input.press("Enter");
  const totalBubble = panel.getByText(/¥/).last();
  await expect(totalBubble).toBeVisible({ timeout: 15_000 });
  const totalText = await totalBubble.innerText();
  expect(totalText).toContain("元");
  const total = parseFirstYuan(totalText);
  expect(total).toBeGreaterThan(0);

  // 4) 第二问：本月餐饮支出。回答气泡需同时含「餐饮」与 ¥，
  //    用户提问气泡只含「餐饮」无 ¥，据此锁定第二轮答案气泡
  await input.fill("这个月餐饮花了多少");
  await input.press("Enter");
  const diningBubble = panel.getByText(/餐饮/).filter({ hasText: /¥/ }).last();
  await expect(diningBubble).toBeVisible({ timeout: 15_000 });
  const diningText = await diningBubble.innerText();
  expect(diningText).toContain("元");
  const dining = parseFirstYuan(diningText);
  expect(dining).toBeGreaterThan(0);

  // 5) 金额关系：餐饮是总支出的子集，餐饮支出不可能超过本月总支出
  expect(dining).toBeLessThanOrEqual(total);

  // 6) 旧版写死的占位回答文案与固定数字不得出现在整页任何位置
  await expect(page.locator("body")).not.toContainText("内置回答");
  await expect(page.locator("body")).not.toContainText("1,286 元");
  await expect(page.locator("body")).not.toContainText("42 笔");

  // 7) 全程零 console error
  expect(errors).toEqual([]);
});

test("空数据集：示例问题 chips 与闲聊分流动线", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  // 0) 洞察页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 未跑体检直接进洞察页：面板空态展示引导文案与示例问题 chips
  await page.goto("/insights");
  const panel = page.locator(PANEL);
  await expect(panel.getByText("点一个示例问题试试").first()).toBeVisible();

  // 2) 点击第一个示例问题（空态里唯一带可见文字的按钮群；发送/折叠按钮
  //    无可见文字不会命中），面板应自动填框并提交，空数据集返回引导文案。
  //    先点 chip 再问闲聊：空态只在会话开始前出现，同一会话内顺序不可颠倒
  const firstChip = panel.locator('button, [role="button"]').filter({ hasText: /.+/ }).first();
  await expect(firstChip).toBeVisible();
  await firstChip.click();
  await expect(panel.getByText("还没有账单数据").first()).toBeVisible({ timeout: 15_000 });

  // 3) 闲聊分流：输入「你好」走问候文案，不触发账单查询；
  //    以问候文案里不带身份指代的固定句式做断言锚点
  const input = page.getByLabel("追问输入框");
  await input.fill("你好");
  await input.press("Enter");
  await expect(panel.getByText("可以围绕你的账单数据回答问题").first()).toBeVisible({
    timeout: 15_000,
  });

  // 4) 无数据 + 本地认识的问法（商户排行）：意图解析后直接本地回引导文案
  await input.fill("我现在的商户排行是有哪些");
  await input.press("Enter");
  await expect(panel.getByText("还没有账单数据").last()).toBeVisible({ timeout: 15_000 });

  // 5) 无数据 + 本地不认识的账单问法（旧版会空手转在线、被模型挡回）：
  //    新增的无数据闸门应本地回引导文案，不发在线请求
  await input.fill("帮我分析一下我的消费");
  await input.press("Enter");
  await expect(panel.getByText("还没有账单数据").last()).toBeVisible({ timeout: 15_000 });

  // 6) 旧版写死的占位回答文案与固定数字不得出现在整页任何位置
  await expect(page.locator("body")).not.toContainText("内置回答");
  await expect(page.locator("body")).not.toContainText("1,286 元");
  await expect(page.locator("body")).not.toContainText("42 笔");

  // 7) 全程零 console error
  expect(errors).toEqual([]);
});

test("在线兜底：大促关键词问题挂工具徽章与在线生成脚注（mock 演示流）", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  // 0) 上传/洞察页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 与第一动线相同的真实账单装配：先落库，避免追问转在线时拿不到上下文
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  // 导入腿首次触发 DuckDB-WASM 引擎加载（38MB 自托管 wasm），全量并行时
  // 各用例是全新浏览器上下文、无 HTTP 缓存，按 service.ts 的
  // 120s 初始化预算给足断言窗口（与 pipeline.spec 同口径）
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });

  const panel = page.locator(PANEL);
  const input = page.getByLabel("追问输入框");
  await expect(input).toBeVisible();

  // 2) 大促关键词问题：本地意图不识别 → 在线兜底（DEMO_MODE=mock 走脚本化
  //    演示流）。回答文案来自 mock promo 档叙事（数字与大促日历数据文件一致）。
  //    「预热期」只出现在回答里（用户提问气泡不含），以此为回答气泡锚点
  await input.fill("双11 大促期间我该怎么规划消费");
  await input.press("Enter");
  const promoBubble = panel.getByText(/预热期/).last();
  await expect(promoBubble).toBeVisible({ timeout: 20_000 });
  const promoText = await promoBubble.innerText();
  expect(promoText).toContain("双11");
  expect(promoText).toContain("10 月 20 日");

  // 3) 在线来源脚注（数据口径声明，不是模型文本）
  await expect(panel.getByText("在线生成 · 已发送明细与统计").first()).toBeVisible();

  // 4) 工具徽章两枚：账单元数据回执（确定性调用）+ 大促日历（演示工具事件）。
  //    徽章展示名来自工具注册表（getToolLabel），与 SSE 事件里的真实工具名分离
  await expect(panel.getByText("账单库元数据回执").first()).toBeVisible();
  await expect(panel.getByText("大促日历").first()).toBeVisible();

  // 5) 旧版写死的占位回答文案与固定数字不得出现在整页任何位置
  await expect(page.locator("body")).not.toContainText("内置回答");
  await expect(page.locator("body")).not.toContainText("1,286 元");
  await expect(page.locator("body")).not.toContainText("42 笔");

  // 6) 全程零 console error
  expect(errors).toEqual([]);
});
