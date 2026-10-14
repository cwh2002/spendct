# 消费CT · SpendCT —— AI 账单体检与消费洞察平台

> 2026 第九届传智杯「AI WEB 网页开发挑战赛」参赛作品（赛道 id=10037）

把微信、支付宝导出的账单 CSV 拖进浏览器，一条六阶段流水线自动完成清洗、画像、异常检测、订阅陷阱扫描、环比归因与年度报告，产出可确认、可质疑、可深挖的消费洞察卡。**账单数据全程不出浏览器。**

## 为什么是 SpendCT

- **痛点**：自动续费悄悄扣款、深夜冲动消费、预算形同虚设——年轻人（尤其学生）缺的不是记账工具，而是「体检 + 处方」。
- **差异**：传统记账 App 只记录不诊断；SpendCT 用确定性 SQL（DuckDB-WASM）做体检主体，LLM 只负责叙事与建议，结论可溯源到聚合 SQL、法规条文与真实案例。
- **隐私**：账单解析、聚合、体检全在浏览器内完成；服务端只转发 LLM 请求且只见聚合统计值，永远接触不到明细（见 [docs/02-data-privacy.md](docs/02-data-privacy.md) 的可见性对照表）。

## 功能总览

| 模块 | 说明 |
| --- | --- |
| 六阶段体检 | 清洗 → 消费画像 → 异常检测 → 订阅陷阱扫描 → 环比归因 → 年度报告，流式事件实时可见（20 类协议事件） |
| 洞察卡 | 每条结论带置信度、图表证据、SQL/RAG 引用，可确认 / 质疑 / 收藏 / 深挖；低置信度结论自动挂起 |
| 订阅雷达 | 确定性规则（同商户 ≥3 笔、间隔 25–40 天、金额 ±1% 容差）揪出连续扣费，附下次扣费倒计时与取消指引 |
| 预算中心 | 12 类目预算环 + 超支贴士 + 下月预测 + 一句话快速记账 |
| 年度报告 | 健康指数 + 四项对标指标 + 滚动叙事 + 1080×1920 海报导出 |
| 知识课堂 | 60 条可核验案例（订阅陷阱 / 预付风险 / 消费维权 / 学生权益），附法条与官方来源 |
| 本地账户 | IndexedDB 账户体系（PBKDF2-SHA256 加盐哈希），注册 / 登录 / 个人中心 / 成就段位 |
| 数据主权 | 账单 CSV / JSON 一键导出、一键删除；数据可见性对照表公开在 /privacy |

## 技术架构

```
账单 CSV ──► 解析(表头嗅探/去重/GBK告警) ──► DuckDB-WASM(浏览器内)
                                                  │
         ┌────────────────────────────────────────┤
         ▼                                        ▼
   SQL 白名单聚合(9 预计算表 + 13 视图)      LLM 接入层(mock/live 双模式)
         │                                        │  降级链 deepseek → qwen → 模板
         ▼                                        ▼
   六阶段管线引擎(状态机 + 断点续跑) ──► 洞察卡工厂 ──► reflect 发布闸门 ──► UI
         │
         └─► 20 类协议事件流(实时渲染到体检页)
```

- **AI 技术点**：Agent 六阶段工作流、反思自检闸门、模型降级链、RAG 案例检索（TF-IDF 本地 / ONNX 可选）、MCP 工具（和风天气）、LLM 生成 SQL 白名单拦截。
- **工程**：Next.js 16（App Router）+ React 19 + TypeScript strict + Tailwind 4（CSS-first 令牌）+ Zustand + TanStack Query + ECharts（暗色主题经 CSS 变量桥接）。
- **安全**：SQL 窄文法白名单（7 原因码 + 行数复检）、金额全链路整数分、`check-secrets` 钩子杜绝密钥进库。

设计文档见 [docs/](docs/)（01 架构 / 02 数据隐私 / 03 Agent 流水线 / 04 RAG-MCP / 05 UIUX / 06 路线图 / 07 权威契约 / 08 功能扩展）。

## 快速开始

```bash
pnpm install          # postinstall 自动自托管 DuckDB-WASM 到 public/duckdb（断网演示可用）
cp .env.example .env.local
pnpm dev              # http://localhost:3000
```

- **零密钥演示**：不填任何 API key 即 mock 模式（演示账户 `demo` / `demo123`），「上传账单」页可用内置示例账单跑完整流程；
- **接入真实模型**：在 `.env.local` 填 `DEEPSEEK_API_KEY`（文本主脑）、`SILICONFLOW_API_KEY`（轻任务）、`GLM_API_KEY`（截图 OCR）；任一 key 就位即自动切 live 模式（`DEMO_MODE=mock` 可强制回零密钥演示）。

```bash
pnpm typecheck       # tsgo 全量类型检查
pnpm lint            # ESLint
pnpm test            # Vitest 单测（271 用例）
pnpm test:e2e        # Playwright 端到端（13 页冒烟 + 示例账单全动线，23 用例）
pnpm build           # 生产构建（17 路由：14 静态 + 2 API + not-found）
```

## 目录结构

```
src/
├── app/                  # 13 个路由页 + api/ai/{chat,task} 路由
├── components/           # layout(壳/顶栏/底栏) · charts · auth · achievements ...
├── lib/
│   ├── account/          # IndexedDB 账户与会话（本地账户模式）
│   ├── duckdb/           # DuckDB-WASM 单例 · 数据集初始化
│   ├── import/           # CSV 解析 · 示例账单
│   ├── sql-guard/        # SQL 白名单（窄文法 + 原因码）
│   ├── pipeline/         # 六阶段管线引擎 · 模板卡工厂 · 跨页运行桥
│   ├── protocol/         # spendct协议@2（20 类事件）
│   ├── schema/           # transactions DDL · 13 视图 · 9 预计算表 · 洞察卡 schema
│   ├── llm/              # 模型接入层（mock/live）· 叙事模板库
│   └── ...               # demo-data · cases(60 条) · achievements · privacy-visibility
tests/
├── unit/                 # 白名单/账户/导入/协议/引擎/卡片 schema/运行桥 单测
└── e2e/                  # Playwright：全路由冒烟 · 关键动线 · 账户登录
public/duckdb/            # 自托管 wasm + worker（sync-duckdb-wasm.mjs 同步）
scripts/                  # 同步 · 密钥检查 · 验证 · 文档构建脚本
docs/                     # 8 份设计文档 + benchmarks + finance
```

## 隐私承诺（写入产品）

1. 账单明细只在浏览器内解析与聚合，不上传、不落盘；
2. 服务端仅转发 LLM 请求，输入为聚合统计值（哈希/分箱脱敏），不存储任何请求日志；
3. 全部数据可一键导出、一键删除，删除后 IndexedDB 内不留痕。

完整对照表见 [/privacy](https://spendct.vercel.app/privacy) 与 [docs/02-data-privacy.md](docs/02-data-privacy.md)。

## 团队与分工

- **队长**：架构设计、前端交互与交付物（13 个路由页、组件库、暗色主题、演示控制台、说明文档）；
- **队员**：数据管线与 AI 接入（DuckDB-WASM 数据层、六阶段管线引擎、LLM 接入层、测试矩阵与基准）。

从架构设计 → 设计文档 → 全栈实现 → 测试 → 交付物，全程见 git 提交历史。

## 许可证

MIT · 参赛用途开源，账单数据永不出浏览器。
