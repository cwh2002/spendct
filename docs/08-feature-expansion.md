# 08 功能扩展方案（SpendCT）

| 项目 | 内容 |
|---|---|
| 文档编号 | 08 / 07（功能扩展增量设计；与 01-07 冲突时以 07 权威契约为准） |
| 版本 | 1.0 |
| 日期 | 2026-10-13 |
| 负责人 | 功能扩展首席设计（前端交互成员牵头，数据管线成员复核） |
| 上游决策 | 产品定义（2026-10-13 已确认）+ 07 权威契约（本文档不推翻既有裁决；一切变更以「契约修订案 A1-A7」形式列出，A12/A13 于 2026-10-15、A14/A15/A17 于 2026-10-16 追加登记，见 §⑧） |

---

## 0. 本方案的设计原则（自身红线）

1. **演示稳定第一**：每个新功能必须可被 sample-data（`data/sample/wechat-sample.csv`，07 §15）一键演示，零真实账单、零额外网络依赖。凡依赖真实外部数据的想法一律不进本方案。
2. **确定性优先**：能用确定性 SQL / 前端计算实现的，绝不引入 LLM；每个新 LLM 任务必须带「模板兜底 + zod 校验 + 降级链」三件套（沿用 03 §7 与 07 §12 既有纪律）。
3. **AI 深度主线不稀释**：新功能是既有六阶段流水线、锚点追问、RAG、MCP 的延伸与放大，不开新架构方向（07 §0.2 裁决原则六）。
4. **隐私红线不破**：所有新数据落点逐一对照 07 §17 持久化红线；任何新增 LLM 可查询表必须注册进 07 §6 ALLOWED_RELATIONS，并遵守 R1-R10。
5. **性能预算不破**：新页面遵守 05 §1.1 chunk 预算；新图表遵守 05 §3.6 渲染规范（单页图表实例 ≤6、数据表切换救济、色板 8 槽纪律）与 01 §8 B1-B10。
6. **费用纪律不变**：新增 LLM 任务一律轻模型（qwen）优先，整赛程预算 ¥30-100、上限 ¥150 不变（06 §1.4/§9.5）。
7. **每个新功能必须有评分落点 + 演示镜头**：无落点、无镜头的一律不进本方案。

---

## ① 扩展总览（功能清单 + 档位 + 容量结论）

### 1.1 功能总表（13 项，F01-F13）

| ID | 功能 | 档位 | 归属页面 | 说明 | 数据需求 | AI 钩子 | 评分落点 | 工作量（人日） | 演示镜头（§0 规则 7 逐项兑现） |
|---|---|---|---|---|---|---|---|---|---|
| F01 | 首页营销页升级（纯文案版） | P0 | `/` | Hero 一句话价值主张 +「12 大能力」亮点卡墙（P2 三项带「即将上线」角标，A17 增补省钱挑战/攒钱目标/年度海报三卡）+ 技术架构展示条（DuckDB-WASM / 三模型 / RAG / MCP 图标化）+ 隐私三承诺条保留 | 无新增 | 无（纯前端确定性渲染） | UX·UI 设计 4%；前端交互 3% | 0.5（3 秒价值动画与滚动动效转国赛，§11.2 决议 ①） | 30s 动线 0-3s（首页即演示起点，能力卡墙一屏可见）+ 视频 S1 |
| F02 | /checkup 证据抽屉与阶段产出卡 | P0 | `/checkup` | 阶段卡点开即出证据抽屉（该阶段 SQL / 命中数 / 耗时 / 产出卡缩略）；阶段完成右侧浮出产出计数卡 | 既有 21 类事件协议（07 §2，`stage:evidence` 等；plan 由 A12 增补） | 无（展示真实事件，不放假动画，05 §5.1） | AI 交互体验 3%；Agent·工作流 8% 展示证据 | 1（其中 0.5 来自 T26 打磨日转化，§11.2 决议 ④） | 视频 S3 固定 2s 特写（点开阶段卡出证据抽屉） |
| F03 | 账本汇总两大新图表（日历热力图/类别桑基） | P0 | `/insights`（账本汇总视图） | 页面代码静态图表组件，确定性 SQL + ECharts 直接渲染；支持点选锚定（复用 AnchorSelection 捕获接口） | 既有视图 `v_daily_expense` / `v_category_monthly`（07 §3，零新表） | 无（明确不走 ChartSpec 枚举，见 §④） | UI 设计 4%；前端交互 3%；性能优化 3%（图表工程化） | 1.5（健康雷达/商户词云转国赛备选池，§11.2 决议 ①） | 视频 S4.5 两连切（3:00-3:36）+ 60s v2 第 1 项 |
| F04 | /insights 双视图 + 收藏 | P0 | `/insights` | 洞察流支持「卡片流 / 图表廊」双视图切换；卡片收藏（收藏夹面板） | localStorage `spendct:fav:v1`（UI 偏好类，07 §17 允许） | 无 | 前端交互 3%；实用性 10% | 1.0（筛选增强转国赛备选池，§11.2 决议 ①） | 视频 S4.5 双视图切镜 + 一次收藏勾选（3:36-3:40） |
| F05 | 年度报告数据故事 + 年度海报 | P1 | `/report` | 报告改为滚动式数据故事（6-8 个叙事段逐段浮现）；末尾「生成年度海报」canvas 合成 PNG 可保存本地 | `annual_summary`（既有预计算表）+ 故事段走 LLM 缓存 `spendct:llmcache:*`（07 §17） | 年度故事叙事（deepseek，annual 阶段内增强，新 AnnualStorySchema，见 §⑥.5） | 大模型集成 8%；实用性 10%；UI 设计 4% | 2 | 60s v2 第 4 项 10s（故事段逐段浮现 = AI 深度主镜头 + 一键海报）；30s 动线可选 /report 滚动一屏（05 §7.2 修订，§⑨） |
| F06 | 订阅管理墙 | P0 | `/subscriptions` | 从「雷达命中卡」升级为「订阅管理墙」：卡墙布局 + 下次扣费倒计时 + 年度订阅合计 + 一键取消攻略（RAG 步骤化操作清单）+ 提醒设置（接 F13） | `subscription_patterns`（既有）+ 攻略 RAG（既有，04 §2） | 无新增（既有确定性 SQL + RAG 引用） | 实用性 10%；社会价值 10% | 2 | 视频 S4.5 尾 3s 管理墙一瞥（3:40-3:43，倒计时徽标 + 攻略清单） |
| F07 | 预算中心 | P1 | `/budget`（新路由） | 月度分类预算设定（预算环进度）+ 预算 vs 实际对比 + 超支 AI 提示卡 + 下月预测（朴素季节外推，叙事归 LLM） | 新表 `budgets`（DuckDB 数据集内）+ 预计算表 `budget_vs_actual` / `forecast_monthly`（注册 ALLOWED_RELATIONS，修订案 A2） | 预算建议（qwen）+ 预测叙事（deepseek），均带模板兜底（§⑥.2/⑥.3） | 大模型集成 8%；实用性 10%；UI 设计 4% | 3.5 | 视频 S5.5 后段 + 60s v2 第 3 项（条件：P1 落地） |
| F08 | 快速记账 | P1 | `/budget`（主入口）+ `/insights` 空态 | 自然语言一句话记账（「中午食堂花了 15」→ zod 结构确认卡 → 一键入账）；语音输入为 P3（国赛窗口） | `transactions` 新增 `source='manual'`（修订案 A3）；原始输入文本不落盘（内存中转） | 快速记账解析（qwen，zod 强校验；`parseable:false` → 手动表单兜底，§⑥.1） | 大模型集成 8%（结构化输出）；实用性 10%；AI 交互体验 3% | 2.5 | 视频 S5.5 前段 + 60s v2 第 2 项（条件：P1 落地） |
| F09 | AI 省钱助手（学生权益 RAG） | P2 | `/insights`（年度阶段贴士卡）+ `/budget` 侧栏贴士流 | 学生权益案例库（30 条，T52a 省赛必做，§⑪.1）→ 体检年度阶段产出「省钱贴士卡」流入洞察流（T52b，P2 条件）；预算页侧栏常驻贴士 | 新 RAG 类别 `student_benefits`（30 条案例，data/cases）+ 个人聚合画像（既有视图） | 贴士个性化（qwen，选 top3 + 一句话适配理由；检索复用既有级联，§⑥.4） | RAG 6%；社会价值 10% | 2 | 无省赛镜头：PDF 4.4/README 静态展示 + 首页「即将上线」角标（T52b 点亮后才进 60s v2 加映） |
| F10 | 消费段位与成就系统 | P1 | `/report` | 消费健康雷达图（六维）+ 消费人格段位（5 档，`v_health_inputs` 六维分规则判定，不依赖 T18 具名指标）+ 成就徽章墙（13 枚，如「首次体检」「揪出订阅刺客」「连续记账 7 天」；第 13 枚「七日打卡王」为 A17 挑战页解锁） | `v_health_inputs`（既有）+ localStorage `spendct:achievements:v1`（可重算，修订案 A1） | 无（确定性规则 + 模板文案，保证演示稳定） | UI 设计 4%；前端交互 3% | 2 | 60s v2 第 5 项 6s（成就墙一屏 + 徽章弹出一枚；UI 4% + 前端交互 3% 的落点镜头，条件：P1 落地） |
| F11 | 消费知识小课堂 | P2 | `/learn`（新路由） | 案例库浏览（分类/搜索）+ 金融素养知识卡 +「防坑手册」（把 150 条 RAG 案例变成可浏览产品，体现工作量与数据充实度） | `data/cases/` 静态数据（既有资产复用）+ 浏览器 TF-IDF 搜索（04 §4.8） | 无（检索复用既有 TF-IDF，零新增 LLM） | RAG 6%（数据可见性）；实用性 10% | 2 | 无省赛镜头：PDF/README 静态展示 + 首页「即将上线」角标 |
| F12 | 数据管理与导出 | P1 | `/settings`（新路由） | 数据集列表/切换/一键删除 + CSV/JSON 导出（本地生成 + 隐私提示）+ 通知开关 + 主题/演示模式入口 | dataset 元数据（localStorage，既有）+ DuckDB 直读导出 | 无 | 实用性 10%；隐私信任（社会价值 10%） | 1.5 | 60s v2 第 6 项 5s（导出 + 隐私提示，条件：P1 落地） |
| F13 | 站内通知中心 | P2 | 全局（TopNav 通知铃） | 订阅扣费临近 / 预算超支 / 断点续跑提醒的站内通知铃 + 通知列表（页面内展示，不发系统推送） | localStorage `spendct:notif:v1`（可重算的提醒状态，修订案 A1） | 无 | 实用性 10%；UX（前端交互 3%） | 1 | 无省赛镜头：PDF/README 静态展示 + 首页「即将上线」角标 |

**规则 7 兑现口径**：P0/P1 每项均有时间线镜头或 E1/E2 验收录屏（「演示镜头」列逐项勾选）；P2 三项（F09/F11/F13）明确降级为「PDF/README 静态展示 + 首页即将上线角标」——这是「有落点、无镜头项」的最低存在形式，不占用任何演示时间。此后任何新增功能必须先填「演示镜头」列，否则不进本方案。

### 1.2 档位与容量结论（5 周 × 3 人 × 80%，负载账本见 §11.2）

- **P0（F01/F02/F03/F04/F06，压缩后共 6.0 人日）**：**有条件必达**——E1（11/2）前 06 §4 既有砍法链（第 1-5 刀）未被触发时，按压缩版全量必达；已触发则按逆价值顺序 F06→F04→F02→F01→F03 收缩（收缩额 = 主线占用回血额的差额，E1 当日由队长宣布）。压缩口径（§11.2 决议 ①）：F01 纯文案页 0.5、F03 两大图 1.5（雷达/词云转国赛）、F04 双视图+收藏 1.0（筛选增强转国赛）、F02 1.0（其中 0.5 来自 T26 打磨日转化，§11.2 决议 ④）、F06 2.0。全部为确定性实现（无新 LLM 依赖、零新表）。
- **P1（F05/F07/F08/F10/F12，共 11.5 人日）**：**容量条件档**——§11.2 负载表显示 W3/W4 在 80% 产能下已满，P1 的落地容量只能来自①既有砍法链回血（11-14 人日）或②实测周产能 >80% 的超产额；两者都未发生时 P1 默认顺延国赛窗口，不宣称「G2/G3 全绿即全量落地」。落地顺序 = F08→F10→F05→F12→F07（§⑩ 第 9/10 刀反序），E2（11/9）按实际落地项验收。
- **P2（F09/F11/F13，共 5 人日）**：默认转入国赛窗口（12/10 注册 - 12/27 提交）。**与档位解耦的省赛必做项**：T52a（student_benefits 案例 30 条，1.2 人日）是 11/8 G4「案例库 150+/verified≥140」验收（修订案 A4）的硬依赖，无论 P2 是否启动都必须完成。T52b（贴士卡任务）/T53/T54 为**条件行**：仅当 11/6 前 G3 全绿且 W4 进度超前 ≥3 人日才启动（§⑪.1 表默认置灰），否则 11/9 G4 判定后顺延国赛。
- **功能增量合计 22.5 人日**（P0 6.0 + P1 11.5 + P2 5.0；另加验收与文档同步 2.0 人日，见 §⑪ T55/T56）。**省赛提交版本（11/18）口径 = 9 条路由（7 既有 + /budget + /settings）+ 3 个 P2 功能「即将上线」角标（省钱贴士/知识课堂/通知中心，国赛窗口补齐）**；能力墙展示「6 大基础 + 3 大 P1 + 3 项 P2 即将上线」，不宣称「省赛 = 10 条路由」（10 条为 A7 设计目标口径，见 §2.1）。
- **扩展闸门**：E1（11/2，随 G3）：P0 中 F01/F02/F03/F06 四项验收 + F04 于 11/4 补验（依赖 T23 卡流稳定，超期并入 E1 收缩评估）；E2（11/9 功能冻结，随 G4）：P1 按实际落地项验收或按砍法表降级；G4 同日判定 T52b/T53/T54 条件行是否点亮。

---

## ② 路由最终清单与各页结构升级

### 2.1 新增 3 条路由（07 §14 的 7 条之上，设计目标共 10 条，修订案 A7）

**分档上线口径（§1.2）**：`/budget`（P1）与 `/settings`（P1）在省赛窗口上线（9 条路由）；`/learn`（P2）默认国赛窗口上线，省赛期间首页能力卡与 /settings 链接显示「即将上线」角标。A7 的「10 条路由」为设计目标口径，不作为省赛提交版本的工作量证据。

| 路由 | 页面 | 档位 | 懒加载 | 首屏 chunk 预算（gzip） | 守卫 |
|---|---|---|---|---|---|
| `/budget` | 预算中心（预算环 / 预测 / 超支贴士 / 快速记账入口） | P1 | `dynamic()` | 含 ECharts core < 300 KB（同 /insights 口径，05 §1.1） | 无账单数据 → redirect `/upload?next=/budget` |
| `/learn` | 消费知识小课堂（案例库浏览 / 知识卡 / 防坑手册） | P2 | `dynamic()` | < 60 KB（静态案例数据，不引 ECharts/DuckDB） | 无 |
| `/settings` | 数据管理与导出（数据集管理 / CSV-JSON 导出 / 通知开关 / 主题入口） | P1 | `dynamic()` | < 60 KB | 无 |

- 每路由配套 `loading.tsx` + `error.tsx`（与 05 §1.1 既有约定一致）。
- `/budget` 若被砍（§⑩ 第 10 刀），路由一并下线，快速记账入口随之隐藏（FeatureFlag `budget`，见 §2.3）。
- 移动端底部 tab bar（05 §4.5 五项：首页/体检/账本/订阅/我的）不变：「我的」指向 `/settings`，`/learn` 与 `/budget` 从首页能力卡与 `/settings` 链接进入，不新增 tab 项。

### 2.2 既有 7 页的结构升级（逐页）

| 页面 | 升级内容 | 对应功能 |
|---|---|---|
| `/` | Hero 大标题（一句话价值主张）+ 主 CTA 下新增「12 大能力」亮点卡墙（六阶段体检/订阅雷达/预算中心/快速记账/年度海报/成就段位/省钱贴士/知识课堂/数据导出/隐私可见/省钱挑战/攒钱目标，A17 增补三卡；其中省钱贴士/知识课堂/通知中心 3 项 P2 能力卡在未启动时标「即将上线」角标，点击展示 README/PDF 静态介绍）；底部技术架构展示条（浏览器 DuckDB-WASM → 服务端 AI 接入层 → MCP 容器的图标化管线图 + 三模型分工一行字）；「继续上次体检」断点条保留（05 §5.3）；3 秒价值动画与滚动动效转国赛窗口（§1.2 压缩口径） | F01 |
| `/upload` | 布局不变；入口卡增加一行「随手记一笔？」文案链接到 `/budget#quick`（快速记账不干扰上传主流程） | F08（引流） |
| `/checkup` | 右栏 ThinkingBubble 下方新增 StageEvidenceDrawer 触发点；阶段产出计数卡在每阶段完成时右侧浮出（「本阶段产出 3 张卡 · 42ms」） | F02 |
| `/insights` | ① 洞察流顶部新增视图切换（卡片流/图表廊）+ 收藏按钮 + 收藏夹面板（F04）；② 账本汇总视图在既有三图（时间序列/donut/商户 bar）下方新增两大图表区（日历热力图/类别桑基，两列栅格，F03；健康雷达/商户词云国赛窗口补位）；③ 年度阶段产出追加「省钱贴士卡」（P2，F09 落地后） | F03/F04/F09 |
| `/subscriptions` | 卡墙化：每卡右上角「下次扣费倒计时」徽标；页顶摘要行增加「年度订阅合计」；取消攻略从折叠引用升级为步骤化操作清单（勾选进度条 + 一键复制操作要点）；卡片支持「设为提醒」（接 F13） | F06 |
| `/report` | 改为滚动式数据故事：Hero 健康仪表 → 6-8 个叙事段（每段 headline + 图 + 叙事，逐段 scroll-reveal）→ 消费段位卡 + 成就徽章墙 → 「生成年度海报」按钮（canvas 合成 PNG 下载）；原「导出 PDF」按钮保留 | F05/F10 |
| `/privacy` | 数据可见性对照表补 3 行（预算/成就/通知/导出数据的可见层级，见 §⑨ 02 改动）；「12 大能力」一览静态版（与首页能力卡同数据源） | 随 F01 |

### 2.3 FeatureFlag 扩展（06 §4 砍法落点，05 §1.1 同源文件）

```ts
// src/lib/feature-flags.ts —— 新增 4 个开关，与既有 ocr/mcp/brush/dark 并列
export const featureFlags = {
  ocr: true, mcp: true, brush: true, dark: true,   // 既有（05 §1.1）
  budget: true,       // F07/F08：砍预算中心时关，快速记账入口随 /budget 隐藏
  reportStory: true,  // F05：砍数据故事时关，回退旧版报告布局
  achievements: true, // F10：砍成就段位时关
  learn: true,        // F11：砍知识课堂时关（路由下线）
} as const;
```

---

## ③ 数据层扩展（存储落点 + 白名单注册）

### 3.1 新表与预计算表（全部遵守 07 §17 红线，逐项裁决）

**① `budgets`（预算表，用户自建配置，非账单明细）**

```sql
-- DuckDB 数据集内（OPFS），与 transactions 同库、随数据集生命周期
CREATE TABLE budgets (
  ym           VARCHAR,      -- '2026-10'
  category     VARCHAR,      -- 12 类之一 或 'total'（总预算）
  budget_cents BIGINT,       -- 金额单位：分（07 §3 全项目唯一金额单位）
  updated_at   TIMESTAMP,
  PRIMARY KEY (ym, category)
);
```

- 存储裁决：落在 DuckDB OPFS（浏览器内、数据集级）。理由：预算引用的是「本数据集账单」的月度类目口径，随数据集走最自然；它不是交易明细、不进 IndexedDB（07 §17 禁止的是明细落 IndexedDB，预算属用户自建配置，走 DuckDB 也不触红线）；规模上限 ≤24 月 × 13 行，无存储压力。
- 规模护栏：写入路径限制「当月 + 未来 2 月」共 ≤3 月 × 13 行可编辑，历史月份只读（防无限膨胀）。

**② `budget_vs_actual`（预算 vs 实际，聚合粒度，注册 ALLOWED_RELATIONS）**

```sql
-- 系统生成、只读、聚合粒度（对齐 07 §3 六阶段预计算表语义）
CREATE TABLE budget_vs_actual AS
SELECT b.ym, b.category, b.budget_cents,
       COALESCE(SUM(t.amount_cents), 0) AS actual_cents,
       ROUND(100.0 * COALESCE(SUM(t.amount_cents), 0) / NULLIF(b.budget_cents, 0), 1) AS ratio_pct
FROM budgets b
LEFT JOIN transactions t ON t.category = b.category
  AND t.direction = 'expense' AND strftime(t.ts, '%Y-%m') = b.ym
GROUP BY b.ym, b.category;
```

**③ `forecast_monthly`（下月预测，聚合粒度，注册 ALLOWED_RELATIONS）**

- 确定性生成：`预测值 = 近 3 月同类目均值 × (1 + 近 3 月环比漂移中位数)`，SQL 常量实现（模板优先，与 03 §1.3 同款纪律）；LLM 只写叙事不产数字。
- 字段：`ym, category, forecast_cents, method`（method 恒为 `seasonal_baseline`，展示层标注「朴素季节外推」）。

**④ 手动记账行（F08）——不建新表，并入 `transactions`（修订案 A3）**

- `source='manual'`、`channel='manual'`、`raw_ref='M#<自增序号>'`、`tx_id=sha256(ts+amount_cents+merchant+序号)`；`direction` 允许 `income`（如「收到红包 200」）。
- 原始输入文本只在内存中转（zod 确认卡渲染），**绝不落盘**（07 §17 禁止项对齐）。

**⑤ 成就 / 收藏 / 通知（UI 偏好与可重算状态，localStorage，修订案 A1）**

| 键 | 内容 | 规模上限 |
|---|---|---|
| `spendct:achievements:v1` | 已解锁成就 ID 列表 + 解锁时间（可随时由聚合视图重算） | ≤2 KB |
| `spendct:fav:v1` | 收藏卡 ID 列表 | ≤2 KB |
| `spendct:notif:v1` | 通知文案缓存 + 已读状态（由确定性规则生成，可重算） | ≤20 KB |

以上键均为「不含任何行数据」的元数据/可重算状态，与 07 §17 允许的「运行元数据、UI 偏好、隐私开关」同类。

**⑥ 年度故事段 / 贴士文本 / 预算建议**：全部走既有 `spendct:llmcache:*`（07 §17 IndexedDB 允许项），零新增存储类型。

**⑦ 导出文件**（F12）：内存生成 → `<a download>`，不落盘、不经服务端。

### 3.2 ALLOWED_RELATIONS 注册（修订案 A2）

新增 3 个 LLM 可查询关系（07 §6 白名单），全部满足 R1-R10（GROUP BY 强制、无明细列投影、单关系、聚合函数 9 个、LIMIT≤50）：

| 关系名 | 类型 | 说明 |
|---|---|---|
| `budgets` | 用户配置表 | 追问/建议任务可查；列 = ym/category/budget_cents（无明细列） |
| `budget_vs_actual` | 预计算表 | 预算建议任务主输入 |
| `forecast_monthly` | 预计算表 | 预测叙事任务主输入 |

同时：手动记账行并入 `transactions` 后自动可被既有白名单覆盖（`source='manual'` 只是新增枚举值，不改变列集），无需单独注册。

---

## ④ 新图表组件归属裁决（页面代码静态渲染 vs ChartSpec 枚举扩展）

### 4.1 裁决：四大新图全部走「页面代码静态渲染」，不扩展 ChartSpec 枚举

日历热力图 `CalendarHeatmap` / 类别桑基 `CategorySankey` / 健康雷达 `HealthRadar` / 商户词云 `MerchantWordcloud` 作为 `/insights` 账本汇总视图与 `/report` 的页面级组件，由确定性 SQL 直出数据 + ECharts 直接渲染。

**分档实施（§1.2/§11.2 决议 ①）**：省赛窗口只实现前两图（CalendarHeatmap + CategorySankey，T42 1.5 人日）；HealthRadar 与 MerchantWordcloud 移入国赛备选池（组件名已在 A7 登记，国赛窗口按本 § 规范原样实现，零重新设计）。本裁决的「不走 ChartSpec 枚举」理由对四图一律成立，不受分档影响。

**理由（裁决依据）**：

1. 07 §4 ChartSpec 是「LLM 声明式图表契约」（`tableId + chartType + dimField + measureFields(1-2) + topN`），设计目的=让 LLM 产出可校验、可渲染、防注入的图表声明。桑基图需要「源维 + 目标维 + 度量」三字段、雷达图需要 ≥3 个维度的多系列语义，均超出 `measureFields 1-2` 的契约形状——**强制塞进枚举会破坏契约的简洁性与 zod 校验强度**。
2. sankey 曾因 #72 从 07 §4 明确删除；重新加回 = 推翻已冻结裁决，违反 07 §0.1 仲裁精神。
3. 四大图在页面中的 SQL、布局、交互都是**固定形态产品**（不像追问答案是动态生成），不需要 LLM 声明——由页面代码实现即「确定性优先」原则的落地（本方案 §0 原则二）。
4. 锚点追问能力不因此丢失：`AnchorSelection` 是 UI 捕获中间态（05 §2.3，`chartId/mode/dataIndex`），与 ChartSpec 无耦合。四大静态组件实现同一捕获接口即可点选锚定——日历格 → `dim: time_month`、桑基节点 → `dim: merchant`、雷达顶点 → `dim: category`、词云词条 → `dim: merchant`，折叠为 SelectionContext 后走既有 `/api/followup`（07 §18 完全复用，零协议改动）。

**对 LLM 的约束（写入 03 §2.6 提示词）**：追问答案的图表（`chartSpec`）仍限于七类（bar/line/pie/histogram/scatter/heatmap/table）；模型不得在答案中引用四大静态图类型；若数据形态更适合四大图 → 拒绝画图（refusal 话术）或改用七类中最接近的表达。

### 4.2 四大图实现规范（05 §3.6 纪律延伸）

| 组件 | 数据源（既有视图，零新表） | ECharts 类型 | 交互 | 色板 |
|---|---|---|---|---|
| `CalendarHeatmap` | `v_daily_expense` | `heatmap`（日历坐标系） | 格点点击锚定（time_month） | 蓝 ramp（05 §3.1.4） |
| `CategorySankey` | `v_category_monthly`（当月环比迁移） | `sankey` | 节点点击锚定（merchant，n≥5 商户还原规则 07 §5） | 8 槽按序取用 |
| `HealthRadar`（国赛窗口） | `v_health_inputs`（六维健康分） | `radar` | 顶点点击锚定（category） | 单系列品牌蓝 |
| `MerchantWordcloud`（国赛窗口） | `v_merchant_monthly`（n≥5 商户还原规则，07 §5） | 自绘 canvas 词云（轻量，~150 行；不引第三方词云库） | 词条点击锚定（merchant） | 8 槽 + 尺寸映射金额 |

- 全部带「数据表」切换按钮（05 §3.6 规则 6，无障碍救济）；词云数据表 = 商户排行表（等价表达）。
- 图表实例计入单页 ≤6 的预算（05 §3.6 规则 9）：四大图懒挂载（IntersectionObserver），与既有三图合计不超限。
- 桑基节点标签仅显示 n≥5 商户还原名，其余显示 `merchantRef`（m_+8hex，07 §5 显示规则不变）。
- 新增 chunk 预算：四大图组件与 ECharts 同 chunk，总计 < 60 KB gzip（复用已引入的 echarts/core，无新依赖）。

---

## ⑤ RAG 类别扩展与案例库扩容计划

### 5.1 新类别 `student_benefits`（学生权益与省钱贴士）

- **定义**：面向学生人群的可核验权益信息——学生认证优惠（外卖/视频/出行）、教育优惠（软件/设备）、校园卡与食堂/图书馆资源、低价替代订阅（学生价/年费拆解）、权益型省钱方法。与既有 7 类（subscription_trap/prepaid_risk/minor_spending/consumer_rights/platform_rule/regulation/spending_advice）并列，成为第 8 类。
- **schema 扩展**（04 §2 case schema，新增两个可选字段）：
  - `benefitTags: string[]`——`student_cert / edu_discount / campus_card / budget_substitute / rights_tip`；
  - `audience: "student" | "general"`——学生类案例标 student，供贴士卡人群过滤（演示账单用户=大学生画像，命中率高）。
- **来源纪律不变**（04 §12 风险表）：来源必须可访问 + 摘录句可对照 + 法条对 gov.cn 原文；`reviewStatus` 双人机制；REVIEW_LOG 留痕。

### 5.2 案例库总量：100+ → 150+（11/8 前完成，06 T12 关联）

| 批次 | 内容 | 时点 |
|---|---|---|
| 既有计划 | 7 类 100+ 条（W2:30 / W3:60 / W4:100+，04 §13） | 不变 |
| 扩容-1 | `spending_advice` +10 条（预算方法/记账习惯，服务 F07/F08 演示） | W3D4-6 |
| 扩容-2 | `subscription_trap` +10 条（消协/黑猫平台新案源，服务 F06 管理墙） | W3D6-W4D2 |
| 扩容-3 | `student_benefits` 30 条（AI 初稿 + 双人校验）——**省赛必做（T52a，与 P2 解耦）**，11/8 G4「150+/verified≥140」验收硬依赖 | W3D5-W4D3 |
| **合计** | **150+ 条**（11/8 前 `verified` ≥ 140） | 随 G4 验收 |

- **T52a/T52b 拆分（§⑪.1）**：案例 30 条入库 = T52a（1.2 人日，R2+R3，省赛必做）；贴士卡任务（tip-personalize + 贴士卡 UI）= T52b（0.8 人日，P2 条件行）。P2 一延期不再连累 150+ 案例目标。
- **人工校验工时入账**：04 §2.2「每周 +4 小时」口径（W3/W4 两周共 8 小时 = 1.0 人日）已计入 06 W3/W4 周表 R3 行与 08 §11.2 负载表（W3 0.5 + W4 0.5）；04 §2.2「可行」结论改为引用 06 周表账本数字（见 §⑨ 同步项），不再单独自证可行。
- 嵌入预计算批次同 04 §13 管线（bge-m3 离线，运行时零嵌入 API 红线 07 §16 不变）；新增 50 条嵌入成本 ≈ ¥0.02（一次性，§14 费用账本内）。
- **检索链路零改动**：SQL 类别过滤 → dense top-30 → rerank top-5 → cite ≤3；`student_benefits` 仅作为新的类别过滤值接入。

### 5.3 评测集裁决：金标 20 条不动，新增补充评测集（修订案 A4）

- 07 §16 的唯一 CI 门槛（golden 20，hit@3 ≥18/20 CI / ≥16/20 G3 / ≥12/20 TF-IDF）**原样保留**——它是既有评测数字的唯一口径，扩容不许污染。
- 新增**补充评测集 `student-golden-8`**（学生权益 8 题，存 `tests/golden/rag-golden-student.json`）：阈值 hit@3 **≥7/8**，与主集分开报告（技术文档写「主集 20 题 hit@3=X、学生权益补充集 8 题 hit@3=Y」）。
- F11 /learn 的浏览搜索复用 TF-IDF 索引，不新增评测维度。

### 5.4 个人化与隐私口径

- 贴士卡检索上下文仅含聚合画像与类别（02 口径不变，04 §12 风险表第 7 行）；案例浏览面为**静态公开投影**（title/summary/category/source/legalBasis/benefitTags），不含任何用户数据。

---

## ⑥ 新 LLM 任务规格书（5 个任务）

> 全部遵守 07 §12 路由纪律、07 §19 AI SDK 纪律（ai@7.0.137、`instructions` 非 `system`、`stream` 非 `fullStream`）、03 §4 三层「生成→校验→修复」闭环（zod 修复 ≤2 次）、缓存键 `llm:v1:${promptVersion}:${modelId}:${sha256(canonicalData).slice(0,16)}`（07 §10）。模型路由写入 07 §12 表（修订案 A5）。

### ⑥.1 quick-entry 快速记账解析（qwen 主，无备用 → 手动表单）

**输入**：`{ text: string(≤200 字), today: "YYYY-MM-DD" }`（正文经 07 §19 注入防护三层处理）。

**输出 zod**（`src/lib/schema/quick-entry.ts` 单一来源）：

```ts
export const QuickEntrySchema = z.strictObject({
  parseable: z.boolean(),
  entry: z.object({
    amountCents: z.number().int().positive().max(1e9),     // 单位：分（07 §3）
    direction:   z.enum(["expense", "income"]),
    category:    z.enum(CATEGORIES),                        // 12 类唯一枚举（07 §3）
    merchant:    z.string().max(30).optional(),
    ts:          z.string().datetime().optional(),          // 缺省 = 今天
    note:        z.string().max(60).optional(),
  }).optional(),
  reason: z.string().max(60).optional(),                    // parseable:false 时给原因
});
```

**提示词要点**：① 金额一律整数分（「15」+「块/元」语境 → 1500 分；「15 万」→ 拒绝）；② 类目词典注入 12 类 + 高频映射（食堂/奶茶→餐饮，地铁→交通，红包/工资→income）；③ 日期缺省取 today，明确日期（「昨天」）才改；④ 非记账文本（闲聊/问句）→ `parseable:false` + 建议；⑤ 严禁编造金额与商户；⑥ 输出纯 JSON。

**失败兜底**：LLM 不可用 / parseable:false → 手动表单（金额空、类别下拉预选 top-1 规则猜测），不阻塞流程；全程 DegradeToast 说明（05 §4.4 表格扩展一行）。
**费用**：≈ ¥0.0005/次，演示路径 < 10 次/天。

### ⑥.2 budget-advice 预算建议（qwen 主，模板兜底）

**输入**：`budget_vs_actual` 行（≤13，聚合粒度、已脱敏）+ `today`。
**输出 zod**：

```ts
export const BudgetAdviceSchema = z.strictObject({
  severity: z.enum(["ok", "warn", "over"]),      // ratio<80% / 80-100% / ≥100%
  headline: z.string().max(60),
  advice:   z.string().max(160),
  actions:  z.array(z.enum(["adjust_budget", "view_detail", "dismiss"])).max(2),
});
```

**提示词要点**：只基于输入数字给方向性建议（「餐饮已用 87%，剩余 ¥X，建议未来 5 天日均 ≤¥Y」——Y 由模板预计算注入，LLM 不自己算）；不虚构外部基准；数字必须来自输入行。
**模板兜底**：阈值规则句（severity 由 ratio 直接判定，headline/advice 用固定句式填充），图表不受影响。
**费用**：≈ ¥0.001/次。

### ⑥.3 forecast-narrative 预测叙事（deepseek 主，模板兜底）

**输入**：`forecast_monthly`（≤13 行）+ 近 3 月 `v_category_monthly` 实际值。
**输出 zod**：

```ts
export const ForecastNarrativeSchema = z.strictObject({
  headline: z.string().max(60),
  narrative: z.string().max(300),
  disclaimer: z.literal("朴素季节外推，仅作参考，不构成建议"),
});
```

**提示词要点**：只讲方向与幅度（「餐饮预计下月 ±X%，主因是近三月均值与漂移」），不得承诺精确金额；必须保留 disclaimer 原文；数字一律来自输入（03 §2.0 铁律 2 延伸）。
**模板兜底**：固定句式「下月 {类别} 预计 {±X}%，基于近三月朴素外推」。
**费用**：≈ ¥0.002/次。

### ⑥.4 tip-personalize 贴士个性化（qwen 主，模板兜底）

**输入**：个人聚合画像（≤10 字段：订阅命中数/夜间占比/餐饮占比/储蓄率等，来自既有视图，脱敏后）+ top-5 检索案例摘要（student_benefits 类）。
**输出 zod**：

```ts
export const TipPersonalizeSchema = z.strictObject({
  tips: z.array(z.object({
    caseId: z.string(),              // 必须来自检索结果（引用白名单后处理复用 04 §5.3）
    why:    z.string().max(40),      // 一句话适配理由
  })).length(3),
});
```

**提示词要点**：caseId 只可从输入中出现过的 ID 中选择（防编造引用，04 §12 风险表第 6 行机制复用）；why 写「对你的适配点」而非复述案例。
**模板兜底**：top-3 直出 + 通用句「这条贴士与你的人群画像匹配」。
**费用**：≈ ¥0.001/次。

### ⑥.5 annual-story 年度故事叙事（deepseek 主，复用 annual 阶段路由）

**输入**：`annual_summary` + `v_yearly`（既有预计算产物）。
**输出 zod**（`src/lib/schema/annual-story.ts`）：

```ts
export const AnnualStorySchema = z.strictObject({
  segments: z.array(z.object({
    order:      z.number().int(),
    headline:   z.string().max(60),
    narrative:  z.string().max(200),
    chartSpec:  ChartSpecSchema,          // 07 §4 七类，模板优先
  })).min(4).max(8),
});
```

**发布闸门复用 07 §4/§20**：每个 segment 数字溯源过 L1（数字必须能在 annual_summary 中找到直接来源）；L2 judge 走既有 reflect 路由（qwen 主/deepseek 降级）；任一 segment 未过 → 该段回退模板段，不影响其他段。
**模板兜底**：固定 6 段模板（年度总览/最烧钱类别/订阅刺客/深夜消费/环比变化/明年一句话），由确定性 SQL 填数。
**费用**：≈ ¥0.008/次（与既有单次体检同量级，见 03 费用估算）。

---

## ⑦ API 裁决（新增端点 or 复用既有 6 条）

**唯一裁决：新增 1 个端点 `/api/ai/task`（POST，JSON），承载 5 个新任务中的 4 个；年度故事走既有 `/api/pipeline/stage`。**

| 任务 | 承载端点 | 说明 |
|---|---|---|
| 年度故事叙事（⑥.5） | `/api/pipeline/stage`（既有） | annual 阶段输出增强，零新端点 |
| quick-entry（⑥.1） | `/api/ai/task`（新） | `taskId: "quick-entry"`，JSON 同步返回 |
| budget-advice（⑥.2） | `/api/ai/task`（新） | `taskId: "budget-advice"` |
| forecast-narrative（⑥.3） | `/api/ai/task`（新） | `taskId: "forecast"` |
| tip-personalize（⑥.4） | `/api/ai/task`（新） | `taskId: "tip-personalize"` |

**裁决理由**：

1. 4 个新任务都是**单次 JSON 请求/响应**（无 SSE 流式叙事需求——它们产短文本卡/结构化 JSON，不是洞察卡主叙事）；塞进 `/api/followup`（SSE + PEO 协议）或 `/api/pipeline/stage`（六阶段 SSE 协议）会污染既有协议语义（07 §2/§18），破坏「协议单一来源」。
2. `/api/ai/task` 仍**只调用 `src/server/ai/*` 模块**（07 §13「唯一 LLM 出口」语义扩展，修订案 A6），复用同一套：zod 三层闭环、wrapTool 降级信封、注入防护三层、LLM 缓存键、模型路由表；密钥/env 清单零新增。
3. 其余端点零改动：`/api/rag` 不变（F09 贴士检索走既有检索链路；F11 课堂搜索走浏览器 TF-IDF，符合 07 §16 公网 tfidf-only 口径）；`/api/mcp/[tool]` 不变；不设任何导出/预算专属端点（导出=浏览器本地，预算=浏览器 DuckDB 计算）。
4. 撤销路径：若 P1 全砍，`/api/ai/task` 删除即恢复 6 端点状态（零残留）。

```ts
// src/app/api/ai/task/route.ts —— 请求体（zod 严格校验）
const AiTaskRequestSchema = z.discriminatedUnion("taskId", [
  z.object({ taskId: z.literal("quick-entry"),      payload: z.object({ text: z.string().max(200), today: z.string() }) }),
  z.object({ taskId: z.literal("budget-advice"),    payload: z.object({ rows: BudgetVsActualRowsSchema, today: z.string() }) }),
  z.object({ taskId: z.literal("forecast"),         payload: z.object({ forecast: ForecastRowsSchema, actual: ActualRowsSchema }) }),
  z.object({ taskId: z.literal("tip-personalize"),  payload: z.object({ profile: ProfileSchema, cases: Top5CasesSchema }) }),
]);
// 响应：{ ok: true, data: <任务 zod 输出> } | { ok: false, error: { code, message } }
// 目录登记：src/app/api/ai/task/route.ts（01 §3 目录树同步）
```

---

## ⑧ 契约修订案清单（A1-A7；A12-A15/A17/A18 追加登记）

> 每案格式：修订条款 / 新裁决 / 理由。全部为对 07 的增量修订，不推翻 07 §0.1 地位；执行时同步到 07 §21 改动索引。

**A1 · 修订 07 §17（持久化红线允许项）**
新裁决：允许项增加——① 用户自建配置（budgets 表）存于 DuckDB OPFS 数据集内（非账单明细、不出浏览器）；② 可重算状态与偏好键 `spendct:achievements:v1` / `spendct:fav:v1` / `spendct:notif:v1` 存 localStorage（≤20KB，不含任何行数据）；③ 快速记账原始输入文本不落盘（内存中转）。禁止项不变。
理由：§17 红线本意是「交易明细不重复落库、盐不跨会话、原始 CSV/截图不持久化」；用户自建配置与可重算状态同属「UI 偏好与元数据」范畴，明确写入允许项避免实现期争议（§①-③ 已逐项对照）。

**A2 · 修订 07 §6（ALLOWED_RELATIONS）**
新裁决：注册 `budgets`（用户配置表）、`budget_vs_actual`、`forecast_monthly`（聚合预计算表）为白名单可查询关系；三类均受 R1-R10 约束；`budgets` 为只读查询（写路径走前端确定性代码，不经 LLM SQL）。
理由：预算建议与预测叙事任务需要 LLM 可查询的数据面；注册即「模板优先 + SQL 白名单」纪律的延续（07 §6 既有 13 视图 + 9 预计算表同语义）。

**A3 · 修订 07 §3（transactions 语义值）**
新裁决：`source` 语义值扩展 `wechat|alipay|ocr|sample|manual`；`channel` 增加 `manual`；`raw_ref` 对 manual 行为 `M#<序号>`；`direction` 允许 manual 行的 `income`。DDL 与 12 类目枚举不变。
理由：快速记账复用唯一明细表（不另建 `manual_entries` 表，避免双表明细合并复杂化与白名单碎片化）；manual 行同样只存浏览器 DuckDB，隐私承诺不破。

**A4 · 修订 07 §16（金标评测口径）**
新裁决：golden 20 与既有三档阈值（18/16/12）保持为**唯一 CI 门槛**；新增补充评测集 `student-golden-8`（hit@3 ≥7/8），与主集分开报告；案例库总量目标 100+ → 150+（11/8 前 verified ≥140）。
理由：主集数字是技术文档与 S7 视频台词的既有口径（#14/#57 裁决），扩容不得污染；补充集独立报告既能证明 RAG 扩容质量，又不推翻已冻结阈值。

**A5 · 修订 07 §12（任务级 LLM 路由表）**
新裁决：路由表增加 5 行——quick-entry 解析（qwen 主，无备用 → 手动表单）；budget-advice（qwen 主，模板兜底）；forecast-narrative（deepseek 主，模板兜底）；tip-personalize（qwen 主，模板兜底）；annual-story（deepseek 主，qwen 降级，并入 annual 阶段任务行）。env 清单零新增。
理由：新任务沿用「叙事 deepseek、轻任务 qwen」的费用纪律（07 §12 裁决理由），降级链全部落到确定性模板，演示稳定优先。

**A6 · 修订 07 §13（服务端 API 端点清单）**
新裁决：端点清单 6 → 7，新增 `/api/ai/task`（POST，JSON，taskId 判别联合，§⑦ 裁决）；「唯一 LLM 出口」语义扩展为「`src/server/ai/*` 仅被 `/api/pipeline/stage`、`/api/followup`、`/api/ai/task` 三个路由调用」；其余 5 端点与语义不变。
理由：新任务为单次 JSON 短任务，复用 followup 的 SSE/PEO 协议会污染协议单一来源（07 §2/§18）；独立端点 + 同一出口模块 = 职责清晰、降级与防护栈零分叉。

**A7 · 修订 07 §14（前端路由树与组件注册表）**
新裁决：路由 7 → 10 条（+ `/budget` `/learn` `/settings`，§②）；组件注册表 13 → 19（增补 `BudgetRing、QuickEntryBar、ForecastChart、CaseCard、DatasetManager、NotificationBell`——为跨文档引用登记，命名不与既有注册表冲突，05 §2.2 规则）。
理由：新页面与新组件需要全局唯一命名与引用锚点；登记而非私造，维持「组件名唯一清单」纪律（#52）。

**A12 · 修订 07 §2/§5/§12/§13/§18（全局智能助理，2026-10-15 裁决）**
新裁决：
- 新增全局智能助理（悬浮入口 + 聊天抽屉，壳层全页面挂载），本地优先混合推理：输入闸门 → 闲聊分流 → 本地规则问答（qa-engine 9 意图 + 白名单 SQL）→ 本地案例检索（阈值 0.15，仅助理；页面引用阈值 0.08 不变）→ 在线兜底（复用 `/api/followup`，**零新端点、零新 env 键**）；追问面板重构为共享问答管线（`use-chat-pipeline`，PEO 协议不变）。
- 事件协议 20 → 21 类：新增 `plan` 事件（goal 非空 + steps 1-4 步，tool 只填 §18 注册表工具名）——A9「20 事件封版」后的首个新增事件，其余 20 类语义不变。
- §12 路由表新增 `assistant-plan` 任务（deepseek，生成超时 8s、失败一律静默跳过——不阻塞回答，仅不展示思考计划块）；§5 脱敏器 `sanitizeResult` 改 async（S2 商户加盐哈希走 WebCrypto `crypto.subtle.digest`）；输入闸门（02 §11.5 第四层：控制字符/超长 + 指令覆盖、角色劫持、泄露诱导、SQL 痕迹四类注入特征，助理与追问面板共用）；语音输入（浏览器语音服务转写，音频不出浏览器，02 §8 第 25 行）。
理由：智能助理不落「直连 API 聊天窗」俗套——本地规则与案例检索先答（零 API 成本、零隐私外发），在线兜底只处理本地答不了的问题且走既有防护栈；本地优先混合推理把 AI 深度落在大模型集成 8% / Agent·工作流 8% / RAG 6% / 多模态 5% / AI 安全 4% / MCP 4% 全维度，而非堆一个通用聊天组件。

**A13 · 修订 07 §14（商户统计视图，2026-10-15 裁决）**
新裁决：
- `/insights` 视图切换器新增第 4 个视图 tab「商户统计」（`?view=merchants`），**路由数不变（仍 10 条）**；页面级组件 `MerchantView` 按两级注册口径登记于 05 §2.2 组件总表。
- 数据口径：按 `merchant` 聚合**全账单**（无时间窗）`direction = 'expense' AND status = 'paid'` 支出——每商户总额（分）、笔数、占全账单支出比（分母 = 全账单 expense 总额）、均笔金额，金额降序。OCR 账单中 merchant 即账单上的支付单位名称（A10 入库口径）。
- 口径修正（2026-10-16 收口审查）：两条 SQL 补 `status = 'paid'` 过滤，退款行不计入商户总额与占比分母（与账本汇总 / qa-engine / 深度分析 A14 的已支付口径一致）。
- 真实动线两条白名单 SQL（页面代码常量，无用户输入，经 runWhitelistedAggregate 双保险）：商户排名（GROUP BY merchant、LIMIT 50）+ direction 分组总额（占比分母）；聚合值按 SELECT 位置取值（07 §6 按位口径）。
- 展示与交互：排名横向条形图前 10 名（完整排名看数据表）；数据表全量（白名单行数上限 50，恰满 50 行时脚注如实标注「按金额取前 50 名」）；商户搜索同步过滤图表与数据表；点击柱子 → 追问锚点（id `merchant-view`，§18 锚点协议不变，无新工具）；数据来源脚注区分「你的账单数据 / 内置数据」。
- 兜底动线：无体检结果或查询失败 → 确定性演示行（`src/lib/insights/ledger-demo.ts`，seed 20261013，与账本汇总同源）浏览器内聚合，零 API 调用；账本汇总的演示行生成器与 ChartCard 外壳提取为共享模块，ledger-view 行为不变。
- 隐私与端点：**零新端点、零新 env 键、无新增网络请求**；视图全程浏览器内计算。
理由：用户真实账单分析需要「每个商户花了多少」的全局视角——账本汇总的商户排行只有前 6 名且固定 90 天窗口，无法回答「这张账单上每个支付单位总共花了多少」；本修订以本地白名单聚合实现（复用 DuckDB 单例与 SQL 白名单，不新增任何外发路径），把可视化深度落在前端工程 20% 与数据驱动叙事上，成本为零 API、零隐私风险。

**A14 · 修订 07 §12/§13（追问深度分析，2026-10-16 裁决）**
新裁决：
- 追问面板新增「深度分析」开关（默认关，aria-pressed 两态 + 开启/关闭提示文案）：开启后本轮提问**跳过闲聊分流/本地规则/本地案例**直连在线兜底 `/api/followup`（**零新端点、零新路由、零新事件**）；关闭态保持 A12 本地优先混合推理不变。每问一次显式同意，延续 A8 同意模式。
- 深度上下文 = A8 在线兜底口径的全期化：`buildDeepAnalysisContext` 10 组代码常量白名单 SQL（数据范围/支出类目/商户 Top10/逐月收支/金额分布/收入类目/深夜冲动占比/订阅候选/收支总额）≤2400 字，加最近 150 笔明细快照分两条消息发送（单条 ≤4000、总预算 8000 不变）；全部 SQL 经白名单文法预检（单测持久回归，与 A13 页面常量同口径双保险），零动态拼接。
- `/api/followup` body 增加 `analysisMode: "standard" | "deep"` 可选字段（schema 校验）；live 追加深度分析指令（放开「三句以内」限制、要求结构化展开、数字必须来自输入上下文）。
- 气泡脚注「深度分析 · 已发送账单统计与明细」（note="deep"），与在线兜底脚注同样式；脚注按实际发送组合标注（2026-10-16 收口审查修正：ChatTurn 增 sentStats/sentDetails，统计与明细都发送时显示合称，缺一段只说发了的那段，live 档同机制）。
- mock 模式 deep 档脚本化演示流（文案不虚构账单数字；deep 档优先于 promo 演示档）。
- 本地大模型端点（用户自备 OpenAI 兼容端点）：env 增加 `LLM_BASE_URL` + `LLM_MODEL`（**同时配置才生效**）+ 可选 `LLM_API_KEY`（07 §12 env 清单 +3）；生效时仅接管 chat 任务——深度分析与在线兜底上下文改发本地端点，账单数据不出本机；叙事/OCR/轻任务路由不变。
理由：用户要求「用 DeepSeek API / 本地大模型直接分析上传账单」——本修订把它落成追问面板的显式同意开关而非常开，既满足深读需求又保留本地优先哲学；全期聚合上下文全部出自白名单 SQL（零动态拼接），隐私出口与 A8 完全一致（不新增数据出口类、不新增网络路径），本地端点则把「数据不出本机」做成配置级能力，双向覆盖 DeepSeek 云端与本地部署两种诉求。

**A15 · 修订 07 §13/§14/§18（追问定向明细检索 + 消费日历 + 订阅雷达降级 + 报告通俗化，2026-10-16 裁决）**
新裁决（用户检验反馈四点逐条回应）：
- **追问定向明细检索（§13）**：deep 档消息组装至多三条——统计段与明细快照段之间插入「定向明细」段。`src/lib/chat/targeted-detail.ts` 纯函数解析问题意图（月份相对词/阿拉伯/中文数字、年份、商户 DB Top50 名单最长匹配、类目 CATEGORY_CODES 枚举、深夜词），SQL 全参数校验（month `/^\d{2}$/`、year `/^\d{4}$/`、商户单引号双写 + 60 字上限、类目枚举），`LIMIT 200`、≤2500 字；空结果诚实文案「本地账单里没有查到与问题直接相关的明细（范围说明）」；失败静默省略回退两条消息。修复用户反馈①的根因：月份标签 String 包裹 bug（`fmtMonth` 传原始 epoch 值 + `toEpochMillis` 微秒/毫秒归一）与快照盲区。
- **明细快照升级（§18 A8 口径修订）**：七列投影（`date_iso` + `strftime` 时分秒 `ts_text` + `category` + `merchant` + `amount_cents` + `direction` + `night_flag` 深夜标记），行格式「YYYY-MM-DD HH:MM:SS 类目 商户 支出/收入¥X.XX 元」+ 深夜行「（深夜）」后缀；LIMIT 150 与唯一明细出口口径不变。
- **/subscriptions 降级 + /calendar 新路由（§14）**：订阅雷达独立页降级为洞察页第 5 视图（`?view=subscriptions`，内容全保留：候选列表/逐笔核对/下次扣费倒计时——06 §6.3 评分口径「实用性 + 社会价值」证据一个不少），原路由改静态重定向；腾出的独立页位置给新路由 `/calendar` 消费日历（日历热力图 + 时间轴流水，用户拍板），日历热力图原为 F03「账本汇总两大图」的省赛规划组件（T42·W3D2-4），A15 提前于排期以独立页形态落地、可复用至账本汇总图表位（加分项）；全站入口（top-nav / 底部 tab / 能力卡墙 / /me 快捷入口）同步。路由总数不变。
- **年度报告通俗化（§14）**：健康指数附大白话总评与「六维健康明细」区块（每维「每 100 元消费里约 X 元用于…」+ 百分比小字 + 状态标签）；四段数据故事改叙事文案；段位与成就百分比改口语化表述——底层计算口径不动，只改展示层（`src/lib/report/labels.ts` + report 页）。
- **商户统计视图升级（§14 A13 延伸）**：A13 商户统计视图升级为「去向排名 / 逐笔明细」双页签（用户反馈②「每个去向的总额统计排名 + 明细」闭环）；逐笔明细行映射纯函数 `src/lib/insights/merchant-detail.ts`、明细直连分页 SQL 常量（零动态拼接）。
- **零新端点、零新事件、零新 env**；路由层面 `/calendar` 新入列、`/subscriptions` 降为静态重定向，静态页总数不变（13 页）。
理由：用户检验反馈（①月份标签与深夜明细不可辨、②要更详细的去向/时间/金额与排名条形图、③报告百分比难看懂、④订阅降为子模块且换更容易服务用户的功能）逐条落地；定向段参数全部来自可信来源，注入面为零，隐私出口仍只有 A8 一条。

**A17 · 修订 07 §13/§14/§17（省钱挑战打卡 + 攒钱目标中心 + 年度海报分享，2026-10-16 裁决）**
新裁决：
- **三个新路由（§14）**：新增 `/challenge`（省钱挑战打卡：挑类目定每日预算、21 天打卡、基线/节省/连续打卡统计）、`/goals`（攒钱目标中心：目标+存入、月结余估算进度、预计达成月+加速建议）、`/poster`（年度海报分享：三款模板+自定义标语、预览/下载/系统分享/复制）。静态页 13 → 16；顶栏入口 5 → 8 项、首页能力墙 10 → 12 卡（同步「12 大能力」口径）。
- **数据口径**：三页全部浏览器内计算——真实数据走既有白名单 SQL（challenge 日聚合、goals 收支/类目月聚合，常量零用户输入，经 runWhitelistedAggregate 双保险 + 单测文法预检）；无体检结果或查询失败 → 确定性演示行兜底（`src/lib/insights/challenge-demo.ts`、goals 复用 ledger 演示口径 seed）。挑战与目标记录存 localStorage 新增两键 `spendct:challenge:v1` / `spendct:goals:v1`（§17 允许项，可重算状态同语义）。
- **poster-input 共享层**：报告页与海报页共用 `src/lib/report/poster-input.ts` 单一口径（年度概览/健康分/指标文案同一数据面）；顺带修复既有 dimScore 结余率维度恒 0 分 bug（higher 维度跨度误用 zeroAt−fullAt 得负值被归零）——跨度按方向分别计算，真实数据健康指数口径与 F10 文档「结余率 40% 以上满分」对齐（A15 通俗化展示层不动）。
- **成就 12 → 13 枚**：新增 `challenge-streak`「七日打卡王」（连续打卡 7 天），全站文案与演示集同步。
- **零新端点、零新事件、零新 env**；无新增网络请求，海报 canvas 全程浏览器本地绘制合成 PNG。
理由：用户反馈④要求两个特色实用功能点（实用、可用），多选三项「省钱挑战打卡/年度海报分享/攒钱目标中心」全部落地，放导航「报告」之后；三页均为本地计算+可持久化状态，复用既有 SQL 白名单与演示兜底纪律，隐私出口零新增，把得分点落在「实用性」与「社会价值」上。

**A18 · 修订 07 §12/§13/§17（问答时间窗修复 + 会话持久化，2026-10-16 裁决；热修复六轮复审修补 2026-10-17 收口）**
新裁决（用户三条 bug 报告逐条回应）：
- **时间窗八类化（§12 本地规则问答）**：`qa-engine` TimeWindow 扩为八类——this_month / last_month / two_months_ago / this_year / last_7d / last_30d / last_90d / specific_month；`WINDOW_WORDS` 顺序敏感匹配补「上上个月/前两个月」（长词先于「上个月」）、「整年/全年/全期/整个账单/全部账单/所有账单」归 this_year；新增 `detectSpecificMonth`（中文 `${word}月` 与阿拉伯 `1-12 月`，十二/十一先于十/一/二）与 `resolveMonthYear`（去年→last、YYYY年→数字、否则 current），specific_month 优先于窗口词；锚点标签继承窗口——追问「占所选时间范围 X%」按锚点口径而非默认本月。修复「整年账单的交通→本月」「1月份交通→本月」「上上个月交通→上个月」错乱。
- **热修复二轮（同案增补，用户复测再报）**：①「上上月打车」仍答成上个月——同一子串碰撞机理，词表补「大上个月」（two_months_ago）与「前三个月/近三个月/最近三个月」（last_90d），并新增弃权规则：三阶及以上月份与含糊多月说法（「上上上个月」「上两个月」「前几个月」）本地绝不猜月、返回 null 转在线兜底（qa-engine 与 targeted-detail 同口径守卫）；②首问掉在线兜底是两类瞬态——恢复飞行中提问（本地答不了→误转在线）与固定总时限误杀 Next dev 首击编译。在线兜底改停滞超时（距最后一次流事件 30s 无活动才中止，慢而健康的流永不被误杀；中断时已有内容保留并追加「回答中断」补注、无内容撤占位补整段提示）；提问前等待会话恢复落定（思考态前置挡住并发提交、恢复等待上限防悬挂——实测刷新后 DuckDB 冷启动恢复约 26s，上限定 60s 盖过健康路径）。新增 stall-timer 单测、弃权解析单测（qa-engine/targeted-detail）、刷新恢复 e2e（restore.spec）。
- **热修复三轮（同案增补，复审工作流 12 条缺陷确认）**：①词表再收口——「前两个月/前三个月」语义有歧义（最近两个月？当年首三个月？「今年前三个月」实测歧义成立），从 two_months_ago/last_90d 词表移出改弃权转在线（修订二轮口径）；「大上月」与「大上个月」同义但含子串「上月」，补入 two_months_ago 词条；弃权正则扩为 12 条词组（上N月/前N月/最近N月/N个月前/裸N个月的中文与阿拉伯写法，N≥2；「最近三个月/近三个月」保留 last_90d 档），覆盖「上两月/前两月/最近三月」等无「个」变体；targeted-detail 命中弃权短语时作废整个计划（不再只跳过相对词、留下类目等槽位生成无月份条件的全期明细）；②停滞计时双阶段阈值——响应前（本地上下文/RAG/schema/主 fetch 含 dev 首击编译，无事件可证明活跃）120s 长窗，首字节后 reset 收紧到 30s 流内停滞窗（stall-timer reset 支持传入新阈值切换）；③闲聊分流提前到恢复等待之前（不再被恢复等待上限拖慢，也不显示「正在读取账单数据」）；④恢复等待上限 15s → 60s——实测刷新后 DuckDB 冷启动恢复约 26s，15s 上限会让恢复飞行中提问被错误放行成「还没有账单数据」；⑤e2e 时钟口径——restore/assistant 两 spec 钉住浏览器时钟 2026-10-14 + Asia/Shanghai 时区（内置账单锚 2026-10-13，测试日期漂移后相对月份断言必挂），restore.spec 刷新后立即提问、洞察卡断言移到用例末尾（恢复飞行中提问瞬态真实参与）。
- **热修复四轮（同案增补，复审工作流聚焦 11 条确认 9 条）**：①弃权正则补漏——裸时长正则去掉负向后顾，改由 `hasUnsupportedMonthPhrase` 先整体剥掉「最近三个月/近三个月」两个词表成员再测试（「最近几个月/近几个月」仍被拦下弃权；「接近三个月」里的「近三个月」前面是汉字不剥、同样弃权——宁可转在线也不猜）；「最近十二月/近十一月」补复合数字 `十[一二]`、「最近几月/前几月/上几月」补「几」（否则被 detectSpecificMonth 截成特定月份或落入本月默认窗）；「一个半月/半个月/半月」补半字时长正则；「大上上月/大上上个月」补 `大上{2,}`（带「大」开头才拦，不误伤合法词条「上上个月」）；②targeted-detail 补 90 天口径——「最近三个月/近三个月」在 qa-engine 有 last_90d 窗才放行、本模块没有，改按本地时钟映射为显式日期范围（今天-90天～今天），既保精确又不弃权；③deep 档闲聊契约——闲聊分流补 `!options?.deep` 守卫，深度分析开关开启时按 A14 契约跳过闲聊直连在线兜底（代码与 07 §13 文档对齐）；④流内停滞窗补服务端心跳——/api/followup 每 10s 发 SSE 注释心跳帧（`: keepalive`），stream-followup 映射为 keepalive 事件让客户端停滞计时重置，LLM 首 token 延迟超 30s 的合法回答不再被误杀；⑤restore.spec 总预算 120s → 240s——用例刻意叠加导入腿 + 恢复上限 60s + 首问 120s 断言窗口，不放宽的话全局超时与断言窗口共享预算会提前触发。
- **热修复五轮（同案增补，用户复测再报三问）**：①deep 档消息总长超 8000 被服务端 zod 拒成 400（「上个月/上上个月」掉在线提示的根因，dev 日志双 400 实证）——RAG 案例参考此前在明细快照预算计算之后拼接、从不计入预算。修复：RAG 提前到预算计算之前，新增 `computeDetailBudget`（deep 三消息单条 3900 上限；standard 统计与快照合并一条，快照预算 = 3900 − 统计段长度）、`buildCaseRefsText`（逐条摘要 120 字、整段 600 字上限）与 HISTORY_RESERVE 1200 预留，快照预算低于 600 时省略快照段；②buildHistoryMessages 重写：本轮问题恒在末尾、不占预算不裁剪（预算为负也不裁问题本体），历史按剩余预算从新到旧装、超 4000 字消息整条跳过；③账单问法被本地案例库抢答（「上上上个月花费多少费用」TF-IDF 0.1698 越过 0.15 阈值，把维权案例答给账单问题）——检索层口径不动（调阈值不可行：账单问法分数带与攻略强相关命中重叠），新增 `bill-signal.ts` 的 isBillQuestion 信号闸门（花费词 ∩ 时间窗词/账单实体词/「花费…多少」正则，三阶月份等弃权短语必拦），案例路径加 `!isBillQuestion` 前置守卫；④在线失败提示分档——SSE error code 链路此前在管线层被丢弃，现捕获 event.code 并新增 `online-failure-text.ts` 按 LLM_EXHAUSTED（未配 key 给配置指引并声明「系统自动接入、无需手动连接」）/TIMEOUT/NETWORK_OFFLINE/HTTP_ERROR/UNKNOWN 分档文案，半截回答追加 onlineErrorNote 补注，全档携带本地可答示例问题；⑤route.ts 把 401/403 归入 LLM_EXHAUSTED（密钥无效或已过期，不可重试）；⑥RESTORE_WAIT_MS 60s → 150s（盖过 DUCKDB_INIT_TIMEOUT_MS 120s 初始化预算，避免恢复飞行中被误判无数据）。新增 bill-signal/online-failure-text 及 chat-context 预算契约单测 15 条（646/646），live 实机验证两动线均 200 流式、内容总长 3996/6763 ≤ 8000、零 console error。
- **热修复六轮（同案增补，复审工作流 48 agents 产出 22 条确认缺陷——4 high / 8 medium / 10 low，全部 2/2 对抗核验通过后逐条修复）**：①**历史预算回归（high）**——五轮的「本轮问题不占预算」新契约在装配点没有扣回问题长，历史装满预算时请求体总长 = 8000 + 问题长、服务端 zod refine 必 400（恰是五轮声称消灭的失败形态）。修复：装配点预算改 `8000 − 已装 − 问题长`；HISTORY_RESERVE 静态预留随之移除（它对溢出无防护、只把快照空间换成历史余量），历史按真实剩余动态预留——满配首问 deep 快照从约 749 字回到约 2420 字；buildHistoryMessages 改先过滤超 4000 字消息再取最近 10 轮（窗口内全是超长条时更旧的合格历史不再被丢弃）；buildCaseRefsText 改码点截断（emoji 不切代理对）且含省略号 ≤600 字；②**信号闸门漏判（high ×2）**——「上上上个月费用是多少/前两个月的费用是多少/三个月前开支多少/这个月账单多少」（费用/开支/账单词族不在花费词表，SPEND 早退使弃权月份规则永不生效）与「有几笔不明扣费怎么办」（正则只认花费词在前、问额词三形）仍被案例库抢答；同时「三个月前健身房跑路，我花了三千办卡，怎么维权」「上个月被乱扣费怎么办」被无条件弃权判真挡出案例路径（本可零 API 命中维权案例）。修复：isBillQuestion 改六档——①无问额词 + 维权叙事词 → 非账单（让位案例库）；②弃权月份 + 金额词 → 账单；③时间窗/账务实体 + 金额词 → 账单（无花费词也判）；④无花费词 → 非账单；⑤时间窗/实体/金额词任一 → 账单；⑥「花费…多少」结构 → 账单。金额词族刻意不含「元/块/钱」（维权叙事里的金额是背景不是查询目标），输入先归一内部空白（「花 了多少」等价「花了多少」）；③**失败分档缺陷（medium ×3 + low ×3）**——LLM_EXHAUSTED 档把 .env.local 运维指引发给终端用户且「无需手动连接」与「请填密钥并重启服务」自相矛盾、401/403 的「密钥无效/过期」被误诊为未配置；402 余额不足/429 限流落 NETWORK_OFFLINE 误导检查网络；HTTP 400 的 zod 英文文案与内部字段路径直出用户气泡且「请稍后重试」对确定性失败误导；TIMEOUT 档把本地阶段停滞归因网络；NETWORK_OFFLINE 档透传服务端 detail 产生「在线服务请求失败（在线服务请求失败）」自重复；UNKNOWN 默认档保留「这个问题需要连接在线服务才能回答」旧句（五轮要淘汰的句式，被单测锁死）。修复：LLM_EXHAUSTED 按服务端消息分「未配置/无效过期」两态、不复写部署路径；新增 QUOTA_EXCEEDED 档（route.ts isQuotaError 判定 402/429）；HTTP 400 按确定性失败提示不劝重试、其余状态码才提示稍后重试、服务端 message 只进控制台不上气泡；TIMEOUT 档不归因网络；网络档忽略 detail；UNKNOWN 换句「在线服务暂时不可用」；④**恢复超时错答（medium）**——恢复等待 150s 超时后仍答「还没有账单数据」（用户账单明明在库里）；修复：submit 记录 restoreTimedOut，超时降级按「读取异常、刷新重试」提示（ENGINE_READ_ERROR_TEXT）而非「先导入账单」；restore.spec 注释 60s → 150s、首问窗口 120s → 180s、总预算 240s → 540s；⑤**测试盲区收口（high ×1 + medium ×3 + low ×2）**——「仍不超总预算」旧断言是 computeDetailBudget 的恒等式（对真实溢出零防护）、案例参考段测试从未触发任何截断分支（删掉截断实现照样全绿）、负例语料系统性避开「月份短语 + 花费词」维权组合与空格变体、3900/600/负值边界无用例、闸门前提未锁定命中案例身份。修复：新增管线级装配断言（历史装满剩余预算 + 本轮问题 ≤ 8000）、6 条满长摘要真实触发整段截断断言、六档正反例与空格变体、三个边界用例、案例命中 pr-001 身份锁定——单测 646 → **658/658**，typecheck / lint 干净，e2e 55 例重跑全绿。
- **追问链路四层配套（§12/§13）**：deep-analysis 固定查询 10 → 11 组（新增类目起止日期查询），类目排行行并入各自最早/最晚支出日期（`「交通」¥963.38 元（89 笔，2026-05-30 至 2026-10-07）`）；targeted-detail 识别显式日期范围 `YYYY-MM-DD 到 YYYY-MM-DD`（双端点校验 + 闭区间，命中时年月槽位让位，日期范围优先于月份检测）；live chat 指令重写——「你正在分析的就是这些数据，只能依据这些数据回答」，删除「我无法访问账单/无法读取文件」式否认措辞，无数据诚实文案保留。修复「2026-01-01 到 2026-05-30 没有交通费用吗→不能确定」「你读取到我的账单记录了吗→没有」两问的根因。
- **刷新会话恢复（§17 允许项唯一例外）**：IndexedDB 账户库 `spendct` 新建 `datasets` store（bookId 主键 + by-txHash 索引，DB_VERSION 2）存最近一次导入的行数据副本；恢复走 importedAt 最大、`restorePromise` 单例防并发、只持久化 upload 源（sample 维持内存态）、lastRun 经 zustand 订阅增量同步；恢复绝不覆盖本会话新导入、失败静默降级、账本删除联动清除（`discardDatasetForBook`）。与 OPFS 同属浏览器内持久层、零新网络出口、零新 LLM 可见数据面——02 §1.1 生命周期不变量改三位置、§5.5 红线加 A18 例外注，逐阶段中间产物仍不落库。
- **零新端点、零新事件、零新 env**；路由与组件注册表零新增（`persistence/pipeline-persistence.ts` 与 `layout/pipeline-restore.tsx` 为既有管线挂载，不立新组件名）。
理由：三条用户反馈指向同一类缺口——①窗口词覆盖不全 + 「上上个月」子串碰撞导致时间范围解析错乱；②追问与深度分析的上下文/指令链没有把「数据就在上下文里、按日期范围作答」钉死，模型便推诿「不能确定/读不到」；③DuckDB 纯内存 + store 内存态使刷新即丢。全部修复落在既有管线内：解析修复零成本，上下文修复不扩大发送面（同白名单纪律），持久化副本严格限定 upload 源且与 OPFS 同侧——隐私出口与可见性对照表零变化。

## ⑨ 各文档改动索引（逐份列出要改的章节）

| 文档 | 改动章节 | 改动内容 |
|---|---|---|
| 01-architecture.md | §1 技术栈锁定表 | 零新增依赖（canvas 导出/词云为原生实现；标注「无新 npm 包」以显成本纪律） |
| | §3 仓库目录树 | 新增 `src/app/budget|learn|settings/`、`src/components/charts/CalendarHeatmap.tsx` 等四组件、`src/lib/schema/quick-entry.ts|annual-story.ts|budget.ts`、`src/app/api/ai/task/route.ts` |
| | §4 env 规范 | 零新增键（A5 声明） |
| | §8 性能预算 | 新增 4 行基准：两大图表（省赛）单图渲染 <250ms；/budget 首屏 <300KB gzip；年度海报 canvas 合成 <2s（1080×1920）；10k 行 CSV 导出 <3s；主包/内存/RAG 基准不变 |
| | §11 评审要点落点表 | 补新功能证据行（预算中心/快速记账/两大图表/年度海报 → 对应评分项与代码位置） |
| 02-data-privacy.md | §2 数据模型 | 补 `source='manual'` 语义值与 manual 行生成规则（A3） |
| | §5.3/§5.4 | 补 `budgets` DDL、`budget_vs_actual`、`forecast_monthly` 定义与白名单注册说明（A2） |
| | §8 数据可见性对照表 | 补 3 行：预算数据（浏览器 only）；预算聚合摘要（LLM 可见，聚合粒度）；成就/收藏/通知/导出（浏览器 only）；表格保持 02 §8 唯一维护点地位 |
| | §10 恶意 SQL 用例 | 补 2 条针对 `budgets`/`budget_vs_actual` 的恶意用例（进 18 条全集，A5 演示子集不变） |
| 03-agent-pipeline.md | §1.3 annual 阶段规格 | 输出增加 AnnualStorySchema 故事分段（⑥.5），预计算清单不变 |
| | §2.6 annual 提示词 | 增加故事分段提示词要点 + 「答案图表仍限七类、不得引用四大静态图」（§④约束） |
| | §10 三模型分工路由表 | +5 行新任务（A5，与 07 §12 同步） |
| | §7 降级链 | 补 4 条新任务降级条目（quick-entry→手动表单；其余→模板兜底） |
| 04-rag-mcp.md | §2.2 产能测算 | 「可行」结论改为引用 06 周表账本数字（W3/W4 每周 +4h 人工校验已入 06 负载账本，不再单独自证可行）；批次任务与 T52a/T52b 拆分对齐（§⑤.2） |
| | §2 案例库 schema | 补 `benefitTags`/`audience` 字段 + 第 8 类 `student_benefits` 定义（§⑤.1） |
| | §4 生产计划 | 100+ → 150+ 批次表（§⑤.2）；嵌入管线不变 |
| | §5 金标评测 | 补 `student-golden-8` 补充集与 ≥7/8 阈值（A4）；主集口径不变 |
| | §13 里程碑 | 补学生权益批次（W3D5-W4D3）与 150 条验收项 |
| 05-uiux.md | §1.1 站点地图/路由表 | 7 → 10 路由 + 守卫 + chunk 预算（§②） |
| | §1.2-1.9 页面布局 | 按 §2.2 逐页升级图更新；新增 /budget /learn /settings 三页完整四态（空/加载/错误/成功） |
| | §2.2 组件总表 | 增补 6 组件 Props/状态（A7）；四大图组件入表 |
| | §3.6 图表规范 | 补四大静态图渲染规范表（省赛两图 + 国赛两图标注，§④.2）与「LLM 答案仍限七类」声明 |
| | §4.5 移动端 | 底部 tab「我的」→ /settings 说明；/budget 移动端单列布局要点 |
| | §6.3 空态文案 | 补 3 条：预算页（「还没有设置预算」）、课堂（「案例库加载中/搜索无结果」）、设置（「暂无数据集」） |
| | §7.2/7.4 演示动线 | 30 秒动线主体不变 + **新增可选动作：时间富余时 /report 滚动一屏（年度故事段逐段浮现+段位卡）**；扩展动线 v2 更新为六段版（两大图+双视图 10s / 快速记账 8s / 预算 10s / 年度故事+海报 10s / 成就一屏 6s / 导出 5s，§⑫.1） |
| | §8.1 验收清单 | 补 E1（11/2 P0 验收）、E2（11/9 P1 验收）两项 |
| 06-roadmap.md | §1.3 任务注册表 | 补 T41-T56（§⑪.1）；T52 拆 T52a/T52b，T52b/T53/T54 条件行默认置灰；T41/T42/T43/T44 压缩工期；T50 依赖去掉 T18；T18 前置裁撤登记（P2 健康指数，回血 1.5 人日） |
| | §1.3 档位说明段 | 同步「P0 有条件必达 + 压缩版 6.0」「P1 容量条件档」「T52a 与 P2 解耦、省赛必做」口径（§1.2） |
| | §3.2/§3.3 周表 | 补负载账本（§11.2 表）：T10 雷达 SQL 1.0 口径、T13 OCR 移 W4、T16 与 T28 合并部署；**T26 转化口径写死：只转化 0.5 人日、只用于 F02 证据抽屉四态、11/5 打磨日执行、保留 ≥1.5 个打磨日不动，违反即触发 R15**；04 §2.2 人工校验 8h（W3/W4 各 +4h）写入 R3 行 |
| | §6.1 README 第 4 节 | 「12 大能力」总览加 P2「即将上线」角标口径（省赛 12 路由+3 角标，A17 增补三路由） |
| | §6.2 视频分镜 | S4.5 3:00-3:43（两图+双视图收藏+管理墙 3s）、S5 3:43-4:30、S8 6:55-7:18 条件台词（P2 未启动改口「账单体检，不止六项」）；E2 素材加成就墙 |
| | §4 砍范围规则表 | 插入新增功能砍法行（§⑩）；第 7 刀 F09 行的「T52 任务部分」改为「T52b」 |
| | §6.1 README 大纲 | 第 4 节功能清单补 P0/P1/P2 新功能标注 |
| | §6.2 视频脚本 | 更新为 S1-S10 分镜（§⑫.2） |
| | §6.3 PDF 大纲 | 章节与页数调整（§⑫.3） |
| | §6.6 材料关键日期 | 补 11/2（E1 素材）、11/8（E2 素材前置录制）、11/10（30 分钟补拍窗口）节点 |
| | §7 测试与验收 | 补 A11：新功能回归清单（预算 SQL/导出/两大图渲染——国赛两图落地后追加/快速记账 zod 用例） |
| | §8 风险登记册 | 补 R15（新功能挤压主线工期，对策=砍法表 §⑩）、R16（案例库 150 条校验负担，对策=双人分批 + AI 初稿） |
| 07-canonical-contract.md | §21 改动索引 | 增补「08 修订案 A1-A7、A12、A13、A14、A15」条目并指向本文档（A1→§17、A2→§6、A3→§3、A4→§16、A5→§12、A6→§13、A7→§14、A12→§2/§5/§12/§13/§18、A13→§14、A14→§12/§13、A15→§13/§14/§18）；**A7 附分档口径：省赛提交版本 = 9 条路由 + 3 个 P2「即将上线」角标，国赛窗口补齐 10 条** |
| 01-architecture.md | §3 仓库目录树 | 新增 `src/app/challenge|goals|poster/` 三路由、`src/components/challenge|goals|poster/`（ChallengeView/GoalsView/PosterStudio）、`src/lib/insights/challenge-sql.ts|challenge-demo.ts|challenge-store.ts|goals-sql.ts|goals-store.ts`、`src/lib/report/poster-input.ts`（A17） |
| 02-data-privacy.md | §8 数据可见性对照表 | 补 2 行：挑战/目标记录（浏览器 only，localStorage `spendct:challenge:v1` / `spendct:goals:v1`，可重算状态同语义）；三新页零新网络出口、零新 LLM 可见数据面（A17） |
| 03-agent-pipeline.md | （零改动） | A17 与 LLM 管线零交集：三新页无新任务、无新提示词、无降级链变更 |
| 04-rag-mcp.md | （零改动） | A17 与 RAG/MCP 零交集 |
| 05-uiux.md | §1.1 站点地图/路由表 | 静态页 13 → 16（+ /challenge /goals /poster）；顶栏入口 5 → 8 项 |
| | §1.2 页面布局 | 三新页完整四态（空/加载/错误/成功）与响应式要点 |
| | §2.2 组件总表 | 增补 ChallengeView、GoalsView、PosterStudio 三组件 Props/状态（A17） |
| | §7.2/7.4 演示动线 | 可选动作补「/challenge 打卡一笔、/poster 下载一张」；能力墙 12 卡口径 |
| 06-roadmap.md | §6.1/§6.3 | 能力总览「12 大能力」、成就「13 枚」；评分口径落点补三新功能（实用性/社会价值证据） |
| | §7 测试与验收 | 测试基线更新：单测 600（46 文件）；e2e 47 → 54（+3 新页 spec、+3 游客页、+1 顶栏跳转，最终以全量回归实测为准） |
| 07-canonical-contract.md | §21 改动索引 | 增补「08 修订案 A17」条目（→§14 路由、§17 两新键、§21 各文档条目）并指向本文档；§17 允许项补 `spendct:challenge:v1` / `spendct:goals:v1`；文末版本行升 v1.10 |
| 01-architecture.md | §3 仓库目录树 | 新增 `src/lib/persistence/pipeline-persistence.ts` 会话恢复模块与 `src/components/layout/pipeline-restore.tsx` 壳层挂载组件（A18） |
| | §4 env 规范 | 零新增键（A18 声明） |
| 02-data-privacy.md | §1.1 生命周期不变量 / §5.5 持久化红线 | 明细数据三位置：内存、DuckDB OPFS、IndexedDB datasets store（会话恢复副本，A18）；§5.5 红线补 A18 唯一例外注（只存 upload 源、账本删除联动、恢复不覆盖新导入、失败静默降级）；文末版本行升 v1.8 |
| 03-agent-pipeline.md | （零改动） | A18 与 Agent 管线零交集：live chat 指令措辞修订属代码层（07 §13 口径），03 无提示词文本镜像 |
| 04-rag-mcp.md | （零改动） | A18 与 RAG/MCP 零交集 |
| 05-uiux.md | §2.10 全局智能助理 | 问答时间窗口径补八类时间窗（本月/上月/上上个月/今年/最近7天/最近30天/最近90天/指定月份）+ 锚点标签继承口径（A18） |
| 06-roadmap.md | §6.1/§6.3/§7 | README 功能清单智能助理条目补 A18 注；AI 深度逐条落点表智能助理/追问深度分析两行补 A18 落点（qa-engine 时间窗、deep-analysis 11 组、targeted-detail 显式日期范围、pipeline-persistence 模块）；PDF §4.9 深度分析口径 10 → 11 组；§6.3 智能助理行补弃权转在线口径（热修复二/三/四/五轮：双阶段停滞阈值 + 服务端心跳 + 账单问题信号闸门 + 在线失败提示分档；六轮复审修补：信号闸门六档化 + 失败分档再修 + 历史预算先扣问题长）；测试基线更新：单测 658、e2e 55 |
| 07-canonical-contract.md | §21 改动索引 | 增补「08 修订案 A18」条目（→§12 时间窗八类、§13 深度上下文/定向明细/指令、§17 datasets store 允许项唯一例外、§21 各文档条目）并指向本文档；§17 允许项/禁止项补 A18 增补；§18 A12 信号闸门条目补六档规则口径；§21 05 条目 12 追加热修复增补说明（弃权规则 + 停滞超时 + SSE 心跳 + deep 闲聊契约 + 五轮：信号闸门/明细预算含 RAG 参考/失败分档/问题恒在/恢复等待 150s + 六轮复审修补：历史预算先扣问题长/静态预留移除/闸门六档化/QUOTA_EXCEEDED 新档/恢复超时按读取异常/单测 658）；文末版本行升 v1.12（含复审修补） |

---

## ⑩ 砍法顺序更新（新功能并入既有砍法链）

**更新后全链**：MCP → OCR → 框选 → 银行CSV → 中断追问 → **新增 P2（F11→F09→F13）** → **新增 P1（F10→F05→F12→F08→F07）** → 后备订阅雷达。

**定位理由**：既有 5 刀（06 §4）保护的是评分下限（AI 深度 35% 主证据），新增功能全部排在其后——**新功能绝不先于核心 AI 能力被砍**；P0 五项（F01/F02/F03/F04/F06）为承诺交付档，不进砍法表（进 E1/E2 闸门验收），与「六阶段流水线」享受同等待遇但**不进入永不砍清单**——极端情况下（G2 失败需全盘收缩）P0 按逆价值顺序 F06→F04→F02→F01→F03 由队长+全员一致决定才砍。

**新增砍法行（写入 06 §4 表，序号 6-10）**：

| 优先级 | 砍掉 | 保留/降级为 | 回血工期 | 影响评分项与预估分损 | 执行动作 |
|---|---|---|---|---|---|
| 6 | F11 知识小课堂（/learn） | 案例库仅作 RAG 数据源（雷达/贴士引用），不再做浏览产品 | 2 天 | RAG 6% 展示面收窄；实用性 -0.5 → **-0.5~1 分** | 关 flag `learn`，路由下线 |
| 7 | F09 省钱助手（贴士卡，T52b） | student_benefits 案例保留入库（T52a 省赛必做，不砍），贴士个性化任务与卡片删除 | 0.8 天 | RAG 6% 的新增证据面减少 → **-0.5~1 分** | 关贴士卡渲染与 tip-personalize 任务 |
| 8 | F13 通知中心 | 提醒信息并入页面内静态提示（订阅卡倒计时徽标保留） | 1 天 | 实用性 -0.5 → **0~0.5 分** | 删通知铃与 notif 键 |
| 9 | F10 成就段位 / F05 年度海报（二选一或全砍） | 报告保留旧版布局（HealthIndexGauge + 指标卡）；段位/海报删除 | 二选一 2 人日；全砍 4 人日（T50 2 + T46 2；已投入部分不回收） | UI 4% 丰富度 -0.5 → **0~0.5 分** | 关 `achievements`/`reportStory` |
| 10 | F12 数据管理（导出）/ F08 快速记账 / F07 预算中心 | 依次砍；F07 砍时 `/api/ai/task` 只剩 tip-personalize 一行，随 F09 一并删除恢复 6 端点 | 1.5+2.5+3.5 天 | 实用性 -1（F12）/ 大模型集成结构化输出证据 -0.5~1（F08）/ 功能密度与实用性 -1~2（F07） | 关 `budget` flag；路由与端点下线 |
| 合计（最大回血） | 砍法链全砍（含后备） | 恢复顺序=反序（国赛窗口） | **二选一口径 ≈29.3 人日；全砍口径 ≈31.3 人日**（各刀取上限：2+4+1+2+5+2+0.8+1+第9刀2或4+7.5+2；第 9 刀全砍比二选一多回 2 人日；已投入部分不回收） | 分损合计以 04 §10.2 / 本表为唯一口径，砍伐当日重评 | 砍后剩余负载须回到每人每周 ≤5.6 人日（06 §1.3.1 负载表），与 §11.2 底线算术联动 |

**规则不变**：一次砍一级、砍决定只在闸门日做（E1 判 P0、E2 判 P1、G4 判 P2）；**永不砍清单不变**（六阶段流水线、3 卡闭环、SQL 聚合白名单、沙箱四件套、注入三层防护、脱敏器）；恢复顺序=反序（国赛窗口：F07→F08→F12→…→F11）；每次砍伐 24 小时内同步 05/06 文档降级小节与 PDF 对应章节。

---

## ⑪ 工作量汇总与容量结论

### 11.1 新任务注册表（T41-T56，写入 06 §1.3）

| ID | 任务 | 线 | 工期 | 负责人 | 依赖 |
|---|---|---|---|---|---|
| T41 | 首页营销页升级·纯文案版（F01：Hero 一句话主张+能力卡墙+架构条；3 秒动画/滚动动效转国赛） | F | W3D1 · 0.5 人日 | R1 | T23 |
| T42 | 账本汇总两大图表组件 + 锚定接口（F03：日历热力图+类别桑基；雷达/词云转国赛备选池） | F | W3D2-4 · 1.5 人日 | R1 | T2, T23 |
| T43 | /insights 双视图+收藏（F04；筛选增强转国赛） | F | W4D1-2 · 1.0 人日 | R1 | T23 |
| T44 | /checkup 证据抽屉与产出卡（F02：W3D6-7 核心 0.5 人日 + 11/5 打磨日四态 0.5 人日，来自 T26 转化，§11.2 决议 ④） | F | W3D6-7 · 1 人日 | R1 | T22 |
| T45 | 订阅管理墙（F06） | F+D | W3D4-6 · 2 人日（R1 1.0 + R2 1.0） | R1+R2 | T10 |
| T46 | 年度数据故事+海报导出（F05） | F+D | W4D2-4 · 2 人日 | R1+R2 | T5, T23 |
| T47 | 预算表+预计算视图+白名单注册（F07 数据层） | D | W4D1-2 · 1.5 人日 | R2 | T2 |
| T48 | 预算中心页+预测图+超支贴士 UI（F07） | F | W4D3-5 · 2 人日 | R1 | T47 |
| T49 | 快速记账解析任务+录入 UI（F08） | D+F | W4D2-4 · 2.5 人日 | R2+R1 | T6 |
| T50 | 消费段位与成就系统（F10；段位改 v_health_inputs 纯规则判定，不依赖 T18——T18 已前置裁撤，§11.2 决议 ②） | F+D | W4D3-5 · 2 人日 | R1+R2 | T5 |
| T51 | 数据管理与导出页（F12） | F | W4D4-6 · 1.5 人日 | R1 | 与 T28 并行 |
| T52a | student_benefits 案例 30 条（省赛必做，11/8 G4「150+/verified≥140」硬依赖；AI 初稿 + 双人校验，校验工时含 04 §2.2 每周 +4h 口径） | D | W3D5-W4D3 · 1.2 人日 | R2+R3 | T12 |
| T52b | 贴士卡任务（F09：tip-personalize + 贴士卡入洞察流 + 预算页侧栏）【条件行·默认置灰】 | D+F | W4D3-4 · 0.8 人日 | R2+R1 | T52a, T23 |
| T53 | 消费知识小课堂 /learn（F11）【条件行·默认置灰】 | F | W4D5-7 · 2 人日 | R1 | T52a（数据） |
| T54 | 站内通知中心（F13）【条件行·默认置灰】 | F | W4D6-7 · 1 人日 | R1 | T45, T48 |
| T55 | 新功能回归与性能复测（两图/导出/预算 SQL/zod 用例） | D+F | W4D7 起 · 1 人日 | 全员 | 各功能 |
| T56 | 扩展功能文档/PDF/README 同步（A1-A7 落地） | M | W5 · 1 人日 | R3 | 各功能 |

**条件行点亮规则（T52b/T53/T54 共用，写入 06 周表时默认置灰）**：仅当「11/6 前 G3 全绿 且 11/6 站会确认 W4 进度超前 ≥3 人日」两个条件同时成立时点亮；11/9 G4 复核未点亮项一律顺延国赛窗口。点亮前不占 W3/W4 负载账本（§11.2 负载表不含此三行）。

**人员互换预案（06 §1.3.1 结论 5，10/27 站会确认后即生效，生效时同步本节负责人列）**：T45/T49 的 D 部分转 R2 全量承担（R1 只在 UI 联调介入）；T52a 案例校验转 R3（R3 材料线 W3 有余量）；T10 雷达 UI 联调转 R2 自查 + R3 人工验收兜底。

（线别与既有注册表同口径：D=数据管线/AI，F=前端交互，M=材料。）

### 11.2 容量核算（诚实口径，底线算术三选一）

**总量盘点（不回避）**：

- **总容量**：5 周 × 3 人 × 80%（期中考试折扣，06 §1.2）= 12 人周 ≈ **60 人日**。
- **既有 T1-T40**：约 66-70 人日（已超订 6-10，靠 06 §4 砍法链调节，回血 11-14 人日 → 52-59）。
- **本方案增量（修订后）**：功能实现 **22.5 人日**（P0 压缩版 6.0 + P1 11.5 + P2 5.0）+ 验收/文档 2.0（T55/T56）= 24.5；其中**省赛必做增量 = P0 6.0 + T52a 1.2 + T55/T56 2.0 = 9.2**，P1（11.5）为容量条件档，P2 国赛部分 3.8 默认顺延。
- **不诚实的旧口径已废弃**：「P0 9 人日必达」「省赛 = 10 条路由、56 项任务全量」「P0 靠 W3-W4 前端等待窗口消化」——§11.2 负载表显示 W3 的 R1 正扛 T25 锚点主线，不存在等待窗口；R2 的 T10+T11+T12+T13 原排期本身超 5.6 人日/周，新功能不可能「并行消化」。
- **A17 三功能已直接落地（2026-10-16，不计入上表负载）**：/challenge、/goals、/poster 三页为省赛提交前已完成的增量（组件 ChallengeView/GoalsView/PosterStudio + 数据层 + 单测/e2e 已齐），不占用 W3-W5 负载账本行和；T56 文档同步范围相应扩至 A17。

**底线算术三选一（本节唯一口径，三者组合执行）**：

- **决议 ① P0 压缩 9 → 6 人日（已采纳）**：F03 四大图减为两图（-1.5，雷达/词云转国赛备选池）；F01 简化为纯文案页（-1.0，3 秒动画/滚动动效转国赛）；F04 砍筛选增强（-0.5）。压缩后 P0 = F01 0.5 + F02 1.0 + F03 1.5 + F04 1.0 + F06 2.0 = 6.0。
- **决议 ② 从既有 T1-T40 点名裁撤（部分采纳）**：**T18 消费健康指数（1.5 人日，W4 富余项）前置裁撤**——F10 段位改 `v_health_inputs` 六维分纯规则判定，零损失；候选回血名单（按需在闸门日启用，不破坏「砍决定只在闸门日」铁律）：T13 OCR 3.5（砍法第 2 刀）、T16 MCP→Function Calling 2.0（砍法第 1 刀）、T10 雷达后备 2.0（仅极端）。
- **决议 ③ 「P0 必达」降级为「P0 有条件必达」（已采纳）**：仅当 E1（11/2）前 06 §4 砍法链未被触发时成立；已触发则按 F06→F04→F02→F01→F03 收缩，收缩额 = 主线占用回血额的差额。
- **决议 ④ T26 转化口径写死（已采纳，写入 06 §3.3，违反即触发 R15）**：T26 打磨名额只转化 **0.5 人日**、只用于 **F02 证据抽屉四态**（组件复用度高、最贴主链路，且仍是打磨范畴），在 11/5 打磨日执行；**保留 ≥1.5 个打磨日不动**（W4 两个 + W5 两个共 4 个打磨日只消耗 0.5 人日，余 3.5 人日照常只做错误态/加载态/空态）。

**每周 × 每人 × 任务负载表（修订后承诺版；行和 ≤ 5.6 人日/周 = 每人周容量 80%）**：

| 人/周 | W3（10/27-11/2） | W4（11/3-11/9） | W5（11/10-11/17） |
|---|---|---|---|
| **R1** | T25 锚点交互 4.0｜T41 F01 纯文案版 0.5｜T44 F02 核心 0.5｜T10 雷达卡 UI 0.5 = **5.5** | T27 拦截日志视图 1.0｜T28 部署（R1 份额）1.5｜T43 F04 双视图+收藏 1.0｜打磨日×2（11/5、11/7）1.6｜T44 F02 四态（T26 转化 0.5，11/5 打磨日）0.5 = **5.6** | 打磨日×2 1.6｜T39 视频录制（演示）1.5｜bug 修复 0.5｜T55（R1 份额）0.3｜G5 预检 0.6 = **4.5** |
| **R2** | T11 追问 PEO 3.2｜T12 RAG 检索（R2 份额）1.2｜T10 雷达 SQL 1.0｜T52a（R2 份额）0.2 = **5.6** | T14 沙箱 1.3｜T15 脱敏 1.5｜T13 OCR 1.5｜T16 MCP+免费容器（与 T28 合并部署）1.0｜T52a（R2 尾）0.2 = **5.5**（11/8-11/9 安全/断网演练为全员闸门日，计入 80% 折扣） | bug 修复+备用录像 0.8｜性能终测+金标最终评测 1.5｜T55（R2 份额）0.4｜G5 预检 0.6 = **3.3** |
| **R3** | T12（R3 份额：案例库冲刺+嵌入跑批）1.4｜金标调参+接线 0.8｜T52a（R3 份额·AI 初稿）0.5｜扩容-1/2 案例 0.8｜人工校验（04 §2.2 每周+4h）0.5｜材料常规 0.3 = **4.3** | 扩容-2 尾 0.4｜student-golden-8 制定 0.3｜人工校验（+4h）0.5｜T52a（R3 尾）0.3｜截图 fixtures 0.3｜T38 PDF 初稿 1.0｜T37 README 80% 0.8｜T34 恶意 SQL 终稿+注入 fixture 0.4｜打磨日×2 1.6 = **5.6** | T39 导演+剪辑 2.0｜T38 PDF 二/三稿 1.5｜T37 README 定稿 0.5｜T56 文档同步 1.0｜G5 预检 0.5 = **5.5** |

（W1/W2 沿用 06 §2 逐日表不变；P1 的 T46-T51 未进本表——见下方场景算术。）

**容量闭合场景算术（对上面负载表求和）**：

- **场景 A（砍法链零触发、产能=80%）**：既有 66-70 + 省赛必做增量 9.2 = 75.2-79.2，超容 15.2-19.2。缺口恰与「P1 11.5 + P2 国赛部分 3.8 = 15.3」同量级 → **P1 默认顺延国赛，P0+T52a+T55/T56 兜住**；P1 的落地额度全部来自砍法回血或超产（每超产 5% ≈ 全队每周 +3 人日），E1 当日按实测产能宣布可落地项（F08→F10→F05→F12→F07 顺序）。
- **场景 B（砍法链全触发）**：既有 52-59 + 9.2 = 61.2-68.2；砍 P1 全部（11.5）→ 49.7-56.7 ≤ 60 → **P0+T52a 在任何闸门结果下都能兑现**，最坏情形剩余缺口约 3-4 人日由负载表 W5 余量（R1 1.1 + R2 2.3 ≈ 3.4）吸收，仍不足则触发决议 ③ 收缩 P0。
- **场景 C（极端：G2 失败全盘收缩）**：决议 ③ 生效，P0 按 06 §4 已定义的逆价值顺序由队长+全员一致决定收缩。

**结论（三句话）**：

1. **省赛承诺 = P0 压缩版 6.0 + T52a 1.2 + T55/T56 2.0（共 9.2 人日，有条件必达）**；P1（11.5）为容量条件档，落地额度 = 砍法回血 + 超产额；P2 默认国赛，T52b/T53/T54 条件行点亮前不占账本。
2. **本方案不再使用「前端等待窗口」与「吸收打磨名额」作为未量化的消化路径**：前者与 06 周表冲突（W3 R1 扛 T25 主线），已删除；后者以决议 ④ 量化（0.5 人日、仅 F02、余 3.5 个打磨日不动）。
3. **若 G2/G3 触发既有砍法**：按 §⑩ 顺序先砍新功能，任何情况下不牺牲 never-cut 六项、性能预算与隐私红线；砍伐后 24 小时内同步 05/06/PDF（06 §4 规则 4）。
- **工作量体现口径（对评委可核实的诚实版）**：扩展后全项目任务注册表 56 项（T1-T56，其中 T52 拆为 T52a/T52b 两个独立验收项）；省赛提交 = 9 条路由 + 3 个 P2「即将上线」角标（A7 设计目标 10 条，国赛补齐）；19 个注册组件 + 页面级组件按 05 §2.2 表单列（约 16 个）；150+ 条案例（11/8 verified≥140，金标主集 20 + 学生权益补充集 8 分开报告）；5 个新 LLM 任务；图表组件省赛 2 个（日历热力图/类别桑基）+ 国赛 2 个（雷达/词云）；全局智能助理 3 组件（AssistantDrawer/ChatBubbles/PlanBlock，A12 两级注册）+ 语音输入；商户统计视图（MerchantView，A13 页面级，/insights 第 4 视图）；追问深度分析（A14：面板开关 + 全期白名单聚合上下文 + 本地端点 env，零新端点/零新路由）——每项均有验收标准与评分落点（§① 表），P0/P1 每项均有演示镜头（§①「演示镜头」列），作为 PDF/README「工作量与内容充实度」的量化证据。

---

## ⑫ 演示动线 / 视频分镜 / PDF 大纲更新建议

### 12.1 演示动线（05 §7.2/§7.4 更新）

- **30 秒评委动线主体不变**（05 §7.2）——核心叙事（一键示例→六阶段→卡流→订阅雷达→锚点追问→隐私）是评分主证据，新功能不挤占；**新增一个可选动作（修订 05 §7.2）**：时间富余时在 /report 滚动一屏——年度故事段逐段浮现 + 段位卡入镜，让评委亲手看到 AnnualStorySchema 分段叙事，这是本方案 AI 深度增量价值最高的证据（对应 §⑨ 05 同步项）。
- **§7.4「60 秒扩展动线」v2**（时间富余时按序加；P1/P2 未落地项自动跳过）：
  1. 账本汇总两大图+双视图（10s）：日历热力图/类别桑基两连切 + 点选桑基节点锚定 + 卡片流/图表廊切镜带一次收藏勾选（F03+F04）；
  2. 快速记账（8s）：「中午食堂 15」→ zod 确认卡 → 入账 → 账本即时可见（F08）；
  3. 预算中心（10s）：预算环 + 超支贴士卡（AI 建议）+ 下月预测（F07）；
  4. 年度数据故事+海报（10s）：/report 故事段逐段 scroll-reveal（annual-story 分段叙事，AI 深度主镜头）→ 一键生成 PNG 海报（F05）；
  5. 成就段位一屏（6s）：成就墙一屏 + 徽章弹出一枚（F10，UI 设计 4% + 前端交互 3% 的落点镜头——评委看不到就等于没做，故单列 6s）；
  6. 数据导出（5s）：CSV/JSON 导出 + 隐私提示（F12）。
- **F09/F11/F13（P2）不进任何动线**：PDF/README 静态展示 + 首页「即将上线」角标（§① 表「演示镜头」列）；T52b/T53/T54 点亮后才考虑 60s v2 加映。
- 演示控制台（`?` 键，05 §7.3）增加「跳转新功能」快捷键组（b=预算、l=课堂、s=设置）。

### 12.2 演示视频分镜更新（06 §6.2，总长 6'30"-7'30" 上限不变）

| 镜头 | 时间码 | 内容 | 变化 |
|---|---|---|---|
| S1 开场记忆点 | 0:00-0:30 | 不变（两记忆点） | 无 |
| S2 上传 | 0:30-1:00 | 不变 | 无 |
| S3 六阶段 | 1:00-2:00 | 不变（固定带 2s 证据抽屉特写——点开阶段卡出该阶段 SQL/命中数/耗时，F02 镜头） | 素材微增 |
| S4 洞察卡流 | 2:00-3:00 | 不变 | 无 |
| **S4.5 账本两大图+双视图+管理墙** | 3:00-3:43 | 日历热力图/类别桑基两连切 + 桑基节点锚定 + 卡片流/图表廊切镜带一次收藏勾选 + **尾 3s 订阅管理墙一瞥（倒计时徽标+攻略清单，F06 镜头）** | **新增**（原四大图口径随 §11.2 决议 ① 压缩为两图；雷达/词云国赛） |
| S5 锚点追问 | 3:43-4:30 | 原 3:00-4:30 共 90s，压缩至 47s（S4.5 扩容 3s） | 压缩 |
| **S5.5 预算+快速记账** | 4:30-5:10 | 「中午食堂 15」→ zod 确认卡入账 → 预算环 → AI 超支贴士（口播点：确认卡金额/类目/时间 = **大模型结构化输出**，非模板匹配） | **新增** |
| S6 注入拦截 | 5:10-6:10 | 原 4:30-5:30 顺延 | 顺延 |
| S7 真实数据 | 6:10-6:55 | 原 5:30-6:15 顺延；数字表补「新 LLM 任务 5 个」「案例库 150 条」——口径 = 已落地任务实计数，未落地任务标注「国赛窗口」（与 S8 条件台词同口径） | 顺延+扩表 |
| S8 结尾 | 6:55-7:18 | 不变（补一句「十个能力，一个账单」；**条件注释：P2 未提前启动（默认情形）时改口「账单体检，不止六项」，字幕与口播同步替换**） | 台词微调（条件版） |

- 若 P1 被砍：剪回 S1-S8 旧版（06 §6.2 原表即后备素材，零返工）。
- 素材触发点：E1（11/2）录两大图/订阅管理墙/证据抽屉；**E2 素材 11/8 晚前置录制（预算/记账/海报/成就墙「功能开/功能关」双版本，成就墙含徽章弹出 = 60s v2 第 5 项 F10 镜头素材）+ 11/10 30 分钟补拍窗口**；与 06 §9.4 滚动录制纪律一致。

### 12.3 PDF 大纲更新建议（06 §6.3，总页数 ≤30 不变）

| 章 | 页数调整 | 内容调整 |
|---|---|---|
| 4 AI 技术方案 | 8 → 8 | 新增 4.8「扩展 AI 任务路由表」半页：quick-entry 解析 zod 图 + 预算建议/预测叙事/贴士个性化一行一卡（对应修订案 A5/A6）；4.4 RAG 节补「案例库 150 条 + 学生权益补充评测集」 |
| 5 核心功能实现 | 4 → 5 | +1 页：预算中心/快速记账/年度海报截图（实用性证据）；两大图表（日历热力图/类别桑基）小样入既有图表页（雷达/词云标注「国赛窗口」）；P2 三项（贴士/课堂/通知）以静态截图+「即将上线」标注呈现 |
| 6 测试与部署 | 3 → 3 | 性能基准表补 4 行（§⑨ 01 改动）；数据导出与数据集管理一句带过 |
| 8 社会价值 | 2 → 2 | 案例库分类数据图补第 8 类 student_benefits；成就/段位作为「消费健康」叙事补充 |
| 附录 | 页数不变 | 代码位置表补 5 个新文件锚点 |

- 正文页预算：26 → 27 页（第 5 章 +1），封面+目录压缩 1 页腾挪，总 ≤30 页硬上限不变。
- 评分口径表（06 §6.3 唯一口径表）不重写；新功能证据按既有子项落位（§① 表「评分落点」列）。

---

*本文档完。修订案 A1-A7 经 07 §0.1 评审通过、A12/A13 于 2026-10-15、A14/A15 于 2026-10-16 裁决后同步 07 §21 改动索引；任何一方修改本方案字段，需按 §⑨ 索引同步对应文档并跑一次既有回归（`pnpm test` + `rag:eval`）。*




