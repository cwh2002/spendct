/**
 * 内置账单生成器：上传页「内置账单」入口与首页 /upload?sample=1 演示动线共用。
 *
 * 三个约束：
 * 1. 确定性：mulberry32 固定种子 + 固定时间锚点（不读系统时钟），每次生成的
 *    内容逐字节一致——预览页「疑似重复 N 条」提示、导入行数等文案不会漂移；
 * 2. 形态对齐微信账单导出：11 列表头（与嗅探器的位置兜底规则一致）、金额单位
 *    为元、空值写「/」占位、UTF-8 带 BOM，保证内置账单走真实嗅探链路而非旁路；
 * 3. 分布贴近学生真实账单：类目权重按学生年度支出占比设定（餐饮最高）、金额
 *    均值取学生口径（堂食/外卖小额高频、宿舍费/教材中额低频）、收入固定 12 笔
 *    × 2,000 元生活费（家庭转账）、深夜时段低概率，供异常检测阶段挖出区分度。
 */

export const SAMPLE_BILL_FILE_NAME = "微信账单-内置.csv";
export const SAMPLE_ROW_COUNT = 1000;

/** 固定种子：取本冲刺开始日期，方便回溯「这版内置数据是哪天定的」 */
const SEED = 20261013;

/** 时间锚点：2025-10-01 00:00 ~ 2026-10-13 00:00（北京时间），覆盖最近 12 个月 */
const RANGE_START_MS = Date.UTC(2025, 9, 1) - 8 * 3_600_000;
const RANGE_END_MS = Date.UTC(2026, 9, 13) - 8 * 3_600_000;

/** 追加的精确重复行数：预览页「疑似重复」提示与导入去重演示都靠它 */
const DUPLICATE_COUNT = 3;

/** 备注列出现非空值的概率；微信导出空备注写「/」占位 */
const NOTE_RATE = 0.15;

/** 退款行概率：状态列写「已全额退款」，解析器据此打 [退款] 标记 */
const REFUND_RATE = 0.01;

/** 收入行固定 12 笔（每月 1 笔生活费 2,000 元，家庭转账），不再用随机命中率 */
const INCOME_ROW_COUNT = 12;
const INCOME_AMOUNT_YUAN = 2000;

/** 商品列写「/」占位的概率（与微信导出空商品形态一致） */
const PRODUCT_EMPTY_RATE = 0.15;

const HEADER =
  "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注";

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

/** 均匀取数组元素 */
function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** 均匀取数组下标：商户与商品按同一位置配对，保证「麦当劳 → 汉堡套餐」这类组合可信 */
function pickIndex<T>(items: readonly T[], rng: () => number): number {
  return Math.floor(rng() * items.length);
}

/** 按权重取下标（权重表合计不要求为 1） */
function pickWeightedIndex(rng: () => number, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index] ?? 0;
    if (roll < 0) return index;
  }
  return weights.length - 1;
}

/** 指数分布金额（元）：value = min + Exp(mean)，round2 对齐导出的两位小数 */
function exponentialAmount(rng: () => number, min: number, mean: number): number {
  const value = min + -Math.log(1 - rng()) * mean;
  return Math.round(value * 100) / 100;
}

/** 北京时间格式化：epoch 加 8 小时后按 UTC 取件，结果与运行机器的时区无关 */
function formatDateTime(ms: number): string {
  const date = new Date(ms + 8 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** 交易单号内嵌日期段：微信单号前段即交易日期，保持形态可信 */
function yyyymmdd(ms: number): string {
  return formatDateTime(ms).slice(0, 10).replace(/-/g, "");
}

/** 定长随机数字串 */
function digits(rng: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String(Math.floor(rng() * 10));
  return out;
}

/** CSV 单元格转义（与解析器同一规则） */
function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 24 小时权重：三餐时段高、深夜低；深夜保留小概率，供异常检测挖「深夜消费」 */
const HOUR_WEIGHTS: readonly number[] = [
  1.2, 0.6, 0.4, 0.3, 0.3, 0.4, 0.7, 1.6, 2.2, 1.8, 1.4, 1.8,
  2.4, 2.0, 1.3, 1.2, 1.4, 2.0, 2.6, 2.2, 1.6, 1.4, 1.3, 1.1,
];

/** 12 类目支出池（07 §3 类目枚举；权重按学生年度支出占比的相对大小设定） */
interface CategorySpec {
  /** 类目名，只用于文档说明，不进 CSV（类目在 clean 阶段按商户词典细分） */
  name: string;
  weight: number;
  /** 金额指数分布参数（元） */
  amountMin: number;
  amountMean: number;
  types: readonly string[];
  merchants: readonly string[];
  products: readonly string[];
}

/**
 * 商户与商品两个数组按下标一一配对（同长度），生成行按同一随机下标取二者，
 * 保证「学校食堂 → 食堂餐费」这类组合可信，不会出现「哔哩哔哩 → 剧本杀门票」。
 * 权重：餐饮 42 / 交通 6.3 / 购物 11.5 / 娱乐 7 / 居住 7.2 / 通讯 4.5 /
 * 医疗 1.8 / 教育 5.4 / 人情 2.6 / 金融 0.9 / 订阅 3.2 / 其他 1.7
 * （与年度支出占比同量级：餐饮第一、购物与教育随后）。
 */
const CATEGORY_SPECS: readonly CategorySpec[] = [
  {
    name: "餐饮",
    weight: 42,
    amountMin: 3,
    amountMean: 20,
    types: ["商户消费", "扫二维码付款"],
    merchants: [
      "学校食堂", "饿了么", "瑞幸咖啡", "蜜雪冰城", "沙县小吃",
      "麦当劳", "海底捞火锅", "兰州牛肉面", "库迪咖啡", "美团外卖",
    ],
    products: ["食堂餐费", "外卖订单", "生椰拿铁", "奶茶两杯", "小吃套餐", "汉堡套餐", "火锅双人餐", "牛肉拉面", "生椰拿铁", "外卖订单"],
  },
  {
    name: "交通",
    weight: 6.3,
    amountMin: 1,
    amountMean: 10,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["滴滴出行", "北京地铁", "高德打车", "哈啰单车", "12306铁路", "北京公交"],
    products: ["网约车行程", "地铁乘车", "网约车行程", "单车骑行", "火车票", "公交乘车"],
  },
  {
    name: "购物",
    weight: 11.5,
    amountMin: 5,
    amountMean: 60,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["京东商城", "淘宝网", "拼多多", "唯品会", "得物App", "小米商城", "名创优品"],
    products: ["数码配件", "服饰订单", "日用品订单", "服饰订单", "潮流单品", "数码配件", "日用品订单"],
  },
  {
    name: "娱乐",
    weight: 7,
    amountMin: 5,
    amountMean: 40,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["万达影城", "猫眼电影", "Steam", "网易游戏", "剧本杀工作室", "唱吧麦颂"],
    products: ["电影票", "电影票", "游戏充值", "游戏充值", "剧本杀门票", "欢唱包间"],
  },
  {
    name: "居住",
    weight: 7.2,
    amountMin: 10,
    amountMean: 150,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["校园宿舍", "国家电网", "北京燃气", "自来水集团", "校园宽带"],
    products: ["住宿费", "电费", "燃气费", "水费", "网费"],
  },
  {
    name: "通讯",
    weight: 4.5,
    amountMin: 10,
    amountMean: 40,
    types: ["充值缴费"],
    merchants: ["中国移动", "中国联通", "中国电信"],
    products: ["话费充值", "流量包", "话费充值"],
  },
  {
    name: "医疗",
    weight: 1.8,
    amountMin: 5,
    amountMean: 60,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["校医院", "同仁堂药店", "叮当快药", "口腔门诊"],
    products: ["门诊缴费", "药品", "药品", "门诊缴费"],
  },
  {
    name: "教育",
    weight: 5.4,
    amountMin: 10,
    amountMean: 80,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["中国知网", "四六级考试", "学校教材科", "网易有道", "新东方在线"],
    products: ["文献下载", "考试报名费", "教材费", "网课会员", "课程报名"],
  },
  {
    name: "人情",
    weight: 2.6,
    amountMin: 5,
    amountMean: 120,
    types: ["微信红包", "转账"],
    merchants: ["妈妈", "李华", "王芳", "张伟", "刘洋", "陈静"],
    products: ["红包", "转账", "红包", "转账", "生日礼物红包", "红包"],
  },
  {
    name: "金融",
    weight: 0.9,
    amountMin: 10,
    amountMean: 150,
    types: ["信用卡还款", "转账", "理财通"],
    merchants: ["招商银行信用卡", "微信理财通", "微粒贷"],
    products: ["信用卡还款", "定投买入", "微粒贷还款"],
  },
  {
    name: "订阅",
    weight: 3.2,
    // 金额与扣款时刻不走随机分布：订阅行由 SUBSCRIPTION_PLANS 固定月费与
    // 固定扣款日生成（真实订阅即每月固定日扣固定价），供订阅陷阱阶段按
    // 「相邻间隔 25-40 天、金额恒定 ±1%」规则稳定命中。以下金额参数仅作
    // 类目池占位文档，订阅分支不会走到指数金额。
    amountMin: 15,
    amountMean: 15,
    types: ["商户消费"],
    merchants: ["腾讯视频VIP", "网易云音乐", "哔哩哔哩", "QQ音乐", "WPS会员", "百度网盘"],
    products: ["会员自动续费", "黑胶VIP续费", "大会员续费", "豪华绿钻续费", "会员自动续费", "超级会员续费"],
  },
  {
    name: "其他",
    weight: 1.7,
    amountMin: 2,
    amountMean: 18,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["打印店", "便利蜂", "菜鸟驿站", "顺丰速运"],
    products: ["打印复印", "便利店购物", "快递取件", "快递寄件"],
  },
];

const CATEGORY_TOTAL_WEIGHT = CATEGORY_SPECS.reduce((sum, spec) => sum + spec.weight, 0);

/**
 * 订阅商户固定扣款口径：公开真实月费（元）与每月固定扣款日。
 * 扣款日序取 2-12：避开月初边界且 ≤12，2026-10（数据截至 10-13）的
 * 行映射后仍落在区间内；相邻月份同一日序的间隔在 28-31 天，
 * 全部落入订阅规则要求的 25-40 天窗口。
 */
const SUBSCRIPTION_PLANS: ReadonlyArray<{ merchant: string; priceYuan: number; chargeDay: number }> = [
  { merchant: "腾讯视频VIP", priceYuan: 25, chargeDay: 2 },
  { merchant: "网易云音乐", priceYuan: 15, chargeDay: 4 },
  { merchant: "哔哩哔哩", priceYuan: 15, chargeDay: 6 },
  { merchant: "QQ音乐", priceYuan: 15, chargeDay: 8 },
  { merchant: "WPS会员", priceYuan: 15, chargeDay: 10 },
  { merchant: "百度网盘", priceYuan: 25, chargeDay: 12 },
];

/**
 * 把随机交易时刻对齐到该商户的每月固定扣款日（北京时间 10:00，即 UTC 02:00）。
 * ms 的日界即北京零点（见 RANGE_START_MS 的 -8h 约定），取 UTC 年月拼固定日序即可。
 * 同商户同月抽到多笔时顺延到下月，保证每笔规则行独占一个自然月（相邻间隔 28-31 天）；
 * 顺延越过数据区间的罕见情形退回原随机时刻，退化为一次不规则补扣，不影响合格对判定。
 */
function settleSubscriptionMs(
  ms: number,
  chargeDay: number,
  merchant: string,
  usedSlots: Set<string>,
): number {
  const date = new Date(ms);
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth();
  let slot = `${merchant}|${year}-${month}`;
  while (usedSlots.has(slot)) {
    month += 1;
    if (month > 11) {
      year += 1;
      month = 0;
    }
    slot = `${merchant}|${year}-${month}`;
  }
  usedSlots.add(slot);
  const settled = Date.UTC(year, month, chargeDay, 2, 0, 0);
  return settled > RANGE_END_MS ? ms : settled;
}

/** 收入行固定三元组：每月生活费由家庭转账打入（类型/对方/商品固定配对） */
const INCOME_ENTRY = { type: "转账", merchant: "家庭转账", product: "生活费" } as const;

const PAY_METHODS = ["零钱", "零钱通", "招商银行(6688)", "工商银行(1234)", "建设银行(0521)"] as const;

const NOTE_POOL = ["加班餐", "帮带", "聚会AA", "生日礼物", "房租押金", "周末采购"] as const;

/** 按权重抽类目池 */
function pickCategory(rng: () => number): CategorySpec {
  let roll = rng() * CATEGORY_TOTAL_WEIGHT;
  for (const spec of CATEGORY_SPECS) {
    roll -= spec.weight;
    if (roll < 0) return spec;
  }
  return CATEGORY_SPECS[CATEGORY_SPECS.length - 1]!;
}

/** 抽交易时刻：日期均匀 + 小时按权重 + 分钟秒均匀 */
function pickTimeMs(rng: () => number): number {
  const span = RANGE_END_MS - RANGE_START_MS;
  const dayOffset = Math.floor(rng() * span);
  // 对齐到当天零点：86400000 是 8 小时的整数倍，UTC 零点即北京时间零点
  const dayStart = RANGE_START_MS + dayOffset - (dayOffset % 86_400_000);
  const hour = pickWeightedIndex(rng, HOUR_WEIGHTS);
  const minute = Math.floor(rng() * 60);
  const second = Math.floor(rng() * 60);
  return dayStart + hour * 3_600_000 + minute * 60_000 + second * 1_000;
}

function buildExpenseLine(
  rng: () => number,
  ms: number,
  subscriptionSlots: Set<string>,
): GeneratedRow {
  const spec = pickCategory(rng);
  const type = pick(spec.types, rng);
  const merchantIndex = pickIndex(spec.merchants, rng);
  const merchant = spec.merchants[merchantIndex]!;
  const product =
    rng() < PRODUCT_EMPTY_RATE ? "/" : spec.products[merchantIndex % spec.products.length]!;
  // 订阅行：固定真实月费 + 每月固定扣款日（周期扣款形态），其余类目维持随机分布
  const subscriptionPlan = spec.name === "订阅"
    ? SUBSCRIPTION_PLANS.find((plan) => plan.merchant === merchant)
    : undefined;
  const amount = subscriptionPlan
    ? subscriptionPlan.priceYuan
    : exponentialAmount(rng, spec.amountMin, spec.amountMean);
  const settledMs = subscriptionPlan
    ? settleSubscriptionMs(ms, subscriptionPlan.chargeDay, merchant, subscriptionSlots)
    : ms;
  const isRefund = rng() < REFUND_RATE;
  // 转账/红包类支出的状态与商户消费不同，贴近真实导出
  const status = isRefund
    ? "已全额退款"
    : type === "转账" || type === "微信红包"
      ? "朋友已收钱"
      : "支付成功";
  const payMethod = pick(PAY_METHODS, rng);
  const note = rng() < NOTE_RATE ? pick(NOTE_POOL, rng) : "/";
  const orderNo = `4200${yyyymmdd(settledMs)}${digits(rng, 14)}${digits(rng, 4)}`;
  const merchantNo = digits(rng, 18);
  // 返回 settledMs 作为排序键：CSV 交易时间、单号日期段与最终升序排序保持一致
  return {
    ms: settledMs,
    line: [
      formatDateTime(settledMs),
      type,
      merchant,
      product,
      "支出",
      amount.toFixed(2),
      payMethod,
      status,
      orderNo,
      merchantNo,
      note,
    ]
      .map(escapeCsvCell)
      .join(","),
  };
}

interface GeneratedRow {
  ms: number;
  line: string;
}

function buildIncomeLine(rng: () => number, ms: number): GeneratedRow {
  const payMethod = pick(PAY_METHODS, rng);
  const note = rng() < NOTE_RATE ? pick(NOTE_POOL, rng) : "/";
  const orderNo = `4200${yyyymmdd(ms)}${digits(rng, 14)}${digits(rng, 4)}`;
  const merchantNo = digits(rng, 18);
  return {
    ms,
    line: [
      formatDateTime(ms),
      INCOME_ENTRY.type,
      INCOME_ENTRY.merchant,
      INCOME_ENTRY.product,
      "收入",
      INCOME_AMOUNT_YUAN.toFixed(2),
      payMethod,
      "已存入零钱",
      orderNo,
      merchantNo,
      note,
    ]
      .map(escapeCsvCell)
      .join(","),
  };
}

/**
 * 生成 1,000 行微信形态内置账单 CSV（含 BOM 与表头）。
 * 每次调用返回完全相同的字符串；含 12 笔固定 2,000 元生活费收入行（家庭转账），
 * 末尾含 3 行精确重复，预览页的重复提示与导入去重（stripDuplicates）在演示中可见。
 */
export function generateSampleCsv(): string {
  const rng = mulberry32(SEED);
  const uniqueCount = SAMPLE_ROW_COUNT - DUPLICATE_COUNT;
  // 收入行的位置在生成前一次性抽好（无放回）：固定 12 笔，而不是逐行掷骰子
  // （随机命中率会让每次调种子漂移）
  const shuffled = Array.from({ length: uniqueCount }, (_, index) => index);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const incomePositions = new Set(shuffled.slice(0, INCOME_ROW_COUNT));

  const rows: GeneratedRow[] = [];
  // 订阅规则行已占用的「商户+年月」槽位：同商户同月抽到多笔时顺延到下月
  const subscriptionSlots = new Set<string>();
  for (let i = 0; i < uniqueCount; i++) {
    const ms = pickTimeMs(rng);
    // buildExpenseLine 可能把订阅行对齐到固定扣款日，返回的 row.ms 才是最终排序键
    rows.push(
      incomePositions.has(i)
        ? buildIncomeLine(rng, ms)
        : buildExpenseLine(rng, ms, subscriptionSlots),
    );
  }
  // 追加精确重复行（行首/行中/行尾各取一条，保证去重演示覆盖不同位置）
  rows.push({ ...rows[1]! }, { ...rows[250]! }, { ...rows[500]! });
  // 微信导出按交易时间升序排列
  rows.sort((a, b) => a.ms - b.ms);
  // 微信导出的 UTF-8 文件带 BOM；解析器会剥离，保留它让内置账单与真实文件同一条路径
  return "﻿" + [HEADER, ...rows.map((row) => row.line)].join("\n") + "\n";
}
