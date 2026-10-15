/**
 * get_weather 测试（docs/04-rag-mcp.md §8.2）：
 * 城市解析、mock 降级、缓存、上游退避与超时。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWeather, resetWeatherCache } from "../src/tools/weather.js";

const REAL_KEY = "test-qweather-key";

describe("get_weather", () => {
  beforeEach(() => {
    resetWeatherCache();
    delete process.env.DEMO_MODE;
    delete process.env.QWEATHER_API_KEY;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    resetWeatherCache();
    delete process.env.DEMO_MODE;
    delete process.env.QWEATHER_API_KEY;
    vi.unstubAllGlobals();
  });

  it("城市解析：cityId 命中且缺省天数取 3", async () => {
    process.env.DEMO_MODE = "mock";
    const result = await getWeather({ cityId: "101010100" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.city).toBe("北京");
    expect(result.data.days).toBe(3);
    expect(result.data.daily).toHaveLength(3);
  });

  it("城市解析：city 名命中；cityId 与 city 同时提供时以 cityId 为准", async () => {
    process.env.DEMO_MODE = "mock";
    const byName = await getWeather({ city: "上海" });
    if (!byName.ok) throw new Error("信封应为 ok");
    expect(byName.data.cityId).toBe("101020100");

    const both = await getWeather({ cityId: "101280101", city: "北京" });
    if (!both.ok) throw new Error("信封应为 ok");
    expect(both.data.city).toBe("广州");
  });

  it("不支持的城市返回 invalid_input；两个入参都缺同样返回 invalid_input", async () => {
    process.env.DEMO_MODE = "mock";
    const unknown = await getWeather({ city: "火星" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("invalid_input");

    const empty = await getWeather({});
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("invalid_input");
  });

  it("mock 模式结果确定性：同城同参两次调用逐字段一致", async () => {
    process.env.DEMO_MODE = "mock";
    const first = await getWeather({ cityId: "101230201", days: 7 });
    const second = await getWeather({ cityId: "101230201", days: 7 });
    if (!first.ok || !second.ok) throw new Error("信封应为 ok");
    expect(first.data).toEqual(second.data);
    expect(first.meta.source).toContain("演示模拟");
  });

  it("未配置密钥且非 mock 模式时返回 unavailable（诚实降级）", async () => {
    const result = await getWeather({ cityId: "101010100" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unavailable");
  });

  it("429 后重试成功：fetch 第一次返回 429，第二次返回 200", async () => {
    process.env.QWEATHER_API_KEY = REAL_KEY;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return new Response("busy", { status: 429 });
        }
        return new Response(
          JSON.stringify({
            code: "200",
            daily: [
              {
                fxDate: "2026-10-16",
                textDay: "晴",
                tempMin: "10",
                tempMax: "20",
                humidity: "40",
              },
              {
                fxDate: "2026-10-17",
                textDay: "多云",
                tempMin: "11",
                tempMax: "21",
                humidity: "55",
              },
              {
                fxDate: "2026-10-18",
                textDay: "阴",
                tempMin: "12",
                tempMax: "19",
                humidity: "70",
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await getWeather({ cityId: "101010100", days: 3 });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    if (!result.ok) return;
    expect(result.data.daily[0]).toEqual({
      date: "2026-10-16",
      textDay: "晴",
      tempMin: 10,
      tempMax: 20,
      humidity: 40,
    });
    expect(result.meta.source).toContain("和风天气");
  });

  it("持续 5xx：按 1s/2s/4s 退避重试后返回 upstream_error 并携带 retryAfterSec", async () => {
    process.env.QWEATHER_API_KEY = REAL_KEY;
    vi.useFakeTimers();
    try {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          calls++;
          return new Response("boom", { status: 503 });
        }),
      );

      const pending = getWeather({ cityId: "101010100" });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("upstream_error");
        expect(result.error.retryAfterSec).toBe(4);
      }
      // 初次请求 + 3 次退避重试 = 4 次
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("缓存命中：30 分钟内同城同参只请求一次上游", async () => {
    process.env.QWEATHER_API_KEY = REAL_KEY;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            code: "200",
            daily: [
              {
                fxDate: "2026-10-16",
                textDay: "晴",
                tempMin: "10",
                tempMax: "20",
                humidity: "40",
              },
              {
                fxDate: "2026-10-17",
                textDay: "多云",
                tempMin: "11",
                tempMax: "21",
                humidity: "55",
              },
              {
                fxDate: "2026-10-18",
                textDay: "阴",
                tempMin: "12",
                tempMax: "19",
                humidity: "70",
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const first = await getWeather({ cityId: "101010100" });
    const second = await getWeather({ cityId: "101010100" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);
  });
});
