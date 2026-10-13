/**
 * 示例账单生成器：上传页「示例账单」入口与首页 /upload?sample=1 演示动线共用。
 *
 * 三个约束：
 * 1. 确定性：mulberry32 固定种子 + 固定时间锚点（不读系统时钟），每次生成的
 *    内容逐字节一致——预览页「疑似重复 N 条」提示、导入行数等演示文案不会漂移；
 * 2. 形态对齐微信账单导出：11 列表头（与嗅探器的位置兜底规则一致）、金额单位
 *    为元、空值写「/」占位、UTF-8 带 BOM，保证示例走真实嗅探链路而非旁路；
 * 3. 分布贴近真实账单：金额指数分布（小额高频、大额低频）、96% 支出、
 *    类目权重餐饮最高、深夜时段低概率，供后续异常检测阶段挖出区分度。
 */

export const SAMPLE_BILL_FILE_NAME = "微信账单-示例.csv";
export const SAMPLE_ROW_COUNT = 1000;

/** 固定种子：取本冲刺开始日期，方便回溯「这版示例数据是哪天定的」 */
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

/** 支出占比 96%（按行数精确分配，不靠随机命中率） */
const EXPENSE_RATE = 0.96;

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

/** 12 类目支出池（07 §3 类目枚举；权重合计 100） */
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
 * 保证「麦当劳 → 汉堡套餐」这类组合可信，不会出现「哔哩哔哩 → 剧本杀门票」。
 */
const CATEGORY_SPECS: readonly CategorySpec[] = [
  {
    name: "餐饮",
    weight: 26,
    amountMin: 3,
    amountMean: 32,
    types: ["商户消费", "扫二维码付款"],
    merchants: [
      "美团平台商户", "饿了么", "瑞幸咖啡(学院路店)", "蜜雪冰城(中关村店)", "沙县小吃(学府路店)",
      "麦当劳(五道口店)", "海底捞火锅(中关村店)", "老乡鸡(苏州街店)", "喜茶(五道口店)", "兰州牛肉面(学院路店)",
    ],
    products: ["外卖订单", "外卖订单", "生椰拿铁", "奶茶两杯", "小吃套餐", "汉堡套餐", "火锅双人餐", "中式快餐", "奶茶两杯", "牛肉拉面"],
  },
  {
    name: "交通",
    weight: 12,
    amountMin: 1,
    amountMean: 12,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["滴滴出行", "北京地铁", "高德打车", "哈啰单车", "12306铁路", "北京公交"],
    products: ["网约车行程", "地铁乘车", "网约车行程", "单车骑行", "火车票", "公交乘车"],
  },
  {
    name: "购物",
    weight: 18,
    amountMin: 5,
    amountMean: 60,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["京东商城", "淘宝网", "拼多多", "唯品会", "得物App", "小米商城", "山姆会员商店", "名创优品"],
    products: ["数码配件", "服饰订单", "日用品订单", "服饰订单", "潮流单品", "数码配件", "会员店采购", "日用品订单"],
  },
  {
    name: "娱乐",
    weight: 8,
    amountMin: 5,
    amountMean: 40,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["万达影城(中关村店)", "哔哩哔哩", "Steam", "网易游戏", "剧本杀工作室", "唱吧麦颂"],
    products: ["电影票", "大会员续费", "游戏充值", "游戏充值", "剧本杀门票", "欢唱包间"],
  },
  {
    name: "居住",
    weight: 8,
    amountMin: 10,
    amountMean: 260,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["自如", "国家电网", "北京燃气", "自来水集团", "链家"],
    products: ["房租", "电费", "燃气费", "水费", "中介服务费"],
  },
  {
    name: "通讯",
    weight: 6,
    amountMin: 10,
    amountMean: 50,
    types: ["充值缴费"],
    merchants: ["中国移动", "中国联通", "中国电信"],
    products: ["话费充值", "流量包", "话费充值"],
  },
  {
    name: "医疗",
    weight: 3,
    amountMin: 5,
    amountMean: 60,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["京医通", "同仁堂药店", "北京协和医院", "叮当快药"],
    products: ["挂号费", "药品", "门诊缴费", "药品"],
  },
  {
    name: "教育",
    weight: 4,
    amountMin: 10,
    amountMean: 80,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["新东方在线", "粉笔公考", "网易有道", "中国知网", "学而思"],
    products: ["课程报名", "课程报名", "网课会员", "文献下载", "课程报名"],
  },
  {
    name: "人情",
    weight: 4,
    amountMin: 5,
    amountMean: 120,
    types: ["微信红包", "转账"],
    merchants: ["妈妈", "李华", "王芳", "张伟", "刘洋", "陈静"],
    products: ["红包", "转账", "红包", "转账", "生日礼物红包", "红包"],
  },
  {
    name: "金融",
    weight: 3,
    amountMin: 10,
    amountMean: 150,
    types: ["信用卡还款", "转账", "理财通"],
    merchants: ["招商银行信用卡", "微信理财通", "微粒贷"],
    products: ["信用卡还款", "定投买入", "微粒贷还款"],
  },
  {
    name: "订阅",
    weight: 5,
    amountMin: 6,
    amountMean: 20,
    types: ["商户消费"],
    merchants: ["腾讯视频VIP", "网易云音乐", "爱奇艺", "QQ音乐", "WPS会员", "百度网盘"],
    products: ["会员自动续费", "黑胶VIP续费", "会员自动续费", "豪华绿钻续费", "会员自动续费", "超级会员续费"],
  },
  {
    name: "其他",
    weight: 3,
    amountMin: 2,
    amountMean: 18,
    types: ["商户消费", "扫二维码付款"],
    merchants: ["便利蜂", "全家便利店", "菜鸟驿站", "顺丰速运"],
    products: ["便利店购物", "便利店购物", "快递取件", "快递寄件"],
  },
];

const CATEGORY_TOTAL_WEIGHT = CATEGORY_SPECS.reduce((sum, spec) => sum + spec.weight, 0);

/** 收入池（4%）：红包/转账，类型/对方/商品三元组固定配对，避免「转账 + 红包」混搭 */
const INCOME_ENTRIES = [
  { type: "微信红包", merchant: "妈妈", product: "红包" },
  { type: "转账", merchant: "爸爸", product: "零花钱" },
  { type: "微信红包", merchant: "李华", product: "红包" },
  { type: "转账", merchant: "王芳", product: "AA收款" },
  { type: "微信红包", merchant: "张伟", product: "生日红包" },
  { type: "转账", merchant: "刘洋", product: "转账" },
  { type: "微信红包", merchant: "陈静", product: "红包" },
] as const;

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

function buildExpenseLine(rng: () => number, ms: number): string {
  const spec = pickCategory(rng);
  const type = pick(spec.types, rng);
  const merchantIndex = pickIndex(spec.merchants, rng);
  const merchant = spec.merchants[merchantIndex]!;
  const product =
    rng() < PRODUCT_EMPTY_RATE ? "/" : spec.products[merchantIndex % spec.products.length]!;
  const amount = exponentialAmount(rng, spec.amountMin, spec.amountMean);
  const isRefund = rng() < REFUND_RATE;
  // 转账/红包类支出的状态与商户消费不同，贴近真实导出
  const status = isRefund
    ? "已全额退款"
    : type === "转账" || type === "微信红包"
      ? "朋友已收钱"
      : "支付成功";
  const payMethod = pick(PAY_METHODS, rng);
  const note = rng() < NOTE_RATE ? pick(NOTE_POOL, rng) : "/";
  const orderNo = `4200${yyyymmdd(ms)}${digits(rng, 14)}${digits(rng, 4)}`;
  const merchantNo = digits(rng, 18);
  return [
    formatDateTime(ms),
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
    .join(",");
}

function buildIncomeLine(rng: () => number, ms: number): string {
  const entry = pick(INCOME_ENTRIES, rng);
  const type = entry.type;
  const merchant = entry.merchant;
  const product = entry.product;
  const amount = exponentialAmount(rng, 1, 60);
  const payMethod = pick(PAY_METHODS, rng);
  const note = rng() < NOTE_RATE ? pick(NOTE_POOL, rng) : "/";
  const orderNo = `4200${yyyymmdd(ms)}${digits(rng, 14)}${digits(rng, 4)}`;
  const merchantNo = digits(rng, 18);
  return [
    formatDateTime(ms),
    type,
    merchant,
    product,
    "收入",
    amount.toFixed(2),
    payMethod,
    "已存入零钱",
    orderNo,
    merchantNo,
    note,
  ]
    .map(escapeCsvCell)
    .join(",");
}

interface GeneratedRow {
  ms: number;
  line: string;
}

/**
 * 生成 1,000 行微信形态示例账单 CSV（含 BOM 与表头）。
 * 每次调用返回完全相同的字符串；末尾含 3 行精确重复，
 * 预览页的重复提示与导入去重（stripDuplicates）在演示中可见。
 */
export function generateSampleCsv(): string {
  const rng = mulberry32(SEED);
  const uniqueCount = SAMPLE_ROW_COUNT - DUPLICATE_COUNT;
  // 收入行的位置在生成前一次性抽好（无放回），支出占比精确到 96%，
  // 而不是逐行掷骰子（随机命中率会让每次调种子漂移）
  const incomeCount = uniqueCount - Math.round(uniqueCount * EXPENSE_RATE);
  const shuffled = Array.from({ length: uniqueCount }, (_, index) => index);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const incomePositions = new Set(shuffled.slice(0, incomeCount));

  const rows: GeneratedRow[] = [];
  for (let i = 0; i < uniqueCount; i++) {
    const ms = pickTimeMs(rng);
    const line = incomePositions.has(i) ? buildIncomeLine(rng, ms) : buildExpenseLine(rng, ms);
    rows.push({ ms, line });
  }
  // 追加精确重复行（行首/行中/行尾各取一条，保证去重演示覆盖不同位置）
  rows.push({ ...rows[1]! }, { ...rows[250]! }, { ...rows[500]! });
  // 微信导出按交易时间升序排列
  rows.sort((a, b) => a.ms - b.ms);
  // 微信导出的 UTF-8 文件带 BOM；解析器会剥离，保留它让示例与真实文件同一条路径
  return "﻿" + [HEADER, ...rows.map((row) => row.line)].join("\n") + "\n";
}
