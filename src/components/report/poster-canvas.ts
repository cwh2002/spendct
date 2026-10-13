/**
 * 年度海报绘制：1080×1920 canvas 2D，全程浏览器本地完成，不上传任何数据。
 * 颜色与页面同源（读 CSS 变量），海报底为渐变深底，状态色需比页面 -ink 档
 * 更亮一档以保证对比度，故单独维护 POSTER_STATUS_COLORS。
 */

import { DEMO_ACCOUNT_META, DEMO_REPORT } from "@/lib/demo-data";
import { getRankTier } from "@/lib/rank";

const W = 1080;
const H = 1920;

const FONT_STACK = `"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif`;

/** 渐变底上的状态色：亮一档的绿/黄/橙，与四态语义对应 */
const POSTER_STATUS_COLORS: Record<string, string> = {
  good: "#8df0b4",
  warn: "#ffd76a",
  serious: "#ffa58a",
};

/** 健康指数环的进度色：健康青 */
const HEALTH_COLOR = "#7ee2a8";

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value ? value.trim() : fallback;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 二维码占位：回字形定位图案 ×3 + 中心说明文字，获奖后替换为真实作品二维码 */
function drawFinder(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#16181d";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + size / 4, y + size / 4, size / 2, size / 2);
}

function drawEcg(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy);
  ctx.lineTo(cx - 11, cy);
  ctx.lineTo(cx - 2, cy - 10);
  ctx.lineTo(cx + 5, cy + 8);
  ctx.lineTo(cx + 13, cy - 14);
  ctx.lineTo(cx + 20, cy);
  ctx.stroke();
}

/** 绘制整张海报。布局自顶向下：品牌条 → 主标题 → 健康指数环 → 四指标 → 段位 → 数据来源 → Logo + 二维码占位 */
export function drawAnnualPoster(ctx: CanvasRenderingContext2D): void {
  const primary = cssVar("--color-primary", "#2e7ce8");
  const brand700 = cssVar("--color-brand-700", "#1a55ad");

  // 渐变底 + 纯装饰圆（只做层次，不承载信息）
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, primary);
  bg.addColorStop(1, brand700);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(W - 140, 260, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-120, H - 460, 300, 0, Math.PI * 2);
  ctx.fill();

  const cx = W / 2;
  ctx.textAlign = "center";

  // 品牌条
  roundRect(ctx, cx - 170, 96, 340, 56, 28);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `500 26px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("SpendCT · 年度账单体检", cx, 125);

  // 主标题与副标题
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 76px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("我的 2026 消费年报", cx, 270);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `400 28px ${FONT_STACK}`;
  ctx.fillText(
    `六阶段账单体检 · 覆盖 ${DEMO_ACCOUNT_META.monthsCovered} 个月 · ${DEMO_ACCOUNT_META.totalTransactions.toLocaleString("zh-CN")} 笔消费`,
    cx,
    326,
  );

  // 健康指数环：270° 进度弧 + 中心大数字
  const ringR = 128;
  const ringY = 540;
  ctx.lineCap = "round";
  ctx.lineWidth = 20;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  const frac = Math.min(1, DEMO_REPORT.healthIndex / 100);
  ctx.strokeStyle = HEALTH_COLOR;
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * frac);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 118px ${FONT_STACK}`;
  ctx.fillText(String(DEMO_REPORT.healthIndex), cx, ringY + 28);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `400 26px ${FONT_STACK}`;
  ctx.fillText("健康指数（满分 100）", cx, ringY + 86);

  // 四指标卡：2×2
  const cardW = (W - 88 * 2 - 24) / 2;
  const cardH = 150;
  const cardsTop = 736;
  DEMO_REPORT.namedMetrics.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 88 + col * (cardW + 24);
    const y = cardsTop + row * (cardH + 20);
    roundRect(ctx, x, y, cardW, cardH, 20);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();

    const statusColor = POSTER_STATUS_COLORS[m.status] ?? "#ffffff";

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `500 24px ${FONT_STACK}`;
    ctx.fillText(m.name, x + 28, y + 42);

    // delta 放右侧：变化幅度紧贴基准读数
    ctx.textAlign = "right";
    ctx.fillStyle = statusColor;
    ctx.font = `600 26px ${FONT_STACK}`;
    ctx.fillText(m.delta, x + cardW - 28, y + 42);

    ctx.textAlign = "left";
    ctx.fillStyle = statusColor;
    ctx.font = `800 46px ${FONT_STACK}`;
    ctx.fillText(m.value, x + 28, y + 96);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `400 22px ${FONT_STACK}`;
    ctx.fillText(`同龄基准 ${m.benchmark}`, x + 28, y + 130);
  });

  // 段位条
  const rank = getRankTier();
  const rankY = cardsTop + 2 * (cardH + 20) + 28;
  roundRect(ctx, 88, rankY, W - 176, 112, 20);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${FONT_STACK}`;
  ctx.fillText(`段位 Lv.${rank.tier} · ${rank.name}`, 116, rankY + 56);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 24px ${FONT_STACK}`;
  ctx.fillText(rank.desc, 116, rankY + 96);

  // 数据来源：突出本地计算承诺
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 24px ${FONT_STACK}`;
  ctx.fillText("数据由 DuckDB-WASM 在浏览器本地计算", cx, rankY + 112 + 72);

  // 底部：Logo + 二维码占位
  const footerY = H - 360;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(150, footerY + 40, 34, 0, Math.PI * 2);
  ctx.fill();
  drawEcg(ctx, 150, footerY + 40, brand700);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("SpendCT", 210, footerY + 40);

  const qrSize = 240;
  const qrX = W - 88 - qrSize;
  const qrY = footerY - 70;
  roundRect(ctx, qrX, qrY, qrSize, qrSize, 24);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  drawFinder(ctx, qrX + 40, qrY + 40, 56);
  drawFinder(ctx, qrX + qrSize - 96, qrY + 40, 56);
  drawFinder(ctx, qrX + 40, qrY + qrSize - 96, 56);
  ctx.fillStyle = "#8a8f99";
  ctx.font = `500 24px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.fillText("作品二维码位", qrX + qrSize / 2, qrY + qrSize / 2);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 22px ${FONT_STACK}`;
  ctx.fillText("扫码查看完整报告", qrX + qrSize / 2, qrY + qrSize + 46);
}

/** 在内存 canvas 上渲染海报并输出 PNG Blob：不插入 DOM，下载由调用方处理 */
export function renderPosterPng(): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      drawAnnualPoster(ctx);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      // 绘制异常（如字体度量缺失）不抛出：调用方按失败提示
      resolve(null);
    }
  });
}
