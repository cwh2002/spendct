/**
 * 成就行为进度层（WP8 §8a）：把「行为计数」从成就判定里拆出来单独落盘。
 *
 * 四类事件在各自发生点记一笔（recordProgressEvent），sync.recheckAll 组装快照时
 * 把进度读进快照（readProgress），对应徽章按累计值判定：
 * - adopt           采纳洞察卡（night-guard / saver 依赖 adopted 明细）
 * - activate-benefit 激活学生权益（scholar）
 * - dedupe-skipped   清理重复记录（cleaner，count 为本次跳过条数）
 * - followup         对洞察卡发起追问（questioner）
 *
 * 持久化在 localStorage "spendct:achievement-progress:v1"。applyProgressEvent 是
 * 纯函数（不改入参），读写函数只做存储边界（node 单测环境/隐私模式不可写静默
 * 降级）。recordProgressEvent 不调用 recheck——成就解锁由调用点在自己合适的
 * 时机再调 recheckAll，避免本模块反向依赖 sync 形成循环。
 */

import type { AdoptedCard } from "./rules";

export type ProgressEvent =
  | { type: "adopt"; cardId: string; stage: string; month: string }
  | { type: "activate-benefit" }
  | { type: "dedupe-skipped"; count: number }
  | { type: "followup" };

export interface AchievementProgress {
  /** 已采纳的洞察卡（同 cardId 去重，保留首次采纳记录） */
  adopted: AdoptedCard[];
  /** 累计激活学生权益次数 */
  activatedBenefits: number;
  /** 累计清理重复记录条数 */
  dedupeSkippedTotal: number;
  /** 对洞察卡发起追问次数 */
  followupCount: number;
}

const PROGRESS_STORAGE_KEY = "spendct:achievement-progress:v1";

/** 采纳月形如 YYYY-MM，与快照月度口径一致 */
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/** 零值基线：缺失/损坏时逐字段回退，每次返回新对象避免共享引用被误改 */
function zeroProgress(): AchievementProgress {
  return { adopted: [], activatedBenefits: 0, dedupeSkippedTotal: 0, followupCount: 0 };
}

/**
 * 应用一条进度事件，返回新对象（不改入参）：
 * - adopt：同 cardId 已存在则去重（保留首次记录，stage/month 不覆盖），否则追加；
 * - activate-benefit / followup：计数各 +1；
 * - dedupe-skipped：count 直接累加。
 */
export function applyProgressEvent(
  progress: AchievementProgress,
  event: ProgressEvent,
): AchievementProgress {
  switch (event.type) {
    case "adopt": {
      if (progress.adopted.some((card) => card.cardId === event.cardId)) {
        return progress;
      }
      return {
        ...progress,
        adopted: [
          ...progress.adopted,
          { cardId: event.cardId, stage: event.stage, month: event.month },
        ],
      };
    }
    case "activate-benefit":
      return { ...progress, activatedBenefits: progress.activatedBenefits + 1 };
    case "dedupe-skipped":
      return { ...progress, dedupeSkippedTotal: progress.dedupeSkippedTotal + event.count };
    case "followup":
      return { ...progress, followupCount: progress.followupCount + 1 };
  }
}

/** 读进度：存储缺失、内容损坏或形态不合法一律回退零值，不抛异常 */
export function readProgress(): AchievementProgress {
  if (typeof localStorage === "undefined") return zeroProgress();
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return zeroProgress();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return zeroProgress();
    const rec = parsed as Partial<AchievementProgress>;
    return {
      adopted: Array.isArray(rec.adopted) ? rec.adopted.filter(isValidAdopted) : [],
      activatedBenefits: nonNegInt(rec.activatedBenefits),
      dedupeSkippedTotal: nonNegInt(rec.dedupeSkippedTotal),
      followupCount: nonNegInt(rec.followupCount),
    };
  } catch {
    // 隐私模式不可读或 JSON 损坏：按零值处理
    return zeroProgress();
  }
}

/** 记录一条进度事件：读 → apply → 写回。解锁校验由调用点随后自行 recheckAll */
export function recordProgressEvent(event: ProgressEvent): void {
  writeProgress(applyProgressEvent(readProgress(), event));
}

/** 写进度：隐私模式不可写时静默降级（进度仅本次会话生效） */
function writeProgress(progress: AchievementProgress): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // 隐私模式不可写：跳过持久化
  }
}

/** 采纳明细逐条防御：三字段齐全且 month 形如 YYYY-MM 才收，脏条目整条丢弃 */
function isValidAdopted(item: unknown): item is AdoptedCard {
  if (typeof item !== "object" || item === null) return false;
  const rec = item as Record<string, unknown>;
  return (
    typeof rec.cardId === "string" &&
    rec.cardId !== "" &&
    typeof rec.stage === "string" &&
    rec.stage !== "" &&
    typeof rec.month === "string" &&
    MONTH_KEY_RE.test(rec.month)
  );
}

/** 非负整数防御：有限数字且 >0 才收（向下取整），其余按 0——脏计数不污染判定 */
function nonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
