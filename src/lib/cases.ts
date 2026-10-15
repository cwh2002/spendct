/**
 * 案例库装载层（单一来源 data/cases/cases.json，04 §3.2 布局）：
 * 60 条案例的正文、来源链接与法条原文以 JSON 维护，构建脚本
 * （build-embeddings/build-vocab）与页面运行时共用同一份数据，
 * 消除 TS/JSON 双源漂移。本文件负责 zod 校验与页面消费方的稳定出口。
 */
import { z } from "zod";
import casesJson from "../../data/cases/cases.json";
import { CASE_CATEGORIES } from "@/lib/rag/types";

export interface CaseRecord {
  /** 稳定标识：category 前缀 + 序号，供收藏/埋点引用 */
  id: string;
  title: string;
  summary: string;
  /** 8 类之一，见 CATEGORY_LABELS */
  category: string;
  /** 来源名称（机构/平台/栏目），配合 sourceUrl 可核验 */
  source: string;
  /** 来源链接：官方平台规则页或机构官网 */
  sourceUrl: string;
  /** 法条/规则依据（可核验的现行有效条文） */
  legalBasis?: string;
  /** 学生权益标签（仅 student_benefits 类填写，04 §2 五枚可选值） */
  benefitTags: string[];
}

/** 案例记录 zod 校验（浏览版投影，与 JSON 字段一一对应，加载即校验） */
const CaseRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  category: z.enum(CASE_CATEGORIES),
  source: z.string().min(1),
  sourceUrl: z.string().min(1),
  legalBasis: z.string().optional(),
  benefitTags: z.array(z.string()),
});

const parsed = z
  .object({ version: z.literal(1), cases: z.array(CaseRecordSchema) })
  .parse(casesJson);

/** 8 类中文名：chips 与徽标共用，顺序即展示顺序 */
export const CATEGORY_LABELS: Record<string, string> = {
  subscription_trap: "订阅陷阱",
  prepaid_risk: "预付风险",
  minor_spending: "冲动消费",
  consumer_rights: "消费维权",
  platform_rule: "平台规则",
  regulation: "法律法规",
  spending_advice: "省钱建议",
  student_benefits: "学生权益",
};

export const CASES: CaseRecord[] = parsed.cases;
