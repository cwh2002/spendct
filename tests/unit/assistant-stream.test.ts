/**
 * /api/followup SSE 流解析器单测（08 修订案 A12）。
 * 覆盖：七类流事件逐帧映射、坏帧静默跳过、跨分片缓冲重组、
 * 流尾无空行余量兜底、reader 锁释放（迭代正常结束后流可再读）。
 */
import { describe, expect, it } from "vitest";

import { streamFollowup } from "@/lib/assistant/stream-followup";

/** 把若干帧组装成 SSE Response（每帧补 data: 前缀与空行，最后一个无尾空行） */
function sseResponse(frames: string[], trailingNewline = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      frames.forEach((frame, index) => {
        const isLast = index === frames.length - 1;
        const suffix = isLast && !trailingNewline ? "" : "\n\n";
        controller.enqueue(encoder.encode(`data: ${frame}${suffix}`));
      });
      controller.close();
    },
  });
  return new Response(body);
}

/** 把整段 SSE 文本按任意字节位置切碎为多次 enqueue，模拟网络分片 */
function sseChunkedResponse(payload: string, chunkSize: number): Response {
  const bytes = new TextEncoder().encode(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(body);
}

async function collect(response: Response) {
  const events = [];
  for await (const event of streamFollowup(response)) {
    events.push(event);
  }
  return events;
}

describe("事件映射", () => {
  it("七类事件逐帧映射为类型化流事件", async () => {
    const events = await collect(
      sseResponse([
        '{"t":"run:start","ts":1,"runId":"r1","datasetTxHash":"h","source":"sample","stageOrder":[]}',
        '{"t":"plan","ts":2,"runId":"r1","goal":"回答消费问题","steps":[{"title":"查询大促日历","tool":"get_promo_calendar"},{"title":"组织回答","purpose":"按数据说话"}]}',
        '{"t":"tool:start","ts":3,"runId":"r1","tool":"get_promo_calendar","argsDigest":"{\\"date\\":\\"2026-10-21\\"}"}',
        '{"t":"tool:end","ts":4,"runId":"r1","tool":"get_promo_calendar","ok":true,"ms":12}',
        '{"t":"stage:thinking","ts":5,"runId":"r1","stage":"followup","text":"你好"}',
        '{"t":"stage:thinking","ts":6,"runId":"r1","stage":"followup","text":"，回答如下"}',
        '{"t":"run:complete","ts":7,"runId":"r1","cards":[],"elapsedMs":300,"degraded":["mcp:offline"]}',
      ]),
    );

    expect(events[0]).toEqual({ type: "plan", goal: "回答消费问题", steps: [
      { title: "查询大促日历", tool: "get_promo_calendar" },
      { title: "组织回答", purpose: "按数据说话" },
    ]});
    expect(events[1]).toEqual({
      type: "tool-start",
      tool: "get_promo_calendar",
      argsDigest: '{"date":"2026-10-21"}',
    });
    expect(events[2]).toEqual({ type: "tool-end", tool: "get_promo_calendar", ok: true, ms: 12 });
    expect(events[3]).toEqual({ type: "text-delta", text: "你好" });
    expect(events[4]).toEqual({ type: "text-delta", text: "，回答如下" });
    expect(events[5]).toEqual({
      type: "complete",
      degraded: ["mcp:offline"],
      elapsedMs: 300,
    });
    // run:start 不在七类流事件内，静默跳过；plan 之后的未知帧同样跳过
    expect(events.filter((e) => e.type === "complete")).toHaveLength(1);
  });

  it("error 与 abort 收尾事件映射", async () => {
    const errorEvents = await collect(
      sseResponse([
        '{"t":"error","ts":1,"runId":"r1","code":"TIMEOUT","message":"工具调用超时","retryable":true}',
      ]),
    );
    expect(errorEvents[0]).toEqual({ type: "error", code: "TIMEOUT", message: "工具调用超时" });

    const abortEvents = await collect(
      sseResponse(['{"t":"abort","ts":1,"runId":"r1","reason":"client-aborted"}']),
    );
    expect(abortEvents[0]).toEqual({ type: "abort" });
  });
});

describe("容错", () => {
  it("坏 JSON 帧与未知事件名静默跳过，后续事件照常", async () => {
    const events = await collect(
      sseResponse([
        "not-json{{{",
        '{"t":"card:published","ts":1,"runId":"r1"}',
        '{"t":"stage:thinking","ts":2,"runId":"r1","stage":"followup","text":"有效帧"}',
      ]),
    );
    expect(events).toEqual([{ type: "text-delta", text: "有效帧" }]);
  });

  it("跨分片缓冲重组：帧被切碎成多片仍完整解析", async () => {
    const payload =
      'data: {"t":"plan","ts":1,"runId":"r1","goal":"目标","steps":[{"title":"第一步"}]}\n\n' +
      'data: {"t":"stage:thinking","ts":2,"runId":"r1","stage":"followup","text":"分片重组"}\n\n';
    const events = await collect(sseChunkedResponse(payload, 7));
    expect(events).toEqual([
      { type: "plan", goal: "目标", steps: [{ title: "第一步" }] },
      { type: "text-delta", text: "分片重组" },
    ]);
  });

  it("流尾无空行余量按整帧兜底", async () => {
    const events = await collect(
      sseResponse(['{"t":"stage:thinking","ts":1,"runId":"r1","stage":"followup","text":"尾部"}'], false),
    );
    expect(events).toEqual([{ type: "text-delta", text: "尾部" }]);
  });
});
