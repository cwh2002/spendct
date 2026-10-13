/**
 * 体检运行页的状态类型——本页 UI 与真实管线协议（03 §1.4 / 07 §2）之间的契约。
 * 本轮页面跑 demo 演示态，明天管线接通后只替换数据来源
 * （demo-run 事件流 → pipeline runner 事件流），组件与页面不动。
 */

export type StageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "skipped"
  | "failed"
  /** paused 是 UI 局部覆盖态（暂停），07 §1 StageStatus 枚举本身不含该值 */
  | "paused";

export interface StageState {
  /** 阶段 id，与 DEMO_STAGES / SIX_STAGES 一致：clean/profile/anomaly/subscription/attribution/annual */
  id: string;
  name: string;
  status: StageStatus;
  /** 本阶段已产出洞察卡数 */
  cards: number;
  /** 本阶段耗时（毫秒） */
  elapsedMs: number;
}

export type ThinkingEventKind =
  /** 确定性进度：真实行数 / 子任务计数，禁止伪造百分比（05 §5.1） */
  | "progress"
  /** 白名单校验通过的聚合 SQL（07 §6） */
  | "sql"
  /** stage:evidence 证据产物就绪 */
  | "evidence"
  /** RAG 命中案例 */
  | "rag"
  /** 工具调用 / 缓存命中标记 */
  | "tool"
  /** 模型流式叙事文本 */
  | "narrative"
  /** 模型降级切换（DegradeToast 触发源） */
  | "degrade";

export interface ThinkingEvent {
  id: string;
  kind: ThinkingEventKind;
  text: string;
  /** 附加信息：sqlHash / caseId 摘要 / 命中行数 / "cache" 标记等 */
  meta?: string;
  ts: number;
}

/** 阶段证据抽屉的数据视图：真实管线下由 stage:evidence 事件聚合而来 */
export interface StageEvidence {
  stageId: string;
  /** 聚合 SQL 全文（白名单校验产物，只读展示） */
  sql: string;
  /** SQL 命中行数 */
  hits: number;
  elapsedMs: number;
  /** 产出卡缩略（标题行；ok=false 表示低置信度卡，展示「待确认」标记） */
  cards: { title: string; ok: boolean }[];
}

/** 断点存储键：03 §1.4 RunStateV1 的轻量前身，真实管线接入后由 pipeline slice 接管写方 */
export const CHECKPOINT_KEY = "spendct:run:latest";

export interface PausedCheckpoint {
  paused: true;
  stage: string;
  ts: number;
}
