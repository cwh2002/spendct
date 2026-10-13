/**
 * 账单导入域类型（T3/T4 CSV 嗅探的单一契约，对齐 07 契约 §3/§9/§15）。
 *
 * BillRow 是微信/支付宝原始 CSV 解析后的标准账单行：上传预览、去重、
 * buildCleanCsv 都基于它；进入 DuckDB 时再展平为标准列。
 */

/** 标准账单行。金额单位为整数分（07 §3 全项目唯一金额单位），时间为本地时间 ISO 串 */
export interface BillRow {
  /** 交易日期 YYYY-MM-DD（解析器保证补零） */
  dateIso: string;
  /** 交易时刻 HH:mm:ss；原文件只到分钟时补 :00；纯日期账单没有该字段 */
  timeIso?: string;
  /** 12 类目之一（07 §3 类目枚举）；解析期无法归类时落「其他」，clean 阶段按商户词典细分 */
  category: string;
  /** 原始商户名（仅存于浏览器 DuckDB，07 §3） */
  merchant: string;
  channel: "wechat" | "alipay";
  direction: "expense" | "income";
  /** 金额：整数分，恒为正；退款行的标记放在 note 前缀（退款按原支出方向记账） */
  amountCents: number;
  /** 交易单号（微信「交易单号」/支付宝「交易号」） */
  rawRef?: string;
  /** 备注或商品说明；退款行以「[退款] 」前缀标记，供 clean 阶段匹配原单 */
  note?: string;
}

export interface ParseResult {
  /** 渠道识别结果；unknown 时 rows 通常为空（除非文件名提示了渠道） */
  format: "wechat" | "alipay" | "unknown";
  /** 高=表头完整命中；中=缺失可选列用默认值；低=位置兜底/编码异常/渠道靠文件名猜 */
  confidence: "high" | "medium" | "low";
  rows: BillRow[];
  /** 面向用户的提示（编码、跳过行、疑似重复），上传页逐条渲染 */
  warnings: string[];
  /** 原始表头 → 标准字段名（camelCase），供映射确认 UI 展示 */
  mapping: Record<string, string>;
}
