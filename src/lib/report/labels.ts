/**
 * 年度报告文案层（通俗化）：评级、六维状态与大白话的纯函数模块。
 *
 * 只做「数字 → 展示文案」的确定性映射，不参与任何分数计算：
 * 六维比率与健康指数的计算口径仍由报告页的 F10 规则唯一决定
 * （src/app/report/page.tsx 的 HEALTH_DIMS / dimScore / computeHealthScore），
 * 本模块的阈值只影响标签颜色与措辞，不会反向改写分数。
 * 报告页与单测共用；全部纯函数、无 DOM 依赖，可离线验证。
 */

/** 六维键：与 v_health_inputs 的六个比率列一一对应（单位 %，近 12 月均值口径） */
export type RatioKey =
  | "foodRatio"
  | "subRatio"
  | "impulseRatio"
  | "nightRatio"
  | "surplusRatio"
  | "bigPulseRatio";

/** 六维状态三档：页面标签用「健康/注意/风险」（与四指标卡的「良好/关注/预警」区分） */
export type HealthDimStatus = "good" | "warn" | "serious";

/** 六维状态的中文标签 */
export const HEALTH_DIM_STATUS_LABELS: Record<HealthDimStatus, string> = {
  good: "健康",
  warn: "注意",
  serious: "风险",
};

/** 健康指数评级四档的语义色 tone：页面按 tone 选既有语义色令牌（good/health/warn/serious） */
export type HealthRatingTone = "good" | "health" | "warn" | "serious";

export interface HealthRating {
  label: string;
  tone: HealthRatingTone;
}

/**
 * 健康指数评级阈值（0-100 分）：≥85 优秀、≥70 良好、≥55 需关注、其余风险。
 * 只用于展示评级徽标，不参与段位判定（段位仍由 rank.ts 的 TIER_BANDS 决定）。
 */
export function healthRatingLabel(score: number): HealthRating {
  if (score >= 85) return { label: "优秀", tone: "good" };
  if (score >= 70) return { label: "良好", tone: "health" };
  if (score >= 55) return { label: "需关注", tone: "warn" };
  return { label: "风险", tone: "serious" };
}

/** 六维文案定义：状态阈值与大白话句式（key/名称/顺序与报告页 HEALTH_DIMS 严格对齐） */
export interface HealthDimDef {
  key: RatioKey;
  name: string;
  /** 占比类比率越低越健康为 true；结余率越高越健康为 false */
  lowerBetter: boolean;
  /** 占比类：≥ 该值进入「注意」档；结余率：低于该值进入「注意」档 */
  warnAt: number;
  /** 占比类：≥ 该值进入「风险」档；结余率：低于该值进入「风险」档 */
  seriousAt: number;
  /** 结余率专用：≥ 该值计「健康」（对齐全国平均 32.0%，按国家统计局 2025 人均收支推算） */
  goodAt?: number;
  /** 大白话句式：入参为原始比率（%），按「每 100 元」口径换算取整 */
  plainText: (ratio: number) => string;
}

/**
 * 六维状态阈值来源（每个数的出处写清楚）：
 * - 餐饮/订阅/冲动/结余：沿用页面四指标卡的既有阈值——
 *   餐饮 warnAt 29.3（国家统计局 2025 恩格尔系数）/ seriousAt 40；
 *   订阅 warnAt 3 / seriousAt 6；冲动 warnAt 15 / seriousAt 25；
 *   结余 goodAt 32.0（国家统计局 2025 人均收支推算）/ warnAt 15；
 * - 深夜：评分边界为 ≥15% 记 0 分（页面 HEALTH_DIMS），取 1/3、2/3 分位作状态线；
 * - 大额脉冲：评分边界为 ≥40% 记 0 分（页面 HEALTH_DIMS），取 1/4、1/2 分位作状态线。
 */
export const HEALTH_DIM_DEFS: readonly HealthDimDef[] = [
  {
    key: "foodRatio",
    name: "餐饮",
    lowerBetter: true,
    warnAt: 29.3,
    seriousAt: 40,
    plainText: (ratio) => `每 100 元支出里，有 ${Math.round(ratio)} 元花在吃饭上`,
  },
  {
    key: "subRatio",
    name: "订阅",
    lowerBetter: true,
    warnAt: 3,
    seriousAt: 6,
    plainText: (ratio) => `每 100 元支出里，有 ${Math.round(ratio)} 元是订阅自动扣费`,
  },
  {
    key: "impulseRatio",
    name: "冲动",
    lowerBetter: true,
    warnAt: 15,
    seriousAt: 25,
    plainText: (ratio) => `每 100 元支出里，有 ${Math.round(ratio)} 元花在冲动下单上`,
  },
  {
    key: "nightRatio",
    name: "深夜",
    lowerBetter: true,
    warnAt: 5,
    seriousAt: 10,
    plainText: (ratio) => `每 100 元支出里，有 ${Math.round(ratio)} 元花在深夜 23 点到凌晨 5 点`,
  },
  {
    key: "surplusRatio",
    name: "结余",
    lowerBetter: false,
    warnAt: 15,
    seriousAt: 0,
    goodAt: 32.0,
    plainText: (ratio) => `每 100 元收入里，能存下 ${Math.round(ratio)} 元`,
  },
  {
    key: "bigPulseRatio",
    name: "大额脉冲",
    lowerBetter: true,
    warnAt: 10,
    seriousAt: 20,
    plainText: (ratio) => `每 100 元支出里，有 ${Math.round(ratio)} 元是单笔超过 500 元的大额开销`,
  },
];

/** 单个比率 → 三档状态：与页面四指标卡 metricStatus 同一套判定形状 */
export function healthDimStatus(ratio: number, def: HealthDimDef): HealthDimStatus {
  if (def.lowerBetter) {
    if (ratio >= def.seriousAt) return "serious";
    if (ratio >= def.warnAt) return "warn";
    return "good";
  }
  if (ratio >= (def.goodAt ?? 0)) return "good";
  if (ratio >= def.warnAt) return "warn";
  return "serious";
}

/** 六维展示行：页面按行渲染「维度名 + 状态标签 + 大白话 + 右侧小字百分比」 */
export interface HealthDimRow {
  key: RatioKey;
  name: string;
  /** 原始比率（%，近 12 月均值口径，保留原值不做取舍） */
  ratio: number;
  status: HealthDimStatus;
  statusLabel: string;
  /** 大白话短句（每 100 元换算口径） */
  plain: string;
}

/** 按 HEALTH_DIM_DEFS 固定顺序组装六维展示行；缺失键按 0 兜底（正常两条动线六键齐备） */
export function buildHealthDims(ratios: Record<RatioKey, number>): HealthDimRow[] {
  return HEALTH_DIM_DEFS.map((def) => {
    const ratio = ratios[def.key] ?? 0;
    const status = healthDimStatus(ratio, def);
    return {
      key: def.key,
      name: def.name,
      ratio,
      status,
      statusLabel: HEALTH_DIM_STATUS_LABELS[status],
      plain: def.plainText(ratio),
    };
  });
}

/**
 * 问题项措辞：带维度名，占比类「餐饮占比偏高/略高」，结余「结余率偏低/略低」
 * （风险档用「偏」、注意档用「略」）。不带名字时多问题并列会读不成句，
 * 总评里的问题项必须自带主语。
 */
function problemWord(row: HealthDimRow): string {
  const def = HEALTH_DIM_DEFS.find((item) => item.key === row.key);
  const lowerBetter = def?.lowerBetter ?? true;
  const degree = row.status === "serious" ? "偏" : "略";
  return lowerBetter ? `${row.name}占比${degree}高` : `${row.name}率${degree}低`;
}

/**
 * 六维总评大白话：结论先行，最多点两个问题项（风险优先、再取注意，按维度顺序）。
 * 规则覆盖常见组合：
 * - 六项全部健康：中性好评兜底；
 * - 有 1-2 个问题项：订阅/冲动/深夜中有 ≥2 项健康时先夸一句「…控制得好」，
 *   再点出问题项并建议调整；
 * - 超过 2 个问题项时只报最严重的两个，避免一段话里塞满数字。
 */
export function buildHealthComment(rows: readonly HealthDimRow[]): string {
  const risk = rows.filter((row) => row.status === "serious");
  const warn = rows.filter((row) => row.status === "warn");
  const problems = [...risk, ...warn].slice(0, 2);
  if (problems.length === 0) {
    return "六个方面都很健康，继续保持现在的消费节奏。";
  }
  const problemText = problems.map(problemWord).join("、");
  const controlled = rows.filter(
    (row) =>
      row.status === "good" &&
      (row.key === "subRatio" || row.key === "impulseRatio" || row.key === "nightRatio"),
  );
  const praise =
    controlled.length >= 2 ? `${controlled[0]!.name}和${controlled[1]!.name}控制得好，` : "";
  return `${praise}主要是${problemText}，建议优先调整。`;
}
