/**
 * 六阶段枚举与状态——全仓唯一事实来源（07 契约 §1）。
 * 其余文件只 import 不复制；UI 与材料中的展示名以下表为唯一用词。
 *
 * 反思自检（reflect）不是第七阶段：它是 annual 之后的「发布前闸门」，
 * 由 src/lib/pipeline/runner.ts 在发布前调用（07 契约 §20）。
 */

export const SIX_STAGES = [
  "clean",
  "profile",
  "anomaly",
  "subscription",
  "attribution",
  "annual",
] as const;

export type StageId = (typeof SIX_STAGES)[number];

export type StageStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

export type PipelineStatus =
  | "idle"
  | "running"
  | "reflecting"
  | "completed"
  | "degraded"
  | "aborted";

/** 展示名（UI/材料唯一用词），序号从 1 开始 */
export const STAGE_DISPLAY_NAMES: Record<StageId, { name: string; subtitle: string; order: number }> = {
  clean: { name: "清洗", subtitle: "解析与清洗", order: 1 },
  profile: { name: "消费画像", subtitle: "类目·时段·渠道", order: 2 },
  anomaly: { name: "异常检测", subtitle: "冲动·退款·深夜", order: 3 },
  subscription: { name: "订阅陷阱扫描", subtitle: "扣费刺客", order: 4 },
  attribution: { name: "环比归因", subtitle: "涨跌来源", order: 5 },
  annual: { name: "年度报告", subtitle: "数据故事", order: 6 },
};
