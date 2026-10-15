/**
 * 数据可见性对照表单一数据源（02 §8 定稿表）。
 * /privacy 页与顶栏 PrivacyBadge（05 §2.9）共用此清单，避免两处维护漂移。
 * 表内文案为面向用户的人话版本（2026-10-14 全站去技术化时改写），
 * 技术口径以 docs/02-data-privacy.md §8 为准；新增/修改行时同步该文档。
 */

export interface VisibilityRow {
  /** 数据项名称（与 02 §8 表第一列对应） */
  item: string;
  /**
   * 浏览器（用户本地）看到什么：
   * local-only = 仅存本地（DuckDB/OPFS/内存/输入框）；computed = 在本地被计算或渲染；
   * "-" = 该项不产生于浏览器
   */
  browser: "local-only" | "computed" | "-";
  /**
   * LLM（DeepSeek / Qwen / 视觉模型 deepseek-flash·GLM）看到什么：
   * aggregated = 仅聚合摘要；hashed = 仅哈希占位（@{m:hash}）；never = 永不；
   * detail = 追问在线兜底时可见汇总统计 + 最近 150 笔明细快照（08 修订案 A8）；
   * "-" = 不适用（如发出方自身产物，见 note）
   */
  llm: "aggregated" | "hashed" | "never" | "detail" | "-";
  /**
   * 服务器（Next.js API 接入层）看到什么：
   * relay = 仅内存转发、不落盘；never = 永不上传；"-" = 不适用
   */
  server: "relay" | "never" | "-";
  /** 口径补充说明（表格数据项单元格内的小字展示） */
  note?: string;
}

/** 行色调分类：驱动 /privacy 表格底标与三色图例 */
export type VisibilityTone = "local" | "llm" | "never";

/**
 * 色调判定（优先级固定）：
 * 1. never —— LLM 与服务器都不可见：永不上传行；
 * 2. llm —— LLM 可见聚合/哈希，或经服务器内存转发：部分出浏览器行；
 * 3. local —— 其余：只在浏览器内产生与使用。
 */
export function visibilityTone(row: VisibilityRow): VisibilityTone {
  if (row.llm === "never" && row.server === "never") return "never";
  if (
    row.llm === "aggregated" ||
    row.llm === "hashed" ||
    row.llm === "detail" ||
    row.server === "relay"
  ) {
    return "llm";
  }
  return "local";
}

export const VISIBILITY_ROWS: VisibilityRow[] = [
  {
    item: "原始账单文件",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "只在你自己的浏览器里打开和识别，识别完立即释放、不留存；格式识别不出时的兜底见第 19 行",
  },
  {
    item: "清洗后交易明细",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "只存在你的浏览器里，永不上传任何服务器；本地答不了的追问会发送最近 150 笔明细快照（见第 24 行）",
  },
  {
    item: "交易单号 / 商户单号",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "交易单号只留在本地，方便你回查原始账单",
  },
  {
    item: "交易对手方 / 备注",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "对方名称和备注会被自动抹掉，绝不外传",
  },
  {
    item: "明细级金额",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "AI 默认只能看到按档位归类的金额和汇总值；追问快照里的真实金额见第 24 行",
  },
  {
    item: "月度汇总",
    browser: "computed",
    llm: "aggregated",
    server: "never",
    note: "按月汇总后可见，最多 200 条",
  },
  {
    item: "分类汇总（按月 × 类别）",
    browser: "computed",
    llm: "aggregated",
    server: "never",
    note: "分析结论卡的主要数据来源",
  },
  {
    item: "商户汇总（满 5 笔）",
    browser: "computed",
    llm: "hashed",
    server: "never",
    note: "AI 只看到打码后的商户代号，订阅识别同理；交易满 5 笔且你开启显示时，页面才会还原商户名称；追问快照会带真实商户名（见第 24 行）",
  },
  {
    item: "商户代号与真实名称的对照表",
    browser: "computed",
    llm: "hashed",
    server: "never",
    note: "这份对照表只存在你的浏览器里，绝不上传；追问快照会带真实商户名（见第 24 行）",
  },
  {
    item: "发送给 AI 的查询内容",
    browser: "computed",
    llm: "-",
    server: "never",
    note: "只有查询发起方自己能看，且只涉及统计",
  },
  {
    item: "分析卡片内容（结论 + 依据 + 来源）",
    browser: "computed",
    llm: "aggregated",
    server: "relay",
    note: "含案例库引用；服务器只负责转发，不留存",
  },
  {
    item: "用户追问文本",
    browser: "local-only",
    llm: "-",
    server: "relay",
    note: "只有你追问时才发送，这是对话必需；对话历史只存在你的浏览器里；服务器只负责转发，不留存",
  },
  {
    item: "账单截图原图",
    browser: "local-only",
    llm: "-",
    server: "relay",
    note: "只有负责识别截图的功能能看到；服务器只负责转发，不留存、不记日志",
  },
  {
    item: "截图识别结果",
    browser: "local-only",
    llm: "-",
    server: "relay",
    note: "在确认表里展示，识别不准的栏目标黄提醒你核对；服务器只转发，不留存",
  },
  {
    item: "内置账单",
    browser: "local-only",
    llm: "aggregated",
    server: "-",
    note: "与真实账单同一套保护规则（仅统计 + 打码）",
  },
  {
    item: "微信昵称 / 账号信息",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "只在你自己的页面上展示，不保存",
  },
  {
    item: "错误日志",
    browser: "local-only",
    llm: "-",
    server: "-",
    note: "只有报错信息（不含账单数据）；服务器只记录成功与否",
  },
  {
    item: "健康指数",
    browser: "computed",
    llm: "aggregated",
    server: "never",
    note: "由六项指标综合得出，只涉及统计",
  },
  {
    item: "格式兜底片段",
    browser: "computed",
    llm: "-",
    server: "relay",
    note: "只有账单格式识别不了、且你确认后才发送，只截取很小一段，仅用来返回栏目建议",
  },
  {
    item: "商户分类文本",
    browser: "computed",
    llm: "-",
    server: "relay",
    note: "只有本地认不出的商户名才会发送，返回商户分类结果",
  },
  {
    item: "预算设置",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "你自己设定的预算，只存在你的浏览器里；只能改当月和接下来两个月",
  },
  {
    item: "预算汇总摘要",
    browser: "computed",
    llm: "aggregated",
    server: "relay",
    note: "预算与实际对比、下月预测（最多 13 条）；服务器只转发，不留存",
  },
  {
    item: "成就 / 收藏 / 通知 / 导出",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "只存在你的浏览器里；导出文件直接在本地生成并下载，不经服务器",
  },
  {
    item: "追问明细快照",
    browser: "computed",
    llm: "detail",
    server: "relay",
    note: "只有本地答不了、转在线分析时才会发送：汇总统计 + 最近 150 笔明细（日期/类目/商户/金额/方向），回答气泡会按实际发送的账单数据段标注（统计与明细都发送时标注「已发送明细与统计」）；服务器只转发，不留存",
  },
  {
    item: "语音输入（可选）",
    browser: "computed",
    llm: "never",
    server: "never",
    note: "音频由浏览器语音服务转写，本项目服务器与 LLM 都不接收音频；转写出的文字与手打内容同等对待（见「用户追问文本」行）",
  },
];
