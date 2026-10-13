/**
 * 数据可见性对照表单一数据源（02 §8 定稿表）。
 * /privacy 页与顶栏 PrivacyBadge（05 §2.9）共用此清单，避免两处维护漂移。
 * 行口径与 docs/02-data-privacy.md §8 一致（该文档裁决本表为全项目唯一维护点，
 * PDF 技术文档第二章逐字复制），新增/修改行时必须同步该文档。
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
   * LLM（DeepSeek-V3 / Qwen / GLM-4V-Flash）看到什么：
   * aggregated = 仅聚合摘要；hashed = 仅哈希占位（@{m:hash}）；never = 永不；
   * "-" = 不适用（如发出方自身产物，见 note）
   */
  llm: "aggregated" | "hashed" | "never" | "-";
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
  if (row.llm === "aggregated" || row.llm === "hashed" || row.server === "relay") return "llm";
  return "local";
}

export const VISIBILITY_ROWS: VisibilityRow[] = [
  {
    item: "原始 CSV 文件",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "FileReader 本地解析，解析后即释放、不写入任何存储；格式兜底片段见第 19 行",
  },
  {
    item: "清洗后交易明细",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "仅存 DuckDB-WASM 与 OPFS，永不出浏览器",
  },
  {
    item: "交易单号 / 商户单号",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "库内 external_id 保留，供审计回链",
  },
  {
    item: "交易对手方 / 备注",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "脱敏器 S3 强制剥离",
  },
  {
    item: "明细级金额",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "大模型仅见 S1 金额分箱与 S4 聚合值",
  },
  {
    item: "月度汇总",
    browser: "computed",
    llm: "aggregated",
    server: "never",
    note: "S4 规整后可见，行数上限 200",
  },
  {
    item: "分类聚合（月 × 类别）",
    browser: "computed",
    llm: "aggregated",
    server: "never",
    note: "洞察卡证据的主要数据形态",
  },
  {
    item: "商户聚合（n≥5 笔）",
    browser: "computed",
    llm: "hashed",
    server: "never",
    note: "仅 @{m:hash} 占位；订阅模式命中同理仅哈希；n≥5 且开关开启时由渲染端还原明文",
  },
  {
    item: "商户哈希映射",
    browser: "computed",
    llm: "hashed",
    server: "never",
    note: "加盐哈希与本地可逆映射只存浏览器",
  },
  {
    item: "聚合 SQL 原文",
    browser: "computed",
    llm: "-",
    server: "never",
    note: "发出方可见自己发出的 SQL（仅聚合形态）",
  },
  {
    item: "洞察卡 JSON（结论 + 证据 + 来源）",
    browser: "computed",
    llm: "aggregated",
    server: "relay",
    note: "含案例库引用；服务器流式转发，不落盘",
  },
  {
    item: "用户追问文本",
    browser: "local-only",
    llm: "-",
    server: "relay",
    note: "对话必需，完整文本随追问发送；对话历史仅缓存浏览器 IndexedDB；服务器流式转发，不落盘",
  },
  {
    item: "账单截图原图（OCR）",
    browser: "local-only",
    llm: "-",
    server: "relay",
    note: "仅 GLM-4V-Flash 视觉模型可见，文本模型不可见；服务器仅内存转发，不落盘、不记日志",
  },
  {
    item: "OCR 识别结果",
    browser: "local-only",
    llm: "-",
    server: "relay",
    note: "确认表展示，低置信度字段标黄复核；转发，不落盘",
  },
  {
    item: "示例账单（sample-data）",
    browser: "local-only",
    llm: "aggregated",
    server: "-",
    note: "与真实账单同一规则（聚合 + 脱敏）；公开副本本就是虚构数据",
  },
  {
    item: "微信昵称 / 账号信息",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "仅页面展示，不存储",
  },
  {
    item: "错误日志",
    browser: "local-only",
    llm: "-",
    server: "-",
    note: "仅 SQL 报错信息（不含数据）；服务器只记状态码",
  },
  {
    item: "健康指数",
    browser: "computed",
    llm: "aggregated",
    server: "never",
    note: "六维加权分，纯聚合指标",
  },
  {
    item: "CSV 格式兜底片段",
    browser: "computed",
    llm: "-",
    server: "relay",
    note: "仅格式无法识别且用户确认后发送，≤6KB 截断，只返回字段映射建议",
  },
  {
    item: "商户分类任务文本",
    browser: "computed",
    llm: "-",
    server: "relay",
    note: "仅未命中本地词典的商户主名，批量发送，返回名称 → 12 类映射",
  },
  {
    item: "预算配置（budgets）",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "用户自建配置，存 DuckDB OPFS（08 修订案 A1）；仅当月 + 未来 2 月可编辑",
  },
  {
    item: "预算聚合摘要",
    browser: "computed",
    llm: "aggregated",
    server: "relay",
    note: "预算 vs 实际、下月预测（≤13 行，S4 规整后，08 修订案 A2）；JSON 转发，不落盘",
  },
  {
    item: "成就 / 收藏 / 通知 / 导出",
    browser: "local-only",
    llm: "never",
    server: "never",
    note: "localStorage ≤24KB（不含行数据）；导出文件内存构建、本地下载，不经服务端",
  },
];
