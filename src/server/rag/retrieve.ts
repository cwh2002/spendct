/**
 * 服务端检索级联（04 §4.7 骨架落地，与 Next 无关的纯 node 模块——
 * MCP 容器可直接挂为 GET /retrieve，07 §16 拓扑）：
 * Stage 1 过滤（不足则放宽）→ Stage 2 dense 余弦 top-30（嵌入不可用降 TF-IDF top-20）
 * → Stage 3 bge-reranker 重排 top-5（不可用则 dense 直排）
 * → Stage 4 分数 ≥ RERANK_MIN_SCORE 且 ≤ RAG_TOP_K_CITE 条（宁缺毋滥，04 §4.6）。
 * 查询文本不落盘、不记日志（02 §1.2 / 07 §17）。
 */
import tfidfManifest from "@/data/tfidf-manifest.json";
import {
  RAG_TOP_K_CITE,
  RAG_TOP_K_RECALL,
  RELAX_IF_LESS,
  RERANK_MIN_SCORE,
  TFIDF_CITE_MIN,
  TFIDF_FALLBACK_K,
  type CaseFilter,
  type RetrievedCase,
} from "@/lib/rag/types";
import { tfidfSearch, type TfidfManifest } from "@/lib/rag/tfidf";
import { filterCases, loadCasePool, loadEmbeddings, relaxFilter } from "./case-store";
import { embedQuery, EmbedderUnavailableError } from "./embedder";
import { rerank, RerankerUnavailableError, rerankDocText } from "./rerank";

export interface RetrieveResult {
  cases: RetrievedCase[];
  provider: "dense+rerank" | "dense" | "tfidf";
  latencyMs: number;
}

export interface RetrieveOpts {
  /** 最终引用条数上限（缺省 RAG_TOP_K_CITE=3） */
  topK?: number;
  /** 强制走 TF-IDF 兜底（演示 mock 模式 / 公网轻量口径，07 §16） */
  forceTfidf?: boolean;
  /** 跳过重排（评测 --mode dense-only 用；线上不传） */
  skipRerank?: boolean;
}

/** 摘要命中片段：取第一个领域词命中位置前后各 30 字，无命中取摘要开头 */
function snippetOf(summary: string): string {
  const window = 60;
  if (summary.length <= window) return summary;
  return `${summary.slice(0, window)}…`;
}

/** dense 余弦（向量均已 L2 归一化，点积即余弦） */
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Stage 2 兜底：TF-IDF 检索 + 最低分阈值（04 §4.8 第 2 档） */
function tfidfFallback(query: string, pool: ReturnType<typeof filterCases>): RetrievedCase[] {
  return tfidfSearch(query, pool, tfidfManifest as TfidfManifest, TFIDF_FALLBACK_K)
    .filter((r) => r.score >= TFIDF_CITE_MIN)
    .map((r) => ({
      caseId: r.case.id,
      title: r.case.title,
      category: r.case.category as RetrievedCase["category"],
      score: r.score,
      stage: "tfidf" as const,
      snippet: snippetOf(r.case.summary),
    }));
}

/** Stage 2 dense：查询向量与候选向量余弦，取 top-N */
function denseRecall(query: string, candidates: { id: string; title: string; summary: string; category: string }[]): Promise<Array<{ id: string; title: string; summary: string; category: string; score: number }>> {
  return embedQuery(query).then((qvec) => {
    const { vectors } = loadEmbeddings();
    return candidates
      .map((c) => {
        const v = vectors.get(c.id);
        return v ? { ...c, score: dot(qvec, v) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, RAG_TOP_K_RECALL);
  });
}

/**
 * 检索入口：返回最终引用与本次实际走的供应档位。
 * opts.forceTfidf 由调用方按运行模式（mock/公网）决定。
 */
export async function retrieveCases(query: string, filter: CaseFilter, opts: RetrieveOpts = {}): Promise<RetrieveResult> {
  const started = Date.now();
  const topK = opts.topK ?? RAG_TOP_K_CITE;
  const pool = loadCasePool();

  // Stage 1：过滤，不足 RELAX_IF_LESS 条时放宽一次（04 §4.8）
  let candidates = filterCases(pool, filter);
  if (candidates.length < RELAX_IF_LESS && (filter.categories || filter.amountMin !== undefined)) {
    candidates = filterCases(pool, relaxFilter(filter));
  }

  // 强制兜底：直接走 TF-IDF（mock 演示 / 公网轻量模式）
  if (opts.forceTfidf) {
    return {
      cases: tfidfFallback(query, candidates).slice(0, topK),
      provider: "tfidf",
      latencyMs: Date.now() - started,
    };
  }

  // Stage 2：dense 余弦；嵌入不可用 → TF-IDF 兜底
  let recalled: Array<{ id: string; title: string; summary: string; category: string; score: number }>;
  try {
    recalled = await denseRecall(query, candidates);
  } catch (e) {
    if (e instanceof EmbedderUnavailableError) {
      return {
        cases: tfidfFallback(query, candidates).slice(0, topK),
        provider: "tfidf",
        latencyMs: Date.now() - started,
      };
    }
    throw e;
  }
  if (recalled.length === 0) {
    return { cases: [], provider: "dense", latencyMs: Date.now() - started };
  }

  // Stage 3：重排；不可用（或评测显式跳过）→ dense 直排（04 §4.8 第 3 档）
  let ranked: Array<{
    id: string;
    title: string;
    summary: string;
    category: string;
    score: number;
    stage: "dense" | "rerank";
  }> = recalled.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    category: r.category,
    score: r.score,
    stage: "dense",
  }));
  let provider: RetrieveResult["provider"] = "dense";
  if (!opts.skipRerank) {
    try {
      const reranked = await rerank(query, recalled.map((r) => ({ id: r.id, text: rerankDocText(r.title, r.summary) })));
      const scoreById = new Map(reranked.map((x) => [x.id, x.score]));
      ranked = ranked
        .map((r) => ({ ...r, score: scoreById.get(r.id) ?? r.score, stage: "rerank" as const }))
        .sort((a, b) => b.score - a.score);
      provider = "dense+rerank";
    } catch (e) {
      if (!(e instanceof RerankerUnavailableError)) throw e;
    }
  }

  // Stage 4：阈值截断（宁缺毋滥）
  const cases = ranked
    .filter((r) => r.score >= RERANK_MIN_SCORE)
    .slice(0, topK)
    .map((r) => ({
      caseId: r.id,
      title: r.title,
      category: r.category as RetrievedCase["category"],
      score: r.score,
      stage: r.stage,
      snippet: snippetOf(r.summary),
    }));
  return { cases, provider, latencyMs: Date.now() - started };
}
