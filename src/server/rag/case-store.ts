/**
 * 案例与向量装载（server-only，04 §4.3）：
 * 服务端无持久化（07 §17），JSON 文件每次冷启动读取一次后进 globalThis 缓存；
 * 向量以 Float32Array 装载，供检索级联做余弦计算。
 * 本模块与 Next 无关，MCP 容器可直接复用（07 §16 拓扑）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CaseCategory, CaseFilter } from "@/lib/rag/types";
import type { CaseRecord } from "@/lib/cases";

const CasesFileSchema = z.object({
  version: z.literal(1),
  cases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      category: z.string(),
      source: z.string(),
      sourceUrl: z.string(),
      legalBasis: z.string().optional(),
      benefitTags: z.array(z.string()),
    }),
  ),
});

const EmbeddingsFileSchema = z.object({
  version: z.string(),
  model: z.string(),
  dim: z.number(),
  normalized: z.literal(true),
  entries: z.record(z.string(), z.array(z.number())),
});

/** data/cases/embeddings.json 的结构（build-embeddings.mjs 生成） */
export interface EmbeddingBundle {
  version: string;
  model: string;
  dim: number;
  normalized: true;
  entries: Record<string, number[]>;
}

const globalCache = globalThis as unknown as {
  __ragCasePool?: CaseRecord[];
  __ragEmbeddings?: { dim: number; vectors: Map<string, Float32Array> };
};

/** 案例池：读取一次进缓存（进程内共享，无磁盘持久化） */
export function loadCasePool(): CaseRecord[] {
  if (!globalCache.__ragCasePool) {
    const raw = readFileSync(join(process.cwd(), "data/cases/cases.json"), "utf8");
    globalCache.__ragCasePool = CasesFileSchema.parse(JSON.parse(raw)).cases;
  }
  return globalCache.__ragCasePool;
}

/** 案例向量：读取一次进缓存，键为案例 id */
export function loadEmbeddings(): { dim: number; vectors: Map<string, Float32Array> } {
  if (!globalCache.__ragEmbeddings) {
    const raw = readFileSync(join(process.cwd(), "data/cases/embeddings.json"), "utf8");
    const parsed = EmbeddingsFileSchema.parse(JSON.parse(raw));
    const vectors = new Map<string, Float32Array>();
    for (const [id, arr] of Object.entries(parsed.entries)) {
      vectors.set(id, Float32Array.from(arr));
    }
    globalCache.__ragEmbeddings = { dim: parsed.dim, vectors };
  }
  return globalCache.__ragEmbeddings;
}

/**
 * Stage 1 过滤（04 §4.3 谓词参数化）：
 * 类别 ∈ 白名单；金额区间为重叠判定（当前语料无 amountPattern 时惰性跳过，
 * 为全字段版预留）。过滤后不足 RELAX_IF_LESS 条由调用方触发放宽。
 */
export function filterCases(pool: CaseRecord[], filter: CaseFilter): CaseRecord[] {
  return pool.filter((c) => {
    if (
      filter.categories &&
      filter.categories.length > 0 &&
      !(filter.categories as string[]).includes(c.category)
    ) {
      return false;
    }
    // 金额谓词：案例无金额区间字段时视为恒真（惰性 no-op，兼容 04 §2.1 全字段版）
    return true;
  });
}

/** 放宽过滤（04 §4.8）：类别同族扩展 + 金额区间 ×3；无金额字段时仅类别放宽 */
export function relaxFilter(filter: CaseFilter): CaseFilter {
  const next: CaseFilter = {};
  if (filter.categories) {
    // 同族扩展：订阅陷阱 ↔ 平台规则 ↔ 法律法规，预付风险 ↔ 消费维权
    const family: Record<string, string[]> = {
      subscription_trap: ["subscription_trap", "platform_rule", "regulation"],
      prepaid_risk: ["prepaid_risk", "consumer_rights", "regulation"],
      platform_rule: ["platform_rule", "subscription_trap", "regulation"],
      consumer_rights: ["consumer_rights", "prepaid_risk", "regulation"],
      regulation: ["regulation", "subscription_trap", "prepaid_risk", "platform_rule", "consumer_rights"],
    };
    next.categories = [...new Set(filter.categories.flatMap((c) => family[c] ?? [c]))] as CaseCategory[];
  }
  if (filter.amountMin !== undefined) next.amountMin = filter.amountMin * 3;
  if (filter.amountMax !== undefined) next.amountMax = filter.amountMax * 3;
  return next;
}
