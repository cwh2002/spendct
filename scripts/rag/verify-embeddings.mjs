/**
 * 嵌入产物一致性校验（04 §3.3 检查项 1-4，CI 用）：
 * ① embeddings.version === manifest.embeddingVersion === 金标查询嵌入 version；
 * ② 向量键集合与 cases.json 的 id 集合一致（60 条）；
 * ③ 每条向量 dim=1024 且 ‖v‖−1 < 1e-4（L2 归一化成立）；
 * ④ manifest.casesSha256 与 cases.json 当前内容哈希一致（正文改动必须重算）。
 * 任一失败 exit 1。
 * 用法：node scripts/rag/verify-embeddings.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROOT } from "./ts-loader.mjs";

const cases = JSON.parse(readFileSync(join(ROOT, "data/cases/cases.json"), "utf8")).cases;
const embeddings = JSON.parse(readFileSync(join(ROOT, "data/cases/embeddings.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "data/cases/manifest.json"), "utf8"));
const goldenQ = JSON.parse(readFileSync(join(ROOT, "tests/golden/golden-query-embeddings.json"), "utf8"));
const goldenQStudent = JSON.parse(readFileSync(join(ROOT, "tests/golden/golden-query-embeddings-student.json"), "utf8"));

let failed = 0;
const check = (cond, msg) => {
  if (!cond) {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
};

// ① 版本三处一致
check(
  embeddings.version === manifest.embeddingVersion &&
    goldenQ.version === manifest.embeddingVersion &&
    goldenQStudent.version === manifest.embeddingVersion,
  `版本不一致：embeddings=${embeddings.version} manifest=${manifest.embeddingVersion} golden=${goldenQ.version}/${goldenQStudent.version}`,
);

// ② 键集合一致
const caseIds = new Set(cases.map((c) => c.id));
const entryIds = Object.keys(embeddings.entries);
check(entryIds.length === 60, `向量条数=${entryIds.length}（期望 60）`);
check(
  entryIds.length === caseIds.size && entryIds.every((id) => caseIds.has(id)),
  "向量键集合与 cases.json 不一致",
);

// ③ 维度与归一化
let dimOk = true;
let normOk = true;
for (const [id, vec] of Object.entries(embeddings.entries)) {
  if (vec.length !== 1024) dimOk = false;
  let norm = 0;
  for (const v of vec) norm += v * v;
  if (Math.abs(Math.sqrt(norm) - 1) >= 1e-4) normOk = false;
}
check(dimOk, "存在维度不为 1024 的向量");
check(normOk, "存在未归一化的向量（‖v‖−1 ≥ 1e-4）");

// ④ 哈希一致
const hash = createHash("sha256")
  .update(JSON.stringify(cases.map(({ id, title, summary, category, benefitTags }) => ({ id, title, summary, category, benefitTags }))))
  .digest("hex");
check(hash === manifest.casesSha256, "cases.json 内容与 manifest.casesSha256 不一致（需重跑 build-embeddings）");

console.log(failed === 0 ? "嵌入产物校验通过" : `失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
