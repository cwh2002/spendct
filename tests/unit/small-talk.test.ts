/**
 * 闲聊意图分流单测：身份 > 打招呼 > 账单问题（null）。
 * null 时追问面板按既有锚点流程处理，快速记账按金额解析处理。
 */
import { describe, expect, it } from "vitest";

import { classifySmallTalk } from "@/lib/llm/small-talk";

describe("classifySmallTalk 意图分流", () => {
  it("「你好，你是什么大模型」→ identity（身份优先于打招呼）", () => {
    expect(classifySmallTalk("你好，你是什么大模型")).toBe("identity");
  });

  it("「你好」→ greeting", () => {
    expect(classifySmallTalk("你好")).toBe("greeting");
  });

  it("「在吗」→ greeting", () => {
    expect(classifySmallTalk("在吗")).toBe("greeting");
  });

  it("「外卖为什么涨了？」→ null（账单问题走锚点流程）", () => {
    expect(classifySmallTalk("外卖为什么涨了？")).toBeNull();
  });

  it("「这个月吃饭花了多少」→ null", () => {
    expect(classifySmallTalk("这个月吃饭花了多少")).toBeNull();
  });
});
