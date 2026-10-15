/**
 * 案例嵌入离线预计算（04 §3.3）：
 * cases.json 每条案例按文档模板（title + summary + 学生权益标签中文名）拼文本，
 * bge-m3 q8 本地推理 + CLS 池化 + L2 归一化后写入 data/cases/embeddings.json，
 * 并同步 data/cases/manifest.json（casesSha256 供 CI 一致性校验）。
 * 文档模板定义在本脚本，是唯一来源；改模板 = embeddingVersion +1 全量重算（04 §3.4）。
 * 增量缓存 .embedding-cache.json（gitignore）：contentSha256 未变则复用旧向量。
 * 用法：node scripts/rag/build-embeddings.mjs [--only <caseId>]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadTsModule, ROOT } from "./ts-loader.mjs";

const { applyModelEnv, EMBEDDING_MODEL_ID } = loadTsModule(`${ROOT}/src/server/rag/model-env.ts`);

export const EMBEDDING_VERSION = "bge-m3@v1";
export const EMBEDDING_MODEL = EMBEDDING_MODEL_ID;

/** 学生权益标签 → 中文名（参与嵌入文本，见文件头模板口径） */
const BENEFIT_LABELS = {
  student_cert: "学生认证",
  edu_discount: "教育优惠",
  campus_card: "校园卡",
  budget_substitute: "免费替代",
  rights_tip: "权益提示",
};

const cachePath = join(ROOT, ".embedding-cache.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { version: EMBEDDING_VERSION, entries: {} };

const onlyId = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const cases = JSON.parse(readFileSync(join(ROOT, "data/cases/cases.json"), "utf8")).cases;
const targets = onlyId ? cases.filter((c) => c.id === onlyId) : cases;
if (targets.length === 0) {
  console.error(`未找到案例 ${onlyId}`);
  process.exit(1);
}

/** 文档嵌入文本模板（04 §3.3 收口口径，与设计态全字段模板的偏差见 docs/04 收口更新） */
function docText(c) {
  const tags = (c.benefitTags ?? []).map((t) => BENEFIT_LABELS[t] ?? "").filter(Boolean).join(" ");
  return `${c.title} ${c.summary} ${tags}`.trim();
}

const { pipeline, env } = await import("@huggingface/transformers");
applyModelEnv(env);
const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });

async function embed(text) {
  const out = await extractor(text, { pooling: "cls", normalize: true });
  return Array.from(out.data);
}

const prev = existsSync(join(ROOT, "data/cases/embeddings.json"))
  ? JSON.parse(readFileSync(join(ROOT, "data/cases/embeddings.json"), "utf8"))
  : { version: EMBEDDING_VERSION, model: EMBEDDING_MODEL, dim: 1024, normalized: true, generatedAt: "", entries: {} };
if (prev.version !== EMBEDDING_VERSION) prev.entries = {};

for (const c of targets) {
  const text = docText(c);
  const sha = createHash("sha256").update(text).digest("hex");
  if (cache.entries[c.id]?.sha === sha && Array.isArray(cache.entries[c.id]?.vec)) {
    prev.entries[c.id] = cache.entries[c.id].vec;
    console.log(`复用缓存 ${c.id}`);
    continue;
  }
  const vec = await embed(text);
  prev.entries[c.id] = vec;
  cache.entries[c.id] = { sha, vec };
  console.log(`已嵌入 ${c.id}（${vec.length} 维）`);
}

prev.generatedAt = new Date().toISOString();
writeFileSync(join(ROOT, "data/cases/embeddings.json"), JSON.stringify(prev) + "\n", "utf8");

const manifest = {
  version: 1,
  count: Object.keys(prev.entries).length,
  embeddingVersion: EMBEDDING_VERSION,
  casesSha256: createHash("sha256")
    .update(JSON.stringify(cases.map(({ id, title, summary, category, benefitTags }) => ({ id, title, summary, category, benefitTags }))))
    .digest("hex"),
  updatedAt: prev.generatedAt,
};
writeFileSync(join(ROOT, "data/cases/manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
writeFileSync(cachePath, JSON.stringify(cache) + "\n", "utf8");
console.log(`完成：${Object.keys(prev.entries).length} 条向量已写 data/cases/embeddings.json 与 manifest.json`);
