/**
 * 在线兜底消息上下文装配单测（08 修订案 A12 + 热修复五轮 + 复审修补）。
 * 覆盖：预算内全量携带、从最旧裁剪、轮数上限、空消息跳过、
 * 本轮问题恒在（A18 热修复五轮契约：预算为负也不裁本轮问题）、
 * 超长历史消息（>4000 字）整条跳过、明细快照预算与案例参考段上限。
 * 复审修补新增：管线级装配断言（历史装满剩余预算 + 本轮问题也不超
 * 8000 总长——历史预算必须先扣本轮问题长）、先过滤后取最近 N 轮的
 * 窗口语义、单条封顶 3900 / 明细等值 600 / 负数契约的边界用例、
 * 案例参考段真实触发截断与代理对安全。
 */
import { describe, expect, it } from "vitest";

import {
  buildCaseRefsText,
  buildHistoryMessages,
  CASE_REFS_MAX_LENGTH,
  CASE_SNIPPET_MAX_LENGTH,
  computeDetailBudget,
  DEEP_CONTEXT_PREFIX,
  DETAIL_CONTEXT_PREFIX,
  DETAIL_MIN_LENGTH,
  HISTORY_TURNS,
  MESSAGE_BUDGET,
  MESSAGE_MAX_LENGTH,
  ONLINE_CONTEXT_PREFIX,
  TARGETED_CONTEXT_PREFIX,
} from "@/lib/assistant/chat-context";

function turns(count: number): Array<{ role: "user" | "assistant"; text: string }> {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `第${index}轮内容`.repeat(5), // 每条 25 字
  }));
}

/** 按管线口径装配整组消息：上下文段 + 历史（预算先扣本轮问题长）+ 问题 */
function assemble(
  contextMessages: Array<{ role: "user" | "assistant"; content: string }>,
  historyTurns: Array<{ role: "user" | "assistant"; text: string }>,
  question: string,
) {
  const budget =
    MESSAGE_BUDGET -
    contextMessages.reduce((sum, message) => sum + message.content.length, 0) -
    question.length;
  return [...contextMessages, ...buildHistoryMessages(historyTurns, question, budget)];
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

  it("历史总长不超过预算（任意预算值都成立），本轮问题恒在末尾", () => {
    // 热修复五轮契约：本轮问题不占历史预算、恒被保留（此前预算为负时连
    // 本轮问题一起裁掉，模型收不到问题本体）；管线调用方负责先扣问题长
    for (const budget of [0, 30, 100, 500]) {
      const messages = buildHistoryMessages(turns(8), "问题", budget);
      expect(messages.at(-1)).toEqual({ role: "user", content: "问题" });
      const historyTotal = messages
        .slice(0, -1)
        .reduce((sum, message) => sum + message.content.length, 0);
      expect(historyTotal).toBeLessThanOrEqual(budget);
    }
  });

  it("历史最多 HISTORY_TURNS 条，本轮问题恒在末尾", () => {
    const messages = buildHistoryMessages(turns(HISTORY_TURNS + 20), "问题", MESSAGE_BUDGET);
    expect(messages.length).toBeLessThanOrEqual(HISTORY_TURNS + 1);
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

  it("超长历史消息（>4000 字）整条跳过、继续装更旧的（深度分析长回答不回灌请求）", () => {
    const messages = buildHistoryMessages(
      [
        { role: "user", text: "更早的历史" },
        { role: "assistant", text: "长".repeat(4100) },
      ],
      "本轮问题",
      MESSAGE_BUDGET,
    );
    expect(messages).toEqual([
      { role: "user", content: "更早的历史" },
      { role: "user", content: "本轮问题" },
    ]);
  });

  it("先过滤超长消息再取最近 HISTORY_TURNS 轮：窗口内全是超长条时更旧的合格历史仍保留", () => {
    // 复审修补：旧实现先 slice(-10) 后跳过，最近 10 条全超长时第 11 条
    // 及更早的合格历史被白白丢弃；先过滤后截取则全部保留
    const longTail = { role: "assistant" as const, text: "长".repeat(4100) };
    const validOld = Array.from({ length: 10 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `第${index}轮内容`.repeat(5),
    }));
    const messages = buildHistoryMessages([...validOld, longTail], "本轮问题", MESSAGE_BUDGET);
    expect(messages).toHaveLength(11);
    expect(messages[0]).toEqual({ role: "user", content: "第0轮内容".repeat(5) });
    expect(messages.at(-1)).toEqual({ role: "user", content: "本轮问题" });
  });

  it("本轮问题不受单条上限约束（用户输入不替用户裁掉）", () => {
    const longQuestion = "问".repeat(4100);
    expect(buildHistoryMessages([], longQuestion, MESSAGE_BUDGET)).toEqual([
      { role: "user", content: longQuestion },
    ]);
  });
});

describe("管线级装配（复审修补：总长不超 8000 的端到端口径）", () => {
  it("deep 满配 + 历史装满剩余预算 + 500 字问题仍不超总预算（H1 回归锁定）", () => {
    // 修复前：历史预算未扣本轮问题长，历史装满时总长 = 8000 + 问题长，
    // 服务端 zod refine 必 400——正是热修复五轮要消灭的失败形态
    const context = "统".repeat(2400);
    const targeted = "向".repeat(2500);
    const refs = "参".repeat(600);
    const question = "问".repeat(500);
    const detailBudget = computeDetailBudget({ deep: true, context, targeted, refs, question });
    expect(detailBudget).toBeGreaterThanOrEqual(DETAIL_MIN_LENGTH);
    const details = "细".repeat(detailBudget);
    const contextMessages = [
      { role: "user" as const, content: `${DEEP_CONTEXT_PREFIX}${context}` },
      { role: "user" as const, content: `${TARGETED_CONTEXT_PREFIX}${targeted}` },
      { role: "user" as const, content: `${DETAIL_CONTEXT_PREFIX}${details}` },
      { role: "user" as const, content: refs },
    ];
    // 10 轮 × 500 字远大于剩余预算：贪心装满后余量必然小于本轮问题长
    const historyTurns = Array.from({ length: 10 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `历${index}`.repeat(250),
    }));
    const messages = assemble(contextMessages, historyTurns, question);
    const total = messages.reduce((sum, message) => sum + message.content.length, 0);
    expect(total).toBeLessThanOrEqual(MESSAGE_BUDGET);
    for (const message of messages) {
      expect(message.content.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    }
    expect(messages.at(-1)).toEqual({ role: "user", content: question });
  });

  it("日常档统计 + 明细 + 案例参考 + 历史装满剩余预算 + 问题仍不超总预算", () => {
    const context = "统".repeat(2000);
    const refs = "参".repeat(600);
    const question = "这个月花了多少";
    const detailBudget = computeDetailBudget({
      deep: false,
      context,
      targeted: "",
      refs,
      question,
    });
    const details = "细".repeat(detailBudget);
    const contextMessages = [
      { role: "user" as const, content: `${ONLINE_CONTEXT_PREFIX}${context}${details}` },
      { role: "user" as const, content: refs },
    ];
    const historyTurns = Array.from({ length: 10 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `历${index}`.repeat(250),
    }));
    const messages = assemble(contextMessages, historyTurns, question);
    const total = messages.reduce((sum, message) => sum + message.content.length, 0);
    expect(total).toBeLessThanOrEqual(MESSAGE_BUDGET);
    for (const message of messages) {
      expect(message.content.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    }
    expect(messages.at(-1)).toEqual({ role: "user", content: question });
  });
});

describe("明细快照预算", () => {
  it("deep 档满配上下文 + 案例参考 + 本轮问题仍不超总预算（历史按实际剩余动态预留）", () => {
    const question = "问".repeat(30);
    const budget = computeDetailBudget({
      deep: true,
      context: "统".repeat(2400),
      targeted: "向".repeat(2500),
      refs: "参".repeat(600),
      question,
    });
    expect(budget).toBeGreaterThanOrEqual(DETAIL_MIN_LENGTH);
    const prefixes =
      DEEP_CONTEXT_PREFIX.length + TARGETED_CONTEXT_PREFIX.length + DETAIL_CONTEXT_PREFIX.length;
    // 复审修补：历史不再占用静态预留（HISTORY_RESERVE 已移除），快照预算
    // 按「8000 - 统计 - 定向 - 前缀 - 参考 - 问题」给足，首问 deep 不再被
    // 无谓压缩约 3 倍；历史预算由装配方按实际剩余动态给出
    const total = 2400 + 2500 + budget + prefixes + 600 + question.length;
    expect(total).toBeLessThanOrEqual(MESSAGE_BUDGET);
    // 满配首问快照约 2420 字（修复前被 1200 静态预留压到 1220 字）
    expect(budget).toBeGreaterThan(1900);
  });

  it("deep 档参考段越大快照预算越小（参考段长度计入预算）", () => {
    // 两态都落在总预算档（fixed > 4100）：差值才严格等于参考段长度——
    // 上下文小时无参考态会被 3900 单条封顶截住，差值不足 600
    const withRefs = computeDetailBudget({
      deep: true,
      context: "统".repeat(2400),
      targeted: "向".repeat(2500),
      refs: "参".repeat(600),
      question: "问题",
    });
    const withoutRefs = computeDetailBudget({
      deep: true,
      context: "统".repeat(2400),
      targeted: "向".repeat(2500),
      refs: "",
      question: "问题",
    });
    expect(withoutRefs - withRefs).toBe(600);
  });

  it("日常档统计与明细合并一条消息：快照还要给统计让出单条空间", () => {
    const budget = computeDetailBudget({
      deep: false,
      context: "统".repeat(2000),
      targeted: "",
      refs: "参".repeat(600),
      question: "问".repeat(30),
    });
    // 单条 4000 上限：快照 ≤ 3900 - 统计段（与总预算扣除项取较小值）
    expect(budget).toBe(1900);
  });

  it("服务端封顶下满配（问题 500 字）仍保底快照空间，且不越过单条上限", () => {
    const budget = computeDetailBudget({
      deep: true,
      context: "统".repeat(2400),
      targeted: "向".repeat(2500),
      refs: "参".repeat(600),
      question: "问".repeat(500),
    });
    // 各段都在服务端封顶时，快照预算仍不低于 DETAIL_MIN_LENGTH——
    // 管线层的「低于该值省略快照段」是防御分支，正常满配不会触发
    expect(budget).toBeGreaterThanOrEqual(DETAIL_MIN_LENGTH);
    expect(budget).toBeLessThanOrEqual(3900);
  });

  it("deep 档单条封顶恰好 3900（perMessageBudget 生效档的等值边界）", () => {
    const budget = computeDetailBudget({
      deep: true,
      context: "统".repeat(1000),
      targeted: "向".repeat(1000),
      refs: "",
      question: "q",
    });
    expect(budget).toBe(3900);
  });

  it("总预算档恰好 DETAIL_MIN_LENGTH：等值时快照分支照常发送（≥ 翻转即省略）", () => {
    // 8000 - (2400 + 2500 + 600 + 前缀 50 + 问题) = 600 → 问题长 1850
    const budget = computeDetailBudget({
      deep: true,
      context: "统".repeat(2400),
      targeted: "向".repeat(2500),
      refs: "参".repeat(600),
      question: "问".repeat(1850),
    });
    expect(budget).toBe(DETAIL_MIN_LENGTH);
  });

  it("预算为负表示没有快照空间（调用方省略快照段的契约）", () => {
    const budget = computeDetailBudget({
      deep: true,
      context: "统".repeat(2400),
      targeted: "向".repeat(2500),
      refs: "参".repeat(600),
      question: "问".repeat(3000),
    });
    expect(budget).toBeLessThan(0);
  });
});

describe("案例参考段", () => {
  it("长摘要逐条截断、整段压上限", () => {
    const text = buildCaseRefsText([
      { title: "长标题", snippet: "长".repeat(500) },
      { title: "二", snippet: "短摘要" },
    ]);
    expect(text.length).toBeLessThanOrEqual(CASE_REFS_MAX_LENGTH);
    expect(text).toContain("案例参考（长标题：");
  });

  it("6 条满长摘要真实触发整段截断：含省略号仍 ≤ CASE_REFS_MAX_LENGTH", () => {
    // 复审修补：旧用例两条摘要只触发单条截断（输出 143 字），整段
    // slice(0,600) 分支从未被执行——删掉两个截断分支旧用例照样全绿
    const text = buildCaseRefsText(
      Array.from({ length: 6 }, (_, index) => ({
        title: `案例${index}`,
        snippet: "摘".repeat(500),
      })),
    );
    expect(Array.from(text).length).toBeLessThanOrEqual(CASE_REFS_MAX_LENGTH);
    // 单条摘要截断到 CASE_SNIPPET_MAX_LENGTH + 省略号（不含结尾右括号）
    const firstLine = text.split("\n")[0] ?? "";
    const snippetPart = firstLine.slice(firstLine.indexOf("：") + 1, -1);
    expect(snippetPart).toHaveLength(CASE_SNIPPET_MAX_LENGTH + 1);
    expect(snippetPart.endsWith("…")).toBe(true);
  });

  it("截断不切断代理对：emoji 落在边界也不产生孤立代理项", () => {
    const text = buildCaseRefsText([{ title: "表情", snippet: "😀".repeat(400) }]);
    const points = Array.from(text);
    for (const point of points) {
      const code = point.codePointAt(0);
      expect(code === undefined || (code >= 0xd800 && code <= 0xdfff)).toBe(false);
    }
  });

  it("零案例返回空串（不发参考消息）", () => {
    expect(buildCaseRefsText([])).toBe("");
  });
});
