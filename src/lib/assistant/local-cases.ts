/**
 * 本地案例检索（08 修订案 A12 案例路径）：智能助理在账单查询之外的
 * 攻略/常识类问题先查本地案例库，零 API 调用；未命中再转在线兜底。
 *
 * 纯函数模块（不依赖 React）：单测直接 import，不连带 hook 文件里的
 * React/zustand/DuckDB 依赖链。
 */
import { CASES } from "@/lib/cases";
import { tfidfSearch, type TfidfManifest } from "@/lib/rag/tfidf";
import tfidfManifest from "@/data/tfidf-manifest.json";

/** 案例参考（检索响应，非模型生成文本） */
export interface LocalCaseRef {
  caseId: string;
  title: string;
  snippet: string;
}

/**
 * 聊天案例路径的检索阈值：高于通用引用阈值 TFIDF_CITE_MIN（0.08）。
 * 回答气泡直接展示案例引用，噪音案例比不引用更伤可信度，宁缺毋滥；
 * 页面浏览引用（/insights、/learn、/subscriptions）维持 0.08 不变。
 * 取值依据：实测「双11 大促」问题强相关命中 0.22、噪音命中 ≤0.14，
 * 0.15 恰好只保留强相关案例（导出供单测锁定该口径）。
 */
export const CASE_PATH_MIN_SCORE = 0.15;

/**
 * 聊天案例检索：问题经 TF-IDF 与本地案例库比对，分数不低于聊天阈值
 * 才采用（最多 3 条，按分数降序）。零命中即返回空数组，由调用方转在线。
 */
export function searchLocalCases(question: string): LocalCaseRef[] {
  const hits = tfidfSearch(question, CASES, tfidfManifest as TfidfManifest).filter(
    (hit) => hit.score >= CASE_PATH_MIN_SCORE,
  );
  return hits.slice(0, 3).map((hit) => ({
    caseId: hit.case.id,
    title: hit.case.title,
    snippet: hit.case.summary,
  }));
}
