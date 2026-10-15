/**
 * 案例装载与过滤单测（04 §4.3）：
 * 60 条语料 zod 校验通过、8 类齐全、id 唯一；
 * 类别白名单过滤与同族放宽逻辑按 04 §4.8 口径断言。
 * loadEmbeddings 依赖 data/cases/embeddings.json（rag:build 产物，随仓库提交）。
 */
import { describe, expect, it } from "vitest";

import { CASES } from "@/lib/cases";
import { CASE_CATEGORIES } from "@/lib/rag/types";
import { filterCases, loadCasePool, loadEmbeddings, relaxFilter } from "@/server/rag/case-store";

describe("loadCasePool 案例池装载", () => {
  it("60 条语料全部通过 zod 校验", () => {
    const pool = loadCasePool();
    expect(pool).toHaveLength(60);
  });

  it("8 个类别齐全且 id 全局唯一", () => {
    const pool = loadCasePool();
    const ids = new Set(pool.map((c) => c.id));
    expect(ids.size).toBe(60);
    const categories = new Set(pool.map((c) => c.category));
    expect(categories).toEqual(new Set(CASE_CATEGORIES));
  });

  it("每条案例必填字段非空，与页面消费的 CASES 同源", () => {
    const pool = loadCasePool();
    for (const c of pool) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.source.length).toBeGreaterThan(0);
      expect(c.sourceUrl).toMatch(/^https?:\/\//);
    }
    expect(pool.map((c) => c.id)).toEqual(CASES.map((c) => c.id));
  });
});

describe("loadEmbeddings 向量装载", () => {
  it("60 条向量齐全、维度 1024", () => {
    const { dim, vectors } = loadEmbeddings();
    expect(dim).toBe(1024);
    expect(vectors.size).toBe(60);
    const first = vectors.values().next().value as Float32Array | undefined;
    expect(first).toBeInstanceOf(Float32Array);
    expect(first?.length).toBe(1024);
  });
});

describe("filterCases 类别过滤", () => {
  const pool = loadCasePool();

  it("空过滤返回全量", () => {
    expect(filterCases(pool, {})).toHaveLength(60);
  });

  it("类别白名单只保留对应类别", () => {
    const result = filterCases(pool, { categories: ["subscription_trap"] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.category === "subscription_trap")).toBe(true);
  });

  it("多类别白名单取并集", () => {
    const result = filterCases(pool, { categories: ["subscription_trap", "prepaid_risk"] });
    expect(result.every((c) => ["subscription_trap", "prepaid_risk"].includes(c.category))).toBe(true);
    expect(result.length).toBe(
      filterCases(pool, { categories: ["subscription_trap"] }).length +
        filterCases(pool, { categories: ["prepaid_risk"] }).length,
    );
  });
});

describe("relaxFilter 同族放宽（04 §4.8）", () => {
  it("订阅陷阱扩展到平台规则与法律法规", () => {
    const relaxed = relaxFilter({ categories: ["subscription_trap"] });
    expect(relaxed.categories).toEqual(
      expect.arrayContaining(["subscription_trap", "platform_rule", "regulation"]),
    );
    expect(relaxed.categories).toHaveLength(3);
  });

  it("预付风险扩展到消费维权", () => {
    const relaxed = relaxFilter({ categories: ["prepaid_risk"] });
    expect(relaxed.categories).toEqual(
      expect.arrayContaining(["prepaid_risk", "consumer_rights", "regulation"]),
    );
  });

  it("多类别放宽后去重", () => {
    const relaxed = relaxFilter({ categories: ["subscription_trap", "platform_rule"] });
    expect(relaxed.categories).toHaveLength(new Set(relaxed.categories).size);
  });

  it("金额区间 ×3，无金额字段则不动", () => {
    expect(relaxFilter({ amountMin: 100, amountMax: 500 })).toEqual({ amountMin: 300, amountMax: 1500 });
    expect(relaxFilter({})).toEqual({});
  });
});
