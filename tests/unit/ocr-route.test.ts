/**
 * /api/ocr 路由单测（src/app/api/ocr/route.ts，02 §12.2 硬约定）。
 *
 * 覆盖：mock 模式短路（不读图片字节返回确定性剧本，e2e 动线同源）、
 * 协议层校验（mode/file/类型/大小/review 字段）与信封形状。
 * live 网络路径（双网关降级、15s 超时）由 e2e 与 private-benchmark
 * 探针覆盖，单测不 mock fetch 断言实现细节。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/ocr/route";

const originalEnv = { ...process.env };

function buildForm(overrides: {
  mode?: string;
  file?: File | null;
  cells?: string;
  transactions?: string;
} = {}): FormData {
  const form = new FormData();
  form.append("mode", overrides.mode ?? "recognize");
  if (overrides.file !== null) {
    form.append(
      "file",
      overrides.file ??
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "账单.png", {
          type: "image/png",
        }),
    );
  }
  if (overrides.cells) form.append("cells", overrides.cells);
  if (overrides.transactions) form.append("transactions", overrides.transactions);
  return form;
}

async function call(form: FormData): Promise<{ status: number; payload: Record<string, unknown> }> {
  const request = new Request("http://localhost/api/ocr", { method: "POST", body: form });
  const response = await POST(request);
  const payload = (await response.json()) as Record<string, unknown>;
  return { status: response.status, payload };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/ocr mock 模式（07 §7 确定性短路）", () => {
  it("recognize 返回剧本：8 行 + rawText，信封 ok:true", async () => {
    process.env.DEMO_MODE = "mock";
    const { status, payload } = await call(buildForm());
    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    const data = payload.data as { transactions: unknown[]; rawText?: string };
    expect(data.transactions).toHaveLength(8);
    expect(data.rawText).toBeTruthy();
  });

  it("review 返回复核后剧本：标记行置信度提升", async () => {
    process.env.DEMO_MODE = "mock";
    const { payload: recognized } = await call(buildForm());
    const transactions = (recognized.data as { transactions: unknown[] }).transactions;
    const form = buildForm({
      mode: "review",
      cells: JSON.stringify([{ rowIndex: 3, field: "amountYuan" }]),
      transactions: JSON.stringify(transactions),
    });
    const { status, payload } = await call(form);
    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    const data = payload.data as { transactions: Array<{ confidence: number }> };
    expect(data.transactions[3]?.confidence).toBe(0.95);
  });
});

describe("POST /api/ocr 协议层校验", () => {
  it("mode 缺失或非法 → 400 BAD_REQUEST", async () => {
    process.env.DEMO_MODE = "mock";
    const { status, payload } = await call(buildForm({ mode: "translate" }));
    expect(status).toBe(400);
    expect((payload.error as { code: string }).code).toBe("BAD_REQUEST");
  });

  it("缺少文件 → 400 BAD_REQUEST", async () => {
    process.env.DEMO_MODE = "mock";
    const { status } = await call(buildForm({ file: null }));
    expect(status).toBe(400);
  });

  it("非图片类型 → 400 BAD_REQUEST", async () => {
    process.env.DEMO_MODE = "mock";
    const form = buildForm({
      file: new File(["not-image"], "账单.csv", { type: "text/csv" }),
    });
    const { status } = await call(form);
    expect(status).toBe(400);
  });

  it("超过 5MB → 413 FILE_TOO_LARGE（02 §12.1 上限）", async () => {
    process.env.DEMO_MODE = "mock";
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "大图.png", {
      type: "image/png",
    });
    const { status, payload } = await call(buildForm({ file: big }));
    expect(status).toBe(413);
    expect((payload.error as { code: string }).code).toBe("FILE_TOO_LARGE");
  });

  it("review 缺少 cells / transactions → 400 BAD_REQUEST", async () => {
    process.env.DEMO_MODE = "mock";
    const { status } = await call(buildForm({ mode: "review" }));
    expect(status).toBe(400);
  });
});
