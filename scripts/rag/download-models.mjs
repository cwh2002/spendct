/**
 * 模型预热下载（04 §3.2/§3.5）：
 * 实例化 bge-m3（q8 特征提取）与 bge-reranker-base（q8 文本分类）两个管道后退出，
 * 把全部 ONNX 权重拉到本地缓存（models/ 或 EMBEDDING_MODEL_PATH 指定目录，已 gitignore）。
 * 远端地址与运行时共用 model-env.ts 的单一来源；国内网络设
 * HF_ENDPOINT=https://hf-mirror.com（transformers v4 不读该变量本身，由 applyModelEnv 显式写入）。
 * 用法：node scripts/rag/download-models.mjs
 */
import { loadTsModule, ROOT } from "./ts-loader.mjs";

const { applyModelEnv, EMBEDDING_MODEL_ID, RERANK_MODEL_ID } = loadTsModule(`${ROOT}/src/server/rag/model-env.ts`);
const { pipeline, env } = await import("@huggingface/transformers");
const modelPath = applyModelEnv(env);

console.log(`下载/校验 ${EMBEDDING_MODEL_ID} q8（约 570MB）……`);
await pipeline("feature-extraction", EMBEDDING_MODEL_ID, { dtype: "q8" });
console.log("bge-m3 就绪");
console.log(`下载/校验 ${RERANK_MODEL_ID} q8（约 280MB）……`);
await pipeline("text-classification", RERANK_MODEL_ID, { dtype: "q8" });
console.log("bge-reranker-base 就绪，全部模型已落到", modelPath);
