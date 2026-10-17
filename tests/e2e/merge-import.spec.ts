/**
 * 上传追加合并去重（WP4 §4b）端到端：同一内置账单重复导入第二次时，
 * 新行按 (日期|金额|商户) 键与已有数据集全量命中 → 成功视图报
 * 「已导入 0 笔」；刷新页面后会话恢复（IndexedDB → DuckDB）重建的
 * 数据集笔数保持 N，不翻倍、不丢失。
 *
 * 断言链：首次导入 → 跳 /checkup → 第二次导入（断言「已导入 0 笔」）→
 * /settings「当前账本」读出数据集笔数 N（IndexedDB 元数据）→ 导出弹窗
 * 「本次将导出 N 条账单」（有数据集时直读 DuckDB transactions 明细，
 * 不走内置样本回退）→ 刷新后再验两者。
 *
 * 成功视图只停留 1s（SUCCESS_NAV_DELAY_MS）再跳体检，成功文案捕获用
 * waitForFunction 兜住停留窗口：它以 rAF 轮询，导入主线程阻塞（DuckDB
 * 整表重建）一释放便立即执行，恰好落在窗口内；且它以谓词返回的真值
 * resolve，能把文案带出来提取（expect.poll 解析值为 undefined，带不出
 * 谓词返回值，实测不可用于提取）。
 * 上传/设置页受 AuthGuard 保护，用例开头先以演示账户登录
 * （helpers.loginDemo，mock 模式下验证码留空即过）。
 */
import { expect, test } from "@playwright/test";

import { loginDemo } from "./helpers";

test("重复导入同一内置账单：第二次全量跳过，刷新后数据集不翻倍", async ({ page }) => {
  // 本用例叠加两次导入腿（各 120s 预算）+ 刷新后会话恢复（上限 150s），
  // 总预算放宽到 600s：不放宽的话全局超时会与各断言窗口共享预算、提前触发
  test.setTimeout(600_000);

  // 0) 上传/设置页受 AuthGuard 保护：先以演示账户登录
  await loginDemo(page);

  // 1) 首次导入：?sample=1 自动装配内置账单（解析 → 预览确认）→
  //    「开始体检」触发真实导入（清洗 → 合并去重 → initDataset → 落库），
  //    完成后自动跳体检页。导入腿首次触发 DuckDB-WASM 引擎加载（38MB 自托管
  //    wasm），按 service.ts 的 120s 初始化预算给足断言窗口（与 pipeline.spec 同口径）
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });

  // 2) 第二次导入同一 sample：与第一次相同数据 → 全量命中去重键，成功视图
  //    报「已导入 0 笔，开始体检」，只停留 1s 再跳体检，用 waitForFunction
  //    兜住停留窗口（rAF 轮询 + 真值 resolve，直接返回匹配段落的 innerText）
  await page.goto("/upload?sample=1");
  await page.getByRole("button", { name: "开始体检" }).click();
  const successText = await page
    .waitForFunction(
      () => {
        const paragraphs = Array.from(document.querySelectorAll("p"));
        for (const paragraph of paragraphs) {
          const text = paragraph.innerText.trim();
          if (/已导入 0 笔，开始体检/.test(text)) {
            return text;
          }
        }
        return null;
      },
      null,
      { timeout: 120_000 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
  expect(successText).toBeTruthy();
  await expect(page).toHaveURL(/\/checkup/, { timeout: 120_000 });

  // 3) 账本登记笔数：settings「当前账本」= 合并后完整行。每次导入都登记账本，
  //    第二次导入的账本被置为当前（registerImportedBook 写 active-book 键），
  //    rowCount 即 merged.rows.length；页面里「已导入」行有两个（当前账本卡 +
  //    账本列表，两次导入的 rowCount 同为 N），first() 取 DOM 靠前的当前账本行。
  //    N 从这里读出：第二次导入新增 0 笔，账本仍是首次导入的合并后完整行数
  await page.goto("/settings");
  const bookLine = page.getByText(/已导入 [\d,]+ 条账单/).first();
  await expect(bookLine).toBeVisible({ timeout: 15_000 });
  const bookText = await bookLine.innerText();
  const bookMatch = bookText.match(/已导入 ([\d,]+) 条账单/);
  expect(bookMatch).not.toBeNull();
  const datasetRows = Number((bookMatch?.[1] ?? "").replace(/,/g, ""));
  expect(datasetRows).toBeGreaterThan(0);

  // 4) 数据集真实行数：导出弹窗在数据集落库时直读 DuckDB transactions 明细计数
  //    （读不到才回退内置样本，样本行数与 N 不同，断言不通过即暴露回退/翻倍）
  await page.getByRole("button", { name: "导出为表格文件（可用 Excel 打开）" }).click();
  const exportLine = page.getByText(/本次将导出 [\d,]+ 条账单/).first();
  await expect(exportLine).toHaveText(new RegExp(`本次将导出 ${datasetRows} 条账单`), {
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "取消" }).click();

  // 5) 刷新后会话恢复重建数据集：账本元数据与 DuckDB 真实行数都不翻倍。
  //    恢复上限 150s（DuckDB 冷启动 + 行数据重放），导出断言窗口盖过它
  await page.reload();
  await expect(page.getByRole("heading", { name: "数据管理" })).toBeVisible();
  await expect(bookLine).toHaveText(new RegExp(`已导入 ${datasetRows} 条账单`), {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "导出为表格文件（可用 Excel 打开）" }).click();
  await expect(exportLine).toHaveText(new RegExp(`本次将导出 ${datasetRows} 条账单`), {
    timeout: 150_000,
  });

  // 6) 成就联动收口（WP8 §8c cleaner）：第二次导入跳过 N 笔（≥100）已累计进
  //    进度并全量校正，成就墙「一尘不染」解锁（与 achievements.spec 同口径断言）
  await page.goto("/me");
  const cleanerBadge = page
    .locator('section[aria-label="成就墙"]')
    .locator("li", { hasText: "一尘不染" });
  await expect(cleanerBadge).toContainText("已解锁");
  await expect(cleanerBadge).not.toContainText("未解锁");
});
