"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, Stethoscope, X } from "lucide-react";
import { STAGE_DISPLAY_NAMES, type StageId } from "@/lib/pipeline/stage";

/** 断点恢复快照的存储键：/checkup 每次阶段推进时写入，首页与 /upload 共用读取 */
export const RUN_SNAPSHOT_KEY = "spendct:run:latest";

export interface RunSnapshot {
  /** 与体检管线状态机对齐；本组件只关心 paused 一档 */
  status?: string;
  /** 暂停时所在的阶段 id（StageId） */
  stage?: string;
  /** 账本名，用于展示上下文 */
  bookName?: string;
}

/** 读取暂停中的体检快照；键不存在、解析失败或非 paused 状态一律视为无断点 */
export function readPausedRun(): RunSnapshot | null {
  try {
    const raw = localStorage.getItem(RUN_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const snapshot = parsed as RunSnapshot;
    return snapshot.status === "paused" ? snapshot : null;
  } catch {
    return null;
  }
}

/** 「尚未读取」哨兵：与「已读取且为空（null）」区分，保证 getSnapshot 返回稳定缓存值 */
const UNREAD: unique symbol = Symbol("run-snapshot-unread");
let cachedSnapshot: RunSnapshot | null | typeof UNREAD = UNREAD;

/** 首次调用时完成唯一一次读取；之后返回缓存引用，避免 useSyncExternalStore 无限重渲染 */
function getRunSnapshot(): RunSnapshot | null {
  if (cachedSnapshot === UNREAD) {
    cachedSnapshot = readPausedRun();
  }
  return cachedSnapshot;
}

/** 其他标签页写入或清空快照时，同步刷新本页的恢复条 */
function subscribeToStorage(onChange: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key === RUN_SNAPSHOT_KEY || event.key === null) {
      cachedSnapshot = readPausedRun();
      onChange();
    }
  }
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

/** 清除断点键并重置缓存：重新开始/忽略后，任何页面都不再提示 */
function clearSnapshot() {
  try {
    localStorage.removeItem(RUN_SNAPSHOT_KEY);
  } catch {
    // 隐私模式禁 localStorage：无键可清，忽略
  }
  cachedSnapshot = null;
}

/** 快照里的 stage 是合法阶段 id 时返回展示名，否则返回 null */
function stageDisplayName(snapshot: RunSnapshot): string | null {
  const stage = snapshot.stage;
  if (stage && stage in STAGE_DISPLAY_NAMES) {
    return STAGE_DISPLAY_NAMES[stage as StageId].name;
  }
  return null;
}

/**
 * 断点恢复条：检测到上次体检暂停时浮出，首页与 /upload 复用。
 * localStorage 属外部状态源，用 useSyncExternalStore 订阅：
 * 服务端快照恒为 null（SSR 首帧不渲染），挂载后 React 换用客户端快照重渲染，
 * 条自然浮出且无水合不一致。
 */
export function ResumeBanner() {
  const router = useRouter();
  const snapshot = useSyncExternalStore(subscribeToStorage, getRunSnapshot, () => null);
  const [dismissed, setDismissed] = useState(false);

  function handleRestart() {
    clearSnapshot();
    setDismissed(true);
    router.push("/upload");
  }

  function handleIgnore() {
    clearSnapshot();
    setDismissed(true);
  }

  const visible = snapshot !== null && !dismissed;
  const stageName = snapshot ? stageDisplayName(snapshot) : null;

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.aside
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          aria-label="恢复上次体检"
          className="flex flex-col gap-3 rounded-(--radius-card) border border-(--color-primary) bg-(--color-surface) p-4 text-left shadow-(--shadow-md) sm:flex-row sm:items-center"
        >
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-(--color-primary-soft) text-(--color-primary)"
          >
            <Stethoscope className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-(--color-ink)">上次体检还没有跑完</p>
            <p className="mt-0.5 text-sm text-(--color-ink-secondary)">
              {stageName ? (
                <>上次暂停在「{stageName}」阶段，可以从断点继续，也可以重新开始。</>
              ) : (
                <>体检已暂停，可以从断点继续，也可以重新开始。</>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/checkup"
              className="inline-flex h-11 items-center rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition hover:bg-(--color-btn-primary-hover)"
            >
              继续体检
            </Link>
            <button
              type="button"
              onClick={handleRestart}
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-(--color-border-strong) px-4 text-sm font-medium text-(--color-ink) transition hover:border-(--color-primary)"
            >
              <RotateCcw className="size-4" aria-hidden />
              重新开始
            </button>
            <button
              type="button"
              onClick={handleIgnore}
              aria-label="忽略本次提醒"
              className="grid size-11 shrink-0 place-items-center rounded-full text-(--color-ink-muted) transition hover:bg-(--color-surface-2) hover:text-(--color-ink)"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
