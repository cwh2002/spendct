/**
 * 纯 TS TF-IDF 检索兜底（04 §6.2 骨架，<150 行零依赖）：
 * 浏览器（订阅雷达引用、省钱贴士、知识课堂搜索）与服务端（dense 不可用时的兜底）
 * 共用同一份实现。词表/IDF/文档向量由 scripts/rag/build-vocab.mjs 预计算
 * 进 src/data/tfidf-manifest.json，运行时零训练。
 *
 * 分词口径（04 §6.2）：
 * ① 全角转半角、转小写、标点剔除；
 * ② 领域词表最长匹配（消费维权/订阅领域的多字词整体成 token）；
 * ③ 剩余 CJK 字符按 bigram 补位（单字段落保留单字）；
 * ④ 连续数字保留原值 token，并统一补一枚 NUM 通配 token（「19 块」与「19.9 元」可互命中）。
 */
import { TFIDF_FALLBACK_K } from "./types";
import type { CaseRecord } from "@/lib/cases";
import domainWordsJson from "@/data/domain-words.json";

/** 领域词表：构建脚本与运行时共用的单一来源（src/data/domain-words.json） */
const DOMAIN_WORDS: string[] = domainWordsJson.words;

/** 稀疏 token 计数向量（toSparse 产物）：idx 为升序 token 字符串，与 val 一一对应 */
export interface TokenVec {
  idx: string[];
  val: number[];
}

/** 稀疏词表下标向量（manifest.docs 与查询向量）：idx 为升序 vocab 下标 */
export interface IndexVec {
  idx: number[];
  val: number[];
}

/** TF-IDF 预计算产物结构（build-vocab.mjs 生成，docs 向量已 L2 归一化） */
export interface TfidfManifest {
  version: number;
  vocab: string[];
  idf: number[];
  docs: Record<string, IndexVec>;
}

const HALF_TO_FULL = "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９";
const FULL_TO_HALF = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 全角字母数字 → 半角，同时转小写 */
function normalize(text: string): string {
  let out = "";
  for (const ch of text) {
    const p = HALF_TO_FULL.indexOf(ch);
    out += p >= 0 ? FULL_TO_HALF[p]! : ch;
  }
  return out.toLowerCase();
}

/** 是否为 CJK 字符（含扩展区常用段） */
function isCjk(ch: string): boolean {
  return /[一-鿿㐀-䶿]/u.test(ch);
}

/**
 * 领域词最长匹配：对输入逐位置尝试按词长降序匹配，命中则整词成 token 并推进。
 * 返回 tokens 与「已被词表覆盖的位置」集合，供后续 bigram 补位跳过。
 */
function matchDomainWords(text: string): { tokens: string[]; covered: boolean[] } {
  const tokens: string[] = [];
  const covered: boolean[] = new Array(text.length).fill(false);
  let i = 0;
  while (i < text.length) {
    let hit = "";
    for (const w of DOMAIN_WORDS) {
      if (text.startsWith(w, i) && w.length > hit.length) hit = w;
    }
    if (hit) {
      tokens.push(hit);
      for (let j = 0; j < hit.length; j++) covered[i + j] = true;
      i += hit.length;
    } else {
      i++;
    }
  }
  return { tokens, covered };
}

/** 分词主入口（04 §6.2 口径，见文件头） */
export function tokenize(text: string): string[] {
  // 标点剔除时保留数字间的小数点（「19.9 元」整体成 token，不切成 19/9 两个整数）
  const s = normalize(text).replace(/[^\p{L}\p{N}.]+/gu, " ");
  const { tokens, covered } = matchDomainWords(s);
  let hasNum = false;
  const numTokens: string[] = [];
  // 数字串：原值 + NUM 通配；数字位置标记为已覆盖。
  // 已被领域词整体命中的数字（618/12315/双11 等）不再重复提取
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) {
    if (covered[m.index]) continue;
    hasNum = true;
    numTokens.push(m[0]);
    for (let j = m.index; j < m.index + m[0].length; j++) covered[j] = true;
  }
  tokens.push(...numTokens);
  // 剩余 CJK 连续段按 bigram 补位；孤立单字保留自身
  let run: string[] = [];
  const flush = () => {
    if (run.length === 1) tokens.push(run[0]!);
    else for (let k = 0; k + 1 < run.length; k++) tokens.push(run[k]! + run[k + 1]!);
    run = [];
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (!covered[i] && isCjk(ch)) {
      run.push(ch);
    } else {
      flush();
    }
  }
  flush();
  if (hasNum) tokens.push("NUM");
  return tokens;
}

/** tokens → 稀疏计数向量（token 升序，val 与 idx 一一对应） */
export function toSparse(tokens: string[]): TokenVec {
  const map = new Map<string, number>();
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
  const entries = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    idx: entries.map(([t]) => t),
    val: entries.map(([, n]) => n),
  };
}

/** 余弦相似度（两向量均需预先 L2 归一化，idx 均为 vocab 下标） */
export function cosine(a: IndexVec, b: IndexVec): number {
  let dot = 0;
  let i = 0;
  let j = 0;
  while (i < a.idx.length && j < b.idx.length) {
    const ai = a.idx[i]!;
    const bj = b.idx[j]!;
    if (ai === bj) {
      dot += a.val[i]! * b.val[j]!;
      i++;
      j++;
    } else if (ai < bj) {
      i++;
    } else {
      j++;
    }
  }
  return dot;
}

/** L2 归一化（原地，只用于词表下标向量） */
function l2Normalize(v: IndexVec): IndexVec {
  let sum = 0;
  for (const x of v.val) sum += x * x;
  const len = Math.sqrt(sum);
  if (len > 0) for (let k = 0; k < v.val.length; k++) v.val[k] = v.val[k]! / len;
  return v;
}

/**
 * TF-IDF 检索：查询分词 → tf×idf（词表外 token 丢弃）→ 与预计算文档向量余弦，
 * 按分数降序返回 topK。manifest 由 build-vocab.mjs 生成（docs 已归一化）。
 */
export function tfidfSearch(
  query: string,
  pool: CaseRecord[],
  manifest: TfidfManifest,
  topK: number = TFIDF_FALLBACK_K,
): { case: CaseRecord; score: number }[] {
  const q = toSparse(tokenize(query));
  const qvec: IndexVec = { idx: [], val: [] };
  for (let k = 0; k < q.idx.length; k++) {
    const t = q.idx[k]!;
    const vi = manifest.vocab.indexOf(t);
    if (vi < 0) continue;
    qvec.idx.push(vi);
    qvec.val.push(q.val[k]! * manifest.idf[vi]!);
  }
  if (qvec.idx.length === 0) return [];
  l2Normalize(qvec);
  const scored = pool
    .map((c) => {
      const d = manifest.docs[c.id];
      return d ? { case: c, score: cosine(qvec, d) } : null;
    })
    .filter((x): x is { case: CaseRecord; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
