/**
 * 在线兜底消息上下文装配单测（08 修订案 A12）。
 * 覆盖：预算内全量携带、从最旧裁剪、轮数上限、空消息跳过、
 * 本轮问题保底、总长不超预算。
 */
import { describe, expect, it } from "vitest";

import {
  buildHistoryMessages,
  HISTORY_TURNS,
  MESSAGE_BUDGET,
  ONLINE_CONTEXT_PREFIX,
} from "@/lib/assistant/chat-context";

function turns(count: number): Array<{ role: "user" | "assistant"; text: string }> {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `第${index}轮内容`.repeat(5), // 每条 25 字
  }));
}

describe("历史消息装配", () => {
  it("预算充足时携带最近历史 + 本轮问题（按时间正序）", () => {
    const messages = buildHistoryMessages(turns(4), "本轮问题", MESSAGE_BUDGET);
    expect(messages[0]).toEqual({ role: "user", content: "第0轮内容".repeat(5) });
    expect(messages.at(-1)).toEqual({ role: "user", content: "本轮问题" });
    expect(messages).toHaveLength(5);
  });

  it("超预算时从最旧一条开始裁剪，本轮问题保底", () => {
    // 每条 25 字：预算只装得下最后一条历史 + 本轮问题（4 字）
    const budget = 25 + "本轮问题".length;
    const messages = buildHistoryMessages(turns(4), "本轮问题", budget);
    expect(messages).toEqual([
      { role: "assistant", content: "第3轮内容".repeat(5) },
      { role: "user", content: "本轮问题" },
    ]);
  });

  it("总长不超过预算（任意预算值都成立）", () => {
    for (const budget of [0, 30, 100, 500]) {
      const messages = buildHistoryMessages(turns(8), "问题", budget);
      const total = messages.reduce((sum, message) => sum + message.content.length, 0);
      expect(total).toBeLessThanOrEqual(budget);
      if (budget >= "问题".length) {
        expect(messages.at(-1)).toEqual({ role: "user", content: "问题" });
      }
    }
  });

  it("只取最近 HISTORY_TURNS 条（含本轮）", () => {
    const messages = buildHistoryMessages(turns(HISTORY_TURNS + 20), "问题", MESSAGE_BUDGET);
    expect(messages.length).toBeLessThanOrEqual(HISTORY_TURNS);
    expect(messages.at(-1)?.content).toBe("问题");
  });

  it("空消息跳过，不占预算", () => {
    const messages = buildHistoryMessages(
      [
        { role: "user", text: "" },
        { role: "user", text: "有效历史" },
      ],
      "问题",
      MESSAGE_BUDGET,
    );
    expect(messages).toEqual([
      { role: "user", content: "有效历史" },
      { role: "user", content: "问题" },
    ]);
  });

  it("ONLINE_CONTEXT_PREFIX 声明账单数据随消息发送（A8 口径）", () => {
    expect(ONLINE_CONTEXT_PREFIX).toContain("汇总统计与最近明细");
  });
});
