import { Trophy } from "lucide-react";

import { RANK_TIERS, type RankTier } from "@/lib/rank";

export interface RankBadgeProps {
  tier: RankTier;
  className?: string;
}

/**
 * 段位卡：档位名/描述 + 五格档位条（点亮到当前档）。
 * 档位表来自 @/lib/rank 的 RANK_TIERS，与个人中心徽章同一数据源，
 * 避免两处文案漂移。
 */
export function RankBadge({ tier, className = "" }: RankBadgeProps) {
  return (
    <div
      className={`flex flex-col rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-(--color-ink-secondary)">
          <Trophy className="size-4 text-(--color-primary)" aria-hidden />
          消费段位
        </p>
        <span className="rounded-full bg-(--color-primary-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-brand-600) tabular-nums">
          Lv.{tier.tier} / {RANK_TIERS.length}
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold">{tier.name}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-(--color-ink-secondary)">{tier.desc}</p>

      {/* 五格档位条：点亮到当前档 */}
      <div className="mt-auto flex gap-1.5 pt-5" aria-hidden>
        {RANK_TIERS.map((t) => (
          <span
            key={t.tier}
            className={`h-1.5 flex-1 rounded-full ${
              t.tier <= tier.tier ? "bg-(--color-primary)" : "bg-(--color-surface-2)"
            }`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-(--color-ink-muted)">
        五档段位 · 由六维健康分判定，提升健康分即可升级
      </p>
    </div>
  );
}
