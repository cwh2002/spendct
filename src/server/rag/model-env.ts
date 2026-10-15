/**
 * transformers.js 模型环境统一配置（04 §3.5 单一来源）：
 * 下载脚本（scripts/rag/download-models.mjs）与运行时（embedder/rerank）共用，
 * 保证缓存目录、本地模型路径、远端地址三处永远一致。
 *
 * 注意：@huggingface/transformers v4 的 env 不读取 HF_ENDPOINT 环境变量，
 * 必须显式写入 env.remoteHost。国内网络设 HF_ENDPOINT=https://hf-mirror.com
 * （镜像路径与 huggingface.co 1:1 对应，无需改 remotePathTemplate）。
 */
import { join } from "node:path";

/**
 * 模型仓库单一来源（04 §3.5 收口）：使用 Xenova 转换仓——
 * BAAI 原仓只有 fp32 ONNX（2.3GB 外部数据），无 q8 量化文件；
 * Xenova/* 是 transformers.js 官方转换的同一权重，含 model_quantized.onnx。
 * 下载脚本与运行时共用这两个 ID，保证产物一致性。
 */
export const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL?.trim() || "Xenova/bge-m3";
export const RERANK_MODEL_ID = process.env.RERANK_MODEL?.trim() || "Xenova/bge-reranker-base";

/** transformers env 中本模块负责的字段（与运行时 env 类型对齐，v4 这些字段均可空） */
export interface ModelEnvConfig {
  cacheDir: string | null;
  localModelPath: string | null;
  allowRemoteModels: boolean;
  remoteHost: string | null;
}

/** 模型根目录与远端地址的单一来源，勿在别处重复计算 */
export function resolveModelEnv(): { modelPath: string; remoteHost: string } {
  return {
    modelPath: process.env.EMBEDDING_MODEL_PATH?.trim() || join(process.cwd(), "models"),
    remoteHost: process.env.HF_ENDPOINT?.trim() || "https://huggingface.co",
  };
}

/** 把统一配置写入 transformers env，返回模型根目录 */
export function applyModelEnv(env: ModelEnvConfig): string {
  const { modelPath, remoteHost } = resolveModelEnv();
  env.cacheDir = join(modelPath, "cache");
  env.localModelPath = join(modelPath, "local");
  env.allowRemoteModels = true;
  env.remoteHost = remoteHost;
  return modelPath;
}
