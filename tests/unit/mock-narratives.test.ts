/**
 * mock 叙事模板库单测（T6 LLM 接入层验收）：
 * 模板完整性（每 task 有模板、narrative 覆盖六阶段、段长 80-200）、
 * fillTemplate 数字替换、AI 腔禁用词、确定性选段与降级函数口径。
 */
import { describe, expect, it } from "vitest";

import { SIX_STAGES } from "@/lib/pipeline/stage";
import {
  DEFAULT_MOCK_VARS,
  fillTemplate,
  LLM_TASKS,
  MOCK_NARRATIVES,
  mockBudgetAdvice,
  mockForecastNarrative,
  mockTips,
  pickMockText,
} from "@/lib/llm/mock-narratives";

const BANNED_PHRASES = ["综上所述", "值得注意的是", "首先", "其次"];

/** quick-entry 档是示例句（不受叙事字数约束），其余任务段长 80-200 */
const NARRATIVE_TASKS = LLM_TASKS.filter((task) => task !== "quick-entry");

function allTemplateStrings(): string[] {
  return LLM_TASKS.flatMap((task) => Object.values(MOCK_NARRATIVES[task]).flat());
}

describe("模板库完整性", () => {
  it("每个任务都有模板，且每档至少 2 段", () => {
    for (const task of LLM_TASKS) {
      const entries = MOCK_NARRATIVES[task];
      expect(Object.keys(entries).length, `${task} 至少一个档位`).toBeGreaterThan(0);
      for (const [key, segments] of Object.entries(entries)) {
        expect(segments.length, `${task}:${key} 每档至少 2 段`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("narrative 覆盖六阶段（07 §1 StageId）", () => {
    for (const stage of SIX_STAGES) {
      expect(MOCK_NARRATIVES.narrative[stage], `narrative:${stage} 缺失`).toBeDefined();
    }
  });

  it("叙事段长度在 80-200 字之间（quick-entry 示例句除外）", () => {
    for (const task of NARRATIVE_TASKS) {
      for (const segments of Object.values(MOCK_NARRATIVES[task])) {
        for (const segment of segments) {
          expect(
            segment.length,
            `${task} 段长 ≥80：${segment.slice(0, 20)}…`,
          ).toBeGreaterThanOrEqual(80);
          expect(segment.length, `${task} 段长 ≤200：${segment.slice(0, 20)}…`).toBeLessThanOrEqual(
            200,
          );
        }
      }
    }
  });

  it("全部模板不含 AI 腔禁用词", () => {
    for (const text of allTemplateStrings()) {
      for (const banned of BANNED_PHRASES) {
        expect(text, `出现禁用词「${banned}」`).not.toContain(banned);
      }
    }
  });
});

describe("fillTemplate 与确定性选段", () => {
  it("数字与字符串占位替换正确", () => {
    expect(fillTemplate("这个月花了 {amount} 元，占比 {pct}%", { amount: 486, pct: 34 })).toBe(
      "这个月花了 486 元，占比 34%",
    );
    expect(fillTemplate("变动主要来自 {cat}", { cat: "餐饮" })).toBe("变动主要来自 餐饮");
  });

  it("未提供的占位保持原样，便于发现缺数", () => {
    expect(fillTemplate("花了 {amount} 元", {})).toBe("花了 {amount} 元");
  });

  it("pickMockText 输出无残留占位且确定性", () => {
    for (const task of LLM_TASKS) {
      const text = pickMockText(task);
      expect(text, `${task} 不应有未填充占位`).not.toMatch(/\{\w+\}/);
      expect(pickMockText(task), `${task} 两次选段应一致`).toBe(text);
    }
    expect(pickMockText("narrative", "profile")).toBe(pickMockText("narrative", "profile"));
    expect(pickMockText("narrative", "profile")).toContain("餐饮");
    expect(DEFAULT_MOCK_VARS.narrative.pct).toBe(34);
  });

  it("mockBudgetAdvice 的 severity 由 ratio 阈值直接判定（08 §⑥.2）", () => {
    expect(mockBudgetAdvice(0.5).severity).toBe("ok");
    expect(mockBudgetAdvice(0.85).severity).toBe("warn");
    expect(mockBudgetAdvice(1.1).severity).toBe("over");
    expect(mockBudgetAdvice().severity).toBe("ok");
    expect(mockBudgetAdvice(0.85).headline).toContain("85");
  });

  it("mockForecastNarrative 保留免责声明原文（08 §⑥.3）", () => {
    expect(mockForecastNarrative("up").disclaimer).toBe("朴素季节外推，仅作参考，不构成建议");
    expect(mockForecastNarrative("down").headline).toContain("回落");
    expect(mockForecastNarrative("flat").headline.length).toBeLessThanOrEqual(60);
  });

  it("mockTips 的 caseId 只来自传入列表，缺省用演示占位 id", () => {
    const fromInput = mockTips(["case-a", "case-b", "case-c", "case-d"]);
    expect(fromInput.tips.map((tip) => tip.caseId)).toEqual(["case-a", "case-b", "case-c"]);
    expect(fromInput.tips.every((tip) => tip.why.length <= 40)).toBe(true);
    const fallback = mockTips([]);
    expect(fallback.tips.map((tip) => tip.caseId)).toEqual([
      "case-demo-1",
      "case-demo-2",
      "case-demo-3",
    ]);
  });
});
