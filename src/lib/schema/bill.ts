/**
 * 账单 schema 单一事实源（07 契约 §3，逐字实现）。
 *
 * 明细表只有一张：transactions（02 §5.2 DDL 为唯一来源）。
 * 金额单位一律整数分；类目 12 类；深夜时段 23:00-05:00。
 * 13 视图与 9 张六阶段预计算表的建表 SQL 全部收在本文件，
 * 由 src/lib/duckdb/dataset.ts 按序执行（可信连接，不走 SQL 白名单）。
 */

/** 12 类目枚举（07 §3 唯一；外卖归入餐饮，不单设「转账」） */
export const CATEGORY_CODES = [
  "餐饮",
  "交通",
  "购物",
  "娱乐",
  "居住",
  "通讯",
  "医疗",
  "教育",
  "人情",
  "金融",
  "订阅",
  "其他",
] as const;

export type CategoryCode = (typeof CATEGORY_CODES)[number];

/** 收付方向：income 仅 manual 快速记账行使用（08 修订案 A3），其余行 expense */
export type Direction = "expense" | "income" | "neutral";

/** 渠道：wechat|alipay|manual（08 修订案 A3） */
export type Channel = "wechat" | "alipay" | "manual";

/** 数据来源：wechat|alipay|ocr|sample|manual（08 修订案 A3） */
export type Source = "wechat" | "alipay" | "ocr" | "sample" | "manual";

/** transactions 的 18 列（与 TRANSACTIONS_DDL 列集一致；插入与校验按此顺序） */
export const TRANSACTION_COLUMNS = [
  "tx_id",
  "account_id",
  "ts",
  "date_iso",
  "amount_cents",
  "direction",
  "merchant",
  "counterparty",
  "category",
  "sub_category",
  "channel",
  "status",
  "external_id",
  "note",
  "raw_ref",
  "source",
  "_meta",
  "imported_files",
] as const;

/** 解析期 / 清洗后交易行的公共字段（与 07 §3 DDL 列一一对应；ts 一律 ISO 字符串） */
interface TransactionBase {
  /** 交易唯一键：解析期为 rawId = F{sha256-8}#L{行号}，清洗后为 sha256 前 16 位 hex */
  tx_id: string;
  account_id: string;
  /** 原始交易时间，ISO 字符串（DuckDB TIMESTAMP 可直接解析） */
  ts: string;
  /** YYYY-MM-DD */
  date_iso: string;
  /** 金额：整数分（全项目唯一金额单位） */
  amount_cents: number;
  direction: Direction;
  /** 原始商户名（仅存于浏览器 DuckDB） */
  merchant: string;
  counterparty: string | null;
  /** 12 类之一；解析期无法归类时落「其他」 */
  category: CategoryCode;
  sub_category: string | null;
  channel: Channel;
  status: string;
  /** 交易单号 */
  external_id: string | null;
  note: string | null;
  /** F{sha256-8}#L{行号}；manual 行为 M#<自增序号> */
  raw_ref: string | null;
  source: Source;
  /** JSON 序列化字符串（schema_version/generated_at/隐私开关键/已导入文件 sha256 等） */
  _meta: string | null;
  imported_files: string[];
}

/**
 * 解析期交易行（07 §3 TS 类型）：tx_id 为 rawId = F{sha256-8}#L{行号}，
 * 经 clean 阶段去重与归一后产出 CleanTransaction。
 */
export interface RawTransaction extends TransactionBase {
  /** 解析期 rawId：F{sha256-8}#L{行号} */
  tx_id: string;
}

/**
 * 清洗后交易行（07 §3 TS 类型）：tx_id 为 sha256(交易指纹) 前 16 位 hex，
 * direction/status/category 已归一，可直接落库。
 */
export interface CleanTransaction extends TransactionBase {
  /** 清洗后唯一键：sha256(交易指纹) 前 16 位 hex */
  tx_id: string;
}

/** transactions DDL（07 §3 逐字） */
export const TRANSACTIONS_DDL = `CREATE TABLE transactions (
  tx_id        VARCHAR PRIMARY KEY,      -- sha256(交易指纹) 前16位 hex
  account_id   VARCHAR,
  ts           TIMESTAMP,                -- 原始交易时间
  date_iso     VARCHAR,                  -- YYYY-MM-DD
  amount_cents BIGINT NOT NULL,          -- 金额单位：分（全项目唯一金额单位）
  direction    VARCHAR CHECK (direction IN ('expense','income','neutral')),
  merchant     VARCHAR,                  -- 原始商户名（仅存于浏览器 DuckDB）
  counterparty VARCHAR,
  category     VARCHAR,                  -- 12 类之一（见下）
  sub_category VARCHAR,
  channel      VARCHAR,                  -- wechat|alipay|manual（A3）
  status       VARCHAR,
  external_id  VARCHAR,                  -- 交易单号
  note         VARCHAR,
  raw_ref      VARCHAR,                  -- F{sha256-8}#L{行号}
  source       VARCHAR,                  -- wechat|alipay|ocr|sample|manual（A3）
  _meta        JSON,
  imported_files VARCHAR[]
)`;

/**
 * 13 视图定义（07 §3 唯一清单；02 §5.3 六个核心视图 SQL 为唯一来源）。
 *
 * 依赖顺序注意：v_health_inputs 引用 v_impulse_events，必须后建；
 * dataset.ts 按对象键序执行，不要调换两者先后。
 */
export const VIEW_DEFS: Readonly<Record<string, string>> = {
  v_monthly_summary: `CREATE OR REPLACE VIEW v_monthly_summary AS
SELECT account_id,
       date_trunc('month', ts) AS month,
       SUM(CASE WHEN direction='expense' AND status='paid' THEN amount_cents ELSE 0 END) AS expense_cents,
       SUM(CASE WHEN direction='income'  AND status='paid' THEN amount_cents ELSE 0 END) AS income_cents,
       COUNT(*) FILTER (WHERE direction='expense' AND status='paid') AS expense_tx,
       COUNT(*) FILTER (WHERE direction='income'  AND status='paid') AS income_tx,
       MAX(amount_cents) AS largest_cents,
       AVG(amount_cents) AS avg_cents,
       SUM(CASE WHEN status='refunded' THEN amount_cents ELSE 0 END) AS refund_cents,
       COUNT(DISTINCT date_iso) AS active_days
FROM transactions GROUP BY account_id, 2`,

  v_category_monthly: `CREATE OR REPLACE VIEW v_category_monthly AS
SELECT account_id, date_trunc('month', ts) AS month, category,
       SUM(CASE WHEN direction='expense' AND status='paid' THEN amount_cents ELSE 0 END) AS expense_cents,
       COUNT(*) FILTER (WHERE direction='expense' AND status='paid') AS tx_count
FROM transactions GROUP BY account_id, 2, 3`,

  v_merchant_monthly: `CREATE OR REPLACE VIEW v_merchant_monthly AS
SELECT account_id, date_trunc('month', ts) AS month, merchant,
       SUM(amount_cents) AS total_cents, COUNT(*) AS tx_count, AVG(amount_cents) AS avg_cents
FROM transactions WHERE direction='expense' AND status='paid'
GROUP BY account_id, 2, 3`,

  v_daily_expense: `CREATE OR REPLACE VIEW v_daily_expense AS
SELECT account_id, date_iso, SUM(amount_cents) AS total_cents, COUNT(*) AS tx_count
FROM transactions WHERE direction='expense' AND status='paid'
GROUP BY account_id, 2`,

  // 商户周期视图：订阅检测的确定性基础（P1 订阅刺客雷达）
  v_merchant_periodic: `CREATE OR REPLACE VIEW v_merchant_periodic AS
SELECT merchant,
       COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts,
       AVG(amount_cents) AS avg_cents, STDDEV(amount_cents) AS std_cents,
       (MAX(EXTRACT(EPOCH FROM ts)) - MIN(EXTRACT(EPOCH FROM ts))) / NULLIF(COUNT(*)-1,0) / 86400.0 AS avg_interval_days,
       COUNT(DISTINCT date_trunc('month', ts)) AS months_active
FROM transactions WHERE direction='expense' AND status='paid'
GROUP BY merchant HAVING COUNT(*) >= 3`,

  // 订阅候选（07 §3 唯一业务规则：同一商户 >=3 笔、单笔 100-6000 分、
  // 相邻间隔 25-40 天、金额恒定容差 +/-1%）。相邻间隔用 LAG 窗口按商户时序逐对计算：
  // 商户须至少 2 个合格相邻对（即合格链 >=3 笔），再聚合其全部支出行输出。
  v_subscription_candidates: `CREATE OR REPLACE VIEW v_subscription_candidates AS
WITH scoped AS (
  SELECT merchant, amount_cents, ts,
         LAG(ts) OVER (PARTITION BY merchant ORDER BY ts) AS prev_ts,
         LAG(amount_cents) OVER (PARTITION BY merchant ORDER BY ts) AS prev_amount
  FROM transactions
  WHERE direction = 'expense' AND status = 'paid'
), qualified AS (
  SELECT merchant
  FROM scoped
  WHERE amount_cents BETWEEN 100 AND 6000
    AND prev_amount BETWEEN 100 AND 6000
    AND prev_ts IS NOT NULL
    AND date_diff('day', prev_ts, ts) BETWEEN 25 AND 40
    AND ABS(amount_cents - prev_amount) * 100.0 / NULLIF(prev_amount, 0) <= 1.0
  GROUP BY merchant
  HAVING COUNT(*) >= 2
)
SELECT t.merchant,
       COUNT(*) AS n,
       MIN(t.ts) AS first_ts,
       MAX(t.ts) AS last_ts,
       AVG(t.amount_cents) AS avg_cents,
       STDDEV(t.amount_cents) AS std_cents,
       (MAX(EXTRACT(EPOCH FROM t.ts)) - MIN(EXTRACT(EPOCH FROM t.ts))) / NULLIF(COUNT(*) - 1, 0) / 86400.0 AS avg_interval_days,
       COUNT(DISTINCT date_trunc('month', t.ts)) AS months_active
FROM transactions t
JOIN qualified q ON q.merchant = t.merchant
WHERE t.direction = 'expense' AND t.status = 'paid'
GROUP BY t.merchant
HAVING COUNT(*) >= 3`,

  // 异常日：日支出偏离 30 天基线 z-score > 2.5（阶段3 异常检测）
  v_anomaly_daily: `CREATE OR REPLACE VIEW v_anomaly_daily AS
WITH daily AS (
  SELECT date_iso, SUM(amount_cents) AS total
  FROM transactions WHERE direction='expense' AND status='paid' GROUP BY date_iso
), baseline AS (
  SELECT AVG(total) AS mu, STDDEV(total) AS sigma FROM daily
)
SELECT d.date_iso, d.total,
       (d.total - b.mu) / NULLIF(b.sigma,0) AS zscore
FROM daily d, baseline b
WHERE ABS((d.total - b.mu) / NULLIF(b.sigma,0)) > 2.5`,

  v_top_merchants_90d: `CREATE OR REPLACE VIEW v_top_merchants_90d AS
SELECT merchant, SUM(amount_cents) AS total_cents, COUNT(*) AS tx_count
FROM transactions
WHERE direction = 'expense' AND status = 'paid'
  AND ts >= CURRENT_DATE - INTERVAL '90 day'
GROUP BY merchant`,

  v_mom_category: `CREATE OR REPLACE VIEW v_mom_category AS
WITH monthly AS (
  SELECT date_trunc('month', ts) AS month, category,
         SUM(amount_cents) AS cur_cents
  FROM transactions
  WHERE direction = 'expense' AND status = 'paid'
  GROUP BY 1, 2
)
SELECT month, category, cur_cents,
       LAG(cur_cents) OVER (PARTITION BY category ORDER BY month) AS prev_cents,
       ROUND((cur_cents - LAG(cur_cents) OVER (PARTITION BY category ORDER BY month)) * 100.0
             / NULLIF(LAG(cur_cents) OVER (PARTITION BY category ORDER BY month), 0), 1) AS change_ratio
FROM monthly`,

  v_yearly: `CREATE OR REPLACE VIEW v_yearly AS
WITH yearly AS (
  SELECT EXTRACT(YEAR FROM ts) AS year, category,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents ELSE 0 END) AS expense_cents,
         SUM(CASE WHEN direction = 'income' AND status = 'paid' THEN amount_cents ELSE 0 END) AS income_cents,
         COUNT(*) FILTER (WHERE status = 'paid') AS tx_count
  FROM transactions
  GROUP BY 1, 2
)
SELECT year,
       SUM(expense_cents) AS expense_cents,
       SUM(income_cents) AS income_cents,
       SUM(tx_count) AS tx_count,
       arg_max(category, expense_cents) AS top_category
FROM yearly
GROUP BY year`,

  // 冲动消费：单笔 > 该类目日均 x3 且 > 50 元（5000 分），或单日同类别 >=3 笔
  v_impulse_events: `CREATE OR REPLACE VIEW v_impulse_events AS
WITH cat_daily_avg AS (
  SELECT category,
         SUM(amount_cents) / NULLIF(COUNT(DISTINCT date_iso), 0) AS daily_avg_cents
  FROM transactions
  WHERE direction = 'expense' AND status = 'paid'
  GROUP BY category
), day_cat_cnt AS (
  SELECT date_iso, category, COUNT(*) AS n_day
  FROM transactions
  WHERE direction = 'expense' AND status = 'paid'
  GROUP BY date_iso, category
)
SELECT t.tx_id, t.date_iso, t.merchant, t.amount_cents, t.category
FROM transactions t
JOIN cat_daily_avg a ON a.category = t.category
JOIN day_cat_cnt d ON d.date_iso = t.date_iso AND d.category = t.category
WHERE t.direction = 'expense' AND t.status = 'paid'
  AND ((t.amount_cents > a.daily_avg_cents * 3 AND t.amount_cents > 5000) OR d.n_day >= 3)`,

  // 深夜消费：hour in [23, 5)，即 23:00-05:00（07 §3 唯一深夜语义）
  v_night_spend: `CREATE OR REPLACE VIEW v_night_spend AS
WITH month_agg AS (
  SELECT date_trunc('month', ts) AS month,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid'
                   AND (EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5)
                  THEN amount_cents ELSE 0 END) AS night_cents,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents ELSE 0 END) AS total_cents
  FROM transactions
  GROUP BY 1
)
SELECT month, night_cents,
       ROUND(night_cents * 100.0 / NULLIF(total_cents, 0), 1) AS night_ratio
FROM month_agg`,

  // 六维健康输入（P2 健康指数分子/分母，逐月一行）：
  // 餐饮占比 / 订阅占比 / 冲动消费占比 / 深夜占比 / 结余率 / 大额脉冲
  // 大额脉冲口径：单笔支出 > 500 元（50000 分，对齐 AGG_AMOUNT_BUCKETS 顶桶，07 §7）
  v_health_inputs: `CREATE OR REPLACE VIEW v_health_inputs AS
WITH month_agg AS (
  SELECT date_trunc('month', ts) AS month,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents ELSE 0 END) AS expense_cents,
         SUM(CASE WHEN direction = 'income' AND status = 'paid' THEN amount_cents ELSE 0 END) AS income_cents,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid' AND category = '餐饮' THEN amount_cents ELSE 0 END) AS food_cents,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid' AND category = '订阅' THEN amount_cents ELSE 0 END) AS sub_cents,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid'
                   AND (EXTRACT(HOUR FROM ts) >= 23 OR EXTRACT(HOUR FROM ts) < 5)
                  THEN amount_cents ELSE 0 END) AS night_cents,
         SUM(CASE WHEN direction = 'expense' AND status = 'paid' AND amount_cents > 50000 THEN amount_cents ELSE 0 END) AS big_pulse_cents
  FROM transactions
  GROUP BY 1
), impulse_agg AS (
  SELECT date_trunc('month', t.ts) AS month, SUM(t.amount_cents) AS impulse_cents
  FROM transactions t
  JOIN v_impulse_events e ON e.tx_id = t.tx_id
  WHERE t.direction = 'expense' AND t.status = 'paid'
  GROUP BY 1
)
SELECT m.month,
       m.food_cents,
       ROUND(m.food_cents * 100.0 / NULLIF(m.expense_cents, 0), 1) AS food_ratio,
       m.sub_cents,
       ROUND(m.sub_cents * 100.0 / NULLIF(m.expense_cents, 0), 1) AS sub_ratio,
       COALESCE(i.impulse_cents, 0) AS impulse_cents,
       ROUND(COALESCE(i.impulse_cents, 0) * 100.0 / NULLIF(m.expense_cents, 0), 1) AS impulse_ratio,
       m.night_cents,
       ROUND(m.night_cents * 100.0 / NULLIF(m.expense_cents, 0), 1) AS night_ratio,
       m.income_cents - m.expense_cents AS surplus_cents,
       ROUND((m.income_cents - m.expense_cents) * 100.0 / NULLIF(m.income_cents, 0), 1) AS surplus_ratio,
       m.big_pulse_cents,
       ROUND(m.big_pulse_cents * 100.0 / NULLIF(m.expense_cents, 0), 1) AS big_pulse_ratio
FROM month_agg m
LEFT JOIN impulse_agg i ON i.month = m.month`,
};

/**
 * 9 张六阶段预计算表（07 §3 唯一清单：系统生成、只读、聚合粒度，白名单已注册 #43）。
 * 表内必须含至少一个白名单分组维度列（ALLOWED_DIMENSIONS），
 * 保证模板优先的 LLM 聚合能 GROUP BY。依赖视图的建在视图之后（dataset.ts 顺序执行）。
 */
export const PRECOMPUTE_DEFS: Readonly<Record<string, string>> = {
  // 阶段1 clean：行数/去重数/时间跨度总览
  clean_overview: `CREATE OR REPLACE TABLE clean_overview AS
SELECT account_id,
       COUNT(*) AS total_rows,
       COUNT(*) - COUNT(DISTINCT tx_id) AS duplicate_rows,
       MIN(date_iso) AS first_date,
       MAX(date_iso) AS last_date,
       COUNT(DISTINCT date_iso) AS active_days,
       SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual_rows,
       SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refund_rows
FROM transactions
GROUP BY account_id`,

  // 阶段2 profile：类别聚合
  profile_category_stats: `CREATE OR REPLACE TABLE profile_category_stats AS
SELECT account_id, category,
       SUM(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents ELSE 0 END) AS expense_cents,
       SUM(CASE WHEN direction = 'income' AND status = 'paid' THEN amount_cents ELSE 0 END) AS income_cents,
       COUNT(*) FILTER (WHERE direction = 'expense' AND status = 'paid') AS expense_tx,
       COUNT(*) FILTER (WHERE direction = 'income' AND status = 'paid') AS income_tx,
       ROUND(AVG(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents END), 2) AS avg_expense_cents,
       MAX(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents END) AS max_expense_cents
FROM transactions
GROUP BY account_id, category`,

  // 阶段2 profile：商户聚合
  profile_merchant_stats: `CREATE OR REPLACE TABLE profile_merchant_stats AS
SELECT account_id, merchant,
       COUNT(*) AS tx_count,
       SUM(amount_cents) AS total_cents,
       ROUND(AVG(amount_cents), 2) AS avg_cents,
       ROUND(STDDEV(amount_cents), 2) AS std_cents,
       MIN(ts) AS first_ts,
       MAX(ts) AS last_ts,
       COUNT(DISTINCT date_trunc('month', ts)) AS months_active
FROM transactions
WHERE direction = 'expense' AND status = 'paid'
GROUP BY account_id, merchant`,

  // 阶段2 profile：月度聚合
  profile_monthly_stats: `CREATE OR REPLACE TABLE profile_monthly_stats AS
SELECT account_id,
       date_trunc('month', ts) AS month,
       SUM(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents ELSE 0 END) AS expense_cents,
       SUM(CASE WHEN direction = 'income' AND status = 'paid' THEN amount_cents ELSE 0 END) AS income_cents,
       COUNT(*) FILTER (WHERE direction = 'expense' AND status = 'paid') AS expense_tx,
       COUNT(*) FILTER (WHERE direction = 'income' AND status = 'paid') AS income_tx,
       COUNT(DISTINCT date_iso) AS active_days,
       ROUND(SUM(CASE WHEN direction = 'expense' AND status = 'paid' THEN amount_cents ELSE 0 END)
             / NULLIF(COUNT(DISTINCT date_iso), 0), 2) AS avg_daily_cents,
       MAX(amount_cents) AS largest_cents
FROM transactions
GROUP BY account_id, month`,

  // 阶段3 anomaly：日异常统计（全量日基线 + zscore，模板侧自行筛 |zscore|>2.5）
  anomaly_daily_stats: `CREATE OR REPLACE TABLE anomaly_daily_stats AS
WITH daily AS (
  SELECT date_iso, SUM(amount_cents) AS total_cents, COUNT(*) AS tx_count
  FROM transactions
  WHERE direction = 'expense' AND status = 'paid'
  GROUP BY date_iso
), baseline AS (
  SELECT AVG(total_cents) AS mu, STDDEV(total_cents) AS sigma FROM daily
)
SELECT d.date_iso, d.total_cents, d.tx_count,
       ROUND(b.mu, 2) AS mu,
       ROUND(b.sigma, 2) AS sigma,
       ROUND((d.total_cents - b.mu) / NULLIF(b.sigma, 0), 2) AS zscore
FROM daily d, baseline b`,

  // 阶段3 anomaly：商户异常统计（变异系数 cv_pct 为离群信号）
  anomaly_merchant_stats: `CREATE OR REPLACE TABLE anomaly_merchant_stats AS
SELECT account_id, merchant,
       COUNT(*) AS tx_count,
       SUM(amount_cents) AS total_cents,
       ROUND(AVG(amount_cents), 2) AS avg_cents,
       ROUND(STDDEV(amount_cents), 2) AS std_cents,
       MAX(amount_cents) AS max_cents,
       ROUND(STDDEV(amount_cents) / NULLIF(AVG(amount_cents), 0) * 100.0, 1) AS cv_pct
FROM transactions
WHERE direction = 'expense' AND status = 'paid'
GROUP BY account_id, merchant`,

  // 阶段4 subscription：订阅模式（物化 v_subscription_candidates 的聚合粒度副本）
  subscription_patterns: `CREATE OR REPLACE TABLE subscription_patterns AS
SELECT merchant, n, first_ts, last_ts,
       ROUND(avg_cents, 2) AS avg_cents,
       ROUND(std_cents, 2) AS std_cents,
       ROUND(avg_interval_days, 2) AS avg_interval_days,
       months_active
FROM v_subscription_candidates`,

  // 阶段5 attribution：环比统计（物化 v_mom_category）
  attribution_mom_stats: `CREATE OR REPLACE TABLE attribution_mom_stats AS
SELECT month, category, cur_cents, prev_cents, change_ratio
FROM v_mom_category`,

  // 阶段6 annual：年度汇总（物化 v_yearly + 月均与结余率）
  annual_summary: `CREATE OR REPLACE TABLE annual_summary AS
SELECT year, expense_cents, income_cents, tx_count, top_category,
       ROUND(expense_cents / 12.0, 2) AS avg_monthly_cents,
       ROUND((income_cents - expense_cents) * 100.0 / NULLIF(income_cents, 0), 1) AS savings_rate_pct
FROM v_yearly`,
};
