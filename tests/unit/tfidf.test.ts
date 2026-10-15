/**
 * TF-IDF 兜底检索分词与打分单测（04 §6.2 口径）：
 * 覆盖全角归一、领域词最长匹配、数字 NUM 通配、CJK bigram、
 * toSparse 计数排序、余弦打分与 tfidfSearch 端到端（合成词表，不依赖模型产物）。
 */
import { describe, expect, it } from "vitest";

import type { CaseRecord } from "@/lib/cases";
import { cosine, tfidfSearch, tokenize, toSparse, type TfidfManifest } from "@/lib/rag/tfidf";

/** 测试夹具：最小合法案例（字段与 CaseRecord 对齐，正文与真实语料无关） */
function fakeCase(id: string, title: string, summary: string): CaseRecord {
  return {
    id,
    title,
    summary,
    category: "subscription_trap",
    source: "测试来源",
    sourceUrl: "https://example.com/",
    benefitTags: [],
  };
}

describe("tokenize 分词口径", () => {
  it("全角字母数字归一为半角并转小写", () => {
    // 全角数字归一后半角数字串参与领域词匹配（618/12315 为领域词）
    expect(tokenize("６１８")).toEqual(["618"]);
    expect(tokenize("１２３１５")).toEqual(["12315"]);
    expect(tokenize("双１１")).toEqual(["双11"]);
  });

  it("领域词整词成 token，不做内部切分", () => {
    expect(tokenize("免费试用")).toEqual(["免费试用"]);
    expect(tokenize("自动续费")).toEqual(["自动续费"]);
    // 相邻两个领域词各自独立成 token
    expect(tokenize("免费试用自动续费")).toEqual(["免费试用", "自动续费"]);
  });

  it("领域词最长匹配优先于短词", () => {
    // 「连续包月」整体成词，不应被切出「包月」
    expect(tokenize("连续包月")).toEqual(["连续包月"]);
  });

  it("数字保留原值并补 NUM 通配 token", () => {
    const a = tokenize("19块");
    const b = tokenize("19.9元");
    expect(a).toContain("19");
    expect(a).toContain("NUM");
    // 小数金额整体成 token（小数点保留，不切成 19/9 两个整数）
    expect(b).toEqual(["19.9", "元", "NUM"]);
  });

  it("CJK 连续段按 bigram 切分，孤立单字保留", () => {
    expect(tokenize("怎么关闭")).toEqual(["怎么", "么关", "关闭"]);
    expect(tokenize("费")).toEqual(["费"]);
  });

  it("标点与空白被剔除，不产生空 token", () => {
    const tokens = tokenize("自动续费，怎么关闭？");
    expect(tokens).toContain("自动续费");
    expect(tokens.every((t) => t.trim().length > 0)).toBe(true);
  });
});

describe("toSparse 计数向量", () => {
  it("按 token 升序输出，val 与 idx 一一对应", () => {
    const vec = toSparse(["b", "a", "b", "c"]);
    expect(vec.idx).toEqual(["a", "b", "c"]);
    expect(vec.val).toEqual([1, 2, 1]);
  });

  it("空输入得到空向量", () => {
    expect(toSparse([])).toEqual({ idx: [], val: [] });
  });
});

describe("cosine 余弦打分", () => {
  it("相同向量为 1，正交向量为 0", () => {
    const unit = { idx: [0], val: [1] };
    expect(cosine(unit, unit)).toBeCloseTo(1, 6);
    expect(cosine({ idx: [0], val: [1] }, { idx: [1], val: [1] })).toBe(0);
  });

  it("重叠维度的值相乘求和", () => {
    const a = { idx: [0, 2], val: [1, 0.5] };
    const b = { idx: [1, 2], val: [1, 0.5] };
    // 仅维度 2 重叠：0.5 × 0.5
    expect(cosine(a, b)).toBeCloseTo(0.25, 6);
  });
});

describe("tfidfSearch 端到端（合成词表）", () => {
  const pool = [
    fakeCase("t-1", "自动续费陷阱", "视频会员次月自动续费扣款"),
    fakeCase("t-2", "免费试用规则", "网盘免费试用七天到期扣费"),
  ];
  // 词表 2 词（与分词口径一致：领域词整词成 token）、idf 全 1；文档向量已 L2 归一化
  const manifest: TfidfManifest = {
    version: 1,
    vocab: ["自动续费", "免费试用"],
    idf: [1, 1],
    docs: {
      "t-1": { idx: [0], val: [1] },
      "t-2": { idx: [1], val: [1] },
    },
  };

  it("查询命中词表后按余弦降序返回，top-1 为语义更近的文档", () => {
    const results = tfidfSearch("自动续费", pool, manifest, 3);
    expect(results.map((r) => r.case.id)).toEqual(["t-1", "t-2"]);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("查询 token 全部在词表外时返回空列表", () => {
    expect(tfidfSearch("完全无关的查询", pool, manifest, 3)).toEqual([]);
  });

  it("topK 截断生效", () => {
    const results = tfidfSearch("自动续费免费试用", pool, manifest, 1);
    expect(results).toHaveLength(1);
  });
});
