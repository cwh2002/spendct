/**
 * 在线兜底失败提示分档单测（08 修订案 A18 热修复五轮 + 复审修补）。
 * 锁定各档文案口径：未配置/失效密钥给出配置指引并声明系统自动接入
 * （用户无需手动连接大模型）；超时/网络/HTTP/额度错误分别提示原因；
 * 默认档不再保留「需要连接在线服务才能回答」的旧句。全部档位都携带
 * 本地可答示例问题。
 * 复审修补锁定：超时档不归因网络、网络档不透传服务端 detail（防自
 * 重复）、HTTP 400 是确定性失败不提示重试、QUOTA_EXCEEDED 新档。
 */
import { describe, expect, it } from "vitest";

import {
  mapErrorCode,
  onlineErrorNote,
  onlineFailureTipText,
} from "@/lib/assistant/online-failure-text";

describe("在线失败提示分档", () => {
  it("SSE error code 映射失败原因", () => {
    expect(mapErrorCode("LLM_EXHAUSTED")).toBe("LLM_EXHAUSTED");
    expect(mapErrorCode("TIMEOUT")).toBe("TIMEOUT");
    expect(mapErrorCode("NETWORK_OFFLINE")).toBe("NETWORK_OFFLINE");
    expect(mapErrorCode("QUOTA_EXCEEDED")).toBe("QUOTA_EXCEEDED");
    expect(mapErrorCode("BAD_REQUEST")).toBe("HTTP_ERROR");
    expect(mapErrorCode(undefined)).toBe("UNKNOWN");
  });

  it("未配置密钥：给配置指引并声明系统自动接入、无需手动连接", () => {
    const text = onlineFailureTipText("LLM_EXHAUSTED");
    expect(text).toContain("DEEPSEEK_API_KEY");
    expect(text).toContain("无需手动连接");
    // 不复写部署路径：不把 .env.local 操作指引发给终端用户
    expect(text).not.toContain(".env.local");
    expect(text).not.toContain("重启服务");
  });

  it("密钥无效/过期与未配置分态：服务端消息可区分两态", () => {
    const invalid = onlineFailureTipText("LLM_EXHAUSTED", "模型密钥无效或已过期，请检查 DEEPSEEK_API_KEY");
    expect(invalid).toContain("无效或已过期");
    const missing = onlineFailureTipText("LLM_EXHAUSTED");
    expect(missing).toContain("尚未配置");
  });

  it("网络/超时/HTTP/额度错误各自带原因说明", () => {
    expect(onlineFailureTipText("NETWORK_OFFLINE")).toContain("检查网络");
    expect(onlineFailureTipText("TIMEOUT")).toContain("响应超时");
    expect(onlineFailureTipText("HTTP_ERROR", "503")).toContain("HTTP 503");
    expect(onlineFailureTipText("QUOTA_EXCEEDED")).toContain("额度");
  });

  it("超时档不归因网络：停滞可能是本地阶段慢或响应慢，不能引导检查网络", () => {
    const text = onlineFailureTipText("TIMEOUT", "可能网络不通或服务未启动");
    expect(text).not.toContain("网络");
    expect(text).not.toContain("服务未启动");
  });

  it("网络档不透传服务端 detail：不自重复主句、不嵌套括号", () => {
    const text = onlineFailureTipText("NETWORK_OFFLINE", "在线服务请求失败");
    expect(text).not.toContain("（在线服务请求失败）");
    expect(text).not.toContain("（（");
  });

  it("HTTP 400 是确定性失败：不提示「稍后重试」，其余状态码才提示", () => {
    const badRequest = onlineFailureTipText("HTTP_ERROR", "400");
    expect(badRequest).toContain("HTTP 400");
    expect(badRequest).not.toContain("稍后重试");
    expect(badRequest).toContain("本地能算");
    const serverError = onlineFailureTipText("HTTP_ERROR", "502");
    expect(serverError).toContain("HTTP 502");
    expect(serverError).toContain("稍后重试");
  });

  it("默认档不再使用「需要连接在线服务才能回答」旧句（热修复五轮要淘汰的模糊句式）", () => {
    const text = onlineFailureTipText("UNKNOWN");
    expect(text).not.toContain("需要连接在线服务才能回答");
    expect(text).toContain("在线服务暂时不可用");
    expect(text).toContain("无需手动操作");
  });

  it("各档都携带本地可答示例问题", () => {
    for (const kind of [
      "LLM_EXHAUSTED",
      "TIMEOUT",
      "NETWORK_OFFLINE",
      "HTTP_ERROR",
      "QUOTA_EXCEEDED",
      "UNKNOWN",
    ] as const) {
      expect(onlineFailureTipText(kind)).toContain("这个月花了多少");
    }
  });

  it("错误补注按 code 给出原因（半截回答的收尾说明）", () => {
    expect(onlineErrorNote("LLM_EXHAUSTED")).toContain("未配置或已失效");
    expect(onlineErrorNote("LLM_EXHAUSTED")).toContain("再问一次");
    expect(onlineErrorNote("TIMEOUT")).toContain("超时");
    expect(onlineErrorNote("NETWORK_OFFLINE")).toContain("网络异常");
    expect(onlineErrorNote("QUOTA_EXCEEDED")).toContain("额度");
    expect(onlineErrorNote(undefined)).toContain("在线服务出错");
  });
});
