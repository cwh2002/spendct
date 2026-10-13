"use client";

import * as echarts from "echarts/core";
import type { ComposeOption, ECElementEvent } from "echarts/core";
import { BarChart, GaugeChart, LineChart, PieChart, RadarChart } from "echarts/charts";
import type {
  BarSeriesOption,
  GaugeSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  RadarSeriesOption,
} from "echarts/charts";
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent } from "echarts/components";
import type {
  GridComponentOption,
  LegendComponentOption,
  RadarComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useCallback, useEffect, useRef } from "react";

// 按需注册（05 §1.1）：只打包用到的图表与组件，页面无需再关心注册顺序。
// 注册在模块顶层执行一次，多页面共享同一个 echarts/core 实例。
echarts.use([
  BarChart,
  GaugeChart,
  LineChart,
  PieChart,
  RadarChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** 按需注册子集组合出的 option 类型：未注册的组件/系列直接报类型错误 */
export type ECOption = ComposeOption<
  | BarSeriesOption
  | GaugeSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | RadarSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | RadarComponentOption
  | TooltipComponentOption
>;

/**
 * 读取设计令牌 CSS 变量（05 §3.6）：
 * 色板在 html.dark 上重声明，经 var() 重解析自动换肤，业务代码不维护两份颜色。
 */
export function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value ? value.trim() : fallback;
}

/** 工具提示文本色：跟随主题的文字令牌，不随系列色 */
export function chartInk() {
  return {
    ink: cssVar("--color-ink", "#16181d"),
    inkSecondary: cssVar("--color-ink-secondary", "#52555c"),
    inkMuted: cssVar("--color-ink-muted", "#8a8f99"),
    surface: cssVar("--color-surface", "#ffffff"),
    line: cssVar("--color-border", "#e8eaee"),
  };
}

/** 分类色板 8 槽（05 §3.1.3，顺序取用不跳槽）；暗色经 var() 重解析自动换值 */
const FALLBACK_PALETTE = [
  "#2e7ce8",
  "#f26b38",
  "#0fa87a",
  "#eda100",
  "#e87ba4",
  "#0b8f45",
  "#6a5ae0",
  "#e34948",
];

export function chartPalette(): string[] {
  return Array.from({ length: 8 }, (_, i) =>
    cssVar(`--color-chart-${i + 1}`, FALLBACK_PALETTE[i] ?? "#2e7ce8"),
  );
}

/** 图表主题令牌全集：option 工厂函数每次调用都重读，暗色切换后即取到暗面值 */
export interface ChartTokens {
  palette: string[];
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  surface: string;
  surface2: string;
  lineHair: string;
  lineBase: string;
  fontSans: string;
  fontMono: string;
}

export function chartTokens(): ChartTokens {
  return {
    palette: chartPalette(),
    ink: cssVar("--color-ink", "#16181d"),
    inkSecondary: cssVar("--color-ink-secondary", "#52555c"),
    inkMuted: cssVar("--color-ink-muted", "#8a8f99"),
    surface: cssVar("--color-surface", "#ffffff"),
    surface2: cssVar("--color-surface-2", "#eef0f4"),
    lineHair: cssVar("--color-border", "#e8eaee"),
    lineBase: cssVar("--color-border-strong", "#c9cdd4"),
    fontSans: cssVar("--font-sans", "system-ui, sans-serif"),
    fontMono: cssVar("--font-mono", "monospace"),
  };
}

interface EChartProps {
  /**
   * 图表配置。需要随暗色切换刷新色板时传「返回 option 的函数」：
   * 组件在 html class 变化后会重新调用函数（函数内经 cssVar 取色）；
   * 传对象则视为静态配置，重绘时原样重放。
   */
  option: ECOption | (() => ECOption);
  /** 图表容器高度（px 数字或任意 CSS 高度字符串）。宽度跟随父容器，无需指定 */
  height: number | string;
  className?: string;
  /** canvas 对屏幕阅读器不可见，用 aria-label 补图表语义 */
  ariaLabel?: string;
  /** 图形元素点击回调：账本汇总/洞察卡的「图表锚点追问」入口（05 §1.6） */
  onClick?: (params: ECElementEvent) => void;
}

/**
 * 共享 ECharts 容器（05 §3.6）：
 * 内部处理初始化、容器尺寸监听（ResizeObserver）、卸载销毁，
 * 以及暗色切换监听（MutationObserver 观察 html class）→ 重取 CSS 变量后 setOption 重绘。
 */
export function EChart({ option, height, className = "", ariaLabel, onClick }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  // 最新值引用在提交后同步（渲染期写 ref 违反 React 19 规则）：
  // 事件回调与观察器只在提交后的交互中读取，读到的一定是最新值
  const optionRef = useRef(option);
  const onClickRef = useRef(onClick);

  useEffect(() => {
    optionRef.current = option;
    onClickRef.current = onClick;
  });

  const applyOption = useCallback((chart: echarts.EChartsType) => {
    const latest = optionRef.current;
    const opt = typeof latest === "function" ? latest() : latest;
    // notMerge：暗色重绘时完整覆盖，避免亮色系列样式残留
    chart.setOption(opt, { notMerge: true });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chartRef.current = chart;
    applyOption(chart);

    // 图形点击 → 锚点追问（chart.dispose 时事件随之销毁，无需单独解绑）
    chart.on("click", (params) => onClickRef.current?.(params));

    // 容器尺寸变化（含窗口缩放、侧栏开合）驱动图表 resize
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(el);

    // 暗色切换：theme-toggle 只改 html 的 class，观察 class 属性变化后重绘
    const classObserver = new MutationObserver(() => applyOption(chart));
    classObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      classObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [applyOption]);

  // option 变化（父组件需用 useMemo/useCallback 稳定引用）时增量更新
  useEffect(() => {
    const chart = chartRef.current;
    if (chart) applyOption(chart);
  }, [option, applyOption]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className={`${onClick ? "cursor-pointer" : ""} ${className}`.trim()}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    />
  );
}
