/**
 * 体检页 demo 演示态的播放驱动。
 * 把 DEMO_STAGES 依次点亮（每阶段 700ms：running → succeeded），
 * 并同步推送与真实管线同形状的 ThinkingEvent（确定性进度 / SQL / RAG 案例 / 叙事）。
 * 明天真实管线接入后本文件整体退役：事件由 pipeline runner 经同一回调协议下发，
 * 页面与全部子组件零改动（见 types.ts 契约注释）。
 */

import { DEMO_STAGES } from "@/lib/demo-data";
import { formatMs } from "./pipeline-stepper";
import type { StageEvidence, StageState, ThinkingEvent } from "./types";

const STAGE_MS = 700;

/** 各阶段聚合 SQL（仅作内部数据源，不在页面展示，与 03 模板库同源口径） */
const DEMO_SQL: Record<string, string> = {
  clean: `SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT trade_no) AS unique_rows,
       COUNT(*) - COUNT(DISTINCT trade_no) AS dup_rows
FROM bills_raw
WHERE ts BETWEEN '2025-10-01' AND '2026-09-30';`,
  profile: `SELECT category,
       COUNT(*) AS n,
       SUM(amount_cents) AS total_cents,
       ROUND(SUM(amount_cents) * 100.0 / SUM(SUM(amount_cents)) OVER (), 1) AS pct
FROM bills
GROUP BY category
ORDER BY total_cents DESC;`,
  anomaly: `SELECT merchant_ref,
       COUNT(*) AS hits,
       SUM(amount_cents) AS total_cents
FROM bills
WHERE EXTRACT(hour FROM ts) >= 23
   OR EXTRACT(hour FROM ts) < 5
GROUP BY merchant_ref
ORDER BY total_cents DESC;`,
  subscription: `SELECT merchant_ref, COUNT(*) AS hits,
       ROUND(AVG(amount_cents)) AS avg_cents,
       ROUND(AVG(day_gap)) AS gap_days
FROM (
  SELECT merchant_ref, ts,
         DATEDIFF('day', LAG(ts) OVER (
             PARTITION BY merchant_ref ORDER BY ts), ts) AS day_gap
  FROM bills
) t
GROUP BY merchant_ref
HAVING COUNT(*) >= 3 AND AVG(day_gap) BETWEEN 25 AND 40;`,
  attribution: `SELECT category,
       SUM(CASE WHEN month = '2026-09' THEN amount_cents END) AS cur_cents,
       SUM(CASE WHEN month = '2026-08' THEN amount_cents END) AS prev_cents
FROM bills
WHERE month IN ('2026-08', '2026-09')
GROUP BY category
ORDER BY cur_cents - prev_cents DESC;`,
  annual: `SELECT month,
       SUM(amount_cents) AS total_cents,
       COUNT(*) AS n
FROM bills
WHERE month >= '2025-10'
GROUP BY month
ORDER BY month ASC;`,
};

/** SQL 命中行数（与内置账单 793 行口径咬合） */
const DEMO_HITS: Record<string, number> = {
  clean: 793,
  profile: 793,
  anomaly: 23,
  subscription: 36,
  attribution: 12,
  annual: 12,
};

/** 产出卡缩略：标题行与 DEMO_INSIGHTS 的 headline 对齐，不足部分用确定性子任务卡补足 */
const DEMO_CARDS: Record<string, { title: string; ok: boolean }[]> = {
  clean: [
    { title: "账单整理摘要 · 793 条全部识别成功", ok: true },
    { title: "去重统计 · 移除 2 条重复记录", ok: true },
  ],
  profile: [
    { title: "餐饮是最大支出类目，占年度支出 41%", ok: true },
    { title: "类目·时段·渠道画像", ok: true },
    { title: "高频商户 Top 10", ok: true },
    { title: "渠道构成（支付宝 54% / 微信 46%）", ok: true },
  ],
  anomaly: [
    { title: "深夜消费 23 笔 · 游戏充值与直播为主", ok: true },
    { title: "疑似重复扣费 2 笔，建议核对商户订单", ok: false },
    { title: "退款异常扫描 · 未发现问题", ok: true },
  ],
  subscription: [
    { title: "发现 3 项连续订阅扣费，合计 660 元/年", ok: true },
    { title: "沉默订阅 1 项 · 近 90 天零使用", ok: true },
    { title: "周期扣费明细表（3 商户 × 36 笔）", ok: true },
    { title: "取消指引 · 来自真实案例", ok: true },
  ],
  attribution: [
    { title: "本月支出环比 +23.2%，主要来自开学季采购", ok: true },
    { title: "类目增量拆解 · 购物 +519 元（128%）", ok: true },
    { title: "一次性脉冲 vs 趋势 · 非趋势性上涨", ok: true },
  ],
  annual: [
    { title: "年度账单关键词：「食堂」与「开学季采购」", ok: true },
    { title: "月度支出趋势 · 峰值出现在 9 月", ok: true },
    { title: "堂食与食堂是你的第一消费场景", ok: true },
    { title: "订阅层悄悄吃掉 660 元/年", ok: true },
    { title: "消费在向「体验型」迁移", ok: true },
    { title: "年度海报已生成", ok: true },
  ],
};

/** RAG 命中案例（caseId 与 DEMO_INSIGHTS.citations 的 rag: 引用一致） */
const DEMO_RAG: Record<string, { caseId: string; title: string; summary: string }[]> = {
  profile: [
    {
      caseId: "rag:spending_advice_12",
      title: "食堂为主、外卖为辅怎么搭配",
      summary:
        "案例：外卖占餐饮 35% 的用户设置「外卖周预算 + 食堂优先」规则，4 周后外卖占比降到 22%，月省 60–120 元。",
    },
  ],
  subscription: [
    {
      caseId: "rag:subscription_trap_07",
      title: "连续扣费 12 个月的视频会员",
      summary:
        "案例：视频会员连续扣费 12 个月未被察觉。用户通过 App 内「订阅管理」入口 3 步完成取消，平台自动退款最近 1 期。",
    },
  ],
  annual: [
    {
      caseId: "rag:spending_advice_03",
      title: "固定成本层不超预算 10%",
      summary:
        "建议：把订阅合计并入月度预算视图，固定成本层控制在月度预算 10% 以内，避免挤占弹性消费空间。",
    },
  ],
};

/** 确定性进度文本：全部来自真实计数口径，不放伪造百分比（05 §5.1） */
const PROGRESS_TEXT: Record<string, string> = {
  clean: "已整理 793 条账单",
  profile: "已按 12 个类目汇总 · 793 条账单",
  anomaly: "已扫描 793 条账单 · 发现 6 类问题",
  subscription: "已排查 63 个商户的规律性扣费",
  attribution: "已对比 12 个类目的支出变化",
  annual: "已汇总 12 个月账单 · 年度总结生成中",
};

/** 各步骤跑完后的结论式说明（页面不再展示 SQL 原文，只给一句人话结论） */
const DEMO_SQL_NOTES: Record<string, string> = {
  clean: "已整理账单并去重，共核对 793 条记录",
  profile: "已按类别汇总账单，共核对 793 条记录",
  anomaly: "已排查深夜消费与退款异常，查出 23 个疑点",
  subscription: "已排查规律性连续扣费，查出 36 笔可疑扣费",
  attribution: "已对比本月与上月支出，拆解 12 项变化",
  annual: "已汇总全年账单走势，共 12 个月",
};

/** 流式叙事文本（demo 为整段下发，打字机逐字揭示；真实管线为逐 token 增长） */
const NARRATIVES: Record<string, string> = {
  clean: "整理完成：793 条账单全部识别成功，自动去重移除 2 条重复记录。",
  profile: "你的消费画像成型：餐饮是最大支出类目，占年度支出 41%，其中堂食与食堂占 78%、外卖 22%。",
  anomaly: "发现 23 笔深夜消费，其中游戏充值与直播打赏占 84%，建议设置夜间支付冷静期。",
  subscription: "发现 3 项连续订阅扣费，年化合计 660 元，其中 1 项近 90 天完全没用过，属于典型的沉默订阅。",
  attribution: "本月支出环比 +23.2%，购物类贡献增量的 128%，3 笔大额订单集中在开学季。",
  annual: "年度叙事完成：食堂与外卖构成日常基本盘，订阅构成固定成本层，建议把两者纳入统一预算视图。",
};

/** 事件下发与阶段切换的回调协议：与真实管线 runner 保持一致 */
export interface DemoRunCallbacks {
  onStageChange: (stage: StageState) => void;
  onEvent: (event: ThinkingEvent) => void;
  onDone: () => void;
}

export interface DemoRun {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

/**
 * 创建 demo 播放驱动。pause 只取消挂起的定时器；
 * 当前阶段的 paused 状态覆盖由页面负责（与真实管线 UI 覆盖逻辑同层）。
 */
export function createDemoRun(cb: DemoRunCallbacks): DemoRun {
  let timers: number[] = [];
  let stageIndex = 0;
  let evSeq = 0;
  let running = false;

  const clearTimers = () => {
    for (const t of timers) window.clearTimeout(t);
    timers = [];
  };

  const push = (kind: ThinkingEvent["kind"], text: string, meta?: string) => {
    evSeq += 1;
    cb.onEvent({ id: `demo-ev-${evSeq}`, kind, text, meta, ts: Date.now() });
  };

  const playStage = (i: number) => {
    const demo = DEMO_STAGES[i];
    if (!demo) {
      running = false;
      cb.onDone();
      return;
    }
    cb.onStageChange({ id: demo.id, name: demo.name, status: "running", cards: 0, elapsedMs: 0 });

    const at = (delay: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, delay));
    };

    at(0, () => push("progress", PROGRESS_TEXT[demo.id] ?? ""));
    // 缓存命中标记：重复体检命中 stageCacheKey 秒出（07 §10），meta="cache" 驱动 ⚡ 渲染
    at(60, () => push("progress", "上次的检查结果直接复用 · 秒开", "cache"));
    at(150, () => push("sql", DEMO_SQL_NOTES[demo.id] ?? "", `sql:${demo.id}_summary`));
    // 异常检测阶段演示一次服务降级，展示 DegradeToast 能力（评审演示点）
    if (demo.id === "anomaly") {
      at(220, () => push("degrade", "主服务有点慢，已自动切换备用服务继续，结果不受影响"));
    }
    const rags = DEMO_RAG[demo.id] ?? [];
    rags.forEach((r, idx) => {
      at(280 + idx * 90, () => push("rag", `找到相似案例：${r.title}`, r.summary));
    });
    at(430, () =>
      push(
        "evidence",
        `已核对 ${DEMO_HITS[demo.id]!.toLocaleString("zh-CN")} 条记录 · 用时 ${formatMs(demo.elapsedMs)}`,
        String(DEMO_HITS[demo.id]),
      ),
    );
    at(520, () => push("narrative", NARRATIVES[demo.id] ?? ""));
    at(STAGE_MS, () => {
      cb.onStageChange({
        id: demo.id,
        name: demo.name,
        status: "succeeded",
        cards: demo.cards,
        elapsedMs: demo.elapsedMs,
      });
      stageIndex += 1;
      playStage(stageIndex);
    });
  };

  return {
    start() {
      clearTimers();
      stageIndex = 0;
      running = true;
      playStage(0);
    },
    pause() {
      if (!running) return;
      clearTimers();
      running = false;
    },
    resume() {
      if (running) return;
      running = true;
      playStage(stageIndex);
    },
    stop() {
      clearTimers();
      running = false;
    },
  };
}

/** 阶段证据抽屉的数据源（demo 态）；真实管线替换为 stage:evidence 事件聚合 */
export function getDemoEvidence(stageId: string): StageEvidence | null {
  const demo = DEMO_STAGES.find((s) => s.id === stageId);
  const sql = DEMO_SQL[stageId];
  if (!demo || !sql) return null;
  return {
    stageId,
    sql,
    hits: DEMO_HITS[stageId] ?? 0,
    elapsedMs: demo.elapsedMs,
    cards: DEMO_CARDS[stageId] ?? [],
  };
}
