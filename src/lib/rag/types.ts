/**
 * 检索域契约唯一来源（04 §1.3 落地版）：类别枚举、过滤条件、
 * 检索结果与级联参数常量。浏览器（TF-IDF 侧）与服务端（dense 侧）共用，
 * 不含任何 server-only 导入。
 */
import { z } from "zod";

/** 案例库 8 类（与 CATEGORY_LABELS 键一一对应，顺序即展示顺序） */
export const CASE_CATEGORIES = [
  "subscription_trap",
  "prepaid_risk",
  "minor_spending",
  "consumer_rights",
  "platform_rule",
  "regulation",
  "spending_advice",
  "student_benefits",
] as const;

export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const CaseCategorySchema = z.enum(CASE_CATEGORIES);

/** 检索过滤条件：类别白名单 + 金额区间（金额谓词当前语料无 amountPattern，预留） */
export const CaseFilterSchema = z.object({
  categories: z.array(CaseCategorySchema).optional(),
  amountMin: z.number().nonnegative().optional(),
  amountMax: z.number().nonnegative().optional(),
});

export type CaseFilter = z.infer<typeof CaseFilterSchema>;

/** 单条检索结果：stage 标明出自哪一级（重排/稠密/词频兜底），snippet 为摘要命中片段 */
export interface RetrievedCase {
  caseId: string;
  title: string;
  category: CaseCategory;
  score: number;
  stage: "rerank" | "dense" | "tfidf";
  snippet: string;
}

/** 级联参数（04 §4.1 参数表，env 可覆盖）：默认值即文档权威口径 */
export const RAG_TOP_K_RECALL = 30; // dense 召回条数
export const RAG_TOP_K_CITE = 3; // 最终引用条数上限（宁缺毋滥）
export const RERANK_MIN_SCORE = -2.0; // rerank logits 引用阈值
export const RELAX_IF_LESS = 5; // 过滤后不足此数则放宽类别/金额
export const TFIDF_FALLBACK_K = 20; // TF-IDF 兜底候选条数
export const TFIDF_CITE_MIN = 0.08; // TF-IDF 引用最低余弦分（初值，可由评测校准）

/** 检索供应模式：dense 走本地模型级联，tfidf 纯词频兜底（演示/公网口径） */
export type RagProvider = "dense" | "tfidf";
