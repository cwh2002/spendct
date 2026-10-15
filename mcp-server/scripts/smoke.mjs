/**
 * MCP 握手冒烟：拉起本地 Streamable HTTP 服务（端口 3199），
 * 依次执行 initialize → notifications/initialized → tools/list → 一个 tools/call，
 * 校验四工具注册齐全、信封结构正确，随后回收进程。
 *
 * 用法：node scripts/smoke.mjs（由 pnpm run smoke 调用）
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:3199";

const HEADERS = {
  "Content-Type": "application/json",
  // 无状态 Streamable HTTP 要求客户端声明 JSON 与 SSE 两种响应类型
  Accept: "application/json, text/event-stream",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // 服务尚未就绪，继续轮询
    }
    await sleep(200);
  }
  throw new Error("服务未在超时内就绪（/healthz 无响应）");
}

/** 从 SSE 文本中提取 data: 行并拼接 JSON */
function parseSseBody(text) {
  const dataLines = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  return JSON.parse(dataLines.join(""));
}

async function rpc(method, params, id) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) {
    throw new Error(`POST /mcp 返回 HTTP ${res.status}`);
  }
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  // 服务端开启 enableJsonResponse 后回 JSON；兜底兼容 SSE 形态
  return contentType.includes("text/event-stream") ? parseSseBody(text) : JSON.parse(text);
}

async function main() {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/index.ts"],
    {
      cwd: pkgRoot,
      env: { ...process.env, PORT: "3199", HOST: "127.0.0.1", DEMO_MODE: "mock" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server:err] ${chunk}`));

  try {
    await waitHealthy();

    const init = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    }, 1);
    console.log("[smoke] initialize ->", JSON.stringify(init.result?.serverInfo));
    if (!init.result?.serverInfo?.name) throw new Error("initialize 未返回 serverInfo");

    await rpc("notifications/initialized", undefined, 2);

    const list = await rpc("tools/list", undefined, 3);
    const names = (list.result?.tools ?? []).map((t) => t.name).sort();
    console.log("[smoke] tools/list ->", names.join(", "));
    const expected = [
      "get_promo_calendar",
      "get_school_calendar",
      "get_weather",
      "query_bill_db_metadata",
    ];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`工具集不符：期望 ${expected.join(",")}，实际 ${names.join(",")}`);
    }

    const call = await rpc("tools/call", {
      name: "get_school_calendar",
      arguments: { type: "vacation" },
    }, 4);
    const text = call.result?.content?.[0]?.text;
    const envelope = JSON.parse(text);
    console.log("[smoke] tools/call(get_school_calendar) ->", JSON.stringify(envelope).slice(0, 160), "...");
    if (envelope.ok !== true || !Array.isArray(envelope.data) || envelope.data.length === 0) {
      throw new Error("校历工具调用未返回 ok 信封或数据为空");
    }

    console.log("[smoke] 握手与工具调用全部通过 ✓");
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error("[smoke] 失败：", err.message);
  process.exitCode = 1;
});
