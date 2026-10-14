/**
 * 内置数据单一来源（demo 模式）：
 * 各页面静态展示态共用这份脱敏内置数据，保证跨页数字口径一致
 * （订阅金额、类目分布、月度汇总互相咬合）。
 * 正式管线接通后，页面数据源切换为 DuckDB 聚合结果，此文件仅保留
 * 用于「加载内置账单」动线与离线评审。
 *
 * 数据口径（与 src/lib/pipeline/mock-run.ts 生成器同源，2026-10 定稿）：
 * - 麦可思 2025 调查：大学生月均生活费 1,744 元。账户月收入 2,000 元 × 12 笔，
 *   年支出 20,800 元（月均约 1,733 元，落在 1,744 元预算线内），年结余 3,200 元；
 * - 国家统计局 2025 居民消费构成（食品烟酒 29.3% 等）：餐饮占年度支出 40.9%，
 *   高于居民均值、符合学生以食堂外卖为主的结构；
 * - 订阅价格为公开真实价（哔哩哔哩大会员 15 元/月、网易云音乐黑胶 15 元/月、
 *   腾讯视频 VIP 25 元/月），年化合计 660 元。
 * 本文件所有金额字段一律整数分；全部数字来自生成器的确定性输出
 * （经临时口径 dump 测试逐项对账），生成器改动后需重新对账。
 */

export const DEMO_ACCOUNT_META = {
  monthsCovered: 12,
  totalTransactions: 793,
  totalExpenseCents: 2_080_000, // 年度已支付支出 20,800 元
  // 2026-09 已支付支出（生成器确定性聚合，供预算页「本月已用」与体检页口径对齐）
  currentMonthExpenseCents: 215_764,
  savedCents: 320_000, // 收入 2,400,000 − 支出 2,080,000，结余率 13.3%
};

export interface DemoStage {
  id: string;
  name: string;
  cards: number;
  elapsedMs: number;
}

export const DEMO_STAGES: DemoStage[] = [
  { id: "clean", name: "清洗", cards: 2, elapsedMs: 456 },
  { id: "profile", name: "消费画像", cards: 4, elapsedMs: 890 },
  { id: "anomaly", name: "异常检测", cards: 3, elapsedMs: 1120 },
  { id: "subscription", name: "订阅陷阱扫描", cards: 4, elapsedMs: 640 },
  { id: "attribution", name: "环比归因", cards: 3, elapsedMs: 1020 },
  { id: "annual", name: "年度报告", cards: 6, elapsedMs: 1580 },
];

export interface DemoSubscription {
  id: string;
  merchantRef: string; // m_+8hex 脱敏
  ruleId: string;
  cycle: "daily" | "weekly" | "monthly" | "yearly";
  amountCents: number;
  lastChargeDate: string;
  nextChargeInDays: number;
  charges: { date: string; amountCents: number }[];
  totalYearCents: number;
}

/**
 * 订阅商户三件套：价格取公开真实月费，扣款日与生成器 DEMO_SUBSCRIPTION_SPECS
 * 逐项一致（每月 2/5/15 日）。merchantRef 按「商户名 sha256 前 8 位 hex」脱敏
 * （m_+8hex，与订阅页真实路径同形）。nextChargeInDays 是窗口末（2026-09-30）
 * 的静态快照，订阅卡展示时按周期外推重算。
 */
export const DEMO_SUBSCRIPTIONS: DemoSubscription[] = [
  {
    id: "sub-1",
    merchantRef: "m_3c774151", // 哔哩哔哩大会员
    ruleId: "rule:sub-monthly-1",
    cycle: "monthly",
    amountCents: 1_500,
    lastChargeDate: "2026-09-02",
    nextChargeInDays: 2,
    charges: [
      { date: "2025-10-02", amountCents: 1_500 },
      { date: "2025-11-02", amountCents: 1_500 },
      { date: "2025-12-02", amountCents: 1_500 },
      { date: "2026-01-02", amountCents: 1_500 },
      { date: "2026-02-02", amountCents: 1_500 },
      { date: "2026-03-02", amountCents: 1_500 },
      { date: "2026-04-02", amountCents: 1_500 },
      { date: "2026-05-02", amountCents: 1_500 },
      { date: "2026-06-02", amountCents: 1_500 },
      { date: "2026-07-02", amountCents: 1_500 },
      { date: "2026-08-02", amountCents: 1_500 },
      { date: "2026-09-02", amountCents: 1_500 },
    ],
    totalYearCents: 18_000,
  },
  {
    id: "sub-2",
    merchantRef: "m_f7a2ed12", // 网易云音乐黑胶
    ruleId: "rule:sub-monthly-2",
    cycle: "monthly",
    amountCents: 1_500,
    lastChargeDate: "2026-09-05",
    nextChargeInDays: 5,
    charges: [
      { date: "2025-10-05", amountCents: 1_500 },
      { date: "2025-11-05", amountCents: 1_500 },
      { date: "2025-12-05", amountCents: 1_500 },
      { date: "2026-01-05", amountCents: 1_500 },
      { date: "2026-02-05", amountCents: 1_500 },
      { date: "2026-03-05", amountCents: 1_500 },
      { date: "2026-04-05", amountCents: 1_500 },
      { date: "2026-05-05", amountCents: 1_500 },
      { date: "2026-06-05", amountCents: 1_500 },
      { date: "2026-07-05", amountCents: 1_500 },
      { date: "2026-08-05", amountCents: 1_500 },
      { date: "2026-09-05", amountCents: 1_500 },
    ],
    totalYearCents: 18_000,
  },
  {
    id: "sub-3",
    merchantRef: "m_5758abe9", // 腾讯视频 VIP
    ruleId: "rule:sub-monthly-3",
    cycle: "monthly",
    amountCents: 2_500,
    lastChargeDate: "2026-09-15",
    nextChargeInDays: 15,
    charges: [
      { date: "2025-10-15", amountCents: 2_500 },
      { date: "2025-11-15", amountCents: 2_500 },
      { date: "2025-12-15", amountCents: 2_500 },
      { date: "2026-01-15", amountCents: 2_500 },
      { date: "2026-02-15", amountCents: 2_500 },
      { date: "2026-03-15", amountCents: 2_500 },
      { date: "2026-04-15", amountCents: 2_500 },
      { date: "2026-05-15", amountCents: 2_500 },
      { date: "2026-06-15", amountCents: 2_500 },
      { date: "2026-07-15", amountCents: 2_500 },
      { date: "2026-08-15", amountCents: 2_500 },
      { date: "2026-09-15", amountCents: 2_500 },
    ],
    totalYearCents: 30_000,
  },
];

export interface DemoInsight {
  id: string;
  stageId: string;
  stageName: string;
  confidence: 1 | 2 | 3 | 4; // ●●●○ 四档
  headline: string;
  narrative: string;
  chartKind: "timeseries" | "donut" | "bar";
  /** 展示单位（真实管线卡按度量字段推断）：元 = 金额按分换算展示，笔/行 = 聚合计数原样展示；缺省按元 */
  chartUnit?: "元" | "笔" | "行";
  chartData: number[];
  chartLabels: string[];
  citations: string[];
  withheld?: { reason: string; action: string };
}

export const DEMO_INSIGHTS: DemoInsight[] = [
  {
    id: "ins-1",
    stageId: "profile",
    stageName: "消费画像",
    confidence: 4,
    headline: "餐饮是最大支出类目，占年度支出 41%",
    narrative:
      "近 12 个月餐饮类支出 8,507 元，占年度总支出的 41%。其中食堂与堂食占 78%，外卖 22%；学校食堂是餐饮第一大商户（1,111 元）。餐饮以日常三餐为主，符合住校学生的消费结构。",
    chartKind: "donut",
    chartData: [41, 16, 9, 7, 6, 5],
    chartLabels: ["餐饮", "购物", "娱乐", "居住", "交通", "教育"],
    citations: ["sql:profile_category_monthly", "rag:spending_advice_12"],
  },
  {
    id: "ins-2",
    stageId: "anomaly",
    stageName: "异常检测",
    confidence: 3,
    headline: "深夜消费 23 笔合计 350 元，游戏充值与直播为主",
    narrative:
      "过去一年有 23 笔消费发生在 23:00–05:00，合计 350 元，占年度支出的 1.7%。其中游戏充值与直播打赏占 84%，深夜外卖 57 元。深夜冲动消费通常与白天的压力水平相关，建议设置夜间支付冷静期。",
    chartKind: "timeseries",
    chartData: [3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
    chartLabels: ["10月", "11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月"],
    citations: ["sql:anomaly_late_night", "rule:late-night-v1"],
  },
  {
    id: "ins-3",
    stageId: "subscription",
    stageName: "订阅陷阱扫描",
    confidence: 4,
    headline: "发现 3 项连续订阅扣费，合计 660 元/年",
    narrative:
      "确定性周期检测命中 3 项连续扣费：哔哩哔哩大会员 15 元/月、网易云音乐黑胶 15 元/月、腾讯视频 VIP 25 元/月，年化合计 660 元，占年度支出的 3.2%。其中腾讯视频 VIP 近 90 天无使用痕迹，属于典型的「沉默订阅」，建议优先处理。",
    chartKind: "bar",
    chartData: [18000, 18000, 30000],
    chartLabels: ["哔哩哔哩大会员", "网易云音乐黑胶", "腾讯视频 VIP"],
    citations: ["sql:subscription_patterns", "rag:subscription_trap_07"],
  },
  {
    id: "ins-4",
    stageId: "attribution",
    stageName: "环比归因",
    confidence: 3,
    headline: "本月支出环比 +23.2%，主要来自开学季采购",
    narrative:
      "本月支出较上月增加 407 元（+23.2%），其中购物类贡献 +519 元（占增量的 128%），娱乐类回落 298 元形成对冲。3 笔大额订单集中在 9 月初的开学季，属一次性脉冲而非趋势性上涨。",
    chartKind: "timeseries",
    chartData: [1814, 1702, 2124, 1387, 1751, 2158],
    chartLabels: ["4月", "5月", "6月", "7月", "8月", "9月"],
    citations: ["sql:attribution_mom", "rule:mom-drift-v2"],
  },
  {
    id: "ins-5",
    stageId: "annual",
    stageName: "年度报告",
    confidence: 2,
    headline: "支付渠道六四开：支付宝 53.6% · 微信 46.4%",
    narrative:
      "年度支出 20,800 元中，支付宝支付 53.6%（407 笔）、微信支付 46.4%（370 笔）。食堂与外卖构成日常支出的基本盘，订阅构成固定成本层，建议把订阅合计纳入月度预算视图，避免固定层侵蚀弹性空间。",
    chartKind: "donut",
    chartData: [54, 46],
    chartLabels: ["支付宝", "微信"],
    citations: ["sql:annual_keywords", "rag:spending_advice_03"],
  },
  {
    id: "ins-6",
    stageId: "anomaly",
    stageName: "异常检测",
    confidence: 2,
    headline: "疑似重复扣费 2 笔，建议核对商户订单",
    narrative:
      "发现 2 笔「重复扣费退款」记录（每笔 39 元，合计 78 元），均已按原支出方向冲回，没有多算支出。样本量较小（2 笔），置信度偏低，建议人工核对订单号后确认到账。",
    chartKind: "bar",
    chartData: [3900, 3900],
    chartLabels: ["第 1 笔", "第 2 笔"],
    citations: ["sql:anomaly_duplicate_charge"],
    withheld: { reason: "样本量不足，显著性未达标", action: "核对商户订单后可手动确认" },
  },
];

export interface DemoBudgetCategory {
  category: string;
  budgetCents: number;
  actualCents: number;
}

/**
 * 月度预算：12 类目预算合计 174,400 分（1,744 元，麦可思 2025 大学生月均
 * 生活费基准）；各 actual 为生成器 2026-09 分类目已支付支出。9 月含开学季
 * 集中采购（购物 755 元），当月整体超预算属演示动线刻意保留的状态（超支
 * 视图的展示入口）。
 */
export const DEMO_BUDGET: {
  totalBudgetCents: number;
  totalActualCents: number;
  categories: DemoBudgetCategory[];
} = {
  totalBudgetCents: 174_400,
  totalActualCents: 215_764,
  categories: [
    { category: "餐饮", budgetCents: 78_000, actualCents: 76_416 },
    { category: "购物", budgetCents: 23_000, actualCents: 75_533 },
    { category: "交通", budgetCents: 12_000, actualCents: 5_160 },
    { category: "娱乐", budgetCents: 14_000, actualCents: 4_608 },
    { category: "居住", budgetCents: 13_000, actualCents: 15_521 },
    { category: "通讯", budgetCents: 9_500, actualCents: 12_784 },
    { category: "医疗", budgetCents: 2_500, actualCents: 2_237 },
    { category: "教育", budgetCents: 9_000, actualCents: 6_302 },
    { category: "人情", budgetCents: 4_000, actualCents: 4_409 },
    { category: "金融", budgetCents: 1_500, actualCents: 5_120 },
    { category: "订阅", budgetCents: 5_500, actualCents: 5_500 },
    { category: "其他", budgetCents: 2_400, actualCents: 2_174 },
  ],
};

/**
 * 未来 3 月支出预测（分）。推导：2026-09 支出 215,764 分含开学季固定采购
 * 50,000 分，剔除后基准 165,764 分；10 月脉冲退去、略低于年化月均 173,333 分
 * （取 168,000），11/12 月向月均回归并随年末聚餐微升（172,000 / 176,000）。
 */
export const DEMO_FORECAST = {
  months: ["2026-10", "2026-11", "2026-12"],
  valuesCents: [168_000, 172_000, 176_000],
  method: "trend_extrapolation",
};

/**
 * 年度报告（F10 六维健康分规则）。
 *
 * 六维定义（radarDims 顺序一致，每维 0-100，越高越健康；维度名与报告页
 * HEALTH_DIMS 的六个比率列对齐）：
 * 1. 餐饮：餐饮占比 40.9%，对照统计局 2025 食品烟酒 29.3% 锚点，每偏离
 *    1pp 扣 5 → 42；
 * 2. 订阅：订阅率 3.2%（66,000/2,080,000），满分线 2%，每超 1pp 扣 25 → 70；
 * 3. 冲动：深夜+促销集中消费 7.3%（151,000/2,080,000），满分线 5%，
 *    每超 1pp 扣 5 → 88；
 * 4. 深夜：深夜占比 1.7%（35,000/2,080,000），满分线 1%，每超 1pp 扣 30 → 79；
 * 5. 结余：结余率 13.3%（320,000/2,400,000），满分线 15%，每低 1pp 扣 6 → 90；
 * 6. 大额脉冲：促销日固定大额 5.6%（116,000/2,080,000），满分线 6%，
 *    每超 1pp 扣 10 → 100。
 * healthIndex = 六维均值取整 = (42+70+88+79+90+100)/6 ≈ 78.2 → 78，
 * 落在 rank.ts TIER_BANDS 第 3 档（65-79，进阶规划师）。
 */
export const DEMO_REPORT = {
  healthIndex: 78,
  namedMetrics: [
    { id: "hidden-subscription", name: "隐形订阅率", value: "3.2%", benchmark: null, delta: "+1.2 个百分点", status: "warn", explain: "订阅支出占总支出的比例（660/20,800）；暂无公开全国基准，重点看取消空间" },
    { id: "impulse", name: "冲动消费浓度", value: "7.3%", benchmark: null, delta: "-4.7 个百分点", status: "good", explain: "深夜与促销日集中消费占比（1,510/20,800）；暂无公开全国基准，越低越健康" },
    { id: "dining-share", name: "餐饮占比", value: "41%", benchmark: "29.3%", delta: "+11.7 个百分点", status: "serious", explain: "餐饮支出占总支出比例；全国平均 29.3%（国家统计局 2025 年居民消费构成·食品烟酒）" },
    { id: "save-rate", name: "结余率", value: "13.3%", benchmark: "32.0%", delta: "+3.3 个百分点", status: "good", explain: "月均结余占收入的比例（3,200/24,000）；全国平均 32.0%（按国家统计局 2025 年人均收支数据推算）" },
  ],
  /** 六维健康分（0-100，顺序与维度名同 DEMO_REPORT 头注释的六维定义） */
  radarDims: [
    { name: "餐饮", value: 42 },
    { name: "订阅", value: 70 },
    { name: "冲动", value: 88 },
    { name: "深夜", value: 79 },
    { name: "结余", value: 90 },
    { name: "大额脉冲", value: 100 },
  ],
  rank: { tier: 3, name: "进阶规划师", desc: "开始控制固定成本层，预算意识成型" },
  storySegments: [
    { headline: "一年 793 笔，你在 12 类目里留下了轨迹", chartKind: "timeseries", chartData: [1549, 1439, 1741, 1650, 1668, 1818, 1814, 1702, 2124, 1387, 1751, 2158], chartLabels: ["10月", "11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月"], narrative: "月均支出 1,733 元，峰值出现在 9 月（开学季 2,158 元），谷值在 7 月（暑期返乡 1,387 元）。全年 20,800 元落在 1,744 元/月的预算线内。" },
    { headline: "食堂与堂食是你的第一消费场景", chartKind: "donut", chartData: [78, 22], chartLabels: ["堂食/食堂", "外卖"], narrative: "堂食与食堂占餐饮支出的 78%，外卖 22%。学校食堂全年消费 1,111 元，是餐饮第一大商户。" },
    { headline: "订阅层悄悄吃掉 660 元/年", chartKind: "bar", chartData: [18000, 18000, 30000], chartLabels: ["哔哩哔哩大会员", "网易云音乐黑胶", "腾讯视频 VIP"], narrative: "3 项连续订阅构成固定成本层，其中腾讯视频 VIP 近 90 天零使用，建议优先处理。" },
    { headline: "体验型消费占大头：体验 44% · 实物 16% · 服务 40%", chartKind: "donut", chartData: [44, 16, 40], chartLabels: ["体验", "实物", "服务"], narrative: "体验类（娱乐、人情、堂食社交）占年度支出的 44%，超过实物购物（16%），其余为交通、居住、通讯等服务类日常支出。" },
  ],
};

/**
 * 成就解锁集校验（新数据口径下逐项复核）：
 * - first-checkup：内置账户已完成一次全流程体检，保持解锁；
 * - sub-hunter：订阅卡命中 1 项沉默订阅（腾讯视频 VIP 近 90 天无使用痕迹），
 *   语义在新订阅口径下仍成立，保持解锁；
 * - streak-7：快速记账是应用内功能（manual 行），其连续打卡不依赖账单数据集
 *   口径，保持解锁。
 * 其余成就均为行为类（海报/预算/早起/采纳建议等），保持锁定。
 */
export const DEMO_ACHIEVEMENTS = {
  unlockedIds: ["first-checkup", "sub-hunter", "streak-7"],
  lockedIds: [
    "budget-master",
    "annual-poster",
    "early-bird",
    "night-guard",
    "saver",
    "scholar",
    "cleaner",
    "questioner",
    "collector",
  ],
};
