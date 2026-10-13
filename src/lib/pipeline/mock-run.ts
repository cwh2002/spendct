/**
 * 引擎演示数据集生成器（07 §17 演示档：~800 行合成交易，口径与
 * src/lib/demo-data.ts 咬合）。
 *
 * 确定性保证：mulberry32 固定种子 + 固定时间锚点（2025-10-01 ~ 2026-09-30，
 * 不读系统时钟），每次调用产出逐字节一致的 789 行 CleanTransaction。
 * 金额单位一律整数分（全项目唯一金额单位）。
 *
 * 与 demo-data.ts 对齐的数字：
 * - 已支付支出总额 3,551,493 分（¥35,514.93），全表行数 789（约 800 档）；
 * - 12 类目覆盖（07 §3 枚举），餐饮为最大支出类目；
 * - 3 个订阅商户按月周期扣费 1500/2500/900 分（各 12 笔，间隔 28-31 天，
 *   满足 v_subscription_candidates 的 25-40 天/金额恒定规则）；
 * - 深夜消费 23 笔（23:00-05:00），合计 142,000 分（¥1,420，demo-data ins-2）；
 * - 2026-06-18 一笔 89,900 分大额脉冲（618 促销，z-score 显著 > 2.5）；
 * - 2026-09 购物节三笔大额订单（环比归因演示：购物 +274%）、8 月两笔娱乐
 *   大额消费（娱乐 -74%），保证 attribution 阶段命中上涨/回落两张卡；
 * - 8 笔收入（月薪，direction=income）、2 笔退款（status=refunded）、
 *   2 笔重复行（duplicate_rows=2）、10 笔 manual 快速记账行。
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

/** 演示数据集哈希（sha256("spendct-demo-v1") 前 16 位 hex，引擎 stageCacheKey 前缀用） */
export const DEMO_DATASET_HASH = "a48bdd8c6e367b88";

/** 演示账户 ID 与已支付支出总额（分），与 demo-data.ts DEMO_ACCOUNT_META 同口径 */
export const DEMO_ACCOUNT_ID = "demo";
export const DEMO_TOTAL_EXPENSE_CENTS = 3_551_493;

/** 深夜消费：23 笔合计 142,000 分（demo-data ins-2 口径） */
export const DEMO_NIGHT_COUNT = 23;
export const DEMO_NIGHT_CENTS = 142_000;

/** 订阅商户：单笔金额（分）与每月扣款日（demo-data DEMO_SUBSCRIPTIONS 口径） */
export const DEMO_SUBSCRIPTION_SPECS = [
  { merchant: "云音乐会员", cents: 1_500, day: 2, sub: "音乐会员" },
  { merchant: "视频会员", cents: 2_500, day: 15, sub: "影视会员" },
  { merchant: "健身会员", cents: 900, day: 5, sub: "健身会员" },
] as const;

/** 类目随机行计划：笔数、金额范围与总额目标（随机部分合计 3,112,793 分） */
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
    code: "餐饮",
    count: 240,
    min: 300,
    max: 12_000,
    target: 1_150_000,
    merchants: ["美团外卖", "饿了么", "瑞幸咖啡", "麦当劳", "沙县小吃", "海底捞", "喜茶", "老乡鸡"],
    subs: ["外卖订单", "堂食", "饮品", "聚餐"],
  },
  {
    code: "购物",
    count: 100,
    min: 800,
    max: 25_000,
    target: 515_000,
    merchants: ["京东商城", "淘宝网", "拼多多", "唯品会", "小米商城", "山姆会员商店", "名创优品"],
    subs: ["数码配件", "服饰订单", "日用品", "会员店采购"],
  },
  {
    code: "交通",
    count: 100,
    min: 200,
    max: 8_000,
    target: 480_000,
    merchants: ["滴滴出行", "地铁", "高德打车", "哈啰单车", "12306铁路", "公交"],
    subs: ["网约车", "地铁乘车", "单车骑行", "火车票"],
  },
  {
    code: "娱乐",
    count: 60,
    min: 500,
    max: 12_000,
    target: 197_000,
    merchants: ["万达影城", "哔哩哔哩", "Steam", "网易游戏", "剧本杀工作室", "唱吧麦颂"],
    subs: ["电影票", "会员续费", "游戏充值", "剧本杀门票"],
  },
  {
    code: "居住",
    count: 30,
    min: 2_000,
    max: 25_000,
    target: 340_000,
    merchants: ["自如", "国家电网", "北京燃气", "自来水集团", "链家"],
    subs: ["房租", "电费", "燃气费", "水费"],
  },
  {
    code: "通讯",
    count: 24,
    min: 1_000,
    max: 8_000,
    target: 120_000,
    merchants: ["中国移动", "中国联通", "中国电信"],
    subs: ["话费充值", "流量包", "宽带"],
  },
  {
    code: "医疗",
    count: 20,
    min: 500,
    max: 15_000,
    target: 80_000,
    merchants: ["京医通", "同仁堂药店", "北京协和医院", "叮当快药"],
    subs: ["挂号费", "药品", "门诊缴费"],
  },
  {
    code: "教育",
    count: 16,
    min: 1_000,
    max: 20_000,
    target: 60_000,
    merchants: ["新东方在线", "粉笔公考", "网易有道", "中国知网"],
    subs: ["课程报名", "网课会员", "文献下载"],
  },
  {
    code: "人情",
    count: 14,
    min: 1_000,
    max: 15_000,
    target: 50_000,
    merchants: ["妈妈", "李华", "王芳", "张伟"],
    subs: ["红包", "转账", "生日礼物"],
  },
  {
    code: "金融",
    count: 10,
    min: 500,
    max: 10_000,
    target: 40_000,
    merchants: ["招商银行信用卡", "微信理财通", "微粒贷"],
    subs: ["信用卡还款", "定投买入", "微粒贷还款"],
  },
  {
    code: "其他",
    count: 98,
    min: 200,
    max: 3_000,
    target: 80_793,
    merchants: ["便利蜂", "全家便利店", "菜鸟驿站", "顺丰速运"],
    subs: ["便利店购物", "快递取件", "快递寄件"],
  },
];

/** 随机行总额目标（不含固定大额行/订阅/深夜/收入/退款） */
const REGULAR_TARGET = CATEGORY_PLAN.reduce((sum, plan) => sum + plan.target, 0);

/** 固定大额行：618 脉冲 + 9 月购物节三单 + 8 月两笔娱乐（环比归因演示） */
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
  { offset: 260, hour: 20, minute: 15, cents: 89_900, category: "购物", sub: "大促订单", merchant: "某电商旗舰店", note: "618 家电大促" },
  { offset: 339, hour: 10, minute: 5, cents: 45_000, category: "购物", sub: "数码配件", merchant: "京东商城", note: "促销日下单" },
  { offset: 346, hour: 21, minute: 30, cents: 38_000, category: "购物", sub: "服饰订单", merchant: "唯品会", note: "促销日下单" },
  { offset: 353, hour: 14, minute: 40, cents: 22_000, category: "购物", sub: "日用品", merchant: "山姆会员商店", note: "促销日下单" },
  { offset: 311, hour: 19, minute: 0, cents: 25_000, category: "娱乐", sub: "演出票", merchant: "大麦网", note: "演唱会门票" },
  { offset: 325, hour: 12, minute: 20, cents: 18_000, category: "娱乐", sub: "游戏充值", merchant: "网易游戏", note: "周年庆礼包" },
];

/** 月薪收入行：8 笔（每笔 550,000 分），direction=income、manual 快速记账（08 A3） */
const INCOME_OFFSETS = [15, 60, 105, 150, 195, 240, 285, 330] as const;
const INCOME_CENTS = 550_000;

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
 * 生成 ~800 行合成交易（788 行，固定种子与时间锚点，逐字节确定）。
 *
 * 结构：714 行随机支出（其中 2 行为精确重复）→ 6 行固定大额支出 →
 * 36 行订阅周期扣费 → 23 行深夜消费 → 8 行月薪收入 → 2 行退款。
 * 已支付支出总额恒为 DEMO_TOTAL_EXPENSE_CENTS（3,551,493 分）。
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

  // 5. 全局缩放：714 行（含 2 重复）按比例缩到 REGULAR_TARGET，
  //    舍入残差只摊到非重复行，重复行金额与源行保持逐分一致
  const rawSum = rows.reduce((sum, row) => sum + row.amount_cents, 0);
  const ratio = REGULAR_TARGET / rawSum;
  for (let i = 0; i < pool.length; i++) {
    rows[i]!.amount_cents = Math.max(1, Math.round(rows[i]!.amount_cents * ratio));
  }
  rows[pool.length]!.amount_cents = rows[100]!.amount_cents;
  rows[pool.length + 1]!.amount_cents = rows[500]!.amount_cents;
  let diff = REGULAR_TARGET - rows.reduce((sum, row) => sum + row.amount_cents, 0);
  for (let i = 0; diff !== 0 && i < pool.length; i++) {
    const step = diff > 0 ? 1 : -1;
    rows[i]!.amount_cents += step;
    diff -= step;
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

  // 7. 固定大额支出行（618 脉冲 + 9 月购物节 + 8 月娱乐）
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

  // 9. 深夜消费：23 笔分布在 11 个月（23:00-05:00），合计 142,000 分
  const nightRaw: number[] = [];
  for (let i = 0; i < DEMO_NIGHT_COUNT; i++) {
    nightRaw.push(2_000 + Math.floor(rng() * 10_001));
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

  // 10. 月薪收入：8 笔 manual 快速记账（direction=income，不计入支出总额）
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
        sub: "工资",
        merchant: "公司代发",
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

/** 演示数据集哈希（固定值，与引擎 stageCacheKey 的 v1 前缀配套） */
export function demoDatasetHash(): string {
  return DEMO_DATASET_HASH;
}

/** 类目枚举仍从 bill.ts 引入（引擎测试断言 12 类目覆盖时用），本文件不复制清单 */
export const DEMO_CATEGORY_CODES: readonly CategoryCode[] = CATEGORY_CODES;
