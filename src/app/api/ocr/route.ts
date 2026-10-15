/**
 * /api/ocr —— 账单截图识别端点（02 §12 逐字实现；07 §11 降级链）。
 *
 * 两个模式（multipart 表单字段 mode）：
 * - recognize：file + 返回 OcrResultSchema 校验通过的交易行（02 §12.1）；
 * - review：   file（局部裁剪后的原图）+ cells + transactions（JSON 字符串），
 *              对标记单元格二次复核，返回修正后的完整 transactions
 *              （同一 OcrResultSchema 信封，客户端整体替换确认表）。
 *
 * 服务器侧硬约定（02 §12.2，code review 检查项）：
 * ① 全程 HTTPS（生产 Vercel 默认 TLS；本地开发 http://localhost 除外）；
 * ② 无任何 fs 写入；本路由不打印任何请求内容（02 §1.2 服务器零存储）；
 * ③ 图片字节仅在本次请求内存中存活（file.arrayBuffer() 一次读入，
 *    转发后随响应结束释放，不落盘不缓存）；
 * ④ 识别整体超时 15s（OCR_TIMEOUT_MS），maxDuration=20 兜底。
 *
 * 限流：live 模式同实例内存计数 20 次/小时（02 §12.1「同会话限
 * 20 次/小时，内存计数」；serverless 多实例下为单实例弱限流，
 * 成本纪律由免费额度 + 按次计费兜底）。mock 模式不限流：零密钥
 * 演示动线（e2e / 评审）永不因限流中断。
 */
import { NextResponse } from "next/server";

import { OcrReviewRequestSchema, type OcrReviewCell, type OcrTransactionRow } from "@/lib/schema/ocr";
import { mockOcrResult, mockOcrReview } from "@/server/ocr/mock";
import { recognizeBillImage, resolveOcrMode } from "@/server/ocr/vision";

export const runtime = "nodejs";
export const maxDuration = 20;

/** 上传上限 5MB（02 §12.1；客户端压缩后一般 <800KB） */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 限流窗口与额度：20 次 / 小时（02 §12.1 内存计数） */
const RATE_WINDOW_MS = 3_600_000;
const RATE_LIMIT = 20;

/** 同实例限流计数器（进程级滑动窗口；serverless 语义见文件头注释） */
const recentOcrCalls: number[] = [];

function consumeRateLimit(): boolean {
  const now = Date.now();
  while (recentOcrCalls.length > 0 && (recentOcrCalls[0] ?? 0) <= now - RATE_WINDOW_MS) {
    recentOcrCalls.shift();
  }
  if (recentOcrCalls.length >= RATE_LIMIT) return false;
  recentOcrCalls.push(now);
  return true;
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** review 模式的 JSON 表单字段 → 请求体；字段缺失或结构不符返回 null（由调用方 400） */
function parseReviewRequest(
  cellsRaw: FormDataEntryValue | null,
  transactionsRaw: FormDataEntryValue | null,
): { cells: OcrReviewCell[]; transactions: OcrTransactionRow[] } | null {
  if (typeof cellsRaw !== "string" || typeof transactionsRaw !== "string") return null;
  try {
    const cells: unknown = JSON.parse(cellsRaw);
    const transactions: unknown = JSON.parse(transactionsRaw);
    const parsed = OcrReviewRequestSchema.safeParse({ cells, transactions });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "BAD_REQUEST", "请求必须是 multipart 表单");
  }

  const mode = form.get("mode");
  if (mode !== "recognize" && mode !== "review") {
    return fail(400, "BAD_REQUEST", "mode 必须是 recognize 或 review");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail(400, "BAD_REQUEST", "缺少截图文件");
  }
  if (!file.type.startsWith("image/")) {
    return fail(400, "BAD_REQUEST", "文件必须是图片");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return fail(413, "FILE_TOO_LARGE", "图片超过 5MB，请压缩后重试");
  }

  // review 模式的附加 JSON 字段（recognize 模式忽略）
  const review =
    mode === "review" ? parseReviewRequest(form.get("cells"), form.get("transactions")) : null;
  if (mode === "review" && review === null) {
    return fail(400, "BAD_REQUEST", "review 模式缺少合法的 cells / transactions 字段");
  }

  // mock 模式短路：不读图片字节，返回确定性剧本（07 §7；e2e 锚点依赖此分支）
  if (resolveOcrMode() === "mock") {
    const data = review ? mockOcrReview(review.transactions, review.cells) : mockOcrResult();
    return NextResponse.json({ ok: true, data });
  }

  if (!consumeRateLimit()) {
    return fail(429, "OCR_RATE_LIMITED", "识别次数太频繁，请稍后再试（每小时 20 次）");
  }

  // 图片字节仅在本次请求内存中存活（02 §12.2 ③），响应结束后随 GC 释放
  const bytes = new Uint8Array(await file.arrayBuffer());
  const outcome = await recognizeBillImage({ mimeType: file.type, bytes }, review ?? undefined);
  if (outcome.ok) {
    return NextResponse.json({ ok: true, data: outcome.data });
  }
  const { code, message } = outcome.error;
  const status = code === "OCR_TIMEOUT" ? 504 : code === "OCR_PARSE_FAILED" ? 502 : 503;
  return fail(status, code, message);
}
