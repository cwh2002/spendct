/**
 * OCR 视觉模型接入层（07 §11 降级链的服务端实现，02 §12.2 隐私硬约定）。
 *
 * 降级链（07 §11，08 修订案 A11 更新）：DeepSeek deepseek-flash（原生多模态）
 * → 智谱 glm-4.6v-flash → SiliconFlow 版 GLM 视觉模型 → 三败返回 { ok:false }
 * 信封，由路由层转 502/503/504，UI 引导改用 CSV。
 * 每次识别整体 15s 超时（02 §12.2 ④），路由 maxDuration=20 兜底。
 *
 * 模型选择说明（实现注记，收口时同步 07 §11）：
 * 契约原主供应商为「智谱 GLM-4V-Flash」。实测两条路线均被产品约束改写：
 * - 智谱官方文档明确 glm-4v-flash 不支持 base64 图片（仅公网 URL 传图），
 *   与本产品「截图仅本次请求内存、不落任何存储」的隐私硬约束冲突；
 *   同系 glm-4.6v-flash 支持 base64 data URL，故智谱位默认模型取
 *   glm-4.6v-flash，可用 GLM_VISION_MODEL 覆盖；
 * - DeepSeek 于 2026-09-10 发布 deepseek-flash（V4.1 Flash，CED 架构）
 *   原生支持视觉，API 模型名 deepseek-flash，OpenAI 兼容接口 + base64
 *   内联（单图 ≤32MiB），与既有 DEEPSEEK_API_KEY 共用同一把密钥，
 *   2026-10-15 本地实测三行文字逐行全对 → 提升为主供应商（DEEPSEEK_VISION_MODEL
 *   可覆盖，默认 deepseek-flash）。
 * 三个网关的视觉模型均不支持 response_format=json_object，JSON 输出由
 * 提示词约束 + 容错提取（围栏剥离、<think> 剥离、首尾花括号截取）兜底。
 *
 * 隐私硬约束（02 §12.2，code review 检查项）：
 * - 图片字节只在本次调用内存中存活（base64 编码后直接进请求体，响应后随 GC 释放）；
 * - 本模块不写任何 fs、不打印图片字节与提示词内容。
 */
import "server-only";

import {
  OCR_REVIEW_FIELDS,
  OcrResultSchema,
  type OcrResult,
  type OcrReviewCell,
  type OcrTransactionRow,
} from "@/lib/schema/ocr";

/** DeepSeek 网关默认地址（DEEPSEEK_BASE_URL 可覆盖，07 §12 env 唯一清单） */
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
/** 智谱网关默认地址（GLM_BASE_URL 可覆盖，07 §12 env 唯一清单） */
const ZHIPU_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
/** SiliconFlow 网关默认地址（SILICONFLOW_BASE_URL 可覆盖） */
const SILICONFLOW_DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
/** DeepSeek 默认视觉模型：V4.1 Flash 原生多模态（DEEPSEEK_VISION_MODEL 可覆盖） */
const DEFAULT_DEEPSEEK_VISION_MODEL = "deepseek-flash";
/** 智谱默认视觉模型（理由见文件头）：GLM-4V 系 flash 档、支持 base64 */
const DEFAULT_GLM_VISION_MODEL = "glm-4.6v-flash";
/** SiliconFlow 在架的 GLM 视觉模型（SILICONFLOW_VISION_MODEL 可覆盖） */
const DEFAULT_SILICONFLOW_VISION_MODEL = "THUDM/GLM-4.1V-9B-Thinking";

/** 识别整体超时（02 §12.2 ④：15s 中断回传 OCR_TIMEOUT） */
export const OCR_TIMEOUT_MS = 15_000;

/** 单网关生成上限 token：多行账单需要余量（两个视觉模型均无 json_object 模式） */
const VISION_MAX_TOKENS = 4096;

/** 识别失败的三种终态错误码（路由层映射 HTTP 状态：504/503/502） */
export type OcrErrorCode = "OCR_TIMEOUT" | "OCR_UNAVAILABLE" | "OCR_PARSE_FAILED";

export type OcrOutcome =
  | { ok: true; data: OcrResult }
  | { ok: false; error: { code: OcrErrorCode; message: string } };

/** OCR 运行模式判定（局部判定，不动全局 resolveLlmMode）：mock 或三网关视觉 key 全缺 → mock */
export function resolveOcrMode(): "live" | "mock" {
  if (process.env.DEMO_MODE === "mock") return "mock";
  const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const hasZhipu = Boolean(process.env.GLM_API_KEY?.trim());
  const hasSiliconflow = Boolean(process.env.SILICONFLOW_API_KEY?.trim());
  if (!hasDeepseek && !hasZhipu && !hasSiliconflow) return "mock";
  return "live";
}

/* ---------------- 提示词 ---------------- */

/** 字段中文名（复核提示用） */
const FIELD_LABELS: Record<(typeof OCR_REVIEW_FIELDS)[number], string> = {
  time: "交易时间",
  amountYuan: "金额",
  merchant: "商户",
  direction: "收付方向",
};

/**
 * 识别提示词：结构约束写死在模板里（视觉模型不支持 json_object 模式），
 * 年份由服务端传入当前年份（账单截图一般只显示月日）。
 */
function buildRecognizePrompt(year: number): string {
  return [
    "你是账单截图识别器。仔细辨认图片中的账单明细，逐行提取交易记录，只输出一个 JSON 对象，不要输出任何其他文字或解释。",
    '输出结构：{"transactions":[{"time":"YYYY-MM-DD HH:mm","amountYuan":12.5,"merchant":"商户名","direction":"expense","confidence":0.95}],"rawText":"图片里的关键文字摘要"}',
    "规则：",
    "1. amountYuan 是正数，单位元，最多两位小数；",
    "2. direction 只有 expense（支出）与 income（收入），无法判断时取 expense；",
    "3. confidence 取 0 到 1 的小数，表示你对这一行整体的把握，看不清的字段所在行给低于 0.8；",
    `4. time 严格用 "YYYY-MM-DD HH:mm"；图片只显示月日时，用 ${year} 年补全；`,
    "5. merchant 照抄图片原文，不要改字，最长 60 字；",
    "6. transactions 最多 200 行，按图片从上到下顺序输出；",
    "7. rawText 是图片中与账单有关的文字摘要，不超过 500 字，可省略。",
  ].join("\n");
}

/**
 * 二次复核提示词：在识别提示词基础上追加待复核单元格清单，
 * 要求模型只针对这些单元格对照（局部裁剪后的）原图重新辨认。
 */
function buildReviewPrompt(
  year: number,
  cells: OcrReviewCell[],
  transactions: OcrTransactionRow[],
): string {
  const cellLines = cells
    .map((cell) => {
      const row = transactions[cell.rowIndex];
      if (!row) return "";
      return `- 第 ${cell.rowIndex + 1} 行 ${FIELD_LABELS[cell.field]}（当前值：${String(row[cell.field])}）`;
    })
    .filter((line) => line.length > 0);
  return [
    buildRecognizePrompt(year),
    "",
    "下面是用户标记的待复核单元格，请对照原图逐一重新仔细辨认：",
    ...cellLines,
    "输出修正后的完整 transactions 数组（结构与规则不变；未标记的行保持原值；复核后把握变大时把该行 confidence 提到 0.9 以上）。",
  ].join("\n");
}

/* ---------------- 容错 JSON 提取 ---------------- */

/**
 * 视觉模型文本 → JSON 对象。三层容错：剥 <think>（SiliconFlow 思考模型）、
 * 剥 markdown 围栏、取首尾花括号截断前后杂质；仍不可解析返回 null。
 * 该函数独立导出供单测覆盖。
 */
export function extractJsonObject(text: string): unknown | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ---------------- 网关调用 ---------------- */

interface VisionProvider {
  name: "deepseek" | "zhipu" | "siliconflow";
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

/** 按「DeepSeek 主 → 智谱 → SiliconFlow 降级」的契约顺序收集有 key 的网关 */
function collectProviders(): VisionProvider[] {
  const providers: VisionProvider[] = [];
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekKey) {
    providers.push({
      name: "deepseek",
      apiKey: deepseekKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_DEFAULT_BASE_URL,
      modelId: process.env.DEEPSEEK_VISION_MODEL?.trim() || DEFAULT_DEEPSEEK_VISION_MODEL,
    });
  }
  const zhipuKey = process.env.GLM_API_KEY?.trim();
  if (zhipuKey) {
    providers.push({
      name: "zhipu",
      apiKey: zhipuKey,
      baseUrl: process.env.GLM_BASE_URL?.trim() || ZHIPU_DEFAULT_BASE_URL,
      modelId: process.env.GLM_VISION_MODEL?.trim() || DEFAULT_GLM_VISION_MODEL,
    });
  }
  const siliconflowKey = process.env.SILICONFLOW_API_KEY?.trim();
  if (siliconflowKey) {
    providers.push({
      name: "siliconflow",
      apiKey: siliconflowKey,
      baseUrl: process.env.SILICONFLOW_BASE_URL?.trim() || SILICONFLOW_DEFAULT_BASE_URL,
      modelId:
        process.env.SILICONFLOW_VISION_MODEL?.trim() || DEFAULT_SILICONFLOW_VISION_MODEL,
    });
  }
  return providers;
}

/**
 * 单网关一次生成（openai-compatible 视觉请求体，两网关同构）。
 * 返回模型文本；网络错误 / 非 2xx 抛错，由上层按降级链切换到下一网关。
 * 不打印请求内容与响应内容（02 §12.2 ②）。
 */
async function callVisionProvider(
  provider: VisionProvider,
  prompt: string,
  dataUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.modelId,
      max_tokens: VISION_MAX_TOKENS,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`vision gateway ${provider.name} responded ${response.status}`);
  }
  const payload: unknown = await response.json();
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`vision gateway ${provider.name} returned empty content`);
  }
  return content;
}

/** 字节 → base64 data URL（仅内存中转，不落盘） */
function toDataUrl(mimeType: string, bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

/* ---------------- 主入口 ---------------- */

/**
 * 识别账单截图（recognize / review 共用）：
 * - 15s 整体超时（AbortSignal.timeout，三网关共享同一截止时刻）；
 * - 依次尝试 DeepSeek → 智谱 → SiliconFlow，单次生成 + JSON 提取 +
 *   OcrResultSchema.safeParse，任一网关返回校验通过的完整结构即成功
 *   （「safeParse 通过才回传」）；
 * - 三败时区分终态：有任一网关产出过文本但结构/解析失败 → OCR_PARSE_FAILED，
 *   否则（网络/网关错误）→ OCR_UNAVAILABLE；超时 → OCR_TIMEOUT。
 * 契约「失败重试 1 次」即降级网关这一次重试（02 §12.1 注释口径）。
 */
export async function recognizeBillImage(
  image: { mimeType: string; bytes: Uint8Array },
  review?: { cells: OcrReviewCell[]; transactions: OcrTransactionRow[] },
): Promise<OcrOutcome> {
  const providers = collectProviders();
  if (providers.length === 0) {
    return {
      ok: false,
      error: { code: "OCR_UNAVAILABLE", message: "OCR 供应商密钥未配置" },
    };
  }

  const signal = AbortSignal.timeout(OCR_TIMEOUT_MS);
  const dataUrl = toDataUrl(image.mimeType, image.bytes);
  const year = new Date().getFullYear();
  const prompt = review
    ? buildReviewPrompt(year, review.cells, review.transactions)
    : buildRecognizePrompt(year);

  let sawParseFailure = false;
  for (const provider of providers) {
    try {
      const text = await callVisionProvider(provider, prompt, dataUrl, signal);
      const json = extractJsonObject(text);
      if (json === null) {
        sawParseFailure = true;
        continue;
      }
      const parsed = OcrResultSchema.safeParse(json);
      if (!parsed.success) {
        sawParseFailure = true;
        continue;
      }
      return { ok: true, data: parsed.data };
    } catch {
      if (signal.aborted) {
        return {
          ok: false,
          error: {
            code: "OCR_TIMEOUT",
            message: "识别超过 15 秒已中断，请改用 CSV 文件导入或稍后重试",
          },
        };
      }
      // 网关错误：按降级链切换到下一网关
      continue;
    }
  }

  if (sawParseFailure) {
    return {
      ok: false,
      error: {
        code: "OCR_PARSE_FAILED",
        message: "截图识别结果无法通过结构校验，请换一张更清晰的截图或改用 CSV 导入",
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "OCR_UNAVAILABLE",
      message: "OCR 服务暂时不可用，请稍后重试或改用 CSV 文件导入",
    },
  };
}
