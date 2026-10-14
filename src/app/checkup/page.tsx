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
import { demoDatasetHash } from "@/lib/pipeline/mock-run";
import {
  createPipelineRun,
  getRunEvidence,
  type CreatePipelineRunOptions,
  type PipelineRun,
} from "@/lib/pipeline/runner";
import { SIX_STAGES } from "@/lib/pipeline/stage";
import { usePipeline } from "@/lib/pipeline/store";

type Phase = "boot" | "playing" | "paused" | "done";

/** 数据来源三分支：demo 定时器播放 / 真实管线跑内置数据集 / 真实管线跑本地账单 */
type DataMode = "demo" | "sample" | "upload";

/** 播放驱动公共接口：createDemoRun 与 createPipelineRun 返回形一致（start/pause/resume/stop） */
type RunDriver = DemoRun | PipelineRun;

/** 演示控制台动作事件（05 §7.3 评审应急武器）：控制台 dispatchEvent 触发，本页只处理两个动作 */
const DEMO_ACTION_EVENT = "spendct:demo-action";
const DEMO_ACTION_INJECT_ERROR = "inject-error";
const DEMO_ACTION_JUMP_LAST_STAGE = "jump-last-stage";

/** jump-last-stage 中 annual 阶段 running → succeeded 的展示间隔（与 demo 单阶段时长同源） */
const JUMP_ANNUAL_MS = 700;

const PHASE_LABEL: Record<Phase, { chip: string; sub: string }> = {
  boot: { chip: "准备中", sub: "正在准备，稍等几秒…" },
  playing: { chip: "运行中", sub: "正在检查你的账单，六个步骤依次进行 · 账单不会上传到任何服务器" },
  paused: { chip: "已暂停", sub: "进度在本次会话内保留 · 刷新页面后需重新体检" },
  done: { chip: "已完成", sub: "六项检查全部完成 · 分析结果已就绪" },
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
  const runRef = useRef<RunDriver | null>(null);
  // 数据来源（mount 时一次性判定；SSR 渲染按 demo 兜底，水合后按 URL/store 修正徽章与证据源）
  const [mode, setMode] = useState<DataMode>("demo");
  // 真实分支 run 入参：mount 判定后固化，restart 复用（避免 store 中途清空导致分支漂移）
  const runOptsRef = useRef<CreatePipelineRunOptions | null>(null);
  // 置位后丢弃驱动 onDone 收口：用户暂停 / 控制台 jump 接管完成态时使用。
  // 真实管线 pause/stop 触发的 abort 收尾同样走 onDone，不抑制会覆盖「已暂停」与 jump 接管态
  const suppressDoneRef = useRef(false);
  const jumpTimerRef = useRef<number | null>(null);
  const consoleEventSeqRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("boot");
  const [stages, setStages] = useState<StageState[]>(() =>
    DEMO_STAGES.map((s) => ({ ...s, status: "pending" as const })),
  );
  const [events, setEvents] = useState<ThinkingEvent[]>([]);
  const [drawerStageId, setDrawerStageId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pausedTs, setPausedTs] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(3);

  // 统一启动入口（mount 一次性 timer 与「重新播放」共用）：停掉旧驱动 → 按分支新建驱动。
  // 每次都新建实例：旧实例的中止收尾回调经 onDone 里的实例一致性检查丢弃，不覆盖新运行状态
  const startRun = useCallback(() => {
    runRef.current?.stop();
    let run: RunDriver | null = null;
    const callbacks = {
      onStageChange: (stage: StageState) =>
        setStages((prev) => prev.map((s) => (s.id === stage.id ? stage : s))),
      onEvent: (ev: ThinkingEvent) => setEvents((prev) => [...prev, ev].slice(-200)),
      // 倒计时复位放在驱动回调里（非 effect 体），重新播放后再次完成也能正确回到 3 秒。
      // 收口守卫：旧实例（restart 竞态）与暂停/接管态（真实管线 abort 收尾）不覆盖页面状态
      onDone: () => {
        if (runRef.current !== run) return;
        if (suppressDoneRef.current) return;
        setCountdown(3);
        setPhase("done");
      },
    };
    run = runOptsRef.current
      ? createPipelineRun(callbacks, runOptsRef.current)
      : createDemoRun(callbacks);
    runRef.current = run;
    setPhase("playing");
    run.start();
  }, []);

  useEffect(() => {
    // demo 态不恢复断点（断点只对真实 runId 有意义），清掉上一轮 demo 暂停留下的键；
    // 刷新恢复（03 §1.4 RunStateV1）尚未接入，刷新后重新体检，保持现状。
    if (readPausedCheckpoint()) clearCheckpoint();

    // StrictMode 双挂载安全：分支判定与 start 都放在一次性 timer 回调里
    // （双挂载时首个 timer 被清理；判定读 window/store，只能在客户端回调里做，
    //  且 setState 放在回调中避免水合不匹配与 effect 体内同步 setState）
    const timer = window.setTimeout(() => {
      // 数据来源分支（本页只替换这一段，页面组件与交互不动）：
      // 1. URL 带 ?sample=1 → 真实管线跑内置数据集（793 行内置账单，demoDatasetHash）
      // 2. pipeline store 存在 datasetTxHash → 真实管线跑本地导入账单
      // 3. 都没有 → 维持 createDemoRun 定时器播放
      const sampleRequested = new URLSearchParams(window.location.search).get("sample") === "1";
      const datasetTxHash = usePipeline.getState().datasetTxHash;
      if (sampleRequested) {
        runOptsRef.current = { source: "sample", datasetTxHash: demoDatasetHash() };
        setMode("sample");
      } else if (datasetTxHash) {
        runOptsRef.current = { source: "upload", datasetTxHash };
        setMode("upload");
      }
      startRun();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [startRun]);

  // 卸载时停掉驱动并清 jump 定时器，避免离开页面后定时器继续写状态
  useEffect(
    () => () => {
      runRef.current?.stop();
      if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current);
    },
    [],
  );

  // 演示控制台动作监听（05 §7.3 评审应急武器）：控制台 dispatchEvent 注入；
  // 本页只处理 inject-error / jump-last-stage 两个动作，其余动作由控制台自行处理
  useEffect(() => {
    const handleDemoAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === DEMO_ACTION_INJECT_ERROR) {
        // 合成错误事件：只推思考面板，不触碰运行状态（明确标注的演示动作）
        consoleEventSeqRef.current += 1;
        const syntheticError: ThinkingEvent = {
          id: `console-ev-${consoleEventSeqRef.current}`,
          kind: "tool",
          text: "这一步没跑通，已自动跳过，继续后面的检查（不影响整体结果）",
          meta: "demo-action",
          ts: Date.now(),
        };
        setEvents((prev) => [...prev, syntheticError].slice(-200));
        return;
      }
      if (action === DEMO_ACTION_JUMP_LAST_STAGE) {
        // 应急直达完成态：先停当前驱动（demo 清定时器；真实管线中止引擎），
        // 避免驱动后续阶段事件覆盖本次接管写入的状态；前五阶段置 succeeded
        // （cards 用各自当前值或 0），annual 短暂 running 后置 succeeded 进入完成态
        runRef.current?.stop();
        suppressDoneRef.current = true;
        const lastStageId = SIX_STAGES[SIX_STAGES.length - 1];
        setStages((prev) =>
          prev.map((s) =>
            s.id === lastStageId
              ? { ...s, status: "running" as const }
              : { ...s, status: "succeeded" as const, cards: s.cards || 0 },
          ),
        );
        setPausedTs(null);
        if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current);
        jumpTimerRef.current = window.setTimeout(() => {
          jumpTimerRef.current = null;
          setStages((prev) =>
            prev.map((s) => (s.id === lastStageId ? { ...s, status: "succeeded" as const } : s)),
          );
          setCountdown(3);
          setPhase("done");
        }, JUMP_ANNUAL_MS);
      }
    };
    window.addEventListener(DEMO_ACTION_EVENT, handleDemoAction);
    return () => window.removeEventListener(DEMO_ACTION_EVENT, handleDemoAction);
  }, []);

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
    // 真实分支 pause=中止引擎（runner 触发 abort 收尾，已产出卡保留），demo 只清定时器；
    // abort 收尾同样走 onDone，先置位抑制标记避免覆盖「已暂停」态
    suppressDoneRef.current = true;
    runRef.current?.pause();
    setStages((prev) =>
      prev.map((s) => (s.status === "running" ? { ...s, status: "paused" as const } : s)),
    );
    setPhase("paused");
    setPausedTs(Date.now());
  }, []);

  const resumeRun = useCallback(() => {
    // 真实分支 resume=断点重跑（runner 内部处理），放开 onDone 抑制让完成态正常收口
    suppressDoneRef.current = false;
    runRef.current?.resume();
    setPhase("playing");
    setPausedTs(null);
  }, []);

  const restartRun = useCallback(() => {
    suppressDoneRef.current = false;
    setEvents([]);
    setStages(DEMO_STAGES.map((s) => ({ ...s, status: "pending" as const })));
    setPausedTs(null);
    setDrawerStageId(null);
    // 统一入口新建驱动实例：旧实例的中止收尾经 onDone 实例一致性检查丢弃
    startRun();
  }, [startRun]);

  const currentStage = stages.find((s) => s.status === "running" || s.status === "paused");
  const currentStageName =
    currentStage?.name ?? (phase === "done" ? stages[stages.length - 1]?.name : stages[0]?.name);

  const drawerStage = drawerStageId ? (stages.find((s) => s.id === drawerStageId) ?? null) : null;
  // 只有已完成的阶段才有完整证据视图；未开始阶段点开展示空态（05 §1.4 状态覆盖）。
  // 证据源按数据来源分流：demo 分支读静态样张，真实分支读 runner 的 stage:evidence 聚合快照
  const drawerEvidence =
    drawerStage && drawerStage.status === "succeeded"
      ? mode === "demo"
        ? getDemoEvidence(drawerStage.id)
        : getRunEvidence(drawerStage.id)
      : null;

  // 数据来源徽章：sample/upload 分支换成真实口径文案，demo 分支保持现状
  const badgeText =
    mode === "sample"
      ? "内置账单 · 793 条交易"
      : mode === "upload"
        ? "本地账单 · 浏览器内计算"
        : "内置账单 · 793 条交易";

  const totalCards = stages.reduce((sum, s) => sum + (s.status === "succeeded" ? s.cards : 0), 0);

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
      {/* 页头：标题 + 阶段状态 + 数据来源/隐私徽章 */}
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
            {badgeText}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-(--color-ink-secondary)">
            <ShieldCheck className="size-3.5" aria-hidden />
            浏览器内计算
          </span>
        </div>
      </header>

      {phase === "boot" ? (
        <BootSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* 左 3：体检步骤 + 断点条 */}
          <section aria-label="体检步骤" className="lg:col-span-3">
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
              查看体检动态
              <span className="rounded-full bg-(--color-surface-2) px-2 py-0.5 text-xs tabular-nums">
                {events.length}
              </span>
            </button>
          </section>

          {/* 右 2：体检动态面板（sticky 跟随，顶部让出导航高度） */}
          <section aria-label="体检动态面板" className="hidden lg:col-span-2 lg:block">
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
                  六项检查全部完成 · 共生成 <span className="tabular-nums">{totalCards}</span>{" "}
                  条分析结果 ·{" "}
                  <span className="text-(--color-primary) tabular-nums">{countdown}</span>{" "}
                  秒后自动带你查看报告
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
