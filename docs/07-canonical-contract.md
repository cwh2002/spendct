# 07 权威契约文档（SpendCT 设计唯一裁决）

| 项目 | 内容 |
| --- | --- |
| 文档编号 | 07（docs/07-canonical-contract.md） |
| 版本 | v1.4（并入 08《功能扩展方案》修订案 A1-A10；A10 于 2026-10-15 裁决） |
| 日期 | 2026-10-15 |
| 状态 | 最终裁决：本文档取代 01-06 全部冲突表述，是后续一切编码的唯一权威；v1.1 起并入 08《功能扩展方案》修订案 A1-A7，v1.2 起并入修订案 A8（追问在线兜底明细出口，§18），v1.3 起并入修订案 A9（MCP 工具链上线收口，§13/§18/§19），v1.4 起并入修订案 A10（OCR 上线收口，§11/§12/§13）（均为增量修订，不推翻既有裁决），08 其余内容与本文档冲突时以本文档为准 |
| 维护 | 总仲裁人；任何一方修改契约字段必须同步更新本文档并重跑对应回归 |

---

## 0. 总则

### 0.1 本文档的地位

本文档是 01《技术总纲》、02《数据与隐私》、03《流水线与 Agent》、04《RAG 与 MCP》、05《界面交互》、06《路线图》六份文档之间跨文档冲突的仲裁结果。对**每一个跨文档冲突**给出唯一裁决。规则：

1. 任何文档与本文档冲突 → **以本文档为准**，且不视为推翻产品定义（产品定义 2026-10-13 版仍为不可推翻的上位事实）。
2. 本文档未覆盖的细节 → 以原文档为准（01=技术栈与性能预算、02=隐私与数据、03=流水线、04=RAG/MCP、05=交互、06=日程、08=功能扩展增量方案中未被 A1-A7 覆盖的部分）。
3. 引用格式：改动索引中 `#N` 指第 N 条评审问题，`§K` 指本文档第 K 个契约条目。
4. 自 v1.1（2026-10-13）起，08《功能扩展方案》的修订案 A1-A7 并入本文档；v1.2（2026-10-14）起并入修订案 A8（追问在线兜底明细出口，§18）；v1.3（2026-10-15）起并入修订案 A9（MCP 工具链上线收口，§13/§18/§19）；v1.4（2026-10-15）起并入修订案 A10（OCR 上线收口，§11/§12/§13）：各条目内新增的「08 修订案」小节属于权威定义的一部分（§21 为索引）；修订案为增量，不推翻既有裁决。

### 0.2 六条裁决原则

1. **真实优先**：隐私承诺必须与真实数据出口一致（存在则如实列入可见性对照表，宁可少承诺）。
2. **演示稳定优先**：任何取舍不得制造台上失败风险。
3. **简单优先**：1-3 人、5 周，同等得分取最简单方案。
4. **与产品定义一致**：产品定义 2026-10-13 版的决定不可被本文档推翻。
5. **未实测的事实不做断言**：无法验证的「实测结论」一律改为稳健工程方案（自动探测+回退链）。
6. **版本决策以 2026-10 稳定版为准**（本文档已用 npm registry 实测核验，见 §8/§19）。

### 0.3 术语与摘要长度规范（唯一）

| 标识符 | 定义 | 长度 |
| --- | --- | --- |
| `datasetTxHash` | sha256(原始导入文件字节) | 前 16 位 hex |
| `promptVersion` | sha256(提示词全文)，自动生成 | 前 8 位 hex |
| `stageCacheKey` | `stage:v1:${datasetTxHash}:${stageId}` | — |
| `llmCacheKey` | `llm:v1:${promptVersion}:${modelId}:${sha256(canonicalData).slice(0,16)}` | — |
| `txId` | sha256(交易指纹=商户+时间+金额+方向+交易单号) | 前 16 位 hex（主键，防碰撞） |
| `merchantRef` | `m_` + sha256(原始商户名 + 本次运行盐) | 8 位 hex |
| `rawId` | `F{sha256(原始行内容)}#L{行号}` | 8 位 hex |
| 其余所有摘要（sourceSqlHash、M#、filehash 等） | sha256 | 前 8 位 hex |

摘要默认 8 位；仅 `datasetTxHash`、`txId`、`llmCacheKey` 内嵌数据哈希三处用 16 位（身份/主键需要更低碰撞概率），已在上表登记理由（裁决 #78）。

### 0.4 全项目唯一常量登记

`SIX_STAGES` / `StageId` / `StageStatus` / `PipelineStatus` → `src/lib/pipeline/stage.ts`；事件协议 → `src/lib/protocol/events.ts`；transactions DDL 与 TS 类型 → `src/lib/schema/bill.ts`；洞察卡 schema → `src/lib/schema/insight-card.ts`；白名单 → `src/lib/sql-guard/whitelist.ts`；脱敏器 → `src/lib/sanitize/sanitizer.ts`；工具注册表 → `src/lib/tools/registry.ts`；LLM 路由表 → `src/server/ai/router.ts`；快速记账解析 schema → `src/lib/schema/quick-entry.ts`（08 修订案 A5/F08）；预算三任务 schema（BudgetAdvice/ForecastNarrative/TipPersonalize）→ `src/lib/schema/budget.ts`（08 修订案 A5/F07）；年度故事 schema → `src/lib/schema/annual-story.ts`（08 修订案 A5/F05）。**以上文件为全仓唯一事实来源，其余文件只 import 不复制（03 §2.6、08 等文档中的内联 zod 示例仅为转述，不得作为可复制来源）。**

---

## 1. 六阶段 StageId 枚举与阶段名（唯一）

### 权威定义

```ts
// src/lib/pipeline/stage.ts —— 全仓唯一
export const SIX_STAGES = ["clean", "profile", "anomaly", "subscription", "attribution", "annual"] as const;
export type StageId = (typeof SIX_STAGES)[number];
export type StageStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";
export type PipelineStatus = "idle" | "running" | "reflecting" | "completed" | "degraded" | "aborted";
```

| StageId | 展示名（UI/材料唯一用词） | 序号 |
| --- | --- | --- |
| clean | 清洗（副题：解析与去重） | 1 |
| profile | 消费画像 | 2 |
| anomaly | 异常检测 | 3 |
| subscription | 订阅陷阱扫描（P1 功能，位于第 4 阶段） | 4 |
| attribution | 环比归因 | 5 |
| annual | 年度报告 | 6 |

**反思自检（reflect）不是第七阶段**：它是 annual 阶段之后的「发布前闸门」（06 §2.4 的定位保留，写入 §20）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01/05 用 `mom`，03 用 `attribution`，06 用 `cleanse…report`，02 卡 stage 枚举还多出 `anchor_qa`（评审 #2、#27）。两条 fixHint 均推荐 03 的 `clean/profile/anomaly/subscription/attribution/annual` → 采纳。
- 裁决理由：`attribution` 比 `mom` 自解释；`annual` 比 `report` 更能与「报告页 /report」区分；06 的 `cleanse` 改为 `clean` 减少与「清洗=cleanse」两套拼写的低级错误。04 §0.4「订阅雷达=阶段 4」错，应为阶段 3（#49）。
- 03 的 StageStatus 曾出现 `streaming/paused`，取消：思考流由事件协议 `stage:thinking` 承载，状态机不设中间态（#51）。

---

## 2. 流式事件协议（唯一，spendct协议@2）

### 权威定义

协议名 **spendct协议@2**（自 01 §6.1 spendct协议@1 扩充升版）。SSE 传输，每事件一个 JSON 对象，公共字段 `{ t: 事件名, ts: 毫秒时间戳, runId }`，可携带 `stage`、`cardId`。`src/lib/protocol/events.ts` 为唯一类型源，含序列化→解析 round-trip 与乱序/断流单测夹具（#3）。

**完整事件集（20 类，任何文档不得自造事件名）：**

```ts
// —— 运行级 ——
{ t:"run:start", ts, runId, datasetTxHash, source:"upload"|"sample", stageOrder: StageId[] }
{ t:"run:complete", ts, runId, cards: string[], elapsedMs, degraded?: string[] }
{ t:"error", ts, runId, code: ErrorCode, message, stage?, retryable: boolean }
{ t:"abort", ts, runId, reason }
// —— 阶段级 ——
{ t:"stage:start", ts, runId, stage }
{ t:"stage:thinking", ts, runId, stage, text }                    // 流式思考文案
{ t:"stage:evidence", ts, runId, stage, tableId, sqlHash, rowCount, elapsedMs } // 确定性 SQL 产物就绪
{ t:"stage:complete", ts, runId, stage, artifactCount, cards: string[] }
{ t:"stage:skipped", ts, runId, stage, reason }
// —— 卡片级 ——
{ t:"card:delta", ts, runId, stage, cardId, delta }               // zod 安全的增量补丁
{ t:"card:complete", ts, runId, stage, card }                     // 校验通过的完整卡
{ t:"card:withheld", ts, runId, stage, cardId, reason }           // 反思未过 → 人工复核区
// —— LLM 运行态 ——
{ t:"llm:degraded", ts, runId, task, from: ModelId, to: ModelId|"template", reason }
{ t:"llm:repair", ts, runId, task, attempt, issues: string[] }
// —— RAG / 工具 / 反思 / 缓存 ——
{ t:"rag:retrieved", ts, runId, k, ms, mode:"dense"|"tfidf", caseIds: string[] }
{ t:"tool:start", ts, runId, tool, argsDigest }
{ t:"tool:end", ts, runId, tool, ok, ms, errorReason? }           // → ToolBadge 徽章数据源
{ t:"reflect:result", ts, runId, cardId, pass, revisedConfidence? }
{ t:"cache:hit", ts, runId, stage, cacheKey }
{ t:"checkpoint:saved", ts, runId, stage }
```

- 主流程（`POST /api/pipeline/stage`）与锚点追问（`POST /api/followup`）使用**同一协议**。
- 错误码 `ErrorCode`（全项目唯一）：`EMPTY_DATASET | PARSE_FAILED | LLM_EXHAUSTED | DUCKDB_LOAD_FAILED | QUOTA_EXCEEDED | NETWORK_OFFLINE | WHITELIST_REJECTED | TIMEOUT`。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 四套互不兼容协议（#3、#28）：01 10 类（点号命名）、03 ~20 类（pipeline.start/stage.sql.start/…）、05 连字符（stage-start/sql-running/…）、06 冒号另起一套（thought/artifact/pipeline:done）。
- 裁决理由：保留 01 §6.1 的点号命名（唯一已命名协议、已被多文档引用），吸收 03 的 sql/rag/tool/reflect/degrade 语义（#3 fixHint），05 的 checkpoint/llm-fallback 语义并入 `checkpoint:saved`/`llm:degraded`。03 的 `stage.sql.start` 细粒度事件由 `stage:thinking`+`stage:evidence` 承载，事件总数收敛到 20（实现核对：运行级 4 + 阶段级 5 + 卡片级 3 + LLM 2 + RAG/工具/反思/缓存 6）。05/06 的自拟协议删除，改 import 引用。

---

## 3. transactions DDL 与 TypeScript 类型（唯一，金额单位统一为「分」）

### 权威定义

单一事实源：`src/lib/schema/bill.ts`。物理表只有一张，名为 `transactions`（02 §5.2 DDL 为唯一来源，评审 #1、#29 两条 fixHint 一致推荐）：

```sql
CREATE TABLE transactions (
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
);
```

**类目枚举（唯一，12 类，02 为准）**：`餐饮 | 交通 | 购物 | 娱乐 | 居住 | 通讯 | 医疗 | 教育 | 人情 | 金融 | 订阅 | 其他`。外卖归入餐饮；不单设「转账」（income 方向记账）。深夜时段语义 = **23:00–05:00**（02 的 `v_night_spend` 为准，05 的 22:00–02:00 作废，#50）。

**视图（02 §5.3-§5.4 唯一清单，13 个）**：`v_monthly_summary, v_category_monthly, v_merchant_monthly, v_daily_expense, v_merchant_periodic, v_subscription_candidates, v_anomaly_daily, v_top_merchants_90d, v_mom_category, v_yearly, v_impulse_events, v_night_spend, v_health_inputs`。

**六阶段预计算表（系统生成、只读、聚合粒度，注册进白名单，#43）**：`clean_overview, profile_category_stats, profile_merchant_stats, profile_monthly_stats, anomaly_daily_stats, anomaly_merchant_stats, subscription_patterns, attribution_mom_stats, annual_summary`。

**TS 类型**：`RawTransaction`（解析期：`rawId = F{sha256-8}#L{行号}`）、`CleanTransaction`（`txId` 16 位 hex）、`CategoryCode`（12 类）、`Direction`。展示层金额 = `amount_cents/100` 保留 2 位小数，**仅展示层换算**，存储与计算一律整数分。

**订阅候选业务规则（唯一，写入 02 §5.3 视图定义）**：同一商户 `≥3 笔`、单笔金额 `1–60 元`、相邻间隔 `25–40 天`、金额恒定容差 `±1%`（#24、#48 两份 fixHint 的并集口径）。

### 08 修订案 A3（2026-10-13）：transactions 语义值扩展（快速记账）

**新裁决**：`source` 语义值扩展为 `wechat|alipay|ocr|sample|manual`；`channel` 增加 `manual`；manual 行的 `raw_ref = 'M#<自增序号>'`（M# 摘要 = sha256 前 8 位 hex，§0.3）；`direction` 允许 manual 行的 `income`（如「收到红包 200」）。DDL 列集与 12 类目枚举不变。

**manual 行生成规则（F08 快速记账，唯一）**：
- `source='manual'`、`channel='manual'`、`raw_ref='M#<自增序号>'`、`tx_id = sha256(ts+amount_cents+merchant+序号)` 前 16 位 hex（§0.3）；`ts`/`date_iso` 缺省 = 记账当天。
- `direction` 允许 `income`；其余行方向口径不变（「转账」仍不单设）。
- 原始输入文本只在内存中转（zod 确认卡渲染），**绝不落盘**（§17 禁止项对齐）；`parseable:false` → 手动表单兜底，不阻塞流程。

**理由**：快速记账复用唯一明细表（不另建 `manual_entries` 表，避免双表明细合并复杂化与白名单碎片化）；manual 行同样只存浏览器 DuckDB，隐私承诺不破。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 五套表：02 `transactions`（分，snake_case）vs 03 `tx`（元 DECIMAL(12,2)）vs 04 `bills` vs 05 `bills` vs 06 `cleaned_bills`（#1、#29）。
- 裁决理由：以 02 §5.2 为唯一来源（fixHint 推荐）；`DECIMAL` 有浮点舍入风险，整数分是财务系统通行做法；03/04/05/06 所有建表与 SQL 示例重写为本表。06 §2.5 的四段示例 SQL 全部改写（`cleaned_bills`→`transactions`、`ROUND(SUM(amount),2)`→`SUM(amount_cents)`、`trade_date/time_month`→`ts/date_iso`）。04 §8.4 MCP 元数据工具的表枚举 `["bills","merchants"]` → `["transactions","merchants"]`。

---

## 4. 洞察卡 JSON Schema（唯一，insight-card@v1）

### 权威定义

单一文件 `src/lib/schema/insight-card.ts`，版本 `insight-card@v1`。**草稿与运行时卡同文件定义**（裁决 #4 与 #33 两份 fixHint 的分歧：草稿形态取 03 CardDraft，运行时字段取 02 §2.6，confidence 统一数值 0-1——两条 fixHint 的一致要求）：

```ts
import { z } from "zod";  // zod@4.6.7

// 图表规格：LLM 只声明"哪张表+哪种图+哪个维度"（模板优先，#30 fixHint 采纳 03 方案）
export const ChartSpecSchema = z.object({
  tableId: z.string(),                                   // 阶段预计算表/视图 id
  chartType: z.enum(["bar","line","pie","histogram","scatter","heatmap","table"]),
  title: z.string().min(1).max(40),
  dimField: z.string(),                                  // 分组键（脱敏后）
  measureFields: z.array(z.string()).min(1).max(2),
  sortBy: z.enum(["desc","asc"]).optional(),
  topN: z.number().int().min(3).max(24).optional(),      // 默认 8
  note: z.string().max(60).optional(),
});

// 来源引用（唯一枚举与 ref 格式，#60）
export const CitationSchema = z.object({
  kind: z.enum(["sql","rag","tool","rule","personal"]),
  ref: z.string(),   // sql:${table|view}:${tableId} / rag:${caseId} / tool:${toolName} / rule:${ruleId} / personal:${anomalyId}
  meta: z.object({ source: z.string().optional(), version: z.string().optional(), updatedAt: z.string().optional() }).optional(),
});

// LLM 输出层（草稿）—— z.strictObject 作注入第 2 层闸门
export const InsightCardDraftSchema = z.strictObject({
  stage: z.enum(SIX_STAGES),
  headline: z.string().min(8).max(120),                  // 结论一句话（LLM 只写叙事）
  narrative: z.string().min(8).max(600),
  confidence: z.number().min(0).max(1),                  // 统一数值，禁用 high|medium|low 枚举
  significance: z.string().max(40),                      // 显著性依据一句话
  evidence: z.object({
    chart: ChartSpecSchema,
    stats: z.array(z.object({ label: z.string().max(20), value: z.string().max(20), unit: z.string().max(6).optional() })).min(1).max(4),
  }),
  sources: z.array(CitationSchema).min(1).max(3),
  actions: z.array(z.enum(["confirm","dispute","drill","fix"])).default(["confirm","dispute","drill"]),
});

// 运行时卡 = 草稿 + 运行时字段（02 §2.6 保留）
export const InsightCardSchema = InsightCardDraftSchema.extend({
  cardId: z.string().regex(/^card_(clean|profile|anomaly|subscription|attribution|annual|anchor)_\d+_\d+$/),
  status: z.enum(["draft","published","withheld"]),
  selfCheck: z.object({ pass: z.boolean(), issues: z.array(z.string()), revisedConfidence: z.number().optional() }).optional(),
  disclaimer: z.string().default("本结论基于账单聚合数据，金额已脱敏，仅供参考"),
});
```

**发布闸门（唯一）**：`status = published` 当且仅当 `selfCheck.pass && confidence >= 0.6 && 显著性达标（§20）`；否则 `withheld` 进人工复核区（宁缺毋滥）。

### 08 裁决补记（2026-10-13）：ChartSpec 枚举不扩展，四大静态图走页面代码

- ChartSpec `chartType` 枚举**保持七类**（bar/line/pie/histogram/scatter/heatmap/table）；日历热力图 / 类别桑基 / 健康雷达 / 商户词云四大图表为 `/insights` 账本汇总视图与 `/report` 的**页面级静态组件**（确定性 SQL 直出数据 + ECharts 直接渲染），不注册进 ChartSpec 枚举、不由 LLM 声明（桑基需「源维+目标维+度量」三字段、雷达需 ≥3 维多系列，超出 `measureFields 1-2` 契约形状；sankey 已于 #72 从本 schema 删除）。
- LLM 追问答案的图表（`chartSpec`）仍限于七类；模型不得在答案中引用四大静态图类型；若数据形态更适合四大图 → 拒绝画图（refusal 话术）或改用七类中最接近的表达（写入 03 §2.6 提示词）。
- 四大静态组件实现 `AnchorSelection` 捕获接口（`chartId/mode/dataIndex`，与 ChartSpec 无耦合）：日历格 → `dim: time_month`、桑基节点 → `dim: merchant`、雷达顶点 → `dim: category`、词云词条 → `dim: merchant`，折叠为 SelectionContext 后走既有 `/api/followup`（§18 完全复用，零协议改动）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 五个版本（#4、#33）：01 v01、02 v02（cardId、selfCheck、stage 多出 anchor_qa）、03 CardDraft（confidence 枚举）、05 v05（uuid、sankey、significance 枚举）、06（conclusion 命名、缺 clean）。
- 裁决理由：confidence 统一 0-1 数值（两条 fixHint 一致要求）；cardId 取 02 格式（anchor 追问卡用 `card_anchor_*`，stage 枚举不含 anchor_qa）；actions 取 03 全集（confirm|dispute|drill|fix）；来源引用取 04 的 `Citation.kind` 与 ref 规范（#60 fixHint）；图表规格取 03 的声明式 ChartSpec——LLM 不再输出 ECharts option，01 §6.5 echartsSpecSchema、02 §11.2 EChartsOptionSanitizedSchema、05 §2.3 echartsOption 全部降级为「对 registry 渲染结果的校验」（#30 fixHint）；sankey 删除（#72）。

---

## 5. 脱敏器接口（唯一函数签名 + 加盐策略）

### 权威定义

```ts
// src/lib/sanitize/sanitizer.ts —— 全仓唯一实现（#31 fixHint：统一签名、沿用 01 加盐方案）
export interface SanitizerOptions {
  amountBuckets: number[];          // 分箱上限（元），默认 [0,5,10,20,50,100,200,500]
  merchantSalt: string;             // 本次运行盐（crypto.randomUUID，见下）
  maxRows?: number;                 // 默认 200（模板产物）/ 50（追问结果）
  forbiddenColumns?: string[];      // 默认 FORBIDDEN_COLUMNS
}
export function sanitizeResult(
  rows: Record<string, unknown>[],
  columns: string[],
  opts: SanitizerOptions,
): { rows: Record<string, unknown>[]; columns: string[]; applied: string[]; warnings: string[] };
```

S1 金额分箱：仅对**明细** `amount_cents` 分箱 → 标签 `≤5元/≤10元/≤20元/≤50元/≤100元/≤200元/≤500元/>500元`；聚合值（SUM/AVG）不分箱、四舍五入 2 位小数。S2 商户加盐哈希：`merchantRef = "m_" + sha256(merchant + merchantSalt).slice(0,8)`。S3 禁列剥离：`FORBIDDEN_COLUMNS = [tx_id, external_id, note, counterparty, raw_ref]`。S4 数值舍入（均值/标准差 2 位小数）。S5 行截断（`maxRows`）。

**盐策略（唯一）**：盐 = 每次体检运行开始生成（`crypto.randomUUID()`），存 `sessionStorage["spendct:salt"]`，**绝不落盘、不跨会话**；同一数据集两次运行的哈希不同（防彩虹表，#31）。02 §7 的无盐 sha256 作废。

**商户名显示规则（唯一，#15 fixHint）**：LLM 提示词永远只含 `@{m:hash}` 占位（03 铁律 6 保留）；浏览器渲染端仅在「该商户笔数 ≥5 且用户开启『显示商户名』开关」时把 hash 映射回明文；卡片 evidence 与锚点 JSON 中统一存 `m_<8hex>` 字符串（#59）。

**A8 边界（2026-10-14）**：本节的脱敏器与商户占位规则适用于六阶段产物、锚点追问与全部 LLM 任务提示词；**唯一例外**是追问面板的在线兜底路径——它不经过脱敏器，发送「汇总统计 + 最近 150 笔明细快照」（原始商户名与真实金额），口径见 §18 修订案 A8。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 三套接口（#31）：01 `desensitize(rows, opts)` 加盐、02 `sanitizeResult(rows, columns)` 无盐、03 `sanitizeRows(rows,{roundTo10})`。
- 商户可见性三套（#15）：02 n≥5+开关明文、03 永不明文、05 永远 hash。
- 裁决理由：函数名与签名取 02（被最多文档引用），加盐取 01（fixHint 明确「建议沿用 01 的加盐方案，成本最低且防彩虹表」）；可见性取「提示词永远 hash、渲染端按 n≥5+用户开关还原」的唯一规则（#15 fixHint 原文）。

---

## 6. SQL 聚合白名单 API 与 ALLOWED_RELATIONS（唯一）

### 权威定义

唯一规范 = **02 §6（R1-R10）+ 06 §2.0 的 policy 形态**，实现于 `src/lib/sql-guard/whitelist.ts`（#42、#73 两条 fixHint 均以 02 §6 为唯一规范）：

```ts
export const ALLOWED_AGGREGATES = ["COUNT","SUM","AVG","MIN","MAX","STDDEV","MEDIAN","MODE","ROUND"] as const;  // 02 的 9 个
export const ALLOWED_DIMENSIONS = [/* 02 §6.2 清单唯一 */] as const;
export const FORBIDDEN_COLUMNS = ["tx_id","external_id","note","counterparty","raw_ref"] as const;

// ALLOWED_RELATIONS：基表 + 13 视图 + 9 张六阶段预计算表（#43 fixHint：预计算表必须注册，
// 否则模板优先主流程会被白名单拒绝）+ 08 修订案 A2 的 3 张预算关系表
export const ALLOWED_RELATIONS = [
  "transactions",
  "v_monthly_summary","v_category_monthly","v_merchant_monthly","v_daily_expense",
  "v_merchant_periodic","v_subscription_candidates","v_anomaly_daily","v_top_merchants_90d",
  "v_mom_category","v_yearly","v_impulse_events","v_night_spend","v_health_inputs",
  "clean_overview","profile_category_stats","profile_merchant_stats","profile_monthly_stats",
  "anomaly_daily_stats","anomaly_merchant_stats","subscription_patterns",
  "attribution_mom_stats","annual_summary",
  "budgets","budget_vs_actual","forecast_monthly",   // 08 修订案 A2（2026-10-13）
] as const;

export type WhitelistVerdict =
  | { ok: true }
  | { ok: false; reason: "NO_GROUP_BY"|"SELECT_STAR"|"DETAIL_COLUMN"|"BANNED_KEYWORD"
                        |"UNSUPPORTED_SYNTAX"|"ROW_LIMIT_EXCEEDED"|"PARSE_ERROR" };

export interface AggregatePolicy {        // 06 §2.0 的字段与本规范对齐后的唯一形态
  maxResultRows: 50;                      // 固定 50（#73：固定值对齐 02 行截断）
  maxGroupByCols: 3;
  allowedAggFns: typeof ALLOWED_AGGREGATES[number][];
  bannedKeywords: string[];               // 06 清单 + "REINDEX"（#73 fixHint 二选一，取并入）
  maxSqlLength: 4000;                     // #42 fixHint：统一 4000 字符
}
export function precheckAggregateSql(sql: string, policy?: Partial<AggregatePolicy>): WhitelistVerdict;
export async function runWhitelistedAggregate(
  conn: DuckDBConnection, sql: string, policy?: Partial<AggregatePolicy>,
): Promise<{ rows: unknown[]; rowCount: number; elapsedMs: number }>;
```

R1-R10 规则（02 §6 全文为准）：必须 GROUP BY；禁 SELECT *；明细列禁投影；DDL/写操作黑名单；子查询/UNION/CTE/多语句一律拒绝；结果行数执行后二次校验（`LIMIT ≤50`）；单条 SELECT 语法子集。**Worker 超时 3s 中断 / 10s 强杀**（02 口径，#42 fixHint）。恶意 SQL 用例以 02 §10 的 20 例为全集（18 例既有 + 预算用例 19-20 随 T47/E2 验收，08 修订案 A2），演示口径「10/10」为其子集并注明（#62 fixHint）。

**A8 边界（2026-10-14）**：R1-R10 与「明细列禁投影」继续约束**一切 LLM 生成 / 提示词内拼装的 SQL**；§18 修订案 A8 的明细快照语句是固定内部常量（零动态拼接、常量 `LIMIT 150`），由浏览器侧 `createDuckDbDetailSnapshot()` 直连单例连接执行、**不经本白名单通道**——它不属于聚合 SQL，也不进入 LLM 可见的 SQL 生成面。

### 08 修订案 A2（2026-10-13）：ALLOWED_RELATIONS 注册预算关系（+3）

**新裁决**：注册 `budgets`（用户配置表）、`budget_vs_actual`、`forecast_monthly`（系统生成、只读、聚合粒度预计算表）为白名单可查询关系；三类均受 R1-R10 约束（GROUP BY 强制、无明细列投影、单关系、聚合函数 9 个、LIMIT ≤50）；`budgets` 对 LLM 为**只读查询**（写路径走前端确定性代码，不经 LLM SQL）。

```sql
-- budgets：用户自建配置（F07 预算中心），DuckDB OPFS 数据集内、与 transactions 同库（§17 A1）
CREATE TABLE budgets (
  ym           VARCHAR,      -- '2026-10'
  category     VARCHAR,      -- 12 类之一 或 'total'（总预算）
  budget_cents BIGINT,       -- 金额单位：分（§3 全项目唯一金额单位）
  updated_at   TIMESTAMP,
  PRIMARY KEY (ym, category)
);

-- budget_vs_actual：系统生成、只读、聚合粒度（对齐 §3 六阶段预计算表语义）
CREATE TABLE budget_vs_actual AS
SELECT b.ym, b.category, b.budget_cents,
       COALESCE(SUM(t.amount_cents), 0) AS actual_cents,
       ROUND(100.0 * COALESCE(SUM(t.amount_cents), 0) / NULLIF(b.budget_cents, 0), 1) AS ratio_pct
FROM budgets b
LEFT JOIN transactions t ON t.category = b.category
  AND t.direction = 'expense' AND strftime(t.ts, '%Y-%m') = b.ym
GROUP BY b.ym, b.category;
```

- `forecast_monthly` 字段：`ym, category, forecast_cents, method`（method 恒为 `seasonal_baseline`，展示层标注「朴素季节外推」）。确定性生成：`预测值 = 近 3 月同类目均值 × (1 + 近 3 月环比漂移中位数)`（SQL 常量实现，与 03 §1.3 同款模板优先纪律；LLM 只写叙事不产数字）。
- `budgets` 规模护栏：写入路径限制「当月 + 未来 2 月」共 ≤3 月 × 13 行可编辑，历史月份只读。
- 手动记账行（F08）并入 `transactions` 后自动被既有白名单覆盖（`source='manual'` 仅新增枚举值，不改变列集，§3 A3），无需单独注册。
- 恶意 SQL 用例补 2 条针对 `budgets`/`budget_vs_actual` 的用例，并入 02 §10 的 18 例全集（演示子集 10/10 不变）。

**理由**：预算建议与预测叙事任务需要 LLM 可查询的数据面；注册即「模板优先 + SQL 白名单」纪律的延续（与既有 13 视图 + 9 预计算表同语义）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 三套实现（#42）：02 R1-R10（9 聚合函数、2000 字符、3s）vs 03 S1-S6（隐含 JOIN）vs 06 WhitelistVerdict（5 聚合函数）。
- 裁决理由：02 §6 为唯一规范（安全评审核心交付物）；参数统一 4000 字符、3s/10s（fixHint 原话）；聚合函数保留 02 的 9 个（追问深挖需要 stddev，砍掉反而增加实现分支）；06 的 `AggregatePolicySchema` 作为「02 规范的 policy 参数形态」保留并字段对齐；`bannedKeywords` 并入 REINDEX（#73）；预计算表注册进 ALLOWED_RELATIONS（#43）。

---

## 7. 金额分桶与行数上限（唯一）

### 权威定义

- **分桶常量（唯一）**：`AGG_AMOUNT_BUCKETS = [0,5,10,20,50,100,200,500]`（单位：元；env `AGG_AMOUNT_BUCKETS` 可覆盖），桶标签 `≤5元/≤10元/≤20元/≤50元/≤100元/≤200元/≤500元/>500元`。02 的 `AMOUNT_BINS` 5 档作废，引用本常量（#38 fixHint）。
- **两级行数上限（语义区分，#38 fixHint）**：
  - 模板六阶段产物：`AGG_MAX_ROWS = 200`（env 可覆盖）；
  - 追问 LLM 生成的 SQL：白名单 `maxResultRows = 50`、`SQL_MAX_RESULT_ROWS = 50`；
  - 卡内证据表格渲染 ≤50 行；图表轴唯一值 ≤24（`topN` 3–24）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01 的 8 档元桶与 `AGG_MAX_ROWS=200` vs 02 的 5 档分桶与「聚合 ≤50 行」并存导致拦截随机（#38）。
- 裁决理由：取 01 的 8 档（fixHint 建议）；200 与 50 不再并存而是**两级语义**（模板产物 200 / 追问结果 50），写入白名单常量名，消除歧义。

---

## 8. DuckDB-WASM 锁定版本与加载方式（唯一）

### 权威定义

- **版本**：`@duckdb/duckdb-wasm@1.32.0` **精确锁定**（禁 `^`、禁 `latest`）。
  - npm registry 实测（2026-10-13）：最新 stable = **1.32.0**（发布于 2025-12-16）；npm `latest` 标签 = `1.33.1-dev57.0`（**dev 构建**）——01 §1.5「npm latest 是 dev 构建必须钉死」的警告属实，为全项目强制纪律。
- **加载**：**自托管**。脚手架时把 `node_modules/@duckdb/duckdb-wasm/dist` 拷贝到 `public/duckdb/`，`bundleUrl = "/duckdb/duckdb-mvp.wasm"`；**禁用 CDN**（02 §5.1 的 jsDelivr 优先路径删除，#6、#34 fixHint）。
- **线程**：单线程模式 `pthreadWorker: null`；不设 COOP/COEP 头。
- **持久化**：OPFS 优先；无 OPFS 时内存库 + localStorage 检查点（§17）。
- **性能预算（唯一，01 §8 为唯一基准表）**：WASM 冷 <4s / 热 <1.5s；10k 行导入+聚合 <2s；六阶段 dry-run（无 LLM）<5s；带 LLM 3 卡全程 ≤60s（G2 闸门口径）；内存 <400MB；LCP <2.5s / FCP <1.5s；主包 <180KB；RAG 稳态 P95 <2.5s / 冷启动首查 <6s / TF-IDF 兜底 <100ms（2026-10-15 实测修订，见 eval-rag.md §3）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01 自托管 1.32.0 vs 02 CDN 优先 1.29.0（降级 1.28.1）vs 06 `^1.29.x`（#6、#34）。
- 裁决理由：registry 实测证实 1.32.0 为最新稳定版；自托管满足「断网演示可用」（演示稳定优先）与国内网络稳定性；`^` 范围会把 dev 构建拉进来，禁止。性能数字冲突（#23、#56）以 01 §8 为准并取「冷/热区分 + LCP 2.5s + 内存 400MB」的可达口径，06 A3 改为引用。

---

## 9. CSV 编码自动探测链（唯一）

### 权威定义

**探测链（唯一，按序执行）**：`TextDecoder("utf-8", { fatal: true })` 成功 → 直接解析；失败 → `TextDecoder("gb18030")`（GBK 的超集，优先）；失败 → `TextDecoder("gbk")`；仍失败 → 判定 `PARSE_FAILED` → 走 AI 兜底。

- **PapaParse 不支持 GBK/GB18030**：必须先用 TextDecoder 解码为 UTF-8 字符串再交 PapaParse（#37 fixHint 原话）。
- **禁止写死厂商编码结论**：01 §1.6 与 02 §3.1 的相反「实测结论」（微信=GBK vs UTF-8 等）全部删除；W1D1-2 团队真实导出文件实测结果写入 `tests/fixtures/csv/README.md` 作为唯一事实（#5 fixHint）。
- **AI 兜底（唯一路径）**：仅当探测链全失败且用户确认后，发送「前 10 行 + 1 条数据行、≤6KB 截断」给 **qwen**（SiliconFlow，统一轻任务，#40 fixHint），只返回字段映射建议；该出口必须列入可见性对照表（#10 fixHint）。
- fixtures 含 GBK 脏变体（06 §7.1 保留），作为探测链回归用例。

> **实现收口（2026-10-14）**：探测链已按本节落地（`src/lib/import/decode-csv.ts`，上传页读 ArrayBuffer 后按 UTF-8→GB18030→GBK 严格解码）；**AI 兜底（字段映射建议）未上线，为设计态**——解析失败走拒收与乱码提示，不发送任何 CSV 片段给模型。公开材料（PDF 对照表/路由表）已按此口径标注「设计预留（未上线）」。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01 与 02 编码结论完全相反且都自称实测（#5、#37）；02 的 AI 兜底发 DeepSeek、03 商户分类发 qwen（#40）。
- 裁决理由：按原则⑤，未实测事实改为自动探测链 + 实测记录点；兜底统一 qwen（#40 fixHint），并把两条真实数据出口（兜底片段、商户分类名单）补进可见性对照表（#10 fixHint）。

---

## 10. 缓存策略（唯一：仅客户端缓存）

### 权威定义

- **无服务端缓存**。01 的 `server/ai/cache.ts`（500 条 LRU/24h TTL）**删除**（#8 fixHint 推荐方案：服务端只做转发，与 02 §1.2 原则三「服务器零存储」一致；Vercel serverless 冷启动下服务端缓存也无效）。
- **客户端缓存（唯一实现）**：IndexedDB（idb-keyval），LRU **200 条 / 20MB**，无 TTL（版本哈希即失效机制）：
  - 阶段产物：`stage:v1:${datasetTxHash}:${stageId}`；
  - LLM 输出：`llm:v1:${promptVersion}:${modelId}:${sha256(canonicalData).slice(0,16)}`；`canonicalData = JSON.stringify(阶段脱敏聚合结果)`；`promptVersion = sha256(promptText).slice(0,8)` **自动生成**（#36 二选一取自动哈希，不需要手工 version.json）。
- **命名分离（#67 fixHint）**：`dataHash` 一词不再复用——`datasetTxHash`（数据集身份）与 `stageCacheKey`/`llmCacheKey`（缓存键）三个名字分家。
- **演示稳定**：录制前在演示浏览器里预跑一次体检（预热缓存）；视频素材一律用预跑后的浏览器录制。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01 服务端 data-hash LRU vs 03 仅客户端（#8、#36）；dataHash 双重含义（#67）；断点键三套（#22）。
- 裁决理由：删服务端缓存（隐私叙事干净 + serverless 无意义）；客户端缓存取 03 的键公式与 LRU 参数；键名统一到 §0.3 术语表与 §17 红线。

---

## 11. OCR 供应商与降级链（唯一）

### 权威定义

- **主供应商：智谱 GLM-4V-Flash（`GLM_API_KEY`，服务端 `/api/ocr`）**——产品定义口径（#45 fixHint：「按产品定义统一为智谱 GLM-4V-Flash」）。
- **降级链（唯一）**：智谱 GLM-4V-Flash → SiliconFlow 版 GLM-4V-Flash（`SILICONFLOW_API_KEY`，同网关低风险切换）→ 两者失败返回 `ok:false` → UI 引导改用 CSV/示例账单。**OCR 是第一入口但绝不阻塞主流程**（06 砍法第 2 刀语义保留）。
- **低置信度字段（多模态二次确认，#20 fixHint 采纳）**：OCR 结果中低置信单元格 → 标黄 + 截取原图局部 → GLM-4V 二次复核 → 仍低置信 → 人工确认。该点为多模态 5% 的第二落点，写进演示动线。
- **隐私**：截图仅本次请求内存使用，处理后即弃，不落盘不缓存；可见性对照表新增「OCR 截图（发送至 GLM-4V-Flash 视觉模型处理）」行（真实优先）。
- OCR 输出结构化行 → 与 CSV 行同路径进映射/清洗（同一 RawTransaction 管线）。

> **实现收口（2026-10-15）**：OCR 已按本节上线（`src/app/api/ocr/route.ts` + `src/server/ocr/vision.ts`，契约见 02 §12）。两个与产品定义不同的落地细节，均以本节「隐私：截图仅内存不落盘」红线为准裁决：
> - **主供应商默认模型改为 `glm-4.6v-flash`**：官方 glm-4v-flash 不支持 base64 入参，与「截图不落任何存储」硬冲突（写临时文件才可传 URL/文件路径）。glm-4.6v-flash 同为智谱免费 flash 档、支持 base64，`GLM_VISION_MODEL` 可覆盖回任意模型名。
> - **SiliconFlow 降级模型为 `THUDM/GLM-4.1V-9B-Thinking`**：同网关 GLM-4V 系，`SILICONFLOW_VISION_MODEL` 可覆盖。
> - 两网关视觉模型均**不支持 response_format=json_object**：改为 prompt 内嵌 JSON 模板 + 容错提取（`extractJsonObject`：剥 `<think>`、剥 markdown 围栏、首尾花括号截取）。
> - **低置信二次复核**已实现：confidence<0.8 行标黄 → 客户端按行序截取原图纵向条带（`cropImageBand`，前后各扩一行，字面落实「截取原图局部」）→ 复用 `/api/ocr`（mode=review）二次复核；人工编辑即标 manuallyConfirmed 退出标黄。
> - 服务器侧 zod safeParse 通过才回传、失败重试 1 次=降级网关这一次重试；≤5MB、15s 超时、live 模式同实例内存限流 20 次/小时（mock 不限流）。channel 由合规弹窗「截图来源」单选决定（微信/支付宝），不做模型猜测。
> - env 清单在既有键之外新增 `GLM_VISION_MODEL`、`SILICONFLOW_VISION_MODEL` 两个可选项（§12 同步）；未配任何视觉 key（或 DEMO_MODE=mock）时走 mock 剧本，OCR 入口不阻塞上传主流程。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01 用 `GLM_API_KEY`（智谱）vs 02 §12.1 用 SiliconFlow 网关（#45）；06 T13 未指定网关。
- 裁决理由：产品定义与 #45 fixHint 一致指定智谱；保留 SiliconFlow 为降级（利用既有 SILICONFLOW_API_KEY，#69），形成双网关互备，符合「双供应商互备」产品定义。

---

## 12. 任务级 LLM 路由表（唯一）

### 权威定义

`ModelId = "deepseek" | "qwen" | "glm4v" | "local-tfjs"`（03 的枚举，#64 fixHint）。展示名映射：deepseek→DeepSeek-V3、qwen→SiliconFlow Qwen、glm4v→GLM-4V-Flash、local-tfjs→Transformers.js 本地。

| 任务 | 主模型 | 降级链 |
| --- | --- | --- |
| 六阶段叙事（stage narrative） | deepseek | qwen → 确定性模板叙事 + `llm:degraded` 横幅 |
| 洞察卡叙事生成 | deepseek | 同上 |
| 锚点追问 plan/summarize | deepseek | qwen → DRILL_TEMPLATES 内置模板 |
| 字段映射 / 表头猜测 | qwen | 规则映射 → AI 兜底（§9 路径） |
| 商户分类（未命中本地词典的商户主名，批量） | qwen | local-tfjs（P2 可选）→ 归「其他」 |
| CSV AI 兜底解析（≤6KB，用户确认后） | qwen | 无（失败即报错） |
| 标题润色 / 展示文案 | qwen | 原样显示 |
| 反思自检 L2 judge（§20） | **qwen** | deepseek → 跳过 L2（仅 L1 规则闸门） |
| OCR | glm4v（智谱） | glm4v（SiliconFlow）→ 无 OCR |
| 断网商户分类（P2 可选） | local-tfjs | 本地词典 |
| quick-entry 快速记账解析（A5） | qwen | 无备用 → 手动表单兜底（DegradeToast 说明，不阻塞流程） |
| budget-advice 预算建议（A5） | qwen | 确定性模板兜底（severity 由 ratio 阈值直接判定） |
| forecast-narrative 预测叙事（A5） | deepseek | 固定句式模板兜底（「下月 {类别} 预计 {±X}%」） |
| tip-personalize 贴士个性化（A5） | qwen | top-3 直出 + 通用适配句兜底 |
| annual-story 年度故事分段（A5，并入 annual 阶段任务） | deepseek | qwen → 固定 6 段模板兜底 |

- env 唯一清单（#69 fixHint 补全，08 修订案 A10 补 2 个视觉模型覆盖键）：`DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL(可选) / SILICONFLOW_API_KEY / SILICONFLOW_BASE_URL(可选) / GLM_API_KEY / GLM_BASE_URL(可选) / GLM_VISION_MODEL(可选) / SILICONFLOW_VISION_MODEL(可选) / QWEATHER_API_KEY / MCP_SERVER_URL / AI_TEXT_FALLBACK_ORDER="deepseek,siliconflow" / SQL_MAX_RESULT_ROWS=50 / AGG_MAX_ROWS=200 / AGG_AMOUNT_BUCKETS="[0,5,10,20,50,100,200,500]" / EMBEDDING_PROVIDER=tfidf-only|local-onnx`。密钥**只存服务端 env**，公开仓库只有 `.env.example`。
- 商户分类批处理 key = **原始商户名**（入参：名称列表；出参：名称→12 类映射；raw_ref 仅作行内引用，#68 fixHint）。

### 08 修订案 A5（2026-10-13）：任务级路由表 +5 行、新任务 zod 单一来源

**新裁决**：路由表增加 5 行（见上表末 5 行）；env 清单**零新增**（§12 既有清单不变）。新任务输出 zod 的单一来源文件（其他文件只 import 不复制）：

```ts
// src/lib/schema/quick-entry.ts —— F08 快速记账解析（唯一来源）
export const QuickEntrySchema = z.strictObject({
  parseable: z.boolean(),
  entry: z.object({
    amountCents: z.number().int().positive().max(1e9),     // 单位：分（§3）
    direction:   z.enum(["expense", "income"]),
    category:    z.enum(CATEGORIES),                        // 12 类唯一枚举（§3）
    merchant:    z.string().max(30).optional(),
    ts:          z.string().datetime().optional(),          // 缺省 = 今天
    note:        z.string().max(60).optional(),
  }).optional(),
  reason: z.string().max(60).optional(),                    // parseable:false 时给原因
});

// src/lib/schema/budget.ts —— F07 预算中心三任务（唯一来源）
export const BudgetAdviceSchema = z.strictObject({
  severity: z.enum(["ok", "warn", "over"]),      // ratio<80% / 80-100% / ≥100%
  headline: z.string().max(60),
  advice:   z.string().max(160),
  actions:  z.array(z.enum(["adjust_budget", "view_detail", "dismiss"])).max(2),
});
export const ForecastNarrativeSchema = z.strictObject({
  headline: z.string().max(60),
  narrative: z.string().max(300),
  disclaimer: z.literal("朴素季节外推，仅作参考，不构成建议"),
});
export const TipPersonalizeSchema = z.strictObject({
  tips: z.array(z.object({
    caseId: z.string(),              // 必须来自检索结果（引用白名单后处理复用 04 §5.3）
    why:    z.string().max(40),      // 一句话适配理由
  })).length(3),
});

// src/lib/schema/annual-story.ts —— F05 年度数据故事（唯一来源）
export const AnnualStorySchema = z.strictObject({
  segments: z.array(z.object({
    order:      z.number().int(),
    headline:   z.string().max(60),
    narrative:  z.string().max(200),
    chartSpec:  ChartSpecSchema,          // §4 七类，模板优先
  })).min(4).max(8),
});
```

**提示词要点（写入 03 §2.6，与既有任务同格式）**：
- quick-entry：① 金额一律整数分（「15」+「块/元」语境 → 1500 分；「15 万」→ 拒绝）；② 类目词典注入 12 类 + 高频映射（食堂/奶茶→餐饮，地铁→交通，红包/工资→income）；③ 日期缺省取 today，明确日期（「昨天」）才改；④ 非记账文本（闲聊/问句）→ `parseable:false` + 建议；⑤ 严禁编造金额与商户；⑥ 输出纯 JSON。
- budget-advice：只基于输入数字给方向性建议（「餐饮已用 87%，剩余 ¥X，建议未来 5 天日均 ≤¥Y」——Y 由模板预计算注入，LLM 不自己算）；不虚构外部基准；数字必须来自输入行。
- forecast-narrative：只讲方向与幅度（「餐饮预计下月 ±X%，主因是近三月均值与漂移」），不得承诺精确金额；必须保留 disclaimer 原文；数字一律来自输入。
- tip-personalize：caseId 只可从输入中出现过的 ID 中选择（防编造引用）；why 写「对你的适配点」而非复述案例。
- annual-story：每个 segment 数字溯源过 L1（数字必须能在 `annual_summary` 中找到直接来源）；L2 judge 走既有 reflect 路由（qwen 主/deepseek 降级，§20）；任一 segment 未过 → 该段回退模板段（固定 6 段模板：年度总览/最烧钱类别/订阅刺客/深夜消费/环比变化/明年一句话，由确定性 SQL 填数），不影响其他段。

**费用（单次约值，计入 03 费用账本）**：quick-entry ≈¥0.0005；budget-advice ≈¥0.001；forecast-narrative ≈¥0.002；tip-personalize ≈¥0.001；annual-story ≈¥0.008（与既有单次体检同量级）。整赛程预算 ¥30-100、上限 ¥150 不变。

**理由**：新任务沿用「叙事 deepseek、轻任务 qwen」的费用纪律（§12 裁决理由）；降级链全部落到确定性模板，演示稳定优先（08 §0 原则二）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- reflect judge 路由冲突（#13、#39 两条 fixHint 相反：一条建议 Qwen、一条建议 deepseek）；02 兜底用 DeepSeek、03 用 qwen（#40）；ModelId 命名两套（#64）；env 缺 QWEATHER/SILICONFLOW 键（#69）。
- 裁决理由：反思 judge 取 **qwen 主 + deepseek 降级**——同时满足两条 fixHint（qwen 符合「轻任务归免费小模型」的费用纪律与多数文档，deepseek 作为降级保稳定）；其余轻任务统一 qwen（#40 fixHint）；env 清单补全并按模型/工具交叉核对（#69）。

---

## 13. 服务端 API 端点清单（唯一）

### 权威定义

| 端点 | 方法 | 用途 | 响应 |
| --- | --- | --- | --- |
| `/api/health` | GET | 存活探针 | JSON |
| `/api/pipeline/stage` | POST | 六阶段驱动（模板优先，LLM 只写叙事） | **SSE（协议 §2）** |
| `/api/followup` | POST | 锚点追问（PEO；body 含 `sessionSchema` 快照与追问上下文） | **SSE（协议 §2 + tool 事件）** |
| `/api/ocr` | POST | 截图 → 结构化行（§11） | JSON |
| `/api/rag` | POST | dense 检索代理（→ MCP 容器 `/retrieve`）；容器不可用返回 `{ok:false, mode:"tfidf"}` → 浏览器 TF-IDF | JSON |
| `/api/mcp/[tool]` | POST | MCP 工具代理（5s 连接超时；单工具 4s；`ok:false` 信封） | JSON |
| `/api/ai/task` | POST | 新 LLM 短任务统一端点（`taskId` 判别联合：quick-entry / budget-advice / forecast / tip-personalize；单次 JSON 请求/响应，无 SSE）（A6） | JSON |

- **「唯一 LLM 出口」语义（#47 fixHint，A6 扩展）**：所有模型调用只发生在 `src/server/ai/*` 模块内，且只被 `/api/pipeline/stage`、`/api/followup`、`/api/ai/task` 三个路由调用；06 的 `/api/chat` 命名作废。年度故事叙事（annual-story）复用 `/api/pipeline/stage`（annual 阶段输出增强，零新端点）。
- **无 run 事件轮询端点**：事件一律 SSE 推送，03 的 `GET /api/run/{runId}/events`（T4 轮询）删除。
- **schema 快照**：随 `/api/followup` 请求体传递（`sessionSchema` 字段），**不设** 04 的独立 `POST /api/chat/session/schema` 端点，服务端不长期存储快照（隐私更好、实现更少）。
- 目录：`src/app/api/{health,pipeline/stage,followup,ocr,rag,mcp/[tool],ai/task}/route.ts`。

### 08 修订案 A6（2026-10-13）：端点清单 6 → 7（+ /api/ai/task）

**新裁决**：端点清单 6 → 7，新增 `/api/ai/task`（POST，JSON，`taskId` 判别联合），承载 4 个新短任务（quick-entry / budget-advice / forecast / tip-personalize）；annual-story 复用既有 `/api/pipeline/stage`（annual 阶段输出增强，零新端点）。

```ts
// src/app/api/ai/task/route.ts —— 请求体（zod 严格校验）
const AiTaskRequestSchema = z.discriminatedUnion("taskId", [
  z.object({ taskId: z.literal("quick-entry"),     payload: z.object({ text: z.string().max(200), today: z.string() }) }),
  z.object({ taskId: z.literal("budget-advice"),   payload: z.object({ rows: BudgetVsActualRowsSchema, today: z.string() }) }),
  z.object({ taskId: z.literal("forecast"),        payload: z.object({ forecast: ForecastRowsSchema, actual: ActualRowsSchema }) }),
  z.object({ taskId: z.literal("tip-personalize"), payload: z.object({ profile: ProfileSchema, cases: Top5CasesSchema }) }),
]);
// 响应：{ ok: true, data: <任务 zod 输出> } | { ok: false, error: { code, message } }
// 目录登记：src/app/api/ai/task/route.ts（01 §3 目录树同步）
```

- 该端点仍**只调用 `src/server/ai/*` 模块**（「唯一 LLM 出口」语义扩展），复用同一套：zod 三层闭环（生成→校验→修复 ≤2 次）、wrapTool 降级信封、注入防护三层、LLM 缓存键（§10）、模型路由表（§12 A5）。密钥/env 清单零新增。
- 其余端点零改动：`/api/rag` 不变（F09 贴士检索走既有检索链路；F11 课堂搜索走浏览器 TF-IDF，§16 公网口径）；`/api/mcp/[tool]` 不变；不设任何导出/预算专属端点（导出=浏览器本地，预算=浏览器 DuckDB 计算）。
- 撤销路径：若 P1 全砍，`/api/ai/task` 删除即恢复 6 端点状态（零残留）。

**理由**：4 个新任务都是单次 JSON 短任务（短文本卡/结构化 JSON，非 SSE 流式叙事），塞进 `/api/followup`（SSE + PEO 协议）或 `/api/pipeline/stage`（六阶段 SSE 协议）会污染协议单一来源（§2/§18）；独立端点 + 同一出口模块 = 职责清晰、降级与防护栈零分叉。

### 08 修订案 A8（2026-10-14）：/api/ai/chat 承载追问在线兜底（含明细快照）

**新裁决**：追问面板的在线兜底通过 `POST /api/ai/chat` 发送（实现 `src/app/api/ai/chat/route.ts`，纯转发 + zod 校验）：请求体 `{ task: "chat", stage?, messages: [{role:"user"|"assistant", content}] }`，**每条 content ≤4000 字、总长 ≤8000、最多 20 条**；mock→mockTextStream，live→streamLlmText；`LlmExhaustedError`→503、其余→502。服务端不消费流内容、不落盘不缓存（§17 红线不变，02 §1.2 原则三）。

- 该请求首条消息 = 「汇总统计（≤2000 字）+ 最近 150 笔明细快照（≤3000 字，随汇总段长度让出预算）」+ 最近对话历史，明细口径见 §18 修订案 A8。
- **实现收口说明（真实优先）**：交付代码实际部署两条 API 路由——`/api/ai/chat`（追问对话流式转发）与 `/api/ai/task`（四个短任务）；六阶段流水线、白名单 SQL、追问的本地回答全部在浏览器内确定性执行，本表其余端点由客户端实现吸收。README / PDF 的构建口径按「17 路由（14 静态 + 2 API + not-found）」表述，与本条一致。

### 08 修订案 A9（2026-10-15）：在线兜底端点落位 /api/followup（SSE + 工具事件）

**新裁决**：追问面板的在线兜底从「POST /api/ai/chat 纯转发流」改为「POST /api/followup（SSE，协议 §2 + tool 事件）」承载——`/api/followup` 按请求体字段区分两种模式（带追问上下文 = 锚点追问 PEO；带 `question` + `messages` = 在线兜底），在线兜底叠加 MCP 工具层。`/api/ai/chat` 保留，职责收窄为「LLM 文本流式端点（text/plain）」——现仅被 /budget 页预算建议的 live 流式使用，不再承载追问面板。

**在线兜底事件契约（唯一实现 `src/app/api/followup/route.ts`，帧格式 `data: JSON\n\n`）**：

- `run:start{datasetTxHash?,source,stageOrder:[]}` → 每次工具调用起止 `tool:start{tool,argsDigest}` / `tool:end{tool,ok,ms,errorReason?}`（面板工具徽章数据源，§18 A9）→ 回答文本增量 `stage:thinking{stage:"followup",text}`（复用 §2 思考文案事件——协议 20 事件封版，不新增事件类型）→ `run:complete{cards:[],elapsedMs,degraded?}`（cards 恒为空数组，追问不落洞察卡；degraded 记录 MCP 降级原因）；异常 `error{code,message,retryable}`；客户端中止 `abort{reason:"client-aborted"}`。
- 请求体（zod 严格校验）：`{ question(≤500), messages(1-20 条，每条 ≤4000 字、总长 ≤8000 字), sessionSchema?（§18 协议演示工具快照）, datasetSource?("upload"|"sample") }`。
- `sessionSchema` 存在时，路由先确定性调用 `query_bill_db_metadata` 回执（不进模型工具集，与模型决策解耦）；DEMO_MODE=mock 时问题命中大促关键词（§18 A9）走脚本化演示流，live 时装配 MCP 三工具连接 `streamChatWithTools` 逐 part 映射事件。
- 隐私口径（A8 延伸）：消息里的汇总统计与最近明细快照只转发给 LLM 与 MCP（元数据回执只含聚合元数据），服务端零存储、不记日志。

**本条同时更新 A8 的实现收口说明**：交付代码实际部署的 API 路由为 5 条——followup / rag / mcp/[tool] / ai/chat / ai/task（六阶段流水线、白名单 SQL、追问本地回答均在浏览器内确定性执行；health / pipeline/stage / ocr 端点由客户端实现吸收或未接线）；README / PDF 的构建口径按「19 路由（13 静态页 + 5 API + not-found）」表述，以本条为准。

**理由**：A8 的纯转发流让追问面板「在线兜底」与「MCP 工具」割裂为两条路径（工具徽章、降级归因无处安放）；归入 `/api/followup` 后，追问面板三路回答（本地规则 / 本地 LLM / 在线兜底）共用同一 SSE 事件面，工具徽章与降级声明按 §18 A9 单一实现。

### 08 修订案 A10（2026-10-15）：/api/ocr 接线，路由口径 19 → 20

**新裁决**：`/api/ocr` 正式上线（实现与契约细节见 §11 实现收口注记、02 §12）。**本条同时更新 A9 的实现收口说明**：交付代码实际部署的 API 路由为 **6 条**——ocr / followup / rag / mcp/[tool] / ai/chat / ai/task（六阶段流水线、白名单 SQL、追问本地回答均在浏览器内确定性执行；health / pipeline/stage 端点由客户端实现吸收或未接线）；README / PDF 的构建口径按「**20 路由（13 静态页 + 6 API + not-found）**」表述，以本条为准。

**理由**：OCR 是多模态 5% 的第一落点（第一入口但绝不阻塞主流程，§11 语义保留）；上线后 A9 收口说明中「ocr 端点未接线」的口径失效，端点清单与交付代码必须一致（真实优先）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 四套清单（#47）：01 六条 vs 03 `/api/ai/*`+轮询 vs 06 `/api/chat` vs 04 session/schema。
- 裁决理由：以 01 六条为主干（#47 fixHint「在 01 §3 给出唯一 API 清单」），补语义澄清与快照合并，删轮询端点（无人引用、SSE 已覆盖）。

---

## 14. 前端路由树与目录布局（唯一）

### 权威定义

**路由（10 条，#46 fixHint + 08 修订案 A7）**：

| 路由 | 页面 |
| --- | --- |
| `/` | 落地页（上传入口 + 「加载示例账单」一键演示） |
| `/upload` | 上传与解析预览（含 OCR 入口、映射确认、去重提示） |
| `/checkup` | 六阶段体检 + 洞察卡流 + 锚点追问面板 |
| `/insights` | 历史洞察 / 账本汇总（吸收原 /ledger） |
| `/subscriptions` | 订阅刺客雷达（P1） |
| `/report` | 年度报告 |
| `/privacy` | 隐私说明 + 数据可见性对照表（吸收原 /about） |
| `/budget` | 预算中心：预算环进度 / 预算 vs 实际 / 超支 AI 贴士 / 下月预测 / 快速记账入口（P1，A7） |
| `/learn` | 消费知识小课堂：案例库浏览（分类/搜索）/ 金融素养知识卡 / 防坑手册（P2，A7） |
| `/settings` | 数据管理与导出：数据集列表/切换/删除、CSV/JSON 导出、通知开关、主题与演示模式入口（P1，A7） |

- 新增 3 条路由懒加载（`dynamic()`）+ 每路由 `loading.tsx` + `error.tsx`（与 05 §1.1 既有约定一致）。守卫：`/budget` 无账单数据 → `redirect('/upload?next=/budget')`；`/learn`、`/settings` 无守卫。chunk 预算（gzip）：`/budget` 含 ECharts core < 300KB（同 /insights 口径）；`/learn`、`/settings` < 60KB。移动端底部 tab bar 不变：「我的」指向 `/settings`，`/learn` 与 `/budget` 从首页能力卡与 `/settings` 链接进入，不新增 tab 项。
- `RouteGuard` 用 **next/navigation** 的 `redirect()`/`router.replace`（05 §1.1 的 react-router `<Navigate>` 是 bug，删除，#22）。
- **目录布局：src/ 唯一**（#63 fixHint）——`src/app`、`src/lib`（sql-guard/csv-parse/pipeline/schema/sanitize/protocol/rag/tools）、`src/server/ai`、`src/components`；`mcp-server/` 独立子包（Node 20 镜像）；根级 `data/ scripts/ tests/ public/ docs/`。01 §3 根级 `lib//server//mcp/` 目录树作废；01 的 `mcp/rerank.ts` 删除（重排器在 MCP 容器进程，§16）。
- 状态管理（#51 fixHint：01 的 6 slice 唯一）：`pipeline / cards / anchor / dataset / ui / session` 六个 Zustand slice；05 的 4 store 与 02 的单一 BillStore 均映射为 slice 别名，不再各自定义。
- 组件注册表（#52 fixHint）：以 05 组件清单为主干，全仓唯一，且必须包含 03/04 引用到的组件：`UploadDropzone、PipelineStepper、ThinkingBubble、SqlCodeBlock、InsightCard、TypingCard、EvidenceTable、DegradeToast、FollowUpPanel、AnchorChip、ArtifactCard、ToolBadge、OcrReviewTable`（01 的 ImportWizard→UploadDropzone、PipelineCanvas→PipelineStepper、InsightCardFrame→InsightCard、AnchorChatPane→FollowUpPanel 为改名映射）；**08 修订案 A7 增补 6 个（13 → 19）**：`BudgetRing、QuickEntryBar、ForecastChart、CaseCard、DatasetManager、NotificationBell`；文档禁止引用未列入注册表的组件名。
- **两级注册口径（08 修订案 A7 补记）**：「19 个注册组件」专指**可复用组件注册表**的全名数。页面级组件**不占注册表名额**，按 05 §2.2 组件总表**单独登记**（与注册表同为唯一命名源、同样禁止私造）：05 §2.2 表内新增页面级组件约 16 个（`StageEvidenceDrawer、FavoritesPanel、PosterCanvasButton、CapabilityCardWall、NextBillingCountdown、CancelGuideChecklist` 等，含 08 A7 新页面 /budget、/learn、/settings 的页面级组件）。PDF/README 工作量口径统一写「**19 个注册组件 + 页面级组件按 05 §2.2 表单独计数（约 16 个）**」，不得只写「19 个注册组件」掩盖页面级组件工作量；两表数字必须与 05 §2.2 表及代码一一对应。
- 页面级静态图表组件（08 §④ 裁决，非 LLM 声明式、**不扩展 ChartSpec 枚举**）：`CalendarHeatmap、CategorySankey、HealthRadar、MerchantWordcloud`（`src/components/charts/`，确定性 SQL 直出数据 + ECharts 直接渲染；实现 `AnchorSelection` 捕获接口 `chartId/mode/dataIndex`，点选锚定折叠为 SelectionContext 后走既有 `/api/followup`，零协议改动；单页图表实例 ≤6 预算内懒挂载）。

### 08 修订案 A7（2026-10-13）：路由 7 → 10、组件注册表 13 → 19（两级注册：可复用 19 个全名登记 + 页面级按 05 §2.2 单列）

- 新增 3 条路由 `/budget` `/learn` `/settings`（见上表）；**分档口径（08 §1.2）：省赛提交版本 = 9 条路由（/learn 国赛窗口补齐）+ 3 个 P2「即将上线」角标；「10 条路由」为 A7 设计目标口径，国赛窗口补齐**；砍法落点走 FeatureFlag（`budget`/`reportStory`/`achievements`/`learn`，与既有 ocr/mcp/brush/dark 并列于 05 §1.1 同源文件，06 §4 砍法表第 6-10 刀），路由随 flag 下线，零残留。
- 组件注册表增补 6 个（13 → 19，见上）；两级注册口径确立：19 个注册组件 = 可复用组件，页面级组件按 05 §2.2 表单列（约 16 个）；四大静态图表组件命名与裁决归属登记如上（不扩展 ChartSpec 枚举，§4 补记）。
- 状态管理：6 个 Zustand slice（pipeline/cards/anchor/dataset/ui/session）不变；新页面不新增 slice（预算/收藏/通知走既有 slice 与 localStorage 键，§17 A1）。
- `/budget` 若被砍，路由一并下线，快速记账入口随之隐藏（`budget` flag）。

**理由**：新页面与新组件需要全局唯一命名与引用锚点；登记而非私造，维持「组件名唯一清单」纪律（#52）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 路由冲突（#46）：01 三页 vs 05 八条（含 /ledger、/about）。取 fixHint 的 7 条清单。react-router 用法在 Next.js 下不成立（#22）。src/ 与根级并存且 06 声明「以 01 为准」制造矛盾（#63）——实际以 Next.js App Router 惯例 src/ 为准，01 更新目录树。

---

## 15. 示例数据规格（唯一）

### 权威定义

- **演示样例（唯一一份）**：`data/sample/wechat-sample.csv`，**≥1000 行**，UTF-8，商户名全虚构。字段 = 微信账单导出列（交易时间/交易类型/交易对方/商品/收|支/金额(元)/支付方式/当前状态/交易单号/商户单号/备注）。埋点（供演示与显著性门槛）：3 个订阅（15/12/9 元月扣、间隔 30 天、±1% 恒定）、冲动消费 3 笔、退款 2 笔、1 笔大额异常、深夜消费若干、类别覆盖 12 类。
- **公开副本**：`public/data/sample-wechat-2026H1.csv`（与源文件内容一致，供「加载示例账单」fetch；断网时走打包资源）。02 §4.1 的 620 行规格作废（#18、#44 fixHint 均指向 1k+）。
- **压测数据**：`scripts/gen-sample-csv.mjs` 固定种子 `20261013` → `data/bench/bench-10k.csv`（gitignore，不入库）。
- **视频口径（#18 fixHint）**：S2 台词「一千行脱敏演示账单」；「1 万行」只出现在 S7 性能表（10k 压测数字），不得在交互演示台词中出现。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 620（02）vs 200→1k+（06 T32）vs 视频「1 万行」（06 §6.2）vs 路径两套（01 data/sample + public/sample）（#18、#44）。
- 裁决理由：1000+ 行满足各类显著性演示（≥30 笔门槛）；10k 定位为压测数字避免台词与仓库对不上（真实优先）；路径固定为「data/sample 源 + public/data 副本」。

---

## 16. 嵌入与重排的运行时位置（零嵌入 API 硬红线）

### 权威定义

- **案例库嵌入**：bge-m3 全部**离线预计算**入库（`data/cases/embeddings.json` + `manifest.json`，`embeddingVersion: "bge-m3@v1"`）；金标 20 题查询嵌入同批离线完成。
- **运行时查询嵌入与重排**：`onnxruntime-node` **本地推理**，部署于 **MCP 容器进程内**（与四工具同进程，采纳 #16 fixHint 的迁移方案）：`bge-m3-int8.onnx`（q8 约 600MB / q4 约 300MB，W4D1 spike 定案）+ `bge-reranker-base-int8.onnx`（约 110MB）；容器暴露 `GET /retrieve`，Next.js `/api/rag` 代理。模型文件 gitignored（`models/`），下载脚本 `scripts/rag/download-models.mjs` 支持 `HF_ENDPOINT=https://hf-mirror.com`。
- **硬红线**：**运行时零嵌入/重排 API 调用**；查询文本不出容器进程；「断网 + 抓包无嵌入请求」列为验收演示证据（#9、#35 fixHint）。
- **公网部署（Vercel Hobby）**：`EMBEDDING_PROVIDER=tfidf-only` → 浏览器 TF-IDF（纯 TS <150 行）全程可用；README 与技术文档如实标注「公网为轻量检索模式，完整 dense+reranker 级联见本地演示与评测」（#16 fixHint 选项二）。
- **级联参数（唯一）**：SQL 元数据过滤 → dense top-30 → rerank top-5 → 引用 ≤3；`RERANK_MIN_SCORE=-2.0`、`RELAX_IF_LESS=5`、`TFIDF_FALLBACK_K=20`；稳态 P95<2.5s（实测 2070ms）/ 冷启动首查 <6s（2026-10-15 修订，eval-rag.md §3）。
- **降级**：`EmbedderUnavailableError` → TF-IDF；`RerankerUnavailableError` → dense 直排；全低分 → 「未找到足够相关的案例引用」空态。
- **个人化 RAG**：全程浏览器（DuckDB 聚合统计 + TF-IDF 语义排序），零嵌入；`Citation.kind = "personal"`。
- **金标评测（唯一口径，#14、#57 fixHint 合并）**：20 题（订阅 8 / 习惯 4 / 异常 4 / 个人化 2 / 学生 2），存 `tests/golden/rag-golden.json`；脚本 `scripts/rag/eval-hit3.mjs`；阈值：dense+rerank hit@3 **≥18/20（90%，CI 阻断）**；G3 闸门入场线 **≥16/20（80%）**；TF-IDF 兜底 **≥12/20**；100 案例完成（11/8 前）先于最终评测。

### 08 修订案 A4（2026-10-13）：金标评测口径与案例库总量

**新裁决**：golden 20 与既有三档阈值（18/16/12）保持为**唯一 CI 门槛**，扩容不许污染既有评测数字；新增补充评测集 `student-golden-8`（学生权益 8 题，存 `tests/golden/rag-golden-student.json`），阈值 hit@3 **≥7/8**，与主集**分开报告**（技术文档写「主集 20 题 hit@3=X、学生权益补充集 8 题 hit@3=Y」）；案例库总量目标 **100+ → 150+**（11/8 前 `verified` ≥ 140）。

- 新增批次：`spending_advice` +10 条（W3D4-6，预算方法/记账习惯）、`subscription_trap` +10 条（W3D6-W4D2，消协/黑猫平台新案源）、`student_benefits` 30 条（W3D5-W4D3，第 8 类：学生认证优惠/教育优惠/校园卡/低价替代订阅/权益型省钱方法；04 §2 案例 schema 增 `benefitTags: string[]`（student_cert/edu_discount/campus_card/budget_substitute/rights_tip）与 `audience: "student"|"general"` 两个可选字段）。
- 嵌入预计算批次与管线不变（bge-m3 离线，运行时零嵌入 API 红线不变）；新增 50 条嵌入成本 ≈ ¥0.02（一次性）。
- 检索链路零改动：SQL 类别过滤 → dense top-30 → rerank top-5 → 引用 ≤3；`student_benefits` 仅作为新的类别过滤值接入。
- F11 /learn 的浏览搜索复用 TF-IDF 索引，不新增评测维度。

**理由**：主集数字是技术文档与 S7 视频台词的既有口径（#14/#57 裁决），扩容不得污染；补充集独立报告既能证明 RAG 扩容质量，又不推翻已冻结阈值。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 01 用 SiliconFlow 嵌入 API、rerank 在 MCP 容器 vs 04 零 API、rerank 在 AI 接入层（#9、#35）；Vercel 放不下 600MB 模型（#16）；金标两套（#14、#57）。
- 裁决理由：以 04 的零 API 硬约束为准（它同时是「三重抗限流」卖点的支柱）；运行位置取 #16 fixHint 的「免费容器与 MCP 同进程」（#9/#35 的「AI 接入层」在该拓扑下即容器进程，文档统一表述）；公网 tfidf-only 如实披露（真实优先）。01 §2.2④ 的 SiliconFlow 嵌入 API 表述删除，`onnxruntime-node` 与 `@modelcontextprotocol/sdk@1.32.1` 补入 01 锁表（#35、#55 fixHint）。

---

## 17. IndexedDB / localStorage 持久化红线（唯一）

### 权威定义

**允许**：
- DuckDB-WASM 数据库（OPFS）：导入明细的**唯一持久层**（浏览器内计算引擎自身存储，不出浏览器）；用户自建配置表 `budgets`（§6 A2，非账单明细、不出浏览器；写入路径限制「当月 + 未来 2 月」共 ≤3 月 × 13 行可编辑，历史月份只读）。
- IndexedDB：`spendct:table:${runId}:${tableId}`（脱敏后阶段聚合产物）、`spendct:llmcache:${cacheKey}`（LLM 输出缓存）。
- localStorage：`spendct:run:latest`（运行元数据：runId/datasetTxHash/阶段状态/卡列表——**不含任何行数据**）、UI 偏好、隐私开关；**A1 增补可重算状态与偏好键（不含任何行数据）**：`spendct:achievements:v1`（已解锁成就 ID + 解锁时间，≤2KB）、`spendct:fav:v1`（收藏卡 ID 列表，≤2KB）、`spendct:notif:v1`（通知文案缓存 + 已读状态，≤20KB）。
- sessionStorage：`spendct:salt`（本次运行盐，会话结束即弃）。

**禁止**：
- 清洗后交易行进入 IndexedDB：03 §1.4 的 `spendct:tx:${datasetId}` **删除**；断点续跑直接从 DuckDB 重新取数（#41）。
- 原始 CSV 文本、OCR 截图、盐的跨会话持久化；快速记账原始输入文本不落盘（仅内存中转，zod 确认卡渲染后即弃，A1）；导出文件内存生成 → `<a download>`，不落盘、不经服务端（A1）。
- 服务端任何持久化（serverless 无状态；schema 快照仅随请求传递，§13）。

**断点续跑（唯一机制）**：localStorage 检查点只存「跑到哪个阶段 + 引用哪些 IndexedDB 产物」，数据本体在 DuckDB OPFS 与 IndexedDB 聚合表中；`datasetTxHash` 变化即检查点作废。

### 08 修订案 A1（2026-10-13）：持久化红线允许项增补

**新裁决**：允许项增加——① 用户自建配置（`budgets` 表）存于 DuckDB OPFS 数据集内（非账单明细、不出浏览器）；② 可重算状态与偏好键 `spendct:achievements:v1` / `spendct:fav:v1` / `spendct:notif:v1` 存 localStorage（≤20KB，不含任何行数据）；③ 快速记账原始输入文本不落盘（内存中转）。**禁止项不变**。

- 年度故事段 / 贴士文本 / 预算建议等新 LLM 产物全部走既有 `spendct:llmcache:*`（IndexedDB 允许项），零新增存储类型。
- 导出文件（F12）：内存生成 → `<a download>`，不落盘、不经服务端。

**理由**：§17 红线本意是「交易明细不重复落库、盐不跨会话、原始 CSV/截图不持久化」；用户自建配置与可重算状态同属「UI 偏好与元数据」范畴，明确写入允许项避免实现期争议。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 03 把清洗明细写 IndexedDB（与 01/02 的「明细只在 DuckDB/OPFS」声明冲突，隐私评审与实现结论相反，#41）；断点键三套（03 idb-keyval vs 05 `spendct:checkpoint:v1` vs 06 `spendct:pipeline:checkpoint`，#22）。
- 裁决理由：明细不重复落库（DuckDB OPFS 已是浏览器内持久层，重复存储只增加泄露面）；键名统一为 `spendct:run:latest`（localStorage）+ `spendct:table/*`、`spendct:llmcache/*`（IndexedDB），05/06 的键名作废。

---

## 18. 锚点追问协议与工具注册表（唯一）

### 权威定义

以 03 §5 为 canonical（#32 fixHint）。

```ts
export interface SelectionContext {           // 05 必须补齐缺失字段（#65）
  anchor: { cardId: string; stage: StageId;
            dim: "merchant"|"category"|"time_month"|"channel";
            value: string; metric: string; dataIndex?: number[] };  // brush 用 dataIndex 集合
  slice: unknown[];                            // 脱敏后 ≤50 行
  tableMeta: { tableId: string; columns: string[] };
  chartType: ChartType; question: string; history: string[];        // history ≤6 条
}
export type PlanStepKind = "sql" | "rag" | "tool" | "summarize";   // 05 的 analyze|plot|verify 作废
export interface PlanStep { id: string; kind: PlanStepKind; spec: string; toolName?: ToolShortName; args?: unknown; dependsOn?: string[]; }
export const FollowUpPlanSchema = z.object({ answerable: z.boolean(), steps: z.array(PlanStepSchema).max(6), chartSpec: ChartSpecSchema });
```

- **循环与重试上限（唯一，#66 fixHint）**：计划内步骤 ≤6（DAG）；观察-决策循环 ≤4；SQL 执行失败重试 1 次 → DRILL_TEMPLATES 回退；zod 生成→修复 ≤2 次；工具轮次 `stopWhen: stepCountIs(6)`（#21 fixHint 的对齐值）。
- **每答必落图**：制品三选一（新图 / 新表 / 新卡），由 `chartSpec` 落位。

**工具注册表（全项目唯一，`src/lib/tools/registry.ts`，#32 fixHint）**：

| 短名（PlanStep.toolName） | 执行位置 | 真实名 | 说明 |
| --- | --- | --- | --- |
| `calendar` | 服务端 MCP | `get_school_calendar` | 校历 |
| `weather` | 服务端 MCP | `get_weather` | 和风天气 |
| `promo` | 服务端 MCP | `get_promo_calendar` | 大促日历 |
| `duckdb_meta` | **浏览器** | `duckdb_meta` | 直读 DuckDB-WASM 实时 schema（追问实际使用，永不过期，#54） |
| `sql` | **浏览器** | `run_browser_sql` | 白名单 SQL 在浏览器执行，**服务端绝不执行 SQL** |

- MCP 第四工具 `query_bill_db_metadata`（服务端）保留为**协议演示工具**：读 `/api/followup` 请求内的 `sessionSchema` 快照（per-request，无长期存储，#54 fixHint 的「两处暴露、注明用途」）。
- **工具失败语义（04 §11 唯一）**：失败以 `{ok:false, error:{code,message}}` 信封进入上下文，流不中断；同一工具连续失败 2 次 → 从工具集移除并注入禁用声明；`wrapTool`（timeout 4s、指数退避 1s/2s/4s、不可重试错误不重试）。
- 06 §3.2.1 的自拟三步 JSON 协议作废，改引用本节（#32 fixHint）。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 四套追问协议与工具名（#32）；SelectionContext 缺字段、brush 表示两套（#65）；循环上限四处（#21、#66）；duckdb_meta 归属矛盾（#54）。
- 裁决理由：03 §5 为 canonical（fixHint）；工具名建全局注册表短名↔MCP 名映射；浏览器直读 schema 保证新鲜度，MCP 元数据工具仅作协议演示；上限常量取 #66 的四个值。

### 08 修订案 A8（2026-10-14）：追问在线兜底的明细快照出口

**新裁决**：追问面板三路问答的第三路「在线兜底」从「只发送汇总统计」改为「**汇总统计 + 最近 150 笔明细快照**」。这是全产品**唯一**的明细数据网络出口；其余路径（六阶段产物、锚点追问、四个短任务、RAG）的可见性不变。

**明细快照口径（唯一实现 `src/lib/chat/qa-engine.ts`）**：

- `DETAIL_SNAPSHOT_SQL` 固定语句：`SELECT date_iso, category, merchant, amount_cents, direction FROM transactions WHERE direction <> 'neutral' AND status <> 'refunded' ORDER BY date_iso DESC LIMIT 150`——**零动态拼接**（无时间参数、无用户输入、无模板插值），体积恒有上界（≤150 行），不随数据集规模增长；
- 执行方式：`createDuckDbDetailSnapshot()` 经浏览器内 DuckDB 单例直连执行，**不经 `runWhitelistedAggregate`**（§6 的「明细列禁投影」继续约束一切 LLM 生成 / 提示词内拼装的 SQL；本语句是固定内部常量，非聚合、非注入面，§6 A8 边界）；
- 文本化：`buildDetailContext(runDetail, maxChars)` 拼「日期 类目 商户 方向金额」行（原始商户名、真实金额，**不走脱敏器**，§5 A8 边界），总长 ≤3000 字；面板按路由单条消息上限让出预算（detailBudget = 3900 − 汇总段长度，§13 A8）；
- 发送路径：与汇总统计、最近对话合并为首条消息 POST `/api/ai/chat`；统计与明细都拿不到时不转在线、本地回「先导入账单」；
- 面板如实标注：气泡脚注「在线生成 · 已发送明细与统计」；身份罐头文案（small-talk.ts）同步如实说明「本地答不了的问题会把最近 150 笔明细与汇总统计一起发给在线大模型」。

**与旧口径的关系**：本修订案推翻「在线兜底只发送汇总统计、不发送逐笔明细」的旧承诺（02 §8 可见性对照表、README 隐私节、PDF 第 5 章、各页信任文案、06 视频脚本 S1 记忆点同步改写）；「服务端零持久化、只转发」不变；「解析 / 聚合 / 体检默认全在浏览器」不变——明细只在**用户主动追问且本地答不了**时随请求发送，仍不落盘。

**理由**：本地规则只能回答九类固定问题，超出覆盖面的追问（如自由分析）此前因模型拿不到数据而答非所问；放开明细快照后模型能基于真实数据回答。隐私边界从「LLM 只见聚合」调整为「LLM 见聚合 + 最多 150 笔明细快照、服务端零存储」，符合原则①真实优先（承诺与出口一致）。

### 08 修订案 A9（2026-10-15）：在线兜底 SSE 契约与工具徽章

**新裁决**：在线兜底（§13 A9）期间的 MCP 工具调用以 SSE `tool:start/tool:end` 事件流下发，面板渲染三态工具徽章（唯一实现 `src/components/insights/follow-up-panel.tsx` + 展示名单一来源 `src/lib/tools/registry.ts`）：

- 徽章生命周期：`tool:start` 生成徽章（spinner + 「调用中…」）；同名工具的 `tool:end` 按后进先出配对（findLastIndex，同名多轮调用不串台）补 `ok/ms/errorReason`——成功显「✓ · {ms}ms」、失败显「⚠ 调用失败」；`argsDigest`（截断 ≤120 字的入参 JSON 摘要，不含敏感字段）作为悬浮 title 展示调用意图；
- 展示名单一来源：`getToolLabel()` 先查注册表（短名/真实名），次查 EXTRA_TOOL_LABELS 补表（`query_bill_db_metadata` → 「账单库元数据回执」），最后回原名；
- 降级声明：MCP 连接失败整体降级时记入 `run:complete.degraded`，面板按既有降级文案展示「在线生成」脚注与外部数据不可用声明（04 §8.5 行为约定不变：不虚构任何外部数据）；
- mock 演示流：`PROMO_KEYWORDS`（双11/双12/大促/促销/年货/618 等）命中 → 脚本化 `get_promo_calendar` 工具事件对 + promo 档文案（演示稳定第一，与 06 视频脚本口径一致）。

**与旧口径的关系**：本修订案只规定在线兜底路径的工具事件面；锚点追问 PEO 的既有契约（§18 权威定义）与浏览器直读工具（duckdb_meta / run_browser_sql）不变。

---

## 19. AI SDK 使用纪律（唯一）

### 权威定义

- **ai@7.0.137 精确锁定**（npm registry 实测 2026-10-13：7.0.137 发布于 2026-10-09；`latest`=7.0.138 为相邻 patch，建仓日如需升级须同步 01 锁表）。04 §9.4 的 `ai@^5` 注释作废（#17、#55）。
- **系统提示**：一律 `instructions` 选项；**禁止 messages 中出现 `role:"system"`**（v7 默认拒绝，#7 fixHint 采纳 01 的纪律）。03 §2.0 `buildStageMessages` 改为返回 `{ instructions, userMessages }`。
- **流式**：`streamText` / `streamObject`（zod generate→validate→repair 闭环）；全流回调用 `result.stream`（v7 已改名，原 fullStream）；完成/工具回调名以 **ai@7.0.137 装包实测为准**（onFinish/onEnd、onToolCall），列为 W2D1 spike 第一验证项并回写 01/03（#7、#17 fixHint）。
- **工具**：服务端工具经 `wrapTool`；浏览器端工具（`run_browser_sql`、`duckdb_meta`）经 UI 消息流客户端执行（onToolCall 模式，01 §6.4 保留）。
- **zod 全仓唯一 zod@4.6.7**：`z.strictObject` 为注入防护第 2 层闸门；02 的「zod@3」字样与 v3 风格代码删除（#12、#70）；01 锁表补 `zod-to-json-schema` 版本。
- **Provider 包**：`@ai-sdk/deepseek@3.0.63`、`@ai-sdk/openai-compatible@3.0.67`（SiliconFlow 与智谱 GLM-4V 均经此包），精确锁定。
- **MCP 客户端**：以 ai@7.0.137 实际导出的 MCP client 名称为准（`experimental_createMCPClient` 或已转正名），W4D1 spike 结论回写 01/04（#17 fixHint）。

### 08 修订案 A9（2026-10-15）：MCP 客户端 spike 结论回写

**新裁决**：W4D1 spike 实测（npm registry 装包 + 运行时枚举导出）：**ai@7.0.137 不导出任何 MCP 客户端**（`experimental_createMCPClient` 不存在，亦无转正名）。接入层改为基于 `@modelcontextprotocol/sdk@1.32.1`（锁死小版本，协议 2025-11-25）客户端自建（`src/server/ai/mcp.ts`）：`Client`（client/index.js）+ `StreamableHTTPClientTransport`（client/streamableHttp.js）；连接超时 5s、连接失败 30s 冷却、单工具超时 4s、指数退避 1s/2s/4s、连续失败 2 次移出工具集（04 §11 口径不变）。

**ai@7.0.137 工具装配实测口径（回写 04 §9.4）**：

- `tool()` 的 `inputSchema` 要求 FlexibleSchema——**原始 JSON Schema 对象不能直接传**，MCP `tools/list` 返回的 inputSchema 须经 `jsonSchema()`（从 "ai" 导出）包装后透传；
- `dynamicTool` 注释明示专为「运行时才知 schema」的 MCP 场景设计，但本仓采用「`jsonSchema()` 包装 + 普通 `tool()`」路径（类型更精确、execute 入参有推断）；
- SDK `callTool` 返回类型在 tsgo 下解析为 unknown（zod 推导的递归联合），须以运行时守卫提取 text 分片与 isError 标记（`extractToolText` / `isToolErrorResult`），不依赖类型层。

**与旧口径的关系**：本条回填 §19 预留的 spike 结论落点，不改变「MCP 客户端只存在于 AI 接入层、浏览器只与 Next.js 通信」的既有裁决。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- 03 用 `role:'system'` 消息数组违反 01 的 v7 纪律（#7）；04 写 `ai@^5`（#17、#55）；zod 3/4 三套口径（#12、#70）。
- 裁决理由：01 的 v7 纪律保留（装包即报错的风险必须消除，演示稳定优先）；AI SDK 版本取 registry 实测的 7.0.137；zod 统一 4.6.7（01 锁表为唯一版本源）。

---

## 20. 反思自检 judge 与显著性门槛（唯一）

### 权威定义

**L1 规则自检（零成本，永远执行）**：① 数字溯源——headline/narrative 中每个数字必须能在阶段 stats 中找到直接来源；② 显著性门槛（分阶段，全项目唯一，#58 fixHint）：基础统计 ≥30 笔（profile/annual）；金额环比差异 ≥20%（attribution）；连续同类扣费 ≥3 期（subscription，§3 业务规则）；异常 z>2.5 或 ≥3σ（anomaly）——**至少满足其一**；③ `confidence > 0.9` 时逐条复核证据。L1 未过 → 直接 `withheld`。

**L2 LLM 审稿**：主 **qwen**（SiliconFlow 免费档），降级 deepseek → 跳过 L2（仅 L1 闸门）。输入 = 卡 JSON + 阶段 stats；prompt 模板 = 06 §3.1.1 原文（保留为 L2 模板）；输出 `{ pass, issues[], revisedConfidence }`。

**发布闸门（唯一）**：`L1 pass && L2 pass && confidence ≥ 0.6 && 显著性达标` → published；否则 `withheld` 进人工复核区，不自动发布（宁缺毋滥阈值哲学）。样本不足 30 笔时卡片强制 `confidence ≤ 0.7` 并附免责声明。

### 原 01/02/03/04/05/06 的分歧点与裁决理由

- judge 模型两说（#13、#39）；显著性门槛三套（#58：02 笔数≥5 效应>10% / 06 样本≥30 环比≥20% 连续≥3 期 / 03 各阶段自定 / 05 悬空引用）。
- 裁决理由：judge 取 qwen 主 + deepseek 降级（§12 裁决理由）；显著性取 06 的数值并分阶段落位（与 §3 订阅规则、§16 评测口径一致），02/03/05/06 统一引用本节。

---

## 21. 改动索引（各文档必须执行的修改）

### 01-architecture.md

1. §0 增加「术语与常量唯一来源」声明，指向本文档 §0.3/§0.4（#2、#27）。
2. §1.5/附录 A DuckDB-WASM 版本保留 1.32.0，补充 registry 实测依据与「禁 ^、禁 latest」依据（本文档 §8）；§1.6 删除微信/支付宝编码「实测结论」，改为引用 §9 探测链（#5、#37）。
3. §1.4 AI SDK 纪律保留；§2.2④ 删除「查询嵌入经 SiliconFlow 嵌入 API」表述，改为 §16 零 API 拓扑（#9、#35）；§9.3 删除 mcp/rerank.ts，重排器标注为 MCP 容器进程内本地推理（#53）；附录 A 补 `@modelcontextprotocol/sdk@1.32.1`、`onnxruntime-node`、`zod-to-json-schema` 版本（#35、#55、#70）。
4. §2.2-③/§3/§4.1 删除服务端 data-hash LRU 缓存（server/ai/cache.ts、LLM_CACHE_*），改为引用 §10 客户端缓存；§5.3 检查点对齐 §17（#8、#36、#22）。
5. §6.1 协议升版 spendct协议@2 并引用 §2 事件全集（#3、#28）；§6.3 脱敏器改为引用 §5（#31）；§6.4 追问上限对齐 §18（#21、#66）；§6.5 洞察卡 schema 改为引用 §4，删除 echartsSpecSchema（#30、#4）。
6. §2.1 架构图：反思 judge 标注 qwen（#13）；embedding/rerank 位置按 §16 修正（#35）。
7. §3 目录树改为 src/ 布局 + mcp-server/ 子包，删除根级 lib//server//mcp/（#63、#53）；补 §14 的路由目录（#46；A7 后为 10 条路由，见 §14 A7）。
8. §8 性能基准表保留为唯一预算源，LCP 调整为 2.5s、补 RAG P95<900ms（#23、#56）。
13. §8/§16 RAG P95 预算按 2026-10-15 实测修订：稳态 P95<2.5s、冷启动首查<6s（一次性）、TF-IDF<100ms；原 <900ms 的 Stage3 重排预估（150-400ms/30 对）实测约 1.9s（本地 CPU q8 交叉编码），修订明细与数据见 docs/eval-rag.md §3（RAG 金标评测数字回填收口）。
9. e2e 用例标注所属周次，W2 仅覆盖 clean/profile/anomaly 三阶段（#76）。
10. §1.4 AI SDK 纪律：MCP 客户端接入方式按 §19 A9 收口（ai@7.0.137 无 MCP 客户端导出 → `@modelcontextprotocol/sdk` 客户端自建接入层 `src/server/ai/mcp.ts`）。
10. 附录 A 环境变量补 `QWEATHER_API_KEY`、`SILICONFLOW_API_KEY`（#69）；补 06 缺失键对照（§12）。
11. 浏览器端推理叙事（#25）：Transformers.js 标注为 P2 可选「断网商户分类」，未实现则不在材料中宣称推理能力，只讲「DuckDB-WASM 浏览器端计算」。
12. 版本对应关系表记录 01-07 各文档版本号（#75）。
13. §0 收口行更新为 A10 口径：6 条 API 路由（+ocr）、OCR 已上线（glm-4.6v-flash 主 + SiliconFlow GLM-4.1V-9B 降级，低置信字段条带裁剪二次复核）。

### 02-data-privacy.md

1. §5.2 DDL 保留为唯一来源，补 9 张六阶段预计算表注册表与 §3 订阅业务规则（#1、#43、#48）。
2. §5.1 DuckDB 版本 1.29.0/CDN 路径删除，改为引用 §8（#6、#34）。
3. §3.1-§3.3 删除编码「实测结论」，改为引用 §9 探测链（#5、#37）；§3.9 AI 兜底模型 DeepSeek→qwen，补「用户确认 + ≤6KB」前置条件（#40）。
4. §2.1 删除「zod@3」，全部 schema 示例改 zod@4.6.7 风格（z.strictObject）（#12、#70）。
5. §2.6 卡 schema 改为引用 §4（cardId 保留、confidence 数值、stage 枚举去掉 anchor_qa）（#4、#33）。
6. §6 白名单保留为唯一规范，补：4000 字符上限、3s/10s 超时对齐、ALLOWED_RELATIONS 加预计算表、bannedKeywords 并入 REINDEX（#42、#43、#73）。
7. §7 脱敏器改为引用 §5（加盐策略、函数签名、S1-S5）；§7.2 sourceSqlHash 改 8 位（#31、#78）；§7.1 商户可见性规则改为引用 §5 的唯一规则（#15）。
8. §8 可见性对照表新增两行：CSV 格式 AI 兜底片段（用户确认后 ≤6KB）、商户分类任务文本（未命中词典的商户主名）、OCR 截图（GLM-4V-Flash 视觉处理）（#10、§11）；§12.4 合规文案改为如实表述（#10 fixHint 原文）。
9. §12.1 OCR 网关 SiliconFlow→智谱 GLM_API_KEY，降级链按 §11（#45）。
10. §4.1 sample-data 620 行改为 1000+ 行，路径对齐 §15（#18、#44）。
11. §3.10 fixtures 清单与 06 合并为唯一清单（#62）；显著性门槛引用 §20（#58）；商户分类批处理 key 对齐 §12（#68）。
12. §8 可见性对照表新增「追问在线兜底明细快照」行；「任何网络出口只出现聚合/脱敏结果」类不变量改为登记唯一明细出口（§18 修订案 A8）；§1.2 隐私承诺表述同步（明细默认本地，追问在线兜底例外）。
13. §12 标题「设计态未上线」→「已上线」+ 实现收口注记（默认模型 glm-4.6v-flash 及 base64 理由、SiliconFlow 降级模型 THUDM/GLM-4.1V-9B-Thinking、extractJsonObject 容错提取、低置信条带裁剪复核复用 /api/ocr mode=review、safeParse 失败重试 1 次 = 降级网关这一次重试，§11 A10）。

### 03-agent-pipeline.md

1. §0/§1.2 tx 表与全部 SQL 示例改为 §3 transactions 表（amount_cents 分）（#1、#29）。
2. §1.1 StageId 保留（已被采纳为唯一）；StageStatus 删 streaming/paused（#51）；§1.3 订阅阈值改为引用 §3 业务规则（#24、#48）；§1.3「P1 功能 P0 阶段」表述修正为「P1 功能，第 4 阶段 subscription」（#74）。
3. §2.0 buildStageMessages 改为返回 {instructions, userMessages}，禁止 role:"system"（#7）；铁律 6 保留并引用 §5 商户显示规则（#15）。
4. §3 CardDraft 改为 §4 的 InsightCardDraftSchema（confidence 数值 0-1、sources 用 CitationSchema 规范）（#4、#33、#60）。
5. §4.1 validateSql 改为「实现 02 §6/契约 §6」，JOIN 不隐含允许（#42）。
6. §5 追问协议保留为 canonical，补工具注册表映射（§18）、SelectionContext 定义（#32、#65）。
7. §6/§10 reflect judge 路由 deepseek→qwen（deepseek 仅降级）（#13、#39）；§10 路由表对齐 §12（含 CSV 兜底/商户分类 qwen，#40）；ModelId 枚举保留（#64）。
8. §8 缓存对齐 §10 键名与命名分离（#8、#36、#67）。
9. §1.4 删除 spendct:tx:${datasetId} 明细存储，断点键对齐 §17（#22、#41）；spendct:llmcache/spendct:table/spendct:run:latest 保留（#41）。
10. §9 事件协议删除自拟 PipelineEvent，改为引用 §2（#3、#28）。
11. §11 组件引用对齐 §14 组件注册表（#52）；循环上限对齐 §18（#21、#66）。

### 04-rag-mcp.md

1. §0.4 订阅雷达阶段序号 4→3，案例库 stage 标注同步（#49）。
2. §9.4 `ai@^5` 注释改为「以 ai@7.0.137 实测 API 为准」（#17、#55）。
3. 嵌入/重排运行位置：表述统一为「MCP 容器进程内本地推理」（§16），补公网 tfidf-only 的 README/技术文档披露文案（#16）。
4. §5.1 金标 20 题分布与阈值对齐 §16（订阅8/习惯4/异常4/个人化2/学生2；90% CI / 80% G3 / 12/20 TF-IDF），脚本目录 tests/golden/ + scripts/rag/eval-hit3.mjs（#14、#57）。
5. §8.4 query_bill_db_metadata 标注为协议演示工具，快照 per-request 随 /api/followup 传递，表枚举 bills|merchants→transactions|merchants（#54、§13、§3）。
6. §9.2 会话 schema 存储 TTL 说明改为 per-request（#54）。
7. §10.2 砍法丢分评估保留为唯一诚实口径（06 改为引用）（#26）。
8. §11.1 maxToolRoundtrips/stepCountIs(6) 保留，与 §18 常量表互引（#21）。
9. §13 里程碑日期改为引用 06（MCP gate 11/6、评测 11/7+，11/10-17 最终评测）（#61）。
10. §14 费用预算保持；案例库 schema 增加社会议题证据字段的落点说明（legalBasis 扩展，供 PDF 第 8 章数据图）（#19）。
11. §9.4 代码骨架按 §19 A9 spike 结论重写：ai@7.0.137 无 MCP 客户端 → SDK Client 自建接入层 + `jsonSchema()` 包装透传；§1.1/§8.0 架构图同步（#17 收口）。
12. §8.4 表枚举与快照指纹口径按实现收口：枚举 `transactions|merchants`；`datasetTxHash` = 导入层 `hashCleanRows` 的 SHA-256 前 16 位十六进制（regex `^[0-9a-f]{16,64}$`，与 mcp-server 侧 schema 镜像一致）。
13. §9 末尾新增 §9.6「上线收口（2026-10-15 实测）」：接入层、L1→L2 回退双轨、事件契约、测试证据的实测落点；README / PDF 口径以该块为准。
14. §8.5 信封 `meta` 增加 `generatedAt` 时间戳字段（回退与 MCP 两侧实现一致），错误码集合不变。

### 05-uiux.md

1. 全文「Next.js 14」改为引用 01 锁表（16.4.0）；删除 tailwind.config.ts 片段，改 @theme CSS 变量说明（#11）。
2. 路由改为 §14 的 7 条（删 /ledger、/about→/privacy）（#46）；RouteGuard 改 next/navigation（#22）。
3. 4 个 store 映射为 01 的 6 slice 别名（#51）。
4. InsightCardSchema v05 删除，改引用 §4（删 uuid、significance 枚举、sankey；sources 用 CitationSchema）（#4、#33、#60、#72）。
5. PipelineEvent v05 删除，改引用 §2（#3、#28）；ThinkingPanel 依赖的 llm-fallback/rag-hit 映射为 llm:degraded/rag:retrieved（#3）。
6. ModelId 枚举改为 deepseek|qwen|glm4v|local-tfjs + 展示名映射表（#64）。
7. 订阅 SQL T3 改为引用 §3 业务规则（金额 1-60、间隔 25-40 天、±1%）（#24、#48）；「外卖依赖度」删除或并入餐饮占比；冲动消费时段 22:00-02:00 改为 23:00-05:00（#50）。
8. SelectionContext 补 slice/tableMeta/chartType/history；brush 统一 dataIndex 集合（#65）。
9. 断点键 spendct:checkpoint:v1 删除，改引用 §17（#22、#41）。
10. 组件清单补 ThinkingBubble/SqlCodeBlock/TypingCard/DegradeToast/EvidenceTable/ToolBadge 并登记 §14 注册表（#52）；§2.2 组件总表定位为页面级组件唯一登记表（与 §14 注册表两级分工，约 16 个页面级组件 + 19 个注册组件口径写入 PDF/README）；修复 §0.3/§2.8/§3.1.3 失效内部引用与 validate_palette.js 引用（#71）。
11. 演示时长口径补注：3.5s = 缓存后单次六阶段计算耗时，60s = 视频全程上限（#77）；版本升 v1.0（#75）。
12. 信任文案（首页三节点、底栏、登录壳、追问面板脚注、体检页角标）按 §18 修订案 A8 改写：不再笼统写「账单不出浏览器」，改为准确表述——解析 / 聚合 / 体检默认全在浏览器；追问在线兜底会发送「汇总统计 + 最近 150 笔明细快照」；服务端只转发不落盘。
13. §2.1 UploadPage 子树与 §2.2 组件总表补页面级组件 `OcrImportPanel`（两级注册口径，§14）。

### 06-roadmap.md

1. §2.4 SIX_STAGES 改为引用 §1 枚举（clean/profile/anomaly/subscription/attribution/annual），删除自拟 PipelineEvent，改引用 §2（#2、#3、#27、#28）。
2. §2.0 AggregatePolicySchema 注释「见 01/03」改为「见 02 §6 / 契约 §6」；bannedKeywords 保留并注明含 REINDEX；maxResultRows 固定 50 与 02 对齐（#73）；W1D1 DuckDB `^1.29.x` 改为精确 1.32.0 + 自托管，引用 §8（#6、#34）。
3. §2.5 四段示例 SQL 全部改写为 transactions 表（amount_cents），订阅 SQL 引用 §3 业务规则（#1、#24、#29、#48）。
4. §2.7 InsightCardSchema 删除，改引用 §4（#4、#33）；§2.4 检查点键对齐 §17（#22、#41）。
5. §3.1.1 反思 prompt 保留为 L2 模板，judge 模型标注 qwen，显著性门槛引用 §20（#13、#58）。
6. §3.2.1 三步 JSON 追问协议删除，改引用 §18（#32）。
7. §3.4.1/§7 A3 性能数字改为引用 01 §8（冷<4s/热<1.5s、内存<400MB、LCP<2.5s、dry-run<5s）（#23、#56）；A4 金标改为引用 §16 口径（20 题、90%/80%/12-20 分层）（#14、#57）。
8. §6.2 S2 台词改「一千行脱敏演示账单」，10k 仅入 S7 性能表（#18、#44）；§6.2 演示时长口径按 #77 补注。
9. §4 砍法表丢分评估改为引用 04 §10.2 诚实口径（#26）；§6.3 顶部固定「评分细则唯一口径表」（UX 拆分、AI 深度六子项、各砍法丢分区间）（#26）。
10. T32 sample-data 规格对齐 §15（1000+ 行、埋点、路径）（#18、#44）；fixtures 与 02 合并唯一清单，恶意 SQL 演示注明「10/10 为 18/18 子集」（#62）。
11. 附录 A 目录改为 src/ 布局 + mcp-server/（#63、#53）；删除「与 01 冲突以 01 为准」条款，改为「以契约 07 为准」（#63）。
12. W4 日程与 04 §13 对齐（MCP gate 11/6、评测 11/7 起）（#61）；e2e 周次标注对齐 #76。
13. 视频脚本 S7 补「零嵌入 API 抓包证据」镜头（§16）。
14. 视频脚本 S1 记忆点「你的账单不出浏览器，大模型只看聚合摘要」按 §18 修订案 A8 改写（大模型在追问时可见「汇总统计 + 最近 150 笔明细快照」，服务端零存储）；S8 与 3 分钟陈述提纲、竞品对照表口径同步。
15. §6.3 PDF 大纲 4.5 与多模态落点表改已上线口径（glm-4.6v-flash 主 / SiliconFlow GLM-4.1V-9B 降级；删除「若被砍」脚注，§11 A10）。

### 08-feature-expansion.md（修订案 A1-A7，2026-10-13，v1.1）

08《功能扩展方案》13 项功能（F01-F13，P0/P1/P2 三档，见 08 §①）经评审通过后，以修订案 A1-A7 形式并入本文档（§0.1 第 4 条）；A8 为 2026-10-14 的追问明细出口裁决，延续编号并入 §18（§0.1 第 4 条）。各修订案已在对应条目内落位（条目内「08 修订案」小节）：

| 修订案 | 修订条目 | 内容 |
| --- | --- | --- |
| A1 | §17 | 持久化红线允许项增补：`budgets` 表（DuckDB OPFS）、`spendct:achievements:v1`/`spendct:fav:v1`/`spendct:notif:v1` 三键（localStorage）、记账文本不落盘 |
| A2 | §6 | ALLOWED_RELATIONS 注册 `budgets`/`budget_vs_actual`/`forecast_monthly`（含 DDL 与生成规则） |
| A3 | §3 | transactions 语义值扩展：`source`/`channel` + manual、`raw_ref` M#、`direction` 允许 income |
| A4 | §16 | 金标评测：主集 20 题口径不变 + 补充集 `student-golden-8`（hit@3 ≥7/8）+ 案例库 100+ → 150+ |
| A5 | §12 | 任务级路由表 +5 行（quick-entry/budget-advice/forecast-narrative/tip-personalize/annual-story）+ 新任务 zod 单一来源 + 提示词要点；env 零新增 |
| A6 | §13 | 端点 6 → 7：新增 `/api/ai/task`（taskId 判别联合）；「唯一 LLM 出口」扩展为三路由 |
| A7 | §14 | 路由 7 → 10（+`/budget` `/learn` `/settings`）；组件注册表 13 → 19（+6 组件，两级注册：可复用 19 个全名登记 + 页面级按 05 §2.2 单列）；**分档口径（08 §1.2）：省赛提交版本 = 9 条路由 + 3 个 P2「即将上线」角标，国赛窗口补齐 10 条** |
| A8 | §18（§5/§6/§13 边界注记） | 追问在线兜底发送「汇总统计 + 最近 150 笔明细快照」（固定 SQL 直连、LIMIT 150、/api/ai/chat 转发、服务端零存储） |
| A9 | §13/§18/§19 | MCP 工具链上线收口：在线兜底落位 /api/followup（SSE + tool 事件，/api/ai/chat 职责收窄）；工具徽章三态契约与展示名单一来源；ai@7.0.137 无 MCP 客户端 spike 结论回写（SDK Client 自建 + jsonSchema 包装透传 + callTool 运行时守卫） |
| A10 | §11/§12/§13 | OCR 上线收口：默认模型 glm-4.6v-flash（官方 glm-4v-flash 不支持 base64，与「截图不落盘」冲突）、SiliconFlow 降级 THUDM/GLM-4.1V-9B-Thinking、env 补 GLM_VISION_MODEL/SILICONFLOW_VISION_MODEL、API 路由 5 → 6（路由口径 19 → 20） |
| — | §4 | ChartSpec 枚举不扩展；四大静态图表组件裁决（08 §④ 补记） |

- **08 文档自身需同步的修改**：§11.2「工作量体现口径」的「19 个注册组件」改为「19 个注册组件 + 页面级组件按 05 §2.2 表单列（约 16 个）」，与本文 §14 A7 两级注册口径对齐（PDF/README 数字与代码一一对应）。

---

*本文档完。本文档为 01-06 的仲裁结果；v1.1（2026-10-13）起并入 08《功能扩展方案》修订案 A1-A7，v1.2（2026-10-14）起并入修订案 A8（追问在线兜底明细出口，§18），v1.3（2026-10-15）起并入修订案 A9（MCP 工具链上线收口，§13/§18/§19），v1.4（2026-10-15）起并入修订案 A10（OCR 上线收口，§11/§12/§13）。任何后续修改必须同时更新本文档、受影响文档，并重跑对应回归（白名单单测 / 事件 round-trip / 金标评测）。*
