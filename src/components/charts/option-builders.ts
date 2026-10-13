/**
 * 折线/环图/柱图三类的 option 工厂（05 §3.6 标记规范）：
 * 洞察卡、账本汇总、年度报告共用同一套标记规格，避免各页漂移。
 * 工厂内部通过 chartTokens() 读 CSS 变量取色，配合 EChart 的暗色重绘
 * （html class 变化 → 重新调用工厂）自动切到暗面色板。
 * 无 "use client" 指令：本模块只含纯函数，随使用方一起进客户端包。
 */
import * as echarts from "echarts/core";
import { chartTokens, type ECOption } from "./e-chart";

export interface SeriesData {
  labels: string[];
  values: number[];
}

interface LineOpts {
  /** 取色板槽位（多系列按序递增）；颜色跟实体不跟排名（05 §3.1.3） */
  colorIndex?: number;
  /** 面积渐变填充（默认开，05 §3.6 line 规范：0.08 → 0 透明度） */
  area?: boolean;
  /** 数值格式化（tooltip 与轴标签共用），如分转元 */
  formatValue?: (v: number) => string;
  /** 单位后缀，拼在格式化值之后 */
  unit?: string;
}

interface DonutOpts {
  /** 高亮单一切片：其余切片降透明度（账本汇总的类别高亮） */
  dimExcept?: string;
}

interface BarOpts {
  colorIndex?: number;
  /** 水平柱（商户排行等长标签场景），圆角改贴右端 [0,3,3,0] */
  horizontal?: boolean;
  formatValue?: (v: number) => string;
  unit?: string;
}

/** 分 → 元：整数元不带小数尾（18000 → "180.00" 保留两位避免表格对齐抖动，图表标签同口径） */
export function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 十六进制色加 alpha（面积渐变用）；oklch 等无法解析的值原样返回 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 折线：lineWidth 2、symbol circle 8、默认不显示符号（仅悬停）、轴触发 tooltip + 十字准星 */
export function buildLineOption(data: SeriesData, opts: LineOpts = {}): ECOption {
  const { colorIndex = 0, area = true, formatValue, unit = "" } = opts;
  const t = chartTokens();
  const color = t.palette[colorIndex] ?? "#2e7ce8";
  const fmt = (v: number) => `${formatValue ? formatValue(v) : v}${unit}`;

  return {
    color: [color],
    textStyle: { fontFamily: t.fontSans, color: t.inkSecondary, fontSize: 12 },
    grid: { left: 8, right: 16, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: "border-radius:8px;",
      valueFormatter: (v) => fmt(Number(v)),
      axisPointer: {
        type: "cross",
        crossStyle: { color: t.lineBase },
        lineStyle: { color: t.lineBase, type: "dashed" },
        label: { show: false },
      },
    },
    xAxis: {
      type: "category",
      data: data.labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.lineBase } },
      axisTick: { show: false },
      axisLabel: { color: t.inkMuted, fontSize: 11, margin: 12 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.lineHair } },
      axisLabel: { color: t.inkMuted, fontSize: 11 },
    },
    series: [
      {
        name: "value",
        type: "line",
        data: data.values,
        smooth: true,
        lineStyle: { width: 2 },
        symbol: "circle",
        symbolSize: 8,
        showSymbol: false,
        emphasis: { focus: "series" },
        ...(area
          ? {
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: withAlpha(color, 0.08) },
                  { offset: 1, color: withAlpha(color, 0) },
                ]),
              },
            }
          : {}),
      },
    ],
  };
}

/** 环图：radius 62–80%、切片间 2px 表面描边、图例外置、直接标签（重叠加隐藏） */
export function buildDonutOption(data: SeriesData, opts: DonutOpts = {}): ECOption {
  const { dimExcept } = opts;
  const t = chartTokens();

  return {
    color: t.palette,
    textStyle: { fontFamily: t.fontSans, color: t.inkSecondary, fontSize: 12 },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: "border-radius:8px;",
      formatter: "{b}：{c}（{d}%）",
    },
    legend: {
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { color: t.inkSecondary, fontSize: 11 },
    },
    series: [
      {
        name: "share",
        type: "pie",
        radius: ["62%", "80%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: true, formatter: "{b} {d}%", fontSize: 10, color: t.inkSecondary },
        labelLayout: { hideOverlap: true },
        labelLine: { length: 6, length2: 6, lineStyle: { color: t.lineBase } },
        emphasis: { scale: true, scaleSize: 4 },
        data: data.values.map((v, i) => ({
          value: v,
          name: data.labels[i] ?? `系列${i + 1}`,
          ...(dimExcept && data.labels[i] !== dimExcept ? { itemStyle: { opacity: 0.25 } } : {}),
        })),
      },
    ],
  };
}

/** 柱图：barMaxWidth 28、垂直柱圆角 [3,3,0,0]（水平 [0,3,3,0]）、数值直接标签 */
export function buildBarOption(data: SeriesData, opts: BarOpts = {}): ECOption {
  const { colorIndex = 0, horizontal = false, formatValue, unit = "" } = opts;
  const t = chartTokens();
  const color = t.palette[colorIndex] ?? "#2e7ce8";
  const fmt = (v: number) => `${formatValue ? formatValue(v) : v}${unit}`;

  const categoryAxis = {
    type: "category" as const,
    data: data.labels,
    axisLine: { lineStyle: { color: t.lineBase } },
    axisTick: { show: false },
    axisLabel: { color: t.inkMuted, fontSize: 11, margin: 12 },
  };
  const valueAxis = {
    type: "value" as const,
    splitLine: { lineStyle: { color: t.lineHair } },
    axisLabel: { color: t.inkMuted, fontSize: 11 },
  };

  return {
    color: [color],
    textStyle: { fontFamily: t.fontSans, color: t.inkSecondary, fontSize: 12 },
    grid: { left: 8, right: horizontal ? 56 : 16, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.lineHair,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: "border-radius:8px;",
      valueFormatter: (v) => fmt(Number(v)),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [
      {
        name: "value",
        type: "bar",
        data: data.values,
        barMaxWidth: 28,
        itemStyle: { color, borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
        label: {
          show: true,
          position: horizontal ? "right" : "top",
          color: t.inkSecondary,
          fontSize: 11,
          formatter: (p) => fmt(Number(p.value)),
        },
        emphasis: { focus: "series" },
      },
    ],
  };
}
