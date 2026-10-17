/**
 * 删除账本联动清空（08 修订案 A18 收口）端到端，覆盖两条口径：
 *
 * 1. 删除当前账本后内存联动（无需刷新）：/me 删除账本会清管线 store 与
 *    DuckDB 内存表（discardInMemoryDataset），数据页立即回到演示/空态——
 *    /me 累计结余卡 hint 从「收入 − 支出（全部账单）」回到演示口径
 *    「收入 24,000 − 支出 20,800」，/settings 账本列表空态，
 *    /checkup 回到演示播放态；
 * 2. 设置页删除账本后刷新不复活：/settings 删除同口径清除持久化数据集
 *    （discardDatasetForBook，修复前漏调会留下 datasets 记录），刷新后
 *    restorePipelineSnapshot 无源可恢复，账本空态与演示口径保持。
 *
 * 断言口径说明：
 * - 真实/演示 hint 均来自 /me 数据概览「累计结余」卡（stats 三元：
 *   lastRun 存在且 DuckDB 聚合成功走真实口径），删除前先等体检完成
 *   （checkup 播完自动跳 /insights，lastRun 落库并同步进 IndexedDB），
 *   否则 lastRun 为空、断言提前回到演示口径会假通过；
 * - /checkup 演示播放态的标记选数据来源徽章「内置账单 · 793 条交易」：
 *   checkup mount 时读 usePipeline.datasetTxHash，删除后为 null → demo
 *   分支。demo 与 sample 徽章文案相同，但本用例访问 /checkup 不带
 *   ?sample=1（删除前该页会是 upload 分支的「本地账单」），所以内置
 *   文案徽章就是回到演示播放态的确定性标记；徽章随首屏渲染，断言早于
 *   演示播完（6 阶段 × 700ms + 3s 倒计时后自动跳 /insights）的窗口；
 * - 用例 2 在删除后直读 IndexedDB 的 datasets store 断言记录数为 0
 *   （store 以 bookId 为主键）：这是「刷新不复活」的确定性前置——
 *   restore 只读该 store，记录归零则复活无从发生。
 *
 * 上传/设置/个人中心页受 AuthGuard 保护，用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过）。
 */
import { expect, test } from "@playwright/test";

import { loginDemo } from "./helpers";

test("删除当前账本后数据立即回到演示口径（无需刷新）", async ({ page }) => {
  // 本用例叠加导入腿（120s 预算）+ 等体检完成自动跳 /insights（120s 预算），
  // 总预算放宽到 600s：不放宽的话全局超时会与各断言窗口共享预算、提前触发
  test.setTimeout(600_000);

  // 0) 上传/设置页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 导入内置账单：?sample=1 自动装配（解析 → 预览确认）→「开始体检」触发
  //    真实导入（清洗 → 合并去重 → initDataset → 落库）→ 自动跳体检页。
  //    导入腿首次触发 DuckDB-WASM 引擎加载，按 service.ts 的 120s 初始化预算
  //    给足断言窗口（与 merge-import.spec 同口径）
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });

  // 2) 等体检播完（完成后自动跳 /insights）：lastRun 落库后 /me 才走真实口径，
  //    这一步不等到位，后面「真实口径可见」的断言就是空转
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // 3) /me 数据概览真实口径可见：累计结余卡 hint 为「收入 − 支出（全部账单）」
  await page.goto("/me");
  const overview = page.locator('section[aria-label="数据概览"]');
  await expect(overview.getByText(/收入\s*−\s*支出（全部账单）/)).toBeVisible({ timeout: 15_000 });

  // 4) 删除当前账本：行内删除按钮 aria-label 为「删除账本 <名称>」→
  //    弹窗标题「删除账本？」→ 确认按钮「确认删除」
  await page.getByRole("button", { name: /^删除账本 / }).click();
  await expect(page.getByRole("dialog", { name: "删除账本？" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();

  // 5) 不刷新，累计结余卡 hint 立即回到演示口径「收入 24,000 − 支出 20,800」
  //    （handleDeleteBook 清内存态 → store 清空 → 本页 stats 三元立即回落），
  //    账本列表同步回到空态
  await expect(overview.getByText(/收入 24,000\s*−\s*支出 20,800/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("还没有账本——去上传第一份账单")).toBeVisible();

  // 6) /settings 账本列表空态（跨页联动，无需刷新）
  await page.goto("/settings");
  await expect(page.getByText("还没有账本")).toBeVisible({ timeout: 15_000 });

  // 7) /checkup（不带 ?sample=1）回到演示播放态：数据来源徽章为内置文案
  //    （选择依据见文件头注释）
  await page.goto("/checkup");
  await expect(page.getByText("内置账单 · 793 条交易")).toBeVisible();
});

test("设置页删除账本后刷新不复活", async ({ page }) => {
  // 与用例 1 同口径：导入腿 + 等体检完成自动跳 /insights，总预算放宽到 600s
  test.setTimeout(600_000);

  // 0) 上传/设置页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 导入内置账单并等体检完成：lastRun 同步进 datasets 记录后，修复回归
  //    （漏删持久化数据集）刷新会把 lastRun 一并复活，/me 会回到真实口径，
  //    末尾断言能暴露该回归
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });
  await expect(page).toHaveURL(/\/insights/, { timeout: 120_000 });

  // 2) /settings 删除账本：同名删除按钮有两处（当前账本卡 + 账本列表行），
  //    取 DOM 靠前的当前账本卡按钮（两者对唯一账本弹出同一个删除弹窗）
  await page.goto("/settings");
  const deleteButton = page.getByRole("button", { name: /^删除账本 / }).first();
  await expect(deleteButton).toBeVisible({ timeout: 15_000 });
  await deleteButton.click();
  await expect(page.getByRole("dialog", { name: "删除账本？" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();

  // 3) 账本列表回到空态
  await expect(page.getByText("还没有账本")).toBeVisible({ timeout: 15_000 });

  // 4) 持久化泄漏收口：修复前 settings 删除不调 discardDatasetForBook，
  //    datasets 记录残留会让刷新后的 restore 复活数据；这里直读 IndexedDB
  //    断言记录数为 0（datasets store 以 bookId 为主键，删除唯一账本后应为空）
  const datasetCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("spendct", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("datasets", "readonly");
          const count = tx.objectStore("datasets").count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
      }),
  );
  expect(datasetCount).toBe(0);

  // 5) 刷新后仍为空态：restore 不再把已删数据写回（datasets 已归零，无源可恢复）
  await page.reload();
  await expect(page.getByRole("heading", { name: "数据管理" })).toBeVisible();
  await expect(page.getByText("还没有账本")).toBeVisible({ timeout: 15_000 });

  // 6) /me 累计结余卡仍是演示口径
  await page.goto("/me");
  const overview = page.locator('section[aria-label="数据概览"]');
  await expect(overview.getByText(/收入 24,000\s*−\s*支出 20,800/)).toBeVisible({ timeout: 15_000 });
});
