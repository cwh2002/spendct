"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, PanelBottomOpen, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckpointBar,
  clearCheckpoint,
  readPausedCheckpoint,
} from "@/components/checkup/checkpoint-bar";
import { createDemoRun, getDemoEvidence, type DemoRun } from "@/components/checkup/demo-run";
import { PipelineStepper } from "@/components/checkup/pipeline-stepper";
import { StageEvidenceDrawer } from "@/components/checkup/stage-evidence-drawer";
import { ThinkingPanel } from "@/components/checkup/thinking-panel";
import { ThinkingSheet } from "@/components/checkup/thinking-sheet";
import type { StageState, ThinkingEvent } from "@/components/checkup/types";
import { Container } from "@/components/layout/container";
import { DEMO_STAGES } from "@/lib/demo-data";

type Phase = "boot" | "playing" | "paused" | "done";

const PHASE_LABEL: Record<Phase, { chip: string; sub: string }> = {
  boot: { chip: "准备中", sub: "正在准备体检引擎 · 本地 DuckDB-WASM 初始化" },
  playing: { chip: "运行中", sub: "六阶段流水线正在本地执行 · 账单明细不出浏览器" },
  paused: { chip: "已暂停", sub: "进度已保存于本机 · 点击「继续」从当前阶段恢复" },
  done: { chip: "已完成", sub: "六阶段全部跑完 · 洞察卡已就绪" },
};

/** 播放前的骨架屏：与路由级 loading.tsx 视觉同源，数据到达后无缝切走 */
function BootSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex h-16 animate-pulse items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4"
          >
            <span className="size-6 shrink-0 rounded-full bg-(--color-surface-2)" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded-full bg-(--color-surface-2)" />
              <div className="h-2.5 w-40 rounded-full bg-(--color-surface-2)" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden lg:col-span-2 lg:block">
        <div className="h-[calc(100vh-7.5rem)] animate-pulse rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4">
          <div className="space-y-3">
            <div className="h-3 w-24 rounded-full bg-(--color-surface-2)" />
            <div className="h-12 rounded-(--radius-md) bg-(--color-surface-2)" />
            <div className="h-12 rounded-(--radius-md) bg-(--color-surface-2)" />
            <div className="h-12 rounded-(--radius-md) bg-(--color-surface-2)" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckupPage() {
  const router = useRouter();
  const runRef = useRef<DemoRun | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [stages, setStages] = useState<StageState[]>(() =>
    DEMO_STAGES.map((s) => ({ ...s, status: "pending" as const })),
  );
  const [events, setEvents] = useState<ThinkingEvent[]>([]);
  const [drawerStageId, setDrawerStageId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pausedTs, setPausedTs] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    // 数据来源分支（真实管线明天接入，本页只替换这一段，组件与交互不动）：
    // 1. URL 带 ?sample=1 → 与无数据同路径，直接 demo 播放（评审动线「加载示例账单」）
    // 2. pipeline store 存在 datasetTxHash → 订阅真实 runner 事件流，替换 createDemoRun
    // 3. 本轮规则：无数据也允许进入（05 §1.4 守卫逻辑明天随管线一起接）
    //
    // demo 态不恢复断点（断点只对真实 runId 有意义），清掉上一轮 demo 暂停留下的键；
    // 真实管线接入后按 03 §1.4 RunStateV1 做刷新恢复。
    if (readPausedCheckpoint()) clearCheckpoint();

    const timer = window.setTimeout(() => {
      const run = createDemoRun({
        onStageChange: (stage) =>
          setStages((prev) => prev.map((s) => (s.id === stage.id ? stage : s))),
        onEvent: (ev) => setEvents((prev) => [...prev, ev].slice(-200)),
        // 倒计时复位放在驱动回调里（非 effect 体），重新播放后再次完成也能正确回到 3 秒
        onDone: () => {
          setCountdown(3);
          setPhase("done");
        },
      });
      runRef.current = run;
      setPhase("playing");
      run.start();
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  // 卸载时停掉 demo 驱动，避免离开页面后定时器继续写状态
  useEffect(
    () => () => {
      runRef.current?.stop();
    },
    [],
  );

  // 完成态 3 秒倒计时自动跳 /insights；导航放在独立 effect 里，倒计时本身保持纯更新
  useEffect(() => {
    if (phase !== "done") return;
    const iv = window.setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    if (phase === "done" && countdown === 0) router.push("/insights");
  }, [phase, countdown, router]);

  useEffect(() => {
    document.title = phase === "done" ? "体检完成 · SpendCT" : "体检运行中 · SpendCT";
  }, [phase]);

  const pauseRun = useCallback(() => {
    runRef.current?.pause();
    setStages((prev) =>
      prev.map((s) => (s.status === "running" ? { ...s, status: "paused" as const } : s)),
    );
    setPhase("paused");
    setPausedTs(Date.now());
  }, []);

  const resumeRun = useCallback(() => {
    runRef.current?.resume();
    setPhase("playing");
    setPausedTs(null);
  }, []);

  const restartRun = useCallback(() => {
    runRef.current?.stop();
    setEvents([]);
    setStages(DEMO_STAGES.map((s) => ({ ...s, status: "pending" as const })));
    setPausedTs(null);
    setDrawerStageId(null);
    runRef.current?.start();
    setPhase("playing");
  }, []);

  const currentStage = stages.find((s) => s.status === "running" || s.status === "paused");
  const currentStageName =
    currentStage?.name ?? (phase === "done" ? stages[stages.length - 1]?.name : stages[0]?.name);

  const drawerStage = drawerStageId ? (stages.find((s) => s.id === drawerStageId) ?? null) : null;
  // 只有已完成的阶段才有完整证据视图；未开始阶段点开展示空态（05 §1.4 状态覆盖）
  const drawerEvidence =
    drawerStage && drawerStage.status === "succeeded" ? getDemoEvidence(drawerStage.id) : null;

  const totalCards = stages.reduce(
    (sum, s) => sum + (s.status === "succeeded" ? s.cards : 0),
    0,
  );

  const chipTone =
    phase === "done"
      ? "bg-(--color-good)/10 text-(--color-good-ink)"
      : phase === "paused"
        ? "bg-(--color-warn-soft) text-(--color-warning-ink)"
        : phase === "playing"
          ? "bg-(--color-primary-soft) text-(--color-primary)"
          : "bg-(--color-surface-2) text-(--color-ink-secondary)";

  return (
    <Container wide className="py-6 md:py-8">
      {/* 页头：标题 + 阶段状态 + 演示/隐私徽章 */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">账单体检</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chipTone}`}>
              {PHASE_LABEL[phase].chip}
            </span>
          </div>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">{PHASE_LABEL[phase].sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-(--color-accent)/10 px-2.5 py-1 text-xs font-medium text-(--color-accent)">
            演示数据 · 示例账单 10,000 行
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-(--color-ink-secondary)">
            <ShieldCheck className="size-3.5" aria-hidden />
            数据不出浏览器
          </span>
        </div>
      </header>

      {phase === "boot" ? (
        <BootSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* 左 3：流水线步骤 + 断点条 */}
          <section aria-label="体检流水线" className="lg:col-span-3">
            <PipelineStepper stages={stages} onStageClick={(s) => setDrawerStageId(s.id)} />
            {phase !== "done" ? (
              <CheckpointBar
                paused={phase === "paused"}
                stageId={currentStage?.id}
                pausedTs={pausedTs}
                onPause={pauseRun}
                onResume={resumeRun}
                onRestart={restartRun}
              />
            ) : null}
            {/* 移动端思考面板入口：lg 以上右列常驻（05 §1.4 移动端收进 bottom sheet） */}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) text-sm font-medium text-(--color-ink-secondary) shadow-(--shadow-sm) transition hover:border-(--color-border-strong) lg:hidden"
            >
              <PanelBottomOpen className="size-4" aria-hidden />
              查看思考过程
              <span className="rounded-full bg-(--color-surface-2) px-2 py-0.5 text-xs tabular-nums">
                {events.length}
              </span>
            </button>
          </section>

          {/* 右 2：思考过程面板（sticky 跟随，顶部让出导航高度） */}
          <section aria-label="思考过程面板" className="hidden lg:col-span-2 lg:block">
            <div className="lg:sticky lg:top-20">
              <ThinkingPanel
                events={events}
                stageName={currentStageName}
                className="h-[calc(100vh-7.5rem)]"
              />
            </div>
          </section>
        </div>
      )}

      {/* 完成条：对勾 + 体检完成 + 3 秒倒计时自动跳 /insights（05 §1.4 成功态） */}
      <AnimatePresence>
        {phase === "done" ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-(--radius-lg) border border-(--color-good)/40 bg-(--color-good)/5 px-5 py-4 shadow-(--shadow-md)"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--color-good)">
                <Check className="size-5 text-white" strokeWidth={3.5} aria-hidden />
              </span>
              <div>
                <p className="font-semibold">体检完成</p>
                <p className="text-sm text-(--color-ink-secondary)">
                  六阶段全部跑完 · 共产出{" "}
                  <span className="tabular-nums">{totalCards}</span> 张洞察卡 ·{" "}
                  <span className="tabular-nums text-(--color-primary)">{countdown}</span>{" "}
                  秒后自动进入洞察流
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/insights"
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition hover:bg-(--color-btn-primary-hover)"
              >
                立即查看
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={restartRun}
                className="inline-flex h-11 items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface) px-5 text-sm font-medium text-(--color-ink-secondary) transition hover:border-(--color-border-strong)"
              >
                <RotateCcw className="size-4" aria-hidden />
                重新播放
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* 阶段证据抽屉（全尺寸）/ 移动端思考底部抽屉 */}
      <StageEvidenceDrawer
        stage={drawerStage}
        evidence={drawerEvidence}
        onClose={() => setDrawerStageId(null)}
      />
      <ThinkingSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <ThinkingPanel events={events} stageName={currentStageName} className="min-h-64 flex-1" />
      </ThinkingSheet>
    </Container>
  );
}
