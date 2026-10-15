/**
 * 聊天案例路径单测（08 修订案 A12）：检索阈值口径锁定。
 * 聊天案例路径用 CASE_PATH_MIN_SCORE（0.15），高于页面浏览引用的
 * TFIDF_CITE_MIN（0.08）——回答气泡直接展示案例引用，噪音案例比
 * 不引用更伤可信度。三个代表性问题的命中集合逐条锁定，防止阈值
 * 或索引调整后回归出噪音引用/漏掉强相关案例。
 */
import { describe, expect, it } from "vitest";

import { CASE_PATH_MIN_SCORE, searchLocalCases } from "@/lib/assistant/local-cases";
import { tfidfSearch } from "@/lib/rag/tfidf";
import { CASES } from "@/lib/cases";
import { TFIDF_CITE_MIN } from "@/lib/rag/types";
import tfidfManifest from "@/data/tfidf-manifest.json";
import type { TfidfManifest } from "@/lib/rag/tfidf";

describe("聊天案例路径阈值", () => {
  it("聊天阈值高于页面引用阈值（宁缺毋滥口径）", () => {
    expect(CASE_PATH_MIN_SCORE).toBeGreaterThan(TFIDF_CITE_MIN);
  });

  it("「双11 大促」问题只保留强相关案例，噪音命中被阈值挡掉", () => {
    const hits = searchLocalCases("双11 大促期间我该怎么规划消费");
    expect(hits.map((h) => h.caseId)).toEqual(["sa-003"]);
    expect(hits[0]?.title).toContain("大促防冲动");
    // 全量检索里确实存在噪音命中（阈值 0.08 会带进来），聊天阈值必须挡住
    const all = tfidfSearch(
      "双11 大促期间我该怎么规划消费",
      CASES,
      tfidfManifest as TfidfManifest,
    );
    expect(all.some((h) => h.score >= TFIDF_CITE_MIN && h.score < CASE_PATH_MIN_SCORE)).toBe(
      true,
    );
  });

  it("「健身房年卡」攻略问题命中对应案例", () => {
    const hits = searchLocalCases("健身房年卡开业三个月就关门了怎么办");
    expect(hits.map((h) => h.caseId)).toEqual(["pr-001"]);
  });

  it("案例库覆盖不到的问题零命中（转在线兜底）", () => {
    expect(searchLocalCases("年货节什么时候开始")).toEqual([]);
  });

  it("所有命中分数都不低于聊天阈值（任意问题都成立）", () => {
    for (const question of [
      "双11 大促期间我该怎么规划消费",
      "健身房年卡开业三个月就关门了怎么办",
      "年货节什么时候开始",
      "网购被虚假宣传骗了怎么办",
    ]) {
      const hits = searchLocalCases(question);
      const scores = tfidfSearch(question, CASES, tfidfManifest as TfidfManifest)
        .filter((h) => h.case.id === hits[0]?.caseId)
        .map((h) => h.score);
      for (const score of scores) {
        expect(score, `${question} 的命中分数`).toBeGreaterThanOrEqual(CASE_PATH_MIN_SCORE);
      }
      expect(hits.length).toBeLessThanOrEqual(3);
    }
  });
});
