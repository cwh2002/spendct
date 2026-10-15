/**
 * 重排（server-only，04 §4.5 落地）：
 * bge-reranker-base（int8）对 dense 候选做交叉编码打分，输出 logits 降序。
 * 模型缺失/推理失败抛 RerankerUnavailableError，检索层跳过重排用 dense 直排（04 §4.8）。
 */
import { applyModelEnv, RERANK_MODEL_ID } from "./model-env";

export const RERANK_DOC_MAX_CHARS = 512;

const globalCache = globalThis as unknown as {
  __ragRerankPipeline?: Promise<(query: string, docs: string[]) => Promise<number[]>>;
};

/** 重排不可用：检索层跳过重排，dense 分数直排（04 §4.8 降级链第 3 档） */
export class RerankerUnavailableError extends Error {
  constructor(reason: string) {
    super(`重排模型不可用：${reason}`);
    this.name = "RerankerUnavailableError";
  }
}

/** 文档文本截断（title + summary 拼接待打分文本，避免超长输入） */
export function rerankDocText(title: string, summary: string): string {
  const text = `${title} ${summary}`;
  return text.length > RERANK_DOC_MAX_CHARS ? text.slice(0, RERANK_DOC_MAX_CHARS) : text;
}

/** 查询 + 文档列表 → 对应 logits 分数（与文档顺序一致） */
export function rerank(query: string, docs: Array<{ id: string; text: string }>): Promise<Array<{ id: string; score: number }>> {
  if (!globalCache.__ragRerankPipeline) {
    globalCache.__ragRerankPipeline = createPipeline().catch((e) => {
      globalCache.__ragRerankPipeline = undefined;
      throw e;
    });
  }
  return globalCache.__ragRerankPipeline.then((fn) =>
    fn(query, docs.map((d) => d.text)).then((scores) =>
      docs.map((d, i) => ({ id: d.id, score: scores[i] ?? 0 })),
    ),
  );
}

async function createPipeline(): Promise<(query: string, docs: string[]) => Promise<number[]>> {
  if (process.env.EMBEDDING_PROVIDER === "tfidf-only") {
    throw new RerankerUnavailableError("EMBEDDING_PROVIDER=tfidf-only");
  }
  try {
    const { pipeline, env } = await import("@huggingface/transformers");
    applyModelEnv(env);
    // bge-reranker 为单标签序列分类模型。v4 的 text-classification 管道把输入
    // 原样交给分词器、不再拆解 [query, doc] 文本对，且单标签 softmax 恒为 1、
    // 无法作排序分；这里借管道完成模型加载，直接按批量 text/text_pair 编码并
    // 直推模型，取每对 logits[0] 作排序分（阈值口径 RERANK_MIN_SCORE 见 04 §4.1）
    const classifier = await pipeline("text-classification", RERANK_MODEL_ID, {
      dtype: "q8",
    });
    return async (query: string, docs: string[]) => {
      if (docs.length === 0) return [];
      // 批量编码：text 为 query 重复 N 次、text_pair 为 N 条文档，
      // 分词器按对拼接 [CLS] query [SEP] doc [SEP] 并统一 padding/truncation
      const modelInputs = classifier.tokenizer(
        docs.map(() => query),
        { text_pair: docs, padding: true, truncation: true },
      );
      const outputs = await classifier.model(modelInputs);
      if (!outputs.logits) {
        throw new RerankerUnavailableError("模型未输出 logits");
      }
      // logits 形状 [N, 1]，逐行取单标签原始分数
      const logits = outputs.logits.tolist() as Array<Array<number>>;
      return logits.map((row) => row[0] ?? 0);
    };
  } catch (e) {
    throw new RerankerUnavailableError(e instanceof Error ? e.message : String(e));
  }
}
