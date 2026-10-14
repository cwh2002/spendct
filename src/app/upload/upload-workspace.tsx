"use client";

/**
 * 上传工作台（/upload 全部交互与状态机）。
 *
 * 链路：选择入口（OCR 占位 / CSV 文件 / 示例账单）→ 文本就绪 →
 * parseBillCsv 嗅探（格式/置信度/字段映射/警告）→ 预览人工确认 →
 * stripDuplicates + buildCleanCsv → getDuckDB + importBillCsv（预览表）→
 * registerImportedBook（账本登记 + 激活键）→ 管线数据集装配
 * （cleanBillRows → hashCleanRows → initDataset → usePipeline.setDataset）→ 跳转体检。
 *
 * 两个外部约束：
 * 1. 本文件读 useSearchParams（?sample=1 自动演示、?next= 回跳），
 *    必须由 page.tsx 的 Suspense 边界包裹（Next 16 预渲染期读 URL
 *    的客户端组件没有边界会报 blocking-prerender）；
 * 2. DuckDB-WASM 初始化只在「开始体检」点击后发生：wasm 包体大，
 *    不在页面打开时预热，避免拖慢首屏与解析主链路。
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileSearch,
  FileUp,
  Info,
  Loader2,
  PenLine,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { ResumeBanner } from "@/components/home/resume-banner";
import { useAuth } from "@/lib/account/store";
import { initDataset } from "@/lib/duckdb/dataset";
import { getDuckDB, importBillCsv } from "@/lib/duckdb/service";
import { featureFlags } from "@/lib/feature-flags";
import { registerImportedBook } from "@/lib/import/active-book";
import { cleanBillRows, hashCleanRows } from "@/lib/import/clean-input";
import { buildCleanCsv, parseBillCsv, stripDuplicates } from "@/lib/import/parse-csv";
import { generateSampleCsv, SAMPLE_BILL_FILE_NAME, SAMPLE_ROW_COUNT } from "@/lib/import/sample-bill";
import type { ParseResult } from "@/lib/import/types";
import { usePipeline } from "@/lib/pipeline/store";

/* ---------------- 常量与纯工具 ---------------- */

/** 单文件上限 20MB：超出后解析与内存压力不可控，入口层直接拦 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 目标表名：后续阶段的白名单聚合都按 transactions 引用 */
const TABLE_NAME = "transactions";

/** 数据预览行数 */
const PREVIEW_ROW_COUNT = 3;

/** 成功态停留时长：给用户「已导入」的确认感，再进体检路由 */
const SUCCESS_NAV_DELAY_MS = 1000;

const FORMAT_META = {
  wechat: { label: "微信账单", dotClass: "bg-(--color-primary)" },
  alipay: { label: "支付宝账单", dotClass: "bg-(--color-chart-4)" },
  unknown: { label: "来源未知", dotClass: "bg-(--color-serious)" },
} as const;

/** 识别质量三色（好=绿 / 一般=黄 / 需留意=橙红），与状态色规范对齐 */
const CONFIDENCE_META = {
  high: { label: "好", dotClass: "bg-(--color-good)", textClass: "text-(--color-good-ink)" },
  medium: { label: "一般", dotClass: "bg-(--color-warning)", textClass: "text-(--color-warning-ink)" },
  low: { label: "需留意", dotClass: "bg-(--color-serious)", textClass: "text-(--color-serious-ink)" },
} as const;

/** 标准字段 → 中文展示名（识别结果确认表用） */
const STANDARD_LABELS: Record<string, string> = {
  dateIso: "交易日期",
  amountCents: "金额",
  direction: "收支方向",
  merchant: "商户",
  note: "备注",
  rawRef: "交易单号",
};

/** ?next 只允许站内相对路径：router.push 对未清洗 URL 有 XSS 风险 */
function sanitizeNextPath(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  return "/checkup";
}

/** 金额展示统一 分→元（全项目唯一金额单位是分） */
function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 导入失败文案：引擎加载类错误（首次访问需联网加载）与一般失败分开提示；原始报错只留开发者日志 */
function describeImportError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[upload] 导入失败，原始错误：", message || err);
  if (/worker|wasm|webassembly|instantiate/i.test(message)) {
    return "账单识别引擎还没加载成功：首次使用需要联网加载，请检查网络后点「重试」";
  }
  return "文件格式不识别，请确认是银行或支付平台导出的账单文件";
}

/* ---------------- 页面状态 ---------------- */

type Stage = "empty" | "parsing" | "preview" | "success";
type ImportStatus = "idle" | "importing" | "failed";

interface UploadState {
  stage: Stage;
  /** 解析中阶段的分步文案（「正在识别文件…」→「正在整理数据…」） */
  progressText: string;
  fileName: string;
  result: ParseResult | null;
  importedCount: number;
  importStatus: ImportStatus;
  importError: string;
}

const INITIAL_STATE: UploadState = {
  stage: "empty",
  progressText: "",
  fileName: "",
  result: null,
  importedCount: 0,
  importStatus: "idle",
  importError: "",
};

/* ---------------- 预览区各状态视图（纯展示，无钩子） ---------------- */

function DirectionChip({ direction }: { direction: "expense" | "income" }) {
  return direction === "expense" ? (
    <span className="inline-flex items-center gap-1 text-(--color-critical-ink)">
      <TrendingDown className="size-3.5" aria-hidden />
      支出
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-(--color-good-ink)">
      <TrendingUp className="size-3.5" aria-hidden />
      收入
    </span>
  );
}

function EmptyPreview() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-(--color-surface-2)">
        <FileSearch className="size-7 text-(--color-ink-muted)" aria-hidden />
      </div>
      <p className="font-semibold text-(--color-ink)">还没有账单——从左侧选择一个入口开始</p>
      <p className="max-w-xs text-sm text-(--color-ink-muted)">
        拖入账单文件，或者点左侧「示例账单」直接体验
      </p>
    </div>
  );
}

function ParsingPreview({ text, fileName }: { text: string; fileName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
      <Loader2 className="size-8 animate-spin text-(--color-primary)" aria-hidden />
      <div className="max-w-xs">
        <p className="font-semibold text-(--color-ink)">{text}</p>
        <p className="mt-1 truncate text-sm text-(--color-ink-muted)">{fileName || "本地文件"}</p>
      </div>
      <p className="text-xs text-(--color-ink-muted)">文件只在本地处理，不会上传到任何服务器</p>
    </div>
  );
}

function RejectedPreview({ warnings, onReselect }: { warnings: string[]; onReselect: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-(--color-surface-2)">
        <CircleAlert className="size-7 text-(--color-critical)" aria-hidden />
      </div>
      <div className="max-w-sm">
        <p className="font-semibold text-(--color-ink)">这份文件里没有识别出可用账单</p>
        <p className="mt-1 text-sm text-(--color-ink-muted)">
          {warnings[0] ?? "请确认导出的是微信 / 支付宝「账单」文件"}
        </p>
      </div>
      {warnings.length > 1 ? (
        <ul className="max-w-md space-y-1 text-left">
          {warnings.slice(1).map((warning, index) => (
            <li
              key={`reject-${index}`}
              className="flex items-start gap-1.5 text-sm text-(--color-warning-ink)"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onReselect}
        className="inline-flex h-11 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-6 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
      >
        <RefreshCw className="size-4" aria-hidden />
        重新选择
      </button>
    </div>
  );
}

function SuccessPreview({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center"
    >
      <CheckCircle2 className="size-14 text-(--color-good)" aria-hidden />
      <p className="text-lg font-semibold text-(--color-ink)">
        已导入 {count.toLocaleString("zh-CN")} 笔，开始体检
      </p>
      <p className="flex items-center gap-2 text-sm text-(--color-ink-muted)">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        正在前往体检流程…
      </p>
    </motion.div>
  );
}

interface ParsedPreviewProps {
  result: ParseResult;
  fileName: string;
  importStatus: ImportStatus;
  importError: string;
  onImport: () => void;
  onReselect: () => void;
}

/** 预览态：格式/识别质量徽标 + 警告 + 识别结果确认 + 前 3 笔数据 + 导入按钮 */
function ParsedPreview({
  result,
  fileName,
  importStatus,
  importError,
  onImport,
  onReselect,
}: ParsedPreviewProps) {
  const { format, confidence, rows, warnings, mapping } = result;
  const formatMeta = FORMAT_META[format];
  const confidenceMeta = CONFIDENCE_META[confidence];
  const mappingEntries = Object.entries(mapping);
  const lowConfidence = confidence === "low";
  const previewRows = rows.slice(0, PREVIEW_ROW_COUNT);
  const importing = importStatus === "importing";

  return (
    <div className="flex flex-1 flex-col">
      {/* 头部：格式 + 识别质量 + 文件名 + 记录数 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface-2) px-2.5 py-0.5 text-xs font-medium text-(--color-ink-secondary)">
          <span className={`size-1.5 rounded-full ${formatMeta.dotClass}`} aria-hidden />
          {formatMeta.label}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface-2) px-2.5 py-0.5 text-xs font-medium ${confidenceMeta.textClass}`}
        >
          <span className={`size-1.5 rounded-full ${confidenceMeta.dotClass}`} aria-hidden />
          识别质量 {confidenceMeta.label}
        </span>
        <span className="max-w-40 truncate text-sm text-(--color-ink-muted)" title={fileName}>
          {fileName}
        </span>
        <span className="ml-auto text-sm text-(--color-ink-muted) tabular-nums">
          共 {rows.length.toLocaleString("zh-CN")} 条记录
        </span>
      </div>

      {/* 警告列表：乱码/被跳过的记录/疑似重复等，逐条渲染 */}
      {warnings.length > 0 ? (
        <div className="mt-4 rounded-(--radius-md) border-l-4 border-(--color-warn) bg-(--color-warn-soft) px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-(--color-warning-ink)">
            <AlertTriangle className="size-4" aria-hidden />
            导入提示（{warnings.length}）
          </p>
          <ul className="mt-1.5 space-y-1">
            {warnings.map((warning, index) => (
              <li
                key={`warn-${index}`}
                className="text-sm leading-relaxed text-(--color-ink-secondary)"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 识别结果确认：文件里的栏目 → 识别为；低质量整表黄底提示核对 */}
      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-(--color-ink)">识别结果确认</h3>
          {lowConfidence ? (
            <span className="inline-flex items-center gap-1 text-xs text-(--color-warning-ink)">
              <Info className="size-3.5" aria-hidden />
              下面这些栏目是自动识别的，如果不准请重点核对
            </span>
          ) : null}
        </div>
        <p className="mb-2 text-xs text-(--color-ink-muted)">确认一下两边栏目的对应关系</p>
        <div className="overflow-hidden rounded-(--radius-md) border border-(--color-border)">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-surface-2)">
                <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">
                  账单文件里的栏目
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">
                  识别为
                </th>
              </tr>
            </thead>
            <tbody>
              {mappingEntries.length > 0 ? (
                mappingEntries.map(([rawHeader, standard], index) => (
                  <tr
                    key={rawHeader}
                    className={`${lowConfidence ? "bg-(--color-warn-soft)" : ""} ${
                      index === mappingEntries.length - 1 ? "" : "border-b border-(--color-border)"
                    }`}
                  >
                    <td className="px-3 py-2 text-(--color-ink-secondary)">{rawHeader}</td>
                    <td className="px-3 py-2 font-medium text-(--color-ink)">
                      {STANDARD_LABELS[standard] ?? "其他栏目"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-sm text-(--color-ink-muted)">
                    没有识别出栏目对应关系
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 数据预览：前 3 行 */}
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold text-(--color-ink)">
          数据预览（前 {previewRows.length} 笔）
        </h3>
        <div className="overflow-x-auto rounded-(--radius-md) border border-(--color-border)">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-surface-2)">
                <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">
                  时间
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">
                  商户
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-(--color-ink-secondary)">
                  金额（元）
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-(--color-ink-secondary)">
                  方向
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, index) => (
                <tr
                  key={`preview-${index}`}
                  className={index === previewRows.length - 1 ? "" : "border-b border-(--color-border)"}
                >
                  <td className="px-3 py-2 whitespace-nowrap font-(--font-mono) text-xs text-(--color-ink-secondary) tabular-nums">
                    {row.dateIso}
                    {row.timeIso ? ` ${row.timeIso}` : ""}
                  </td>
                  <td className="max-w-40 truncate px-3 py-2" title={row.merchant}>
                    {row.merchant || "—"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right whitespace-nowrap font-(--font-mono) tabular-nums ${
                      row.direction === "expense"
                        ? "text-(--color-critical-ink)"
                        : "text-(--color-good-ink)"
                    }`}
                  >
                    {row.direction === "expense" ? "−" : "+"}
                    {formatYuan(row.amountCents)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <DirectionChip direction={row.direction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 导入失败卡：可重试 / 重选 */}
      {importStatus === "failed" ? (
        <div className="mt-5 rounded-(--radius-md) border border-(--color-critical) bg-(--color-surface-2) p-4">
          <p className="flex items-center gap-1.5 font-medium text-(--color-critical-ink)">
            <CircleAlert className="size-4" aria-hidden />
            导入失败
          </p>
          <p className="mt-1 text-sm text-(--color-ink-secondary)">{importError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onImport}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--color-btn-primary) px-5 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover)"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              重试
            </button>
            <button
              type="button"
              onClick={onReselect}
              className="inline-flex h-10 items-center rounded-full border border-(--color-border-strong) px-5 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:bg-(--color-surface-2)"
            >
              重新选择文件
            </button>
          </div>
        </div>
      ) : null}

      {/* 主操作 */}
      <div className="mt-auto pt-5">
        <button
          type="button"
          onClick={onImport}
          disabled={importing}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-(--radius-md) bg-(--color-btn-primary) text-base font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
        >
          {importing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在整理账单…
            </>
          ) : (
            <>
              开始体检
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-(--color-ink-muted)">
          <ShieldCheck className="size-3.5" aria-hidden />
          导入后数据只在浏览器本地计算，明细不会离开设备
        </p>
      </div>
    </div>
  );
}

/* ---------------- 主组件 ---------------- */

export function UploadWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<UploadState>(INITIAL_STATE);
  const [dragging, setDragging] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** 解析序号：新文件到来时递增，旧的异步分步文案不再有权写状态 */
  const parseSeqRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSampleStartedRef = useRef(false);

  // ?next 回跳目标：只允许站内相对路径
  const rawNext = searchParams.get("next");
  const nextPath = rawNext ? sanitizeNextPath(rawNext) : "/checkup";
  const sampleRequested = searchParams.get("sample") === "1";

  // 卸载时清掉未触发的定时器，避免路由离开后还去 push/弹 toast
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  /** 解析主链路：分步文案 → 真实解析。seq 校验保证只有最新一次请求能落状态 */
  const startParse = useCallback(async (text: string, fileName: string) => {
    const seq = ++parseSeqRef.current;
    setState({ ...INITIAL_STATE, stage: "parsing", progressText: "正在识别文件…", fileName });
    // 解析本身很快，分两步推进让「识别文件 → 整理数据」的动作可感知
    await delay(420);
    if (seq !== parseSeqRef.current) return;
    setState((prev) => ({ ...prev, progressText: "正在整理数据…" }));
    await delay(480);
    if (seq !== parseSeqRef.current) return;
    // 大文件解析是同步阻塞操作，放进宏任务让「正在整理数据…」先完成一次绘制
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = parseBillCsv(text, fileName);
        if (seq === parseSeqRef.current) {
          setState((prev) => ({ ...prev, stage: "preview", result }));
        }
        resolve();
      }, 0);
    });
  }, []);

  const handleSample = useCallback(() => {
    void startParse(generateSampleCsv(), SAMPLE_BILL_FILE_NAME);
  }, [startParse]);

  const handleOcrClick = useCallback(() => {
    // OCR 入口需要视觉模型密钥，尚未接通：先给反馈，引导走账单文件或示例
    showToast("截图识别正在准备中，可以先用账单文件或示例账单体验");
  }, [showToast]);

  const resetToEmpty = useCallback(() => {
    // 作废进行中的解析，避免慢的旧链路晚到覆盖空态
    parseSeqRef.current += 1;
    setEntryError(null);
    setState(INITIAL_STATE);
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      if (!/\.csv$/i.test(file.name)) {
        setEntryError("请选择微信、支付宝等 App 导出的账单文件");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setEntryError("文件超过 20MB：建议导出时缩小时间范围后重试");
        return;
      }
      setEntryError(null);
      const reader = new FileReader();
      reader.onerror = () => setEntryError("读取文件失败，请重试");
      reader.onload = () => {
        if (typeof reader.result === "string") {
          void startParse(reader.result, file.name);
        } else {
          setEntryError("读取文件失败，请重试");
        }
      };
      // UTF-8 直接解码；GBK 文件的乱码痕迹由嗅探器识别并在预览页提示
      reader.readAsText(file);
    },
    [startParse],
  );

  // 首页「加载示例账单」动线：/upload?sample=1 自动走一遍示例
  useEffect(() => {
    if (sampleRequested && !autoSampleStartedRef.current) {
      autoSampleStartedRef.current = true;
      handleSample();
    }
  }, [sampleRequested, handleSample]);

  /** 导入主链路：去重 → 标准 CSV → DuckDB 预览表 → 账本登记 → 管线数据集装配 → 跳转 */
  async function startImport() {
    const { result, importStatus, fileName } = state;
    if (!result || result.rows.length === 0 || importStatus === "importing") return;
    setState((prev) => ({ ...prev, importStatus: "importing", importError: "" }));
    try {
      const deduped = stripDuplicates(result.rows);
      const csvText = buildCleanCsv(deduped);
      const conn = await getDuckDB();
      const imported = await importBillCsv(conn, { csvText, tableName: TABLE_NAME });
      // 账本归属：先补一次会话恢复（幂等），拿到用户 id 再登记
      const auth = useAuth.getState();
      await auth.hydrate().catch(() => {});
      const userId = useAuth.getState().user?.id ?? null;
      await registerImportedBook({
        name: fileName || "未命名账单",
        userId,
        rowCount: imported.rowCount,
      });

      // 管线数据集装配（07 §3 完整 schema）。
      // 两层导入职责不同、表名相同是设计意图：importBillCsv 用 read_csv_auto
      // 建 6 列 transactions 表，只服务预览与 T3/T4 验收路径；initDataset
      // 内部先 dropDataset 清掉这张同名预览表，再按 18 列 DDL 重建并补齐
      // 13 视图与 9 预计算表，完整 schema 服务六阶段管线引擎。
      // 预览表只是装配前的临时产物，装配完成即被替换。
      try {
        const cleaned = await cleanBillRows(deduped, fileName || "未命名账单");
        const datasetTxHash = await hashCleanRows(cleaned);
        await initDataset(conn, cleaned);
        usePipeline.getState().setDataset(datasetTxHash, "upload");
      } catch (assemblyErr) {
        // 降级边界：装配任一步失败都不阻断跳转。检查页侧 verifySchema 会因
        // schema 缺失报错并给出「重新导入」提示，用户重导一次即可恢复；
        // 这里仅 console.warn 留痕，保持现有「已导入」成功口径，
        // 避免用户误以为账单本体导入失败（预览表路径并未出错）。
        console.warn("[upload] 管线数据集装配失败，降级为仅预览导入：", assemblyErr);
      }

      setState((prev) => ({
        ...prev,
        stage: "success",
        importedCount: imported.rowCount,
        importStatus: "idle",
      }));
      navTimerRef.current = setTimeout(() => router.push(nextPath), SUCCESS_NAV_DELAY_MS);
    } catch (err) {
      setState((prev) => ({ ...prev, importStatus: "failed", importError: describeImportError(err) }));
    }
  }

  /* ---------------- 文件入口交互 ---------------- */

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    // 同一文件再次选择也要触发 onChange，读完后清空 value
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    // preventDefault 是允许 drop 的前提
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    // 只在真正离开整个热区时熄灭高亮，经过子元素不误触发
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }

  const { stage, result, fileName, progressText, importedCount, importStatus, importError } = state;
  const rejected = result !== null && result.rows.length === 0;

  return (
    <>
      <Container className="pb-16 md:pb-20">
        <header className="py-8 md:py-10">
          <h1 className="text-2xl font-bold tracking-tight text-(--color-ink) md:text-3xl">
            上传账单
          </h1>
          <p className="mt-2 text-sm text-(--color-ink-secondary) md:text-base">
            支持支付宝、微信、银行 App 导出的账单文件，确认识别无误后一键开始六阶段体检
          </p>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-5">
          {/* 左：入口区 */}
          <section aria-label="选择导入入口" className="space-y-4 lg:col-span-2">
            <ResumeBanner />

            <button
              type="button"
              onClick={handleSample}
              className="flex w-full items-center gap-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 text-left shadow-(--shadow-sm) transition-colors hover:border-(--color-primary)"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
                <Sparkles className="size-5 text-(--color-primary)" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-(--color-ink)">
                  没有账单文件？先拿示例账单体验
                </span>
                <span className="mt-0.5 block text-sm text-(--color-ink-muted)">
                  一键生成 {SAMPLE_ROW_COUNT.toLocaleString("zh-CN")} 笔模拟账单，走完上传到体检的完整流程
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
            </button>

            {featureFlags.ocr ? (
              <button
                type="button"
                onClick={handleOcrClick}
                className="flex w-full items-center gap-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 text-left shadow-(--shadow-sm) transition-colors hover:border-(--color-primary)"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft)">
                  <ScanLine className="size-5 text-(--color-primary)" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-(--color-ink)">账单截图 OCR</span>
                  <span className="mt-0.5 block text-sm text-(--color-ink-muted)">
                    微信 / 支付宝账单截图，识别后直接体检
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-(--color-ink-muted)" aria-hidden />
              </button>
            ) : null}

            <div>
              <input
                id="bill-csv-input"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={handleInputChange}
              />
              <label
                htmlFor="bill-csv-input"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-(--radius-card) border-2 px-4 py-8 text-center transition-colors ${
                  dragging
                    ? "border-(--color-primary) bg-(--color-primary-soft)"
                    : "border-dashed border-(--color-border-strong) bg-(--color-surface) hover:border-(--color-primary) hover:bg-(--color-surface-2)"
                }`}
              >
                <FileUp
                  className={
                    dragging ? "size-7 text-(--color-primary)" : "size-7 text-(--color-ink-muted)"
                  }
                  aria-hidden
                />
                <span className="font-semibold text-(--color-ink)">账单文件</span>
                <span className="text-sm text-(--color-ink-muted)">
                  {dragging ? "松开鼠标，开始识别" : "拖拽文件到这里，或点击选择（不超过 20MB）"}
                </span>
              </label>
              {entryError ? (
                <p
                  role="alert"
                  className="mt-2 flex items-start gap-1.5 text-sm text-(--color-critical-ink)"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {entryError}
                </p>
              ) : null}
              <div className="mt-3 rounded-(--radius-md) bg-(--color-surface-2) p-3">
                <p className="text-xs font-semibold text-(--color-ink-secondary)">
                  支持支付宝、微信、银行 App 导出的账单文件
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-(--color-ink-muted)">
                  微信：我 → 服务 → 钱包 → 账单 → 下载账单；支付宝：我的 → 账单 → 开具交易流水证明
                </p>
              </div>
            </div>

            {featureFlags.budget ? (
              <Link
                href="/budget#quick"
                className="flex h-11 items-center justify-center gap-2 rounded-full border border-dashed border-(--color-border-strong) text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-primary) hover:text-(--color-primary)"
              >
                <PenLine className="size-4" aria-hidden />
                随手记一笔？不用上传文件，直接记
              </Link>
            ) : null}
          </section>

          {/* 右：预览区 */}
          <section aria-label="账单预览" className="lg:col-span-3">
            <div className="flex min-h-[480px] flex-col rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm) md:p-6">
              {stage === "empty" ? <EmptyPreview /> : null}
              {stage === "parsing" ? (
                <ParsingPreview text={progressText} fileName={fileName} />
              ) : null}
              {stage === "success" ? <SuccessPreview count={importedCount} /> : null}
              {stage === "preview" && result ? (
                rejected ? (
                  <RejectedPreview warnings={result.warnings} onReselect={resetToEmpty} />
                ) : (
                  <ParsedPreview
                    result={result}
                    fileName={fileName}
                    importStatus={importStatus}
                    importError={importError}
                    onImport={() => void startImport()}
                    onReselect={resetToEmpty}
                  />
                )
              ) : null}
            </div>
          </section>
        </div>
      </Container>

      {/* 轻量 toast：底部居中，自动消失 */}
      <AnimatePresence>
        {toast ? (
          <motion.div
            key="upload-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            role="status"
            className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8"
          >
            <div className="max-w-md rounded-(--radius-md) bg-(--color-ink) px-4 py-2.5 text-sm text-(--color-surface) shadow-(--shadow-lg)">
              {toast}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
