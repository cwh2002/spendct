/**
 * OCR 视觉接入层单测（src/server/ocr/vision.ts）。
 *
 * 覆盖：容错 JSON 提取（<think> 剥离 / markdown 围栏 / 首尾花括号截取 /
 * 不可解析返回 null）与运行模式判定（mock 的三种触发口径）。
 * 网关调用与 15s 超时走 e2e 与 private-benchmark 探针（live 网络路径，
 * 单测不 mock fetch 断言实现细节）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// server-only 是 Next 的打包期标记包，导入即抛（防止进客户端包）；
// 单测运行在 node 下，mock 成空模块以通过模块装配
vi.mock("server-only", () => ({}));

import { extractJsonObject, resolveOcrMode } from "@/server/ocr/vision";

describe("extractJsonObject 容错提取", () => {
  it("纯 JSON 直接解析", () => {
    const text = '{"transactions":[]}';
    expect(extractJsonObject(text)).toEqual({ transactions: [] });
  });

  it("markdown 围栏剥离", () => {
    const text = '```json\n{"transactions":[]}\n```';
    expect(extractJsonObject(text)).toEqual({ transactions: [] });
  });

  it("<think> 推理段剥离（SiliconFlow 思考模型产物）", () => {
    const text =
      "<think>先看图，再逐行提取</think>\n{\"transactions\":[]}";
    expect(extractJsonObject(text)).toEqual({ transactions: [] });
  });

  it("前后杂质截取首尾花括号", () => {
    const text = '好的，识别结果如下：{"transactions":[]} 已按行序输出';
    expect(extractJsonObject(text)).toEqual({ transactions: [] });
  });

  it("嵌套对象取最外层（lastIndexOf 收尾）", () => {
    const text = '{"a":{"b":1}}';
    expect(extractJsonObject(text)).toEqual({ a: { b: 1 } });
  });

  it("无花括号 / JSON 损坏返回 null", () => {
    expect(extractJsonObject("没有 JSON")).toBeNull();
    expect(extractJsonObject('{"transactions": [}')).toBeNull();
  });
});

describe("resolveOcrMode 运行模式判定（07 §7 局部判定）", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("DEMO_MODE=mock 强制 mock", () => {
    process.env.DEMO_MODE = "mock";
    process.env.GLM_API_KEY = "sk-test";
    expect(resolveOcrMode()).toBe("mock");
  });

  it("任一视觉 key 存在即 live", () => {
    delete process.env.DEMO_MODE;
    delete process.env.GLM_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    process.env.GLM_API_KEY = "sk-test";
    expect(resolveOcrMode()).toBe("live");
  });

  it("双视觉 key 全缺 → mock（零密钥部署演示可跑）", () => {
    delete process.env.DEMO_MODE;
    delete process.env.GLM_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    expect(resolveOcrMode()).toBe("mock");
  });
});
