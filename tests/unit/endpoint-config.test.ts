/**
 * 本地大模型端点配置（08 修订案 A14）单测：
 * LLM_BASE_URL + LLM_MODEL 同时配置才生效；apiKey 可选；空白值视为未配置；
 * 主机白名单校验——公网地址 / 非法 URL / 非 http(s) 协议一律视为未配置
 * （账单数据不出本机的守门，配置错误宁可回落内置兜底）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveLocalEndpoint } from "@/lib/llm/endpoint-config";

const BASE = "LLM_BASE_URL";
const MODEL = "LLM_MODEL";
const KEY = "LLM_API_KEY";

// 保存三个变量的原值、用毕恢复：测试结果既不依赖开发机环境（带 LLM_* 变量
// 时首个用例即失败），也不依赖用例执行顺序
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { [BASE]: process.env[BASE], [MODEL]: process.env[MODEL], [KEY]: process.env[KEY] };
  delete process.env[BASE];
  delete process.env[MODEL];
  delete process.env[KEY];
});
afterEach(() => {
  for (const name of [BASE, MODEL, KEY]) {
    const original = saved[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe("resolveLocalEndpoint（env → 本地端点配置）", () => {
  it("两个必填项齐全时返回配置（免鉴权端点无 apiKey）", () => {
    process.env[BASE] = "http://127.0.0.1:11434/v1";
    process.env[MODEL] = "qwen3:8b";
    expect(resolveLocalEndpoint()).toEqual({
      baseURL: "http://127.0.0.1:11434/v1",
      model: "qwen3:8b",
    });
  });

  it("配置了 LLM_API_KEY 时一并返回", () => {
    process.env[BASE] = "http://localhost:8080/v1";
    process.env[MODEL] = "llama3";
    process.env[KEY] = "sk-local";
    expect(resolveLocalEndpoint()).toEqual({
      baseURL: "http://localhost:8080/v1",
      model: "llama3",
      apiKey: "sk-local",
    });
  });

  it("任一必填项缺失即视为未配置（返回 null）", () => {
    expect(resolveLocalEndpoint()).toBeNull();
    process.env[BASE] = "http://127.0.0.1:11434/v1";
    expect(resolveLocalEndpoint()).toBeNull();
    delete process.env[BASE];
    process.env[MODEL] = "qwen3:8b";
    expect(resolveLocalEndpoint()).toBeNull();
  });

  it("空白值按未配置处理", () => {
    process.env[BASE] = "  ";
    process.env[MODEL] = "";
    expect(resolveLocalEndpoint()).toBeNull();
  });

  it("私网网段与 IPv6 loopback 均放行", () => {
    process.env[MODEL] = "qwen3:8b";
    process.env[BASE] = "http://192.168.1.20:8080/v1";
    expect(resolveLocalEndpoint()?.baseURL).toBe("http://192.168.1.20:8080/v1");
    process.env[BASE] = "http://10.0.0.5:11434/v1";
    expect(resolveLocalEndpoint()?.baseURL).toBe("http://10.0.0.5:11434/v1");
    process.env[BASE] = "http://[::1]:8080/v1";
    expect(resolveLocalEndpoint()?.baseURL).toBe("http://[::1]:8080/v1");
  });

  it("公网地址视为未配置（账单数据不出本机）", () => {
    process.env[BASE] = "https://api.deepseek.com/v1";
    process.env[MODEL] = "deepseek-chat";
    expect(resolveLocalEndpoint()).toBeNull();
    process.env[BASE] = "http://example.com:8080/v1";
    expect(resolveLocalEndpoint()).toBeNull();
  });

  it("非法 URL 与非 http(s) 协议视为未配置", () => {
    process.env[MODEL] = "qwen3:8b";
    process.env[BASE] = "不是网址";
    expect(resolveLocalEndpoint()).toBeNull();
    process.env[BASE] = "ftp://127.0.0.1:21/v1";
    expect(resolveLocalEndpoint()).toBeNull();
    process.env[BASE] = "127.0.0.1:11434/v1";
    expect(resolveLocalEndpoint()).toBeNull();
  });
});
