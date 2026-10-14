/**
 * 消费人格段位（F10：五档，v_health_inputs 六维分规则判定）。
 * 页面只消费 getRankTier 的返回形状 { tier, name, desc }：
 * 优先读本地存储 "spendct:rank:v1"（报告页算出真实健康分后写入的档位），
 * 无记录时按健康分分档计算，兜底内置数据档位（healthIndex 78 → 3 档）。
 * 真实健康分由报告页从 v_health_inputs 六维聚合算出后经
 * getRankTier({ healthIndex }) 传入；本文件只负责「分数 → 档位」的
 * 确定性映射，不访问数据库、不含任何虚构对比口径。
 * 组件渲染期改用 useRankTier() 订阅式读取，避免 SSR 水合不一致。
 */

import { useSyncExternalStore } from "react";

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
  { tier: 4, name: "理性消费者", desc: "冲动消费显著收敛，结余率超过全国平均" },
  { tier: 5, name: "消费健康大师", desc: "全维度均衡，六维健康分全面达标" },
];

/** 健康分 → 档位边界：与内置数据 DEMO_REPORT.healthIndex=78 → 3 档保持一致 */
const TIER_BANDS: readonly { min: number; tier: number }[] = [
  { min: 90, tier: 5 },
  { min: 80, tier: 4 },
  { min: 65, tier: 3 },
  { min: 50, tier: 2 },
  { min: 0, tier: 1 },
];

const RANK_STORAGE_KEY = "spendct:rank:v1";

/** 纯分档计算：不读本地存储，供服务器快照与无存储记录时的兜底共用 */
function rankFromScore(input?: { healthIndex?: number }): RankTier {
  const score = input?.healthIndex ?? 78;
  for (const band of TIER_BANDS) {
    if (score >= band.min) {
      return RANK_TIERS[band.tier - 1] ?? RANK_TIERS[2]!;
    }
  }
  return RANK_TIERS[2]!;
}

/* ---- 订阅式读取：SSR 首帧与服务器同口径（纯分档），水合后读本地存储 ---- */

const rankListeners = new Set<() => void>();

/** 快照缓存按健康分口径分桶：报告页算出真实分后切换口径也不会读旧缓存 */
const rankSnapshotCache = new Map<string, RankTier>();

function subscribeRankTier(onChange: () => void): () => void {
  rankListeners.add(onChange);
  // 跨标签页更新（storage 事件）；同页写入由 saveRankTier 直接通知
  const onStorage = (event: StorageEvent) => {
    if (event.key === RANK_STORAGE_KEY) {
      rankSnapshotCache.clear();
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    rankListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 组件内读取段位（外部存储订阅）。healthIndex 传入时按其分档口径缓存
 * （报告页真实健康分算出后传入）；服务端与水合首帧按纯分档渲染，
 * 与服务器 HTML 一致，挂载后替换为本地存储档位。
 */
export function useRankTier(healthIndex?: number): RankTier {
  const cacheKey = healthIndex !== undefined ? String(healthIndex) : "default";
  return useSyncExternalStore(
    subscribeRankTier,
    () => {
      const cached = rankSnapshotCache.get(cacheKey);
      if (cached) return cached;
      const value = getRankTier(healthIndex !== undefined ? { healthIndex } : undefined);
      rankSnapshotCache.set(cacheKey, value);
      return value;
    },
    () => rankFromScore(healthIndex !== undefined ? { healthIndex } : undefined),
  );
}

/**
 * 持久化当前档位：报告页算出真实健康分后写入，个人中心/年度海报直接读同一份，
 * 避免两处口径漂移。写入后清快照并通知订阅组件（本页与其他页面同步刷新）。
 * 隐私模式写入失败静默忽略。
 */
export function saveRankTier(tier: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RANK_STORAGE_KEY, JSON.stringify({ tier }));
  } catch {
    // 隐私模式不可写：仅本次会话生效
  }
  rankSnapshotCache.clear();
  for (const listener of rankListeners) listener();
}

/**
 * 取段位。优先级：本地存储档位 > 健康分分档（可传参）> 内置数据兜底。
 * 兜底值 78 与 DEMO_REPORT.healthIndex 保持一致（内置数据口径落 3 档），
 * 保证离线评审与个人中心静态展示始终有档位可显示。
 * 服务端与客户端返回可能不同（客户端有本地存储），渲染期请用 useRankTier。
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
  return rankFromScore(input);
}
