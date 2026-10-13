/**
 * 消费人格段位（F10：五档，v_health_inputs 六维分规则判定）。
 * 页面只消费 getRankTier 的返回形状 { tier, name, desc }：
 * 优先读本地存储 "spendct:rank:v1"（报告页计算后写入的档位），
 * 无记录时按健康分分档计算，兜底演示数据（healthIndex 78 → 3 档）。
 * 后续接入六维分聚合后可整体替换内部映射。
 */

export interface RankTier {
  /** 档位 1-5，数字越大越健康 */
  tier: number;
  name: string;
  desc: string;
}

/** 五档段位表：档位文案与报告页、个人中心共用，避免两处维护漂移 */
export const RANK_TIERS: readonly RankTier[] = [
  { tier: 1, name: "消费新手", desc: "体检之路刚刚开始，先完成一次全流程扫描" },
  { tier: 2, name: "记账达人", desc: "消费记录连续积累，数据基础已经成型" },
  { tier: 3, name: "进阶规划师", desc: "开始控制固定成本层，预算意识成型" },
  { tier: 4, name: "理性消费者", desc: "冲动消费显著收敛，结余率跑赢同龄基准" },
  { tier: 5, name: "消费健康大师", desc: "全维度均衡，六维健康分全面达标" },
];

/** 健康分 → 档位边界：与演示数据 DEMO_REPORT.healthIndex=78 → 3 档保持一致 */
const TIER_BANDS: readonly { min: number; tier: number }[] = [
  { min: 90, tier: 5 },
  { min: 80, tier: 4 },
  { min: 65, tier: 3 },
  { min: 50, tier: 2 },
  { min: 0, tier: 1 },
];

const RANK_STORAGE_KEY = "spendct:rank:v1";

/**
 * 持久化当前档位：报告页重算后写入，个人中心/年度海报直接读同一份，
 * 避免两处口径漂移。隐私模式写入失败静默忽略。
 */
export function saveRankTier(tier: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RANK_STORAGE_KEY, JSON.stringify({ tier }));
  } catch {
    // 隐私模式不可写：仅本次会话生效
  }
}

/**
 * 取段位。优先级：本地存储档位 > 健康分分档（可传参）> 演示数据兜底。
 * 保证离线评审与个人中心静态展示始终有档位可显示。
 */
export function getRankTier(input?: { healthIndex?: number }): RankTier {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(RANK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tier?: unknown };
        if (typeof parsed.tier === "number" && parsed.tier >= 1 && parsed.tier <= 5) {
          return RANK_TIERS[parsed.tier - 1] ?? RANK_TIERS[2]!;
        }
      }
    } catch {
      // 存储损坏：回落分档计算
    }
  }
  const score = input?.healthIndex ?? 78;
  for (const band of TIER_BANDS) {
    if (score >= band.min) {
      return RANK_TIERS[band.tier - 1] ?? RANK_TIERS[2]!;
    }
  }
  return RANK_TIERS[2]!;
}
