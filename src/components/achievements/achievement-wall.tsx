"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Lock, Trophy } from "lucide-react";

import { ACHIEVEMENT_DEFS } from "@/lib/achievements";
import { useMounted } from "@/lib/use-mounted";

export interface AchievementWallProps {
  /** 已解锁成就 ID 集合；不在集合内的徽章按锁定态展示 */
  unlockedIds: string[];
  /** 紧凑模式：小图标四列，适合报告页等窄卡场景 */
  compact?: boolean;
}

/**
 * 成就徽章墙（F10）。锁定态灰显 + 锁角标 + 悬停浮层展示解锁条件，
 * 解锁态显示品牌色底；身份不只靠颜色，名称与条件同时以文字呈现。
 *
 * 弹入动画的实现方式：徽章的 key 绑定解锁状态，锁→解锁的瞬间 key
 * 变化导致重挂载，initial 的弹簧动画随之播放。useReducedMotion 在
 * 服务端返回 null、客户端首帧即返回真实布尔（同步读 matchMedia），
 * 直接取反会让两端 initial 不一致（style 属性水合告警），因此挂载前
 * 一律不输出 initial 内联样式，挂载后按系统「减少动态效果」设置决定
 * 是否播放；锁→解锁的重挂载发生在挂载之后，弹入动画不受影响。
 */
export function AchievementWall({ unlockedIds, compact = false }: AchievementWallProps) {
  const mounted = useMounted();
  const reducedMotion = useReducedMotion();
  const unlocked = new Set(unlockedIds);
  const unlockedCount = ACHIEVEMENT_DEFS.filter((def) => unlocked.has(def.id)).length;

  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-(--color-ink-secondary)">
          已解锁{" "}
          <span className="font-semibold text-(--color-ink) tabular-nums">{unlockedCount}</span>
          <span className="text-(--color-ink-muted) tabular-nums"> / {ACHIEVEMENT_DEFS.length}</span>
        </p>
        <div
          aria-hidden
          className="h-1.5 w-32 overflow-hidden rounded-full bg-(--color-surface-2)"
        >
          <div
            className="h-full rounded-full bg-(--color-primary) transition-all"
            style={{ width: `${(unlockedCount / ACHIEVEMENT_DEFS.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className={`mt-4 grid gap-3 ${compact ? "grid-cols-4" : "grid-cols-3"}`}>
        {ACHIEVEMENT_DEFS.map((def) => {
          const isUnlocked = unlocked.has(def.id);
          const Icon = def.icon;
          return (
            <motion.li
              // key 带解锁状态：锁→解锁的重挂载是弹入动画的触发点
              key={`${def.id}-${isUnlocked ? "unlocked" : "locked"}`}
              initial={isUnlocked && mounted && !reducedMotion ? { scale: 0.3, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 24 }}
              className="group relative flex flex-col items-center gap-2 rounded-(--radius-lg) border border-(--color-border) p-3 text-center sm:p-4"
            >
              <span className="relative">
                <span
                  aria-hidden
                  className={`grid size-12 place-items-center rounded-full ${
                    isUnlocked
                      ? "bg-(--color-primary-soft) text-(--color-primary)"
                      : "bg-(--color-surface-2) text-(--color-ink-muted)"
                  }`}
                >
                  <Icon className="size-6" aria-hidden />
                </span>
                {isUnlocked ? null : (
                  <span
                    aria-hidden
                    className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-(--color-border) bg-(--color-surface) text-(--color-ink-muted)"
                  >
                    <Lock className="size-3" aria-hidden />
                  </span>
                )}
              </span>
              <span
                className={`text-xs font-medium ${isUnlocked ? "text-(--color-ink)" : "text-(--color-ink-muted)"}`}
              >
                {def.name}
              </span>

              {/* 徽标下通俗解释（10 字内）：按真实解锁口径写，与悬停浮层的完整条件互补 */}
              <span className="text-[11px] leading-snug text-(--color-ink-muted)">{def.plain}</span>

              {/* 锁定态悬停浮层：解锁条件。悬浮定位避免遮挡网格相邻徽章 */}
              {isUnlocked ? null : (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max max-w-44 -translate-x-1/2 rounded-(--radius-md) bg-(--color-ink) px-2.5 py-1.5 text-xs leading-relaxed text-(--color-surface) shadow-(--shadow-md) group-hover:block"
                >
                  解锁条件：{def.desc}
                </span>
              )}

              {/* 屏幕阅读器：悬浮才能看到的解锁条件与状态在此显式声明 */}
              <span className="sr-only">
                {isUnlocked ? "已解锁" : `未解锁，解锁条件：${def.desc}`}
              </span>
            </motion.li>
          );
        })}
      </ul>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
        <Trophy className="size-3.5" aria-hidden />
        成就由确定性规则判定，完成条件即自动解锁，数据只保存在本机。
      </p>
    </div>
  );
}
