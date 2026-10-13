/**
 * 导入行清洗：BillRow[] → CleanTransaction[]（07 §3 清洗口径的 JS 侧实现）。
 *
 * 职责（clean 阶段的确定性前置）：
 * 1. 类目细分：解析期无法归类的行落「其他」，这里按商户关键词词典细分到
 *    12 类目之一（07 §3 类目枚举），并给出 sub_category；
 * 2. 交易指纹：tx_id = sha256(渠道|日期|金额|商户|单号) 前 16 位 hex（07 §3 口径），
 *    金额与商户都参与指纹，同一笔交易跨文件重复导入时产生相同 tx_id；
 * 3. 状态与来源：退款行（note 前缀 [退款]）标 refunded，其余 paid；
 *    source/channel 对齐渠道枚举，imported_files 记文件名。
 *
 * 清洗后产物直接交给 initDataset 建 18 列 transactions 表（src/lib/duckdb/dataset.ts），
 * 与演示数据集 demoTransactions() 走同一条落库路径，六阶段引擎无感知差异。
 */
import type { CleanTransaction } from "@/lib/schema/bill";
import type { BillRow } from "./types";

/** 渠道 → transactions.source（A3 渠道枚举） */
const CHANNEL_SOURCE: Record<BillRow["channel"], CleanTransaction["source"]> = {
  wechat: "wechat",
  alipay: "alipay",
};

/**
 * 商户关键词词典（关键词 → {类目, 子类目}）。
 * 命中规则：按序取第一个命中的关键词（前面的关键词更具体）；
 * 未命中保持「其他」。词典覆盖示例账单全部商户池与常见真实商户形态。
 */
const MERCHANT_KEYWORDS: ReadonlyArray<{
  match: RegExp;
  category: CleanTransaction["category"];
  subCategory: string;
}> = [
  // 订阅（先于娱乐/通讯：会员类商户名常含「视频/音乐」等词，订阅口径优先）
  { match: /(会员|VIP|续费|自动续费|黑胶|绿钻)/i, category: "订阅", subCategory: "数字会员" },
  // 餐饮
  { match: /(外卖|美团|饿了么|瑞幸|蜜雪|麦当劳|肯德基|沙县|火锅|喜茶|茶|咖啡|餐|饭|面|小吃|烘培|奶茶|食堂)/i, category: "餐饮", subCategory: "餐饮" },
  // 交通
  { match: /(滴滴|地铁|高德打车|哈啰|单车|12306|铁路|公交|出行|打车|车票)/i, category: "交通", subCategory: "出行" },
  // 居住
  { match: /(自如|国家电网|燃气|自来水|链家|房租|电费|水费|物业|房租)/i, category: "居住", subCategory: "住房水电" },
  // 通讯
  { match: /(移动|联通|电信|话费|流量|宽带)/i, category: "通讯", subCategory: "话费流量" },
  // 医疗
  { match: /(医|药|诊所|体检)/i, category: "医疗", subCategory: "医疗健康" },
  // 教育
  { match: /(新东方|粉笔|有道|知网|学而思|课程|教育|培训|网课)/i, category: "教育", subCategory: "学习进修" },
  // 金融
  { match: /(信用卡|理财通|微粒贷|还款|定投|基金|保险)/i, category: "金融", subCategory: "金融理财" },
  // 购物
  { match: /(京东|淘宝|拼多多|唯品会|得物|小米商城|山姆|名创|优衣库|超市|百货|商城|旗舰店)/i, category: "购物", subCategory: "日常购物" },
  // 娱乐
  { match: /(影城|电影|哔哩哔哩|Steam|游戏|剧本杀|唱吧|演出|大麦|门票|充值)/i, category: "娱乐", subCategory: "休闲娱乐" },
];

/** 人情与红包：微信红包/转账对方是熟人昵称时归人情；无法从商户名判断，按备注词兜底 */
const GIFT_NOTE_PATTERN = /(红包|转账|AA|礼物)/i;

/** 类目细分入口：词典未命中且备注疑似人情往来时归「人情」，否则保持原类目（默认「其他」） */
export function classifyMerchant(merchant: string, note: string | undefined): {
  category: CleanTransaction["category"];
  subCategory: string | null;
} {
  for (const rule of MERCHANT_KEYWORDS) {
    if (rule.match.test(merchant)) {
      return { category: rule.category, subCategory: rule.subCategory };
    }
  }
  if (note && GIFT_NOTE_PATTERN.test(note)) {
    return { category: "人情", subCategory: "红包转账" };
  }
  return { category: "其他", subCategory: null };
}

/** sha256 摘要；无 WebCrypto 环境退化为双种子 FNV-1a（与管线引擎同一降级口径） */
async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  const fnv1a = (seed: number): string => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  return (fnv1a(0x811c9dc5) + fnv1a(0x9e3779b9)).slice(0, 12);
}

/** 单行 → CleanTransaction。ts 无时刻时取 12:00（纯日期账单口径，注释对齐 07 §3） */
async function toCleanTransaction(row: BillRow, fileName: string): Promise<CleanTransaction> {
  const fingerprint = `${row.channel}|${row.dateIso}|${row.amountCents}|${row.merchant}|${row.rawRef ?? ""}`;
  const txId = (await sha256Hex(fingerprint)).slice(0, 16);
  const { category, subCategory } = classifyMerchant(row.merchant, row.note);
  const isRefund = row.note?.startsWith("[退款]") === true;

  return {
    tx_id: txId,
    account_id: null,
    ts: `${row.dateIso}T${row.timeIso ?? "12:00:00"}`,
    date_iso: row.dateIso,
    amount_cents: row.amountCents,
    direction: row.direction,
    merchant: row.merchant,
    counterparty: null,
    category,
    sub_category: subCategory,
    channel: row.channel,
    status: isRefund ? "refunded" : "paid",
    external_id: row.rawRef ?? null,
    note: row.note ?? null,
    raw_ref: null,
    source: CHANNEL_SOURCE[row.channel],
    _meta: null,
    imported_files: [fileName],
  };
}

/** 清洗整批行（含逐行指纹与类目细分）。调用方应传入 stripDuplicates 之后的去重行 */
export async function cleanBillRows(rows: BillRow[], fileName: string): Promise<CleanTransaction[]> {
  const cleaned: CleanTransaction[] = [];
  for (const row of rows) {
    cleaned.push(await toCleanTransaction(row, fileName));
  }
  return cleaned;
}

/**
 * 数据集哈希（07 §17 缓存键口径）：全部 tx_id 拼接后 sha256 前 16 位 hex。
 * 同一份账单重复导入产出同一哈希，阶段级缓存与断点键据此命中。
 */
export async function hashCleanRows(rows: CleanTransaction[]): Promise<string> {
  const digest = await sha256Hex(rows.map((row) => row.tx_id).join(""));
  return digest.slice(0, 16);
}
