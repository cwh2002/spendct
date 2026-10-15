/**
 * 检索级联单测（04 §4.7-4.8 降级链）：
 * vi.mock 假嵌入/假重排，断言四档供应路径——
 * forceTfidf 直走 TF-IDF、dense 直排、dense+rerank、嵌入不可用降 TF-IDF、
 * 重排不可用回 dense。真实语料（cases.json + tfidf-manifest.json）参与断言，
 * 模型产物不参与（零推理零网络）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { embedQuery, EmbedderUnavailableError } from "@/server/rag/embedder";
import { rerank, RerankerUnavailableError } from "@/server/rag/rerank";
import { retrieveCases } from "@/server/rag/retrieve";

// vi.mock 提升后，上方 import 拿到的即 mock 函数；类保留原实现供 instanceof 判断
vi.mock("@/server/rag/embedder", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/rag/embedder")>();
  return { ...original, embedQuery: vi.fn() };
});
vi.mock("@/server/rag/rerank", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/rag/rerank")>();
  return { ...original, rerank: vi.fn() };
});
// 嵌入产物不参与单测：全部案例给零向量，dense 分数全相等（语料序稳定）
vi.mock("@/server/rag/case-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/rag/case-store")>();
  const { CASES } = await import("@/lib/cases");
  const vectors = new Map<string, Float32Array>(CASES.map((c) => [c.id, new Float32Array(1024)]));
  return { ...original, loadEmbeddings: vi.fn(() => ({ dim: 1024, vectors })) };
});

const embedQueryMock = vi.mocked(embedQuery);
const rerankMock = vi.mocked(rerank);

afterEach(() => {
  vi.clearAllMocks();
});

/** 金标 G02 同款查询：TF-IDF 兜底应命中 st-002（免费试用 7 天自动扣款） */
const TRIAL_QUERY = "网盘免费试用7天到期自动扣钱了，能退吗？";

describe("retrieveCases 降级链", () => {
  it("forceTfidf 直走 TF-IDF，命中金标案例 st-002", async () => {
    const result = await retrieveCases(TRIAL_QUERY, {}, { topK: 3, forceTfidf: true });
    expect(result.provider).toBe("tfidf");
    expect(result.cases.length).toBeGreaterThan(0);
    expect(result.cases[0]!.stage).toBe("tfidf");
    expect(result.cases[0]!.caseId).toBe("st-002");
    expect(embedQueryMock).not.toHaveBeenCalled();
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("嵌入与重排均可用：provider=dense+rerank，按重排分数排序", async () => {
    // 零向量查询 → dense 分数全相等（语料序稳定），重排 mock 只抬升 st-003
    embedQueryMock.mockResolvedValue(new Float32Array(1024));
    rerankMock.mockImplementation(async (_query, docs) =>
      docs.map((d) => ({ id: d.id, score: d.id === "st-003" ? 9 : 1 })),
    );
    const result = await retrieveCases("任意查询", { categories: ["subscription_trap"] }, { topK: 3 });
    expect(result.provider).toBe("dense+rerank");
    expect(result.cases[0]!.caseId).toBe("st-003");
    expect(result.cases[0]!.stage).toBe("rerank");
    expect(result.cases).toHaveLength(3);
  });

  it("跳过重排：provider=dense，保持语料序（分数全相等的稳定排序）", async () => {
    embedQueryMock.mockResolvedValue(new Float32Array(1024));
    const result = await retrieveCases("任意查询", { categories: ["subscription_trap"] }, {
      topK: 3,
      skipRerank: true,
    });
    expect(result.provider).toBe("dense");
    expect(result.cases[0]!.stage).toBe("dense");
    // 订阅陷阱类按 cases.json 语料序，首条为 st-001
    expect(result.cases[0]!.caseId).toBe("st-001");
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("嵌入不可用：降级 TF-IDF 并命中 st-002", async () => {
    embedQueryMock.mockRejectedValue(new EmbedderUnavailableError("单测注入"));
    const result = await retrieveCases(TRIAL_QUERY, {}, { topK: 3 });
    expect(result.provider).toBe("tfidf");
    expect(result.cases[0]!.caseId).toBe("st-002");
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("重排不可用：回退 dense 直排（provider=dense）", async () => {
    embedQueryMock.mockResolvedValue(new Float32Array(1024));
    rerankMock.mockRejectedValue(new RerankerUnavailableError("单测注入"));
    const result = await retrieveCases("任意查询", { categories: ["subscription_trap"] }, { topK: 3 });
    expect(result.provider).toBe("dense");
    expect(result.cases[0]!.stage).toBe("dense");
  });

  it("结果字段完整：caseId/title/snippet/stage 非空，latencyMs 非负", async () => {
    embedQueryMock.mockResolvedValue(new Float32Array(1024));
    rerankMock.mockImplementation(async (_query, docs) => docs.map((d, i) => ({ id: d.id, score: i })));
    const result = await retrieveCases("任意查询", { categories: ["subscription_trap"] }, { topK: 3 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    for (const c of result.cases) {
      expect(c.caseId.length).toBeGreaterThan(0);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.snippet.length).toBeGreaterThan(0);
      expect(["dense", "rerank", "tfidf"]).toContain(c.stage);
    }
  });
});
