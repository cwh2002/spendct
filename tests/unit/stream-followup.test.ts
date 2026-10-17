/**
 * /api/followup SSE 流解析器单测（src/lib/assistant/stream-followup.ts，07 §2 + A12）。
 *
 * 覆盖帧级解析层：
 * 1. data 帧按事件类型映射（stage:thinking → text-delta、run:complete → complete）；
 * 2. 服务端注释心跳帧（「: keepalive」）→ keepalive 事件（A18 热修复四轮，
 *    面板借此重置流内停滞计时）；
 * 3. 坏 JSON / 不认识的事件帧静默跳过，不阻断后续事件；
 * 4. 流结束仍有未分帧余量时按整帧兜底。
 */
import { describe, expect, it } from "vitest";

import { streamFollowup, type FollowupStreamEvent } from "@/lib/assistant/stream-followup";

/** 把若干 SSE 帧拼成 Response（帧间以协议空行分隔，流正常收尾） */
function sseResponse(...frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(`${frame}\n\n`));
      controller.close();
    },
  });
  return new Response(body);
}

/** 消费整个响应流，收集全部流事件 */
async function collect(response: Response): Promise<FollowupStreamEvent[]> {
  const events: FollowupStreamEvent[] = [];
  for await (const event of streamFollowup(response)) events.push(event);
  return events;
}

describe("streamFollowup（SSE 帧级解析）", () => {
  it("data 帧按事件类型映射：stage:thinking → text-delta，run:complete → complete", async () => {
    const events = await collect(
      sseResponse(
        `data: {"t":"stage:thinking","text":"你好"}`,
        `data: {"t":"run:complete","runId":"fup-1","elapsedMs":12}`,
      ),
    );
    expect(events).toEqual([
      { type: "text-delta", text: "你好" },
      { type: "complete", elapsedMs: 12 },
    ]);
  });

  it("服务端注释心跳帧映射为 keepalive 事件（面板借此重置停滞计时）", async () => {
    const events = await collect(
      sseResponse(
        `: keepalive`,
        `data: {"t":"stage:thinking","text":"思考中"}`,
        `: keepalive`,
        `data: {"t":"run:complete"}`,
      ),
    );
    expect(events.map((event) => event.type)).toEqual([
      "keepalive",
      "text-delta",
      "keepalive",
      "complete",
    ]);
  });

  it("坏 JSON 帧与不认识的帧静默跳过，不阻断后续事件", async () => {
    const events = await collect(
      sseResponse(
        `data: {oops`,
        `data: {"t":"unknown-event"}`,
        `data: {"t":"stage:thinking","text":"仍在"}`,
      ),
    );
    expect(events).toEqual([{ type: "text-delta", text: "仍在" }]);
  });

  it("流结束仍有未分帧余量时按整帧兜底（最后一帧缺空行）", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"t":"stage:thinking","text":"尾帧"}`));
        controller.close();
      },
    });
    const events = await collect(new Response(body));
    expect(events).toEqual([{ type: "text-delta", text: "尾帧" }]);
  });
});
