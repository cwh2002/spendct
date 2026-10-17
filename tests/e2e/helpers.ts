/**
 * e2e 共享工具：演示账户登录。
 *
 * 数据页强制登录（WP1：/upload /checkup /insights /calendar /report /challenge
 * /goals /poster /budget /me /settings 共 11 页包 AuthGuard）后，各 spec 访问
 * 受保护页的用例都在开头先调 loginDemo——保持真实 UI 登录路径，不用
 * storageState 预置会话，防止登录回归被掩盖。
 *
 * 演示账户 demo/demo123 由应用在 DEMO_MODE=mock 下自带（playwright webServer
 * 已带该环境变量），无需种子数据；图形验证码在 mock 模式下留空即通过
 * （CaptchaField 的 mockBypass 放行位置），所以这里只填账号密码、不填验证码，
 * 登录后按 URL 进入个人中心 /me（15s 断言窗口，与登录前表单校验耗时兼容）。
 */
import { expect, type Page } from "@playwright/test";

/** 登录演示账户并等待进入个人中心（/me），mock 模式下验证码留空即过 */
export async function loginDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator('input[placeholder="3-20 位小写字母、数字或下划线"]').fill("demo");
  await page.locator('input[placeholder="请输入密码"]').fill("demo123");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/me/, { timeout: 15_000 });
}
