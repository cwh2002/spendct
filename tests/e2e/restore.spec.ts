/**
 * 刷新恢复端到端（A18 会话持久化 + 热修复）：内置账单导入并跑完管线后刷新
 * 页面，验证 IndexedDB → DuckDB 的会话恢复把数据集带回内存态——洞察卡重挂
 * （账本数据仍在），智能助理提问直接走本地引擎（「已按你的账单数据计算」
 * 脚注），不掉在线兜底（无「需要连接在线服务才能回答」提示）。
 *
 * 对应热修复钉住的三个瞬态：
 * 1. 恢复飞行中提问曾「本地答不了 → 误转在线」→ 现在提问前等待恢复落定
 *    （150s 上限，盖过 DuckDB 冷启动实测约 26s 与慢设备 90s+ 的恢复耗时），
 *    恢复完成后本地规则正常命中；
 * 2. 「上上月」曾被 WINDOW_WORDS 子串匹配吞成上个月 → 现在词表先声明
 *    two_months_ago 词条，回答标注「上上个月」；
 * 3. 洞察卡断言曾是恢复完成的隐形屏障 → 现在刷新后立即提问，洞察卡
 *    重挂放到用例末尾断言，让恢复等待路径真实参与。
 *
 * 时钟口径：内置账单时间锚 2026-10-13，而「这个月/上上月」都是相对时间
 * 问法——测试日期漂过 2026-10 后当月无数据、断言必然挂掉，因此用例钉住
 * 浏览器时钟到 2026-10-14（page.clock.install 只设起始时刻、不冻结计时），
 * 并固定时区为 Asia/Shanghai，保证本地引擎的相对月份换算确定。
 * 上传/洞察页受 AuthGuard 保护，装配账单前先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过）。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginDemo } from "./helpers";

// 桌面 1440×900：抽屉在桌面为右下固定面板，直接可见（与 assistant.spec 同口径）；
// 时区固定上海：相对月份（这个月/上上月）按本地时钟换算，跑在不同时区的
// 机器上也得出同一份账单归属
test.use({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
  timezoneId: "Asia/Shanghai",
});

/** 页面访问期间的 console error 收集器：只统计 error 级，聚合到用例尾部断言 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("导入账单 → 刷新 → 账本恢复 + 智能助理本地回答（不掉在线兜底）", async ({ page }) => {
  // 本用例刻意叠加长阶段（导入腿 + 恢复等待上限 150s + 首问 180s 断言窗口），
  // 首问窗口必须盖过恢复上限（150s）加本地计算耗时——慢设备上恢复落在
  // 120–150s 时产品行为正确（恢复后本地命中），窗口过小会先超时挂掉。
  // 总预算按最坏叠加放宽到 540s，让各断言窗口全额可用：不放宽的话全局
  // 超时会与断言窗口共享预算、提前触发
  test.setTimeout(540_000);

  const errors = collectConsoleErrors(page);

  // 钉住浏览器时钟到 2026-10-14（只设起始时刻，计时照常推进）：内置账单
  // 时间锚是 2026-10-13，「这个月/上上月」的相对月份换算必须落在数据存在
  // 的月份，否则测试日期漂移后当月无数据、断言挂掉。
  // 钉钟放在登录导航之前：后续每个页面（含登录）走的都是假时钟
  await page.clock.install({ time: new Date("2026-10-14T12:00:00+08:00") });

  // 0) 上传/洞察页受 AuthGuard 保护：先以演示账户登录，再装配账单
  await loginDemo(page);

  // 1) 与 pipeline.spec 全动线一致的账单装配：先落库并持久化到 IndexedDB
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  // 导入腿首次触发 DuckDB-WASM 引擎加载（38MB 自托管 wasm），全量并行时
  // 各用例是全新浏览器上下文、无 HTTP 缓存，按 service.ts 的
  // 120s 初始化预算给足断言窗口（与 pipeline.spec 同口径）
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });

  // 2) 刷新页面：恢复任务在布局常驻组件里随页面挂载启动。刷新后立即提问，
  //    不先断言洞察卡——那会构成恢复完成的屏障，让「恢复飞行中提问」的
  //    瞬态永远不会触发
  await page.reload();

  // 3) 打开抽屉，第一问紧跟刷新发出（恢复可能仍在飞行）：提问会先等恢复
  //    落定再走管线，本地引擎按账单数据回答并挂本地脚注。金额只从回答
  //    气泡正则解析，不写任何固定数字。断言窗口盖过恢复上限（150s）+
  //    本地计算耗时（刷新后 DuckDB 冷启动 + 行数据重放实测约 26s）
  const drawer = page.locator('section[aria-label="智能助理"]');
  await page.getByRole("button", { name: "打开智能助理" }).click();
  await expect(drawer).toBeVisible();
  const input = page.getByLabel("智能助理输入框");
  await input.fill("这个月花了多少");
  await input.press("Enter");
  const totalBubble = drawer.getByText(/¥/).last();
  await expect(totalBubble).toBeVisible({ timeout: 180_000 });
  const totalText = await totalBubble.innerText();
  expect(totalText).toContain("元");
  expect(Number(totalText.match(/¥([0-9][0-9,.]*)/)?.[1]?.replace(/,/g, ""))).toBeGreaterThan(0);
  await expect(drawer.getByText("已按你的账单数据计算").first()).toBeVisible();

  // 4) 「上上月打车」回归：回答必须标注「上上个月」（修复前被子串匹配
  //    吞成「上个月」），且仍是本地回答
  await input.fill("上上月打车花了多少");
  await input.press("Enter");
  const twoMonthsBubble = drawer.getByText(/上上个月「交通」支出 ¥/).last();
  await expect(twoMonthsBubble).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByText("已按你的账单数据计算").first()).toBeVisible();

  // 5) 恢复最终完成：洞察卡重挂 = IndexedDB 数据集恢复成功（放在提问之后
  //    断言，让恢复等待路径真实参与）
  await expect(page.locator("[id^='insight-card_']").first()).toBeVisible({ timeout: 60_000 });

  // 6) 恢复完成后的提问不得掉在线兜底：整页不出现兜底提示
  await expect(page.locator("body")).not.toContainText("需要连接在线服务才能回答");

  // 7) 全程零 console error
  expect(errors).toEqual([]);
});
