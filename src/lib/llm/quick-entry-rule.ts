/**
 * 快速记账本地规则解析（F08 mock 兜底，08 §⑥.1）。
 *
 * 与 @/lib/import/parse-csv 同一套金额口径：一律整数分，正则先抓金额、再定方向、
 * 类目按关键词表优先级命中、日期缺省取今天。规则解析是确定性兜底，大模型结构化输出
 * 在 live 模式接入 generateObject 后走 QuickEntrySchema（07 修订案 A5 单一来源）。
 *
 * 原始输入文本只在内存中转（07 §17 允许项③），本模块不落盘、不打印。
 */
import { type CategoryCode } from "@/lib/schema/bill";

/** 规则解析产物（mock 模式 /api/ai/task 的 quick-entry 响应 data 形状） */
export interface QuickEntryRuleResult {
  parseable: boolean;
  amountCents?: number;
  direction?: "expense" | "income";
  category?: CategoryCode;
  merchant?: string;
  dateIso?: string;
  reason?: string;
}

/** 类目关键词表：按数组顺序命中，先中先得；命中不了落「其他」（12 类枚举来自 07 §3 单一事实源） */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [CategoryCode, readonly string[]]> = [
  [
    "餐饮",
    [
      "食堂",
      "奶茶",
      "咖啡",
      "外卖",
      "早餐",
      "午餐",
      "晚餐",
      "夜宵",
      "吃饭",
      "餐厅",
      "饭店",
      "火锅",
      "烧烤",
      "米线",
      "面条",
      "麦当劳",
      "肯德基",
      "瑞幸",
      "星巴克",
      "麻辣烫",
      "小吃",
      "饮品",
      "烤肉",
      "披萨",
      "汉堡",
    ],
  ],
  [
    "交通",
    [
      "地铁",
      "公交",
      "打车",
      "滴滴",
      "高铁",
      "火车",
      "机票",
      "加油",
      "停车",
      "共享单车",
      "出租车",
      "网约车",
      "油费",
      "高速",
    ],
  ],
  [
    "购物",
    [
      "淘宝",
      "京东",
      "拼多多",
      "超市",
      "便利店",
      "商场",
      "衣服",
      "鞋",
      "裤子",
      "网购",
      "日用品",
      "零食",
      "水果",
      "买菜",
      "菜市场",
      "家电",
      "数码",
    ],
  ],
  [
    "娱乐",
    [
      "电影",
      "游戏",
      "KTV",
      "ktv",
      "剧本杀",
      "演唱会",
      "门票",
      "游乐场",
      "台球",
      "网吧",
      "游泳",
      "健身",
    ],
  ],
  ["居住", ["房租", "水电", "水费", "电费", "燃气", "物业", "租房", "暖气"]],
  ["通讯", ["话费", "流量", "宽带", "手机卡", "充值话费"]],
  ["医疗", ["药", "医院", "挂号", "体检", "诊所", "看病", "门诊", "药店", "药房"]],
  ["教育", ["书", "课程", "培训", "学费", "教材", "考试", "报名", "网课", "学习"]],
  ["人情", ["红包", "礼物", "份子钱", "请客", "随礼", "生日", "送礼"]],
  ["金融", ["转账", "利息", "理财", "基金", "股票", "手续费", "还款", "信用卡", "贷款", "提现"]],
  ["订阅", ["会员", "订阅", "自动续费", "包月", "月卡", "年卡", "续费"]],
];

/** 方向关键词：收入优先判定，其余一律按支出记 */
const INCOME_KEYWORDS = [
  "收到",
  "收入",
  "红包",
  "工资",
  "奖金",
  "退款",
  "转入",
  "入账",
  "报销",
  "抢到",
  "赚了",
  "收款",
  "利息",
] as const;

/** 商户猜测时要剔除的时间词与动词（先剔金额，再剔动词，再剔时间，剩下第一个词当商户） */
const MERCHANT_VERB_PATTERN =
  /(?:花了|付了|买了|消费了|扣了|支出了|用了|收到了|收了|收到|充了|刷了|转了|发了|付款|支付)/g;
const MERCHANT_STRIP_PATTERN = /(?:自动|连续|本次|一笔|又|的|了|杯|份)/g;
const TIME_WORDS = [
  "今天",
  "昨天",
  "前天",
  "大前天",
  "早上",
  "上午",
  "中午",
  "下午",
  "晚上",
  "凌晨",
  "半夜",
  "周末",
  "上周",
  "本月",
  "月初",
  "月底",
  "刚才",
  "刚刚",
] as const;

/** 这些词是方向/类目语义而非商户名，不当作商户输出 */
const MERCHANT_BLACKLIST = ["红包", "工资", "退款", "收入", "利息", "转账"] as const;

const AMOUNT_WAN = /\d+(?:\.\d+)?\s*万/;
const AMOUNT_WITH_UNIT = /([1-9]\d{0,6}(?:\.\d{1,2})?)\s*(?:元|块钱?|¥|￥)/;
const AMOUNT_AFTER_VERB =
  /(?:花了|付了|买了|消费了?|扣了|支出了?|用了|收了|收到了|充了|刷了|转了|发了|付款|支付)\s*([1-9]\d{0,6}(?:\.\d{1,2})?)/;
const AMOUNT_BARE = /(?:^|[^\d.])([1-9]\d{0,6}(?:\.\d{1,2})?)(?:[^\d.]|$)/;

/** 疑似闲聊/问句的标记，命中且无金额时判定为不可解析 */
const CHAT_MARK = /(?:[?？]|吗|呢|在不在|你好|谢谢|帮我|怎么|什么)/;

function yuanToCents(raw: string): number | null {
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 1e9) return null;
  return cents;
}

/** 抓金额：先查「万」（拒绝），再按带单位、动词后、裸数字的顺序兜底 */
function parseAmountCents(text: string): number | null {
  const withUnit = text.match(AMOUNT_WITH_UNIT);
  if (withUnit) return yuanToCents(withUnit[1] ?? "");
  const afterVerb = text.match(AMOUNT_AFTER_VERB);
  if (afterVerb) return yuanToCents(afterVerb[1] ?? "");
  const bare = text.match(AMOUNT_BARE);
  if (bare) return yuanToCents(bare[1] ?? "");
  return null;
}

/** 猜商户：去掉金额、动词、时间词与标点后，取第一个候选词 */
function guessMerchant(text: string): string | undefined {
  let stripped = text
    .replace(/\d+(?:\.\d{1,2})?\s*(?:元|块钱?|¥|￥)?/g, " ")
    .replace(MERCHANT_VERB_PATTERN, " ")
    .replace(MERCHANT_STRIP_PATTERN, " ")
    .replace(/[，。！？、,.!?：:\s「」]/g, " ");
  for (const word of TIME_WORDS) stripped = stripped.replace(word, " ");
  const candidate = stripped.split(/\s+/).find((word) => word.length >= 1 && word.length <= 30);
  if (!candidate) return undefined;
  if (MERCHANT_BLACKLIST.some((word) => candidate === word)) return undefined;
  return candidate;
}

function shiftDate(dateIso: string, deltaDays: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** 日期解析：昨天/前天优先，其次 2026-03-02 与 3月2日，缺省取今天 */
function resolveDate(text: string, todayIso: string): string {
  if (text.includes("昨天")) return shiftDate(todayIso, -1);
  if (text.includes("前天")) return shiftDate(todayIso, -2);
  if (text.includes("大前天")) return shiftDate(todayIso, -3);
  const full = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (full) {
    const date = new Date(Date.UTC(Number(full[1]), Number(full[2]) - 1, Number(full[3])));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const monthDay = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (monthDay) {
    const year = Number(todayIso.slice(0, 4));
    const date = new Date(Date.UTC(year, Number(monthDay[1]) - 1, Number(monthDay[2])));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return todayIso;
}

/**
 * 一句话记账的规则解析。todayIso 为 YYYY-MM-DD（缺省日期用），
 * 结果恒为确定性输出：同一输入同一结果，演示录制可复现。
 */
export function parseQuickEntryText(text: string, todayIso: string): QuickEntryRuleResult {
  const trimmed = text.trim();
  if (!trimmed) return { parseable: false, reason: "没有输入内容" };
  if (AMOUNT_WAN.test(trimmed)) {
    return { parseable: false, reason: "金额疑似含「万」，请手动填写" };
  }
  const amountCents = parseAmountCents(trimmed);
  if (amountCents === null) {
    if (CHAT_MARK.test(trimmed)) {
      return { parseable: false, reason: "这不像一条记账，说一句「花了多少、花在哪」试试" };
    }
    return { parseable: false, reason: "没识别出金额，请补一句数字" };
  }
  const direction = INCOME_KEYWORDS.some((keyword) => trimmed.includes(keyword))
    ? "income"
    : "expense";
  const category =
    CATEGORY_KEYWORDS.find(([, keywords]) =>
      keywords.some((keyword) => trimmed.includes(keyword)),
    )?.[0] ?? "其他";
  return {
    parseable: true,
    amountCents,
    direction,
    category,
    merchant: guessMerchant(trimmed),
    dateIso: resolveDate(trimmed, todayIso),
  };
}
