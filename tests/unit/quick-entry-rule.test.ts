/**
 * 快速记账规则解析单测（08 §⑥.1 mock 兜底，06 §7.8 A11 口径的先行用例）：
 * 金额一律整数分断言、parseable true/false 各一组、「15 万」拒绝、红包 income。
 */
import { describe, expect, it } from "vitest";

import { parseQuickEntryText } from "@/lib/llm/quick-entry-rule";

const TODAY = "2026-10-13";

describe("parseable:true 用例（金额单位一律整数分）", () => {
  it("中午食堂花了 15 → 1500 分 / 餐饮 / 今天", () => {
    const result = parseQuickEntryText("中午食堂花了 15", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(1500);
    expect(result.direction).toBe("expense");
    expect(result.category).toBe("餐饮");
    expect(result.merchant).toBe("食堂");
    expect(result.dateIso).toBe(TODAY);
  });

  it("昨天地铁 4 块 → 400 分 / 交通 / 昨天", () => {
    const result = parseQuickEntryText("昨天地铁 4 块", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(400);
    expect(result.category).toBe("交通");
    expect(result.dateIso).toBe("2026-10-12");
  });

  it("收到红包 200 → income / 人情 / 20000 分", () => {
    const result = parseQuickEntryText("收到红包 200", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(20000);
    expect(result.direction).toBe("income");
    expect(result.category).toBe("人情");
    expect(result.merchant).toBeUndefined();
  });

  it("奶茶 16 元 → 1600 分 / 餐饮", () => {
    const result = parseQuickEntryText("奶茶 16 元", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(1600);
    expect(result.category).toBe("餐饮");
  });

  it("自动续费会员扣了 25 → 2500 分 / 订阅", () => {
    const result = parseQuickEntryText("自动续费会员扣了 25", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(2500);
    expect(result.category).toBe("订阅");
  });

  it("无类目关键词时落「其他」，仍是可解析", () => {
    const result = parseQuickEntryText("某小店花了 30", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(3000);
    expect(result.category).toBe("其他");
  });

  it("「兼职赚了 200」→ income（兼职/赚 属于收入词）", () => {
    const result = parseQuickEntryText("昨天兼职赚了 200", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(20000);
    expect(result.direction).toBe("income");
    expect(result.dateIso).toBe("2026-10-12");
  });

  it("「月初房租 1500」→ 居住 / 今天", () => {
    const result = parseQuickEntryText("月初房租 1500", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(150000);
    expect(result.category).toBe("居住");
    expect(result.dateIso).toBe(TODAY);
  });

  it("「昨天打车 23.5」→ 交通 / 昨天 / 2350 分", () => {
    const result = parseQuickEntryText("昨天打车 23.5", TODAY);
    expect(result.parseable).toBe(true);
    expect(result.amountCents).toBe(2350);
    expect(result.category).toBe("交通");
    expect(result.dateIso).toBe("2026-10-12");
  });
});

describe("parseable:false 用例（08 §⑥.1 规则①④）", () => {
  it("「15 万」拒绝", () => {
    const result = parseQuickEntryText("房租 15 万", TODAY);
    expect(result.parseable).toBe(false);
    expect(result.reason).toContain("万");
  });

  it("闲聊文本拒绝", () => {
    const result = parseQuickEntryText("你好呀", TODAY);
    expect(result.parseable).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("问句拒绝", () => {
    const result = parseQuickEntryText("我今天花了多少？", TODAY);
    expect(result.parseable).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("「兼职赚了多少钱」这类查询句拒绝，并给出引导", () => {
    const result = parseQuickEntryText("我今天兼职赚了多少钱，昨天兼职赚了多少钱", TODAY);
    expect(result.parseable).toBe(false);
    expect(result.reason).toContain("记一笔");
  });

  it("没有金额拒绝", () => {
    const result = parseQuickEntryText("中午食堂吃的午饭", TODAY);
    expect(result.parseable).toBe(false);
  });

  it("空输入拒绝", () => {
    const result = parseQuickEntryText("  ", TODAY);
    expect(result.parseable).toBe(false);
  });

  it("「你是谁，你是什么大模型」识别为身份闲聊，引导去记一笔", () => {
    const result = parseQuickEntryText("你是谁，你是什么大模型", TODAY);
    expect(result.parseable).toBe(false);
    expect(result.reason).toContain("记一笔");
  });

  it("「你好」识别为打招呼闲聊，引导去记一笔", () => {
    const result = parseQuickEntryText("你好", TODAY);
    expect(result.parseable).toBe(false);
    expect(result.reason).toContain("记一笔");
  });
});
