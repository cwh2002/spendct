"use client";

import { useMemo, useRef, useState } from "react";

export interface ChargePoint {
  /** YYYY-MM-DD，按天定位横轴 */
  date: string;
  amountCents: number;
}

/** 视口固定值：宽度随容器缩放，高度按设计稿比例（0.3）由 CSS 撑开 */
const W = 320;
const H = 96;
const PAD_X = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

/**
 * 扣费轨迹 sparkline：SVG 手绘折线。
 * 相邻点之间用「中点抖动 + 二次曲线」模拟手绘质感（抖动按序号取模，
 * 确定性生成，不随重渲染变化）。
 * 横轴按真实时间缩放：扣费间隔不规律时线条疏密直接反映周期，
 * 而不是按序等距掩盖断档（例如沉默订阅的数月空窗）。
 * 悬停最近扣费点显示日期与金额；颜色经 currentColor 继承主题色板。
 */
export function ChargeSparkline({ charges }: { charges: ChargePoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { points, linePath, areaPath } = useMemo(() => {
    const times = charges.map((c) => new Date(`${c.date}T00:00:00`).getTime());
    const t0 = times[0] ?? 0;
    const t1 = times[times.length - 1] ?? t0;
    const tSpan = Math.max(t1 - t0, 1);
    const amounts = charges.map((c) => c.amountCents);
    const vMin = amounts.length > 0 ? Math.min(...amounts) : 0;
    const vMax = amounts.length > 0 ? Math.max(...amounts) : 1;
    const vSpan = Math.max(vMax - vMin, 1);

    const xOf = (i: number) => PAD_X + ((times[i]! - t0) / tSpan) * (W - PAD_X * 2);
    const yOf = (i: number) =>
      H - PAD_BOTTOM - ((amounts[i]! - vMin) / vSpan) * (H - PAD_TOP - PAD_BOTTOM);

    const pts = charges.map((c, i) => ({
      x: xOf(i),
      y: yOf(i),
      date: c.date,
      amountCents: c.amountCents,
    }));

    let line = "";
    let area = "";
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i === 0) {
        line = `M ${p.x} ${p.y}`;
        area = `M ${p.x} ${H - PAD_BOTTOM} L ${p.x} ${p.y}`;
        continue;
      }
      const prev = pts[i - 1]!;
      const jitter = (((i * 37) % 7) - 3) * 0.8;
      const mx = (prev.x + p.x) / 2;
      const my = (prev.y + p.y) / 2 + jitter;
      line += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      area += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    if (last) area += ` L ${last.x.toFixed(1)} ${H - PAD_BOTTOM} Z`;

    return { points: pts, linePath: line, areaPath: area };
  }, [charges]);

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el || points.length === 0) return;
    const rect = el.getBoundingClientRect();
    const xPx = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i]!.x - xPx);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="扣费时间序列：横轴为真实时间，纵轴为单次扣费金额"
          className="w-full text-(--color-chart-1)"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {/* 面积填充：仅表达趋势，透明度压低避免抢线 */}
          <path d={areaPath} fill="currentColor" opacity={0.08} />
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            return (
              <g key={`${p.date}-${i}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isLast ? 4.5 : 3}
                  fill="currentColor"
                  stroke="var(--color-surface)"
                  strokeWidth={1.5}
                />
                {hoverIndex === i ? (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={7}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    opacity={0.55}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {hovered ? (
          <span
            className={`pointer-events-none absolute z-10 -translate-x-1/2 max-w-[calc(100%-8px)] truncate rounded-(--radius-sm) bg-(--color-ink) px-2 py-1 text-xs text-(--color-surface) shadow-(--shadow-md) ${
              // 顶部数据点固定向上弹会溢出容器盖住「扣费轨迹」标题：
              // 纵向位置靠上 35% 的点改在下方显示，其余维持上方
              hovered.y / H < 0.35 ? "translate-y-3" : "-translate-y-[120%]"
            }`}
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
            }}
          >
            <span className="font-(--font-mono) tabular-nums">{hovered.date}</span>
            <span className="mx-1 opacity-60">·</span>
            <span className="font-semibold tabular-nums">
              ¥{(hovered.amountCents / 100).toFixed(2)}
            </span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 flex justify-between font-(--font-mono) text-[11px] text-(--color-ink-muted) tabular-nums">
        <span>{first?.date}</span>
        <span>{last?.date}</span>
      </p>
    </div>
  );
}
