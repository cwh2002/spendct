/**
 * 查询侧嵌入（server-only，04 §3.5 落地）：
 * bge-m3 以 @huggingface/transformers（onnxruntime-node 后端）本地推理，
 * 运行时零嵌入 API 调用（07 §16 硬红线）。模型懒加载单例 + globalThis 缓存，
 * 首次查询有数秒加载成本（demo 走 mock/轻量模式，不进用户路径）。
 * 任何不可用场景抛 EmbedderUnavailableError，由检索层降级 TF-IDF（04 §4.8）。
 */
import { applyModelEnv, EMBEDDING_MODEL_ID } from "./model-env";

/** bge-m3 查询侧指令前缀（04 §4.4）：构建脚本与运行时必须共用同一前缀 */
export const QUERY_INSTRUCTION_PREFIX = "为这个句子生成表示以用于检索相关文章：";

/** 查询侧池化：取 [CLS] 向量（pooling:cls 时输出 [1, dim]；未池化时为 [1, seq, dim] 取首 token） */
function clsPool(output: unknown): Float32Array {
  const tensor = output as { data?: Float32Array; dims?: number[] };
  if (!tensor.dims || !tensor.data) throw new Error("嵌入输出结构不识别");
  if (tensor.dims.length === 2) {
    const dim = tensor.dims[1]!;
    return tensor.data.slice(0, dim);
  }
  if (tensor.dims.length === 3) {
    const dim = tensor.dims[2]!;
    return tensor.data.slice(0, dim);
  }
  throw new Error("嵌入输出结构不识别");
}

const globalCache = globalThis as unknown as {
  __ragEmbedPipeline?: Promise<(text: string) => Promise<Float32Array>>;
};

/** 嵌入不可用：检索层收到后降级 TF-IDF（04 §4.8 降级链第 2 档） */
export class EmbedderUnavailableError extends Error {
  constructor(reason: string) {
    super(`嵌入模型不可用：${reason}`);
    this.name = "EmbedderUnavailableError";
  }
}

/**
 * 查询文本 → 1024 维 L2 归一化向量。
 * EMBEDDING_PROVIDER=tfidf-only（公网轻量模式，07 §16）或模型加载失败时抛错。
 */
export function embedQuery(text: string): Promise<Float32Array> {
  if (!globalCache.__ragEmbedPipeline) {
    globalCache.__ragEmbedPipeline = createPipeline().catch((e) => {
      // 失败不缓存 Promise，下次调用允许重试；错误向上抛由检索层接住
      globalCache.__ragEmbedPipeline = undefined;
      throw e;
    });
  }
  return globalCache.__ragEmbedPipeline.then((fn) => fn(text));
}

async function createPipeline(): Promise<(text: string) => Promise<Float32Array>> {
  if (process.env.EMBEDDING_PROVIDER === "tfidf-only") {
    throw new EmbedderUnavailableError("EMBEDDING_PROVIDER=tfidf-only");
  }
  try {
    const { pipeline, env } = await import("@huggingface/transformers");
    applyModelEnv(env);
    const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, { dtype: "q8" });
    return async (text: string) => {
      const output = await extractor(QUERY_INSTRUCTION_PREFIX + text, {
        pooling: "cls",
        normalize: true,
      });
      return clsPool(output);
    };
  } catch (e) {
    throw new EmbedderUnavailableError(e instanceof Error ? e.message : String(e));
  }
}
