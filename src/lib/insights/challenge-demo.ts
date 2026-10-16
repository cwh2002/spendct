/**
 * 省钱挑战打卡页的演示序列生成器（确定性）。
 *
 * 生成最近 120 天、12 类目的逐日支出，一天一类一行（与真实查询行形态一致）。
 * 类目口径对齐内置账户（demo-data.ts）：年支出 20,800 元、月均约 1,733 元，
 * 按下面「出现概率 × 日均金额」求和，本生成器日均约 54 元、月均约 1,627 元，
 * 落在同一量级（逐日序列只服务挑战页，不参与跨页月度对账）。
 * 金额在均值 ±60% 内波动；固定种子保证每次渲染序列相同。
 */

import { toDateKey, type CategoryDayCents } from "./challenge-sql";

/** 演示序列覆盖天数：挑战期 21 天 + 基线期 30 天 + 缓冲，对齐真实查询的 120 天窗口 */
export const CHALLENGE_DEMO_DAYS = 120;

/** 类目画像：presence = 有支出的天数占比，meanCents = 有支出日的日均金额（分） */
interface CategoryProfile {
  presence: number;
  meanCents: number;
}

const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  餐饮: { presence: 0.9, meanCents: 2200 },
  购物: { presence: 0.55, meanCents: 2000 },
  交通: { presence: 0.5, meanCents: 500 },
  娱乐: { presence: 0.35, meanCents: 1300 },
  居住: { presence: 0.3, meanCents: 2200 },
  通讯: { presence: 0.35, meanCents: 300 },
  医疗: { presence: 0.15, meanCents: 900 },
  教育: { presence: 0.12, meanCents: 1000 },
  人情: { presence: 0.15, meanCents: 900 },
  金融: { presence: 0.12, meanCents: 600 },
  订阅: { presence: 0.25, meanCents: 800 },
  其他: { presence: 0.35, meanCents: 600 },
};

/** 确定性伪随机：同一种子每次生成同一批演示行，重渲染时数据不会「洗牌」 */
function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成最近 120 天逐日类目支出（日期升序）：无体检结果或查询失败时的兜底动线 */
export function generateChallengeDemoRows(): CategoryDayCents[] {
  const rand = mulberry32(20261016);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows: CategoryDayCents[] = [];
  for (let offset = CHALLENGE_DEMO_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const dateKey = toDateKey(date);
    // Object.entries 按定义顺序遍历：同一种子下每个类目的随机消耗顺序固定
    for (const [category, profile] of Object.entries(CATEGORY_PROFILES)) {
      if (rand() >= profile.presence) continue;
      const cents = Math.round(profile.meanCents * (0.4 + rand() * 1.2));
      rows.push({ category, date: dateKey, cents });
    }
  }
  return rows;
}
