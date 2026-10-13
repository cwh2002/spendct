/**
 * 演示数据单一来源（demo 模式）：
 * 各页面静态展示态共用这份脱敏示例数据，保证跨页数字口径一致
 * （订阅金额、类目分布、月度汇总互相咬合）。
 * 正式管线接通后，页面数据源切换为 DuckDB 聚合结果，此文件仅保留
 * 用于「加载示例账单」演示动线与离线评审。
 * 数据均为合成虚构，金额单位：分。
 */

export const DEMO_ACCOUNT_META = {
  monthsCovered: 12,
  totalTransactions: 3_214,
  totalExpenseCents: 3_551_4935, // 355,149.35 元（与 T1 基准 1 万行档同口径）
  currentMonthExpenseCents: 286_4000,
  savedCents: 58_880, // 订阅取消 + 学生权益估算
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

export const DEMO_SUBSCRIPTIONS: DemoSubscription[] = [
  {
    id: "sub-1",
    merchantRef: "m_3f8a1c02",
    ruleId: "rule:sub-monthly-1",
    cycle: "monthly",
    amountCents: 1_500,
    lastChargeDate: "2026-09-02",
    nextChargeInDays: 3,
    charges: [
      { date: "2025-10-02", amountCents: 1_500 },
      { date: "2025-11-02", amountCents: 1_500 },
      { date: "2025-12-02", amountCents: 1_500 },
      { date: "2026-01-02", amountCents: 1_500 },
      { date: "2026-02-02", amountCents: 1_500 },
      { date: "2026-03-02", amountCents: 1_500 },
      { date: "2026-09-02", amountCents: 1_500 },
    ],
    totalYearCents: 18_000,
  },
  {
    id: "sub-2",
    merchantRef: "m_9c4e7b11",
    ruleId: "rule:sub-monthly-2",
    cycle: "monthly",
    amountCents: 2_500,
    lastChargeDate: "2026-09-15",
    nextChargeInDays: 16,
    charges: [
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
  {
    id: "sub-3",
    merchantRef: "m_7d20e5a9",
    ruleId: "rule:sub-weekly-1",
    cycle: "weekly",
    amountCents: 900,
    lastChargeDate: "2026-10-05",
    nextChargeInDays: 6,
    charges: [
      { date: "2026-08-05", amountCents: 900 },
      { date: "2026-08-12", amountCents: 900 },
      { date: "2026-09-05", amountCents: 900 },
      { date: "2026-09-12", amountCents: 900 },
      { date: "2026-10-05", amountCents: 900 },
    ],
    totalYearCents: 10_880,
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
    headline: "餐饮是最大支出类目，占月均支出 34%",
    narrative:
      "近 12 个月餐饮类支出月均 812 元，占总支出的 34%。其中外卖占 58%，堂食 42%。周五与周末的餐饮支出比工作日均值高 41%，周末集中消费特征明显。",
    chartKind: "donut",
    chartData: [34, 22, 14, 12, 10, 8],
    chartLabels: ["餐饮", "购物", "交通", "娱乐", "居住", "其他"],
    citations: ["sql:profile_category_monthly", "rag:spending_advice_12"],
  },
  {
    id: "ins-2",
    stageId: "anomaly",
    stageName: "异常检测",
    confidence: 3,
    headline: "深夜消费 23 笔集中在 0–2 点，游戏充值为主",
    narrative:
      "过去一年有 23 笔消费发生在 0:00–2:00，合计 1,420 元。其中游戏充值与直播打赏占 71%。深夜冲动消费通常与白天的压力水平相关，建议设置夜间支付冷静期。",
    chartKind: "timeseries",
    chartData: [3, 1, 4, 2, 5, 2, 1, 3, 2, 0, 1, 1],
    chartLabels: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    citations: ["sql:anomaly_late_night", "rule:late-night-v1"],
  },
  {
    id: "ins-3",
    stageId: "subscription",
    stageName: "订阅陷阱扫描",
    confidence: 4,
    headline: "发现 3 项连续订阅扣费，合计 5,888 元/年",
    narrative:
      "确定性周期检测命中 3 项连续扣费：月度订阅 2 项、周度订阅 1 项。其中 1 项近 90 天无使用痕迹，属于典型的「沉默订阅」，建议优先处理。",
    chartKind: "bar",
    chartData: [18000, 30000, 10880],
    chartLabels: ["月订阅 A", "月订阅 B", "周订阅 C"],
    citations: ["sql:subscription_patterns", "rag:subscription_trap_07"],
  },
  {
    id: "ins-4",
    stageId: "attribution",
    stageName: "环比归因",
    confidence: 3,
    headline: "本月支出环比 +18%，主要来自购物节大促",
    narrative:
      "本月支出较上月增加 386 元（+18%），其中购物类贡献 +312 元，占增量的 81%。3 笔大额订单集中在促销日，属一次性脉冲而非趋势性上涨。",
    chartKind: "timeseries",
    chartData: [2100, 2280, 2140, 2390, 2260, 2640],
    chartLabels: ["5月", "6月", "7月", "8月", "9月", "10月"],
    citations: ["sql:attribution_mom", "rule:mom-drift-v2"],
  },
  {
    id: "ins-5",
    stageId: "annual",
    stageName: "年度报告",
    confidence: 2,
    headline: "年度账单关键词：「外卖自由」与「游戏通行证」",
    narrative:
      "你的年度消费叙事围绕两个主题展开：餐饮外卖构成日常支出的基本盘，游戏与订阅构成固定成本层。建议把订阅合计纳入月度预算视图，避免固定层侵蚀弹性空间。",
    chartKind: "donut",
    chartData: [58, 42],
    chartLabels: ["外卖", "堂食"],
    citations: ["sql:annual_keywords", "rag:spending_advice_03"],
  },
  {
    id: "ins-6",
    stageId: "anomaly",
    stageName: "异常检测",
    confidence: 2,
    headline: "疑似重复扣费 2 笔，建议核对商户订单",
    narrative:
      "同一商户同一金额在 3 分钟内出现 2 次扣费记录。样本量较小（2 笔），置信度偏低，建议人工核对订单号后确认。",
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

export const DEMO_BUDGET: {
  totalBudgetCents: number;
  totalActualCents: number;
  categories: DemoBudgetCategory[];
} = {
  totalBudgetCents: 280_000,
  totalActualCents: 286_400,
  categories: [
    { category: "餐饮", budgetCents: 90_000, actualCents: 97_400 },
    { category: "购物", budgetCents: 60_000, actualCents: 82_100 },
    { category: "交通", budgetCents: 30_000, actualCents: 24_600 },
    { category: "娱乐", budgetCents: 30_000, actualCents: 35_800 },
    { category: "居住", budgetCents: 40_000, actualCents: 38_000 },
    { category: "其他", budgetCents: 30_000, actualCents: 8_500 },
  ],
};

export const DEMO_FORECAST = {
  months: ["2026-11", "2026-12", "2027-01"],
  valuesCents: [273_000, 268_000, 281_000],
  method: "seasonal_baseline",
};

export const DEMO_REPORT = {
  healthIndex: 78,
  namedMetrics: [
    { id: "hidden-subscription", name: "隐形订阅率", value: "4.1%", benchmark: "3.2%", delta: "+0.9pp", status: "warn", explain: "订阅支出占年度总支出的比例，高于同龄基准" },
    { id: "impulse", name: "冲动消费浓度", value: "12.7%", benchmark: "18.5%", delta: "-5.8pp", status: "good", explain: "深夜与促销日集中消费占比，低于同龄基准" },
    { id: "dining-share", name: "餐饮占比", value: "34%", benchmark: "28%", delta: "+6pp", status: "serious", explain: "餐饮支出占总支出比例，显著高于同龄基准" },
    { id: "save-rate", name: "结余率", value: "18.2%", benchmark: "15.6%", delta: "+2.6pp", status: "good", explain: "月均结余占收入比例，略高于同龄基准" },
  ],
  rank: { tier: 3, name: "进阶规划师", desc: "开始控制固定成本层，预算意识成型" },
  storySegments: [
    { headline: "一年 3,214 笔，你在 12 类目里留下了轨迹", chartKind: "timeseries", chartData: [2100, 2280, 2140, 2390, 2260, 2640, 2510, 2720, 2890, 3050, 2940, 2864], chartLabels: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"], narrative: "月均支出 2,960 元，峰值出现在 10 月（购物节），谷值在 1 月（寒假）。" },
    { headline: "外卖是你的第一消费场景", chartKind: "donut", chartData: [58, 42], chartLabels: ["外卖", "堂食"], narrative: "外卖占餐饮支出的 58%，平均每单 27 元，午餐时段最活跃。" },
    { headline: "订阅层悄悄吃掉 5,888 元/年", chartKind: "bar", chartData: [18000, 30000, 10880], chartLabels: ["月订阅 A", "月订阅 B", "周订阅 C"], narrative: "3 项连续订阅构成固定成本层，其中 1 项近 90 天零使用。" },
    { headline: "你的消费在向「体验型」迁移", chartKind: "donut", chartData: [41, 33, 26], chartLabels: ["体验", "实物", "服务"], narrative: "电影、演出、旅行类消费同比 +23%，实物购物持平。" },
  ],
};

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
