/**
 * 金标查询嵌入离线预计算（04 §5.2/D4）：
 * 用运行时同款 embedQuery（经 ts-loader 转译 src/server/rag/embedder.ts，单一来源——
 * 同一指令前缀、同一池化、同一归一化）对主集 20 题与学生集 8 题生成查询向量，
 * 产物进仓库，评测零推理零网络可进 CI。
 * 用法：node scripts/rag/build-golden-embeddings.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTsModule, ROOT } from "./ts-loader.mjs";

const { embedQuery } = loadTsModule(join(ROOT, "src/server/rag/embedder.ts"));
const { EMBEDDING_MODEL_ID } = loadTsModule(join(ROOT, "src/server/rag/model-env.ts"));
const EMBEDDING_VERSION = "bge-m3@v1";

async function build(setFile, outFile) {
  const golden = JSON.parse(readFileSync(join(ROOT, "tests/golden", setFile), "utf8"));
  const entries = {};
  for (const q of golden.queries) {
    const vec = await embedQuery(q.query);
    entries[q.gid] = Array.from(vec);
    console.log(`已嵌入 ${q.gid}`);
  }
  writeFileSync(
    join(ROOT, "tests/golden", outFile),
    JSON.stringify({ version: EMBEDDING_VERSION, model: EMBEDDING_MODEL_ID, entries }) + "\n",
    "utf8",
  );
  console.log(`已写 tests/golden/${outFile}（${Object.keys(entries).length} 条）`);
}

await build("rag-golden.json", "golden-query-embeddings.json");
await build("rag-golden-student.json", "golden-query-embeddings-student.json");
