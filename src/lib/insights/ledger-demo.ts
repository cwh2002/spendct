/**
 * 账本类视图（账本汇总 / 商户统计）共用的演示明细生成器。
 *
 * 用途：无体检结果（lastRun 为空）或 DuckDB 查询失败时，账本类视图
 * 回退到同一批确定性演示行，保证两个视图的演示口径一致。
 * 全部为纯函数 + 固定种子，同一批次每次渲染结果相同（明细不「洗牌」）。
 */

/** 账本类视图共用的明细行形态（日期 / 商户 / 类别 / 金额分） */
export interface LedgerDemoRow {
  id: number;
  date: Date;
  merchant: string;
  category: string;
  amountCents: number;
}

/** 确定性伪随机：同一种子每次生成同一批演示行，重渲染时明细表不会「洗牌」 */
function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 类别权重（大学生消费口径）：餐饮约占 42%，与下方单笔金额区间共同逼近大学生月消费结构 */
const CATEGORY_WEIGHTS: [string, number][] = [
  ["餐饮", 42],
  ["购物", 20],
  ["交通", 8],
  ["娱乐", 10],
  ["居住", 12],
  ["其他", 8],
];

const MERCHANT_POOL: Record<string, string[]> = {
  餐饮: ["美团外卖", "饿了么", "瑞幸咖啡", "麦当劳", "沙县小吃"],
  购物: ["京东商城", "淘宝", "拼多多", "优衣库", "名创优品"],
  交通: ["滴滴出行", "公交地铁", "中石化", "高德打车"],
  娱乐: ["Steam", "优酷视频", "网易云音乐", "万达影城"],
  居住: ["自如", "国家电网", "自来水公司", "中国移动"],
  其他: ["微信读书", "顺丰速运", "大参林药房", "家乐福"],
};

/** 金额区间（分，大学生单笔消费口径）：按类别设定，覆盖外卖小单到购物/居住大单 */
const AMOUNT_RANGE: Record<string, [number, number]> = {
  餐饮: [800, 8000],
  购物: [1000, 15000],
  交通: [200, 6000],
  娱乐: [500, 9000],
  居住: [1000, 15000],
  其他: [200, 2500],
};

function pickCategory(rand: () => number): string {
  const roll = rand() * 100;
  let acc = 0;
  for (const [category, weight] of CATEGORY_WEIGHTS) {
    acc += weight;
    if (roll < acc) return category;
  }
  return CATEGORY_WEIGHTS[CATEGORY_WEIGHTS.length - 1]![0];
}

/**
 * 生成 100 行演示明细（时间倒序）：仅作兜底动线——
 * 无体检结果（lastRun 为空）或 DuckDB 明细查询失败时使用；
 * 真实数据已接入（见各视图组件内装载 effect）。
 *
 * 日期分布：跨度约 13 个月且向近期倾斜（指数 1.5）——
 * 日期范围筛选（近 7/30/90 天、本月）是账本汇总的核心交互，
 * 演示数据必须让每一档筛完都有可见的样本差异（近 90 天约占四成），
 * 否则筛选按钮在演示动线下看起来「没有效果」。
 */
export function generateLedgerDemoRows(): LedgerDemoRow[] {
  const rand = mulberry32(20261013);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows: LedgerDemoRow[] = [];
  for (let i = 0; i < 100; i++) {
    const category = pickCategory(rand);
    const pool = MERCHANT_POOL[category] ?? ["未知商户"];
    const merchant = pool[Math.floor(rand() * pool.length)] ?? "未知商户";
    const [min, max] = AMOUNT_RANGE[category] ?? [100, 5000];
    const amountCents = Math.round(min + rand() * (max - min));
    const date = new Date(today);
    date.setDate(date.getDate() - Math.floor(Math.pow(rand(), 1.5) * 390));
    rows.push({ id: i + 1, date, merchant, category, amountCents });
  }
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}
