/**
 * 工具 get_weather：城市天气查询（契约见 docs/04-rag-mcp.md §8.2）。
 *
 * 上游为和风天气开发接口（devapi.qweather.com），策略如下：
 *   - 单请求 4s 超时（AbortController）；
 *   - HTTP 429 / 5xx 按 1s/2s/4s 指数退避重试，重试耗尽后返回 upstream_error
 *     并携带 retryAfterSec 建议；
 *   - 结果按「城市 + 天数」缓存 30 分钟，避免同一追问会话内重复计费；
 *   - 未配置 QWEATHER_API_KEY 时：DEMO_MODE=mock 返回明确标注的演示模拟数据，
 *     否则返回 unavailable（诚实降级，绝不静默编造真实天气）。
 *
 * 注意：演示模拟数据仅用于无密钥环境下的演示口径验证，返回信封的
 * meta.source 中会明确标注「演示模拟」，避免与真实数据混淆。
 */
import { z } from "zod";
import { readJson } from "../data/load.js";
import { failResult, okResult, type ToolResult } from "../types.js";

export const WEATHER_DAYS = [3, 7] as const;
export type WeatherDays = (typeof WEATHER_DAYS)[number];

export interface WeatherCity {
  cityId: string;
  city: string;
}

export interface WeatherDaily {
  date: string; // YYYY-MM-DD
  textDay: string; // 白天天气现象文字
  tempMin: number;
  tempMax: number;
  humidity: number; // 相对湿度 %
}

export interface WeatherData {
  cityId: string;
  city: string;
  days: WeatherDays;
  daily: WeatherDaily[];
}

interface CityTableData {
  version: string;
  source: string;
  cities: WeatherCity[];
}

/** MCP inputSchema（原始 shape，由 SDK 包装为 zod 对象） */
export const weatherInputShape = {
  cityId: z
    .string()
    .regex(/^\d{9}$/, "cityId 为 9 位城市编码")
    .optional()
    .describe("和风天气城市编码（与 city 二选一，同时提供时以 cityId 为准）"),
  city: z.string().max(32).optional().describe("城市名（支持列表见数据文件）"),
  days: z
    .union([z.literal(3), z.literal(7)])
    .optional()
    .describe("预报天数：3 或 7，缺省 3"),
} as const;

export interface WeatherArgs {
  cityId?: string;
  city?: string;
  days?: WeatherDays;
}

/** 和风天气 v7 逐日预报响应（仅声明用到的字段） */
interface QweatherDailyResponse {
  code: string;
  daily?: Array<{
    fxDate: string;
    textDay: string;
    tempMin: string;
    tempMax: string;
    humidity: string;
  }>;
}

const QWEATHER_HOST = "https://devapi.qweather.com";
const REQUEST_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 30 * 60_000;
/** 429 / 5xx 的指数退避序列，重试耗尽后返回失败 */
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];

interface CacheEntry {
  at: number;
  result: ToolResult<WeatherData>;
}

/** 进程内缓存：键为 `${cityId}:${days}` */
const weatherCache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 演示模拟数据：按城市表序号确定性地生成，保证同城同天结果稳定（便于演示与断言） */
const MOCK_PATTERNS = [
  { textDay: "晴", humidity: 42 },
  { textDay: "多云", humidity: 61 },
  { textDay: "阴", humidity: 74 },
] as const;

function buildMockDaily(cityIndex: number, days: WeatherDays): WeatherDaily[] {
  const base = 14 + (cityIndex % 8) * 2;
  const result: WeatherDaily[] = [];
  const cursor = new Date();
  for (let i = 0; i < days; i++) {
    cursor.setDate(cursor.getDate() + (i === 0 ? 0 : 1));
    const pattern = MOCK_PATTERNS[(cityIndex + i) % MOCK_PATTERNS.length];
    result.push({
      date: toIsoDate(cursor),
      textDay: pattern.textDay,
      tempMin: base - 4 + i,
      tempMax: base + 5 + i,
      humidity: pattern.humidity,
    });
  }
  return result;
}

/** 带超时与退避的上游请求；返回信封形态，调用方无需再包一层 */
async function fetchQweatherDaily(
  cityId: string,
  days: WeatherDays,
  key: string,
): Promise<ToolResult<WeatherData>> {
  const url = `${QWEATHER_HOST}/v7/weather/${days}d?location=${cityId}&key=${encodeURIComponent(key)}`;
  let lastError = "未知错误";

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        // 服务繁忙：退避后重试
        lastError = `和风天气服务繁忙（HTTP ${res.status}）`;
        continue;
      }
      if (!res.ok) {
        return failResult("upstream_error", `和风天气返回 HTTP ${res.status}`);
      }
      const body = (await res.json()) as QweatherDailyResponse;
      if (body.code !== "200" || !body.daily || body.daily.length === 0) {
        return failResult("upstream_error", `和风天气业务错误码 ${body.code}`);
      }
      const daily: WeatherDaily[] = body.daily.map((d) => ({
        date: d.fxDate,
        textDay: d.textDay,
        tempMin: Number(d.tempMin),
        tempMax: Number(d.tempMax),
        humidity: Number(d.humidity),
      }));
      return okResult(
        { cityId, city: "", days, daily } satisfies WeatherData,
        "和风天气 QWeather（devapi.qweather.com）",
      );
    } catch (err) {
      if (controller.signal.aborted) {
        return failResult("timeout", "和风天气响应超时（4s）");
      }
      // 网络错误同样走退避重试
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  return failResult(
    "upstream_error",
    `和风天气请求失败（重试 ${RETRY_BACKOFF_MS.length} 次后放弃）：${lastError}`,
    RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] / 1000,
  );
}

export async function getWeather(args: WeatherArgs): Promise<ToolResult<WeatherData>> {
  const cities = readJson<CityTableData>("city-weather-id.json").cities;

  // 城市解析：cityId 优先，其次城市名；两者都缺或匹配不到视为入参错误
  let city: WeatherCity | undefined;
  if (args.cityId !== undefined) {
    city = cities.find((c) => c.cityId === args.cityId);
  } else if (args.city !== undefined) {
    city = cities.find((c) => c.city === args.city);
  } else {
    return failResult("invalid_input", "需提供 cityId 或 city 之一");
  }
  if (!city) {
    return failResult(
      "invalid_input",
      `城市不在支持列表（当前支持 ${cities.length} 个城市，见 tools/list 的输入说明）`,
    );
  }

  const days: WeatherDays = args.days ?? 3;
  const cacheKey = `${city.cityId}:${days}`;
  const hit = weatherCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.result;
  }

  const mode = process.env.DEMO_MODE;
  const key = process.env.QWEATHER_API_KEY;
  let result: ToolResult<WeatherData>;

  if (mode === "mock") {
    // 演示模式：无论是否配置密钥，一律返回明确标注的模拟数据，保证演示口径一致
    result = okResult(
      {
        cityId: city.cityId,
        city: city.city,
        days,
        daily: buildMockDaily(cities.indexOf(city), days),
      } satisfies WeatherData,
      "演示模拟（DEMO_MODE=mock，非真实天气）",
    );
  } else if (!key) {
    result = failResult(
      "unavailable",
      "未配置 QWEATHER_API_KEY，且未开启 DEMO_MODE=mock，无法查询真实天气",
    );
  } else {
    const fetched = await fetchQweatherDaily(city.cityId, days, key);
    if (fetched.ok) {
      // 回填城市名后再进缓存
      fetched.data.city = city.city;
    }
    result = fetched;
  }

  weatherCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

/** 供单测重置缓存 */
export function resetWeatherCache(): void {
  weatherCache.clear();
}
