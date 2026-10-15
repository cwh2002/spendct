/**
 * MCP 接入层单测（src/server/ai/mcp.ts）与本地回退工具（src/server/ai/mcp-fallback.ts）。
 *
 * 覆盖（04 §11 / 07 §18 口径）：
 * 1. callWithBackoff：一次成功 / 可重试错误退避后成功 / 不可重试立即放弃 /
 *    重试耗尽回兜底信封；信封失败属业务结果、正常返回不重试；
 * 2. ToolFailureTracker：连续失败 2 次移除（04 §11 阈值），成功清零计数；
 * 3. parseToolEnvelope / failEnvelopeText / TOOL_REMOVED_NOTICE 信封契约；
 * 4. 本地回退四工具：校历与大促日历的过滤镜像（数据文件单一来源）、天气
 *    诚实降级（unavailable 信封，绝不编造）、元数据回执严格校验
 *    （明细行注入 / 未知表名 / 非法哈希拒绝）。
 */
import { describe, expect, it, vi } from "vitest";

// server-only 是 Next 的打包期标记包，导入即抛（防止进客户端包）；
// 单测运行在 node 下，mock 成空模块以通过模块装配
vi.mock("server-only", () => ({}));

import {
  callWithBackoff,
  failEnvelopeText,
  parseToolEnvelope,
  TOOL_REMOVED_NOTICE,
  ToolFailureTracker,
} from "@/server/ai/mcp";
import {
  FALLBACK_TOOLS,
  getFallbackTool,
  LLM_FALLBACK_TOOL_NAMES,
} from "@/server/ai/mcp-fallback";

import promoCalendarData from "../../mcp-server/src/data/promo-calendar-2026.json";
import schoolCalendarData from "../../mcp-server/src/data/school-calendar-2026-2027.json";

// ─────────────────────────── callWithBackoff ───────────────────────────

describe("callWithBackoff 退避执行器", () => {
  const NO_WAIT = [0, 0] as const;

  it("一次成功：不重试", async () => {
    const result = await callWithBackoff({
      backoffMs: NO_WAIT,
      call: async () => "ok",
      isRetryable: () => true,
      fallbackText: (lastError, retriesUsed) => `${lastError}@${retriesUsed}`,
    });
    expect(result).toEqual({ text: "ok", retriesUsed: 0 });
  });

  it("可重试错误：退避后第二次成功", async () => {
    let attempts = 0;
    const result = await callWithBackoff({
      backoffMs: NO_WAIT,
      call: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("临时网络错误");
        return "recovered";
      },
      isRetryable: () => true,
      fallbackText: () => "不应出现",
    });
    expect(result.text).toBe("recovered");
    expect(result.retriesUsed).toBe(1);
    expect(attempts).toBe(2);
  });

  it("不可重试错误：立即放弃，不消耗退避", async () => {
    let attempts = 0;
    const result = await callWithBackoff({
      backoffMs: NO_WAIT,
      call: async () => {
        attempts += 1;
        throw new Error("参数校验失败");
      },
      isRetryable: () => false,
      fallbackText: (lastError, retriesUsed) => `${lastError}@${retriesUsed}`,
    });
    expect(result.text).toBe("参数校验失败@0");
    expect(result.retriesUsed).toBe(0);
    expect(attempts).toBe(1);
  });

  it("重试耗尽：回兜底信封并报告重试次数", async () => {
    const result = await callWithBackoff({
      backoffMs: NO_WAIT,
      call: async () => {
        throw new Error("网络中断");
      },
      isRetryable: () => true,
      fallbackText: (lastError, retriesUsed) => `${lastError}@${retriesUsed}`,
    });
    expect(result.text).toBe("网络中断@2");
    expect(result.retriesUsed).toBe(2);
  });

  it("信封失败属业务结果：正常返回不重试", async () => {
    const failure = failEnvelopeText("unavailable", "MCP 未连接");
    const result = await callWithBackoff({
      backoffMs: NO_WAIT,
      call: async () => failure,
      isRetryable: () => true,
      fallbackText: () => "不应出现",
    });
    expect(result.text).toBe(failure);
    expect(result.retriesUsed).toBe(0);
  });
});

// ─────────────────────────── ToolFailureTracker ───────────────────────────

describe("ToolFailureTracker 两败移除（04 §11）", () => {
  it("连续失败两次即移除", () => {
    const tracker = new ToolFailureTracker();
    expect(tracker.recordFailure(2)).toBe(false);
    expect(tracker.isRemoved()).toBe(false);
    expect(tracker.recordFailure(2)).toBe(true);
    expect(tracker.isRemoved()).toBe(true);
  });

  it("成功清零连续计数", () => {
    const tracker = new ToolFailureTracker();
    tracker.recordFailure(2);
    tracker.recordSuccess();
    expect(tracker.recordFailure(2)).toBe(false);
    expect(tracker.isRemoved()).toBe(false);
  });

  it("阈值内失败不触发移除，达到阈值才移除", () => {
    const tracker = new ToolFailureTracker();
    expect(tracker.recordFailure(3)).toBe(false);
    expect(tracker.recordFailure(3)).toBe(false);
    expect(tracker.isRemoved()).toBe(false);
    expect(tracker.recordFailure(3)).toBe(true);
  });
});

// ─────────────────────────── 信封契约 ───────────────────────────

describe("parseToolEnvelope 信封解析", () => {
  it("ok:true 信封", () => {
    expect(parseToolEnvelope(`{"ok":true,"data":{"a":1}}`)).toEqual({ ok: true, error: undefined });
  });

  it("ok:false 信封携带错误码", () => {
    expect(parseToolEnvelope(`{"ok":false,"error":{"code":"unavailable","message":"x"}}`)).toEqual({
      ok: false,
      error: { code: "unavailable", message: "x" },
    });
  });

  it("非 JSON 文本 → 不可解析失败信封", () => {
    expect(parseToolEnvelope("不是 JSON")).toEqual({
      ok: false,
      error: { code: "upstream_error", message: "工具返回不可解析" },
    });
  });

  it("缺少 ok 字段 → 失败信封", () => {
    expect(parseToolEnvelope(`{"data":1}`).ok).toBe(false);
  });
});

describe("failEnvelopeText 失败信封", () => {
  it("带 retryAfterSec 时可 JSON 还原", () => {
    const parsed = JSON.parse(failEnvelopeText("upstream_error", "重试耗尽", 4)) as {
      ok: boolean;
      error: { code: string; message: string; retryAfterSec: number };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toEqual({ code: "upstream_error", message: "重试耗尽", retryAfterSec: 4 });
  });

  it("禁用声明非空且提示模型停止调用", () => {
    expect(TOOL_REMOVED_NOTICE).toContain("禁用");
  });
});

// ─────────────────────────── 本地回退工具（L2） ───────────────────────────

/** 校历数据文件（与回退工具同源） */
const schoolFile = schoolCalendarData as unknown as {
  events: Array<{ id: string; type: string; region: string; startDate: string; endDate: string }>;
};
/** 大促日历数据文件（与回退工具同源） */
const promoFile = promoCalendarData as unknown as {
  promotions: Array<{ id: string; startDate: string; endDate: string; platforms: string[] }>;
};

/** 解析回退工具返回的信封 JSON */
function parseEnvelope(text: string): {
  ok: boolean;
  data?: Array<{ id: string }>;
  meta?: { source?: string };
  error?: { code?: string; message?: string };
} {
  return JSON.parse(text) as {
    ok: boolean;
    data?: Array<{ id: string }>;
    meta?: { source?: string };
    error?: { code?: string; message?: string };
  };
}

describe("本地回退工具（L2，mcp-fallback）", () => {
  it("四工具齐备：三模型工具 + 元数据回执；未知名返回 undefined", () => {
    const names = [
      "get_school_calendar",
      "get_weather",
      "get_promo_calendar",
      "query_bill_db_metadata",
    ] as const;
    for (const name of names) {
      expect(getFallbackTool(name)?.name).toBe(name);
    }
    expect(getFallbackTool("unknown_tool")).toBeUndefined();
  });

  it("LLM_FALLBACK_TOOL_NAMES = FALLBACK_TOOLS 去掉协议演示工具", () => {
    expect([...LLM_FALLBACK_TOOL_NAMES].sort()).toEqual(
      FALLBACK_TOOLS.filter((toolImpl) => toolImpl.name !== "query_bill_db_metadata")
        .map((toolImpl) => toolImpl.name)
        .sort(),
    );
  });

  it("校历回退：type/region/date 过滤镜像，来源标注本地回退", () => {
    const tool = getFallbackTool("get_school_calendar");
    expect(tool).toBeDefined();
    const all = parseEnvelope(tool!.execute({}));
    expect(all.ok).toBe(true);
    expect(all.meta?.source).toContain("本地静态回退");
    expect(all.data?.length).toBe(schoolFile.events.length);

    const vacations = parseEnvelope(tool!.execute({ type: "vacation" }));
    expect(vacations.ok).toBe(true);
    expect(vacations.data?.length).toBe(schoolFile.events.filter((e) => e.type === "vacation").length);

    // 日期闭区间与 region 过滤：以数据文件首个事件自身为探针，断言命中
    const probe = schoolFile.events[0];
    expect(probe).toBeDefined();
    const onDay = parseEnvelope(tool!.execute({ date: probe!.startDate }));
    expect(onDay.data?.some((event) => event.id === probe!.id)).toBe(true);
    const byRegion = parseEnvelope(tool!.execute({ region: probe!.region }));
    expect(byRegion.data?.some((event) => event.id === probe!.id)).toBe(true);
  });

  it("大促日历回退：date/platform 过滤镜像", () => {
    const tool = getFallbackTool("get_promo_calendar");
    expect(tool).toBeDefined();
    const probe = promoFile.promotions[0];
    expect(probe).toBeDefined();
    const onDay = parseEnvelope(tool!.execute({ date: probe!.startDate }));
    expect(onDay.ok).toBe(true);
    expect(onDay.data?.some((promotion) => promotion.id === probe!.id)).toBe(true);
    const platform = probe!.platforms[0];
    expect(platform).toBeDefined();
    const byPlatform = parseEnvelope(tool!.execute({ platform: platform! }));
    expect(byPlatform.data?.some((promotion) => promotion.id === probe!.id)).toBe(true);
  });

  it("天气回退：诚实降级 unavailable，绝不编造天气", () => {
    const tool = getFallbackTool("get_weather");
    expect(tool).toBeDefined();
    const envelope = parseEnvelope(tool!.execute({ city: "北京" }));
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe("unavailable");
    expect(envelope.error?.message).toContain("天气");
  });

  // 指纹口径与导入层 hashCleanRows 一致：SHA-256 前 16 位十六进制
  const VALID_SNAPSHOT = {
    table: "transactions",
    rowCount: 793,
    datasetTxHash: "a".repeat(16),
    schema: [{ name: "amount_cents", type: "BIGINT", sample: "1234" }],
    stats: [{ column: "amount_cents", min: 1, max: 2, mean: 1.5, distinct: 3 }],
  };

  it("元数据回执：合法快照 → ok 信封", () => {
    const tool = getFallbackTool("query_bill_db_metadata");
    expect(tool).toBeDefined();
    const envelope = parseEnvelope(tool!.execute(VALID_SNAPSHOT));
    expect(envelope.ok).toBe(true);
    expect(envelope.meta?.source).toContain("本地回退");
  });

  it("元数据回执：明细行注入被严格校验拒绝", () => {
    const tool = getFallbackTool("query_bill_db_metadata");
    const envelope = parseEnvelope(
      tool!.execute({ ...VALID_SNAPSHOT, rows: [{ amount_cents: 1 }] }),
    );
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe("invalid_input");
  });

  it("元数据回执：merchants 表名在枚举内；未知表名与非法哈希被拒", () => {
    const tool = getFallbackTool("query_bill_db_metadata");
    expect(parseEnvelope(tool!.execute({ ...VALID_SNAPSHOT, table: "merchants" })).ok).toBe(true);
    expect(parseEnvelope(tool!.execute({ ...VALID_SNAPSHOT, table: "bills" })).ok).toBe(false);
    expect(
      parseEnvelope(tool!.execute({ ...VALID_SNAPSHOT, datasetTxHash: "xyz" })).ok,
    ).toBe(false);
  });
});
