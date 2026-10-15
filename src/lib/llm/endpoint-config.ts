/**
 * 本地大模型端点配置（08 修订案 A14）。
 *
 * 用户可在 .env.local 配置 OpenAI 兼容的本地端点（如 Ollama 的
 * http://127.0.0.1:11434/v1），接管「追问在线兜底」的 chat 任务——
 * 账单统计与明细改发用户自己指定的本地服务，不出本机。
 * LLM_BASE_URL 与 LLM_MODEL 同时配置才生效；LLM_API_KEY 可选
 * （多数本地端点免鉴权，缺省时以占位 key 满足 SDK 协议要求）。
 * 其余任务（六阶段叙事 / OCR 视觉 / 轻任务）路由不受影响。
 *
 * 端点校验（「账单数据不出本机」承诺的守门）：baseURL 必须能解析为
 * http/https URL，且主机名仅限 loopback 与私网网段——配成公网地址
 * 会把全期统计与明细发往任意主机，解析失败或越界一律视为未配置
 * （宁可回落内置在线兜底，也不把账单发去未知主机）。
 *
 * 注意：本文件不含 server-only 标记，是刻意为之——env 解析为纯函数，
 * 单测（tests/unit/endpoint-config.test.ts）需直接导入；实际调用点
 * 只有 client.ts（server-only 模块），不会进入客户端打包。
 */

export interface LocalEndpointConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
}

/**
 * 主机名白名单：loopback（localhost、127.0.0.0/8、::1）与私网网段
 * （10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）；其余一律拒绝。
 */
function isLocalOrPrivateHost(hostname: string): boolean {
  // IPv6 字面量在 URL.hostname 里带方括号（如 [::1]），先剥掉再比较
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b! === 168)
  );
}

/** 读取本地端点配置；两个必填项任一缺失、URL 非法或主机越界即视为未配置（返回 null） */
export function resolveLocalEndpoint(): LocalEndpointConfig | null {
  const baseURL = process.env.LLM_BASE_URL?.trim();
  const model = process.env.LLM_MODEL?.trim();
  if (!baseURL || !model) return null;
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!isLocalOrPrivateHost(parsed.hostname)) return null;
  const apiKey = process.env.LLM_API_KEY?.trim();
  return apiKey ? { baseURL, model, apiKey } : { baseURL, model };
}
