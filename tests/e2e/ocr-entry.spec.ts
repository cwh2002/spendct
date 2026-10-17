/**
 * OCR 截图识别动线端到端（02 §12.1 / 07 §11 多模态二次确认）：
 * 入口卡 → 合规弹窗（§12.4 文案逐字）→ 选图 → mock 识别剧本 →
 * 确认表（低置信标黄 + 可编辑）→ 截取局部二次复核 → 确认导入 →
 * 与 CSV 同一落库路径进入体检。
 *
 * 识别内容断言只锚定 mock 剧本的确定性行（07 §7），不断言「识别结果=
 * 图片内容」——图片是合成条纹图，真实识别评测走仓库外的本地探针脚本
 * （不进仓库）。
 * 上传页受 AuthGuard 保护，两个用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过），再进入 /upload。
 */
import { expect, test } from "@playwright/test";

import { loginDemo } from "./helpers";

test("OCR 截图识别走通 入口 → 合规确认 → 识别 → 二次复核 → 导入 动线", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  // 0) 上传页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 上传页：截图识别是第一入口（卡片在 CSV 入口之上）
  await page.goto("/upload");
  await page.getByRole("button", { name: /账单截图识别/ }).click();

  // 2) 合规弹窗：02 §12.4 文案逐字锚点 + 截图来源选择
  await expect(
    page.getByText("账单截图将仅发送至视觉大模型 DeepSeek V4.1 Flash 用于本次文字识别"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认并选择截图" }).click();

  // 3) 选图：合成账单截图（mock 模式服务端不读图片字节，走确定性剧本）
  await page.setInputFiles(
    'input[type="file"][accept^="image/"]',
    "tests/e2e/fixtures/bill-screenshot.png",
  );

  // 4) 确认表：剧本 8 行 + 2 行低置信标黄；商户为可编辑输入框（人工确认路径）
  await expect(page.getByText("共 8 笔")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("低置信 2 行")).toBeVisible();
  await expect(page.getByLabel("第 1 行商户")).toHaveValue("瑞幸咖啡");
  await expect(page.getByLabel("第 1 行金额")).toHaveValue("12.9");

  // 5) 二次复核：截取原图局部重发视觉模型，复核后低置信清零
  await page.getByRole("button", { name: "重新核对低置信行" }).click();
  await expect(page.getByText("低置信 0 行")).toBeVisible({ timeout: 30_000 });
  // 复核是确认不是改写：文本保持剧本原值
  await expect(page.getByLabel("第 4 行商户")).toHaveValue("地铁出行");

  // 6) 确认导入：与 CSV 同路径装配 → 成功视图 → 跳转体检。
  //    导入腿首次触发 DuckDB-WASM 引擎加载（38MB 自托管 wasm），全量并行时
  //    各用例是全新浏览器上下文、无 HTTP 缓存，按 service.ts 的
  //    120s 初始化预算给足断言窗口（与 CSV 路径 pipeline.spec 同口径）
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(
    page.getByText(/已导入 [\d,]+ 笔，跳过疑似重复 [\d,]+ 笔，开始体检/),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });

  expect(errors).toEqual([]);
});

test("OCR 合规弹窗可取消：回到空态且不发起识别", async ({ page }) => {
  // 上传页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);
  await page.goto("/upload");
  await page.getByRole("button", { name: /账单截图识别/ }).click();
  await expect(
    page.getByText("账单截图将仅发送至视觉大模型 DeepSeek V4.1 Flash 用于本次文字识别"),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  // 弹窗关闭，右栏回到空态提示
  await expect(
    page.getByText("账单截图将仅发送至视觉大模型 DeepSeek V4.1 Flash 用于本次文字识别"),
  ).toBeHidden();
  await expect(page.getByText("还没有账单——从左侧选择一个入口开始")).toBeVisible();
});
