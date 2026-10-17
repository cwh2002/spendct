"use client";

/**
 * 年度海报分享（修订案 A17）主视图。
 *
 * 玩法：选样式（青屿/暮橙/夜紫）、写一句标语，实时预览年度海报，
 * 一键下载 PNG 或调起系统分享/复制图片。海报全程在浏览器本地绘制
 * （poster-canvas.ts），不上传任何数据。
 *
 * 数据动线（真实优先 + demo 兜底）：
 * - 有体检结果：loadPosterInput 三条确定性聚合并行执行（poster-input.ts，
 *   与报告页共用同一数据层），空库返回 null 时整页回退演示口径；
 * - 无体检结果：demoPosterInput 内置数据（离线评审/静态展示可用）。
 * 挂载前不读本地存储与系统时钟：SSR 与水合首帧都按「生成中」渲染。
 */

import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, Copy, Download, HelpCircle, ImageIcon, Loader2, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getDuckDB } from "@/lib/duckdb/service";
import { usePipeline } from "@/lib/pipeline/store";
import { demoPosterInput, loadPosterInput, type PosterInput } from "@/lib/report/poster-input";
import {
  drawAnnualPoster,
  POSTER_STYLES,
  renderPosterPng,
  type PosterStyleId,
} from "@/components/report/poster-canvas";
import { useMounted } from "@/lib/use-mounted";

/** 样式选择器的色点：与 poster-canvas 的三档色板同源（默认样式取页面主色） */
const STYLE_DOTS: Record<PosterStyleId, string> = {
  aurora: "linear-gradient(135deg, #2e7ce8, #1a55ad)",
  sunset: "linear-gradient(135deg, #f97316, #9a3412)",
  midnight: "linear-gradient(135deg, #4f46e5, #1e1b4b)",
};

/** 预览画布：设计坐标的一半（540×960），绘制时整体缩放一次 */
const PREVIEW_W = 540;
const PREVIEW_H = 960;
const PREVIEW_SCALE = 0.5;

export function PosterStudio() {
  const lastRun = usePipeline((s) => s.lastRun);
  const mounted = useMounted();

  // 海报输入：真实聚合结果或演示口径（装载 effect 按来源切换）
  const [input, setInput] = useState<PosterInput | null>(null);
  const [dataMode, setDataMode] = useState<"demo" | "real">("demo");
  // 样式与标语：只影响绘制，不影响数据装载
  const [styleId, setStyleId] = useState<PosterStyleId>("aurora");
  const [slogan, setSlogan] = useState("");
  // 下载/分享进行中态：防连点，也给出反馈
  const [busy, setBusy] = useState<false | "download" | "share" | "copy">(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // 装载海报输入：真实优先，查询失败回退演示（cancelled 标志防过期 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!lastRun) {
        setInput(demoPosterInput());
        setDataMode("demo");
        return;
      }
      try {
        const conn = await getDuckDB();
        const loaded = await loadPosterInput(conn);
        if (cancelled) return;
        // 空库（无年度数据）时 loadPosterInput 返回 null：整页保持演示口径
        setInput(loaded ?? demoPosterInput());
        setDataMode(loaded ? "real" : "demo");
      } catch {
        // 数据库不可用按演示动线继续（与报告页同一降级口径）
        if (!cancelled) {
          setInput(demoPosterInput());
          setDataMode("demo");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRun]);

  // 预览绘制：输入/样式/标语任一变化都重画（cancelled 标志防过期绘制）
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !input) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(PREVIEW_SCALE, PREVIEW_SCALE);
    drawAnnualPoster(ctx, input, { style: styleId, slogan: slogan.trim() });
    ctx.restore();
  }, [input, styleId, slogan]);

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  /** 生成 PNG 并触发下载：本地创建对象 URL，点击后立即回收 */
  const handleDownload = async () => {
    if (!input || busy) return;
    setBusy("download");
    try {
      const blob = await renderPosterPng(input, { style: styleId, slogan });
      if (!blob) {
        showToast("生成失败，请重试");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `spendct-annual-poster-${input.meta.year}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("海报已下载");
    } finally {
      setBusy(false);
    }
  };

  /** 生成 PNG 并调起系统分享；浏览器不支持文件分享时回退复制图片 */
  const handleShare = async () => {
    if (!input || busy) return;
    setBusy("share");
    try {
      const blob = await renderPosterPng(input, { style: styleId, slogan });
      if (!blob) {
        showToast("生成失败，请重试");
        return;
      }
      const file = new File([blob], `spendct-annual-poster-${input.meta.year}.png`, {
        type: "image/png",
      });
      if (typeof navigator.share === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "我的年度账单海报",
          text: slogan.trim() ? `「${slogan.trim()}」——消费CT年度账单体检` : "消费CT年度账单体检",
        });
        // 用户取消分享（AbortError）不提示：分享面板已关闭，无需打断
      } else {
        await copyPngToClipboard(blob);
        showToast("当前浏览器不支持系统分享，已改为复制图片");
      }
    } catch {
      showToast("分享失败，请直接下载后分享");
    } finally {
      setBusy(false);
    }
  };

  /** 生成 PNG 并复制到剪贴板：粘贴进聊天窗口即可发出 */
  const handleCopy = async () => {
    if (!input || busy) return;
    setBusy("copy");
    try {
      const blob = await renderPosterPng(input, { style: styleId, slogan });
      if (!blob) {
        showToast("生成失败，请重试");
        return;
      }
      await copyPngToClipboard(blob);
      showToast("海报已复制，去粘贴分享");
    } catch {
      showToast("复制失败，请直接下载后分享");
    } finally {
      setBusy(false);
    }
  };

  // 挂载前渲染骨架（SSR 与水合首帧一致，只含静态壳）
  if (!mounted) {
    return (
      <div>
        <header className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
            <ImageIcon className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold">年度海报</h1>
            <p className="text-sm text-(--color-ink-secondary)">
              选一个样式、写一句标语，生成你的年度账单海报
            </p>
          </div>
        </header>
        <p className="mt-6 text-sm text-(--color-ink-muted)">加载中…</p>
      </div>
    );
  }

  const filename = `spendct-annual-poster-${input?.meta.year ?? "2026"}.png`;

  return (
    <div>
      {/* 页头 */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-(--radius-md) bg-(--color-primary-soft) text-(--color-primary)">
          <ImageIcon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">年度海报</h1>
          <p className="text-sm text-(--color-ink-secondary)">
            选一个样式、写一句标语，生成你的年度账单海报
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-ink-secondary)">
            {dataMode === "real" ? "本地数据" : "内置数据"}
          </span>
        </div>
      </header>

      {/* 工作区：左预览、右控制 */}
      <section
        aria-label="海报工作区"
        className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr]"
      >
        {/* 预览：居中一张 9:16 海报，暗色底衬托 */}
        <div className="mx-auto w-full max-w-sm">
          <div className="overflow-hidden rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface-2) shadow-(--shadow-sm)">
            {input ? (
              <canvas
                ref={previewRef}
                width={PREVIEW_W}
                height={PREVIEW_H}
                aria-label="年度海报预览"
                className="block h-auto w-full"
              />
            ) : (
              <div
                className="grid aspect-[9/16] place-items-center text-sm text-(--color-ink-muted)"
                aria-live="polite"
              >
                生成中…
              </div>
            )}
          </div>
          {input ? (
            <p className="mt-3 text-center text-xs text-(--color-ink-muted)">
              {input.meta.year} · 覆盖 {input.meta.monthsCovered} 个月 ·{" "}
              {input.meta.totalTransactions.toLocaleString("zh-CN")} 笔 · 下载尺寸 1620×2880
            </p>
          ) : null}
        </div>

        {/* 控制区 */}
        <div className="space-y-4">
          <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
            <h2 className="text-base font-bold">选择样式</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {POSTER_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={styleId === style.id}
                  onClick={() => setStyleId(style.id)}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    styleId === style.id
                      ? "border-(--color-primary) bg-(--color-primary-soft) text-(--color-primary)"
                      : "border-(--color-border) text-(--color-ink-secondary) hover:border-(--color-border-strong)"
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-4 rounded-full"
                    style={{ background: STYLE_DOTS[style.id] }}
                  />
                  {style.name}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
            <label htmlFor="poster-slogan" className="text-base font-bold">
              自定义标语
            </label>
            <p className="mt-1 text-xs text-(--color-ink-muted)">
              最多 16 个字，会印在健康指数上方；留空则只显示数据
            </p>
            <input
              id="poster-slogan"
              type="text"
              maxLength={16}
              value={slogan}
              onChange={(event) => setSlogan(event.target.value)}
              placeholder="例如：少一点冲动，多一点从容"
              className="mt-3 block w-full rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm transition-colors outline-none focus:border-(--color-primary)"
            />
            <p className="mt-2 text-right text-xs text-(--color-ink-muted) tabular-nums">
              {slogan.length}/16
            </p>
          </div>

          <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
            <h2 className="text-base font-bold">导出与分享</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={handleDownload}
                disabled={!input || busy !== false}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-(--color-btn-primary) px-4 text-sm font-medium text-white transition-colors hover:bg-(--color-btn-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "download" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="size-4" aria-hidden />
                )}
                下载
              </button>
              <button
                type="button"
                onClick={handleShare}
                disabled={!input || busy !== false}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "share" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Share2 className="size-4" aria-hidden />
                )}
                系统分享
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!input || busy !== false}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-(--color-border) px-4 text-sm font-medium text-(--color-ink-secondary) transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "copy" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                复制图片
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-(--color-ink-muted)">
              系统分享在手机上可直接发到微信/QQ；电脑上可「复制图片」后粘贴进聊天窗口， 或下载{" "}
              {filename} 手动发送。
            </p>
          </div>

          <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5 shadow-(--shadow-sm)">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <HelpCircle className="size-4 text-(--color-primary)" aria-hidden />
              关于这张海报
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-(--color-ink-secondary)">
              <li>
                海报内容是
                {dataMode === "real"
                  ? "你的账单在浏览器本地聚合的年度总览、健康指数与四项关键指标"
                  : "内置演示数据的年度总览、健康指数与四项关键指标（完成体检后自动换成你的数据）"}
                ；
              </li>
              <li>生成与下载全程在浏览器本地完成；</li>
              <li>健康指数低于 60 时，海报会如实展示当前段位——这也是分享的意义。</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 轻提示：底部居中，不打断操作 */}
      <AnimatePresence>
        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-8"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              onAnimationComplete={() => {
                window.setTimeout(() => {
                  setToast((current) => (current?.id === toast.id ? null : current));
                }, 2600);
              }}
              className="flex items-center gap-2 rounded-full bg-(--color-ink) px-4 py-2.5 text-sm text-(--color-surface) shadow-(--shadow-lg)"
            >
              <CircleCheck className="size-4 text-(--color-good)" aria-hidden />
              {toast.text}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** PNG → 剪贴板：ClipboardItem 不支持时抛出，由调用方提示降级 */
async function copyPngToClipboard(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
