# 04 RAG 与 MCP 工具设计（SpendCT · 消费CT）

> 版本 v1.1 ｜ 2026-10-13 ｜ 作者：数据管线/AI（主笔）、材料（案例来源核验与评测数字口径）
>
> v1.1 变更（08 功能扩展方案 §⑤ 与修订案 A4 落地）：案例库总目标 100+ → 150+；新增第 8 类 `student_benefits` 与 `benefitTags`/`audience` 字段；新增金标补充集 `student-golden-8`（hit@3 ≥7/8 独立断言）；金标主集 20 题三档阈值（18/16/12）不变。
>
> **实现收口（2026-10-14）**：实际交付为「案例库 60 条 + 本地关键词匹配（省钱贴士按 top 类目）+ 订阅卡确定性引用」；独立嵌入检索、金标评测与独立 MCP 服务未上线（工具集成以浏览器内 SQL + 4 个结构化 LLM 短任务体现，07 §13 收口说明）。本文其余内容为设计态，国赛窗口恢复。

---

## 0. 文档说明

### 0.1 本文档负责的范围

本文档覆盖评审维度中 **RAG 应用（6%）** 与 **MCP/工具集成（4%）** 的全部设计，共十个主题：

| 编号 | 主题 | 对应章节 |
|---|---|---|
| ① | 案例库 schema（8 类）与 150+ 条案例生产计划 | §2 |
| ② | bge-m3 嵌入离线预计算管线（运行时零嵌入 API 调用） | §3 |
| ③ | 混合检索级联（dense 余弦 + bge-reranker 重排 + SQL 元数据过滤） | §4 |
| ④ | 金标主集 20 条 + 学生权益补充集 student-golden-8 + hit@3 评测脚本 + 引用准确率指标 | §5 |
| ⑤ | TF-IDF 本地兜底（纯 TS 轻量实现） | §6 |
| ⑥ | 用户历史账单个人化 RAG | §7 |
| ⑦ | MCP 四工具规格（校历/和风天气/大促日历/DuckDB 元数据） | §8 |
| ⑧ | MCP server 实现方案（SDK/传输/部署/接入/演示脚本） | §9 |
| ⑨ | 砍法（时间不足退 Function Calling 的确切路径与丢分评估） | §10 |
| ⑩ | 「工具不可用 → Agent 跳过该工具继续跑」优雅降级 | §11 |

不在本文档范围：账单清洗、六阶段流水线编排、洞察卡生成、SQL 沙箱、提示注入防护、UI 组件实现、部署总方案——分别见 01/02/03/05/06 文档。

### 0.2 读者

- **数据管线/AI（本域负责人）**：按本文档直接实现；§2–§7 是实施说明书。
- **前端交互**：只读 §0.4（接口契约）、§8.5（工具徽章数据流）、§11.4（错误态/空态规范），其余按 05 文档施工。
- **材料**：读 §2.2（案例生产与人工校验流程，你是第一核验人）、§5（评测数字口径，写入技术文档）、§9.5（演示视频分镜）。

### 0.3 与其他文档的接口（本域定义的契约，其他文档必须对齐）

| 契约 | 本文档定义 | 消费方 |
|---|---|---|
| `InsightCard.sources: Citation[]`（引用数组，07 §4） | §2.1、§4.6 | 03（洞察卡生成流水线注入）、05（引用 footer 渲染） |
| `Citation.kind = "sql"｜"rag"｜"tool"｜"rule"｜"personal"`（07 §4 唯一枚举；案例引用 kind=rag） | §4.6、§8.5 | 03、05 |
| `personalContext` 洞察卡扩展字段 | §7.4 | 03、05 |
| `ToolInvocation { tool, state, latencyMs, meta }` 工具调用徽章数据流 | §8.5、§11.4 | 03（编排层产出）、05（ToolBadge 组件） |
| 检索服务两处挂载点：订阅雷达（浏览器内）+ 锚点追问（AI 接入层） | §1 | 03（流水线 subscription 阶段（第 4 阶段，07 §1）与 Plan-Execute-Observe） |
| 数据可见性对照表新增行（RAG 检索模块、MCP server 各看到什么） | §7.4、§8.4 | 02 |
| 提示注入防护扩展：检索文本与工具输出按「数据不可信」处理 | §4.4、§8.5 | 02、03 |
| 新增依赖与环境变量清单（`@modelcontextprotocol/sdk`、`onnxruntime-node`、`MCP_SERVER_URL`、`QWEATHER_API_KEY`、`EMBEDDING_PROVIDER`、`HF_ENDPOINT`） | §3.2、§9.2 | 01（技术总纲依赖与 env 模板） |
| 评测数字写入技术文档的表格模板（hit@3 / 引用忠实度 / 引用覆盖 / 检索延迟） | §5.4 | 06（技术文档 §4 AI 技术方案与 §6 测试与部署）、材料 |
| 演示视频「MCP 协议握手 + 结果注入归因」分镜素材 | §9.5 | 06（视频脚本汇总） |
| monorepo 新增子包 `mcp-server/`、公共数据目录 `data/cases/` | §3.2、§9.3 | 01、06 |

### 0.4 术语表

| 术语 | 含义 |
|---|---|
| 案例库 | 自建订阅陷阱/消费维权案例集合（cases.json），公开知识，非用户数据 |
| dense / 稠密检索 | 用 bge-m3 向量余弦相似度召回 |
| reranker / 重排 | bge-reranker-base 交叉编码器对（query, 文档）逐对打分精排 |
| TF-IDF 兜底 | 纯 TS 稀疏向量检索，dense 不可用时的替代召回 |
| 嵌入向量版本（embeddingVersion） | 模型 + 归一化方式 + 维度的组合标识，如 `bge-m3@v1` |
| 金标 query | 人工标注正确答案（应命中的案例 ID）的评测问题 |
| 补充评测集（student-golden-8） | 学生权益类别 8 题金标评测集（§5.6），与主集 20 题分开报告、独立断言（修订案 A4） |
| 锚点追问 | 洞察卡元素点击/框选发起的追问（03 文档 Plan-Execute-Observe） |
| 订阅雷达 | 流水线 subscription 阶段（第 4 阶段，07 §1 唯一序号）的订阅陷阱扫描（03 文档），确定性 SQL + RAG 引用 |
| AI 接入层 | Next.js Route Handler（服务端），LLM 调用、检索、工具编排所在层 |
| 个人化 RAG | 检索用户自己的往月异常事件（浏览器内，不上传） |

### 0.5 已确认决策在本域如何落点（不推翻，逐条映射）

| 产品定义决策 | 本文档落点 |
|---|---|
| RAG=自建 100+ 条案例库（08 §⑤.2 扩容至 150+）+ bge-m3 嵌入离线预计算进 repo + 混合检索 + 20 条金标 hit@3 评测（+ student-golden-8 补充集独立报告）+ TF-IDF 本地兜底 + 个人化 RAG | §2/§3/§4/§5/§6/§7 |
| 三重抗限流之一：bge-m3 嵌入离线预计算 | §3.1 硬约束「运行时零嵌入 API 调用」 |
| MCP 四工具=校历/和风天气/大促日历/DuckDB 元数据；最小 server 部署免费容器；时间不足可退 Function Calling，必须写清砍法 | §8/§9/§10 |
| 浏览器端推理加分（DuckDB-WASM 是浏览器端计算、Transformers.js 才是浏览器端推理，用词严谨） | §1 双层检索：浏览器内 TF-IDF 是**计算**，服务端 onnxruntime 本地推理是**推理**；文档不把 TF-IDF 称为推理 |
| 费用纪律 ¥30–100、上限 ¥150 | §14：本域增量费用 ≤ ¥1 |
| 宁缺毋滥阈值哲学（洞察质量） | §4.6 引用阈值、§5.3 引用白名单 |
| 演示稳定性第一（sample-data、断网降级、备用录像） | §11 降级矩阵、§9.5 分镜 4 断网镜头 |
| 2 人团队按砍法执行（砍 MCP+OCR+银行 CSV） | §10.3 |
| W3 订阅雷达 + 锚点追问 + RAG 最小版；W4 MCP 四工具 + 部署 | §13 里程碑 |

---

## 1. 总体架构：双层检索 + 四工具

### 1.1 架构图

```
┌────────────────────────── 浏览器（Next.js client）──────────────────────────┐
│ DuckDB-WASM（账单明细/异常事件表/anomalies）                                   │
│   │                                                                          │
│   ├─▶ [检索模式A·浏览器内] 订阅雷达引用检索                                    │
│   │      SQL 元数据过滤（DuckDB-WASM 参数化） + TF-IDF 排序（纯 TS，<10ms）     │
│   └─▶ [个人化 RAG] 历史异常事件：DuckDB-WASM SQL 结构化召回 + TF-IDF 排序      │
│         （全程浏览器内，用户数据零上传 —— 对齐 02 文档隐私架构）                │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ 锚点问题 + 聚合上下文（03 文档可见性对照表口径）
               ▼
┌──────────────────────── AI 接入层（Next.js Route Handler）───────────────────┐
│  [检索模式B·服务端] 锚点追问深度检索                                           │
│    Stage1 SQL 元数据过滤（谓词参数化，等价 SQL）                                │
│    → Stage2 dense：bge-m3 余弦（文档嵌入离线预计算进 repo；查询嵌入 onnx 本地推理│
│    → Stage3 bge-reranker-base 重排（本地推理）→ 引用产出（≤3 条，宁缺毋滥）     │
│  [MCP 客户端] AI SDK experimental_createMCPClient —— Streamable HTTP ──┐     │
└─────────────────────────────────────────────────────────────┬──────────┼─────┘
                                                               ▼          │
                                    ┌──────── MCP server（Railway/Render 免费容器）┐│
                                    │ get_school_calendar   静态 JSON（repo 内）   ││
                                    │ get_weather           和风天气免费档（key=env）│
                                    │ get_promo_calendar    静态 JSON（repo 内）   ││
                                    │ query_bill_db_metadata 协议演示（快照随工具参数传入，无存储）│◀┘
                                    └──────────────────────────────────────────────┘
```

### 1.2 关键架构决策（D1–D8）

| 决策 | 内容 | 理由 | 被否决的替代方案 |
|---|---|---|---|
| D1 | 检索双层：订阅雷达引用在**浏览器内**（TF-IDF），锚点追问深度检索在**AI 接入层**（dense+reranker） | 订阅雷达引用场景零网络、用户明细零上传（隐私叙事）；bge-m3（约 568M 参数）量化后数百 MB，无法进浏览器首屏 | 全浏览器 Transformers.js（被 bge-m3 体积否决）；全服务端（订阅雷达引用需联网，隐私叙事变弱） |
| D2 | 运行时零嵌入 API 调用：文档嵌入离线预计算进 repo；查询嵌入用 **onnxruntime-node 本地推理**；模型不可用降级 TF-IDF | 满足②的硬约束；零费用、零限流（三重抗限流之一）；与文档嵌入严格同空间 | SiliconFlow bge-m3 API（有费用+限流风险，直接违反约束，否决） |
| D3 | 级联顺序：SQL 过滤 → dense top-30 → rerank top-5 → 引用 ≤3；rerank logits 阈值 -2.0 | 便宜的先做；宁缺毋滥阈值哲学 | dense 与 TF-IDF 分数融合（RRF）——语料太小，无增益且增加调参面 |
| D4 | 金标 20 条的查询嵌入也离线预计算进 repo，评测脚本零 API、零网络、可进 CI | 评测数字确定性、可复跑（评测数字写入技术文档，必须可复核） | 评测时实时调嵌入 API（费用、抖动、断网风险） |
| D5 | 个人化 RAG 全程浏览器：异常事件摘要存浏览器，DuckDB-WASM 结构化 SQL + TF-IDF 语义排序 | 用户历史数据不出浏览器（02 文档硬约束；追问在线兜底的明细快照为唯一例外，07 修订案 A8） | 服务端存历史异常（违反隐私架构） |
| D6 | MCP 传输选 **Streamable HTTP**（stdio 仅本地调试） | 容器部署可达、AI SDK 原生支持、演示可录制握手 | stdio（无法容器部署） |
| D7 | DuckDB 元数据工具（MCP 协议演示）数据来源 = 浏览器随每次 `/api/followup` 请求体（`sessionSchema` 字段，07 §13）携带的**聚合级 schema+统计快照**（per-request，服务端零存储）；浏览器端真实路径 = `duckdb_meta` 直读 DuckDB-WASM（07 §18） | DuckDB 数据在浏览器，远程 MCP server 够不到；快照只含列名/类型/统计，不含明细，符合 02 可见性对照表 | 客户端假工具（失去 MCP 叙事）；schema 硬编码进 system prompt（列统计动态变化，不灵活） |
| D8 | 工具故障一律返回结构化降级结果（不抛异常中断流）；同一工具连续 2 次失败即禁用并注入提示 | ⑩优雅降级的核心机制，演示稳定性第一 | 工具失败即中断整个回答（体验灾难，否决） |

### 1.3 本域对外 API 汇总（03/05 文档消费）

```ts
// src/lib/rag/types.ts —— 全项目唯一来源（03/05 从本文件 import）
export interface CaseFilter {
  categories?: CaseCategory[];   // 类别过滤，缺省=不过滤
  amountMin?: number;            // 金额下界（元），缺省=不过滤
  amountMax?: number;            // 金额上界（元）
  months?: number;               // 时间参照窗口（如 3=近3月相关案例）
}

export interface RetrievedCase {
  caseId: string;                // 如 "C009"
  title: string;
  category: CaseCategory;
  score: number;                 // 最终阶段得分（rerank logits 或 tfidf 相似度）
  stage: "rerank" | "dense" | "tfidf" | "rule";  // 实际走到哪一阶段
  snippet: string;               // 命中文本片段（recognitionSignals/resolutionSteps 原文摘录）
}

export interface Citation {        // 与 07 §4 CitationSchema 唯一枚举对齐（#60）
  kind: "sql" | "rag" | "tool" | "rule" | "personal";  // rag=案例库 personal=自己的往月记录 tool=外部工具 rule=确定性规则 sql=SQL 产物
  ref: string;                    // rag:${caseId}（如 rag:C009）/ tool:${toolName} / rule:${ruleId} / personal:${anomalyId} / sql:${table|view}:${tableId}（07 §4 ref 规范）
  label: string;                  // 展示文本，如「案例 C009 · 小额连续扣费」
  meta?: { source?: string; url?: string; updatedAt?: string };  // 归因元数据（§8.5 meta.source 同源；07 §4 CitationSchema.meta）
  snippet?: string;
  score?: number;
}

export interface ToolInvocation {        // 05 文档 ToolBadge 组件渲染契约
  tool: string;                          // 工具名
  state: "running" | "ok" | "skipped" | "error";
  latencyMs?: number;
  meta?: { source?: string; updatedAt?: string; cache?: "hit" | "miss" };
  errorReason?: string;                  // skipped/error 时的文案，如「连接超时」
}

// 检索服务两处挂载点（03 文档调用）：
//   浏览器内（订阅雷达/个人化）： src/lib/rag/browser-retrieve.ts  retrieveCasesInBrowser(query, filter)
//   服务端（锚点追问）：        src/server/rag/retrieve.ts         retrieveCases(query, filter)
```

---

## 2. 案例库设计

### 2.1 案例库 Schema（zod 即唯一事实来源）

```ts
// src/lib/rag/case-schema.ts —— 案例库唯一 schema（生成、校验、运行时共用）
import { z } from "zod";

export const CaseCategory = z.enum([
  "subscription_trap",  // 订阅陷阱（自动续费/连续包月/试用转付费）
  "prepaid_risk",       // 预付费风险（年卡跑路/押金/充值卡）
  "minor_spending",     // 未成年人消费（游戏充值/打赏）
  "consumer_rights",    // 消费维权指引（退费/投诉/12315）
  "platform_rule",      // 平台规则（取消入口/扣费协议/账单导出）
  "regulation",         // 法规条文（消保法实施条例等）
  "spending_advice",    // 消费建议（大促避坑/预算控制/拿铁因子）
  "student_benefits",   // 学生权益与省钱贴士（08 §⑤.1 第 8 类：学生认证优惠/教育优惠/校园卡/低价替代订阅/权益省钱）
]);
export type CaseCategory = z.infer<typeof CaseCategory>;

export const AmountPatternType = z.enum([
  "monthly_fixed",    // 固定月扣（如 25 元/月）
  "monthly_range",    // 区间月扣
  "one_time",         // 一次性（年卡/课程/大额充值）
  "trial_then_full",  // 试用期低价/免费 → 到期扣全款
  "micro_recurring",  // 小额高频（≤30 元/次，高频扣）
  "increasing",       // 阶梯涨价
]);

export const CaseRecordSchema = z.object({
  id: z.string().regex(/^C\d{3}$/),          // 稳定 ID，AI 生成后人工确认，不重复使用
  title: z.string().min(8).max(60),          // 案例标题（含典型金额/场景，利于检索）
  category: CaseCategory,                    // 类别（任务要求字段①）
  subCategory: z.string(),                   // 细分，如「影音会员」「网盘」「健身预付卡」
  merchantPattern: z.array(z.string()),      // 商户名匹配模式（关键词/正则），如 ["爱奇艺","腾讯视频","优酷"]
  amountPattern: z.object({                  // 金额模式（任务要求字段②）
    type: AmountPatternType,
    min: z.number(),                         // 典型金额下界（元）
    max: z.number(),                         // 典型金额上界（元）
    currency: z.literal("CNY"),
    cadence: z.enum(["once","daily","weekly","monthly","yearly","irregular"]).optional(),
  }),
  recognitionSignals: z.array(z.string()),   // 识别特征（任务要求字段③）：账单侧可观察信号，供 LLM/确定性 SQL 匹配
  resolutionSteps: z.array(z.string()),      // 处置方案（任务要求字段④）：用户可执行步骤，含平台入口路径
  legalBasis: z.array(z.string()).optional(),// 法条/规则依据，如「《网络交易监督管理办法》第18条」
  source: z.object({                         // 来源链接（任务要求字段⑤）
    name: z.string(),                        // 来源名（消协/平台/媒体报道）
    url: z.string().url(),                   // 原文链接
    type: z.enum(["consumer_association","platform_rule","public_report","official_law"]),
    publishedAt: z.string().optional(),      // "2025-03-11"
  }),
  embeddingVersion: z.string(),              // 嵌入向量版本（任务要求字段⑥），如 "bge-m3@v1"
  riskLevel: z.enum(["high","medium","low"]),
  tags: z.array(z.string()),                 // 检索辅助标签，如 ["自动续费","取消入口"]
  benefitTags: z.array(z.string()).optional(),  // 学生权益标签（08 §⑤.1，仅 student_benefits 类填写）：student_cert/edu_discount/campus_card/budget_substitute/rights_tip
  audience: z.enum(["student", "general"]).optional(),  // 08 §⑤.1：student=学生专属案例（贴士卡人群过滤）；缺省按 general 处理
  reviewedBy: z.string(),                    // 人工校验人（材料/数据管线）
  reviewStatus: z.enum(["draft","verified"]),// 只有 verified 进入生产检索
  createdAt: z.string(),                     // ISO 日期
  updatedAt: z.string(),
});
export type CaseRecord = z.infer<typeof CaseRecordSchema>;
```

完整条目示例（C009）：

```json
{
  "id": "C009",
  "title": "小额连续扣费：每月9.9/19.9元陌生代扣商户，扣半年才发现",
  "category": "subscription_trap",
  "subCategory": "小额代扣",
  "merchantPattern": ["自动续费", "代扣", "连续包月", "小额扣费"],
  "amountPattern": { "type": "micro_recurring", "min": 6.9, "max": 29.9, "currency": "CNY", "cadence": "monthly" },
  "recognitionSignals": [
    "同一陌生商户每月固定日扣款，金额≤30元",
    "账单中商户名含「代扣/自动续费」字样",
    "扣款周期≥3个月，用户无对应消费记忆"
  ],
  "resolutionSteps": [
    "微信：我→服务→钱包→支付设置→扣费服务，逐项解约",
    "支付宝：我的→设置→支付设置→免密支付/自动扣款，关闭代扣",
    "对已扣费用：联系商户客服要求退款，被拒后通过 12315 平台投诉（附扣款记录截图）"
  ],
  "legalBasis": ["《网络交易监督管理办法》第18条（自动续费需提前5日以显著方式提醒）"],
  "source": { "name": "微信支付官方文档·扣费服务管理", "url": "https://kf.qq.com/", "type": "platform_rule" },
  "embeddingVersion": "bge-m3@v1",
  "riskLevel": "high",
  "tags": ["自动续费", "小额扣费", "解约入口", "12315"],
  "reviewedBy": "材料",
  "reviewStatus": "verified",
  "createdAt": "2026-10-21",
  "updatedAt": "2026-10-21"
}
```

> 字段「嵌入向量版本」同时写三处并交叉校验：条目内 `embeddingVersion`、`manifest.json` 的 `embeddingVersion`、`embeddings.json` 的 `version`（§3.4 的 verify 脚本强制三者一致）。

**第 8 类 `student_benefits` 定义（08 §⑤.1）**：面向学生人群的可核验权益信息——学生认证优惠（外卖/视频/出行）、教育优惠（软件/设备）、校园卡与食堂/图书馆资源、低价替代订阅（学生价/年费拆解）、权益型省钱方法。`benefitTags` 可选值仅五枚：`student_cert / edu_discount / campus_card / budget_substitute / rights_tip`；`audience: "student"` 供省钱贴士卡人群过滤（演示账单用户=大学生画像，命中率高），其余案例缺省按 `general` 处理。来源纪律不变（§12 风险表）：来源必须可访问 + 摘录句可对照 + 法条对 gov.cn 原文；`reviewStatus` 双人机制；REVIEW_LOG 留痕。

第 8 类条目示例（C118，student_benefits）：

```json
{
  "id": "C118",
  "title": "视频会员学生价：学生认证后连续包月 9-12 元/月，比普通价省一半以上",
  "category": "student_benefits",
  "subCategory": "影音会员",
  "merchantPattern": ["哔哩哔哩", "爱奇艺", "腾讯视频", "优酷", "芒果TV"],
  "amountPattern": { "type": "monthly_fixed", "min": 9, "max": 15, "currency": "CNY", "cadence": "monthly" },
  "recognitionSignals": [
    "视频平台会员月扣 ≥15 元，且未启用学生认证",
    "学生认证入口通常在「我的-会员中心-学生专区」"
  ],
  "resolutionSteps": [
    "平台 App：我的→会员中心→学生专区→上传学信网/学生证完成认证",
    "认证通过后切换「学生连续包月」，普通价自动降为学生价",
    "毕业当年改回普通价或关闭自动续费，避免按普通价续扣"
  ],
  "legalBasis": [],
  "source": { "name": "哔哩哔哩会员中心学生专区公开规则", "url": "https://www.bilibili.com/", "type": "platform_rule" },
  "embeddingVersion": "bge-m3@v1",
  "riskLevel": "low",
  "tags": ["学生认证", "教育优惠", "影音会员"],
  "benefitTags": ["student_cert"],
  "audience": "student",
  "reviewedBy": "材料",
  "reviewStatus": "verified",
  "createdAt": "2026-11-01",
  "updatedAt": "2026-11-01"
}
```

> 学生权益批次（30 条）的 URL 与摘录句同样以人工核验时的实际链接为准写入 cases.json（§2.2 校验流程不变）。

### 2.2 案例生产计划（150+ 条）

**来源渠道（三类，全部可公开核验）：**

| 渠道 | 类型 | 具体来源 | 产出占比 |
|---|---|---|---|
| 消协案例 | consumer_association | 中消协年度投诉报告、中消协专项调查（自动续费/预付式消费）、地方消协典型案例 | 25% |
| 平台规则 | platform_rule | 微信支付「扣费服务」、支付宝「免密支付/自动扣款」、Apple 支持（订阅管理）、淘宝/京东价保规则、各平台未成年人退款通道 | 30% |
| 公开报道 | public_report | 央视/人民日报/新华社消费维权报道、黑猫投诉年度数据报告 | 30% |
| 法规条文 | official_law | 《消费者权益保护法》《消费者权益保护法实施条例》（2024-07-01 施行）、《网络交易监督管理办法》、《个人信息保护法》、《民法典》第 19/145 条 | 15% |

**AI 生成初稿 + 人工校验流程（固定节奏，每周三/六两批）：**

1. **选题**：按类别配额从渠道表挑来源（数据管线列清单，材料复核来源可用性）。
2. **AI 初稿**：DeepSeek-V3 批量生成，每批 5 条，prompt 模板：

```
你是消费维权案例编纂助手。根据以下来源材料，生成案例库条目（JSON 数组，严格按 schema）。
来源标题：{title}；来源链接：{url}；来源摘录：{excerpt}
要求：
1. recognitionSignals 必须是账单侧可观察信号（金额、周期、商户名模式），不是抽象描述；
2. resolutionSteps 必须是用户可执行步骤，含具体平台入口路径（如「微信→我→服务→钱包→支付设置→扣费服务」）；
3. legalBasis 只写可核验的现行有效法条；来源无法核实的内容一律不写；
4. 金额区间只写该场景的典型范围，不要夸大；
5. 输出前自查：每条信息都能在来源材料中找到对应原文。
```

3. **人工校验**（材料执行，每条 ≤10 分钟，checklist 打勾）：
   - [ ] 来源链接可访问，事实与原文一致（抽查摘录句）
   - [ ] 金额/规则与现行规定一致（法条对照 gov.cn 原文）
   - [ ] 处置步骤本人可按路径走通（平台入口至少点进第一层）
   - [ ] 无广告、无主观臆断、无贬损表述
   - [ ] 打分 riskLevel 合理
4. **入库**：通过 → `reviewStatus: "verified"`，写入 cases.json；不通过 → 退回 `draft` 或删除；每周记录 `cases/REVIEW_LOG.md`（校验人、通过/退回数）。

**数量里程碑（对齐 06 路线图；08 §⑤.2 扩容后总目标 150+ 条）：**

| 时间 | 目标 | 用途 |
|---|---|---|
| W2 末（10-25） | 首批 **30 条**（订阅陷阱 20 + 平台规则/法规 10） | 嵌入管线联调 |
| W3 末（11-01） | **60 条**（补维权/未成年人/预付） | RAG 最小版上线 + 金标评测 |
| W4 中（11-08） | **100+ 条**（补消费建议/大促/学生场景） | 最终评测数字 + 技术文档 |
| 11/8（G4 前一日）达标；11/9 随 G4 验收 | **150+ 条**，其中 `verified` ≥ 140 | 技术文档「案例库 150 条」证据 + F09 贴士卡 / F11 课堂数据源 |

**扩容批次表（08 §⑤.2；嵌入预计算批次同 §3 管线——bge-m3 离线、运行时零嵌入 API 红线不变；检索链路零改动——`student_benefits` 仅作为新的类别过滤值接入 §4 级联）：**

| 批次 | 内容 | 时点 | 服务功能 |
|---|---|---|---|
| 既有计划 | 7 类 100+ 条（W2:30 / W3:60 / W4:100+） | 不变 | RAG 主链路 + 金标评测 |
| 扩容-1 | `spending_advice` +10 条（预算方法/记账习惯） | W3D4-6 | F07 预算中心 / F08 快速记账演示 |
| 扩容-2 | `subscription_trap` +10 条（消协/黑猫平台新案源） | W3D6-W4D2 | F06 订阅管理墙 |
| 扩容-3 | `student_benefits` 30 条（AI 初稿 + 双人校验）= **T52a（省赛必做）** | W3D5-W4D3 | T52a 案例入库（F09 贴士卡 = T52b 条件行、F11 知识课堂另行排期） |

产能测算（以 06 §3.2/§3.3 与 §1.3.1 周表负载账本为唯一依据，本节不再单独自证可行）：AI 生成 30-40 条/小时，人工校验 20-30 条/小时，材料投入约 4-6 小时/周；扩容 50 条新增人工校验约 8 小时——**W3/W4 各 +4h 已写入 06 §3.2/§3.3 R3 行与 §1.3.1 负载表（0.5 人日/周，与 08 §11.2 负载表 R3 行同口径）**。批次任务与 06 任务注册表对齐：扩容-3 `student_benefits` 30 条 = **T52a（案例入库，省赛必做）**；贴士个性化任务 = **T52b（条件行·默认置灰）**，仅点亮时消费本批数据。

**首批 30 条清单示例（10 条，其余 20 条同模板在 W2 补齐）：**

| ID | 标题 | 类别 | 金额模式 | 来源（类型） |
|---|---|---|---|---|
| C001 | 视频平台连续包月自动续费（15-35元/月） | subscription_trap | monthly_fixed 15-35 | 黑猫投诉年度报告（public_report） |
| C002 | 网盘会员自动续费（18-30元/月或年费） | subscription_trap | monthly_fixed 18-30 | 黑猫投诉（public_report） |
| C003 | iOS App Store 订阅取消入口（6-68元/月） | platform_rule | monthly_fixed 6-68 | Apple 支持 HT202039（platform_rule） |
| C004 | 自动续费涨价未显著通知（消保条例第10条） | regulation | monthly_fixed 15-35 | 中国政府网（official_law） |
| C005 | 健身房预付年卡跑路（1000-5000元） | prepaid_risk | one_time 1000-5000 | 中消协预付式消费报告（consumer_association） |
| C006 | 未成年人游戏充值退款（数百-数万元） | minor_spending | one_time 200-50000 | 最高法典型案例+民法典19条（official_law） |
| C007 | 免费试用7天转全价扣款（0-1元→满价） | subscription_trap | trial_then_full 0-1→满价 | 微信支付扣费规则（platform_rule） |
| C008 | 直播打赏高频小额（6-2000元/次） | minor_spending | micro_recurring 6-2000/次 | 央视公开报道（public_report） |
| C009 | 小额连续扣费9.9/19.9元陌生代扣 | subscription_trap | micro_recurring 6.9-29.9 | 微信支付官方文档（platform_rule） |
| C010 | 知识付费网课退费纠纷（99-999元） | consumer_rights | one_time 99-999 | 消保法25/26条+黑猫投诉（official_law） |

> 上表 10 条在 W2 第一批生成并完成人工校验；URL 以人工核验时实际链接为准写入 cases.json。示例条目全文（C009）见 §2.1。

### 2.3 案例库质量与维护规范

- **宁缺毋滥**：宁可不写某条，不写无法核实的处置方案或金额数字；`reviewStatus != "verified"` 的条目不进入生产检索与评测。
- **变更流程**：修改案例 → 更新 `updatedAt` → 内容哈希变化 → 重算该条嵌入（§3.4 增量更新）→ 若影响金标命中关系，同步修订金标测试集并记录（§5.1）。
- **可追溯**：每次批次生成/校验在 `cases/REVIEW_LOG.md` 留痕（技术文档可引用该流程作为 RAG 数据治理证据）。

---

## 3. bge-m3 嵌入离线预计算管线

### 3.1 目标与硬约束

1. **运行时零嵌入 API 调用**：文档嵌入全部离线预计算进 repo；查询嵌入用本地推理（onnxruntime-node）；模型不可用降级 TF-IDF（§6）。任何路径不依赖 SiliconFlow/其他嵌入 API。
2. **确定性**：同一条案例内容 + 同一 embeddingVersion → 同一向量（评测可复跑）。
3. **可校验**：CI 自动检查 embeddings 与 cases 一致（数量/维度/版本/内容哈希），防止「改了案例忘了重算向量」的漂移。
4. **费用 ≈ 0**：一次性批量嵌入在免费额度内完成，或本地 CPU 完成（见 §14）。

### 3.2 文件布局（进 repo，公开仓库安全：全部为公开知识数据）

```
spendct/
├── data/cases/
│   ├── cases.json                     # 案例库全文（§2.1 schema）
│   ├── manifest.json                  # { version, count, embeddingVersion, casesSha256, updatedAt }
│   ├── embeddings.json                # { version, model, dim, normalized, generatedAt, entries: {C001:[1024个float]} }
│   ├── tfidf-manifest.json            # TF-IDF 预计算（词表/IDF/文档稀疏向量，§6.3）
│   ├── promo-calendar-2026.json       # 大促日历（§8.3）
│   ├── school-calendar-2026-2027.json # 校历（§8.1）
│   └── city-weather-id.json           # 城市→和风 LocationID 预置表（§8.2）
├── public/data/cases/                 # 浏览器端副本（Next.js public，静态托管）
│   ├── cases.json                     # 与 data/cases/cases.json 同步（构建脚本复制）
│   └── tfidf-manifest.json
├── tests/golden/                      # 07 §16 唯一路径
│   ├── rag-golden.json                # 20 条金标主集（§5.1）
│   ├── rag-golden-student.json        # 学生权益补充集 8 题（§5.6，修订案 A4）
│   ├── golden-query-embeddings.json   # 主集金标查询嵌入（离线预计算，评测零 API）
│   └── golden-query-embeddings-student.json  # 补充集查询嵌入（同管线同版本）
├── models/                            # 本地模型文件（gitignore，不入库）
│   ├── bge-m3-int8.onnx               # 查询嵌入用（约 600MB，或 q4 约 300MB）
│   └── bge-reranker-base-int8.onnx    # 重排用（约 110MB）
└── scripts/rag/
    ├── build-embeddings.mjs           # 核心：cases.json → embeddings.json
    ├── verify-embeddings.mjs          # CI：一致性校验
    ├── build-vocab.mjs                # TF-IDF 词表/IDF 预计算
    ├── build-golden-embeddings.mjs    # 金标查询嵌入预计算
    ├── eval-hit3.mjs                  # hit@3 评测（§5.2）
    ├── download-models.mjs            # 模型下载（支持 HF_ENDPOINT=hf-mirror.com 国内镜像）
    └── warmup-embedding.mjs           # 服务启动预热（§3.5）
```

### 3.3 脚本设计（代码骨架）

`scripts/rag/build-embeddings.mjs`（输入 JSON → 输出 embeddings.json 进 repo）：

```js
// 用法：node scripts/rag/build-embeddings.mjs [--provider local|siliconflow] [--only C001,C002]
import fs from "node:fs";
import crypto from "node:crypto";

const EMBEDDING_VERSION = "bge-m3@v1";   // 模型 BAAI/bge-m3 + L2 归一化 + 1024 维
const DIM = 1024;
const CASES_PATH = "data/cases/cases.json";
const OUT_PATH = "data/cases/embeddings.json";
const MANIFEST_PATH = "data/cases/manifest.json";
const CACHE_PATH = ".embedding-cache.json";  // gitignore：caseId → {contentSha256, vectorB64}

const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf8")).filter(c => c.reviewStatus === "verified");

// 1. 嵌入文本拼接（固定模板，改动模板 = 版本号 +1 并全量重算）
const docText = c =>
  [c.title, ...c.merchantPattern, ...c.recognitionSignals, ...c.resolutionSteps, ...c.tags].join(" ");

// 2. 增量判定：仅重算内容哈希变化或版本不匹配的条目
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
const todo = cases.filter(c => {
  const h = crypto.createHash("sha256").update(docText(c)).digest("hex").slice(0, 16);
  return !cache[c.id] || cache[c.id].version !== EMBEDDING_VERSION || cache[c.id].contentSha256 !== h;
});

// 3. 批量嵌入（一次性，本地 CPU 免费；siliconflow 档仅用于初版快速出向量，费用见 §14）
async function embedBatch(texts) {
  if (process.argv.includes("--provider=local")) {
    // onnxruntime-node 批量推理，详见 scripts/rag/download-models.mjs 加载模型
    return localEmbed(texts);           // → number[][]
  }
  // 默认：SiliconFlow BAAI/bge-m3（免费档），POST /v1/embeddings {model, input}
  return siliconflowEmbed(texts);       // → number[][]
}

// 4. L2 归一化 + 写回
const vectors = await embedBatch(todo.map(c => docText(c)));
for (let i = 0; i < todo.length; i++) {
  const v = normalize(vectors[i]);      // v / ||v||
  cache[todo[i].id] = { version: EMBEDDING_VERSION, contentSha256: sha256(docText(todo[i])), vectorB64: toB64(v) };
}
fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));

// 5. 输出 embeddings.json + manifest.json（cases 全量 sha256 用于 verify）
const entries = Object.fromEntries(cases.map(c => [c.id, fromB64(cache[c.id].vectorB64)]));
fs.writeFileSync(OUT_PATH, JSON.stringify({
  version: EMBEDDING_VERSION, model: "BAAI/bge-m3", dim: DIM, normalized: true,
  generatedAt: new Date().toISOString(), entries,
}));
fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
  version: 1, count: cases.length, embeddingVersion: EMBEDDING_VERSION,
  casesSha256: crypto.createHash("sha256").update(fs.readFileSync(CASES_PATH)).digest("hex"),
  updatedAt: new Date().toISOString(),
}));
```

`scripts/rag/verify-embeddings.mjs`（CI 每提交运行，失败阻断）：

```js
// 检查项（任一失败 exit 1）：
// 1. embeddings.json.version === manifest.json.embeddingVersion === 每条案例.embeddingVersion
// 2. entries 键集合与 cases.json 中 verified 条目一致；每条向量长度 === dim
// 3. 每个向量模长 | ||v|| - 1 | < 1e-4（L2 归一化成立）
// 4. manifest.casesSha256 === 当前 cases.json 的 sha256（内容变了未重算 → 阻断）
```

### 3.4 版本管理与增量更新

- **embeddingVersion 语义**：`bge-m3@v1` = 模型 + 嵌入文本拼接模板 + 归一化方式 + 维度的组合。上述任一项变化 → 版本号 +1 → **全量重算**（含金标查询嵌入 §5.2）。
- **增量更新**：只改案例内容（不改模板/模型）→ 仅重算内容哈希变化的条目（`--only` 参数或自动 diff），其余向量复用缓存。
- **三处版本交叉校验**（§2.1 注）+ CI 校验，保证「案例 → 向量」链路永远一致。
- **费用上界**：150+ 条 × 约 300 tokens/条 ≈ 50K tokens（08 §⑤.2 新增 50 条增量 ≈ ¥0.02 一次性），SiliconFlow bge-m3 免费档内一次跑完；本地 CPU（2.3GB 模型一次性下载）完全免费。

### 3.5 查询侧嵌入（运行时零嵌入 API 调用的关键）

```ts
// src/server/rag/embedder.ts —— AI 接入层进程内本地推理
import * as ort from "onnxruntime-node";

let session: ort.InferenceSession | null = null;
const MODEL_PATH = process.env.EMBEDDING_MODEL_PATH ?? "models/bge-m3-int8.onnx";

export async function embedQuery(text: string): Promise<Float32Array> {
  if (!session) {
    if (process.env.EMBEDDING_PROVIDER === "tfidf-only") {
      throw new EmbedderUnavailableError("EMBEDDING_PROVIDER=tfidf-only"); // 上层降级 §6
    }
    session = await ort.InferenceSession.create(MODEL_PATH);   // 懒加载，首次约 2-6s
  }
  // tokenize → run → last_hidden_state[CLS] → L2 归一化 → 1024 维 Float32Array
  // 提示：bge-m3 查询侧建议加指令前缀（见 §4.4）
}
```

- **预热**：容器启动时执行 `scripts/rag/warmup-embedding.mjs`（本地 `pnpm dev` 由 package.json `predev` 触发），把首次加载延迟移出用户路径；评测与演示前必跑。
- **模型获取**：`scripts/rag/download-models.mjs` 从 Hugging Face 下载 ONNX 量化模型，支持 `HF_ENDPOINT=https://hf-mirror.com`（国内网络）；部署镜像可选择 COPY 入镜像（体积换启动速度）。
- **降级**：加载失败/超内存 → 抛 `EmbedderUnavailableError` → §4.8 降级链切 TF-IDF；serverless 部署（Vercel 备选）→ `EMBEDDING_PROVIDER=tfidf-only`。
- **运行时加载文档向量**：首次检索时 `readFile(embeddings.json)` 解析为 `Float32Array[]`（150+ 条 × 1024 × 4B ≈ 620KB）缓存于 `globalThis`，之后零 IO、零 API。

---

## 4. 混合检索（级联）实现

### 4.1 级联流程与参数

```
用户问题（锚点追问文本 + 账单聚合上下文）
  │
  ▼
Stage 0  过滤参数抽取（LLM：SiliconFlow 免费小模型，轻任务归小模型 —— 三模型分工）
  │     输出 CaseFilter { categories, amountMin, amountMax }（zod 校验 → 修复 → 重试，03 文档闭环）
  ▼
Stage 1  SQL 元数据过滤（类别/金额区间）  候选 300 → 通常 20-80 条
  │     服务端：谓词参数化过滤（等价 SQL，见 §4.3）；浏览器：DuckDB-WASM 预编译 SQL + 参数绑定
  │     过滤后 <5 条 → 自动放宽：类别扩展同族 + 金额区间 ×3（RELAX_IF_LESS=5）
  ▼
Stage 2  dense 余弦召回 top-30（bge-m3，向量均已 L2 归一化 → 余弦 = 点积）
  │     失败 → TF-IDF 替代召回 top-20（§6，hit@3 兜底质量已评测）
  ▼
Stage 3  bge-reranker-base 重排 top-5（交叉编码器逐对打分）
  │     失败 → 跳过重排，用 dense 分数直接排序
  ▼
Stage 4  引用产出：rerank logits ≥ -2.0 且最多 3 条 → Citation[]；不足则宁缺毋滥（§4.6）
```

`student_benefits`（第 8 类，08 §⑤.1）作为新的类别过滤值接入本链路，级联顺序与全部参数零改动（08 §⑤.2 裁决）。

| 参数（env 可覆盖） | 值 | 说明 |
|---|---|---|
| `RAG_TOP_K_RECALL` | 30 | dense 召回数 |
| `RAG_TOP_K_CITE` | 3 | 单次答案最多引用案例数 |
| `RERANK_MIN_SCORE` | -2.0 | bge-reranker logits 引用阈值（宁缺毋滥，W3 用金标集校准） |
| `RELAX_IF_LESS` | 5 | Stage1 过滤后不足则放宽 |
| `TFIDF_FALLBACK_K` | 20 | TF-IDF 兜底召回数 |
| `AMOUNT_RANGE_COEF` | [0.2, 5] | 金额区间扩展系数（查询金额 a → [0.2a, 5a]） |
| 检索延迟预算（P95） | <900ms | Stage0 ≈300ms（小模型）+ Stage2 ≈2ms + Stage3 ≈150-400ms（30 对，CPU） |

### 4.2 Stage 0：过滤参数抽取（prompt 模板）

```
你是账单体检系统的检索意图解析器。从用户问题中抽取案例过滤参数，只输出 JSON，不要解释。
问题：{query}
当前账单上下文（聚合，无明细）：月总支出 {total} 元；涉及类别 {categories}；涉及金额参考 {amountRef} 元
输出格式：{"categories": string[], "amountMin": number|null, "amountMax": number|null}
规则：
1. categories 只能是 [subscription_trap, prepaid_risk, minor_spending, consumer_rights, platform_rule, regulation, spending_advice, student_benefits] 的子集（第 8 类定义见 §2.1），不确定时填空数组（不过滤）；
2. 金额单位为人民币元；只有问题明确涉及金额时才填区间，否则 null；
3. 问题说「几十块」→ [10, 99]；「几千」→ [1000, 9999]；「每月19块」→ [15, 25]（±30%）。
```

调用方（03 锚点追问编排层）用 SiliconFlow 免费 Qwen 小模型执行；输出经 zod（`CaseFilter`）校验，失败重试 1 次，仍失败 → 空 filter（不过滤，dense 语义兜底）。

### 4.3 Stage 1：SQL 元数据过滤

**服务端实现（谓词参数化，等价 SQL 语义；语料 300 条级，TS 谓词与 SQL 等价，不引入 DuckDB-node 依赖）：**

```sql
-- 语义等价展示（技术文档引用；实现为参数化谓词，禁止字符串拼接 —— 与 02 文档 SQL 沙箱同哲学）
SELECT id, title, category, amount_min, amount_max, cadence
FROM cases
WHERE (? = 0 OR category IN (?))              -- 类别过滤（可选）
  AND (? = 0 OR amount_min <= ?)              -- 金额区间重叠判定
  AND (? = 0 OR amount_max >= ?)
LIMIT 100;
```

```ts
// src/server/rag/filter.ts —— 实际实现
export function filterCases(pool: CaseRecord[], f: CaseFilter): CaseRecord[] {
  return pool.filter(c => {
    if (f.categories?.length && !f.categories.includes(c.category)) return false;
    if (f.amountMin != null && c.amountPattern.max < f.amountMin) return false; // 区间重叠判定
    if (f.amountMax != null && c.amountPattern.min > f.amountMax) return false;
    return true;
  });
}
```

**浏览器端实现（订阅雷达/个人化，真 SQL，DuckDB-WASM 预编译 + 参数绑定，对齐 02 沙箱规范）：**

```sql
-- 启动时预编译一次；运行时仅绑定参数，不做字符串拼接
-- cases 表在首次加载时由 public/data/cases/cases.json 导入 DuckDB-WASM
SELECT id, title, category FROM cases
WHERE (len(?) = 0 OR list_contains(?, category))
  AND (?::DOUBLE = 0 OR amount_max >= ?::DOUBLE)
  AND (?::DOUBLE = 0 OR amount_min <= ?::DOUBLE)
LIMIT 30;
```

**金额区间确定规则**（两处共用）：问题/上下文含金额 a → [0.2a, 5a]；连续扣费场景（订阅雷达）→ [0.5a, 1.5a] 且 cadence=monthly；无金额信息 → 不绑定金额条件（null 路径，金标 G03/G13/G15 覆盖）。

### 4.4 Stage 2：dense 余弦

- 文档向量：`embeddings.json`（离线预计算，§3）；查询向量：`embedQuery()`（§3.5）。
- 查询文本构造：`query + 账单上下文关键句`（如「连续3个月被扣19.9元，商户名含“代扣”」）；bge-m3 查询侧加指令前缀 `"为这个句子生成表示以用于检索相关文章："`。
- 相似度 = 点积（两侧均已 L2 归一化）；top-30 进入 Stage 3。
- 检索文本按「数据不可信」对待：不写入最终答案生成以外的任何持久化，不参与系统提示声明（02 提示注入三层防护扩展，接口已登记 §0.3）。

### 4.5 Stage 3：bge-reranker-base 重排

```ts
// src/server/rag/rerank.ts
// 模型：BAAI/bge-reranker-base ONNX int8（约 110MB，onnxruntime-node 本地推理）
// 输入：(query, docText) 对，docText = title + recognitionSignals 前2条 + resolutionSteps 前2条（截断 512 tokens）
// 输出：logits（越大越相关）；30 对一次 batch 推理，CPU 约 150-400ms
// 失败（模型缺失/内存不足）→ 抛 RerankerUnavailableError → 上层跳过重排（§4.8）
```

### 4.6 Stage 4：引用产出与宁缺毋滥

- rerank logits ≥ `RERANK_MIN_SCORE`（-2.0）的案例才可引用，最多 3 条；低于阈值 → 输出「未找到足够相关的案例引用」，洞察卡显示降级态（05 文档空态规范），不硬凑引用。
- 引用格式约定：LLM 在答案中输出 `[C009]` 式引用标记；编排层后处理用正则抽取 → **引用白名单校验**（引用 ID 必须在本轮检索结果内）→ 不合规：丢弃该引用并降置信度一档，重试 1 次（§5.3）。引用落库为 07 §4 的 `rag:${caseId}` ref 格式（如 `rag:C009`）。
- `Citation` 对象由检索层产出（id/label/source/url/snippet/score 全字段），LLM 只选择不编造——引用元数据不依赖模型生成文本，从根上防「幻觉引用」。

### 4.7 检索服务代码骨架（服务端）

```ts
// src/server/rag/retrieve.ts
import { loadCasePool, filterCases } from "./case-store";   // globalThis 缓存
import { embedQuery, EmbedderUnavailableError } from "./embedder";
import { rerank, RerankerUnavailableError } from "./rerank";
import { tfidfSearch } from "@/lib/rag/tfidf";               // §6，纯 TS，两端共用

export async function retrieveCases(
  query: string, filter: CaseFilter, opts?: { topK?: number }
): Promise<RetrievedCase[]> {
  const topK = opts?.topK ?? RAG_TOP_K_CITE;
  const pool = loadCasePool();                                 // 全部 verified 案例
  let candidates = filterCases(pool, filter);                  // Stage1
  if (candidates.length < RELAX_IF_LESS) candidates = filterCases(pool, relaxFilter(filter));
  try {
    const qv = await embedQuery(query);                        // Stage2 dense
    const scored = candidates.map(c => ({ c, score: dot(qv, embeddings[c.id]) }));
    candidates = scored.sort((a, b) => b.score - a.score).slice(0, RAG_TOP_K_RECALL).map(x => x.c);
  } catch (e) {
    if (!(e instanceof EmbedderUnavailableError)) throw e;
    candidates = tfidfSearch(query, candidates).slice(0, TFIDF_FALLBACK_K); // §6 兜底
  }
  try {
    const ranked = await rerank(query, candidates);            // Stage3
    return ranked.filter(r => r.score >= RERANK_MIN_SCORE).slice(0, topK).map(toRetrieved);
  } catch (e) {
    if (!(e instanceof RerankerUnavailableError)) throw e;
    return candidates.slice(0, topK).map(c => toRetrieved(c, "dense"));     // 跳过重排
  }
}
```

### 4.8 RAG 侧降级链矩阵

| 故障 | 检测 | 行为 | 对用户可见 |
|---|---|---|---|
| 嵌入模型文件缺失/加载失败 | `EmbedderUnavailableError` | TF-IDF 替代 dense | 徽章「轻量检索模式」（可选） |
| reranker 失败 | `RerankerUnavailableError` | dense 分数直接排序 | 无感知 |
| Stage1 过滤后候选 <5 | 计数 | 自动放宽（同族类别+金额×3） | 无感知 |
| 全部候选 <3 且分低 | 阈值 | 「未找到足够相关的案例引用」 | 引用区空态（05 规范） |
| 金标未覆盖的未知场景 | — | 照常检索，宁缺毋滥 | 正常 |

---

## 5. 评测体系：金标 20 条 + hit@3 + 引用准确率

### 5.1 金标测试集（主集 20 条全列表；学生权益补充集见 §5.6）

制定流程：数据管线 + 材料双人独立出题 → 合并去重 → 金标案例必须在 cases.json 中 `reviewStatus=verified` → 写入 `tests/golden/rag-golden.json`（07 §16 唯一路径）。设计覆盖（07 §16 唯一口径：订阅 8 / 习惯 4 / 异常 4 / 个人化 2 / 学生 2）：订阅 8（G01–G08）「习惯」4（G13–G16 消费建议类）「异常」4（G09–G12 维权/异常支出类）个人化 2（G17–G18）学生 2（G19–G20）；金额过滤与 null 路径、口语/书面表述变体。

| GID | 金标 query | 金标案例 | 类别过滤 | 金额区间 | 难度 | 说明 |
|---|---|---|---|---|---|---|
| G01 | 连续三个月被扣了19块，这是什么东西在扣我钱？ | C009, C001 | subscription_trap | [10,30] | M | 口语、金额优先表述 |
| G02 | 免费试用7天之后自动扣了全款，能退吗？ | C007 | subscription_trap | [0,200] | E | 试用转付费 |
| G03 | iPhone 上的订阅在哪里取消，一直找不到入口 | C003 | platform_rule | null | E | 无金额（null 过滤路径） |
| G04 | 网盘会员扣费之前根本没提醒我，这个合法吗？ | C002, C004 | subscription_trap+regulation | null | H | 双类别、双金标 |
| G05 | 健身房办的年卡还没用完店就关门了，钱能要回来吗？ | C005 | prepaid_risk | [1000,5000] | E | 预付跑路 |
| G06 | 儿子拿我手机在游戏里充了好几千，能退吗？ | C006 | minor_spending | [500,50000] | M | 未成年人退款 |
| G07 | 每月9块9连续扣了半年今天才发现 | C009 | subscription_trap | [5,15] | E | 与 G01 同案例不同表述（召回鲁棒性） |
| G08 | 自动续费涨价了，之前没通知我，扣的还是新价格 | C004, C001 | subscription_trap | [15,50] | H | 涨价场景 |
| G09 | 买了个网课听了两节不想上了，商家说虚拟商品不给退 | C010 | consumer_rights | [99,999] | M | 知识付费退费 |
| G10 | 共享单车的押金到现在都没退回来 | C011 | prepaid_risk | [99,299] | E | 押金（C011 为 W3 批次案例） |
| G11 | 看直播刷礼物刷上头了，一共打赏了两千多 | C008 | minor_spending | [500,5000] | M | 直播打赏 |
| G12 | 抽盲盒抽了五千块全是重复的，能投诉吗 | C013 | consumer_rights | null | H | 盲盒（C013 为 W3 批次案例） |
| G13 | 每个月外卖怎么花了这么多，怎么控制？ | C020 | spending_advice | null | E | 无金额（null 过滤路径） |
| G14 | 开学季买电脑平板有什么坑和优惠？ | C018, C016 | spending_advice | null | M | 与校历/大促工具联动场景 |
| G15 | 双11买东西真的划算吗，会不会先涨后降？ | C017 | spending_advice | null | M | 大促比价 |
| G16 | 奶茶咖啡这种每天二三十的小钱，一年下来吓人 | C019 | spending_advice | [20,30] | E | 拿铁因子 |
| G17 | 这个月餐饮比上个月多花了一倍，看看以前有没有类似情况 | 个人历史事件 PH-001 | spending_advice | null | M | 个人化 RAG（金标=固定历史夹具中应命中事件） |
| G18 | 上个月那个连续扣费的异常最后解决了吗？ | 个人历史事件 PH-002 | subscription_trap | null | E | 个人化 RAG |
| G19 | 考试周总是不小心开各种会员和外卖会员，怎么防？ | C022, C001 | subscription_trap | null | M | 学生场景，与校历工具联动 |
| G20 | 分期买手机每个月还三百，划算吗？ | C012 | consumer_rights | [300,600] | M | 分期陷阱（C012 为 W3 批次案例） |

> C011–C022 为 W3 批次规划 ID（§2.2 生产计划），评测脚本对「金标 ID 不在当前库」的条目自动标记 `pending` 并计入未达标，直到案例入库——保证 100 条库完成后评测数字才可对外写入技术文档。

### 5.2 hit@3 评测脚本（零 API、可进 CI）

`scripts/rag/build-golden-embeddings.mjs`：对 20 条金标主集 query 离线预计算 bge-m3 向量（与文档同管线、同版本），写 `tests/golden/golden-query-embeddings.json`；对 `student-golden-8` 补充集 8 题同批预计算，写 `tests/golden/golden-query-embeddings-student.json`——评测全程零网络。

`scripts/rag/eval-hit3.mjs`：

```js
// 用法：node scripts/rag/eval-hit3.mjs [--mode full|dense-only|tfidf] [--set main|student|all]
// 输出：终端表格 + tests/golden/results.json（主集）+ results-student.json（补充集）
// 主集断言（唯一 CI 门槛，07 §16 三档阈值不变）：hit@3 < 18/20 时 exit 1
// 补充集断言（修订案 A4，独立于主集、互不掺和）：student-golden-8 hit@3 < 7/8 时 exit 1；
//   student_benefits 批次（W3D5-W4D3）入库前，金标 ID 不在库的条目标记 pending 并计入未达标
// 1. 读 cases.json（verified）、embeddings.json、tests/golden/rag-golden.json、tests/golden/golden-query-embeddings.json
// 2. 对每条 query：Stage1 过滤（用金标自带 filter）→ Stage2 dense top-30 → Stage3 rerank top-3
//    --mode dense-only 跳过重排（评估 reranker 增益，写进技术文档图表）
//    --mode tfidf 用 TF-IDF 替代 dense（兜底质量门槛 hit@3 ≥ 12/20）
// 3. 指标：hit@1 / hit@3（top-k 中出现任一金标案例即命中）/ MRR / 逐条明细表
//    G17/G18 走个人化检索夹具（tests/golden/personal-history-fixture.json，40 条固定模拟异常事件）
// 4. 断言：主集 hit@3 ≥ 18/20，否则 exit 1；补充集（--set student|all）hit@3 ≥ 7/8，否则 exit 1（独立断言，修订案 A4）
```

### 5.3 引用准确率指标（评测数字写入技术文档）

**三个指标：**

| 指标 | 定义 | 目标 |
|---|---|---|
| hit@3 | 20 金标中检索 top-3 含金标案例的比例（检索质量） | ≥ 90%（≥18/20） |
| 引用忠实度（Citation Precision） | 答案中每条引用逐条核验「引用案例内容是否支持其支撑的句子」的通过率（生成质量） | ≥ 95% |
| 引用覆盖（Citation Recall） | 金标期望引用中被答案实际引用的比例 | ≥ 70% |

**结构性保证（引用白名单后处理）**：答案中 `[C009]` 式引用经正则抽取后必须存在于本轮检索结果，否则丢弃该引用、洞察卡置信度降一档并重试 1 次——引用元数据来自检索层而非模型生成（§4.6），从结构上消灭幻觉引用。

**评测流程（W4 固定评测日，约 2 小时）**：
1. 跑 `eval-hit3.mjs --mode full`（主集 + 补充集），分别记录检索层数字（补充集独立报告，不掺入主集数字）；
2. 20 条金标 query 走完整生成链路（DeepSeek-V3 + 检索注入），收集全部引用样本（预计 ≤60 条）；
3. 双人盲评：材料与数据管线各自独立判定每条引用「支撑/不支撑」，不一致由第三人仲裁；
4. 数字写入 §5.4 模板 → 交材料用于技术文档（06 文档 §4/§6 位置，口径以本脚本输出为准）。

### 5.4 写入技术文档的表格模板

| 指标 | 定义 | 目标 | 实测（W4D4） | 评测方法 |
|---|---|---|---|---|
| RAG hit@3 | 检索 top-3 命中金标案例比例 | ≥90% | ____ | 20 条金标 + 离线脚本 |
| 引用忠实度 | 引用支撑结论的逐条人工核验通过率 | ≥95% | ____ | 双人盲评 + 仲裁 |
| 引用覆盖 | 期望引用被实际引用比例 | ≥70% | ____ | 同上 |
| 检索延迟 P95 | 服务端级联端到端 | <900ms | ____ | 金标 20 条 × 5 次计时 |
| TF-IDF 兜底 hit@3 | dense 不可用时 | ≥60%（12/20） | ____ | eval --mode tfidf |
| 学生权益补充集 hit@3（student-golden-8） | 补充集 top-3 命中金标案例比例 | ≥87.5%（≥7/8） | ____ | 8 条补充金标 + 离线脚本（修订案 A4，独立报告） |
| 降级可用性 | 断网/模型缺失时检索仍可用 | 100% | ____ | §11.3 用例全过 |

### 5.5 CI 集成

```yaml
# .github/workflows/rag.yml（W3 起启用）
# on: [push, pull_request]
# jobs:
#   verify:   pnpm run rag:verify        # 嵌入一致性（§3.3）
#   eval:     pnpm run rag:eval          # 主集 hit@3 ≥ 18/20 否则阻断（唯一 CI 门槛）
#   tfidf:    pnpm run rag:eval -- --mode tfidf   # 兜底门槛 ≥ 12/20
#   student:  pnpm run rag:eval -- --set student  # 补充集 ≥7/8 独立断言（修订案 A4）
```

### 5.6 学生权益补充评测集 `student-golden-8`（修订案 A4）

- **口径裁决（08 §⑤.3）**：金标主集 20 题与既有三档阈值（CI ≥18/20、G3 ≥16/20、TF-IDF ≥12/20）保持为**唯一 CI 门槛，原样不动**——扩容不得污染既有评测数字口径；补充集独立评测、独立报告，技术文档写法固定为「主集 20 题 hit@3=X、学生权益补充集 8 题 hit@3=Y」。
- **数据集**：`tests/golden/rag-golden-student.json`（8 题），覆盖学生权益典型问法（学生认证会员开通与比价、教育优惠购买时机、校园卡充值、低价替代订阅、毕业前取消续费、权益被拒后的维权路径等）；金标案例必须为 `student_benefits` 类且 `reviewStatus=verified`，制定流程与主集相同（数据管线 + 材料双人独立出题 → 合并去重，§5.1）。
- **阈值**：hit@3 **≥7/8**（87.5%）。CI 中与主集**分开断言、互不掺和**（§5.5 `--set student`）；`student_benefits` 批次（W3D5-W4D3，§2.2 扩容-3）入库前，金标 ID 不在库的条目自动标记 `pending` 并计入未达标（与主集同机制），批次入库后断言自动生效。
- **查询嵌入**：`tests/golden/golden-query-embeddings-student.json`，与文档嵌入同管线同版本离线预计算（§3.2），评测零 API 红线不变。
- **F11 /learn 浏览搜索**复用浏览器 TF-IDF 索引（§6），不新增评测维度（08 §⑤.3）。

---

## 6. TF-IDF 本地兜底（纯 TS 轻量实现）

### 6.1 定位（三层用途）

1. **服务端 dense 兜底**：嵌入模型不可用（serverless/内存不足）时替代召回（§4.8）；
2. **浏览器端主力**：订阅雷达引用检索 + 个人化 RAG 语义排序（§1 检索模式 A）——零网络、零模型下载；
3. **完全离线模式**：断网时订阅雷达引用照常产出（演示稳定性）。

### 6.2 实现要点

- **分词（无 jieba 依赖，纯 TS）**：
  1. 领域词表最长匹配优先（词表由 `scripts/rag/build-vocab.mjs` 从案例库 + 金标 query 生成，取 df≥2 的词，如「自动续费」「连续包月」「退款」）；
  2. 剩余文本按字符 bigram 补位（中文无空格场景的关键）；
  3. 金额/数字：连续数字保留原值 token，同时追加归一 token `NUM`（保证「19块」与「19.9元」可匹配）；
  4. 全角→半角、大小写归一、标点剔除。
- **IDF 预计算**：`tfidf-manifest.json` = { vocab: string[], idf: number[], docs: { C001: { idx: number[], tf: number[] } } }，随案例库构建生成（§3.2），运行时零训练。
- **打分**：query 向量与文档向量稀疏内积（cosine，向量已归一）；W3 评测对比 BM25（k1=1.5, b=0.75）取优（`eval --mode tfidf` 支持两种打分切换）。
- **性能**：300 文档 × 约 3K 词表稀疏向量内积 <5ms（浏览器/Node 通用）；代码 <150 行零依赖，同一文件两端复用（`src/lib/rag/tfidf.ts`）。

### 6.3 代码骨架

```ts
// src/lib/rag/tfidf.ts —— 浏览器与 Node 共用（零依赖）
import tfidfManifest from "@/data/tfidf-manifest.json";

export interface SparseVec { idx: number[]; val: number[]; }

export function tokenize(text: string): string[] {
  // ① 归一 ② 领域词表最长匹配 ③ 字符 bigram 补位 ④ 数字 token + NUM
}

export function toSparse(tokens: string[]): SparseVec {
  // tf 统计 → idf 加权 → L2 归一化（查询侧同处理）
}

export function cosine(a: SparseVec, b: SparseVec): number {
  // 双指针内积；两端均已归一化 → 值域 [-1,1]
}

export function tfidfSearch(query: string, pool: CaseRecord[], topK = 20): CaseRecord[] {
  const q = toSparse(tokenize(query));
  return pool
    .map(c => ({ c, s: cosine(q, tfidfManifest.docs[c.id]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map(x => x.c);
}
```

---

## 7. 用户历史账单个人化 RAG

### 7.1 场景与目标

- 体检时发现新异常 → 检索「自己往月同类异常」→ 洞察卡附「本月与 2026-07 的同类异常对比」（纵向趋势、是否复发）。
- 锚点追问「这个月怎么又花这么多？和上个月比」→ 命中历史异常事件作为引用。
- **硬约束**：历史数据全程浏览器内，零上传（02 文档隐私架构；这也是个人化 RAG 只能用浏览器端轻量方案的原因）。

### 7.2 数据存储（浏览器内）

体检完成后由 03 流水线将异常事件摘要落库（浏览器）：

```sql
-- DuckDB-WASM 表 anomalies（与账单表同库；小表，可另存 localStorage JSON 兜底）
CREATE TABLE IF NOT EXISTS anomalies (
  id VARCHAR PRIMARY KEY,           -- "PH-202607-001"
  type VARCHAR,                     -- 同 03 异常类型枚举：recurring_charge/spike/refund_risk/...
  category VARCHAR,                 -- 12 类枚举（07 §3：餐饮/交通/购物/娱乐/居住/通讯/医疗/教育/人情/金融/订阅/其他）
  merchant VARCHAR,                 -- 商户名（浏览器内明文，02 对照表浏览器列可见；列名与 transactions 一致，07 §3）
  amount_cents BIGINT,              -- 该异常期金额（分，07 §3 全项目唯一金额单位）
  period_start DATE, period_end DATE,
  title VARCHAR,                    -- ≤30 字
  summary VARCHAR,                  -- ≤200 字（检索文本）
  card_id VARCHAR,                  -- 关联洞察卡 id（引用可跳转）
  created_at TIMESTAMP
);
```

### 7.3 检索实现（触发：每条新异常生成时 + 锚点追问提及历史时）

1. **结构化召回（DuckDB-WASM 参数化 SQL，真 SQL）**：

```sql
-- 预编译 + 参数绑定（02 沙箱规范）
SELECT id, type, category, merchant, amount_cents, period_start, period_end, title, summary, card_id
FROM anomalies
WHERE period_start < ?::DATE                                -- 排除本期
  AND (category = ? OR merchant = ?)                        -- 同类别或同商户
  AND amount_cents BETWEEN ?::DOUBLE * 0.5 AND ?::DOUBLE * 2.0  -- 金额比 0.5–2.0（分）
ORDER BY period_start DESC LIMIT 20;
```

2. **语义排序（TF-IDF，§6 同代码）**：query = 新异常 summary；候选 = 结构化召回集（不足则全表）；相似度 ≥0.35 或「同商户+同类别」强匹配 → 判为同类异常。
3. **阈值哲学**：都不满足 → 不输出个人化上下文（宁缺毋滥，避免硬凑「与上月相似」）。

### 7.4 输出契约与隐私边界

```ts
// 03 文档 InsightCard JSON 扩展字段（本域定义，05 渲染「我的往月记录」引用）
export interface PersonalContext {
  matched: Array<{
    anomalyId: string;      // "PH-202607-001"
    period: string;         // "2026-07"
    title: string;
    similarity: number;     // TF-IDF 余弦
    why: "same_merchant" | "same_category" | "amount_close";
  }>;
}
// Citation.kind = "personal"（§1.3），ref = `personal:${anomalyId}`（07 §4 ref 规范），点击跳转历史洞察卡
```

**02 文档可见性对照表新增行（本域贡献）**：个人历史异常事件（含商户名明文）仅存在于浏览器 DuckDB-WASM；检索在浏览器内完成；服务端/LLM 只接收检索结论文本（如「去年 7 月同类异常」），不接收事件表。

---

## 8. MCP 四工具规格

### 8.0 架构总览

```
浏览器 ──(每次锚点追问请求体携带)──▶ POST /api/followup（含 sessionSchema 聚合级 schema+统计快照，per-request）
   │                                                        │
   │ 锚点问题 + 聚合上下文                                    ▼
   ▼                                              AI 接入层注入快照为工具参数（服务端零存储）
Next.js AI 接入层 ── AI SDK MCP client（Streamable HTTP）──▶ MCP server（Railway/Render 免费容器）
   │                                                         ├ get_school_calendar     静态 JSON（repo）
   │                                                         ├ get_weather             和风天气免费档（key=env）
   │                                                         ├ get_promo_calendar      静态 JSON（repo）
   │                                                         └ query_bill_db_metadata  协议演示（快照随工具参数传入）
   ▼
DeepSeek-V3（流式 + Tool Calling；工具按需调用，无天气语义不调天气工具）
```

四个工具统一遵循 §8.5 公共约定（输出信封/超时/缓存/归因元数据）。工具 description 即 LLM 可见的「使用说明书」，写得越具体，模型误用越少——下面每个工具的 description 全文即最终实现文案。

### 8.1 工具一：`get_school_calendar` 校历工具

| 项 | 内容 |
|---|---|
| 名称 | `get_school_calendar` |
| 描述（LLM 可见） | 查询 2026-2027 学年校历事件（考试周/寒暑假/开学季/毕业季）。用于回答「考试周什么时候」「寒假几号开始」「开学季」等时间类问题，以及解释消费波动的季节原因。 |
| 输入 schema（zod） | `{ types?: z.array(z.enum(["exam_week","vacation","term_start","graduation"])).optional(), from?: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to?: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }`（from/to 缺省 = 今天起 60 天） |
| 输出 schema（TS） | `{ academicYear: "2026-2027"; events: Array<{ id, name, type, startDate, endDate, region, note, source }> }` |
| 数据来源 | 自建 `data/cases/school-calendar-2026-2027.json`（基于教育部节假日安排通知 + 10 所高校公开校历人工汇编，标注汇编口径，不虚构精确到校的日期） |
| 实现要点 | 读 JSON → 按 type/日期过滤 → 按 startDate 排序返回；纯静态零外部依赖；文件改动走 §2.3 变更流程 |

JSON 结构：

```json
{
  "version": "2026.10",
  "academicYear": "2026-2027",
  "source": "教育部2026年节假日安排 + 公开高校校历汇编（清华/北大/浙大/复旦等10校，取多数区间）",
  "events": [
    { "id": "SC-2026-11", "name": "期中考试周", "type": "exam_week", "startDate": "2026-11-02", "endDate": "2026-11-13", "region": "nationwide", "note": "多数高校第9-10周", "source": "10校校历汇编" },
    { "id": "SC-2027-01", "name": "期末考试周", "type": "exam_week", "startDate": "2027-01-11", "endDate": "2027-01-22", "region": "nationwide", "note": "寒假前1-2周", "source": "10校校历汇编" },
    { "id": "SC-2027-winter", "name": "寒假", "type": "vacation", "startDate": "2027-01-23", "endDate": "2027-02-28", "region": "nationwide", "note": "含春节 2027-02-06", "source": "教育部节假日安排" },
    { "id": "SC-2027-spring", "name": "春季开学", "type": "term_start", "startDate": "2027-03-01", "endDate": "2027-03-07", "region": "nationwide", "note": "", "source": "10校校历汇编" },
    { "id": "SC-2027-summer", "name": "暑假", "type": "vacation", "startDate": "2027-07-12", "endDate": "2027-08-29", "region": "nationwide", "note": "", "source": "10校校历汇编" },
    { "id": "SC-2027-autumn", "name": "秋季开学", "type": "term_start", "startDate": "2027-08-30", "endDate": "2027-09-05", "region": "nationwide", "note": "", "source": "10校校历汇编" },
    { "id": "SC-2027-grad", "name": "毕业季", "type": "graduation", "startDate": "2027-06-01", "endDate": "2027-06-30", "region": "nationwide", "note": "答辩/聚餐/租房消费高峰", "source": "10校校历汇编" }
  ]
}
```

**产品联动**（03 文档消费）：「开学季置装/数码支出环比上升 300%」的归因分析 = 校历工具 + 大促日历 + 个人消费画像三者联合解释；「考试周订阅提醒」洞察卡 = 校历事件 + 订阅雷达命中。

### 8.2 工具二：`get_weather` 和风天气

| 项 | 内容 |
|---|---|
| 名称 | `get_weather` |
| 描述（LLM 可见） | 查询指定城市当前天气与 3 天预报。用于回答「今天出门要不要带伞」「周末天气」等问题；只在用户问题明确涉及天气时才调用。 |
| 输入 schema（zod） | `{ city: z.string(), days: z.number().int().min(1).max(3).default(1) }`（city 为中文城市名，如「北京」；不支持的城市返回 ok:false invalid_input） |
| 输出 schema（TS） | `{ city, updatedAt, now?: { temp, feelsLike, text, windDir, windScale, humidity }, daily?: Array<{ fxDate, tempMax, tempMin, textDay, textNight }> }` |
| 数据来源 | 和风天气 API 免费档：注册 qweather.com → 控制台 → 免费订阅（**1000 次/天**，超出返回 402）；接口 `GET https://devapi.qweather.com/v7/weather/now` 与 `/v7/weather/3d`（key 参数仅存服务端 env `QWEATHER_API_KEY`，不返前端） |
| 实现要点 | ① 服务端代理，前端永远不接触 key；② 城市名 → LocationID 用预置表 `data/cases/city-weather-id.json`（北京 101010100 / 上海 101020100 / 广州 101280101 / 深圳 101280601 / 杭州 101210101 / 武汉 101200101 / 成都 101270101 / 西安 101110101，覆盖演示城市），省一次 GeoAPI 请求；③ 字段白名单透传（只取上表字段，不转发 raw）；④ 缓存 `Map<cityId+日期, {payload, at}>` TTL 30 分钟（服务端进程内短期缓存，不落盘；与 07 §10「无服务端数据缓存」不冲突——此缓存仅限第三方天气响应，不含任何用户数据）；⑤ 401/402/429 → 指数退避 1s/2s/4s 重试 → 仍失败返回 ok:false（§8.5），Agent 跳过继续 |

### 8.3 工具三：`get_promo_calendar` 大促日历

| 项 | 内容 |
|---|---|
| 名称 | `get_promo_calendar` |
| 描述（LLM 可见） | 查询 2026-2027 电商大促日历（双11/618/双12/开学季/年货节等）。用于回答「双11什么时候开始」「现在买还是等618」「开学季有什么优惠」；回答促销时机问题时优先调用。 |
| 输入 schema（zod） | `{ from?: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to?: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), categories?: z.array(z.string()).optional() }`（from 缺省 = 今天，to 缺省 = 今天+45 天） |
| 输出 schema（TS） | `{ promos: Array<{ id, name, type: "preheat"|"peak"|"aftermath", startDate, endDate, peakDate, categories: string[], typicalDiscount, audience, tips: string[] }> }` |
| 数据来源 | 自建 `data/cases/promo-calendar-2026.json`（依据各平台历年节奏人工汇编，标注「典型节奏，具体以平台公告为准」） |
| 实现要点 | 读 JSON → 日期窗口/品类过滤 → 按 startDate 排序；纯静态零外部依赖 |

JSON 结构（节选）：

```json
{
  "version": "2026.10",
  "note": "基于历年平台节奏汇编，具体以平台公告为准",
  "promos": [
    { "id": "PROMO-1111", "name": "双11", "type": "preheat", "startDate": "2026-10-20", "endDate": "2026-11-10", "peakDate": "2026-11-11", "categories": ["全品类"], "typicalDiscount": "跨店满300减50类 + 平台券", "audience": "通用", "tips": ["预热期价格通常与峰值持平，可提前下单", "大件留意价保（价保期 7-15 天）", "预售定金一般不可退，下单前确认"] },
    { "id": "PROMO-1111-2", "name": "双11返场", "type": "aftermath", "startDate": "2026-11-12", "endDate": "2026-11-15", "peakDate": "2026-11-12", "categories": ["全品类"], "typicalDiscount": "延续峰值价", "audience": "通用", "tips": [] },
    { "id": "PROMO-618", "name": "618", "type": "peak", "startDate": "2026-05-24", "endDate": "2026-06-20", "peakDate": "2026-06-18", "categories": ["数码", "家电", "全品类"], "typicalDiscount": "满减 + 大牌直降", "audience": "通用", "tips": ["数码类年度低点，适合大件"] },
    { "id": "PROMO-1212", "name": "双12", "type": "peak", "startDate": "2026-12-01", "endDate": "2026-12-12", "peakDate": "2026-12-12", "categories": ["全品类"], "typicalDiscount": "力度弱于双11", "audience": "通用", "tips": [] },
    { "id": "PROMO-school", "name": "开学季", "type": "peak", "startDate": "2026-08-20", "endDate": "2026-09-10", "peakDate": "2026-09-01", "categories": ["数码", "文具", "服饰"], "typicalDiscount": "教育优惠（学生认证）+ 满减", "audience": "学生", "tips": ["苹果/华为等教育优惠需学生认证", "与校历开学周联动：开学后 1-2 周价格回落"] },
    { "id": "PROMO-newyear", "name": "年货节", "type": "peak", "startDate": "2027-01-15", "endDate": "2027-02-05", "peakDate": "2027-01-27", "categories": ["食品", "服饰", "礼品"], "typicalDiscount": "满减 + 红包", "audience": "通用", "tips": [] }
  ]
}
```

### 8.4 工具四：`query_bill_db_metadata` DuckDB 元数据工具

| 项 | 内容 |
|---|---|
| 名称 | `query_bill_db_metadata`（**MCP 协议演示工具**，07 §18：#54 两处暴露、注明用途；浏览器端真实路径 = `duckdb_meta` 直读 DuckDB-WASM） |
| 描述（LLM 可见） | 返回当前用户账单表（DuckDB-WASM）的 schema 与列统计（行数/去重数/最小值/最大值/均值）。在需要写 SQL 查询账单数据前调用，以确认列名、类型与取值范围；本工具只返回聚合元数据，不返回任何交易明细。 |
| 输入 schema（zod） | `{ table?: z.enum(["transactions","merchants"]).default("transactions"), sessionSchema?: z.record(z.string(), z.unknown()).optional(), includeStats?: z.boolean().default(true) }`（表枚举 07 §3：bills→transactions，#29） |
| 输出 schema（TS） | `{ table, rowCount, datasetTxHash, schema: Array<{ column, type, nullable, description }>, stats?: Array<{ column, count, distinct, min, max, avg? }> }` |
| 数据来源 | **per-request 快照（无服务端存储）**：浏览器随每次锚点追问请求体 `POST /api/followup` 的 `sessionSchema` 字段提交 `{ table, schema, stats, rowCount, datasetTxHash }`（只含列名/类型/统计，**无任何明细行、无商户明文清单**）；AI 接入层调用本工具时注入为工具参数（07 §13/§18，#54） |
| 实现要点 | ① 快照随请求传递，服务端不落盘、不写日志、无 TTL；② 快照 zod 校验（列统计必须是数值聚合，拒绝明细数组）；③ 输出被 LLM 消费，按 02 文档「数据不可信」声明处理；④ 备选实现（也用于砍法 L1，§10）：退为原生 AI SDK 工具，客户端读 DuckDB-WASM `DESCRIBE`/`SUMMARIZE` 后直接返回，schema 不变 |

输出示例：

```json
{
  "table": "transactions",
  "rowCount": 8321,
  "datasetTxHash": "a3f2c1…",
  "schema": [
    { "column": "ts", "type": "TIMESTAMP", "nullable": false, "description": "交易时间" },
    { "column": "merchant", "type": "VARCHAR", "nullable": false, "description": "商户名（仅存浏览器 DuckDB）" },
    { "column": "amount_cents", "type": "BIGINT", "nullable": false, "description": "金额（分，全项目唯一金额单位）" },
    { "column": "category", "type": "VARCHAR", "nullable": true, "description": "消费类别（清洗阶段映射，12 类）" }
  ],
  "stats": [
    { "column": "amount_cents", "count": 8321, "distinct": 1234, "min": 1, "max": 599900, "avg": 4270 },
    { "column": "ts", "count": 8321, "distinct": 8120, "min": "2026-01-01", "max": "2026-10-13", "avg": null }
  ]
}
```

**用途**：锚点追问 LLM 写只读 SQL 前确认列名与取值范围（03 文档 SQL 生成仍受 SQL 沙箱四件套校验）；替代「schema 硬编码进 system prompt」的刚性方案（列统计随会话动态变化）。

### 8.5 工具公共约定（四个工具统一实现）

```ts
// mcp-server 与 AI 接入层共用的结果信封（zod）
const ToolResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown(),
    meta: z.object({ source: z.string(), updatedAt: z.string().optional(), cache: z.enum(["hit","miss"]).optional() }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(["unavailable", "quota_exhausted", "timeout", "invalid_input"]),
      message: z.string(),                 // 人类可读，会直接展示给用户（05 徽章文案）
      retryAfterSec: z.number().optional(),
    }),
  }),
]);
```

- **超时**：单工具 4 秒（AbortController）；**重试**：仅对第三方 API 的 429/5xx 做指数退避 1s/2s/4s，之后返回 ok:false；
- **归因元数据**：`meta.source` 强制携带（如「和风天气」「自建大促日历 v2026.10」），前端引用 footer 直接渲染——这就是「结果注入归因」的数据来源；
- **LLM 行为约定**（编排层系统提示固定段落，03 文档引用）：

```
工具返回 {"ok": false, ...} 时：跳过该工具的结果继续作答，并明确告知用户该外部数据不可用及其原因；
严禁虚构任何外部数据（天气/校历/促销/统计）；无工具结果支持的结论必须声明「基于内置知识」。
```

---

## 9. MCP Server 实现方案

### 9.1 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言/运行时 | Node 20 + TypeScript | 与主仓库同栈，团队零学习成本 |
| SDK | `@modelcontextprotocol/sdk`（**锁定小版本**，W4D1 spike 确认 API） | 官方 SDK；锁定防版本漂移（§12 风险） |
| 传输 | **Streamable HTTP**（`/mcp` 端点，会话经 `Mcp-Session-Id` 头） | 容器部署可达、无状态可重启、AI SDK 原生支持 |
| stdio | 仅保留（`npm run dev:stdio`）用于本地调试 | 无法用于容器部署，仅开发期验证 tools/list |
| HTTP 框架 | express | 最小依赖，同时挂 `/mcp`、`/healthz` |
| 会话存储 | 内存 Map（单实例） | 演示并发=1；多实例再引入 Redis（明确不做） |

### 9.2 最小 server 完整实现

```ts
// mcp-server/src/index.ts（依赖：@modelcontextprotocol/sdk、express、zod）
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import schoolCal from "./data/school-calendar-2026-2027.json";
import promoCal from "./data/promo-calendar-2026.json";
import { cityIdOf } from "./data/city-weather-id";
import { fetchWeather } from "./weather";        // §8.2 代理实现（key=env，字段白名单+缓存+退避）

const PORT = Number(process.env.PORT ?? 3000);
const app = express();
app.use(express.json({ limit: "64kb" }));

const server = new McpServer({ name: "spendct-mcp", version: "1.0.0" });

server.registerTool("get_school_calendar",
  { title: "校历查询", description: "查询 2026-2027 学年校历事件（考试周/寒暑假/开学季/毕业季）…（§8.1 全文）",
    inputSchema: { types: z.array(z.enum(["exam_week","vacation","term_start","graduation"])).optional(),
                   from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                   to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() } },
  async ({ types, from, to }) => {
    const events = schoolCal.events.filter(e =>
      (!types?.length || types.includes(e.type)) &&
      (!from || e.endDate >= from) && (!to || e.startDate <= to));
    return { content: [{ type: "text", text: JSON.stringify({
      ok: true, data: { academicYear: schoolCal.academicYear, events },
      meta: { source: "自建校历 v" + schoolCal.version } }) }] };
  });

server.registerTool("get_weather",
  { title: "天气查询", description: "查询指定城市当前天气与 3 天预报…（§8.2 全文）",
    inputSchema: { city: z.string(), days: z.number().int().min(1).max(3).default(1) } },
  async ({ city, days }) => {
    const r = await fetchWeather(city, days);    // 内部：cityId 表 → API → 白名单 → 缓存/退避
    return { content: [{ type: "text", text: JSON.stringify(r) }] };   // r 已是 §8.5 信封
  });

server.registerTool("get_promo_calendar",
  { title: "大促日历", description: "查询 2026-2027 电商大促日历（双11/618/双12/开学季/年货节）…（§8.3 全文）",
    inputSchema: { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                   to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                   categories: z.array(z.string()).optional() } },
  async ({ from, to, categories }) => {
    const promos = promoCal.promos.filter(p =>
      (!from || p.endDate >= from) && (!to || p.startDate <= to) &&
      (!categories?.length || p.categories.some(c => categories.includes(c))));
    return { content: [{ type: "text", text: JSON.stringify({
      ok: true, data: { promos }, meta: { source: "自建大促日历 v" + promoCal.version } }) }] };
  });

server.registerTool("query_bill_db_metadata",
  { title: "账单库元数据（协议演示）", description: "返回当前用户账单表 schema 与列统计…（§8.4 全文）",
    inputSchema: { table: z.enum(["transactions","merchants"]).default("transactions"),
                   sessionSchema: z.record(z.string(), z.unknown()).optional(),
                   includeStats: z.boolean().default(true) } },
  async ({ table, sessionSchema, includeStats }) => {
    // 快照由 AI 接入层随每次工具调用参数注入（07 §13/§18：per-request，服务端零存储；
    // 本工具为 MCP 协议演示路径，浏览器端真实路径 = duckdb_meta 直读 DuckDB-WASM）
    const snap = sessionSchema?.[table];
    if (!snap) return { content: [{ type: "text", text: JSON.stringify({
      ok: false, error: { code: "unavailable", message: "账单 schema 快照未随请求传入" } }) }] };
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: snap,
      meta: { source: "浏览器 DuckDB-WASM 元数据快照（per-request）" } }) }] };
  });

// /mcp：Streamable HTTP（无状态传输 + 内存会话）
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: sessionId ? undefined : undefined,  // 简化：由 SDK 生成并回写头
    enableJsonResponse: true,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", async (req, res) => { /* GET 用于 SSE 流（SDK 要求），同 POST 逻辑 */ });
app.delete("/mcp", async (req, res) => { /* 会话终止 */ });

app.get("/healthz", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.listen(PORT, () => console.log(`[spendct-mcp] listening :${PORT}`));
```

`mcp-server/package.json` 要点：`"type": "module"`、依赖锁定 `@modelcontextprotocol/sdk@1.x`、`scripts: { dev: "tsx src/index.ts", dev:stdio: "tsx src/stdio.ts", build: "tsc", start: "node dist/index.js" }`。

### 9.3 部署到 Railway / Render 免费容器（步骤）

**Railway（首选，免费 trial 额度）**：

1. 仓库 monorepo 结构，`mcp-server/` 为独立子包（含 `Dockerfile`）：

```dockerfile
# mcp-server/Dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY src ./src
COPY data ./data
RUN pnpm install --frozen-lockfile && pnpm build
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

2. railway.app → New Project → Deploy from GitHub repo → 选择 spendct 仓库；
3. Service 设置：Root Directory=`mcp-server`，Start Command=`node dist/index.js`（或 Dockerfile 自动识别）；
4. Variables：`QWEATHER_API_KEY`（Secret 类型）；记下分配域名 `https://xxx.up.railway.app`；
5. 验证：`curl https://xxx.up.railway.app/healthz`；本地 `pnpm run mcp:smoke`（tools/list 全量握手冒烟脚本）通过后，把域名写入主仓库 env `MCP_SERVER_URL`。
6. 费用：Railway trial 免费用量内 ≈ ¥0；若转 Hobby（$5/月）只在演示期开通，计入 01 费用账本（§14）。

**Render（备选）**：New → Web Service → 连仓库 → Root Directory=`mcp-server` → Build=`pnpm install && pnpm build` → Start=`node dist/index.js` → Instance=Free。注意两点：免费实例 **15 分钟无流量休眠**，冷启动 30–60s——对策：演示前 10 分钟 `curl /healthz` 预热 + 视频录制用本地 server（§9.5）；免费实例无持久盘（本服务无状态，无碍）。

**国内可达性**（Vercel 不稳定的同类风险，对策对齐 01/06）：Railway/Render 域名国内访问不稳 → **演示视频以本地 `pnpm dev` 起的 MCP server 录制为主证据**；答辩本地演示预案起本地 server；公网部署仅作可选加分项，不承载关键演示路径。

### 9.4 与 Next.js 的接入方式

```ts
// src/server/ai/mcp.ts —— AI 接入层 MCP 客户端（单例、自动重连、失败返回空工具集）
import { experimental_createMCPClient } from "ai";            // ai@7.0.137 精确锁定（07 §19）；MCP client 导出名以 7.0.137 装包实测为准，W4D1 spike 结论回写 01/04（#17）
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let mcpPromise: ReturnType<typeof experimental_createMCPClient> | null = null;

export async function getMcpClient() {
  if (!process.env.MCP_SERVER_URL) return null;                // 未配置 → 无工具（§10 L2 同路径）
  if (mcpPromise) return mcpPromise;
  mcpPromise = experimental_createMCPClient({
    transport: new StreamableHTTPClientTransport(
      new URL(process.env.MCP_SERVER_URL + "/mcp")),
  }).catch((e) => { mcpPromise = null; console.warn("[mcp] connect failed:", e.message); return null; });
  return mcpPromise;
}

// src/app/api/followup/route.ts（锚点追问 handler 内，03 文档编排层；LLM 调用在 src/server/ai/*，07 §13）
const mcp = await withTimeout(getMcpClient(), 5000);           // 连接超时 5s → null
const mcpTools = mcp ? await mcp.tools() : {};
const tools = { ...mcpTools, ...localTools };                  // localTools：duckdb_meta / run_browser_sql（07 §18）+ L1 备选元数据工具
const sysExtra = mcpTools  // 工具可用性声明注入（§11.2）
  ? "可用外部工具：校历、和风天气、大促日历、账单元数据（协议演示）。"
  : "外部工具（校历/天气/大促日历/元数据）当前不可用，禁止引用外部实时数据。";
// schema 快照：随 /api/followup 请求体 sessionSchema 字段到达（07 §13，per-request）；
// query_bill_db_metadata 被调用时由本层注入为工具参数（07 §18）
```

**接入要点**：① MCP 客户端只存在于 AI 接入层，浏览器只与 Next.js 通信（隐私架构不变）；② `tools()` 结果与本地工具合并进 Vercel AI SDK `streamText`，工具徽章数据（§8.5 `ToolInvocation`）由 SDK 流式回调解析后推给前端（05 文档 ToolBadge）；③ 工具调用失败不中断流——SDK 将工具结果（含 ok:false 信封）注入上下文，模型自行继续（§11）。

### 9.5 演示视频展示脚本（协议握手 + 结果注入归因）

> 供 06 文档视频脚本汇总使用；全部用**本地 MCP server** 录制（稳定第一），总素材约 65 秒，主视频剪入 30–40 秒。

| 分镜 | 时长 | 画面 | 台词（普通话） | 技术要点 |
|---|---|---|---|---|
| 1 协议握手 | 15s | 左侧终端：`pnpm --filter mcp-server dev` 启动日志；右侧调试器面板滚动显示 `initialize` 请求/响应与 `tools/list` 返回的 4 个工具 JSON（工具名 + description 首行大字号） | 「我们的四个外部工具通过标准 MCP 协议暴露。可以看到初始化握手：客户端声明协议版本，服务端返回 capabilities，随后 tools/list 列出校历、天气、大促日历和账单元数据四个工具。」 | 截取 §9.2 握手 JSON 留档；技术文档同图 |
| 2 工具调用流 | 25s | 浏览器内锚点追问「11月11号想买显示器，现在该不该下手？」→ 洞察卡流中依次亮起工具徽章：`get_promo_calendar`（running → ok，1.2s）→ 答案卡出现结论 + 引用 footer | 「注意看，这个问题触发了大促日历工具——模型按需调用，无关天气就不会去查天气。答案给出了双11节奏：预热期 10 月 20 号开始，峰值 11 月 11 号，并提醒大件关注价保。」 | 徽章数据 = §8.5 `ToolInvocation` 流；`meta.cache: hit` 展示缓存命中 |
| 3 结果注入归因特写 | 10s | 引用 footer 特写：`[大促日历 v2026.10 · 自建数据]`、`[案例 C017 · 大促比价 · 来源：消协调查]`、`[和风天气 · 2026-10-13 14:00 更新]`，逐条可点击展开原始 JSON/链接 | 「每个外部数据的结论都带来源归因——数据来自哪个工具、哪个版本、何时更新，全部可点击核验。模型只负责叙述，数据来自工具与案例库。」 | 归因 = `Citation.kind: "tool"` + `meta.source/updatedAt`；技术文档截图 |
| 4 优雅降级（备用镜头） | 15s | 终端 kill MCP server → 再追问「考试周是什么时候？」→ 灰色徽章「校历工具不可用（连接超时）· 已跳过」→ 答案基于内置知识完成并声明「无外部数据引用」 | 「工具挂了，Agent 不会卡死——它收到结构化降级结果，跳过该工具继续作答，并明确告知用户哪些外部数据不可用。」 | §11 降级链路实录；技术文档可作为故障演练证据 |

---

## 10. 砍法（时间不足时退 Function Calling 的确切路径与丢分评估）

### 10.1 触发闸门

| 闸门 | 时间 | 判据 | 动作 |
|---|---|---|---|
| RAG 最小版闸门 | W3 周日（11-01） | 订阅雷达能产出带案例引用的洞察卡（浏览器 TF-IDF 模式即可） | 未达成 → RAG 缩为「案例库 + TF-IDF + 订阅雷达引用」，砍 dense/reranker/评测精简为 10 条金标 |
| MCP 闸门 | W4 周五（11-06）晚 | MCP server 本地跑通四工具且 tools/list 握手成功（日期以 06 路线图为准，#61） | 未达成 → 依次执行 L1/L2/L3 |
| 部署闸门 | W4 周五（11-06）晚 | Railway/Render 任一平台 healthz 通过 | 未达成 → 执行 L2（公网部署砍掉，本地 server 录视频） |

### 10.2 砍法梯子（每级都是完整可交付状态，不是半成品）

**L1 · 砍 DuckDB 元数据 MCP 工具（丢分 ≈0，省 0.5 人日）**
- 路径：`query_bill_db_metadata` 从 MCP server 移除；在 AI 接入层注册为原生 AI SDK 工具（`tool({ description, inputSchema, execute })`），execute 内读客户端随请求传入的 schema 上下文（03 编排层已持有）→ 返回 §8.4 同结构输出。
- 改动清单：mcp-server 删 1 个注册（删 `/api/schema` 端点，该端点已随 07 §13 撤销）；`src/app/api/followup/route.ts` 加 1 个本地工具（execute 内直接读请求体 `sessionSchema` 快照，03 编排层已持有）；zod schema 复用零改动；UI 无变化。
- 丢分评估：仍保有 3 个真实 MCP 工具（协议叙事完整），仅少一个「跨进程数据流」亮点，预计 0–0.2 分。

**L2 · 砍 MCP server 部署，四工具全部退 Function Calling（丢分 1–1.5，省 1.5–2 人日）**
- 路径：不部署独立 MCP server；四工具全部改为 Vercel AI SDK 原生工具，实现在 AI 接入层 Route Handler 内：
  - `get_school_calendar` / `get_promo_calendar`：直接 `import` 两个 JSON 过滤返回（代码即 §9.2 工具内逻辑，原样平移）；
  - `get_weather`：Route Handler 内直接 fetch 和风天气（§8.2 缓存/退避/白名单逻辑不变）；
  - `query_bill_db_metadata`：走 L1 路径。
- 改动清单：删除 `mcp-server/` 子包与 Dockerfile；`src/server/ai/mcp.ts` 改为 `src/server/ai/tools.ts`（zod schema 单一来源不变，直接复用 §8 定义）；归因元数据 `meta.source` 由本地包装层注入（`wrapTool`，§11.2 代码原样可用）；UI/徽章/引用 footer 零变化。
- 丢分评估（诚实口径，写入技术文档可引用）：评审维度「MCP/工具集成 4%」拆为工具集成 + MCP 协议两半。Function Calling 仍完整展示工具集成能力（按需调用/流式徽章/归因/降级），预计得 2–2.5/4；损失 MCP 协议专项分（约 1–1.5 分）与技术文档「符合 MCP 开放标准」亮点。**折中建议**：即使砍部署，`mcp-server` 代码保留在仓库 README 中作为「已实现的 MCP 兼容层（未上线）」——零成本保住部分叙事。

**L3 · 再砍天气工具（丢分 0.5–1，省 0.5 人日）**
- 路径：和风天气 key 申请（实名认证）、限流调试、国内可达性存在不确定性 → 砍掉；只保留校历 + 大促两个纯静态工具。
- 丢分评估：外部实时 API 展示缺失，工具丰富度下降；静态工具仍有归因/降级叙事。
- 红线：**不允许用假天气数据顶替**（宁缺毋滥，02/03 提示注入防护对虚构外部数据零容忍）。

**L4 · 砍全部 MCP + 个人化 RAG 缩水（2 人团队既定砍法，产品定义明示）**
- 路径：四工具全砍（回答类问题退回纯 LLM 内置知识 + 案例库引用）；个人化 RAG 只保留结构化 SQL 召回（砍 TF-IDF 语义排序）；RAG 保留案例库 + 订阅雷达引用（浏览器 TF-IDF）。
- 丢分评估：MCP 4% 中得 0–1 分；RAG 6% 中保 4–4.5 分（案例库+兜底+评测仍完整）；合计丢 2–3 分，换取约 5–6 人日（按 80% 容量规划，期中考试撞 W4–W5 时的保命方案）。

### 10.3 砍法工程保障

- 所有 zod schema 单一来源（`src/lib/rag/types.ts` + §8 定义），L1/L2 平移零改动——**Function Calling 实现是 MCP 实现的天然备份**；
- `MCP_SERVER_URL` 未配置时系统自动等价于 L2（§9.4 代码已内建），即「砍法」不需要临时代码，只需删配置；
- 每次砍级在 06 路线图文档记录「砍了什么、为什么、丢分评估」，技术文档如实披露取舍（评委对诚实取舍的接受度高于烂尾）。

---

## 11. 优雅降级：「工具不可用 → Agent 跳过该工具继续跑」

### 11.1 降级矩阵（全链路）

| 层 | 故障 | 检测方式 | 降级行为 | 用户可见（05 规范） |
|---|---|---|---|---|
| MCP 连接 | server 未部署/宕机 | `getMcpClient()` 超时 5s / 连接被拒 | 工具集为空 + 系统提示追加「外部工具不可用，禁止引用外部数据」 | 无工具徽章；答案声明「基于内置知识」 |
| 工具调用 | 单工具超时 | AbortController 4s | 返回 `ok:false(timeout)` 信封（不抛异常，流不中断） | 灰色徽章「XX 工具不可用（连接超时）· 已跳过」 |
| 工具调用 | 第三方 429/402/5xx | HTTP 状态码 | 指数退避 1s/2s/4s 重试 → 仍失败返回 `ok:false` 信封 | 灰色徽章「天气额度已用尽 · 已跳过」 |
| 工具调用 | LLM 重复调用同一失败工具 | 编排层计数 ≥2 | 注入「该工具已禁用，请勿再次调用」+ 拦截后续同名调用 | 答案继续生成 |
| 编排 | 模型工具调用死循环 | `maxToolRoundtrips = 6` | `stopWhen: stepCountIs(6)` 强制收束，用已有上下文出答案 | 流正常结束 + 提示「已结束工具探索」 |
| RAG | dense 模型不可用 | `EmbedderUnavailableError` | TF-IDF 替代召回（§4.8） | 可选徽章「轻量检索模式」 |
| RAG | reranker 不可用 | `RerankerUnavailableError` | dense 分数直接排序 | 无感知 |
| RAG | 检索结果不足/低分 | 阈值 | 「未找到足够相关的案例引用」 | 引用区空态（05 空态文案） |
| 会话快照 | sessionSchema 缺失/校验失败 | 工具参数校验 | 元数据工具返回 ok:false(unavailable) | 徽章「元数据快照不可用 · 已跳过」 |

### 11.2 实现代码

```ts
// src/server/ai/tool-guard.ts —— 工具统一防护包装（MCP 工具与本地工具共用）
import type { Tool } from "ai";

export function wrapTool(tool: Tool, opts: { timeoutMs?: number; maxAttempts?: number } = {}): Tool {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 2;
  return {
    ...tool,
    execute: async (args, ctx) => {
      let last: unknown;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          return await withTimeout(Promise.resolve(tool.execute!(args, ctx)), timeoutMs);
        } catch (e) {
          last = e;
          if (!isRetryable(e)) break;                 // 输入错误/业务失败不重试
          await sleep(2 ** i * 1000);                  // 指数退避 1s/2s
        }
      }
      // 关键：返回结构化降级结果而不是抛异常 —— 抛异常会中断整个流
      return {
        ok: false,
        error: { code: isTimeout(last) ? "timeout" : "unavailable",
                 message: describeFailure(tool, last) },  // 如「校历工具连接超时」
      };
    },
  };
}

// 编排层（03 文档 route.ts 内）：
// const stats = new Map<string, number>();           // tool → 连续失败次数
// onToolCall 回调中统计；同一工具失败 ≥2 → tools 中移除该工具并
// system 提示追加：「工具 {name} 已因连续失败被禁用，请基于已有信息继续作答，不要再次调用。」
// streamText({ ..., tools: wrappedTools, stopWhen: stepCountIs(6) })
```

要点：**失败信息以「工具结果」而非异常的形式进入模型上下文**——Vercel AI SDK 把工具返回值序列化注入，模型看到 `{"ok": false, "error": {...}}` 后自行跳过并继续组织答案；这就是「Agent 跳过该工具继续跑」的机制，也是 §9.5 分镜 4 的实录内容。

### 11.3 测试用例清单（vitest 自动化 + 手工演练，W4 起每周错误态打磨日复跑）

| 编号 | 用例 | 预期 |
|---|---|---|
| T1 | MCP_SERVER_URL 未配置，发起锚点追问 | 工具集为空；系统提示含禁用声明；回答完整且不引用外部数据 |
| T2 | MCP server 进程 kill 后追问天气 | 连接失败 → 工具集为空 → 同 T1；页面徽章区显示「外部工具不可用」 |
| T3 | 和风天气返回 402（额度用尽） | 退避 3 次 → ok:false(quota_exhausted) → 答案继续并声明天气数据不可用 |
| T4 | 工具调用阻塞 >4s | ok:false(timeout) → 答案继续 |
| T5 | 模型对失败工具连续调用 3 次 | 第 2 次失败后注入禁用提示；第 3 次调用被编排层拦截；答案正常收束 |
| T6 | dense 模型文件删除后检索 | 自动切 TF-IDF；hit@3 ≥ 12/20 兜底门槛（§5.2 --mode tfidf） |
| T7 | 检索结果全低于阈值 | 引用区显示「未找到足够相关的案例引用」空态；答案仍基于内置规则 |
| T8 | 断网（DevTools offline）订阅雷达扫描 | 浏览器 TF-IDF + DuckDB-WASM 照常产出引用（§6 三层用途③） |

### 11.4 与 05 文档的错误态/空态规范接口

- 徽章组件：`ToolBadge { state: "running"|"ok"|"skipped"|"error", tool, latencyMs, meta, errorReason }`（数据源 §8.5 `ToolInvocation`）；skipped/error 统一灰色 + 文案模板「{工具中文名} 不可用（{errorReason}）· 已跳过」；
- 空态文案（05 文档引用，共 3 条）：引用区「未找到足够相关的案例引用，结论基于内置规则与你的账单数据」；外部数据「外部工具暂时不可用，本回答不包含实时外部数据」；个人化「暂无历史同类异常记录」。

---

## 12. 风险与对策（本域专属，映射产品风险纪律）

| 风险 | 对策（均已内建到设计） |
|---|---|
| 本地模型文件下载慢/被墙（国内网络） | `download-models.mjs` 支持 `HF_ENDPOINT=https://hf-mirror.com`；W4D1 spike 实测下载与加载；兜底 TF-IDF 全程可用 |
| bge-m3 量化模型吃内存，免费容器 OOM | q4 量化（约 300MB）备选；`EMBEDDING_PROVIDER=tfidf-only` env 开关；W4D1 spike 在 Railway trial 实测后二选一定案 |
| 和风天气 key 申请失败/限流 | §10 L3 砍法预案；演示链路预跑（部署后 `scripts/mcp/warmup.mjs` 预请求）；备用录像 |
| MCP SDK API 变动（版本漂移） | 锁定小版本；W4D1 spike 用 §9.2 代码跑通 initialize/tools/list 再继续 |
| 评测数字水分（技术文档引用） | 金标双人制定 + 仲裁；数字以脚本输出为准；W4D4 评测后复跑一次再入文档 |
| 引用幻觉（模型编造案例编号） | 引用白名单后处理（§5.3）：引用 ID 必须来自检索结果，元数据由检索层注入，模型不可编造 |
| 案例库事实错误（人工校验漏网） | 来源必须可访问 + 摘录句可对照 + 法条对 gov.cn 原文；`reviewStatus` 双人机制；REVIEW_LOG 留痕 |
| 检索上下文泄露用户明细 | 检索查询文本仅含聚合上下文与单条问题（02 口径）；个人化 RAG 全程浏览器；schema 快照仅聚合统计、TTL 不落盘 |
| 工具结果被提示注入 | 工具输出与检索文本一律按「数据不可信」声明处理（02/03 三层防护扩展，§0.3 接口已登记） |

## 13. 里程碑、分工与验收清单

| 时间 | 任务 | 产出 | 负责人 |
|---|---|---|---|
| W1D2（10-14） | 案例库 schema + 生产计划定稿（本文档 §2 冻结） | `case-schema.ts` | 数据管线 |
| W2（10-20~25） | 首批 30 条案例（AI 初稿 + 人工校验）+ 嵌入管线跑通 + verify 脚本 | `data/cases/*`、`build/verify-embeddings.mjs` | 数据管线 + 材料（校验） |
| W3D1（10-27） | 案例库 60 条；TF-IDF 实现 + 词表构建；浏览器订阅雷达引用接入 | `tfidf.ts`、`browser-retrieve.ts` | 数据管线 |
| W3D2-3 | 服务端级联（dense+reranker+过滤）+ 模型下载加载 | `retrieve.ts`、`embedder.ts`、`rerank.ts` | 数据管线 |
| W3D4 | 金标主集 20 条 + 评测脚本 + 金标查询嵌入 | `tests/golden/*` | 数据管线 + 材料 |
| W3D4-6 | 扩容-1：`spending_advice` +10 条（预算方法/记账习惯，服务 F07/F08 演示） | cases.json 增量 + REVIEW_LOG | 数据管线 + 材料 |
| W3D5-W4D3 | 扩容-3：`student_benefits` 30 条（= **T52a，省赛必做**；AI 初稿 + 双人校验）+ `student-golden-8` 补充集制定（T52b 贴士卡任务为条件行·默认置灰，点亮后另行排期） | cases.json 增量 + `rag-golden-student.json` | 数据管线 + 材料 |
| W3D6-W4D2 | 扩容-2：`subscription_trap` +10 条（消协/黑猫新案源，服务 F06 管理墙） | cases.json 增量 + REVIEW_LOG | 数据管线 + 材料 |
| **W3D5 闸门** | **RAG 最小版演示**：订阅雷达带案例引用（浏览器 TF-IDF 即可过关） | 演示录屏 | 全员 |
| W4D1-5（11-03~06） | MCP 四工具 + 最小 server（§9.2 代码）+ spike（SDK 握手/模型内存）+ 部署 Railway/Render + 预热 + 冒烟 | `mcp-server/`、公网 healthz | 数据管线 |
| **W4 周五（11-06）闸门** | **MCP gate**：MCP 本地握手成功 + 部署 healthz 通过（日期以 06 路线图为准，#61；未达成 → §10 梯子） | tools/list 输出 | 数据管线 |
| W4 周六（11-07）起 | 评测窗口：主集 hit@3 + 补充集 hit@3（分开报告）+ 引用忠实度/覆盖双人盲评 → 数字写入技术文档（§5.4 模板）；降级矩阵 T1-T8 用例 + 演示分镜 4 录制 | 评测报告、测试报告 + 视频素材 | 数据管线 + 材料 + 前端 |
| 11/8（G4 前一日）达标 150+/`verified` ≥ 140；11/9 随 G4 验收 | 案例库 150+ 条验收；主集 + 补充集评测数字复跑定稿 | 验收清单全过 | 数据管线 + 材料 |
| W5（11-10~17） | 零开发；只复跑最终评测（11-10~17 最终评测窗口）、复录视频、错误态打磨日复跑 T1-T8 | — | 全员 |

**验收清单（本域 Definition of Done，对照评审维度）：**
- [ ] 案例库 ≥150 条、11/8 前 `verified` ≥ 140，来源可点击核验（RAG 6% 数据证据，08 §⑤.2）
- [ ] `student-golden-8` 补充集 hit@3 ≥ 7/8 独立断言通过（主集 ≥18/20 门槛不变，修订案 A4）
- [ ] 运行时零嵌入 API 调用可演示（断网 + 抓包无嵌入请求）（三重抗限流证据）
- [ ] `pnpm run rag:eval` 输出主集 hit@3 ≥ 18/20 且 CI 通过（评测数字入技术文档）
- [ ] 引用白名单后处理在 demo 中可触发（构造一条幻觉引用用例）
- [ ] MCP 握手 tools/list 视频素材 + 归因 footer 特写素材（§9.5 四分镜）
- [ ] T1-T8 降级用例全部通过，分镜 4 录制完成
- [ ] 费用账本更新（§14 数字实际核销，交 01 文档）

## 14. 费用预算（本域增量，计入 01 总账）

| 项 | 预算 | 说明 |
|---|---|---|
| bge-m3 文档嵌入（一次性） | ¥0–0.05 | SiliconFlow 免费档或本地 CPU；150+ 条 × 约 300 tokens ≈ 50K tokens（扩容 50 条增量 ≈ ¥0.02 一次性，08 §⑤.2） |
| 金标查询嵌入（一次性） | ¥0 | 主集 20 条 + 补充集 8 条，与文档嵌入同批完成 |
| 查询侧本地推理（运行时） | ¥0 | onnxruntime-node 本地，零 API |
| 和风天气（运行时） | ¥0 | 免费档 1000 次/天；演示预跑 <50 次/天 |
| MCP 容器 | ¥0 | Railway trial / Render free；Hobby $5/月仅在演示期且 ≤1 个月（约 ¥36，需 01 账本审批） |
| 模型下载流量 | ¥0 | hf-mirror 镜像 |
| **合计** | **≤ ¥1（不含可选容器费）** | 整赛程实支 ¥30–100 上限内，占比 <3% |

---

*本文档完。接口契约（§0.3/§1.3/§7.4/§8.5/§11.4）为 01/02/03/05/06 文档的对齐依据；任何一方修改契约字段，需在本文档同步更新并跑一次 `pnpm run rag:eval`（主集 + 补充集）回归。*

