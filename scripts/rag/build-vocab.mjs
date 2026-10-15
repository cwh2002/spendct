/**
 * TF-IDF 词表/IDF/文档向量预计算（04 §6.2）：
 * 语料 = 案例库正文（title + summary）+ 金标主集/学生集 query 文本，
 * 用运行时同款 tokenize（经 ts-loader 转译 src/lib/rag/tfidf.ts，单一来源）分词；
 * df≥2 的 token 进词表，IDF 取平滑对数，文档向量按 tf×idf 后 L2 归一化。
 * 产物：src/data/tfidf-manifest.json（浏览器打包引入，离线可用）。
 * 用法：node scripts/rag/build-vocab.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTsModule, ROOT } from "./ts-loader.mjs";

const { tokenize, toSparse } = loadTsModule(join(ROOT, "src/lib/rag/tfidf.ts"));

const cases = JSON.parse(readFileSync(join(ROOT, "data/cases/cases.json"), "utf8")).cases;
const goldenMain = JSON.parse(readFileSync(join(ROOT, "tests/golden/rag-golden.json"), "utf8"));
const goldenStudent = JSON.parse(readFileSync(join(ROOT, "tests/golden/rag-golden-student.json"), "utf8"));

const docTexts = cases.map((c) => `${c.title} ${c.summary}`);
const queryTexts = [...goldenMain.queries, ...goldenStudent.queries].map((q) => q.query);
const allTexts = [...docTexts, ...queryTexts];

// 文档频率（一个 token 在一篇文档中出现即计一次）
const df = new Map();
for (const text of allTexts) {
  const unique = new Set(tokenize(text));
  for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
}

const N = allTexts.length;
const vocab = [...df.entries()].filter(([, d]) => d >= 2).map(([t]) => t).sort();
const idf = vocab.map((t) => Math.log((1 + N) / (1 + df.get(t))) + 1);
const vocabIndex = new Map(vocab.map((t, i) => [t, i]));

/** 文档 tf×idf 向量（L2 归一化），值按词表下标稀疏存储 */
function docVector(text) {
  const sparse = toSparse(tokenize(text));
  const idx = [];
  const val = [];
  for (let k = 0; k < sparse.idx.length; k++) {
    const vi = vocabIndex.get(sparse.idx[k]);
    if (vi === undefined) continue;
    idx.push(vi);
    val.push(sparse.val[k] * idf[vi]);
  }
  let norm = 0;
  for (const v of val) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let k = 0; k < val.length; k++) val[k] = val[k] / norm;
  return { idx, val };
}

const docs = {};
for (const c of cases) docs[c.id] = docVector(docTexts[cases.indexOf(c)]);

const manifest = { version: 1, vocab, idf, docs };
writeFileSync(join(ROOT, "src/data/tfidf-manifest.json"), JSON.stringify(manifest) + "\n", "utf8");
console.log(`词表 ${vocab.length} 词，文档 ${Object.keys(docs).length} 篇，已写 src/data/tfidf-manifest.json`);
