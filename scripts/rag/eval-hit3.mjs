/**
 * hit@3 金标评测（04 §5.2 / 07 §16 唯一口径）：
 * 用运行时同款检索级联（经 ts-loader 转译 src/server/rag/retrieve.ts）对金标逐题检索，
 * top-3 命中 expectedCaseIds 任一即计 hit；金标 ID 不在库自动标记 pending 计未达标。
 *
 * 用法：node scripts/rag/eval-hit3.mjs [--mode full|dense-only|tfidf] [--set main|student|all]
 * 阈值（07 §16 三档 + 08 A4）：
 *   --mode full --set main   hit@3 ≥18/20，否则 exit 1（CI 门槛）
 *   --mode dense-only main   报告值，≥16/20（G3 入场线），低于则 exit 2 警告
 *   --mode tfidf --set main  hit@3 ≥12/20，否则 exit 1
 *   --mode full --set student hit@3 ≥7/8，否则 exit 1（独立断言，与主集分开报告）
 * 结果写 tests/golden/results.json（已 gitignore，数字以评测报告 docs/eval-rag.md 为准）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTsModule, ROOT } from "./ts-loader.mjs";

const { retrieveCases } = loadTsModule(join(ROOT, "src/server/rag/retrieve.ts"));

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "full";
const set = process.argv.includes("--set") ? process.argv[process.argv.indexOf("--set") + 1] : "main";
if (!["full", "dense-only", "tfidf"].includes(mode)) {
  console.error("--mode 只支持 full|dense-only|tfidf");
  process.exit(1);
}
if (!["main", "student", "all"].includes(set)) {
  console.error("--set 只支持 main|student|all");
  process.exit(1);
}

const caseIds = new Set(JSON.parse(readFileSync(join(ROOT, "data/cases/cases.json"), "utf8")).cases.map((c) => c.id));
const loadGolden = (file) => JSON.parse(readFileSync(join(ROOT, "tests/golden", file), "utf8"));

async function evalSet(golden, label) {
  const perQuery = [];
  for (const q of golden.queries) {
    const pending = q.expectedCaseIds.some((id) => !caseIds.has(id));
    const started = Date.now();
    // 评测口径：不带类别过滤（最严格口径；产品内可按类目预筛后再检索）
    const result = await retrieveCases(q.query, {}, {
      topK: 3,
      forceTfidf: mode === "tfidf",
      skipRerank: mode === "dense-only",
    });
    const top3 = result.cases.map((c) => c.caseId);
    const hitIdx = top3.findIndex((id) => q.expectedCaseIds.includes(id));
    perQuery.push({
      gid: q.gid,
      rank: hitIdx >= 0 ? hitIdx + 1 : null,
      top3,
      latencyMs: Date.now() - started,
      pending,
    });
    console.log(`  ${q.gid} ${hitIdx >= 0 ? `hit@${hitIdx + 1}` : "miss"} [${top3.join(", ")}]`);
  }
  const hitAt1 = perQuery.filter((p) => p.rank === 1).length;
  const hitAt3 = perQuery.filter((p) => p.rank !== null && p.rank <= 3).length;
  const mrr = perQuery.reduce((s, p) => s + (p.rank ? 1 / p.rank : 0), 0) / perQuery.length;
  console.log(`\n${label}：hit@1=${hitAt1}/${perQuery.length}，hit@3=${hitAt3}/${perQuery.length}，MRR=${mrr.toFixed(3)}`);
  return { hitAt1, hitAt3, mrr, perQuery, total: perQuery.length };
}

const results = {};
let exitCode = 0;
if (set === "main" || set === "all") {
  console.log(`主集 20 题（mode=${mode}）：`);
  results.main = await evalSet(loadGolden("rag-golden.json"), "主集");
  const t = results.main.hitAt3;
  if (mode === "full" && t < 18) {
    console.error(`✗ 主集 full 未达 CI 门槛 18/20（实际 ${t}/20）`);
    exitCode = 1;
  }
  if (mode === "dense-only" && t < 16) {
    console.error(`⚠ 主集 dense-only 低于 G3 入场线 16/20（实际 ${t}/20）`);
    exitCode = 2;
  }
  if (mode === "tfidf" && t < 12) {
    console.error(`✗ 主集 tfidf 未达兜底门槛 12/20（实际 ${t}/20）`);
    exitCode = 1;
  }
}
if (set === "student" || set === "all") {
  console.log(`\n学生补充集 8 题（mode=${mode}）：`);
  results.student = await evalSet(loadGolden("rag-golden-student.json"), "学生集");
  const t = results.student.hitAt3;
  if (mode === "full" && t < 7) {
    console.error(`✗ 学生集 full 未达 A4 门槛 7/8（实际 ${t}/8）`);
    exitCode = 1;
  }
}

// 结果按集落盘（04 §5.2：主集 results.json、补充集 results-student.json）
const stamp = { mode, set, generatedAt: new Date().toISOString() };
if (results.main) {
  writeFileSync(
    join(ROOT, "tests/golden/results.json"),
    JSON.stringify({ ...stamp, main: results.main }, null, 2) + "\n",
    "utf8",
  );
}
if (results.student) {
  writeFileSync(
    join(ROOT, "tests/golden/results-student.json"),
    JSON.stringify({ ...stamp, student: results.student }, null, 2) + "\n",
    "utf8",
  );
}
console.log(exitCode === 0 ? "\n评测通过" : `\n评测未达标（exit ${exitCode}）`);
process.exit(exitCode);
