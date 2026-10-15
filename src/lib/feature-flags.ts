/**
 * 功能开关（05 §1.1 与 06 路线图联动）：
 * 路线图决定砍掉某条线时，这里切 false，入口组件读开关自动隐藏对应 UI，
 * 避免交付窗口内到处临时删代码、回归时再补回来。
 * 八个开关各自对应：
 *   ocr          上传页截图识别入口
 *   mcp          服务端 MCP 三工具（关闭后仅浏览器两工具 duckdb_meta/sql）
 *   brush        图表框选追问（关闭后退化为点选锚定）
 *   dark         暗色主题（关闭后仅亮色：防闪脚本与切换按钮一并隐藏）
 *   budget       预算中心 /budget 与快速记账入口
 *   reportStory  年度报告数据故事布局（关闭回退旧版报告布局）
 *   achievements 成就段位
 *   learn        知识课堂 /learn（关闭时首页对应卡灰显「即将上线」）
 */
/* 键集合保持 as const 得到字面量联合（供 Capability.flag 引用），
   值类型放宽为 boolean：开关关闭时切 false，消费方 `=== false` 判断才不触发 TS2367 */
const FLAG_DEFAULTS = {
  ocr: true,
  mcp: true,
  brush: true,
  dark: true,
  budget: true,
  reportStory: true,
  achievements: true,
  learn: true,
} as const;

export const featureFlags: Record<keyof typeof FLAG_DEFAULTS, boolean> = FLAG_DEFAULTS;
