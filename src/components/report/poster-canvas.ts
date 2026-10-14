/**
 * 年度海报绘制：设计坐标 1080×1920，全程浏览器本地完成，不上传任何数据。
 * 导出时画布按 EXPORT_SCALE 放大（输出 1620×2880）后整体缩放绘制，设计坐标全部不变。
 *
 * 布局采用「测量 + 两遍」法，替代旧的整版写死坐标：
 * 1) computePosterLayout 用 measureText 逐块测量，游标自上而下累加
 *    （品牌条 → 主标题 → 副标题 → 健康指数环+标签 → 指标卡 → 段位条 → 数据来源），
 *    算出所有文本基线与卡片尺寸；页脚（logo + 品牌名）保持底部锚定；
 * 2) 若内容底部越过页脚保护区（FOOTER_Y − 60），按「可用高度/已用高度」的
 *    比例缩小字号与间距重新测量（最多重试一次，保底 0.75 倍）；
 * 3) paintPoster 只按算好的布局绘制，不做任何位置计算。
 * 这样不同平台（PingFang SC / 微软雅黑等）的字体度量差异不会造成文字重叠。
 *
 * 颜色与页面同源（读 CSS 变量），海报底为渐变深底，状态色需比页面 -ink 档
 * 更亮一档以保证对比度，故单独维护 POSTER_STATUS_COLORS。
 */

import { DEMO_ACCOUNT_META, DEMO_REPORT } from "@/lib/demo-data";
import { fmtYuan } from "@/lib/pipeline/stages/spec";
import { getRankTier } from "@/lib/rank";

const W = 1080;
const H = 1920;

/** 导出放大倍数：1080×1920 设计稿放大 1.5 倍输出 1620×2880 PNG，文字与圆环边缘更清晰 */
const EXPORT_SCALE = 1.5;

/** 左右页边距（设计坐标） */
const MARGIN_X = 88;

/** 文本块行高系数：块内行距统一按字号 ×1.4，保证行与行之间留出呼吸空间 */
const LINE_RATIO = 1.4;

/** 页脚基准线（底部锚定）：logo 与品牌名画在 FOOTER_Y 一带，内容区不得越过 FOOTER_Y − 60 */
const FOOTER_Y = H - 360;

const FONT_STACK = `"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif`;

/** 渐变底上的状态色：亮一档的绿/黄/橙，与四态语义对应 */
const POSTER_STATUS_COLORS: Record<string, string> = {
  good: "#8df0b4",
  warn: "#ffd76a",
  serious: "#ffa58a",
};

/** 健康指数环的进度色：健康青 */
const HEALTH_COLOR = "#7ee2a8";

/**
 * 内置数据路径的公开基准（与报告页 METRIC_BENCHMARKS 同口径）：
 * 只有存在公开来源的指标才显示基准行，避免海报出现无来源的对比值。
 * 餐饮占比 29.3% = 国家统计局 2025 恩格尔系数（食品烟酒）；
 * 结余率 32.0% = 按国家统计局 2025 人均收支数据推算（1 − 29,476/43,377）。
 * 订阅率/冲动浓度暂无公开全国基准 → null，不画基准行。
 */
const DEMO_BENCHMARKS: Record<string, string | null> = {
  "hidden-subscription": null,
  impulse: null,
  "dining-share": "29.3%",
  "save-rate": "32.0%",
};

/** 海报单条指标：benchmark 为 null 时不画基准行 */
export interface PosterMetric {
  name: string;
  value: string;
  delta: string;
  status: "good" | "warn" | "serious";
  benchmark: string | null;
}

/**
 * 海报输入数据的最小形状（内置与真实两条动线共用）：
 * 报告页的 ReportData 是它的结构超集，可直接传入，无需转换。
 */
export interface ReportData {
  meta: {
    year: string;
    monthsCovered: number;
    totalTransactions: number;
    totalExpenseCents: number;
  };
  /** 六维健康指数 0-100 */
  healthIndex: number;
  namedMetrics: PosterMetric[];
}

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

/** 用当前 ctx.font 量一段文本的包围盒；度量缺失时按字号比例估算兜底，保证布局不塌 */
function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
): { ascent: number; descent: number; width: number } {
  const m = ctx.measureText(text);
  // 个别环境（字体尚未加载）actualBoundingBox 可能为 0：退回 0.88/0.14 字号估算
  const ascent = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : fontSize * 0.88;
  const descent = m.actualBoundingBoxDescent > 0 ? m.actualBoundingBoxDescent : fontSize * 0.14;
  return { ascent, descent, width: m.width };
}

/** 逐字截断加省略号，直到装进 maxWidth（指标卡 name 与段位描述共用） */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/** 单张指标卡的布局：基线均为「行顶 + 字面上伸」，绘制时直接使用 */
interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  metric: PosterMetric;
  /** name 已在布局期按可用宽度逐字截断（带省略号） */
  nameText: string;
  /** name 与 delta 同排共用一条基线 */
  row1Baseline: number;
  valueBaseline: number;
  /** 无基准行时为 null */
  benchBaseline: number | null;
}

/** 整张海报的布局结果：paintPoster 的唯一位置来源 */
interface PosterLayout {
  scale: number;
  pill: { y: number; w: number; h: number; centerY: number; fontSize: number };
  title: { text: string; baseline: number; fontSize: number };
  subtitle: { text: string; baseline: number; fontSize: number };
  ring: {
    y: number;
    r: number;
    lineWidth: number;
    frac: number;
    healthText: string;
    healthBaseline: number;
    healthFontSize: number;
    labelBaseline: number;
    labelFontSize: number;
  };
  cardFonts: { name: number; delta: number; value: number; bench: number };
  cardsTop: number;
  cardW: number;
  cardH: number;
  cards: CardLayout[];
  rank: {
    top: number;
    h: number;
    line1: string;
    line1Baseline: number;
    line1FontSize: number;
    line2: string;
    line2Baseline: number;
    line2FontSize: number;
  };
  source: { text: string; baseline: number; fontSize: number };
  /** 内容最底部（数据来源行基线 + 字面下伸），用于页脚保护区断言 */
  contentEnd: number;
}

/** 按给定缩放倍数测量整版布局：只计算位置，不绘制 */
function buildLayout(
  ctx: CanvasRenderingContext2D,
  report: ReportData,
  scale: number,
): PosterLayout {
  const s = (n: number) => n * scale;
  const lineH = (fontSize: number) => fontSize * LINE_RATIO;
  ctx.textBaseline = "alphabetic";

  // 品牌条：顶部固定起点，随缩放等比
  const pill = {
    y: s(96),
    w: 340,
    h: s(56),
    centerY: s(96 + 28), // 文字 middle 对齐在胶囊中心
    fontSize: s(26),
  };

  // 主标题：品牌条底部（152）下方留 48 空白起排
  const titleTop = pill.y + pill.h + s(48);
  const titleFontSize = s(76);
  const titleText = `我的 ${report.meta.year} 消费年报`;
  ctx.font = `800 ${titleFontSize}px ${FONT_STACK}`;
  const titleMetrics = measureText(ctx, titleText, titleFontSize);
  const titleBaseline = titleTop + titleMetrics.ascent;

  // 副标题顶部 = 主标题顶部 + 主标题行高（round(76×1.4)=106）+ 14 余量：
  // 200 + 106 + 14 = 320，副标题基线再下移字面上伸（28px 字号约 25）→ 344。
  // 旧基线 326 与 76px 主标题之间只剩约 22px 字形净空（零余量），挪到 344 后
  // 净空约 40px，主副标题不再贴脸。
  const subtitleTop = titleTop + s(Math.round(76 * LINE_RATIO)) + s(14);
  const subtitleText =
    `六步体检 · 覆盖 ${report.meta.monthsCovered} 个月 · ` +
    `${report.meta.totalTransactions.toLocaleString("zh-CN")} 笔 · ` +
    `年度支出 ¥${fmtYuan(report.meta.totalExpenseCents)}`;
  let subtitleFontSize = s(28);
  ctx.font = `400 ${subtitleFontSize}px ${FONT_STACK}`;
  // 真实数据的笔数/支出数字可能很长：超出版心宽度时等比缩小副标题字号
  const maxTextW = W - MARGIN_X * 2;
  const subtitleWidth = ctx.measureText(subtitleText).width;
  if (subtitleWidth > maxTextW) {
    subtitleFontSize = Math.max(s(20), Math.floor(subtitleFontSize * (maxTextW / subtitleWidth)));
    ctx.font = `400 ${subtitleFontSize}px ${FONT_STACK}`;
  }
  const subtitleMetrics = measureText(ctx, subtitleText, subtitleFontSize);
  const subtitleBaseline = subtitleTop + subtitleMetrics.ascent;

  // 健康指数环：270° 圆环（开口朝下），环体随缩放等比
  const ringR = s(128);
  const ringWidth = s(20);
  const ringTop = subtitleBaseline + subtitleMetrics.descent + s(44);
  const ringY = ringTop + ringR + ringWidth / 2;
  const frac = Math.min(1, report.healthIndex / 100);

  // 中心大数字：基线沿用旧设计「环心 +28」口径（118px 字号视觉居环心），随缩放同比
  const healthFontSize = s(118);
  const healthText = String(report.healthIndex);
  const healthBaseline = ringY + s(28);

  // 环下方标签：修复环端圆帽压字。旧位置在环开口内侧（基线 ringY+86），标签宽约
  // 261px，而 270° 环开口两端圆帽（半径=线宽/2）间距只有 161px，两端帽必然压住字形。
  // 新基线 = 环心 + 环半径 + 半线宽 + 4 净空 + 字面上伸（26px 字号约 23）：
  // 环带底 678 → 标签顶 682 净空 4px，标签底距下方指标卡顶约 36px（≥ 审计要求 27px）。
  const labelFontSize = s(26);
  ctx.font = `400 ${labelFontSize}px ${FONT_STACK}`;
  const labelText = "健康指数（满分 100）";
  const labelMetrics = measureText(ctx, labelText, labelFontSize);
  const labelBaseline = ringY + ringR + ringWidth / 2 + s(4) + labelMetrics.ascent;

  // 指标卡 2×2：行高自测（每行 fontSize×1.4），卡高取四卡最大值，整版统一
  const cardsTop = labelBaseline + labelMetrics.descent + s(36);
  const cardW = (W - MARGIN_X * 2 - 24) / 2;
  const cardGap = 24;
  const padX = 28;
  const padTop = s(20);
  const padBottom = s(20);
  const rowGap = s(16);
  const nameFontSize = s(24);
  const deltaFontSize = s(26);
  const valueFontSize = s(46);
  const benchFontSize = s(22);

  // 字面上伸只与字体相关，每种字号各测一次（用代表文本，不依赖具体内容）
  ctx.font = `500 ${nameFontSize}px ${FONT_STACK}`;
  const nameAscent = measureText(ctx, "指标名", nameFontSize).ascent;
  ctx.font = `600 ${deltaFontSize}px ${FONT_STACK}`;
  const deltaAscent = measureText(ctx, "+0.0 个百分点", deltaFontSize).ascent;
  ctx.font = `800 ${valueFontSize}px ${FONT_STACK}`;
  const valueAscent = measureText(ctx, "100.0%", valueFontSize).ascent;
  ctx.font = `400 ${benchFontSize}px ${FONT_STACK}`;
  const benchAscent = measureText(ctx, "全国平均 29.3%", benchFontSize).ascent;
  const row1Ascent = Math.max(nameAscent, deltaAscent);

  // 第一遍：量每张卡的文本。name 先量 delta 宽度再逐字截断，防止同排两列相撞
  const cardPlans = report.namedMetrics.slice(0, 4).map((m) => {
    ctx.font = `600 ${deltaFontSize}px ${FONT_STACK}`;
    const deltaW = measureText(ctx, m.delta, deltaFontSize).width;
    ctx.font = `500 ${nameFontSize}px ${FONT_STACK}`;
    // name 可用宽度 = 卡宽 − 左右内边距 − delta 宽 − 12 间隔
    const nameMax = cardW - padX * 2 - deltaW - s(12);
    const nameText = truncateToWidth(ctx, m.name, nameMax);
    return {
      metric: m,
      nameText,
      lineH1: lineH(deltaFontSize), // 同排两字号取较大者（26）计行高
      lineH2: lineH(valueFontSize),
      lineH3: m.benchmark ? lineH(benchFontSize) : 0,
    };
  });

  // 卡高 = 顶垫 + 各行行高 + 行距 + 底垫（无基准行只有两行）；四卡统一取最大值
  const cardH =
    cardPlans.length > 0
      ? Math.max(
          ...cardPlans.map(
            (p) =>
              padTop +
              p.lineH1 +
              rowGap +
              p.lineH2 +
              (p.lineH3 > 0 ? rowGap + p.lineH3 : 0) +
              padBottom,
          ),
        )
      : 0;

  // 第二遍：定每张卡的坐标与基线（多余高度沉淀在卡底，网格保持对齐）
  const cards: CardLayout[] = cardPlans.map((p, i) => {
    const x = MARGIN_X + (i % 2) * (cardW + cardGap);
    const y = cardsTop + Math.floor(i / 2) * (cardH + s(20));
    const row1Top = y + padTop;
    return {
      x,
      y,
      w: cardW,
      h: cardH,
      metric: p.metric,
      nameText: p.nameText,
      row1Baseline: row1Top + row1Ascent,
      valueBaseline: row1Top + p.lineH1 + rowGap + valueAscent,
      benchBaseline:
        p.lineH3 > 0 ? row1Top + p.lineH1 + rowGap + p.lineH2 + rowGap + benchAscent : null,
    };
  });

  // 段位条：两行文字行高自测，高度随字号等比；描述超宽时逐字截断兜底
  const rankTop = cardsTop + 2 * cardH + s(20) + s(28);
  const rankFontSize = s(34);
  const rankDescFontSize = s(24);
  const rank = getRankTier({ healthIndex: report.healthIndex });
  const rankLine1 = `段位 Lv.${rank.tier} · ${rank.name}`;
  const rankMaxW = W - MARGIN_X * 2 - 28 * 2;
  ctx.font = `400 ${rankDescFontSize}px ${FONT_STACK}`;
  const rankLine2 = truncateToWidth(ctx, rank.desc, rankMaxW);
  const rankDescAscent = measureText(ctx, rankLine2, rankDescFontSize).ascent;
  ctx.font = `700 ${rankFontSize}px ${FONT_STACK}`;
  const rankAscent = measureText(ctx, rankLine1, rankFontSize).ascent;
  const rankH = s(20) + lineH(rankFontSize) + s(12) + lineH(rankDescFontSize) + s(20);
  const rankLine1Baseline = rankTop + s(20) + rankAscent;
  const rankLine2Baseline = rankTop + s(20) + lineH(rankFontSize) + s(12) + rankDescAscent;

  // 数据来源：突出本地计算承诺
  const sourceFontSize = s(24);
  const sourceText = "全部数据在你的浏览器本地计算，不上传";
  ctx.font = `400 ${sourceFontSize}px ${FONT_STACK}`;
  const sourceMetrics = measureText(ctx, sourceText, sourceFontSize);
  const sourceBaseline = rankTop + rankH + s(52);
  const contentEnd = sourceBaseline + sourceMetrics.descent;

  return {
    scale,
    pill,
    title: { text: titleText, baseline: titleBaseline, fontSize: titleFontSize },
    subtitle: { text: subtitleText, baseline: subtitleBaseline, fontSize: subtitleFontSize },
    ring: {
      y: ringY,
      r: ringR,
      lineWidth: ringWidth,
      frac,
      healthText,
      healthBaseline,
      healthFontSize,
      labelBaseline,
      labelFontSize,
    },
    cardFonts: { name: nameFontSize, delta: deltaFontSize, value: valueFontSize, bench: benchFontSize },
    cardsTop,
    cardW,
    cardH,
    cards,
    rank: {
      top: rankTop,
      h: rankH,
      line1: rankLine1,
      line1Baseline: rankLine1Baseline,
      line1FontSize: rankFontSize,
      line2: rankLine2,
      line2Baseline: rankLine2Baseline,
      line2FontSize: rankDescFontSize,
    },
    source: { text: sourceText, baseline: sourceBaseline, fontSize: sourceFontSize },
    contentEnd,
  };
}

/**
 * 计算布局并做页脚保护区断言：内容越界时按「可用高度/已用高度」的比例
 * 缩小字号与间距重排（保底 0.75 倍），页脚始终底部锚定。
 */
function computePosterLayout(ctx: CanvasRenderingContext2D, report: ReportData): PosterLayout {
  const available = FOOTER_Y - 60;
  let scale = 1;
  let layout = buildLayout(ctx, report, scale);
  // 顶部起点 96 随缩放移动：可分配高度 = available − 96×s，已用 = contentEnd − 96×s
  for (let attempt = 0; attempt < 2 && layout.contentEnd > available; attempt++) {
    const used = layout.contentEnd - 96 * scale;
    const space = available - 96 * scale;
    scale = Math.max(0.75, (scale * space) / used);
    layout = buildLayout(ctx, report, scale);
  }
  if (layout.contentEnd > available) {
    // 0.75 倍仍放不下（仅极端字体度量下可能）：提示但照常绘制，不做裁剪
    console.warn("[poster] 内容越过页脚保护区，海报底部可能压页脚");
  }
  return layout;
}

/** 按布局结果绘制整张海报：所有位置来自 layout，函数内不再计算坐标 */
function paintPoster(ctx: CanvasRenderingContext2D, layout: PosterLayout): void {
  const primary = cssVar("--color-primary", "#2e7ce8");
  const brand700 = cssVar("--color-brand-700", "#1a55ad");
  const cx = W / 2;
  const padX = 28;

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

  // 品牌条
  roundRect(ctx, cx - 170, layout.pill.y, layout.pill.w, layout.pill.h, layout.pill.h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `500 ${layout.pill.fontSize}px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("SpendCT · 年度账单体检", cx, layout.pill.centerY);

  // 主标题与副标题
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${layout.title.fontSize}px ${FONT_STACK}`;
  ctx.fillText(layout.title.text, cx, layout.title.baseline);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `400 ${layout.subtitle.fontSize}px ${FONT_STACK}`;
  ctx.fillText(layout.subtitle.text, cx, layout.subtitle.baseline);

  // 健康指数环：270° 底轨 + 进度弧（圆帽）+ 中心大数字 + 环下方标签
  ctx.lineCap = "round";
  ctx.lineWidth = layout.ring.lineWidth;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(cx, layout.ring.y, layout.ring.r, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  ctx.strokeStyle = HEALTH_COLOR;
  ctx.beginPath();
  ctx.arc(
    cx,
    layout.ring.y,
    layout.ring.r,
    Math.PI * 0.75,
    Math.PI * 0.75 + Math.PI * 1.5 * layout.ring.frac,
  );
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${layout.ring.healthFontSize}px ${FONT_STACK}`;
  ctx.fillText(layout.ring.healthText, cx, layout.ring.healthBaseline);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `400 ${layout.ring.labelFontSize}px ${FONT_STACK}`;
  ctx.fillText("健康指数（满分 100）", cx, layout.ring.labelBaseline);

  // 四指标卡：name/delta 同排两列、value 第二行、基准行第三行（仅公开基准）
  for (const card of layout.cards) {
    roundRect(ctx, card.x, card.y, card.w, card.h, 20);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();

    const statusColor = POSTER_STATUS_COLORS[card.metric.status] ?? "#ffffff";

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `500 ${layout.cardFonts.name}px ${FONT_STACK}`;
    ctx.fillText(card.nameText, card.x + padX, card.row1Baseline);

    // delta 放右侧：与 name 共用基线（name 已在布局期按 delta 宽度截断）
    ctx.textAlign = "right";
    ctx.fillStyle = statusColor;
    ctx.font = `600 ${layout.cardFonts.delta}px ${FONT_STACK}`;
    ctx.fillText(card.metric.delta, card.x + card.w - padX, card.row1Baseline);

    ctx.textAlign = "left";
    ctx.fillStyle = statusColor;
    ctx.font = `800 ${layout.cardFonts.value}px ${FONT_STACK}`;
    ctx.fillText(card.metric.value, card.x + padX, card.valueBaseline);

    // 只有存在公开来源基准的指标才画基准行（无公开基准 = null 不画）
    if (card.metric.benchmark && card.benchBaseline !== null) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = `400 ${layout.cardFonts.bench}px ${FONT_STACK}`;
      ctx.fillText(`全国平均 ${card.metric.benchmark}`, card.x + padX, card.benchBaseline);
    }
  }

  // 段位条
  roundRect(ctx, MARGIN_X, layout.rank.top, W - MARGIN_X * 2, layout.rank.h, 20);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${layout.rank.line1FontSize}px ${FONT_STACK}`;
  ctx.fillText(layout.rank.line1, MARGIN_X + 28, layout.rank.line1Baseline);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 ${layout.rank.line2FontSize}px ${FONT_STACK}`;
  ctx.fillText(layout.rank.line2, MARGIN_X + 28, layout.rank.line2Baseline);

  // 数据来源：突出本地计算承诺
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 ${layout.source.fontSize}px ${FONT_STACK}`;
  ctx.fillText(layout.source.text, cx, layout.source.baseline);

  // 页脚（底部锚定）：Logo + 品牌名，保持干净页脚。
  // 原「作品二维码位/扫码查看完整报告」占位已移除——尚无公开部署地址，画假二维码
  // 会误导扫码；部署拿到线上地址后，可用 qrcode 库在此恢复真实二维码。
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(150, FOOTER_Y + 40, 34, 0, Math.PI * 2);
  ctx.fill();
  drawEcg(ctx, 150, FOOTER_Y + 40, brand700);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("SpendCT", 210, FOOTER_Y + 40);
}

/**
 * 绘制整张海报（设计坐标 1080×1920）。
 * 无参走内置数据（离线评审/静态展示），传 report 走报告页映射后的真实数据。
 */
export function drawAnnualPoster(ctx: CanvasRenderingContext2D, report?: ReportData): void {
  const layout = computePosterLayout(ctx, report ?? demoPosterReport());
  paintPoster(ctx, layout);
}

/**
 * 无参调用的内置数据路径：数值与 DEMO_ACCOUNT_META/DEMO_REPORT 同源，
 * 基准行统一走 DEMO_BENCHMARKS（与报告页内置动线同口径，不出现无来源对比值）。
 */
function demoPosterReport(): ReportData {
  return {
    meta: {
      year: "2026", // 内置数据集年份（DEMO_REPORT 故事段口径，报告页 demoReportData 同值）
      monthsCovered: DEMO_ACCOUNT_META.monthsCovered,
      totalTransactions: DEMO_ACCOUNT_META.totalTransactions,
      totalExpenseCents: DEMO_ACCOUNT_META.totalExpenseCents,
    },
    healthIndex: DEMO_REPORT.healthIndex,
    namedMetrics: DEMO_REPORT.namedMetrics.map((m) => ({
      name: m.name,
      value: m.value,
      delta: m.delta,
      status: m.status === "warn" || m.status === "serious" ? m.status : "good",
      benchmark: DEMO_BENCHMARKS[m.id] ?? null,
    })),
  };
}

/**
 * 在内存 canvas 上渲染海报并输出 PNG Blob：不插入 DOM，下载由调用方处理。
 * 画布 1620×2880（设计坐标 ×1.5），绘制前整体缩放一次，设计坐标全部不变。
 */
export function renderPosterPng(report?: ReportData): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = W * EXPORT_SCALE;
      canvas.height = H * EXPORT_SCALE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
      drawAnnualPoster(ctx, report);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      // 绘制异常（如字体度量缺失）不抛出：调用方按失败提示
      resolve(null);
    }
  });
}
