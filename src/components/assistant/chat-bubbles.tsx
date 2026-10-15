"use client";

/**
 * 问答气泡列表（追问面板与智能助理共用的展示层，08 修订案 A12）。
 *
 * 只做渲染：把 use-chat-pipeline 的 ChatTurn 序列画成对话气泡，
 * 并挂四类脚注/附件（数据口径声明，均非模型文本）：
 *   - note=local：本地引擎按账单数据计算（「已按你的账单数据计算」）；
 *   - note=cases：本地案例库检索命中（零 API 调用）；
 *   - note=live：在线服务生成（按 sentStats/sentDetails 组合标注
 *     实际发送的账单数据段，A8 合称「已发送明细与统计」）；
 *   - note=deep：深度分析（A14，组合标注同 live，合称「已发送账单统计与明细」）；
 *   - guarded：输入被闸门拦截（未进入任何模型）；
 *   - plan：在线回答前的思考计划清单（plan 事件）；
 *   - ragRefs：案例参考（检索响应）；toolBadges：工具徽章三态。
 * 样式与追问面板原实现逐类对齐，两处共用同一份气泡口径。
 */
import { BookOpen, CircleAlert, CircleCheck, Lightbulb, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";

import type { ChatTurn } from "@/lib/assistant/use-chat-pipeline";

/** 思考态文案（data/cases/live 三态，与两个面板共用） */
export const THINKING_TEXT: Record<"data" | "cases" | "live", string> = {
  data: "正在读取你的账单数据…",
  cases: "正在检索本地案例库…",
  live: "正在连接在线服务生成回答…",
};

/** 思考中的三点跳动气泡 */
export function ThinkingBubbles({ state }: { state: "data" | "cases" | "live" }) {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="正在生成回答">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-(--color-surface-2) px-3.5 py-3">
        <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted)" />
        <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted) [animation-delay:120ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-(--color-ink-muted) [animation-delay:240ms]" />
        <span className="ml-1.5 text-xs text-(--color-ink-muted)">{THINKING_TEXT[state]}</span>
      </div>
    </div>
  );
}

/**
 * 在线回答实际发送的账单数据段文案：统计与明细按各自查询结果条件发送，
 * 脚注按组合如实标注——两者都发用各档的既有合称（live 沿用 A8 口径
 * 「已发送明细与统计」，deep 用「已发送账单统计与明细」），缺一段就只
 * 说发了的那段（单段文案两档一致）
 */
function sentPartsLabel(turn: ChatTurn, bothText: string): string {
  if (turn.sentStats && turn.sentDetails) return bothText;
  if (turn.sentStats) return "已发送账单统计";
  if (turn.sentDetails) return "已发送账单明细";
  return "已生成回答";
}

/** 回答来源脚注（local/cases/live/deep 四态 + 拦截态） */
function AnswerFootnote({ turn }: { turn: ChatTurn }) {
  if (turn.guarded) {
    return (
      <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) border border-(--color-warn)/40 bg-(--color-warn-soft)/60 px-2 py-1 text-[11px] leading-relaxed text-(--color-warning-ink)">
        <ShieldCheck className="size-3 shrink-0" aria-hidden />
        已拦截 · 未进入任何模型
      </span>
    );
  }
  if (turn.note === "local") {
    return (
      <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[11px] leading-relaxed text-(--color-ink-muted)">
        <CircleCheck className="size-3 shrink-0 text-(--color-good-ink)" aria-hidden />
        已按你的账单数据计算
      </span>
    );
  }
  if (turn.note === "cases") {
    return (
      <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[11px] leading-relaxed text-(--color-ink-muted)">
        <BookOpen className="size-3 shrink-0 text-(--color-ink-muted)" aria-hidden />
        本地案例库 · 零 API 调用
      </span>
    );
  }
  if (turn.note === "live") {
    return (
      <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) bg-(--color-primary-soft) px-2 py-1 text-[11px] leading-relaxed text-(--color-brand-600)">
        <Sparkles className="size-3 shrink-0" aria-hidden />
        在线生成 · {sentPartsLabel(turn, "已发送明细与统计")}
      </span>
    );
  }
  if (turn.note === "deep") {
    return (
      <span className="mt-2 flex w-fit items-center gap-1.5 rounded-(--radius-sm) bg-(--color-primary-soft) px-2 py-1 text-[11px] leading-relaxed text-(--color-brand-600)">
        <Sparkles className="size-3 shrink-0" aria-hidden />
        深度分析 · {sentPartsLabel(turn, "已发送账单统计与明细")}
      </span>
    );
  }
  return null;
}

/** 思考计划清单（plan 事件，A12）：回答气泡上方的折叠块 */
function PlanBlock({ turn }: { turn: ChatTurn }) {
  if (!turn.plan || turn.plan.steps.length === 0) return null;
  return (
    <div className="mt-2 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-(--color-ink-secondary)">
        <Lightbulb className="size-3 shrink-0 text-(--color-primary)" aria-hidden />
        思考计划
      </p>
      <ol className="mt-1.5 space-y-1">
        {turn.plan.steps.map((step, index) => (
          <li key={`${step.title}-${index}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-(--color-ink-muted)">
            <span className="mt-px shrink-0 tabular-nums text-(--color-ink-muted)">{index + 1}.</span>
            <span>{step.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 案例参考列表（检索响应，非模型生成文本） */
function CaseRefs({ turn }: { turn: ChatTurn }) {
  if (!turn.ragRefs || turn.ragRefs.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {turn.ragRefs.map((c) => (
        <p
          key={c.caseId}
          className="flex items-start gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[11px] leading-relaxed text-(--color-ink-muted)"
        >
          <BookOpen className="mt-0.5 size-3 shrink-0 text-(--color-ink-muted)" aria-hidden />
          <span>
            案例参考 · <span className="font-medium text-(--color-ink-secondary)">{c.title}</span>
            <span className="text-(--color-ink-muted)">：{c.snippet}</span>
          </span>
        </p>
      ))}
    </div>
  );
}

/** 工具徽章列表（tool:start/tool:end 事件三态） */
function ToolBadges({ turn }: { turn: ChatTurn }) {
  if (!turn.toolBadges || turn.toolBadges.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {turn.toolBadges.map((badge) => (
        <span
          key={badge.id}
          title={badge.argsDigest}
          className={`inline-flex items-center gap-1 rounded-(--radius-sm) border px-2 py-1 text-[11px] leading-relaxed ${
            badge.ok === undefined
              ? "border-(--color-border) bg-(--color-surface) text-(--color-ink-muted)"
              : badge.ok
                ? "border-(--color-good)/20 bg-(--color-good)/10 text-(--color-good-ink)"
                : "border-(--color-warn)/40 bg-(--color-warn-soft)/60 text-(--color-warning-ink)"
          }`}
        >
          {badge.ok === undefined ? (
            <LoaderCircle className="size-3 shrink-0 animate-spin text-(--color-ink-muted)" aria-hidden />
          ) : badge.ok ? (
            <CircleCheck className="size-3 shrink-0" aria-hidden />
          ) : (
            <CircleAlert className="size-3 shrink-0" aria-hidden />
          )}
          <span>{badge.label}</span>
          {badge.ok === undefined ? (
            <span className="text-(--color-ink-muted)">调用中…</span>
          ) : badge.ok ? (
            badge.ms !== undefined ? <span className="tabular-nums">· {badge.ms}ms</span> : null
          ) : (
            <span>· 调用失败</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** 单轮气泡：用户右、助理左；助理气泡内挂脚注/计划/案例/徽章 */
function TurnBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          turn.role === "user"
            ? "rounded-br-sm bg-(--color-primary) text-white"
            : "rounded-bl-sm bg-(--color-surface-2) text-(--color-ink)"
        }`}
      >
        {turn.text}
        <AnswerFootnote turn={turn} />
        <PlanBlock turn={turn} />
        <CaseRefs turn={turn} />
        <ToolBadges turn={turn} />
      </div>
    </div>
  );
}

/** 气泡列表：按轮次渲染全部对话（含思考态占位由调用方自行拼接） */
export function ChatBubbles({ turns }: { turns: ChatTurn[] }) {
  return (
    <>
      {turns.map((turn) => (
        <TurnBubble key={turn.id} turn={turn} />
      ))}
    </>
  );
}
