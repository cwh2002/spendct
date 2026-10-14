/**
 * 折线/环图/柱图三类的 option 工厂（05 §3.6 标记规范）：
 * 洞察卡、账本汇总、年度报告共用同一套标记规格，避免各页漂移。
 * 工厂内部通过 chartTokens() 读 CSS 变量取色，配合 EChart 的暗色重绘
 * （html class 变化 → 重新调用工厂）自动切到暗面色板。
 * 无 "use client" 指令：本模块只含纯函数，随使用方一起进客户端包。
 *
 * 标签重叠策略（05 §3.6 全局规则 2 的落地口径）：
 * - 折线：x 轴标签 hideOverlap 自动抽稀；均值参考线（markLineAverage）供
 *   「可与预算对比」类卡叠加月均虚线；
 * - 环图：标签只写百分比（名称由图例承担）+ labelLayout.hideOverlap 压字隐藏 +
 *   minShowLabelAngle 拦掉贴边小瓣（labelLayout 仅 pie/funnel 运行时生效，此处合法）；
 * - 柱图：series.labelLayout 在 bar 上无效（LabelManager 只在 pie/funnel 执行），
 *   多柱窄卡改用 formatter 阈值门控——只直标 |值| 前三且不低于最大值 25% 的柱，
 *   全量数值由 tooltip 与数据表兜底。
 */
import * as echarts from "echarts/core";
// 标签/参考线回调参数类型（官方导出路径，避免 any）
import type { CallbackDataParams } from "echarts/types/dist/shared";
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
  /** 数值格式化（tooltip 与均值参考线标签共用），如分转元 */
  formatValue?: (v: number) => string;
  /** 单位后缀，拼在格式化值之后 */
  unit?: string;
  /** y 轴刻度格式化（省略单位后缀，单位语义由 tooltip 与卡面说明承担）；缺省走 ECharts 默认刻度 */
  axisFormat?: (v: number) => string;
  /** 均值参考线：数据均值处画虚线 markLine，label 为参考线名称（如「月均」） */
  markLineAverage?: { label: string };
}

interface DonutOpts {
  /** 高亮单一切片：其余切片降透明度（账本汇总的类别高亮） */
  dimExcept?: string;
  /** 切片值格式化（如分→元）：tooltip 报「名称：金额（占比%）」；缺省时 tooltip 只报占比（演示百分比卡） */
  formatValue?: (v: number) => string;
  /** 单位后缀，拼在格式化值之后 */
  unit?: string;
  /** 图例附值（名称 + 格式化金额）；仅切片 ≤5 时开启，避免窄卡图例换行压环 */
  legendWithValue?: boolean;
}

interface BarOpts {
  colorIndex?: number;
  /** 水平柱（商户排行等长标签场景），圆角改贴右端 [0,3,3,0] */
  horizontal?: boolean;
  formatValue?: (v: number) => string;
  unit?: string;
  /** 数值轴刻度格式化（同 LineOpts.axisFormat） */
  axisFormat?: (v: number) => string;
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
  const { colorIndex = 0, area = true, formatValue, unit = "", axisFormat, markLineAverage } = opts;
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
      // 月份标签自动抽稀 + hideOverlap 兜底：窄卡下相邻标签互相压字时自动隐藏部分标签
      axisLabel: { color: t.inkMuted, fontSize: 10, margin: 8, interval: "auto", hideOverlap: true },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.lineHair } },
      axisLabel: {
        color: t.inkMuted,
        fontSize: 11,
        // 轴刻度与 tooltip 同口径换算（分→元）；缺省不设 formatter，维持 ECharts 默认刻度
        ...(axisFormat ? { formatter: (v: number) => axisFormat(v) } : {}),
      },
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
        // 均值参考线：silent 不响应交互，标签带格式化值（如「月均 1733.12 元」）
        ...(markLineAverage
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: t.lineBase, type: "dashed", width: 1 },
                label: {
                  position: "insideEndTop",
                  color: t.inkMuted,
                  fontSize: 10,
                  formatter: (p: CallbackDataParams) =>
                    `${markLineAverage.label} ${fmt(Number(p.value ?? 0))}`,
                },
                data: [{ type: "average" }],
              },
            }
          : {}),
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

/** 环图：图例置顶居中、环体下移给图例让位、标签只留百分比（名称由图例承担），重叠标签隐藏 */
export function buildDonutOption(data: SeriesData, opts: DonutOpts = {}): ECOption {
  const { dimExcept, formatValue, unit = "", legendWithValue = false } = opts;
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
      // 金额口径报「名称：金额（占比%）」，占比固定 1 位小数；无 formatValue 时只报占比。
      // 参数类型为 CallbackDataParams | CallbackDataParams[]，需先收窄（item 触发恒为单对象）
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p) return "";
        const pct = typeof p.percent === "number" ? p.percent.toFixed(1) : "0.0";
        return formatValue
          ? `${p.name}：${formatValue(Number(p.value ?? 0))}${unit}（${pct}%）`
          : `${p.name}：${pct}%`;
      },
    },
    legend: {
      // 置顶居中：小高度容器里底部图例常与标签线打架，顶部整行更省纵向空间
      top: 0,
      left: "center",
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 8,
      textStyle: { color: t.inkSecondary, fontSize: 10 },
      // legend.formatter 只收到名称字符串：按名称回查数值；无 formatValue 时保持只显名称
      ...(legendWithValue && formatValue
        ? {
            formatter: (name: string) => {
              const i = data.labels.indexOf(name);
              const v = i >= 0 ? (data.values[i] ?? 0) : 0;
              return `${name} ${formatValue(v)}${unit}`;
            },
          }
        : {}),
    },
    series: [
      {
        name: "share",
        type: "pie",
        // 环体整体下移，为顶部图例留出整行高度，标签线不再压到图例
        radius: ["52%", "68%"],
        center: ["50%", "56%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        // 标签只显示百分比：名称已由图例承担，环外文字变短，多切片时重叠大幅减少；
        // 真实卡（带 formatValue）固定 1 位小数，与叙事 sharePct 的 toFixed(1) 同口径
        label: {
          show: true,
          ...(formatValue
            ? { formatter: (p: { percent?: number }) => `${(p.percent ?? 0).toFixed(1)}%` }
            : { formatter: "{d}%" }),
          fontSize: 10,
          color: t.inkSecondary,
        },
        labelLayout: { hideOverlap: true },
        labelLine: { length: 4, length2: 4, lineStyle: { color: t.lineBase } },
        // 小角切片（圆心角 <8°，约 2.2% 占比）不拉标签线：hideOverlap 只处理「重叠」、
        // 不处理「贴边小瓣」；运行时（pie labelLayout）会同时隐藏标签与标签线
        minShowLabelAngle: 8,
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

/** 柱图：barMaxWidth 28、垂直柱圆角 [3,3,0,0]（水平 [0,3,3,0]）、数值直接标签（门控防重叠） */
export function buildBarOption(data: SeriesData, opts: BarOpts = {}): ECOption {
  const { colorIndex = 0, horizontal = false, formatValue, unit = "", axisFormat } = opts;
  const t = chartTokens();
  const color = t.palette[colorIndex] ?? "#2e7ce8";
  const fmt = (v: number) => `${formatValue ? formatValue(v) : v}${unit}`;

  // 重叠规避（05 §3.6 全局规则 2「直接标签只给高亮标记」）：
  // 只直标 |值| 前三且 ≥ |最大值|×25% 的柱；bar 系列在 ECharts 运行时不会执行
  // series.labelLayout（仅 pie/funnel 走 LabelManager），门控只能在 formatter 里做。
  // 全量数值由 tooltip 与数据表视图兜底。
  const maxAbsValue = data.values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const labelableIdx = new Set(
    data.values
      .map((v, i): [number, number] => [v, i])
      .sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))
      .slice(0, 3)
      .filter(([v]) => Math.abs(v) >= maxAbsValue * 0.25)
      .map(([, i]) => i),
  );

  const categoryAxis = {
    type: "category" as const,
    data: data.labels,
    axisLine: { lineStyle: { color: t.lineBase } },
    axisTick: { show: false },
    axisLabel: {
      color: t.inkMuted,
      fontSize: 11,
      margin: 12,
      // 类目过多时自动抽稀显示，避免窄卡下相邻标签互相压字
      hideOverlap: true,
      ...(horizontal
        ? { width: 96, overflow: "truncate" as const } // 商户长名超宽截断（tooltip 给全名）
        : { rotate: 25 }), // 环比类目/日期等长标签倾斜 25°，与数值标签错开
    },
  };
  const valueAxis = {
    type: "value" as const,
    splitLine: { lineStyle: { color: t.lineHair } },
    axisLabel: {
      color: t.inkMuted,
      fontSize: 11,
      ...(axisFormat ? { formatter: (v: number) => axisFormat(v) } : {}),
    },
  };

  return {
    color: [color],
    textStyle: { fontFamily: t.fontSans, color: t.inkSecondary, fontSize: 12 },
    grid: { left: 8, right: horizontal ? 72 : 16, top: 28, bottom: 4, containLabel: true },
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
          // 横向柱的数值标签悬在柱右端：固定 4px 间距，避免贴柱粘连、又不会吃满右留白
          ...(horizontal ? { distance: 4 } : {}),
          color: t.inkSecondary,
          fontSize: 11,
          // 标签只留数值不拼单位（单位由 tooltip 与卡面说明承担）；
          // 未入选门控集合的柱返回空串 = 不画标签，多柱窄卡不再互相压字
          formatter: (p) => (labelableIdx.has(p.dataIndex) ? fmt(Number(p.value)) : ""),
        },
        emphasis: { focus: "series" },
      },
    ],
  };
}
