/**
 * 图形验证码：canvas 自绘，无外部服务、无网络请求。
 *
 * 字符集去掉 0/O/1/I/L 等易混字符；画布逻辑尺寸 120×40，
 * 按 devicePixelRatio 放大物理像素后整体缩放，高清屏不糊。
 * 校验规则：trim 后不区分大小写全等；失败由组件换图重来。
 */

/** 验证码字符集：去掉 0、O、1、I、L 等易混字符 */
const CAPTCHA_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** 验证码位数 */
export const CAPTCHA_LENGTH = 4;

/** 画布逻辑尺寸（像素） */
export const CAPTCHA_WIDTH = 120;
export const CAPTCHA_HEIGHT = 40;

/** 字符配色：四种低饱和深色，逐位轮换 */
const INK_COLORS = ["#3b6ea5", "#a0563b", "#4a7d5c", "#7c5aa8"];

/**
 * 生成 length 位验证码。
 * random 可注入以便单测固定序列，默认 Math.random。
 */
export function generateCaptchaCode(
  length: number = CAPTCHA_LENGTH,
  random: () => number = Math.random,
): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CAPTCHA_CHARSET[Math.floor(random() * CAPTCHA_CHARSET.length)];
  }
  return code;
}

/**
 * 校验输入：trim 后大写全等比较，大小写不敏感。
 * 空输入或空答案一律不通过（防御性处理）。
 */
export function verifyCaptcha(input: string, code: string): boolean {
  const normalized = input.trim().toUpperCase();
  const expected = code.trim().toUpperCase();
  if (!normalized || !expected) {
    return false;
  }
  return normalized === expected;
}

/**
 * 把验证码画进 canvas：随机旋转 ±25°、随机基线偏移、两条干扰曲线、30 个噪点。
 * 仅限浏览器调用（依赖 canvas 2d 上下文），SSR 首帧不执行。
 */
export function drawCaptcha(
  canvas: HTMLCanvasElement,
  code: string,
  random: () => number = Math.random,
): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = CAPTCHA_WIDTH * dpr;
  canvas.height = CAPTCHA_HEIGHT * dpr;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.scale(dpr, dpr);

  // 底色：极浅灰，与表单卡片区分开
  ctx.fillStyle = "#eef2f7";
  ctx.fillRect(0, 0, CAPTCHA_WIDTH, CAPTCHA_HEIGHT);

  // 干扰曲线：两条随机起伏的贝塞尔线
  for (let line = 0; line < 2; line += 1) {
    ctx.strokeStyle = "rgba(90, 120, 160, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startY = 8 + random() * (CAPTCHA_HEIGHT - 16);
    ctx.moveTo(0, startY);
    ctx.bezierCurveTo(
      CAPTCHA_WIDTH * 0.3,
      startY + (random() * 16 - 8),
      CAPTCHA_WIDTH * 0.7,
      startY + (random() * 16 - 8),
      CAPTCHA_WIDTH,
      startY + (random() * 16 - 8),
    );
    ctx.stroke();
  }

  // 字符逐个绘制：等宽字体、随机旋转与上下偏移
  const step = CAPTCHA_WIDTH / (code.length + 1);
  for (let i = 0; i < code.length; i += 1) {
    ctx.save();
    ctx.font = "bold 24px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillStyle = INK_COLORS[i % INK_COLORS.length] ?? "#3b6ea5";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(step * (i + 1), CAPTCHA_HEIGHT / 2 + (random() * 10 - 5));
    ctx.rotate(((random() * 50 - 25) * Math.PI) / 180);
    ctx.fillText(code.charAt(i), 0, 0);
    ctx.restore();
  }

  // 噪点：30 个随机 1px 灰点
  for (let dot = 0; dot < 30; dot += 1) {
    ctx.fillStyle = `rgba(90, 120, 160, ${0.15 + random() * 0.25})`;
    ctx.fillRect(random() * CAPTCHA_WIDTH, random() * CAPTCHA_HEIGHT, 1, 1);
  }
}
