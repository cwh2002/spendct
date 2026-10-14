/**
 * 引擎内置数据集生成器（07 §17 演示档：~800 行内置交易，口径与
 * src/lib/demo-data.ts 咬合）。
 *
 * 确定性保证：mulberry32 固定种子 + 固定时间锚点（2025-10-01 ~ 2026-09-30，
 * 不读系统时钟），每次调用产出逐字节一致的 793 行 CleanTransaction。
 * 金额单位一律整数分（全项目唯一金额单位）。
 *
 * 数据口径（2026-10 定稿，按公开真实基准构造的大学生消费画像）：
 * - 麦可思 2025 年调查：大学生月均生活费 1,744 元。数据集月收入取整
 *   2,000 元 × 12 笔，月均支出约 1,733 元，落在 1,744 元预算线以内，
 *   年度结余 3,200 元（结余率 13.3%）；
 * - 国家统计局 2025 年居民消费构成（食品烟酒 29.3% 等）：学生餐饮占比
 *   高于居民均值（食堂 + 外卖为主），购物与教育占比相应低于社会平均；
 * - 订阅价格采用公开真实价：哔哩哔哩大会员 15 元/月、网易云音乐黑胶
 *   15 元/月、腾讯视频 VIP 25 元/月（年化合计 660 元）；
 * - 商户池按校园真实场景取名（食堂/蜜雪冰城/打印店/四六级考试/校园宿舍…），
 *   类目金额范围按学生单价设置（餐饮单笔 3-80 元、购物 8-150 元等）。
 *
 * 与 demo-data.ts 对齐的数字：
 * - 已支付支出总额 2,080,000 分（¥20,800），全表行数 793；
 * - 12 类目覆盖（07 §3 枚举），餐饮为最大支出类目（占比约 41%）；
 * - 3 个订阅商户按月周期扣费 1500/1500/2500 分（各 12 笔，间隔 28-31 天，
 *   满足 v_subscription_candidates 的 25-40 天/金额恒定规则）；
 * - 深夜消费 23 笔（23:00-05:00），合计 35,000 分（¥350，demo-data ins-2）；
 * - 2026-06-18 一笔 45,000 分大额脉冲（618 数码大促，z-score 显著 > 2.5）；
 * - 2026-09 开学季三笔大额订单（环比归因演示：购物上涨）、8 月两笔娱乐
 *   大额消费（娱乐回落），保证 attribution 阶段命中上涨/回落两张卡；
 * - 12 笔生活费收入（direction=income）、2 笔退款（status=refunded）、
 *   2 笔重复行（duplicate_rows=2）、2 笔 manual 快速记账行。
 *
 * ts 一律写无时区的本地钟表时间字符串（与 sample-bill 口径一致），
 * DuckDB TIMESTAMP 原样存储，EXTRACT(HOUR) 即北京时间小时，
 * 深夜判定（hour >= 23 或 < 5）不漂移。
 */
import {
  CATEGORY_CODES,
  type CategoryCode,
  type Channel,
  type CleanTransaction,
  type Direction,
  type Source,
} from "@/lib/schema/bill";

/** 固定种子：与 sample-bill 同源（本冲刺开始日期） */
const SEED = 20261013;

/** 时间锚点：2025-10-01（北京时间零点），窗口覆盖 2025-10-01 ~ 2026-09-30 共 365 天 */
const START = Date.UTC(2025, 9, 1);
const DAY_MS = 86_400_000;

/** 内置数据集哈希（sha256("spendct-demo-v2") 前 16 位 hex，引擎 stageCacheKey 前缀用） */
export const DEMO_DATASET_HASH = "fa8e5a1673f7884a";

/** 内置账户 ID 与已支付支出总额（分），与 demo-data.ts DEMO_ACCOUNT_META 同口径 */
export const DEMO_ACCOUNT_ID = "demo";
export const DEMO_TOTAL_EXPENSE_CENTS = 2_080_000;

/** 深夜消费：23 笔合计 35,000 分（demo-data ins-2 口径） */
export const DEMO_NIGHT_COUNT = 23;
export const DEMO_NIGHT_CENTS = 35_000;

/**
 * 订阅商户：单笔金额（分）与每月扣款日（demo-data DEMO_SUBSCRIPTIONS 口径）。
 * 价格为公开真实月费：哔哩哔哩大会员 15 元、网易云音乐黑胶 15 元、腾讯视频 VIP 25 元，
 * 年化合计 66,000 分（¥660）。
 */
export const DEMO_SUBSCRIPTION_SPECS = [
  { merchant: "哔哩哔哩大会员", cents: 1_500, day: 2, sub: "视频会员" },
  { merchant: "网易云音乐黑胶", cents: 1_500, day: 5, sub: "音乐会员" },
  { merchant: "腾讯视频 VIP", cents: 2_500, day: 15, sub: "影视会员" },
] as const;

/**
 * 类目随机行计划：笔数、金额范围与总额目标（随机部分合计 1,863,000 分）。
 * 笔数合计 712 不变；金额范围按大学生单笔消费水平收紧（餐饮 3-80 元、
 * 购物 8-150 元），总额目标按「年度 20,800 元 − 固定行 1,160 元 − 订阅 660 元 −
 * 深夜 350 元」反推分配，餐饮占大头（食堂与外卖为大学生日常基本盘）。
 */
interface CategoryPlan {
  code: CategoryCode;
  count: number;
  min: number;
  max: number;
  target: number;
  merchants: readonly string[];
  subs: readonly string[];
}

const CATEGORY_PLAN: readonly CategoryPlan[] = [
  {
    // 食堂 + 外卖为主：食堂覆盖工作日三餐，外卖与饮品为加餐场景
    code: "餐饮",
    count: 240,
    min: 300,
    max: 8_000,
    target: 845_000,
    merchants: ["学校食堂", "蜜雪冰城", "肯德基", "麦当劳", "瑞幸咖啡", "沙县小吃", "兰州牛肉面", "美团外卖", "饿了么", "海底捞"],
    subs: ["食堂", "外卖订单", "堂食", "饮品", "聚餐"],
  },
  {
    // 学生购物单价低于社会均值：数码配件/学习用品/日用品为主
    code: "购物",
    count: 100,
    min: 800,
    max: 15_000,
    target: 240_000,
    merchants: ["京东商城", "淘宝网", "拼多多", "唯品会", "名创优品", "得物App", "小米商城"],
    subs: ["数码配件", "服饰订单", "日用品", "学习用品"],
  },
  {
    // 通勤以地铁公交与共享单车为主，火车票对应寒暑假返乡
    code: "交通",
    count: 100,
    min: 200,
    max: 6_000,
    target: 130_000,
    merchants: ["地铁", "公交", "滴滴出行", "哈啰单车", "12306铁路", "高德打车"],
    subs: ["地铁乘车", "公交乘车", "网约车", "单车骑行", "火车票"],
  },
  {
    // 学生娱乐：电影/演出/游戏/剧本杀，无大额文娱开支
    code: "娱乐",
    count: 60,
    min: 500,
    max: 9_000,
    target: 145_000,
    merchants: ["万达影城", "大麦网", "Steam", "网易游戏", "剧本杀工作室", "密室逃脱"],
    subs: ["电影票", "演出票", "游戏充值", "剧本杀门票", "桌游门票"],
  },
  {
    // 住校为主：宿舍费按学年摊到月，电费水费为月缴，住宿对应假期出行
    code: "居住",
    count: 30,
    min: 1_000,
    max: 15_000,
    target: 150_000,
    merchants: ["校园宿舍", "国家电网", "自来水集团", "民宿平台", "北京燃气"],
    subs: ["宿舍费", "电费", "水费", "住宿", "燃气费"],
  },
  {
    code: "通讯",
    count: 24,
    min: 1_000,
    max: 6_000,
    target: 94_000,
    merchants: ["中国移动", "中国联通", "中国电信"],
    subs: ["话费充值", "流量包", "校园宽带"],
  },
  {
    code: "医疗",
    count: 20,
    min: 500,
    max: 8_000,
    target: 38_000,
    merchants: ["校医院", "同仁堂药店", "叮当快药", "三甲医院门诊"],
    subs: ["挂号费", "药品", "门诊缴费"],
  },
  {
    // 教育支出集中在考试报名（四六级等）与文献下载，教材按学期采购
    code: "教育",
    count: 16,
    min: 1_000,
    max: 15_000,
    target: 112_000,
    merchants: ["中国知网", "四六级考试", "学校教材科", "新东方在线", "网易公开课"],
    subs: ["文献下载", "考试报名", "教材", "网课报名"],
  },
  {
    // 人情往来以家人与室友/同学为主，金额学生级（红包/礼物/聚餐 AA）
    code: "人情",
    count: 14,
    min: 1_000,
    max: 10_000,
    target: 55_000,
    merchants: ["妈妈", "爸爸", "室友", "同学"],
    subs: ["红包", "转账", "生日礼物"],
  },
  {
    code: "金融",
    count: 10,
    min: 500,
    max: 6_000,
    target: 18_000,
    merchants: ["招商银行信用卡", "微信零钱通", "余额宝"],
    subs: ["信用卡还款", "基金定投", "零钱通转入"],
  },
  {
    // 高频小额杂项：打印复印是学生刚需，占大头
    code: "其他",
    count: 98,
    min: 200,
    max: 2_500,
    target: 36_000,
    merchants: ["打印店", "便利蜂", "全家便利店", "菜鸟驿站", "顺丰速运", "学校超市"],
    subs: ["打印复印", "便利店购物", "快递取件", "快递寄件", "日用品"],
  },
];

/**
 * 固定大额行：618 脉冲 + 9 月开学季三单 + 8 月两笔娱乐（环比归因演示）。
 * 金额按学生档设置（比旧口径的 899 元脉冲更贴近真实：618 数码大促 450 元、
 * 开学季采购 200/180/120 元），保证 618 脉冲日 z-score > 2.5 且 9 月购物
 * 相对 8 月显著上涨、娱乐显著回落，attribution 阶段命中上涨/回落两张卡。
 */
interface FixedExpenseSpec {
  offset: number;
  hour: number;
  minute: number;
  cents: number;
  category: CategoryCode;
  sub: string;
  merchant: string;
  note: string | null;
}

const FIXED_EXPENSE_ROWS: readonly FixedExpenseSpec[] = [
  { offset: 260, hour: 20, minute: 15, cents: 45_000, category: "购物", sub: "数码配件", merchant: "京东商城", note: "618 数码大促" },
  { offset: 339, hour: 10, minute: 5, cents: 20_000, category: "购物", sub: "数码配件", merchant: "京东商城", note: "开学季采购" },
  { offset: 346, hour: 21, minute: 30, cents: 18_000, category: "购物", sub: "服饰订单", merchant: "淘宝网", note: "开学季采购" },
  { offset: 353, hour: 14, minute: 40, cents: 12_000, category: "购物", sub: "日用品", merchant: "名创优品", note: "开学季采购" },
  { offset: 311, hour: 19, minute: 0, cents: 12_000, category: "娱乐", sub: "演出票", merchant: "大麦网", note: "演唱会门票" },
  { offset: 325, hour: 12, minute: 20, cents: 9_000, category: "娱乐", sub: "游戏充值", merchant: "网易游戏", note: "游戏充值" },
];

/**
 * 生活费收入行：12 笔（每月 1 笔 × 2,000 元），direction=income、manual 快速记账。
 * 月收入 2,000 元按麦可思 2025「大学生月均生活费 1,744 元」取整；
 * 打款日固定在每月 15 日前后（offset 15/45/…），与家庭按月转账的形态一致。
 */
const INCOME_OFFSETS = [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345] as const;
const INCOME_CENTS = 200_000;

/** 退款行：2 笔 3,900 分，status=refunded（不计入已支付支出） */
const REFUND_OFFSETS = [100, 220] as const;
const REFUND_CENTS = 3_900;

/** mulberry32 伪随机数：种子固定则序列固定，跨平台一致 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 时间锚点后第 offset 天的日期（YYYY-MM-DD，UTC 计算与运行机器时区无关） */
function isoDay(offset: number): string {
  const date = new Date(START + offset * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 某月（锚点后第 monthIndex 月）1 号的天偏移 */
function monthStartOffset(monthIndex: number): number {
  return (Date.UTC(2025, 9 + monthIndex, 1) - START) / DAY_MS;
}

/** 组装一行 CleanTransaction（ts 为无时区钟表时间，与 sample-bill 口径一致） */
function buildRow(input: {
  seq: number;
  dateIso: string;
  hour: number;
  minute: number;
  cents: number;
  direction: Direction;
  category: CategoryCode;
  sub: string;
  merchant: string;
  channel: Channel;
  status: string;
  source: Source;
  note: string | null;
  rawRef: string | null;
}): CleanTransaction {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    tx_id: input.seq.toString(16).padStart(16, "0"),
    account_id: DEMO_ACCOUNT_ID,
    ts: `${input.dateIso}T${pad(input.hour)}:${pad(input.minute)}:00`,
    date_iso: input.dateIso,
    amount_cents: input.cents,
    direction: input.direction,
    merchant: input.merchant,
    counterparty: null,
    category: input.category,
    sub_category: input.sub,
    channel: input.channel,
    status: input.status,
    external_id: null,
    note: input.note,
    raw_ref: input.rawRef,
    source: input.source,
    _meta: null,
    imported_files: ["spendct-demo.csv"],
  };
}

/**
 * 生成 793 行内置交易（固定种子与时间锚点，逐字节确定）。
 *
 * 结构：714 行随机支出（其中 2 行为精确重复）→ 6 行固定大额支出 →
 * 36 行订阅周期扣费 → 23 行深夜消费 → 12 行生活费收入 → 2 行退款。
 * 已支付支出总额恒为 DEMO_TOTAL_EXPENSE_CENTS（2,080,000 分）。
 */
export function demoTransactions(): CleanTransaction[] {
  const rng = mulberry32(SEED);

  // 1. 类目池洗牌：每个类目按其计划笔数入池，Fisher-Yates 打散，
  //    保证每个月份都能见到各品类（避免同类目扎堆在相邻日期）
  const pool: number[] = [];
  CATEGORY_PLAN.forEach((plan, index) => {
    for (let i = 0; i < plan.count; i++) pool.push(index);
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }

  // 2. 每个类目先按范围生成原始金额队列（缩放前消费顺序固定，保证确定性）
  const amountQueues = CATEGORY_PLAN.map((plan) => {
    const list: number[] = [];
    for (let i = 0; i < plan.count; i++) {
      list.push(plan.min + Math.floor(rng() * (plan.max - plan.min + 1)));
    }
    return list;
  });

  // 3. 随机支出行：日期均匀铺满 365 天，时刻 8-22 点
  const rows: CleanTransaction[] = [];
  let seq = 0;
  for (let i = 0; i < pool.length; i++) {
    const plan = CATEGORY_PLAN[pool[i]!]!;
    rows.push(
      buildRow({
        seq,
        dateIso: isoDay(Math.floor((i * 365) / pool.length)),
        hour: 8 + Math.floor(rng() * 15),
        minute: Math.floor(rng() * 60),
        cents: amountQueues[pool[i]!]!.shift()!,
        direction: "expense",
        category: plan.code,
        sub: plan.subs[Math.floor(rng() * plan.subs.length)]!,
        merchant: plan.merchants[Math.floor(rng() * plan.merchants.length)]!,
        channel: rng() < 0.5 ? "wechat" : "alipay",
        status: "paid",
        source: "sample",
        note: null,
        rawRef: null,
      }),
    );
    seq += 1;
  }

  // 4. 追加 2 行精确重复（复制行 100/500 的 tx_id），供 clean 阶段去重统计
  const dupA = rows[100]!;
  const dupB = rows[500]!;
  rows.push({ ...dupA }, { ...dupB });

  // 5. 按类目缩放：每个类目的随机行独立缩到该类 target。
  //    不沿用全局统一缩放——统一缩放按「生金额 × 均价」分配权重，会放大高单价
  //    类目（购物/居住）占比、压低餐饮占比，类目分布与 CATEGORY_PLAN 目标脱钩，
  //    演示口径（麦可思/统计局基准）随之失真。逐类缩放后类目年支出即 target。
  //    重复行复制源若落在本类目，源行生金额计入缩放分母（重复行金额随源行成比例
  //    计入本类目支出），舍入残差只摊到本类目普通行；循环结束后再同步重复行，
  //    保证全表已支付支出 = Σ target + 固定行 + 订阅 + 深夜，恒为 2,080,000 分。
  const planIndexByCode = new Map(CATEGORY_PLAN.map((plan, index) => [plan.code, index]));
  const dupSourceIdxs = [100, 500] as const;
  for (const plan of CATEGORY_PLAN) {
    const planIndex = planIndexByCode.get(plan.code)!;
    const idxs: number[] = [];
    for (let i = 0; i < pool.length; i++) {
      if (pool[i] === planIndex) idxs.push(i);
    }
    // 本类目内的重复复制源：其原始行会再被复制一次，生金额需按两份计入缩放分母
    const dupIdxs = dupSourceIdxs.filter((s) => pool[s] === planIndex);
    const rawSum =
      idxs.reduce((sum, i) => sum + rows[i]!.amount_cents, 0) +
      dupIdxs.reduce((sum, i) => sum + rows[i]!.amount_cents, 0);
    const ratio = plan.target / rawSum;
    for (const i of idxs) {
      rows[i]!.amount_cents = Math.max(1, Math.round(rows[i]!.amount_cents * ratio));
    }
    const dupScaled = dupIdxs.reduce((sum, i) => sum + rows[i]!.amount_cents, 0);
    let diff = plan.target - dupScaled - idxs.reduce((sum, i) => sum + rows[i]!.amount_cents, 0);
    for (const i of idxs) {
      if (diff === 0) break;
      const step = diff > 0 ? 1 : -1;
      rows[i]!.amount_cents += step;
      diff -= step;
    }
  }
  rows[pool.length]!.amount_cents = rows[100]!.amount_cents;
  rows[pool.length + 1]!.amount_cents = rows[500]!.amount_cents;

  // 6. 2 笔 manual 快速记账行：取前两笔「其他」类目行改写来源
  let manualSeq = 1;
  for (const row of rows) {
    if (row.category === "其他" && row.source === "sample") {
      if (manualSeq > 2) break;
      row.source = "manual";
      row.channel = "manual";
      row.raw_ref = `M#${manualSeq}`;
      manualSeq += 1;
    }
  }

  // 7. 固定大额支出行（618 脉冲 + 9 月开学季 + 8 月娱乐）
  for (const spec of FIXED_EXPENSE_ROWS) {
    rows.push(
      buildRow({
        seq,
        dateIso: isoDay(spec.offset),
        hour: spec.hour,
        minute: spec.minute,
        cents: spec.cents,
        direction: "expense",
        category: spec.category,
        sub: spec.sub,
        merchant: spec.merchant,
        channel: "alipay",
        status: "paid",
        source: "sample",
        note: spec.note,
        rawRef: null,
      }),
    );
    seq += 1;
  }

  // 8. 订阅周期扣费：3 商户 × 12 个月，固定日固定金额（间隔 28-31 天）
  for (let month = 0; month < 12; month++) {
    const baseOffset = monthStartOffset(month);
    for (const spec of DEMO_SUBSCRIPTION_SPECS) {
      rows.push(
        buildRow({
          seq,
          dateIso: isoDay(baseOffset + spec.day - 1),
          hour: 9,
          minute: 0,
          cents: spec.cents,
          direction: "expense",
          category: "订阅",
          sub: spec.sub,
          merchant: spec.merchant,
          channel: "alipay",
          status: "paid",
          source: "sample",
          note: "自动续费",
          rawRef: null,
        }),
      );
      seq += 1;
    }
  }

  // 9. 深夜消费：23 笔分布在 11 个月（23:00-05:00），合计 35,000 分。
  //    单笔 10-60 元（外卖/游戏/直播的学生深夜价位），远低于日间均值
  const nightRaw: number[] = [];
  for (let i = 0; i < DEMO_NIGHT_COUNT; i++) {
    nightRaw.push(1_000 + Math.floor(rng() * 5_001));
  }
  const nightSum = nightRaw.reduce((sum, value) => sum + value, 0);
  const nightRatio = DEMO_NIGHT_CENTS / nightSum;
  let nightDiff = DEMO_NIGHT_CENTS;
  for (let i = 0; i < DEMO_NIGHT_COUNT; i++) {
    let cents = Math.max(1, Math.round(nightRaw[i]! * nightRatio));
    if (i === DEMO_NIGHT_COUNT - 1) cents += nightDiff - cents;
    nightDiff -= cents;
    const monthIndex = Math.floor((i * 11) / DEMO_NIGHT_COUNT);
    const baseOffset = monthStartOffset(monthIndex);
    const isFood = i % 5 === 4;
    rows.push(
      buildRow({
        seq,
        dateIso: isoDay(baseOffset + (3 + ((i * 7) % 25)) - 1),
        hour: i % 7 === 6 ? 23 : i % 5,
        minute: (i * 17) % 60,
        cents,
        direction: "expense",
        category: isFood ? "餐饮" : "娱乐",
        sub: isFood ? "深夜外卖" : i % 2 === 0 ? "游戏充值" : "直播打赏",
        merchant: isFood ? "美团外卖" : i % 2 === 0 ? "网易游戏" : "直播平台",
        channel: "wechat",
        status: "paid",
        source: "sample",
        note: null,
        rawRef: null,
      }),
    );
    seq += 1;
  }

  // 10. 生活费收入：12 笔 manual 快速记账（direction=income，不计入支出总额）
  for (let i = 0; i < INCOME_OFFSETS.length; i++) {
    rows.push(
      buildRow({
        seq,
        dateIso: isoDay(INCOME_OFFSETS[i]!),
        hour: 10,
        minute: 0,
        cents: INCOME_CENTS,
        direction: "income",
        category: "其他",
        sub: "生活费",
        merchant: "家庭转账",
        channel: "manual",
        status: "paid",
        source: "manual",
        note: null,
        rawRef: `M#${i + 3}`,
      }),
    );
    seq += 1;
  }

  // 11. 退款行：2 笔（status=refunded，不计入已支付支出）
  for (const offset of REFUND_OFFSETS) {
    rows.push(
      buildRow({
        seq,
        dateIso: isoDay(offset),
        hour: 13,
        minute: 0,
        cents: REFUND_CENTS,
        direction: "expense",
        category: "购物",
        sub: "退货退款",
        merchant: "淘宝网",
        channel: "wechat",
        status: "refunded",
        source: "wechat",
        note: "重复扣费退款",
        rawRef: null,
      }),
    );
    seq += 1;
  }

  return rows;
}

/** 内置数据集哈希（固定值，与引擎 stageCacheKey 的 v1 前缀配套） */
export function demoDatasetHash(): string {
  return DEMO_DATASET_HASH;
}

/** 类目枚举仍从 bill.ts 引入（引擎测试断言 12 类目覆盖时用），本文件不复制清单 */
export const DEMO_CATEGORY_CODES: readonly CategoryCode[] = CATEGORY_CODES;
