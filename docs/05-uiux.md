# 05 界面与交互设计（SpendCT）

| 项目 | 内容 |
|---|---|
| 文档编号 | 05 / 06（本文件负责界面交互，06 负责路线图） |
| 版本 | 1.8（v1.0 随 07 契约冻结；v1.1 落实 08 功能扩展增量 A1-A7；v1.2 落实 08 修订案 A12 全局智能助理；v1.3 落实 08 修订案 A13 商户统计视图；v1.4 落实 08 修订案 A14 追问深度分析；v1.5 落实 08 修订案 A15 订阅管理视图 + 消费日历 + 年度报告通俗化；v1.6 落实 08 修订案 A17 挑战/攒钱/海报；v1.7 落实 08 修订案 A19 验证码+登录墙+合并去重+手动记账+成就真实判定+文案收敛；v1.8 全站收敛「去重」操作字样；schema/事件/路由/组件名以 07 为准、扩展以 08 §⑨ 索引为准） |
| 日期 | 2026-10-16 |
| 负责人 | 前端交互成员 |
| 上游决策 | 产品定义（2026-10-13 已确认，本文档不推翻、只落地） |

---

## 0. 文档说明

### 0.1 本文档负责的范围

本文档负责 SpendCT 的**全部界面、组件、交互协议与设计系统**，覆盖七件事：

1. 页面清单与信息架构（页面 10 个 / 路由条目 11 条：目的 / 布局分区 / 核心组件 / 状态 / 路由；既有 7 条 = 07 §14 唯一清单（原 /ledger 并入 /insights 账本汇总、/about 更名 /privacy，#46），新增 3 条 = 08 修订案 A7（/budget /learn /settings，08 §②），08 修订案 A15 新增 /calendar、/subscriptions 改静态重定向（订阅管理降级为 /insights 第 5 视图））；
2. 组件树与可复用组件清单（组件名 / Props 概要 / 状态 / 用到的其他组件，含 TS 类型与 zod schema）；
3. 设计系统（配色、字体、间距、圆角阴影、图标、ECharts 主题与图表配色规范）；
4. 关键交互规范（锚点追问协议、打标反馈动画、流式节流与性能约束、加载/骨架屏/降级、移动端）；
5. AI 交互体验细则（真实思考状态可视化、拒绝画图话术、断点续跑入口、全局智能助理（悬浮入口 + 聊天抽屉，08 修订案 A12））；
6. 无障碍与细节打磨（键盘导航、对比度、空态文案示例）；
7. sample-data 演示动线（评委 30 秒完整体检路径）。

**评分落点映射**：评分细则唯一口径表 = 06 §6.3（全项目唯一，#26），本文不再自写拆分。本文对应关系：UI 设计 4% → §3；前端交互 3% → §4、§6；AI 交互体验 3% → §4.3、§5；交互模式创新（创新性 25% 内 7 分）→ §4.1、§0.4 原则一；AI 安全与可控性 4% → §3.6、§5.2、§6.5；性能优化 3% → §4.3；实用性 10% / 社会价值 10% → §7、§5.2。

### 0.2 读者与使用方式

| 读者 | 关注章节 | 使用方式 |
|---|---|---|
| 前端交互成员 | 全部 | 照此实现；§2 的 TS 类型与 zod schema 直接进 `src/` |
| 数据管线 / AI 成员 | §2.3（数据契约）、§4.1.1（上下文 JSON）、§5.1（事件协议） | 生成侧与消费侧同源 import 07 契约唯一来源文件（07 §0.4），字段必然一致 |
| 材料成员 | §7（演示动线）、§6.3（空态文案）、§8.2（落点索引） | 演示视频分镜与 PDF 技术文档插图的素材底稿 |
| 评委（PDF 读者） | §0.4、§3.1、§4.1、§5、§7 | 本文档是 30 页 PDF「核心功能实现 / 创新点」的底稿 |

### 0.3 与其他文档的接口对齐

| 本文章节 | 对端文档 | 契约内容 | 变更规则 |
|---|---|---|---|
| §1、§2 | 01 技术总纲 | App Router 路由结构、客户端/服务端边界、性能基准（10k 行清洗耗时 / WASM 加载时间） | 路由与 chunk 划分以本文 §1.1 为准；指标数值以 01 为准 |
| §2.9 PrivacyBadge | 02 数据与隐私 | 「数据可见性对照表」是唯一数据源（`src/lib/privacy/visibility.ts` 由 02 维护）；商户名 merchantRef（`m_`+8hex，07 §0.3）、金额分箱的显示格式 | 以 02 为准；merchantRef 格式见 07 §0.3，渲染端明文还原规则见 07 §5（该商户笔数 ≥5 且用户开开关） |
| §2.3、§4.1、§5.1 | 07 契约 | `InsightCardSchema` = 07 §4 insight-card@v1、`PipelineEvent` = 07 §2 spendct协议@2（21 类事件，plan 为 08 修订案 A12 增补第 21 类）、`PlanStep[]` = 07 §18 | schema 与事件以 07 为唯一来源（src/lib/schema/insight-card.ts、src/lib/protocol/events.ts）；本文只 import 不复制，任何变更走 07 契约评审（#4/#33/#60） |
| §2.4、§2.8 引用 | 04 RAG 与 MCP | 引用 ref 格式 = 07 §4 CitationSchema：`sql:${table\|view}:${tableId}` / `rag:${caseId}` / `tool:${toolName}`；取消攻略引用渲染 | ref 格式以 07 §4 为准；caseId 取值由 04 评测集编号提供 |
| §1.1 FeatureFlag、§8.1 闸门 | 06 路线图 | W2 最小闭环闸门、W4 错误态周、砍法（MCP/OCR/框选）的 UI 显隐 | 砍哪个功能，本文 §1.1 的 flag 就关哪个 |
| §1.1 路由与 flag、§2.2 组件表、§3.6 四大图 | 08 功能扩展 | 路由 7→10、组件注册表 13→19（修订案 A7）、四大静态图组件、FeatureFlag 新增 4 开关（08 §2.3）、新 LLM 任务 zod schema（08 §⑥） | 08 §⑨ 索引逐条落实；新增组件命名遵守 A7 与本文 §2.2 不重名纪律 |

### 0.4 核心设计原则（实现中一切交互的最高判据）

1. **AI 先体检、用户审阅追问**。主界面是洞察卡流（非聊天窗）；AI 产出的是「可审阅的结论」而非一句回答。每个结论必须可确认、可质疑、可深挖。
2. **真实思考，不放假的动画**。思考面板只渲染真实事件：正在执行的 SQL、检索命中的案例、模型流式文本。禁止伪造进度百分比、禁止空转的「思考中」动画；没有 AI 事件时，进度条展示的是确定性任务的真实进度（如「已清洗 3,214 / 10,000 行」）。
3. **每答必落图**。锚点追问的答案必须产出图表或结构化制品（表格/指标卡），与正文洞察卡同构、可继续锚定；答不出图就明确拒绝并说明原因（§5.2）。
4. **降级透明、永不白屏**。任何 AI/网络/SQL 失败都有明确 UI 表达与内置兜底（模板叙事、备用模型、sample-data），错误边界 + 降级提示条是全局标配。
5. **隐私可见**。界面持续回答「我的数据此刻谁在看」：全局 PrivacyBadge 实时反映数据可见层级；商户名在提示词与思考面板中永远只显示 merchantRef（`m_`+8hex），渲染端仅当该商户笔数 ≥5 且用户开启开关时还原明文（07 §5，#15）；金额按 02 规则分箱（07 §5 S1）；思考面板展示的 SQL 是聚合 SQL 本体（白名单校验通过的产物），以此建立信任。

---

## 1. 页面清单与信息架构

### 1.1 站点地图、路由与全局 Shell

```
首页 /  ──┬── 上传页 /upload ── 体检运行页 /checkup ── 洞察流 /insights
          │                                            （含账本汇总/商户统计/订阅管理视图，原 /ledger 与 /subscriptions 并入）
          ├── 消费日历页 /calendar（日历热力图 + 时间轴流水）★08 修订案 A15
          ├── 年度报告页 /report（滚动数据故事 + 年度海报 + 段位成就）
          ├── 预算中心 /budget（预算环 / 快速记账 / 下月预测）★08 修订案 A7
          ├── 消费知识小课堂 /learn（案例库浏览 / 知识卡 / 防坑手册）★08 修订案 A7
          ├── 数据管理与导出 /settings（数据集 / 导出 / 通知开关）★08 修订案 A7
          └── 隐私说明页 /privacy
```

路由与 chunk 预算（Next.js App Router，版本以 01 锁表 16.4.0 为准；路由清单 = 07 §14 既有 7 条（#46）+ 08 修订案 A7 新增 3 条，共 10 条为 A7 设计目标口径；08 修订案 A15 新增 /calendar、/subscriptions 改静态重定向（页面总数仍 10、路由条目 11）；08 修订案 A17 新增 /challenge /goals /poster 三路由（路由条目 14）；**08 修订案 A19：登录墙**——11 个数据功能页全部 AuthGuard 包裹，游客访问重定向 `/login?next=<原路径含查询串>`、登录后回跳原页；公开页仅 / /login /register /learn /privacy 五页；上表「守卫」列 = 登录墙之下的数据层守卫（两层守卫：先登录墙、后数据守卫）。**分档口径（08 §1.2）：省赛提交版本 = 9 条路由（/learn 国赛窗口补齐）+ 3 个 P2「即将上线」角标**。每路由配套 `loading.tsx` + `error.tsx`）：

| 路由 | 页面 | 懒加载 | 首屏 chunk 预算（gzip） | 守卫 |
|---|---|---|---|---|
| `/` | 首页 | `dynamic()` | < 60 KB（不引 ECharts / DuckDB） | 公开 |
| `/login` | 登录页（账号密码 + 图形验证码 canvas 自绘，08 修订案 A19） | 静态 | < 40 KB | 公开 |
| `/register` | 注册页（同上，验证码失败自动换图 + 清空输入） | 静态 | < 40 KB | 公开 |
| `/upload` | 上传页 | `dynamic()` | 含 DuckDB-WASM 加载器，按需注入 | 登录墙（A19） |
| `/checkup` | 体检运行页 | `dynamic()` | 同上 | 登录墙（A19）；无账单数据 → redirect `/upload?next=/checkup` |
| `/insights` | 洞察流主页面（历史洞察 / 账本汇总 / 商户统计 / 订阅管理，视图内切换，吸收原 /ledger 与 /subscriptions） | `dynamic()` | 含 ECharts core < 300 KB | 登录墙（A19）；无体检结果 → redirect `/upload` |
| `/calendar` | 消费日历页（日历热力图 + 时间轴流水，全程浏览器内计算零 API，08 修订案 A15） | `dynamic()` | 含 ECharts core < 300 KB（HeatmapChart / CalendarComponent / VisualMapComponent） | 登录墙（A19）；无体检结果 → 确定性演示行兜底 |
| `/subscriptions` | 静态重定向 → `/insights?view=subscriptions`（原订阅雷达页降级为洞察第 5 视图，08 修订案 A15） | 静态 | 无 | 重定向目标受登录墙 |
| `/report` | 年度报告页 | `dynamic()` | 同上 | 登录墙（A19）；需体检完成且 ≥ 3 个月数据，否则 redirect `/insights` |
| `/challenge` | 省钱挑战打卡（挑类目定每日预算 / 21 天打卡 / 基线·节省 / 手动记今日支出，08 修订案 A17/A19） | `dynamic()` | < 60 KB（近 7 天柱条为 CSS 绘制，不引 ECharts） | 登录墙（A19） |
| `/goals` | 攒钱目标中心（08 修订案 A17） | `dynamic()` | < 60 KB | 登录墙（A19） |
| `/poster` | 年度海报分享（三模板 / 标语 / 下载 / 系统分享，08 修订案 A17） | `dynamic()` | < 60 KB（canvas 本地合成，不引 ECharts） | 登录墙（A19） |
| `/privacy` | 隐私说明页（原 /about 更名） | 静态 | < 40 KB | 公开 |
| `/budget` | 预算中心（预算环 / 预算 vs 实际 / 下月预测 / 超支贴士 / 快速记账入口） | `dynamic()` | 含 ECharts core < 300 KB（同 /insights 口径） | 登录墙（A19）；无账单数据 → redirect `/upload?next=/budget` |
| `/learn` | 消费知识小课堂（案例库浏览 / 知识卡 / 防坑手册；国赛窗口补齐，省赛版本以首页 P2「即将上线」角标呈现） | `dynamic()` | < 60 KB（静态案例数据，不引 ECharts/DuckDB） | 公开 |
| `/me` | 个人中心（账户信息 / 成就墙 13 枚 / 体检次数，08 修订案 A1/A19） | `dynamic()` | < 60 KB | 登录墙（A19） |
| `/settings` | 数据管理与导出（数据集管理 / CSV-JSON 导出 / 通知开关 / 主题入口） | `dynamic()` | < 60 KB | 登录墙（A19） |

- `/budget` 若被砍（08 §⑩ 第 10 刀），路由一并下线，快速记账入口随之隐藏（FeatureFlag `budget`，见下）；`/learn` 随 FeatureFlag `learn` 关闭下线（08 §⑩ 第 6 刀）；`/subscriptions` 自 08 修订案 A15 起为静态重定向，任何旧链接直达 `/insights?view=subscriptions`（订阅管理内容全保留，见 §1.8）。**A19 登录墙与数据层守卫为两层**：游客一律先到登录墙（重定向 `/login?next=`），已登录用户再走各页「守卫」列的数据层校验；`/upload?sample=1` 等带查询串的入口登录后按 next 原样回跳（样例装配继续生效）。

关键实现约定：

- DuckDB-WASM 只在上传/体检路由按需加载，`dynamic(() => import("@/lib/duckdb/provider"), { ssr: false })`，client-only（规避 01 文档记载的 SSR 集成摩擦，W1 spike 验证）；
- ECharts 按需引入（`echarts/core` + 仅用到的 chart/renderer/component），禁止整包 `import * as echarts from "echarts"`；
- 路由守卫在客户端 layout 中执行，避免服务端读 localStorage：

```tsx
// src/components/app/route-guard.tsx —— 守卫用 next/navigation redirect()（07 §14；react-router <Navigate> 是 bug，#22）
"use client";
import { redirect } from "next/navigation";
export function RouteGuard({ require, children }: {
  require?: "data" | "checkup" | "report" | "budget";
  children: React.ReactNode;
}) {
  const importStatus = useDatasetSlice((s) => s.importStatus);   // 6 slice 别名（07 §14，#51）
  const checkupDone = usePipelineSlice((s) => s.status === "completed");
  if (require === "data" && importStatus !== "ready") redirect("/upload");
  if (require === "budget" && importStatus !== "ready") redirect("/upload?next=/budget");
  if (require === "checkup" && !checkupDone) redirect("/upload");
  return <>{children}</>;
}
```

**全局 Shell**：顶部导航（Logo「消费CT」、分段导航 体检/账本/日历/报告/挑战/攒钱/海报（账本 = /insights 内账本汇总视图，订阅管理 = /insights 第 5 视图、不占导航项，「订阅」→「日历」/calendar，08 修订案 A15；挑战/攒钱/海报三入口为 08 修订案 A17 新增，8 项入口的 md 断点宽度预算见 top-nav.tsx 注释）、右侧 PrivacyBadge、NotificationBell 通知铃（F13 落地后）、主题切换、演示模式 badge）；移动端（< 640px）顶部只留 Logo + PrivacyBadge + 主题切换，导航收进底部 tab bar（首页/体检/账本/日历/我的）；**「我的」指向 `/settings`**（08 修订案 A7）；`/budget` 与 `/learn` 不新增 tab 项，从首页「12 大能力」卡墙与 `/settings` 链接进入（08 §2.1）；`/challenge`、`/goals`、`/poster` 同样不占 tab 位，从首页能力卡进入（08 修订案 A17）。全局右下悬浮「智能助理」入口（AssistantDrawer：悬浮入口 + 聊天抽屉，任何非登录页可用；聊天抽屉桌面 400×600 面板、移动端全屏，08 修订案 A12，详见 §2.10）；移动端悬浮按钮与底部 tab bar 共存，同为 44×44 触控目标。

**FeatureFlag（砍法落点，与 06 联动）**：

```ts
// src/lib/feature-flags.ts —— 06 路线图宣布砍什么，这里就关什么，UI 自动隐藏入口
// 新增 4 开关与既有并列（08 §2.3）；砍伐顺序 = 08 §⑩ 新功能砍法链（第 6-10 刀）
export const featureFlags = {
  ocr: true,     // W3 截单点：未完成 → 上传页隐藏截图入口
  mcp: true,     // W4 截单点：未完成 → MCP 三工具隐藏，仅浏览器两工具 duckdb_meta/sql（07 §18）
  brush: true,   // 框选追问：未完成 → 图表仅点选锚定
  dark: true,    // 暗色主题：未完成 → 仅亮色
  budget: true,       // F07/F08：砍预算中心时关，快速记账入口随 /budget 隐藏（08 §⑩ 第 10 刀）
  reportStory: true,  // F05：砍数据故事时关，回退旧版报告布局（§1.10 旧布局即兜底，08 §⑩ 第 9 刀）
  achievements: true, // F10：砍成就段位时关（08 §⑩ 第 9 刀）
  learn: true,        // F11：砍知识课堂时关（/learn 路由下线，08 §⑩ 第 6 刀）
  voice: true,        // A12 智能助理语音输入（Web Speech 浏览器转写）：关闭或浏览器不支持时隐藏麦克风入口
} as const;
```

**状态管理划分**：6 个 Zustand slice 别名 = 07 §14 唯一清单（pipeline/cards/anchor/dataset/ui/session，#51），本文后续代码一律用这 6 个名字：

| Store / 层 | 职责 | 关键字段 |
|---|---|---|
| `pipeline` slice (Zustand) | 流水线状态、事件流缓冲、洞察卡列表、断点 | `status: PipelineStatus, events: ProtocolEvent[], cards, runState`（07 §1/§2/§17） |
| `cards` slice (Zustand) | 洞察卡与答案卡渲染层 | `cards, withheldCards`（withheld = 复核区，07 §4） |
| `anchor` slice (Zustand) | 锚点追问会话 | `state: AnchorFollowUpState, history: FollowUpTurn[]` |
| `dataset` slice (Zustand) | 账单元信息、筛选条件 | `datasetTxHash, meta, filters, importStatus`（07 §0.3） |
| `ui` slice (Zustand) | 主题、演示模式、隐私层级 | `theme, demoMode, privacyLevel, flags` |
| `session` slice (Zustand) | 会话快照（`/api/followup` 每次请求随行，07 §18） | `sessionSchema` |
| TanStack Query | 服务端数据（RAG 引用详情、取消攻略、MCP 日历/天气/大促） | `queryKey: ["rag", caseId]` / `["mcp", tool, args]`，staleTime 5min，datasetTxHash 命中则不发请求 |

以下每页按统一格式：目的 / 布局分区 / 核心组件 / 状态（空、加载、错误、成功）/ 路由。

### 1.2 首页 `/`

- **目的**：3 秒讲清「AI 账单体检」是什么，一键进入体验。示例数据 CTA 优先级最高（评委无需真实账单）。
- **布局分区**：
  ```
  ┌────────────────────────────────────────────┐
  │ Hero：大标题「给你的账单做一次 AI 体检」        │
  │   Hero 一句话主张（F01 纯文案版，压缩口径）：    │
  │   「AI 先体检 / 你审阅追问 / 账单本地处理」      │
  │   （3 秒逐字价值动画转国赛，08 §11.2 决议 ①）   │
  │   [加载示例账单（脱敏数据，一键体验）]  ← 主 CTA │
  │   [上传我的账单]  [观看 30 秒演示]           │
  ├────────────────────────────────────────────┤
  │ 三承诺条（图标+一行字，保留）：                │
  │   🔒 明细默认不出浏览器 · 👁 追问时可见统计与明细 · ✅ 每条结论你审阅 │
  ├────────────────────────────────────────────┤
  │ 「12 大能力」亮点卡墙（2×6 栅格；滚动动效转国赛）：│
  │   六阶段体检/订阅雷达/预算中心/快速记账/年度海报/  │
  │   成就段位/省钱贴士/知识课堂/数据导出/隐私可见/   │
  │   省钱挑战/攒钱目标（A17 增补三卡）              │
  │   （点击跳对应页面；P2 项带「即将上线」角标）     │
  ├────────────────────────────────────────────┤
  │ 技术架构展示条（图标化管线图）：                │
  │   浏览器 DuckDB-WASM → 服务端 AI 接入层 →      │
  │   MCP 容器 + 三模型分工一行字（deepseek 叙事 /   │
  │   qwen 轻任务 / deepseek-flash OCR 主+glm4v 降级，07 §12） │
  ├────────────────────────────────────────────┤
  │ 六阶段预览（横向 mini stepper，静态，保留）      │
  └────────────────────────────────────────────┘
  ```
- **核心组件**：`HeroCta`、`PromiseStrip`、`CapabilityCardWall`（12 卡，与 /privacy 静态版同数据源；订阅雷达卡 href → `/insights?view=subscriptions`，08 修订案 A15；海报卡 href → `/poster`，08 修订案 A17；滚动动效转国赛，08 §11.2 决议 ①）、`TechArchStrip`（纯静态图标化管线，无新依赖）、`MiniPipelinePreview`（复用 PipelineStepper 的只读形态）。
- **状态**：
  - 空：首访即正常态，无空态（CTA 永远可用）；
  - 加载：点击示例账单 → 按钮变「正在准备数据…」+ 进度条（DuckDB-WASM 下载/初始化进度，见 01 的 WASM 加载基准），完成后自动跳 `/checkup`；
  - 错误：WASM 加载失败 / 断网 → 错误卡「示例数据加载失败：{原因}」+ [重试] [直接观看演示视频]；
  - 成功：自动跳转 `/checkup`。能力卡按 FeatureFlag 显隐：`budget/reportStory/achievements/learn` 关闭时对应卡片灰显「即将上线」（08 §2.3）。
- **路由**：`/`。检测到未完成断点（§5.3）时，Hero 下方浮出「继续上次体检」条。

### 1.3 上传页 `/upload`

- **目的**：账单进入。截图 OCR 是第一入口（必做），CSV 第二，示例账单兜底。低置信度字段标黄人工确认。
- **布局分区**：
  ```
  ┌──────────────┬─────────────────────────────┐
  │ 左 40%：入口卡 │ 右 60%：解析预览             │
  │ [账单截图 OCR] │  ① 字段映射确认表（嗅探结果）  │
  │ [CSV 文件]    │  ② 低置信度单元格黄底+角标     │
  │ [示例账单]    │  ③ 去重提示（去掉 N 条重复）   │
  │ 格式说明      │  ④ [开始体检 →]             │
  │ 「随手记一笔？」│  （F08 引流，不干扰上传主流程） │
  └──────────────┴─────────────────────────────┘
  ```
- **核心组件**：`UploadDropzone`、`OcrDropzone`、`ParsePreviewTable`（黄底=低置信度）、`SampleDataCard`、`FormatSnifferBadge`（微信/支付宝版本嗅探结果）、`QuickEntryLink`（文案「随手记一笔？」→ `/budget#quick`）。
- **状态**：
  - 空：三入口可选；示例账单始终可用；
  - 加载：CSV 解析中（「正在嗅探格式：微信账单 v2.1…」）；OCR 识别中（图片上传 → 识别进度 → 低置信度标黄）；DuckDB 导入中（行数进度条，10k 行分片，§4.3）；
  - 错误：格式不支持（列出现支持清单：微信/支付宝各 1-2 个实测版本，提示「可尝试 AI 解析预览，需人工确认字段」）；OCR 失败（重试 / 转 CSV 入口 / 示例账单）；文件超限；
  - 成功：确认字段映射 → [开始体检] → `/checkup`。
- **路由**：`/upload`，支持 `?next=` 回跳。

### 1.4 体检运行页 `/checkup`

- **目的**：六阶段流水线可视化 + 真实思考状态面板。这是「AI 技术深度」最直观的展示窗口。
- **布局分区**：
  ```
  ┌────────────────────────┬──────────────────┐
  │ 左 60%：PipelineStepper │ 右 40%：         │
  │  ①清洗 ②消费画像 ③异常  │  ThinkingBubble    │
  │  ④订阅扫描 ⑤环比归因    │  执行中 SQL（滚动） │
  │  ⑥年度报告（垂直步骤卡） │  RAG 命中案例      │
  │  阶段摘要/产出计数       │  流式叙事文本      │
  │  点开阶段卡 → 证据抽屉    │  [本阶段证据 ▾]    │
  │ [暂停] 断点提示条        │  ←StageEvidenceDrawer 触发点（F02）
  └────────────────────────┴──────────────────┘
  ```
- **核心组件**：`PipelineStepper`、`ThinkingBubble`、`CheckpointBar`（暂停/续跑/断点时间）、`StageSummaryCard`、`StageEvidenceDrawer`（该阶段 SQL / 命中数 / 耗时 / 产出卡缩略，只渲染真实 `stage:evidence` 事件）、`StageOutputBadge`（阶段完成时右侧浮出「本阶段产出 3 张卡 · 42ms」计数卡）。
- **状态**：
  - 空：直接进入即开始跑（无空态）；未授权访问由守卫拦截；
  - 加载/运行：阶段卡片依次点亮；ThinkingBubble 事件流滚动（§5.1）；洞察卡发布时右侧浮出「新洞察 +1」计数；每阶段完成 → StageOutputBadge 浮出（「本阶段产出 N 张卡 · Xms」），2s 后收进该阶段摘要卡；阶段卡点开 → StageEvidenceDrawer 展开该阶段证据（§5.1 第 6 条）；
  - 暂停：当前阶段灰显「已暂停 · 进度已保存」，[继续] [放弃]；
  - 错误：单阶段失败 → 该阶段卡片红标 + 展开错误详情 + [重试该阶段] [跳过继续]；整体失败 → DegradeToast 说明已切换的兜底（模板叙事/备用模型）；
  - 成功：全部完成 → 3 秒倒计时自动跳 `/insights`（可点「立即查看」）。
- **路由**：`/checkup`。刷新页面时按 datasetTxHash 检测断点（§5.3）。

### 1.5 洞察流主页面 `/insights`（产品主界面）

- **目的**：「AI 先体检、用户审阅追问」的载体。洞察卡流是唯一主内容区，**不是聊天窗**；追问只在已发布的卡上锚定发生（§4.1）。
- **布局分区**：
  ```
  ┌──────────────────────────────┬─────────────┐
  │ 工具行：视图切换[卡片流|图表廊|  │ 追问对话区    │
  │  账本汇总|商户统计|订阅管理]·   │（Collapsible │
  │  收藏夹面板入口（FavoritesPanel）│  Panel，     │
  │ 筛选行：阶段 chips · 置信度开关 │ 有活跃会话时 │
  │  · 日期预设 · 类别 combobox    │ 展开 360px）  │
  │ 卡片流（桌面 2 列 / 移动 1 列）：│             │
  │  InsightCard × N（流式发布）   │             │
  │  每卡：结论/证据图/置信度/引用/  │             │
  │  确认·质疑·深挖·收藏           │             │
  └──────────────────────────────┴─────────────┘
  ```
- **核心组件**：`InsightCard`、`InsightViewToggle`（五视图切换：卡片流 / 图表廊 / 账本汇总 / 商户统计 / 订阅管理——`?view=merchants` 08 修订案 A13、`?view=subscriptions` 08 修订案 A15）、`FavoritesPanel`、`FavoriteButton`（收藏卡，写 `spendct:fav:v1`，08 修订案 A1）、`InsightFilterBar`（阶段 / 置信度 / 日期 / 类别四维筛选——F04 筛选增强转国赛备选池，08 §11.2 决议 ①）、`FollowUpPanel`（08 修订案 A12 起与智能助理共用 use-chat-pipeline 问答管线，见 §4.1/§2.10）、`PlanStepTree`、`FeedbackButton`、`ChartAnchorLayer`（每张证据图内置）、`TipCard`（省钱贴士卡，F09/P2：student_benefits 检索 top-3 + 一句话适配理由，年度阶段产出流入卡流）。
- **状态**：
  - 空：未体检 → 空态（§6.3 文案）+ [去上传]；
  - 加载：流水线运行中卡片流式发布——卡片先以骨架屏占位，结论文字逐字流式（真实 token 流），图表数据就绪后一次性渲染（不逐点动画，避免性能抖动）；
  - 错误：单卡错误 → 卡内降级（模板叙事替换 LLM 叙事 + DegradeToast 说明）；整页错误 → `error.tsx` 兜底 + [重试]；
  - 成功：卡片可交互：锚点追问、确认/质疑、引用折叠、数据表切换、收藏/取消收藏；图表廊视图 = 卡片压缩为图表优先的缩略图网格（同一数据，双渲染形态）；收藏夹面板空态「还没有收藏任何洞察卡」+ [去逛洞察卡流]。
- **路由**：`/insights`。

### 1.6 账本汇总视图（/insights 内嵌，原 `/ledger` 并入，#46）

- **目的**：明细总览与图表锚点追问的主战场。图表任意元素可点击/框选锚定（P0），是交互创新 7 分的核心证据页。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 筛选行：日期预设(近7/30/90天·本月·全部)  │
  │         + 类别 combobox + 商户搜索      │
  ├──────────────────────────────────────┤
  │ 类别构成 donut · 商户排行 bar（两列栅格） │
  │ （全部内置 ChartAnchorLayer + 数据表切换）│
  ├──────────────────────────────────────┤
  │ 两大图表区（省赛，两列栅格，F03，懒挂载）：  │
  │  CalendarHeatmap 日历热力图 · Category- │
  │  Sankey 类别桑基（HealthRadar 健康雷达 · │
  │  MerchantWordcloud 商户词云 = 国赛窗口）   │
  │  （页面代码静态渲染，不进 ChartSpec 枚举， │
  │   08 §④；全部内置锚定 + 数据表切换）      │
  ├──────────────────────────────────────┤
  │ 明细表：虚拟滚动（10k 行），金额分箱显示   │
  └──────────────────────────────────────┘
  ```
- **筛选语义（2026-10-16 修订）**：日期范围筛选同步作用到类别 / 商户 / 明细三块——真实动线按 `date_iso >= 'YYYY-MM-DD'`（日期字面量由本地时钟计算，VARCHAR 字典序即时间序）拼入白名单 SQL 模板重查，演示动线按行日期过滤；「支出走势（月）」从本视图迁出，挂到商户统计视图排名图下方（§1.7）。
- **核心组件**：`ChartCard`、`ChartAnchorLayer`、`FilterRow`、`VirtualBillTable`、`AnchorConfirmBar`、`CalendarHeatmap`、`CategorySankey`、`HealthRadar`、`MerchantWordcloud`（四大静态图 = 省赛两图 + 国赛两图，渲染规范见 §3.6；数据源 = 既有视图 v_daily_expense / v_category_monthly / v_health_inputs / v_merchant_monthly，零新表，08 §④.2）。
- **重构登记（08 修订案 A13）**：演示行生成器与 ChartCard 图表卡外壳已提取为共享模块（`src/lib/insights/ledger-demo.ts`、`src/components/insights/chart-card.tsx`），与商户统计视图共用；ledger-view 行为与演示口径不变。
- **状态**：
  - 空：无数据（守卫拦截）/ 筛选无结果 → 空态文案 + [清除筛选]；
  - 加载：WASM 查询中 → 图表骨架（shimmer）；查询超 2s → 顶部提示「正在本地计算…」；两大图 IntersectionObserver 懒挂载（进入视口 200px 内才查询渲染，单页实例 ≤6，§3.6 规则 9；国赛两图落地后同机制复用）；
  - 错误：SQL 生成失败（锚点追问）→ 自动重试 1 次 → 回退内置分析模板（07 §18 约束）；DuckDB 崩溃 → 页面错误卡 + 刷新（数据仍在 OPFS/IndexedDB，07 §17）；
  - 成功：图表可交互（悬停 tooltip + 点击锚定 + 框选锚定），明细表虚拟滚动；省赛两图可点选锚定——日历格 → `dim: time_month`、桑基节点 → `dim: merchant`（国赛补齐后雷达顶点 → `dim: category`、词云词条 → `dim: merchant`），折叠为 SelectionContext 后走既有 `/api/followup`（07 §18 零协议改动，08 §④.1）。
- **路由**：`/insights` 内「账本汇总」tab（07 §14：/ledger 已并入，#46），与卡片流 / 图表廊 / 商户统计 / 订阅管理并列于视图切换器（`?view=ledger` 为主入口，`?tab=ledger` 旧参数兼容；商户统计 `?view=merchants`，08 修订案 A13；订阅管理 `?view=subscriptions`，08 修订案 A15）。锚点追问会话期间离开页面 → 会话状态保留在 `anchor` slice，返回后追问区自动展开。

### 1.7 商户统计视图（/insights 内嵌，08 修订案 A13）

- **目的**：全账单商户支出排名总览——每商户总额（分）/ 笔数 / 占全账单支出比 / 均笔金额，金额降序；账本汇总之外的第二条确定性「格局」视图，点击柱子无缝接锚点追问。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 顶行：标题「商户统计」+ 商户搜索框      │
  │ 排名横向条形图（前 10 名，图注「完整排名  │
  │   看数据表」；点击柱子 → 追问锚点）      │
  │ 数据表：全量排名（商户 / 支付单位 ·      │
  │   总额 · 笔数 · 占全账单 · 均笔，       │
  │   金额降序）                           │
  │ 支出走势（月）：近 12 月月度序列（2026-   │
  │   10-16 从账本汇总迁入，全账单口径不随    │
  │   排名搜索变化；点击圆点 → 追问锚点）    │
  │ 脚注：数据来源（你的账单数据 / 内置数据） │
  │   + 截断说明（恰满 50 行标「商户较多，    │
  │     按金额取前 50 名」，不满标「全部展示」）│
  └──────────────────────────────────────┘
  ```
- **数据口径（08 修订案 A13，2026-10-16 补走势）**：按 `merchant` 聚合全账单（无时间窗）`direction='expense'` 支出；OCR 账单中 merchant 即账单上的支付单位名称（A10 入库口径）。真实动线三条白名单 SQL（页面代码常量，无用户输入，经 runWhitelistedAggregate 预检双保险；已入白名单单测 tests/unit/whitelist.test.ts）：
  ```sql
  -- 商户排名：聚合值按 SELECT 位置取值（07 §6 按位口径，白名单文法子集不支持 AS 别名）
  SELECT merchant, SUM(amount_cents), COUNT(*) FROM transactions
  WHERE direction = 'expense' GROUP BY merchant ORDER BY SUM(amount_cents) DESC LIMIT 50;
  -- 占比分母：取 expense 行
  SELECT direction, SUM(amount_cents) FROM transactions GROUP BY direction;
  -- 支出走势（月）：近 12 月月度序列（自账本汇总迁入）
  SELECT month, SUM(expense_cents) FROM v_monthly_summary GROUP BY month ORDER BY month DESC LIMIT 12;
  ```
- **走势图交互（2026-10-16 修订）**：走势查询独立降级——失败仅该模块回退演示 `DEMO_INSIGHTS.ins-4`，不拖累排名动线；折线开 `showSymbol` 常显圆点（§3.6 line 规范），点击圆点 → 追问锚点（「某月支出 X 元」）。
- **核心组件**：`MerchantView`（页面级，两级注册口径登记于 §2.2，不占可复用注册表名额）、`ChartCard`（共享图表卡外壳，提取自账本汇总，`src/components/insights/chart-card.tsx`）、`ChartAnchorLayer`；商户聚合映射纯函数在 `src/lib/insights/merchant-aggregate.ts`（aggregateMerchants / merchantsFromQuery / expenseTotalFromDirection）。
- **状态**：
  - 空：无体检结果（lastRun 为空）→ 确定性演示行（`src/lib/insights/ledger-demo.ts`，seed 20261013、100 行，与账本汇总同一生成器）浏览器内聚合，零 API 调用（渲染期即回退，不查库）；
  - 加载：真实动线两条白名单聚合浏览器内异步执行，完成前先展示演示行，成功后替换为真实聚合；
  - 错误：任一查询失败（白名单拒绝 / 数据集缺失）→ 整视图回退演示行，数据来源脚注标「内置数据」；
  - 成功：排名图与数据表同步渲染；商户搜索同步过滤图表与数据表（只作用于展示，不改变聚合口径）；点击柱子 → 追问锚点（anchor id `merchant-view`，label 含商户名 + 合计 + 占全账单比，§18 锚点协议不变，无新工具）；数据来源脚注区分「你的账单数据 / 内置数据」并如实标注全账单支出合计。
- **路由**：`/insights` 内「商户统计」tab（`?view=merchants`，08 修订案 A13）；路由数不变（A13 口径仍 10 条；08 修订案 A15 起路由条目 11，见 §1.1）；视图全程浏览器内计算（DuckDB-WASM 白名单聚合），零新端点、零新 env 键、无新增网络请求。

### 1.8 订阅管理视图（/insights 内嵌，原 `/subscriptions` 页降级，08 修订案 A15）

- **目的**：订阅刺客雷达（P1）——确定性 SQL 识别连续小额扣费 + 取消攻略带 RAG 引用。SQL 由数据管线成员在 03 §1.3 S4 给出（业务规则 = 07 §3），本视图只负责呈现。08 修订案 A15 起为洞察页第 5 视图（`?view=subscriptions`），内容自原 `/subscriptions` 页整体迁入、行为不变；原路由改为静态重定向（§1.1）。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 摘要行：命中 N 项 · 近一年合计 ¥X · 占支出 Y% │
  │  · 年度订阅合计 ¥Z（F06 新增）              │
  ├──────────────────────────────────────┤
  │ SubscriptionRadarCard × N（卡墙布局）：   │
  │  merchantRef（m_+8hex）· 规则编号 · 扣费周期 │
  │  右上角 NextBillingCountdown 倒计时徽标     │
  │  （「距离下次扣费 3 天」，确定性 SQL 外推）   │
  │  sparkline 证据图（连续扣费时间轴）        │
  │  取消攻略：步骤化操作清单 CancelGuide-      │
  │  Checklist（勾选进度条 + 一键复制操作要点，  │
  │  升级自折叠引用，rag:${caseId} → 04 RAG）   │
  │  [设为提醒]（接 F13 通知中心）              │
  └──────────────────────────────────────┘
  ```
- **核心组件**：`SubscriptionView`（页面级，自原 `/subscriptions` 页整体迁入、行为不变，登记见 §2.2，08 修订案 A15）、`SubscriptionRadarCard`、`StatRow`、`NextBillingCountdown`（下次扣费倒计时徽标）、`CancelGuideChecklist`（步骤化操作清单）、`CitationCollapse`、`Sparkline`。
- **状态**：
  - 空：未发现命中 → 积极空态（§6.3：不是「没有订阅」，而是「没抓到连续扣费模式」+ 引导去账本汇总视图框选已知订阅核算）；
  - 加载：确定性 SQL 本地计算，亚秒级，骨架屏一次即可；
  - 错误：SQL 白名单校验失败（不该发生，防御）→ 卡片显示规则错误 + 重跑；
  - 成功：卡片可展开步骤化攻略清单（勾选进度为本地 UI 态 + 一键复制操作要点）、可锚定 sparkline 追问、可标记「已确认订阅 / 误报」（打标反馈回流 04 评测集）、[设为提醒] 写 `spendct:notif:v1`（可重算提醒状态，08 修订案 A1，接 F13 通知铃）。
- **路由**：`/insights` 内「订阅管理」tab（`?view=subscriptions`，08 修订案 A15）；原 `/subscriptions` 路由保留为静态重定向 → 本视图。

### 1.9 消费日历页 `/calendar`（08 修订案 A15）

- **目的**：消费时空格局一目了然——日历热力图看「哪天花得多」，时间轴流水看「那天买了什么」；全程浏览器内计算，零 API、零新端点、零新 env、零新事件。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 标题「消费日历」+ 月切换（上月/下月）+    │
  │   深夜消费图例（23:00–05:00 口径）      │
  ├──────────────────────────────────────┤
  │ CalendarHeatmap 日历热力图：每日金额    │
  │   色阶，深夜消费格加「深夜」标记        │
  ├──────────────────────────────────────┤
  │ CalendarTimeline 时间轴流水（按日分组）：│
  │   每笔 时间/类目/商户/金额/方向，       │
  │   深夜加标；热力图格点点击 → 当日流水   │
  │   联动定位                             │
  └──────────────────────────────────────┘
  ```
- **数据口径（08 修订案 A15）**：热力图走白名单聚合 `CALENDAR_DAILY_SQL`（expense + paid 双方向，行数上限放宽至 2000）；流水走直连分页 SQL（`LIMIT 200`）；深夜口径 23:00–05:00；演示动线走确定性生成器（每 9 笔 1 收入、深夜约 1/4）；全程浏览器内计算（DuckDB-WASM 白名单聚合），零 API、零新端点、零新 env 键、零新事件。ECharts 包装器按需注册 HeatmapChart / CalendarComponent / VisualMapComponent。
- **核心组件**：`CalendarView`（页面级）、`CalendarHeatmap`（复用四大静态图同名组件，/calendar 页口径）、`CalendarTimeline`（页面级，登记见 §2.2）。
- **状态**：
  - 空：无体检结果 → 确定性演示行（确定性生成器浏览器内聚合，零 API，渲染期即回退不查库）；当月无消费 → 空态「这个月没有消费记录」+ [回到本月]；
  - 加载：WASM 查询中 → 热力图骨架（shimmer），查询超 2s → 顶部提示「正在本地计算…」；
  - 错误：任一查询失败（白名单拒绝 / 数据集缺失）→ 整页回退演示行，数据来源脚注标「内置数据」；
  - 成功：热力图格点点击 → 时间轴联动定位该日流水；流水行点击 → 明细锚点（`dim: date`，§18 锚点协议不变，无新工具）；深夜消费格与流水行带「深夜」标记。
- **路由**：`/calendar`，守卫无（游客可访问；无体检结果走演示行兜底）；入口 = top-nav「日历」与移动端底部 tab（§1.1）；移动端要点见 §4.5 第 11 条。

### 1.10 年度报告页 `/report`

- **目的**：年度报告升级为滚动式数据故事（F05）+ 消费健康指数仪表（答辩记忆点：隐形订阅率 / 冲动消费浓度等具名指标）+ 消费段位与成就徽章墙（F10）。`featureFlags.reportStory=false` 时回退旧版布局（指标卡 + 年度对比图，本表旧版即兜底，08 §2.3）。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ Hero：消费健康指数仪表（HealthIndexGauge）│
  ├──────────────────────────────────────┤
  │ 滚动式数据故事（F05）：StorySegment × 6-8 │
  │  个叙事段，逐段 scroll-reveal；每段 =      │
  │  headline + 证据图（chartSpec 七类）      │
  │  + 叙事（AnnualStorySchema，deepseek；    │
  │  段级模板兜底，08 §⑥.5）                 │
  ├──────────────────────────────────────┤
  │ 消费段位卡 RankBadge（5 档规则判定，F10）  │
  │ 六维健康明细（每维「每 100 元消费里约 X 元   │
  │   用于…」+ 百分比小字 + 状态标签，08 A15）  │
  │ 六维健康雷达 HealthRadar（F10）           │
  │ 成就徽章墙 AchievementWall（13 枚，F10，   │
  │   第 13 枚「七日打卡王」为 A17 挑战页解锁）  │
  │   A19：13 枚全真实行为判定、演示回退删除—— │
  │   无本地记录一律空集，新访客全锁是正常态    │
  ├──────────────────────────────────────┤
  │ [生成年度海报]（canvas 合成 1080×1920 PNG  │
  │   保存本地，F05）+ [导出 PDF]（保留）      │
  └──────────────────────────────────────┘
  ```
- **核心组件**：`HealthIndexGauge`、`StorySegment`、`RankBadge`、`HealthRadar`（六维，F10）、`AchievementWall`、`PosterCanvasButton`、`ExportPdfButton`。原「具名指标卡 ×4」与「年度对比图」并入叙事段（模板段「年度总览」「环比变化」，确定性 SQL 填数，08 §⑥.5 固定 6 段模板）。
- **通俗化展示口径（08 修订案 A15，仅展示层，底层计算口径不动）**：「六维健康明细」区块每维呈现「每 100 元消费里约 X 元用于…」+ 百分比小字 + 状态标签；健康指数大白话总评；四段数据故事改叙事文案；段位与成就百分比改口语化表述（如「超过八成同龄人」）。六维阈值（RatioKey）与文案映射（buildHealthComment / buildHealthDims / healthRatingLabel）集中在 `src/lib/report/labels.ts`。
- **状态**：
  - 空：数据不足 3 个月 → 空态「报告需要至少 3 个月的数据，当前 {n} 个月」+ [回洞察流]；
  - 加载：指标 SQL 预计算（模板优先，无 LLM 依赖）→ 仪表骨架；故事段 LLM 流式（annual 阶段内增强，段级真实 delta，§5.1 不放假动画）；
  - 错误：单指标计算失败 → 该指标卡降级为「口径说明」并标注不可用；任一段未过 L2 自检 → 该段回退模板段，不影响其他段（08 §⑥.5 段级闸门）；海报合成失败 → DegradeToast + [重试]；
  - 成功：仪表动画（数值 count-up 600ms，reduced-motion 下直接显示终值）；故事段逐段 scroll-reveal（240ms 上滑淡入，§3.7）；段位卡与徽章墙由确定性规则即时判定；海报合成 < 2s（01 §8 新增基准）。
- **路由**：`/report`，守卫见 §1.1。段位/成就解锁状态存 localStorage `spendct:achievements:v1`（可随时由聚合视图重算，08 修订案 A1，≤2KB）。

### 1.11 隐私说明页 `/privacy`（原 `/about` 更名，#46）

- **目的**：隐私信任的收口。数据可见性对照表（02 文档第二章）在此以交互形式呈现；同时承载 README 要求的项目介绍/技术架构/团队/费用说明的站内版本。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ ① 数据可见性对照表（大表格，来自 02 的     │
  │    visibility.ts，实时高亮当前层级；       │
  │    补第 21-23 行（02 §8 唯一维护点，08 A1/A2）：│
  │    21 预算配置（浏览器 only）                │
  │    22 预算聚合摘要（LLM 可见）               │
  │    23 成就收藏通知与导出（浏览器 only）       │
  │ ② 隐私承诺三卡（浏览器/LLM/服务器各看到什么）│
  │ ③ 技术栈与开源仓库 · 团队 · 费用说明        │
  │ ④ 「12 大能力」一览静态版（与首页能力卡      │
  │    同数据源，随 F01 落地）                 │
  └──────────────────────────────────────┘
  ```
- **核心组件**：`VisibilityTable`（与 PrivacyBadge 同数据源）、`PrivacyPromiseCard`、`StackList`、`CapabilityCardWall`（静态版，与首页同数据源）。
- **状态**：静态页，无空/加载态；唯一「错误」是 visibility.ts 加载失败 → 静态表格兜底。
- **路由**：`/privacy`。全局导航与 README 链接均指向此处（项目介绍/技术架构/团队/费用说明亦随此页承载）。

### 1.12 预算中心 `/budget`（08 修订案 A7，P1）

- **目的**：月度分类预算 + 预算 vs 实际 + 下月预测 + 超支 AI 提示 + 快速记账入口（F07/F08）。数据面 = `budgets` / `budget_vs_actual` / `forecast_monthly`（DuckDB 数据集内，白名单注册 08 修订案 A2，聚合粒度）。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 顶行：QuickEntryBar（一句话记账入口）    │
  │  「中午食堂花了 15」→ zod 确认卡 → 入账  │
  ├──────────────────────────────────────┤
  │ 本月总览：BudgetRing（总预算进度环）      │
  │  severity 文案：ok / warn / over       │
  ├──────────────────────────────────────┤
  │ 分类预算网格：12 类 × BudgetBar          │
  │  （已用比例条 + 剩余 ¥X；当月+未来 2 月   │
  │   可编辑，历史月份只读，08 §3.1 护栏）    │
  ├──────────────────────────────────────┤
  │ 预算 vs 实际柱图 + 超支 AI 提示卡         │
  │  BudgetAdviceCard（budget-advice，      │
  │  qwen 主 + 模板兜底，08 §⑥.2）           │
  ├──────────────────────────────────────┤
  │ 下月预测：ForecastChart + 预测叙事卡      │
  │  （forecast-narrative，deepseek；        │
  │  disclaimer 原文必显示）                 │
  └──────────────────────────────────────┘
  ```
- **核心组件**：`QuickEntryBar`、`BudgetRing`、`BudgetBar`、`BudgetAdviceCard`、`ForecastChart`、`ForecastNarrativeCard`。
- **状态**：
  - 空：还没有设置预算 → 空态（§6.3）+ [设置预算]（打开预算编辑弹层，默认值 = 近 3 月均值，确定性 SQL 预填）；
  - 加载：预算/实际/预测全部确定性 SQL（`budget_vs_actual` / `forecast_monthly`）亚秒级；AI 建议与预测叙事走 `/api/ai/task`（taskId=budget-advice / forecast，08 §⑦），卡片骨架 + 「正在生成 AI 建议…」真实任务状态（§5.1 不放假动画）；
  - 错误：AI 不可用 → 模板兜底卡 + DegradeToast「AI 建议不可用，已使用内置规则模板」；快速记账 `parseable:false` 或 LLM 失败 → 手动表单兜底（金额空、类别下拉预选 top-1 规则猜测）+ DegradeToast，不阻塞流程（08 §⑥.1）；
  - 成功：预算环进度 tabular-nums 实时更新；超支卡 actions（adjust_budget / view_detail / dismiss）可操作；预测卡保留 disclaimer 原文（zod literal「朴素季节外推，仅作参考，不构成建议」）。
- **快速记账（F08，QuickEntryBar 协议）**：文本 ≤200 字 → `/api/ai/task` taskId=quick-entry → `QuickEntrySchema` zod 确认卡（金额分/方向/类别/商户/日期/备注）→ [确认入账] 写 `transactions`（`source='manual'`，08 修订案 A3；原始输入文本仅内存中转、绝不落盘）→ 账本即时可见；[修改] 打开手动表单。语音输入为 P3（国赛窗口）。注意：与智能助理的语音输入（08 修订案 A12，Web Speech 浏览器转写、音频不出浏览器）是两回事，互不影响档期。
- **路由**：`/budget`（守卫 require="budget"，§1.1）；`featureFlags.budget=false` 时路由下线、快速记账入口随之隐藏（08 §⑩ 第 10 刀）；`/upload` 入口卡与 `/insights` 空态有引流入口。

### 1.13 消费知识小课堂 `/learn`（08 修订案 A7，P2）

- **目的**：把 60 条 RAG 案例变成可浏览产品——案例库浏览（8 类分类 / 搜索）+ 金融素养知识卡 + 防坑手册（F11）。展示面 = 静态公开投影（title/summary/category/source/legalBasis/benefitTags），不含任何用户数据（08 §5.4）。
- **布局分区**：
  ```
  ┌──────────────────────────┬────────────┐
  │ 搜索框（浏览器 TF-IDF，    │ 侧栏（桌面）：│
  │  04 §4.8，零新增 LLM）     │  金融素养知识卡│
  │ 类别 chips × 8（含         │  KnowledgeCard│
  │  student_benefits）       │  （12 张）    │
  ├──────────────────────────┤  「防坑手册」  │
  │ CaseCard × N（案例卡流）    │  分类聚合入口 │
  │  title/summary/category/  │             │
  │  source/legalBasis/       │             │
  │  benefitTags（学生权益角标）│             │
  └──────────────────────────┴────────────┘
  ```
- **核心组件**：`CaseSearchBar`、`CaseCategoryChips`、`CaseCard`、`KnowledgeCard`。
- **状态**：
  - 空：搜索无结果 → 空态（§6.3）+ [清除搜索]；
  - 加载：案例库加载中 → 骨架屏（静态 JSON 数据，亚秒级）；
  - 错误：数据文件加载失败 → `error.tsx` 兜底 + [重试]；
  - 成功：浏览/搜索/折叠案例摘要；案例详情引用格式 = `rag:${caseId}`（与洞察卡引用同格式，04 评测集编号）。
- **路由**：`/learn`（08 A7）；`featureFlags.learn=false` 时路由下线（08 §⑩ 第 6 刀）；不引 ECharts/DuckDB，chunk < 60 KB。

### 1.14 数据管理与导出 `/settings`（08 修订案 A7，P1）

- **目的**：数据集管理 / CSV-JSON 导出 / 通知开关 / 主题与演示模式入口（F12）。移动端底部 tab「我的」指向本页（08 §2.1）。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ DatasetManager：当前数据集（名称/hash/  │
  │   行数/导入时间）+ [切换] [删除]（二次确认）│
  ├──────────────────────────────────────┤
  │ 导出区：[CSV] [JSON]（内存生成 →        │
  │   <a download>，不落盘不经服务端；       │
  │   导出前弹隐私提示）                    │
  ├──────────────────────────────────────┤
  │ 通知开关（订阅扣费临近/预算超支/断点续跑，│
  │   F13，写 spendct:notif:v1）           │
  ├──────────────────────────────────────┤
  │ 主题 / 演示模式 / 隐私开关入口 · 关于     │
  │  · 链接：预算中心 / 知识课堂             │
  └──────────────────────────────────────┘
  ```
- **核心组件**：`DatasetManager`、`ExportButton`（CSV/JSON）、`NotificationSettingSwitch`、`ThemeEntry`。
- **状态**：
  - 空：暂无数据集 → 空态（§6.3）+ [去上传账单]；
  - 加载：导出中 → 进度条（10k 行 CSV 导出 < 3s，01 §8 新增基准）；
  - 错误：导出失败 → 错误提示 + [重试]；删除失败 → DegradeToast；
  - 成功：导出完成 → 浏览器本地下载 + 完成提示；删除后自动回 `/upload`。
- **路由**：`/settings`（08 A7）；`/budget`、`/learn` 由此页链接与首页能力卡进入，不新增底部 tab 项。

### 1.15 省钱挑战打卡页 `/challenge`（08 修订案 A17）

- **目的**：把「省钱」落成可坚持的行为——挑一个类目定每日预算，连续打卡 21 天，用基线对比看到省下的真金白银；全程浏览器内计算，零 API。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 标题「省钱挑战」+ 副标题「挑一个类目…    │
  │   连续打卡 21 天」                     │
  ├──────────────────────────────────────┤
  │ 未开始态：12 类目 chips（aria-pressed） │
  │   + 每日预算输入（placeholder 给建议值） │
  │   + 基线说明（近 30 天日均）            │
  │   + [开始挑战]                        │
  ├──────────────────────────────────────┤
  │ 进行中：四宫格 StatCard（进行天数 N/21/  │
  │   连续打卡/达标天数/累计节省）+ 今日卡    │
  │   （达标/超支徽标、[打卡今日]/[撤销]、   │
  │   预算进度条、手动记账行：金额输入        │
  │   inputMode=decimal + [保存]，已记显示    │
  │   「已记 ¥X · 修改」、含手动时标          │
  │   「含手动记录」小注，08 修订案 A19）      │
  │   + 近 7 天柱条（虚线=预算线，            │
  │   绿达标橙超支，CircleCheck 已打卡标记）  │
  ├──────────────────────────────────────┤
  │ 完成态：21 天总结 + [再来一次]          │
  │ 玩法说明卡（如何算节省/中途可放弃）      │
  └──────────────────────────────────────┘
  ```
- **数据口径（08 修订案 A17，A19 补手动记账）**：真实数据走白名单聚合 `CHALLENGE_DAILY_SQL`（所选类目按日聚合，expense + paid 口径与 A13/A15 一致，行数上限 600）；基线 = 开始前 30 天该类目日均；节省 = 基线 − 当日实际（正计节省、负计超支）；手动记账行（A19）写与预算页同键的 `spendct:manual-entries` 账本（expense 覆盖 / income 不参与），渲染期派生合并账单点（`mergeChallengePoints`，不重查 DuckDB）；概览四宫格后与完成回顾总结段后各有一行口径脚注「累计节省 = Σ max(0, 基线 − 当日实际支出)，基线为挑战开始前 30 天该类目日均支出（当日支出含手动记录）」（text-xs muted）；无体检结果或查询失败 → 确定性演示行兜底（seed 20261016，12 类目约 120 天）；全程浏览器内计算。
- **核心组件**：`ChallengeView`（页面级，登记见 §2.2）；挑战状态纯函数在 `src/lib/insights/challenge-store.ts`（checkIn/uncheck 幂等、streakOf、buildChallengeDays、summarizeDays、computeBaselineCents），SQL 与窗口统计在 `challenge-sql.ts`，演示行在 `challenge-demo.ts`。
- **状态**：
  - 空：无进行中挑战 → 选类目+定预算表单（建议值按近 30 天日均向上取整到元，下限 ¥5）；
  - 加载：挂载前骨架（Flame 图标 + 加载中）；WASM 查询中 → 演示行即时兜底；
  - 错误：查询失败 → 整页回退演示行，数据来源脚注标「内置数据」；
  - 成功：打卡/撤销即时更新四宫格与柱条（toast 确认）；手动记账保存即合并入今日支出（四宫格/柱条即时联动）并触发 recheckAll（手动账计入「连续 7 天记账」）；连续打卡 ≥7 天 → recheckAll 判定解锁「七日打卡王」（第 13 枚，08 修订案 A19）。
- **持久化**：挑战记录存 localStorage `spendct:challenge:v1`（类目/预算/起止日/打卡日期集，≤20KB，07 §17 A17，不含行数据）；刷新后恢复进行中状态。
- **路由**：`/challenge`，守卫无；入口 = top-nav「挑战」（报告之后，08 A17）与首页能力卡；移动端要点：四宫格 2×2，今日卡与柱条单列。

### 1.16 攒钱目标中心页 `/goals`（08 修订案 A17）

- **目的**：把「想买什么」变成攒钱计划——立目标、按月存入、用月结余估算进度与预计达成月，攒不动时给出加速建议；全程浏览器内计算，零 API。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 标题「攒钱目标」+ 副标题               │
  ├──────────────────────────────────────┤
  │ 左：预计月结余卡（¥X/月 或 暂无法估算  │
  │   + 口径说明）+ 月均支出 TOP 卡        │
  │   （top3 类目横向条）                  │
  │ 右：新建目标表单（名称/金额/目标月，    │
  │   目标月默认 12 个月后）               │
  ├──────────────────────────────────────┤
  │ 目标卡列表：进度条（已存/目标）+ 预计   │
  │   达成月（按结余估算）+ 加速建议        │
  │   + 存入输入框 + [存入] + 近 5 笔记录   │
  │   + 删除（两步确认）                   │
  └──────────────────────────────────────┘
  ```
- **数据口径（08 修订案 A17）**：结余 = 近月平均收入 − 平均支出（只取收入 >0 的月份口径）；类目月均 = 各类目支出 ÷ 活跃月数；预计达成月 = 目标月结余估算向上取整（结余非正 → 「暂无法估算」）；无体检结果或查询失败 → 确定性演示口径兜底（复用 ledger 演示行同源 seed）；全程浏览器内计算。
- **核心组件**：`GoalsView`（页面级，登记见 §2.2）；目标状态纯函数在 `src/lib/insights/goals-store.ts`（createGoal/addDeposit/removeGoal/totalSaved/monthsToGoal/月份键工具），月度聚合映射在 `goals-sql.ts`。
- **状态**：
  - 空：无目标 → 空态卡「还没有攒钱目标」+ [立第一个目标]；无账单数据 → 结余卡标「暂无法估算」（口径说明如实标注），目标仍可创建与存入；
  - 加载：挂载前骨架（Target 图标 + 加载中）；
  - 错误：聚合查询失败 → 演示口径兜底，数据来源脚注标「内置数据」；
  - 成功：存入后进度条/预计达成即时重算；加速建议四态（已达成/进度未知/按计划/落后——落后态给出「每月需存 ¥X，可在类目再省 ¥Y」）。
- **持久化**：目标列表存 localStorage `spendct:goals:v1`（目标+存入记录，≤20KB，07 §17 A17，不含行数据）；刷新后恢复。
- **路由**：`/goals`，守卫无；入口 = top-nav「攒钱」（报告之后，08 A17）与首页能力卡。

### 1.17 年度海报分享页 `/poster`（08 修订案 A17）

- **目的**：把年度账单体检结果做成可分享的海报——三款模板 + 自定义标语，canvas 本地合成 PNG，下载/系统分享/复制到剪贴板；全程浏览器本地绘制，不上传任何数据。
- **布局分区**：
  ```
  ┌──────────────────────────────────────┐
  │ 标题「年度海报」+ 副标题「本地生成…」   │
  ├──────────────────────────────────────┤
  │ 左：海报预览 canvas（540×960 缩放预览，│
  │   aria-label='年度海报预览'）+ 年份/    │
  │   数据来源 meta 行                     │
  │ 右：样式卡（青屿/暮橙/夜紫 aria-pressed │
  │   + 色点预览）· 标语卡（input 16 字上限 │
  │   + 字数计数）· 导出卡（[下载 PNG]      │
  │   [系统分享] [复制图片]，busy 转圈）    │
  └──────────────────────────────────────┘
  ```
- **数据口径（08 修订案 A17）**：海报数据与报告页共用 `src/lib/report/poster-input.ts` 单一口径（年度概览/健康分/指标文案，含 dimScore 结余率维度修复）；无体检结果或查询失败 → 演示口径兜底（与报告页同源 demo）；导出走 `<a download>` 内存生成（spendct-annual-poster-{year}.png），不落盘、不经服务端；系统分享优先 `navigator.share({files})`，不支持则复制图片到剪贴板（toast 如实提示）。
- **核心组件**：`PosterStudio`（页面级，登记见 §2.2）；绘制函数与样式表在 `src/lib/report/poster-canvas.ts`（drawAnnualPoster/renderPosterPng/POSTER_STYLES 三模板）。
- **状态**：
  - 空：无体检结果 → 演示口径海报（数据来源脚注标「内置数据」），功能全部可用；
  - 加载：挂载前骨架 + canvas 绘制中预览区 shimmer；
  - 错误：canvas 合成失败 → 预览区错误态 + [重试]；系统分享被取消（AbortError）→ 静默；
  - 成功：样式/标语切换即时重绘（依赖数组联动）；下载触发浏览器下载事件；分享/复制完成 → toast 确认。
- **路由**：`/poster`，守卫无；入口 = top-nav「海报」（报告之后，08 A17）与首页能力卡（能力墙海报卡 href 已由 /report 改为 /poster）。

---

## 2. 组件树与可复用组件清单

### 2.1 组件树

```
App
├─ Shell
│  ├─ TopNav（Logo · 分段导航 · PrivacyBadge · ThemeToggle · DemoBadge · NotificationBell）
│  ├─ MobileTabBar（< 640px；「我的」→ /settings，08 A7）
│  ├─ AssistantDrawer（右下悬浮入口 + 聊天抽屉，任何非登录页，08 修订案 A12）── ChatBubbles · PlanBlock · ToolBadge（三态来源脚注）
│  └─ RouteGuard（data / checkup / report / budget）
├─ 页面层
│  ├─ HomePage ── HeroCta · PromiseStrip · CapabilityCardWall · TechArchStrip · MiniPipelinePreview
│  ├─ UploadPage ── UploadDropzone · OcrDropzone · OcrImportPanel · ParsePreviewTable · SampleDataCard · QuickEntryLink
│  ├─ CheckupPage ── PipelineStepper · CheckpointBar · ThinkingBubble · StageSummaryCard · StageEvidenceDrawer · StageOutputBadge
│  ├─ InsightsPage ── InsightViewToggle · FavoritesPanel · InsightFilterBar · InsightCard[] · FollowUpPanel · TipCard · LedgerSummaryView（账本汇总，原 /ledger 并入）· MerchantView（商户统计，08 修订案 A13）· SubscriptionView（订阅管理，原 /subscriptions 迁入，08 修订案 A15）
│  ├─ CalendarPage ── CalendarView（CalendarHeatmap · CalendarTimeline，08 修订案 A15）
│  ├─ ReportPage ── HealthIndexGauge · StorySegment[] · RankBadge · HealthRadar · AchievementWall · PosterCanvasButton · ExportPdfButton
│  ├─ ChallengePage ── ChallengeView（StatCard 四宫格 · 近 7 天柱条，08 修订案 A17）
│  ├─ GoalsPage ── GoalsView（结余卡 · 类目 TOP 卡 · 目标卡列表，08 修订案 A17）
│  ├─ PosterPage ── PosterStudio（预览 canvas · 样式/标语卡 · 导出卡，08 修订案 A17）
│  ├─ BudgetPage ── QuickEntryBar · BudgetRing · BudgetBar[] · BudgetAdviceCard · ForecastChart · ForecastNarrativeCard
│  ├─ LearnPage ── CaseSearchBar · CaseCategoryChips · CaseCard[] · KnowledgeCard
│  ├─ SettingsPage ── DatasetManager · ExportButton · NotificationSettingSwitch
│  └─ PrivacyPage ── VisibilityTable · PrivacyPromiseCard · CapabilityCardWall（静态版）
├─ 领域组件
│  ├─ InsightCard ── ChartCard · FeedbackButton · CitationCollapse · ConfidenceDots
│  ├─ ChartCard（共享图表卡外壳，提取自账本汇总，src/components/insights/chart-card.tsx，08 修订案 A13）── ChartAnchorLayer · Skeleton · EmptyState（表格视图切换）
│  │  └─ 四大静态图（页面级，08 §④）：CalendarHeatmap · CategorySankey · HealthRadar · MerchantWordcloud ── 同 ChartAnchorLayer · Skeleton · EmptyState
│  ├─ FollowUpPanel ── PlanStepTree · ChartCard
│  └─ ThinkingBubble ── SqlCodeBlock · ToolBadge · TypingCard
└─ 基础设施
   ├─ ErrorBoundary / ChartErrorBoundary
   ├─ DegradeToast · EmptyState · Skeleton
   └─ ThemeProvider（亮暗主题, §3.1）
```

依赖方向：基础设施 ← 领域组件 ← 页面。任何组件不得直接 import DuckDB/ECharts 整包（统一走 `ChartCard` / `@/lib/duckdb/provider` 门面）。

### 2.2 组件总表

组件命名两级注册（07 §14 + 08 修订案 A7）：**第一级 = 注册表 19 个可复用组件**（既有 13：UploadDropzone、PipelineStepper、ThinkingBubble、SqlCodeBlock、InsightCard、TypingCard、EvidenceTable、DegradeToast、FollowUpPanel、AnchorChip、ArtifactCard、ToolBadge、OcrReviewTable，#52；新增 6：BudgetRing、QuickEntryBar、ForecastChart、CaseCard、DatasetManager、NotificationBell，08 A7）——全仓唯一命名，文档禁止引用未列入注册表的组件名；**第二级 = 本节组件总表为页面级组件的唯一登记表**（页面级组件不占注册表名额、与注册表同为唯一命名源、同样禁止私造，约 23 个：StageEvidenceDrawer、FavoritesPanel、PosterCanvasButton、CapabilityCardWall、NextBillingCountdown、CancelGuideChecklist、AssistantDrawer、ChatBubbles、PlanBlock 等，07 §21 第 10 条 / §14 A7 两级注册口径；08 修订案 A12 增补智能助理三组件、08 修订案 A13 增补 MerchantView 均按同一口径登记；08 修订案 A14 深度分析开关 chip 为 FollowUpPanel 内部扩展、不新增组件，总数不变；08 修订案 A15 增补 CalendarView / CalendarTimeline / SubscriptionView，CalendarHeatmap 既有登记扩 /calendar 页口径）。本文扩展组件（ChartCard、FeedbackButton、四大静态图组件等）按第二级登记，不得与注册表重名，也不得升级为注册表名。

| 组件 | Props 概要 | 状态 | 用到的组件 |
|---|---|---|---|
| `UploadDropzone` | `accept: "csv"\|"image"`、`onFiles`、`onParseState` | idle / dragging / parsing / error / done | Skeleton |
| `OcrDropzone` | `onImage`、`onOcrProgress`、`onLowConfidence` | idle / uploading / recognizing / failed | Skeleton、LowConfidenceCell |
| `OcrImportPanel` | `initial`、`onCancel`、`onImported` | reviewing / confirming / done | OcrReviewTable |
| `ParsePreviewTable` | `rows`、`mapping`、`lowConfidence: Set<CellKey>`、`onConfirm` | preview / editing | LowConfidenceCell |
| `PipelineStepper` | `stages[6]`、`status: Record<StageId,StageStatus>`、`pct?`、`outputCount?` | 每阶段 pending/running/succeeded/skipped/failed（07 §1 StageStatus；paused 为 UI 局部覆盖态） | CheckpointBar |
| `ThinkingBubble` | `events: ProtocolEvent[]`、`activeStage`、`paused`、`onPause/onResume` | streaming / idle / paused | SqlCodeBlock、ToolBadge、TypingCard |
| `TypingCard` | `deltas`、`active` | streaming / done | — |
| `EvidenceTable` | `columns`、`rows`、`note?` | — | — |
| `ToolBadge` | `toolName`、`ok`、`ms`、`detail?` | running / done / failed | — |
| `AnchorChip` | `sel`、`onConfirm/onCancel` | idle / selected | — |
| `ArtifactCard` | `kind: "table"\|"metric"`、`data` | — | EvidenceTable |
| `CheckpointBar` | `checkpoint?: Checkpoint`、`onPause/onResume/onDiscard` | running / paused / saved | — |
| `ThinkingBubble` | `events`、`activeStage`、`paused`、`onPause/onResume` | streaming / idle / paused | SqlCodeBlock、ToolBadge、TypingCard |
| `InsightCard` | `card: InsightCardData`（07 §4 insight-card@v1）、`onFeedback`、`onDrill` | draft / published / withheld（07 §4 三态）+ UI 覆盖态 confirmed / disputed / error | ChartCard、FeedbackButton、CitationCollapse、ConfidenceDots |
| `ChartCard` | `spec: ChartSpec`（07 §4：tableId/chartType/title/dimField/measureFields/sortBy/topN/note，registry 渲染，LLM 不产出 ECharts option）、`withAnchor?`、`withTable?`、`loading?`、`error?`（共享图表卡外壳：提取自账本汇总，`src/components/insights/chart-card.tsx`，行为不变，08 修订案 A13） | loading / ready / error / table | ChartAnchorLayer、Skeleton、EmptyState |
| `MiniTable` | `headers: [string, string]`、`rows: [string, string][]`（两列表格载体：账本汇总与商户统计的 ChartCard 数据表视图共用，`src/components/insights/mini-table.tsx`，2026-10-16 修订） | — | — |
| `ChartAnchorLayer` | `chartRef`、`selection?`、`disabled?`、`onHover`、`onSelect`、`onCancel` | idle / hover / selected | AnchorHintChip |
| `FollowUpPanel` | `turns`、`running`、`onSend`、`onRetry` | idle / planning / executing / answered | PlanStepTree、ChartCard（08 修订案 A12：内部走 use-chat-pipeline，不开本地案例路径，保持 PEO 协议） |
| `PlanStepTree` | `steps: PlanStep[]`、`onRetry?` | 每步 pending/running/done/failed | — |
| `FeedbackButton` | `cardId`、`kind: "confirm"\|"dispute"`、`active?`、`onFeedback` | idle / active / animating | DisputeReasonPopover |
| `SubscriptionRadarCard` | `hit: SubscriptionHit`、`onAnchor`、`onFeedback` | default / expanded / confirmed / false-positive | Sparkline、CitationCollapse、FeedbackButton |
| `HealthIndexGauge` | `score`、`metrics: HealthMetric[]`、`loading?` | loading / ready / degraded | MetricCard |
| `PrivacyBadge` | `level: PrivacyLevel`、`compact?`、`onExplain?` | local-only / aggregated-to-llm / server-relay | VisibilityMiniTable |
| `ChartErrorBoundary` | `fallback`、`onReset?` | normal / error | EmptyState |
| `DegradeToast` | `severity`、`title`、`explain`、`fallback?`、`retry?` | info / warning / error | — |
| `OcrReviewTable` | `rows`、`onEditCell` | preview / editing | LowConfidenceCell |
| `EmptyState` | `icon`、`title`、`description`、`action?` | — | — |
| `Skeleton` | `variant: "card"\|"chart"\|"table"\|"text"`、`rows?` | — | — |
| `BudgetRing` | `ym`、`total: {budgetCents, actualCents, ratioPct}`、`severity: "ok"\|"warn"\|"over"`（08 §⑥.2） | loading / ready | — |
| `QuickEntryBar` | `onSubmit(text)`、`draft?: QuickEntrySchema`（08 §⑥.1）、`busy` | idle / parsing / confirming / failed | DegradeToast（parseable:false → 手动表单兜底） |
| `ForecastChart` | `rows: ForecastRow[]`、`method: "seasonal_baseline"`、`onAnchor` | loading / ready / empty / table | ChartAnchorLayer、Skeleton、EmptyState |
| `CaseCard` | `case: CaseSummary`（title/summary/category/source/legalBasis/benefitTags，08 §5.4 公开投影） | default / expanded | CitationCollapse |
| `DatasetManager` | `datasets: DatasetMeta[]`、`activeHash`、`onSwitch/onDelete` | default / confirming-delete | DegradeToast |
| `NotificationBell` | `items: NotifItem[]`、`onOpen`（`spendct:notif:v1`，可重算，08 A1） | default / open | — |
| `CalendarHeatmap` | `rows: {date, amountCents}[]`（账本汇总视图走 v_daily_expense；/calendar 消费日历页走白名单 CALENDAR_DAILY_SQL（expense + paid，行数上限 2000），08 修订案 A15）、`onAnchor` | loading / ready / empty / table | ChartAnchorLayer、Skeleton、EmptyState |
| `CategorySankey` | `nodes/links`（v_category_monthly 当月环比迁移）、`onAnchor` | loading / ready / empty / table | ChartAnchorLayer、Skeleton、EmptyState |
| `HealthRadar` | `dims: {name, score}[]`（v_health_inputs 六维）、`onAnchor` | loading / ready / empty / table | ChartAnchorLayer、Skeleton、EmptyState |
| `MerchantWordcloud` | `words: {merchantRef, count, amountCents}[]`（v_merchant_monthly，n≥5 商户还原规则 07 §5）、`onAnchor` | loading / ready / empty / table | ChartAnchorLayer、Skeleton、EmptyState |
| `StageEvidenceDrawer` | `stage: StageId`、`evidences: StageEvidence[]`（真实 stage:evidence 事件） | closed / open | SqlCodeBlock、InsightCard（产出缩略） |
| `StageOutputBadge` | `count`、`elapsedMs`、`stage` | entering / visible / exiting | — |
| `InsightViewToggle` | `view: "cards" \| "gallery" \| "ledger" \| "merchants" \| "subscriptions"`、`onChange`（`?view=merchants`，08 修订案 A13；`?view=subscriptions`，08 修订案 A15） | — | — |
| `MerchantView` | `onAnchor`（点击柱子 → 追问锚点 anchor id `merchant-view`，label 含商户名 + 合计 + 占全账单比；排名图前 10 + 数据表全量（50 行上限，截断脚注如实标注），商户搜索同步过滤；页面级，08 修订案 A13） | — | ChartCard、ChartAnchorLayer、Skeleton、EmptyState |
| `SubscriptionView` | 订阅候选列表 / 逐笔核对 / 下次扣费倒计时（自原 /subscriptions 页整体迁入、行为不变；页面级，08 修订案 A15） | — | SubscriptionRadarCard、StatRow、NextBillingCountdown、CancelGuideChecklist、CitationCollapse、Sparkline |
| `CalendarView` | 月切换、热力图与时间轴联动（页面级，/calendar 页，08 修订案 A15） | — | CalendarHeatmap、CalendarTimeline、Skeleton |
| `CalendarTimeline` | `rows: {ts, category, merchant, amountCents, direction, night}[]`（直连分页 SQL，LIMIT 200）、`onAnchor` | loading / ready / empty / table | Skeleton、EmptyState |
| `ChallengeView` | 三态（未开始选类目+定预算 / 进行中四宫格+今日卡+近 7 天柱条 / 完成总结）；今日卡补手动记支出输入行（金额 inputMode=decimal + 保存，已有记录显示「已记 ¥X · 修改」，写与预算页同键 `spendct:manual-entries`，渲染期合并账单点，08 修订案 A19）；挑战状态纯函数走 `src/lib/insights/challenge-store.ts`；持久化 `spendct:challenge:v1`（07 §17 A17；页面级，08 修订案 A17） | not-started / running / finished | StatCard、Skeleton、EmptyState |
| `GoalsView` | 结余卡+月均支出 TOP、新建目标表单、目标卡列表（进度条/预计达成/存入/两步删除确认）；状态纯函数走 `src/lib/insights/goals-store.ts`；持久化 `spendct:goals:v1`（07 §17 A17；页面级，08 修订案 A17） | loading / ready | Skeleton、EmptyState |
| `PosterStudio` | 三样式切换（aria-pressed）+ 标语 16 字计数 + 下载/系统分享/复制；预览 canvas（aria-label='年度海报预览'）；数据与报告页共用 `src/lib/report/poster-input.ts`（页面级，08 修订案 A17） | loading / ready / error | Skeleton、EmptyState |
| `FavoritesPanel` | `cardIds: string[]`（`spendct:fav:v1`） | closed / open | EmptyState、InsightCard（缩略） |
| `NextBillingCountdown` | `nextDate`、`daysLeft`（确定性 SQL 外推） | default | — |
| `CancelGuideChecklist` | `steps: {text, tip}[]`、`caseId`（rag 引用） | default / expanded | CitationCollapse |
| `StorySegment` | `segment: AnnualStorySegment`（08 §⑥.5）、`revealed` | hidden / revealed | ChartCard |
| `RankBadge` | `tier: 1\|2\|3\|4\|5`、`title`、`criteria`（5 档规则判定，F10） | default | — |
| `AchievementWall` | `unlocked: string[]`（`spendct:achievements:v1`，可重算；13 枚全真实行为判定、演示回退删除——无本地记录一律空集、新访客全锁为正常初始态，08 修订案 A19） | default | — |
| `PosterCanvasButton` | `onGenerate`、`busy`（canvas 1080×1920 合成 < 2s） | idle / drawing / done / failed | DegradeToast |
| `CapabilityCardWall` | `capabilities: CapabilityItem[10]`（与 /privacy 静态版同数据源） | default | — |
| `TechArchStrip` | —（纯静态图标化管线） | default | — |
| `AssistantDrawer` | 悬浮入口 + 聊天抽屉（全局，任何非登录页可用；桌面 400×600 面板、移动端全屏，08 修订案 A12） | closed / open | ChatBubbles、ToolBadge |
| `ChatBubbles` | `turns: ChatTurn[]`（追问面板与智能助理共用的问答气泡展示层，08 修订案 A12） | idle / thinking / streaming / answered | PlanBlock、ToolBadge |
| `PlanBlock` | `goal`、`steps`（渲染 plan 事件「思考计划」块，07 §2 第 21 类） | pending / running / done / failed | — |
| `CaptchaField` | `id`、`mockBypass?`、`disabled?`（canvas 自绘验证码 120×40 按 dpr 缩放、±25° 旋转 + 干扰曲线 + 噪点；点击 canvas 或刷新按钮换图、键盘可达；`verify()` 客户端本机比对，失败自动换图 + 清空输入，错误走字段内 error 行；DEMO_MODE=mock 留空即过，08 修订案 A19） | idle / invalid | — |

> 四大静态图组件（CalendarHeatmap / CategorySankey / HealthRadar / MerchantWordcloud）为「页面代码静态渲染」组件：确定性 SQL 直出数据 + ECharts 直接渲染，**不进 ChartSpec 枚举**（08 §④ 裁决），但实现与 ChartCard 相同的 `AnchorSelection` 捕获接口（§2.3）以保留锚点追问能力；色板与渲染规范见 §3.6。分档口径（08 §1.2）：省赛落地前两大图，后两大图国赛窗口补齐，四组件规格均按本节登记与 §3.6 规范实现。

### 2.3 数据契约（唯一来源 = 07 契约；UI 只 import 不复制，#4/#33/#60）

> 本文旧版曾自写 `EvidenceChartSchema` / `InsightCardSchema` v05 / `PipelineEvent` v05——已删除。
> 全部改引用 07 契约；任何字段变更走 07 契约评审，不在本文私下扩展。

```ts
// src/lib/schemas/insight.ts —— 消费侧只 import，不复制（07 §0.4 唯一来源文件）
import type { InsightCard, InsightCardDraft, ChartSpec, Citation } from "@/lib/schema/insight-card"; // 07 §4 insight-card@v1（zod@4.6.7 z.strictObject）
export type { InsightCard, InsightCardDraft, ChartSpec, Citation };
export type InsightCardData = InsightCard; // UI 渲染别名
// 关键字段（07 §4）：stage / headline(8-120) / narrative(8-600) / confidence(数值 0-1, 禁 high|medium|low) /
// significance(≤40) / evidence{ chart: ChartSpec, stats 1-4 } / sources(1-3, CitationSchema) /
// actions(默认 ["confirm","dispute","drill"], 异常卡加 "fix") / status(draft|published|withheld) / selfCheck / disclaimer
// ChartSpec: tableId / chartType(bar|line|pie|histogram|scatter|heatmap|table 七类, 无 sankey) /
// title(≤40) / dimField / measureFields(1-2) / sortBy(desc|asc) / topN(3-24, 默认 8) / note(≤60)
// 引用 ref 格式（CitationSchema kind sql|rag|tool|rule|personal）：
// sql:${table|view}:${tableId} / rag:${caseId} / tool:${toolName} / rule:${ruleId} / personal:${anomalyId}
```

```ts
// src/lib/protocol/events.ts —— 事件协议唯一来源（07 §2 spendct协议@2，SSE，#3/#28）
// 21 类事件（任何文档不得自造事件名），公共字段 { t, ts, runId }：
// run:start / run:complete / error / abort / stage:start / stage:thinking / stage:evidence /
// stage:complete / stage:skipped / card:delta / card:complete / card:withheld /
// llm:degraded / llm:repair / rag:retrieved / tool:start / tool:end / reflect:result /
// cache:hit / checkpoint:saved
// plan（08 修订案 A12 第 21 类：goal 非空 + steps 1-4 步；在线兜底 run:start 后第 0 步发射，assistant-plan 8s 超时/失败静默跳过）
import type { ProtocolEvent } from "@/lib/protocol/events";
export type PipelineEvent = ProtocolEvent; // UI 消费别名
export type StageId = "clean" | "profile" | "anomaly" | "subscription" | "attribution" | "annual"; // 07 §1 序号 1-6
export type ModelId = "deepseek" | "qwen" | "glm4v" | "local-tfjs"; // 07 §12

// 旧事件名 → 07 §2 映射（消费渲染用，旧名一律作废）：
// llm-fallback→llm:degraded / rag-hit→rag:retrieved / llm-streaming→card:delta /
// sql-running/sql-done→stage:evidence(tableId,sqlHash,rowCount,elapsedMs) /
// card-published→card:complete / checkpoint→checkpoint:saved

// 展示名映射（#64）：
export const MODEL_DISPLAY: Record<ModelId, string> = {
  deepseek: "DeepSeek-V3",
  qwen: "Qwen（SiliconFlow）",
  glm4v: "GLM-4V-Flash",
  "local-tfjs": "本地小模型（断网）",
};
```

```ts
// src/lib/followup/selection.ts —— 追问上下文（canonical = 07 §18 SelectionContext，#65）
export interface SelectionContext {
  anchor: { cardId: string; stage: StageId;
            dim: "merchant" | "category" | "time_month" | "channel";
            value: string; metric: string; dataIndex?: number };
  slice: unknown[];                                    // await sanitizeResult(…) 脱敏后 ≤50 行（07 §5；A12 起 S2 改 WebCrypto 异步哈希，签名 async，六阶段/追问/智能助理共享管线一律 await）
  tableMeta: { tableId: string; columns: string[] };   // tableId ∈ 07 §3 注册表
  chartType: ChartSpec["chartType"];                   // 07 §4 七类
  question: string;
  history: string[];                                   // ≤6 条
}

// 图表点选/框选 = UI 捕获中间态（chartId 为本地图表 id）；提交时折叠为 SelectionContext，
// brush 的选择集合折成 anchor.dataIndex 集合（#65）
export type AnchorSelection = {
  chartId: string;
  mode: "point" | "brush";
  seriesName?: string;
  dataIndex?: number | number[]; // point: 单点; brush: 索引集合
  xLabel?: string;               // "2026-05" 或类别名
  valueLabel?: string;           // "¥1,294 / 23 笔"
};

// src/lib/schemas/anchor.ts —— 计划与回合（canonical = 07 §18）
export type PlanStep = {
  id: string;
  label: string;                 // "按月份聚合餐饮支出"
  kind: "sql" | "rag" | "tool" | "summarize";          // 07 §18 PlanStepKind
  status: "pending" | "running" | "done" | "failed";
  toolName?: "calendar" | "weather" | "promo" | "duckdb_meta" | "sql"; // 07 §18 工具注册表短名
  detail?: string;               // 执行详情: 脱敏 SQL / 模型名 / 耗时 / 命中数
};
// 上限（07 §18）：计划 ≤6 步、observe-decide ≤4 循环、SQL 重试 ≤1、zod 修复 ≤2

export type FollowUpTurn = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "plan" | "chart" | "table" | "refusal";
  text?: string;
  plan?: PlanStep[];
  chart?: InsightCardData;       // 答案落图: 与 InsightCard 同构(07 §4), 可继续锚定
  table?: { columns: string[]; rows: (string | number)[][]; note?: string };
  refusal?: { reason: string; suggestion: string };
  sel?: SelectionContext;
  at: number;
};
```

```ts
// 08 功能扩展新增 schema（08 §⑥ 单一来源；UI 同样只 import 不复制）：
// QuickEntrySchema（src/lib/schema/quick-entry.ts，⑥.1）：parseable / entry{amountCents(分)/direction/category/merchant/ts/note} / reason
// BudgetAdviceSchema（⑥.2）：severity(ok|warn|over) / headline / advice / actions[]
// ForecastNarrativeSchema（⑥.3）：headline / narrative / disclaimer（zod literal 原文）
// TipPersonalizeSchema（⑥.4）：tips[{caseId, why}]×3（caseId 必须来自检索结果，防编造引用）
// AnnualStorySchema（src/lib/schema/annual-story.ts，⑥.5）：segments[4-8]{order/headline/narrative/chartSpec}——
//   chartSpec 引用 07 §4 ChartSpecSchema 七类（08 §④：LLM 答案图表仍限七类，四大静态图不进枚举）
```

### 2.4 InsightCard 完整解剖（产品核心组件）

```
┌─────────────────────────────────────────────────┐
│ ① 顶栏 [阶段徽标·消费画像]  [置信度 ●●●○ 0.72]    │
│                             [确认✓] [质疑✗]      │
│ ② 结论区 headline（600/16px）+ narrative（14px 两行截断）│
│ ③ 证据图表区 ChartCard（可锚定/可切表格/骨架屏）      │
│    或 withheld 复核占位（中性灰: 未过闸门原因 + 建议动作）│
│ ④ 引用折叠区 [SQL: profile_category_stats · 1,204 笔 ▾]│
│              [RAG: C017 · 大学生外卖支出 ▾]         │
│ ⑤ 操作行 [确认] [质疑] [深挖 →] [数据表]            │
└─────────────────────────────────────────────────┘
```

- **置信度 4 档**（confidence 为 0-1 数值，07 §4 禁 high|medium|low 枚举；4 档只是 UI 渲染分级）：≥0.9 `●●●●` 高 / 0.7–0.9 `●●●○` 较高 / 0.5–0.7 `●●○○` 中 / <0.5 `●○○○` 低 + 「证据有限」标签。
- **发布闸门**（07 §4，#20）：`selfCheck.pass && confidence ≥ 0.6` 且显著性达标才 published，否则 withheld 进复核区（宁缺毋滥）；筛选行提供「显示低置信度」开关查看 withheld 卡。
- **状态迁移**（07 §4 三态）：`draft`（骨架 + narrative 真实流式，card:delta）→ `published` / `withheld`。`confirmed` / `disputed` / `error` 为 UI 覆盖态：confirmed（边框品牌高亮 800ms 回落）/ disputed（卡片降透明度、图表折叠）/ error（卡内 DegradeToast + 模板叙事兜底）。
- **操作语义**：确认 = FeedbackButton(kind=confirm)；质疑 = FeedbackButton(kind=dispute) → DisputeReasonPopover（3 个预设理由 + 自由文本 ≤ 120 字）；深挖（drill）= 卡内追问区展开并预填示例问题（本地规则生成，非 LLM）；数据表 = ChartCard 表格视图（无障碍救济通道，§3.6）。

### 2.5 ThinkingBubble（真实思考状态面板）

Props 与事件协议见 §2.3（07 §2）。三个区块，**只渲染真实事件，不渲染任何伪造内容**（§5.1 硬规定）：

1. **阶段进度区**：当前阶段 + 确定性进度（`stage:thinking.text`，来自真实行数/子任务计数，如「已清洗 3,214 / 10,000 行」）；`cache:hit` 时显示「⚡ 命中缓存，0.4s」。
2. **执行中 SQL 区**：`stage:evidence` 的 tableId/sqlHash 语法高亮（SQL 全文来自阶段计划的白名单校验产物，07 §6），最多 3 行 160 字符/行截断 + 展开；SQL 旁固定徽标「已聚合 · 只读 · 白名单通过」——展示的 SQL 本来就是白名单校验通过的聚合 SQL，这既是透明也是防注入的宣传点。
3. **证据来源区**：`rag:retrieved` 命中案例 chip（caseIds，点击展开摘要）；`llm:degraded` 事件 → 顶部 DegradeToast「已从 DeepSeek 切换至 Qwen（SiliconFlow）」；`tool:end` → ToolBadge 徽章。

显示策略：面板保留最近 50 条事件，超出折叠为「…（n 条已折叠）」；自动滚底，用户上滚 80px 以上暂停自动滚底，回到底部恢复。

### 2.6 UploadDropzone / OcrDropzone / ParsePreviewTable

```ts
type UploadDropzoneProps = {
  accept: "csv" | "image";
  maxSizeMB?: number;                    // 默认 20
  onFiles: (files: File[]) => void;
  onParseState: (s: ParseState) => void;
};
type ParseState =
  | { phase: "idle" }
  | { phase: "sniffing"; detail: string }          // "微信账单 v2.1 格式嗅探中…"
  | { phase: "preview"; mapping: FieldMapping; lowConfidence: Set<CellKey>; dedupRemoved: number }
  | { phase: "importing"; rows: number; total: number }   // DuckDB 分片导入进度
  | { phase: "error"; code: "unsupported-format" | "ocr-failed" | "too-large" | "import-failed"; message: string };
```

- 拖拽区：虚线边框 + 图标 + 「拖入 CSV / 截图，或点击选择」；dragging 态边框变品牌色 + 底色 4% 品牌蓝；`featureFlags.ocr=false` 时整个截图入口隐藏。
- OCR 低置信度：`ParsePreviewTable` 中低置信度单元格黄底（`#fef3c7`）+ 右上角三角标「待确认」，点击进入编辑（内联 input，回车确认，Esc 取消）；表头显示「N 个字段待确认」。这对应产品决策「低置信度字段标黄人工确认」。
- 解析预览的 AI 兜底（CSV 格式碎片化对策）：嗅探失败时进入「AI 解析预览」——只做预览、必须人工确认字段映射后才能导入。

### 2.7 PipelineStepper / CheckpointBar

```ts
import type { StageId, StageStatus } from "@/lib/pipeline/stage"; // 07 §0.4 唯一常量文件
// StageStatus = pending | running | succeeded | skipped | failed（07 §1 唯一枚举）
type PipelineStepperProps = {
  stages: { id: StageId; label: string; hint: string }[];  // 文案固定:
  // 清洗→"解析与清洗" / 画像→"消费画像" / 异常→"异常检测" / 订阅→"订阅陷阱扫描" / 环比→"环比归因" / 报告→"年度报告"
  status: Record<StageId, StageStatus | "paused">;  // paused = UI 局部覆盖态(暂停)
  pct?: Record<StageId, number>;
  outputCount?: Record<StageId, number>;   // 每阶段已发布洞察卡数
  activeStage: StageId;
  onStageClick?: (s: StageId) => void;     // 仅展开详情, 不支持跳转(顺序执行)
};
```

- 垂直步骤卡：左侧状态圆点（pending 灰 / running 品牌蓝脉冲 / succeeded 品牌蓝对勾 / skipped 灰划线 / failed 红 / paused 黄），连接线 2px；点击展开该阶段产出摘要（`outputCount` 卡数 + 耗时）。
- CheckpointBar：运行中显示 [暂停]（确认后写 runState，§5.3）；暂停态显示「已暂停 · 进度已保存于本机」+ [继续] [重新开始]。

### 2.8 SubscriptionRadarCard / HealthIndexGauge

```ts
type SubscriptionHit = {
  id: string;
  ruleId: string;                     // 规则编号, 引用格式 rule:${ruleId}（07 §4 CitationSchema）
  merchantRef: string;                // 商户名脱敏引用: m_+8hex（07 §0.3）
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  amountCents: number;                // 单次金额, 分（07 §3 全项目唯一金额单位, 显示层 /100 并按 02 分箱）
  period: { from: string; to: string };
  totalPaidCents: number;
  hits: number;
  spark: { x: string; y: number }[];  // 连续扣费 sparkline(确定性 SQL 产出)
  cancelGuide?: { caseId: string; title: string; steps: number; source: string }; // rag:${caseId}, 04 RAG
};
```

模板 SQL（预计算，UI 展示于引用折叠区，与 03 的模板库同源）：

```sql
-- 连续小额扣费识别(经聚合白名单校验: GROUP BY / 无 SELECT * / 无明细列投影)
-- 完整确定性实现见 03 §1.3 S4；业务规则 = 07 §3：同商户 ≥3 笔、单笔 1–60 元、
-- 相邻间隔 25–40 天、金额容差 ±1%（间隔与容差用窗口函数 LAG 校验，此处仅示意）
SELECT merchant, COUNT(*) AS hits, SUM(amount_cents) AS total_paid_cents,
       MIN(ts) AS first_seen, MAX(ts) AS last_seen
FROM transactions
WHERE direction = 'expense' AND amount_cents BETWEEN 100 AND 6000
GROUP BY merchant
HAVING COUNT(*) >= 3
ORDER BY total_paid_cents DESC
LIMIT 20;
```

卡片交互：sparkline 的扣费点可锚定追问；「取消攻略」折叠展开 04 的 RAG 引用（标题 + 步骤数 + 来源）；打标 [是订阅] [误报] 回流 04 评测集。

```ts
type HealthMetric = {
  id: string;
  name: string;                       // 具名指标: "隐形订阅率" / "冲动消费浓度" / "餐饮占比"
  value: number;                      // 0-100
  benchmark?: number;                 // 同龄同城基准(模板数据)
  delta?: number;                     // 环比, 百分点
  status: "good" | "warning" | "serious" | "critical";
  explain: string;                    // 一句话算法口径(评审追问时的答案)
};
```

```sql
-- 隐形订阅率: subscription_patterns 命中金额 / 总支出（subscription_patterns = 07 §3 注册表）
SELECT ROUND(100.0 * sp.total_cents / t.total_cents, 1)
FROM (SELECT SUM(amount_cents) AS total_cents FROM transactions WHERE direction = 'expense') t
CROSS JOIN (SELECT SUM(total_cents) AS total_cents FROM subscription_patterns) sp;

-- 冲动消费浓度: 深夜时段(23:00-05:00, 07 §3 深夜定义)支出占比
SELECT ROUND(100.0 * SUM(CASE WHEN EXTRACT(hour FROM ts) >= 23 OR EXTRACT(hour FROM ts) < 5
                         THEN amount_cents END) / SUM(amount_cents), 1)
FROM transactions
WHERE direction = 'expense';
```

仪表渲染：环形 gauge（ECharts `gauge`，详见 §3.6 主题），数值 count-up 600ms（reduced-motion 直接终值）；status 图标 + 标签成对出现（§3.1 状态色规则）。

### 2.9 PrivacyBadge / ErrorBoundary / DegradeToast / EmptyState / Skeleton

```ts
type PrivacyLevel = "local-only" | "aggregated-to-llm" | "server-relay";
// local-only:        当前视图数据只在浏览器内(明细表 / DuckDB 查询)
// aggregated-to-llm: 当前内容涉及发给 LLM 的聚合摘要
// server-relay:      当前请求经服务端中转(模型调用 / OCR), 服务端不落盘
```

- PrivacyBadge 固定于 TopNav：盾牌图标 + 层级文案，点击弹出 `visibility.ts`（02 维护）驱动的 mini 对照表，并链接 `/privacy` 全表。层级由当前页面/操作实时计算：账本汇总明细视图（/insights 内）= local-only；洞察卡叙事流式输出中 = aggregated-to-llm；OCR 识别中 = server-relay。

```tsx
// src/components/app/chart-error-boundary.tsx —— 图表渲染期错误兜底
export class ChartErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onReset?: () => void }, { hasError: boolean }
> {
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error, info: React.ErrorInfo) { console.error("[chart]", e, info); }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}
// 使用: <ChartErrorBoundary fallback={<EmptyState title="图表渲染失败" action={{label:"查看数据表",...}}/>}>
```

```ts
type DegradeToastProps = {
  severity: "info" | "warning" | "error";
  title: string;                       // "已切换至内置分析模板"
  explain: string;                     // "AI 服务暂时不可用，结论来自确定性 SQL，图表不受影响"
  fallback?: string;
  retry?: () => void;
  dismissable?: boolean;               // 默认 true
};
```

```ts
type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
};
type SkeletonProps = { variant: "card" | "chart" | "table" | "text"; rows?: number };
// shimmer: linear-gradient(90deg, transparent, var(--surface-2), transparent), 1.5s 循环;
// prefers-reduced-motion 时静止(§3.7)
```

### 2.10 全局智能助理（AssistantDrawer / ChatBubbles / PlanBlock，08 修订案 A12）

规格来源 = 07 §18 A12 / 07 §21 05 文档第 14 条。全局智能助理与洞察页追问面板**共用同一问答管线**（唯一实现 `src/lib/assistant/use-chat-pipeline.ts`）；组件已按两级注册口径登记于 §2.2 组件总表。

```
┌──────────────────────────────────────┐
│ 智能助理（聊天抽屉）                   │
│ ChatBubbles 消息列表 × N              │
│  每条消息脚注三态：                    │
│   本地计算 / 本地案例库 / 在线生成      │
│ 思考计划块 PlanBlock（goal + 1-4 步）  │
│ ToolBadge 工具徽章（07 §18 A9 展示规格）│
│ [语音] 输入框 [发送]                   │
│ 空态：示例问题 3-4 条 + [新对话]        │
└──────────────────────────────────────┘
悬浮入口：右下固定，任何非登录页可用（桌面抽屉 400×600 面板，移动端全屏）
```

1. **入口与形态**：AssistantDrawer 悬浮入口右下固定，任何非登录页可用；聊天抽屉桌面 400×600 面板、移动端全屏（§1.1/§4.5）。
2. **管线顺序（唯一，07 §18 A12）**：输入闸门 → 闲聊分流（small-talk 罐头）→ 本地规则问答（`qa-engine` 九类意图 + 白名单 SQL，浏览器内按账单数据计算；账单问题时间窗八类（08 修订案 A18）：本月/上月/上上个月/今年/最近 7 天/最近 30 天/最近 90 天/指定月份（monthRef），洞察页锚点标签时间窗口径与之一致，07 §18 A18）→ 本地案例检索（仅智能助理）→ 在线兜底（`POST /api/followup` 的 `question+messages` 模式，零新端点）。
3. **输入闸门（`src/lib/assistant/input-guard.ts`，注入防护第四层，02 §11）**：判定顺序 = 控制字符 → 超长（>500 字）→ 四类注入特征（指令覆盖、角色劫持、泄露诱导、SQL 痕迹）；命中即拦——固定拒绝话术 + 脚注「已拦截 · 未进入任何模型」，不进任何本地/在线路径（§4.4 降级链）。
4. **本地案例检索（`src/lib/assistant/local-cases.ts`）**：攻略/常识类问题先查本地案例库（TF-IDF），聊天路径阈值 `CASE_PATH_MIN_SCORE = 0.15`（高于页面浏览引用的 0.08，页面引用口径不变），最多 3 条 + 脚注「本地案例库 · 零 API 调用」；零命中转在线兜底。
5. **思考计划块（PlanBlock）**：在线兜底在 `run:start` 后第 0 步发射 plan 事件（07 §2 第 21 类）：goal 非空 + steps 1-4 步，`tool` 只填 get_school_calendar / get_weather / get_promo_calendar（用不到则省略）；mock 走脚本化演示流（`mockAssistantPlan`，大促档第一步挂 `get_promo_calendar`），live 走 assistant-plan 任务结构化生成（`generateLlmObject`，归 deepseek，07 §12），8s 超时/失败静默跳过——回答不受影响，仅不展示思考计划块（§4.4）。
6. **语音输入（`src/lib/assistant/use-speech-input.ts`）**：Web Speech 浏览器转写（zh-CN，错误三态提示），转写文字只写入聊天输入框；音频由浏览器厂商语音服务处理，本项目服务器与 LLM 都不接收音频（02 §8）；feature-flag `voice` 控制，不支持的浏览器隐藏麦克风入口。
7. **消息脚注三态**：本地计算 / 本地案例库 / 在线生成——按路径如实标注；在线兜底沿用 07 §18 A8 明细快照口径（气泡脚注「在线生成 · 已发送明细与统计」）与 A9 工具徽章/降级声明（ToolBadge 展示规格见 §2.5 第 3 区）。
8. **与追问面板共享**：追问面板重构为同一 `use-chat-pipeline`（不开本地案例路径、PEO 协议不变，§4.1）；脱敏器 `sanitizeResult` 因 S2 改 WebCrypto 异步哈希而改 async 签名（07 §5），共享管线一律 `await`。
9. **必落图范围注**：智能助理聊天为文本回答 + 思考计划块；「每答必落图」三选一（§0.4 原则三）仅约束锚点追问路径，不适用于智能助理聊天（07 §18 A12）。
10. **隐私与端点**：本地两条路径（规则问答、案例检索）零 API 调用；在线兜底复用 `/api/followup`——零新端点、零新 env 键（07 §18 A12）。

---

## 3. 设计系统

### 3.1 配色方案

**品牌叙事**：金融信任感 + 年轻化。信任蓝（金融机构底色，深海蓝调）+ 健康青（「体检」隐喻，也是图表分类第 3 槽）+ 活力橙（年轻化点缀，图表分类第 2 槽）。三类色域严格分工：**品牌色管 UI、分类色管图表系列、状态色管警示**，三者不互借（防止系列色冒充警示色的观感事故）。

**3.1.1 UI Token（CSS 变量，亮暗两套；Tailwind 映射）**

```css
:root, [data-theme="light"] {
  color-scheme: light;
  --surface-page: #f5f6f8;      /* 页面底色 */
  --surface-card: #ffffff;      /* 卡片/图表面 */
  --surface-2: #eef0f4;         /* 次级填充(折叠区/骨架) */
  --ink-primary: #16181d;       /* 主文字 17.8:1 */
  --ink-secondary: #52555c;     /* 次级文字 7.3:1 */
  --ink-muted: #8a8f99;         /* 刻度/装饰 3.2:1(仅图形元素) */
  --line-hair: #e8eaee;         /* 网格/分隔 */
  --line-base: #c9cdd4;         /* 轴线 */
  --brand-500: #2e7ce8;         /* 品牌蓝(大号数字/高亮/图表槽1) */
  --brand-600: #1f63c9;         /* 链接/文字按钮(白底 5.7:1) */
  --brand-700: #1a55ad;
  --btn-primary: #2563eb;       /* 主按钮底(白字 5.2:1) */
  --btn-primary-hover: #1d4ed8;
  --accent: #f26b38;            /* 活力橙点缀 */
  --health: #0fa87a;            /* 健康青(次级品牌) */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 20px;
}
[data-theme="dark"] {
  color-scheme: dark;
  --surface-page: #0e1013;
  --surface-card: #14161a;      /* 图表面(验证基准) */
  --surface-2: #1f2329;
  --ink-primary: #eceef2;       /* 15.6:1 */
  --ink-secondary: #b9bdc7;     /* 9.9:1 */
  --ink-muted: #83878f;         /* 5.0:1 */
  --line-hair: #23262c;
  --line-base: #3a3e46;
  --brand-500: #4c8ff0;
  --brand-600: #6ba3f5;         /* 暗色链接 7.1:1 */
  --btn-primary: #2563eb;
  --accent: #e06a2e;
  --health: #0fa87a;
}
```

```css
/* Tailwind v4 CSS-first 配置（版本与写法以 01 锁表 4.3.3 为准；不建 tailwind.config.js，#11）。
   上方 CSS 变量即 @theme 设计令牌：@theme 声明令牌、@theme inline 映射 shadcn 变量（01 §1.1 规则），
   ECharts 主题经 getComputedStyle 读取同一批变量（§3.6）。工具类直接引用：
   text-(--ink-primary) / bg-(--brand-500) / border-(--line-hair) */
```

**3.1.2 状态色（固定，永不做主题化；必须图标 + 标签成对出现）**

| 角色 | hex | 亮面对比度 | 用途 | 文字档 |
|---|---|---|---|---|
| good | `#0ca30c` | 3.4:1 | 确认成功/已确认 | `#0a7a3e` |
| warning | `#fab219` | 1.8:1（低于 3:1 属设计意图，靠图标+标签补救） | 低置信度标黄/待确认 | `#92400e` |
| serious | `#ec835a` | 2.6:1 | 暂停/需注意 | `#b5441e` |
| critical | `#d03b3b` | 4.8:1 | 错误/失败/高危订阅 | `#b91c1c` |

规则：状态色永远不担任「第 4 个系列色」；状态提示 = 色 + 图标 + 文字三件套，颜色绝不单独承载语义。涨跌指示（支出↑=橙 `#c2410c` / ↓=绿 `#0b6b3c`）必须带 ↑↓ 图标与数值，禁止只靠颜色。

**3.1.3 图表分类色板（8 槽固定顺序，经 OKLab×100 CVD 模拟验证）**

| 槽 | 色相 | 亮色 | 暗色 |
|---|---|---|---|
| 1 | 蓝 | `#2e7ce8` | `#4c8ff0` |
| 2 | 橙 | `#f26b38` | `#e06a2e` |
| 3 | 青 | `#0fa87a` | `#0fa87a` |
| 4 | 黄 | `#eda100` | `#c98500` |
| 5 | 品红 | `#e87ba4` | `#d55181` |
| 6 | 绿 | `#0b8f45` | `#0a8440` |
| 7 | 紫 | `#6a5ae0` | `#9085e9` |
| 8 | 红 | `#e34948` | `#e66767` |

实测验证结果（2026-10-13 以 OKLab×100 CVD 模拟工具对亮面 `#ffffff` / 暗面 `#14161a` 运行；色板回归并入 Vitest 快照测试，不设独立脚本路径，#71）：

| 检查 | 亮色 | 暗色 |
|---|---|---|
| 相邻对 CVD 分离（目标 ΔE≥8，模拟 protan/deutan） | PASS，worst 10.0（青↔橙） | PASS，worst 9.9（黄↔青） |
| 相邻对正常视觉（≥15） | PASS，worst 19.6（品红↔黄） | PASS，worst 19.3（品红↔黄） |
| 明度带 / 彩度底线 | PASS | PASS |
| 对比度 vs 表面（≥3:1） | 黄 2.17、品红 2.69 触发救济规则 | 全 PASS |

救济规则（硬性）：**黄/品红槽必须带可见直接标签或「数据表」视图**——本产品所有图表默认带数据表切换（§3.6），该救济始终满足。

**系列上限**：柱/线/堆叠（相邻形式）可用满 8 槽；**散点/气泡/热力/小多图（任意两两相邻形式）最多 3 个系列**（前 3 槽全对验证通过：亮 worst 10.5 / 暗 worst 10.1），超出必须折入「其他」或分面。饼图上限 5 片 + 「其他」。顺序永远从槽 1 开始按序取用，**绝不跳槽、绝不循环、过滤后颜色不换人**（颜色跟实体走，不跟排名走）。

**3.1.4 顺序渐变 ramp（单色相，蓝）**：100 `#d8e9fc` / 150 `#c4ddfa` / 200 `#a9cbf7` / 250 `#8ab6f2` / 300 `#64a0ee` / 350 `#478fea` / 400 `#2e7ce8` / 450 `#2569c9` / 500 `#1e59ad` / 550 `#174a92` / 600 `#123c77` / 650 `#0e2f5f` / 700 `#0a244a`。用于热力图/序数渐变（漏斗/分档）；序数起点不浅于 250（对比度 ≥2:1）。暗色模式锚点翻转（高值取浅端）。

**3.1.5 双极发散**：蓝 ↔ 橙（降温 ↔ 升温/支出下降 ↔ 上升），中性灰中点（亮 `#f0efec` / 暗 `#383835`），两臂等步数。**刻意不用红**：红槽保留给 critical 状态与「高危订阅」，避免中文语境「红=上涨=好」与「红=错误」的语义冲突（设计决策记录，评委若问即此答）。

**3.1.6 亮暗主题策略**：`data-theme` 属性 + CSS 变量双轨；首访跟随 `prefers-color-scheme`，手动切换写 localStorage；暗色不是自动翻转，而是**独立验证过的第二套色阶**（上表暗色列经同一 CVD 模拟流程在暗面跑通）。ECharts 通过 MutationObserver 监听 `data-theme`，切换时 `echarts.dispose` 旧主题实例并重注册（`registerTheme("spendct-dark", …)`，见 §3.6），保证图表与 UI 同步且同一色板。

### 3.2 字体层级

字体栈：`system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", "Segoe UI", sans-serif`（不用衬线/展示字体）。**一切数字（金额、比例、百分比、指标值）强制 `font-variant-numeric: tabular-nums`**——流水线耗时、表格金额列、置信度数值必须纵向对齐。

| 层级 | 字号/行高 | 字重 | 用途 |
|---|---|---|---|
| hero | 32 / 40 | 700 | 健康指数总分、报告大数 |
| h1 | 24 / 32 | 600 | 页面标题 |
| h2 | 20 / 28 | 600 | 区块标题、洞察卡结论标题（16/600 例外，见 §2.4） |
| h3 | 16 / 24 | 600 | 卡片标题 |
| body | 14 / 22 | 400 | 正文、结论区、SQL 预览 |
| caption | 12 / 18 | 400 | 引用标签、徽标、刻度、时间戳 |
| mono | 12 / 18 | 400 | SQL、hash、代码（`ui-monospace, SFMono-Regular, Consolas, monospace`） |

### 3.3 间距体系

4px 基数：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`（Tailwind spacing 直接用）。关键约定：卡片内边距 20；卡片间距 16；页面左右留白 24（桌面）/ 16（移动）；图表与标题间距 8；组件内部控件组间距 8；分区间距 32。

### 3.4 圆角与阴影

| Token | 值 | 用途 |
|---|---|---|
| radius-sm | 6px | 按钮、输入框、chip |
| radius-md | 10px | 图表容器、引用折叠条 |
| radius-lg | 14px | 洞察卡、订阅卡 |
| radius-xl | 20px | 弹层、浮层、智能助理抽屉 |
| shadow-sm | `0 1px 2px rgba(16,24,40,.06)` | 按钮悬停 |
| shadow-md | `0 1px 3px rgba(16,24,40,.07), 0 4px 12px rgba(16,24,40,.05)` | 卡片默认 |
| shadow-lg | `0 8px 24px rgba(16,24,40,.10), 0 2px 6px rgba(16,24,40,.06)` | 弹层/追问面板/智能助理抽屉 |
| shadow-anchor | `0 0 0 3px rgba(46,124,232,.25)` | 图表锚点选中高亮 |

暗色模式：阴影改用表面层级区分（弹层比页面浅一档 `#1f2329`）+ 1px 发丝边框（`rgba(255,255,255,.10)`），不靠投影。

### 3.5 图标策略

`lucide-react`（随 shadcn/ui 生态），线性风格 1.75px 描边；默认 20px，密集区 16px；**图标颜色只用 ink 色阶或状态色，永不随系列色**（身份由旁边的小色点承担）。状态色三件套（色+图标+文字）见 §3.1.2。核心图标固定映射：锁(隐私)、盾(校验)、心电/听诊(体检)、雷达(订阅)、锚(锚点追问)、对勾(确认)、问号(质疑)、表格(数据表切换)。

### 3.6 ECharts 主题与图表配色规范

统一主题文件（图表、洞察卡、仪表共用同一 token 源）：

```ts
// src/lib/charts/echarts-theme.ts
import type { EChartsOption } from "echarts";
import { tokens } from "@/lib/design-tokens"; // 与 CSS 变量同源

const base = (t: typeof tokens.light) => ({
  color: t.categorical,                       // ["#2e7ce8","#f26b38","#0fa87a","#eda100","#e87ba4","#0b8f45","#6a5ae0","#e34948"]
  backgroundColor: "transparent",
  textStyle: { fontFamily: t.fontStack, fontSize: 12, color: t.ink.secondary },
  title: { textStyle: { fontSize: 14, fontWeight: 600, color: t.ink.primary } },
  legend: { icon: "roundRect", itemWidth: 10, itemHeight: 10, itemGap: 16,
            bottom: 0, textStyle: { color: t.ink.secondary } },
  tooltip: {
    backgroundColor: t.tooltipBg, borderWidth: 0,
    textStyle: { fontSize: 12, color: t.tooltipInk },
    padding: [8, 12], extraCssText: `border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.12);`,
    confine: true,
  },
  categoryAxis: { axisLine: { lineStyle: { color: t.line.base } },
                  axisTick: { show: false },
                  axisLabel: { color: t.ink.muted } },
  valueAxis: { splitLine: { lineStyle: { color: t.line.hair } },
               axisLabel: { color: t.ink.muted } },
});

export const spendctLight = { ...base(tokens.light), tooltip: { ... } };
export const spendctDark  = { ...base(tokens.dark) };
export function registerSpendctThemes() {
  echarts.registerTheme("spendct-light", spendctLight);
  echarts.registerTheme("spendct-dark", spendctDark);
}
```

按图表类型的标记规范（实现时逐条执行）：

| 图表 | 规范 |
|---|---|
| bar | `barMaxWidth: 28`；垂直柱圆角 `[3,3,0,0]`、水平柱 `[0,3,3,0]`（4px 圆角锚定基线）；堆叠段之间用 `itemStyle.borderColor: surface, borderWidth: 2` 造 2px 表面间隔；单系列不显示图例框（标题点名系列），≥2 系列必有图例 |
| line | `lineWidth: 2`；`symbol: "circle", symbolSize: 8`，默认 `showSymbol: false` 仅悬停显示；**可点击锚点场景必须开 `showSymbol: true`**（圆点描边 surface、symbolSize 9——ECharts 折线线体/面积不携带逐点 dataIndex，不开圆点则点击回调收不到 name/value，锚点拼不出月份金额）；面积填充渐变 opacity 0.08→0；≤4 系列加 `endLabel` 系列末端直接标签；坐标轴 tooltip（axis trigger）+ 十字准星 |
| pie/donut | `radius: ["62%","80%"]`；切片间 2px 表面描边；上限 5 片 + 「其他」；图例外置；每片直接标签（名称+百分比），关键片保留数值 |
| scatter | 最多 3 系列（全对形式）；`symbolSize: 10`；每点悬停 tooltip；用于「商户金额×频次」象限图 |
| heatmap | 只用 3.1.4 蓝 ramp；图例说明「浅=少」；**日历热力图（消费日历页）分段色阶**：`visualMap.type: "piecewise"` + `show: true` 常显图例，固定五档 `≤50 / 50-100 / 100-200 / 200-500 / >500 元`（阈值不随数据自适应——日常消费集中在几十到几百元，小金额段细分才能拉开深浅差异），同色系透明度 0.1→1.0 递增；calendar `bottom: 28` 给横向图例让位 |
| gauge | 健康指数：`startAngle: 210, endAngle: -30`，进度色按 status 三件套；只画单值，不画多指针 |

**四大静态图表组件渲染规范（08 §④.2，页面代码静态渲染，不走 ChartSpec 枚举）**——分档口径（08 §1.2）：**省赛落地 CalendarHeatmap / CategorySankey 两大图，HealthRadar / MerchantWordcloud 国赛窗口补齐**（组件规格仍按本节实现，不因档期降规格）。裁决理由见 08 §④.1（桑基三字段、雷达多维超出 measureFields 1-2 的契约形状；sankey 曾因 #72 从 07 §4 删除；固定形态产品无需 LLM 声明，确定性优先）：

| 组件 | 数据源（既有视图，零新表） | ECharts 类型 | 交互 | 色板 |
|---|---|---|---|---|
| `CalendarHeatmap` | `v_daily_expense` | `heatmap`（日历坐标系） | 格点点击锚定（dim: time_month） | 蓝 ramp（§3.1.4） |
| `CategorySankey` | `v_category_monthly`（当月环比迁移） | `sankey` | 节点点击锚定（dim: merchant） | 8 槽按序取用（§3.1.3） |
| `HealthRadar`（国赛窗口） | `v_health_inputs`（六维健康分） | `radar` | 顶点点击锚定（dim: category） | 单系列品牌蓝 |
| `MerchantWordcloud`（国赛窗口） | `v_merchant_monthly`（n≥5 商户还原规则，07 §5） | 自绘 canvas 词云（~150 行，不引第三方词云库） | 词条点击锚定（dim: merchant） | 8 槽 + 尺寸映射金额 |

- 四大图是**固定形态产品**，由确定性 SQL 直出数据 + ECharts 直接渲染，不需要 LLM 声明（08 §0 原则二）；锚点能力不丢失：四组件实现与 ChartCard 相同的 `AnchorSelection` 捕获接口（chartId/mode/dataIndex，§2.3），折叠为 SelectionContext 后走既有 `/api/followup`（07 §18 零协议改动）。
- **LLM 答案图表仍限七类（bar/line/pie/histogram/scatter/heatmap/table）**：追问答案的 `chartSpec` 不得引用四大静态图类型；模型若认为数据形态更适合四大图 → 拒绝画图（§5.2 话术）或改用七类中最接近的表达（约束写入 03 §2.6 提示词，08 §④.1）。
- 全部带「数据表」切换按钮（规则 6 无障碍救济）：日历热力图数据表 = 日支出表、桑基数据表 = 类别×商户流向表、雷达数据表 = 六维健康分明细、词云数据表 = 商户排行表（等价表达）。
- 图表实例计入单页 ≤6 预算（规则 9）：四大图 IntersectionObserver 懒挂载（进入视口 200px 内才 `init`），与既有三图合计不超限；离屏 `dispose`。
- 桑基节点标签仅显示 n≥5 商户还原明文，其余显示 `merchantRef`（m_+8hex，07 §5 显示规则不变）。
- 新增 chunk 预算：四大图组件与 ECharts 同 chunk，总计 < 60 KB gzip（复用已引入的 echarts/core，无新依赖）。
- 词云 canvas 渲染同样过规则 7（aria-label + 数据表救济）；色板经 §3.1.3 CVD 验证后按序取用。

全局规则清单（违反即返工）：

1. **单轴**：禁止双 y 轴图表；两个不同量纲的指标 = 两张图或小多图；
2. 网格/轴线弱化（hair 色），**数据永远比坐标轴显眼**；直接标签只给高亮标记（每图 ≤3 个），禁止每个点都标数；
3. **数字/标签/图例文字一律 ink 色，永不染系列色**；
4. 悬停层默认必有：线/面十字准星+tooltip，柱/点逐标记 tooltip；命中目标 ≥ 8px 视觉、≥ 44px 触控；
5. 筛选行在图表上方一行内（日期预设 + 维度 combobox，§1.6）；
6. **每个图表必须有「数据表」切换按钮**（无障碍救济通道 + 黄/品红槽对比度救济的唯一出处）；表格视图受行数上限约束（≤ 500 行，超出截断并提示）；
7. ECharts `aria.enabled: true`；色弱模式开启 `decal` 纹理（设置面板开关，默认关）；
8. 图表渲染一律走 ChartSpec → registry 模板（07 §4 裁决：LLM 不再产出 ECharts option，#30；**四大静态图例外**——页面代码静态渲染，追问答案 chartSpec 仍限七类，08 §④）；registry 渲染结果仍过 `sanitizeEchartsOption` 白名单（序列化 → 递归校验 key 白名单 → 剥离 `renderItem`/函数值 → 冻结）作为降级防御，任何外部 option 一律不直接渲染；
9. 图表实例懒挂载（IntersectionObserver，进入视口 200px 内才 `init`）、离屏 `dispose`、单页同时存活 ≤ 6 个实例（§4.3 预算）。

### 3.7 动效语言

| 场景 | 时长 | 缓动 | 备注 |
|---|---|---|---|
| 卡片滑入（洞察卡发布） | 240ms | `cubic-bezier(0.16,1,0.3,1)` | 只动画 transform/opacity |
| 计划步骤树点亮 | 60ms/步 stagger | spring stiffness 500 damping 30 | §4.1 |
| 确认对勾 pop | 280ms | spring stiffness 400 damping 18 | §4.2 |
| 仪表 count-up | 600ms | linear 数值 | reduced-motion 直接终值 |
| 骨架 shimmer | 1.5s 循环 | linear | reduced-motion 静止 |
| 锚点高亮脉冲 | 2s 一次 | opacity 0.25→0 | 落图定位提示 |

`prefers-reduced-motion: reduce` 时：全部时长 ≤ 120ms 或直接跳终态；shimmer/脉冲禁用。动画一律走 transform/opacity（合成器线程），禁止动画 width/height/top/left。

---

## 4. 关键交互规范

### 4.1 锚点追问协议（核心创新交互，7 分交互模式的主证据）

范式：**图表上的任意数据点都是问题入口**。流程 = 选择 → 悬停提示 → 上下文确认 → 计划步骤树动画 → 答案落图（Plan-Execute-Observe 循环的可视化）。

**状态机**：

```
idle ──hover(200ms)──▶ hover ──click/brush──▶ selected ──[确认]──▶ planning
                                                              │
executing ◀──PLAN_READY(steps)──┘  （步骤树逐条点亮）            │
    │                                                         │
    ├──全部 done──▶ answered（答案落图+滚动定位+2s高亮） ──可再锚定──▶ (新一轮)
    ├──拒绝画图────▶ refused（话术 §5.2 + 建议动作）
    └──步骤失败────▶ 自动重试1次 ──仍失败──▶ failed（步骤红标+[重试][改用模板]）
Esc/取消: hover|selected|planning → idle
```

```ts
// src/stores/anchor.ts
export type AnchorFollowUpState =
  | { kind: "idle" }
  | { kind: "hover"; hint: AnchorHint }                            // 悬停提示(停留200ms触发)
  | { kind: "selected"; sel: AnchorSelection; hint: AnchorHint }   // 上下文确认浮层
  | { kind: "planning"; sel: AnchorSelection }                     // 计划生成中(≤3s, 超时→模板计划)
  | { kind: "executing"; sel: AnchorSelection; plan: PlanStep[] }  // 步骤树动画执行
  | { kind: "answered"; sel: AnchorSelection; answer: FollowUpTurn }
  | { kind: "refused"; sel: AnchorSelection; refusal: { reason: string; suggestion: string } }
  | { kind: "failed"; sel: AnchorSelection; error: string; retryable: boolean };
```

**交互时序**（每步：用户操作 / 系统反馈 / 时长 / 取消方式）：

| # | 用户操作 | 系统反馈 | 时长 | 取消 |
|---|---|---|---|---|
| 1 | 指针悬停图表元素 | 该元素十字准星高亮 + 顶部浮出 hint chip：「点击追问此数据点」+ 本地规则生成的示例问题（如「为什么 5 月餐饮突然变高？」） | 停留 200ms 后出现 | 移开即消失 |
| 2 | 点击 / 框选（brush 开关开启时长按拖动） | 锚点高亮（shadow-anchor 3px 品牌光环，非选中系列降透明度 40%）+ 底部浮出「上下文确认条」：锚点描述（`xLabel` + `valueLabel`，如「2026-05 · 餐饮 · ¥1,294 / 23 笔」；商户维度用 merchantRef，按 07 §5 规则决定是否还原明文）+ [追问] [取消] | 即时 | Esc / 点击空白 |
| 3 | 点 [追问]（或 Enter） | 确认条变「正在制定分析计划…」；追问面板展开（桌面 360px，移动端全屏 bottom sheet；追问面板 = 共享管线 use-chat-pipeline 实例，不开本地案例路径，08 修订案 A12）；PlanStepTree 挂载为骨架 | planning ≤ 3s，超时用模板计划 | 面板关闭按钮 |
| 4 | （Agent 产出 PlanStep[]，§4.1.1） | 步骤树逐条点亮：`running` 节点品牌蓝脉冲 + 右缘显示执行详情（脱敏 SQL 摘要 / 模型名 / 命中数） | 60ms/步 stagger | — |
| 5 | 观察执行 | 全部 done → 答案以图表/表格卡片从底部滑入（240ms），自动滚动定位 + 2s 高亮脉冲；答案与 InsightCard 同构，**可继续锚定追问**（每答必落图：answer.chart 必填，除非 refused） | 240ms + 2s 脉冲 | — |
| 6 | （可选）再锚定 | 回到 #1，形成追问链；历史 turns 保留在面板内可回看 | — | — |

**A12 重构（2026-10-15）**：追问面板重构为与全局智能助理共用同一问答管线（唯一实现 `src/lib/assistant/use-chat-pipeline.ts`）——追问路径不开本地案例检索、保持 PEO 协议不变；在线兜底在 `run:start` 后第 0 步发射 plan 事件（07 §2 第 21 类，8s 超时/失败静默跳过，§2.10）；消息脚注三态（本地计算 / 本地案例库 / 在线生成）按路径如实标注；输入闸门（`src/lib/assistant/input-guard.ts`，注入防护第四层：控制字符 → 超长（>500 字）→ 指令覆盖、角色劫持、泄露诱导、SQL 痕迹四类注入特征，02 §11）对追问与智能助理输入同样生效。

**A14 深度分析开关（2026-10-16）**：追问面板输入框上方新增「深度分析」chip 开关（默认关，`aria-pressed` 两态：开启提示「开启：直接交给大模型分析，并发送账单统计与明细」、关闭提示「本地规则优先，答不了才转在线」）。开启后本轮提问跳过闲聊分流/本地规则/本地案例，直连在线兜底 `POST /api/followup`（body 带 `analysisMode:"deep"`）——深度上下文由 `src/lib/chat/deep-analysis.ts` 生成（`buildDeepAnalysisQueries` 10 组代码常量白名单 SQL、支出类查询全部带 `status = 'paid'`、深夜逐月 50 月上限（占比标签诚实标注「近50个月」）、冲动按类目聚合全期不截断、`buildDeepAnalysisContext` ≤2400 字、逐组容错、超长整行丢弃、全失败空串，零动态拼接），与最近 150 笔明细快照分两条消息发送（各 ≤4000 字、总 ≤8000、≤20 条）；**08 修订案 A15（2026-10-16）起增至三条消息**：统计与快照之间插入「定向明细」段（`src/lib/chat/targeted-detail.ts`，按问题识别月份/年份/商户（DB 商户 Top50 名单最长匹配）/类目（CATEGORY_CODES 枚举）/深夜五类条件，LIMIT 200、≤2500 字，空结果如实说明查不到，任一段失败静默省略回退两条消息）；回答气泡脚注在既有三态来源脚注（本地计算 / 本地案例库 / 在线生成）之外增补深度分析档「深度分析 · 已发送账单统计与明细」（按实际发送组合标注——统计与明细都发送时显示合称，缺一段只说发了的那段，live 档同机制）。零新端点、零新路由、零新事件（协议仍 21 类）。

**4.1.1 上下文 JSON 与计划生成 Prompt（UI→Agent 的契约，canonical = 07 §18 SelectionContext，#65）**

```json
{
  "anchor": { "cardId": "card_profile_12_3", "stage": "profile",
              "dim": "time_month", "value": "2026-05", "metric": "amt", "dataIndex": 5 },
  "slice": [ /* sanitizeResult 脱敏后 ≤50 行（07 §5），列 ∈ 白名单投影 */ ],
  "tableMeta": { "tableId": "profile_monthly_stats", "columns": ["ym", "amt"] },
  "chartType": "line",
  "question": "为什么 2026 年 5 月餐饮支出突然升高？",
  "history": [ /* ≤6 条 */ ]
}
// 完整 /api/followup 请求体另含 sessionSchema 会话快照（07 §18 每次请求随行，服务端不缓存）
```

```
你是消费数据分析计划的制定者。用户对图表上的一个数据点提出了追问。
[SelectionContext 如上]
任务：产出不超过 6 步的分析计划（PlanStep[]），每步属于 sql|rag|tool|summarize（07 §18 PlanStepKind）。
约束：
1. SQL 必须是聚合查询（02 §6 R1-R10 白名单：GROUP BY、无 SELECT *、无明细列投影、仅 ALLOWED_RELATIONS 关系），只读；
2. 任一步失败重试 1 次（SQL 重试 ≤1），仍失败则回退内置分析模板（DRILL_TEMPLATES，03 模板库）；
3. 若数据不足以支撑结论，最后一步输出 refusal（reason + suggestion），不得编造；
4. 回答必须落为图表或结构化表格（kind: chart|table），纯文字回答视为失败；
5. observe-decide 循环 ≤4，zod 修复 ≤2（07 §18 上限）。
输出：符合 PlanSchema 的 JSON。完整系统提示词与 zod 修复闭环见 03 文档。
```

**4.1.2 动画实现（Framer Motion 片段，直接可用）**

```tsx
// PlanStepTree 节点
const stepVariants = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { type: "spring", stiffness: 500, damping: 30 } },
};
// 父容器: <motion.ul initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
// 答案落图卡片
const answerVariants = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] } },
};
// 锚点光环: boxShadow "0 0 0 3px rgba(46,124,232,.25)", transition: boxShadow 0.15s
```

### 4.2 打标反馈闭环动画

**流程**：点击 [确认] → 按钮对勾 icon pop（`scale: [1, 0.92, 1.06, 1]`，spring 400/18，280ms）→ 卡片边框品牌色高亮 800ms 后回落 → 卡片进入 `confirmed`（顶栏徽标 +「已确认」）。点击 [质疑] → DisputeReasonPopover（预设：「结论与我的实际情况不符」「证据不足」「图表看不懂」+ 自由文本 ≤120 字）→ 提交后卡片 `disputed`：降透明度至 70%、证据图表折叠为「已质疑 · 点击查看」、卡内 DegradeToast 出现「该卡已标记质疑，将不再用于个人化推荐」。

**反馈去向**（与 04 联动，UI 侧只负责上报）：确认/质疑写入本地 stats（`localStorage: spendct:feedback:v1`，含 cardId、kind、detail、datasetTxHash；属 07 §17 允许的 UI 偏好类键，只存统计不存行数据）；订阅卡 [是订阅]/[误报] 同路上报，供 04 扩充金标评测集与用户历史账单个人化 RAG。动画约束同 §3.7：只动 transform/opacity。

### 4.3 流式思考状态更新的节流与性能约束

**事件缓冲器**（ThinkingBubble 与洞察卡共用一个入口）：

```ts
// src/lib/stream/event-buffer.ts —— 120ms 批量 flush, 上限 ~8.3Hz
const buffer: PipelineEvent[] = [];
let last = 0;
export function enqueueEvent(e: PipelineEvent, flush: (batch: PipelineEvent[]) => void) {
  buffer.push(e);
  const now = performance.now();
  if (now - last < 120) return;
  last = now;
  flush(buffer.splice(0));
}
export function flushNow(flush: (batch: PipelineEvent[]) => void) { flush(buffer.splice(0)); }
// 页面卸载/阶段完成时调用 flushNow, 防止末批事件丢失
```

**更新频率预算表**（实现必须遵守，W4 用 Performance 面板核对）：

| 更新对象 | 频率上限 | 机制 |
|---|---|---|
| ThinkingBubble 事件流 | 8 Hz | 120ms 批量 flush（上述） |
| LLM 叙事流式文字（结论区/追问答案/智能助理消息） | 20 Hz（50ms 合并） | delta 缓冲合并为一次 setState |
| SQL 预览 | 仅当新 SQL 开始/结束 | 每条截断 160 字符 × 3 行，全文折叠 |
| PipelineStepper 进度 | 10 Hz | 确定性进度（行数/子任务）节流 |
| 图表 setOption | 数据变更 ≤ 1 次 / 250ms；dataZoom 拖动内 60ms | 节流 + 合并 |
| 洞察卡图表实例 | 同时存活 ≤ 6 | IntersectionObserver 懒 init / 离屏 dispose |
| 明细表 | 虚拟滚动（10k 行） | 只渲染可视区 ± 200 行 |

**首屏与代码分割预算**（以下为路由级 chunk 口径；全项目唯一性能基准表 = 01 §8 B1-B10（主包 <180KB、内存 <400MB、RAG 稳态 P95<2.5s 等），冲突时以 01 §8 为准）：首页 JS < 60KB gzip（无 ECharts/DuckDB）；ECharts 按需引入 < 250KB gzip；新路由 chunk 口径见 §1.1 表（/budget 含 ECharts core < 300KB，/learn /settings 各 < 60KB）；四大图组件与 ECharts 同 chunk 合计 < 60KB gzip（08 §④.2）；DuckDB-WASM 仅 `/upload` `/checkup` 注入并显示加载进度；10k 行清洗分片执行（每片 2k 行让出主线程），进度条显示真实行数；重复体检命中 stageCacheKey/llmCacheKey 缓存直接秒出（07 §10，ThinkingBubble 显示「⚡ 命中缓存」）。新增基准（01 §8 增补）：两大图单图渲染 < 250ms（雷达/词云国赛落地后同基准）、年度海报 canvas 合成 < 2s（1080×1920）、10k 行 CSV 导出 < 3s。交互主线程预算：任何用户交互的 JS 任务 ≤ 8ms（保持 60fps），超预算的任务（清洗、排序）拆片。

### 4.4 加载 / 骨架屏 / 降级提示

**骨架屏规范**（每类一版，Skeleton 组件 §2.9）：card = 标题条 + 两行文字条 + 图表矩形；chart = 坐标轴描边矩形 + 顶部标题条；table = 6 行渐变条。shimmer 1.5s 循环；数据到达后 150ms 交叉淡出。

**降级链 UI 对照表**（事件 → 动作 → 横幅，DegradeToast 参数化渲染）：

| 触发 | 系统动作（03 执行） | UI 表达 |
|---|---|---|
| DeepSeek 限流/超时 | 切换 qwen 备用模型（07 §12 降级链） | info 条：「已切换备用模型，结论不变」 |
| 双模型均失败 | 叙事文字回退内置模板 | warning 条：「AI 服务不可用，已使用内置分析模板；结论来自确定性 SQL，图表不受影响」+ [重试 AI] |
| OCR 失败 | 转 CSV 入口 / 人工确认 | error 条：「截图识别失败：{原因}」+ [重试] [改用 CSV] [用示例账单] |
| 快速记账 LLM 不可用 / parseable:false | 转手动表单兜底（金额空、类别下拉预选 top-1 规则猜测，08 §⑥.1） | info 条：「已切换手动记账表单，填完即可入账」 |
| 新任务 AI 不可用（budget-advice / forecast / tip-personalize / annual-story 某段） | 模板兜底（阈值规则句 / 固定句式 / top-3 直出 / 模板段，08 §⑥） | info 条：「已使用内置模板，结论来自确定性 SQL，图表不受影响」 |
| 锚点追问 SQL 校验失败 | 重试 1 次 → 回退内置分析模板 | 步骤树该节点红标 + 条：「已改用内置分析模板」 |
| assistant-plan 超时/失败（08 修订案 A12） | 静默跳过（回答不受影响，仅不展示思考计划块） | 无横幅（面板只缺「思考计划」块） |
| 智能助理/追问输入命中闸门（08 修订案 A12） | 拦截，不进任何本地/在线路径 | 固定拒绝话术 + 脚注：「已拦截 · 未进入任何模型」 |
| 断网 | 全程浏览器内计算不受影响，仅 AI 能力降级 | 顶部常驻条：「已离线：明细计算正常，AI 解读已降级为模板」 |
| WASM 加载失败 | 提示重载 | error 页 + [重试] [观看演示视频]（答辩备用录像入口） |

所有降级条必须说明**兜底动作是什么**，绝不止于「出错」。

### 4.5 移动端响应式要点

断点：< 640 移动 / 640–1024 平板 / > 1024 桌面。要点：

1. 洞察卡流单列；追问面板变全屏 bottom sheet（滑动手势关闭）；思考面板收进「流水线详情」抽屉；
2. 图表交互：单指轻点 = 点选锚定，长按 300ms 拖动 = 框选（brush），双击 = 重置缩放；触控目标 ≥ 44×44（ECharts 命中区放大：`series.silent` 关闭、命中 padding 增大）；tooltip 改长按呼出（移动端 tooltip 文案 ≤ 2 行）；
3. 上传页三入口竖排，OCR 首位（手机直接拍截图，`<input type="file" accept="image/*" capture="environment">`）；
4. 明细表列裁剪：移动端只显示 时间/商户/金额/类别 四列，其余收进行展开；
5. 健康指数仪表尺寸缩至 220px，指标卡单列；订阅卡 sparkline 高度 40px；
6. 筛选行折叠为抽屉（移动端），桌面常驻一行；
7. 底部 tab bar 5 项（首页/体检/账本/日历/我的——「订阅」→「日历」/calendar，08 修订案 A15；订阅管理收进 /insights 第 5 视图），安全区 `env(safe-area-inset-bottom)`；「我的」指向 `/settings`（08 A7），`/budget` 与 `/learn` 不新增 tab 项，从首页能力卡与 `/settings` 链接进入；
8. `/budget` 移动端单列布局：预算环 → 分类预算列表（每类一行已用比例条）→ 超支贴士 → 预测，快速记账入口收为底部悬浮条（44×44 触控目标），预算编辑弹层改 bottom sheet；
9. `/report` 移动端故事段单列 + 海报按钮全宽；`/learn` 案例卡单列、搜索框吸顶（国赛窗口补齐后按本节适配，省赛版本仅首页 P2「即将上线」角标入口）；`/settings` 分区折叠为手风琴。
10. 智能助理：聊天抽屉移动端全屏（滑动手势关闭），悬浮按钮保持 44×44 触控目标与底部 tab bar 安全区共存；语音按钮在浏览器不支持 Web Speech 或 featureFlags.voice=false 时隐藏（08 修订案 A12）。
11. `/calendar` 消费日历移动端：日历热力图单列全宽（格点触控目标 ≥ 44×44）、时间轴流水单列；月切换收进标题行；深夜标记与色阶同桌面口径（08 修订案 A15）。

---

## 5. AI 交互体验细则

### 5.1 真实思考状态可视化（AI 交互体验 3 分的主战场）

**展示四样真实东西**：正在执行的 SQL（脱敏聚合 SQL 本体）、命中的 RAG 案例（标题 + caseId）、模型流式文本（真实 token）、智能助理在线回答的 plan 思考计划（07 §2 第 21 类：goal + 1-4 步，assistant-plan 归 deepseek，08 修订案 A12）。事件协议 = 07 §2 spendct协议@2（§2.3 只 import）。

**硬规定（评审逐条对照）**：

1. **不放假思考动画**：禁止「AI 思考中…」旋转动画 + 伪造进度百分比。阶段进度条只显示确定性进度（真实行数/子任务计数）；没有任何 AI 事件的时间段，面板显示的是确定性任务（如「正在写入 2,048 行到本地数据库」），而不是虚构的思考；
2. `card:delta` 事件到达才渲染「正在撰写叙事…」，流式文字 = 真实 delta 拼接（§4.3 节流），绝不预生成占位符（旧名 llm-streaming 作废，#3/#28）；
3. SQL 展示带徽标「已聚合 · 只读 · 白名单通过」——观众看到的是真实的隐私护栏产物，同时展示 `stage:evidence` 的行数与耗时（如「命中 7 笔 · 42ms」），强化「确定性 SQL 预计算、LLM 只写叙事」的架构故事；
4. `rag:retrieved` 展示案例标题与 caseIds，点击折叠展开摘要（04 提供），检索耗时放 tooltip（不喧宾夺主）；
5. `llm:degraded` 事件即时弹降级条（§4.4 表），让评委看到双路由互备真实发生；
6. `StageEvidenceDrawer`（F02）只渲染真实 `stage:evidence` 事件：该阶段 SQL 全文、命中行数、耗时、产出卡缩略——与 ThinkingBubble 同一条证据同一来源，抽屉绝不同步伪造进度（08 F02 明确零假动画）。

**节流**：§4.3 的 120ms 缓冲 + 8Hz 上限；面板保留最近 50 条事件。

### 5.2 错误边界与「无可靠数据支撑时拒绝画图」话术

**渲染错误边界**：`ChartErrorBoundary`（§2.9）兜住任意图表崩溃，fallback 提供 [查看数据表] [重试]——图表坏了不丢数据。

**拒绝画图**（追问 `refusal` 答案；洞察卡侧未过发布闸门 → withheld 复核区，07 §4）。卡样式区别于错误卡：中性灰、无警示色、给出**原因 + 建议动作**，把「拒绝」变成信任资产。话术模板（03 判断触发条件，UI 渲染文案）：

| refusalReason | 触发条件（03 定义阈值） | 话术模板（UI 渲染） |
|---|---|---|
| `insufficient-sample` | 样本 < 30 笔（07 §20 显著性门槛） | 「最近 {range} 内该维度只有 {n} 笔交易，样本太少，画图反而会误导你。这次先不画。建议：把时间范围放宽到 {suggestion}，或换个维度看看。」 |
| `not-significant` | 差异未达统计显著性门槛 | 「这组数据的差异没有达到显著性门槛，画成图会夸大效果，所以这里不生成图表。原始数据（表格）已附上，供你自行核对。」 |
| `missing-data` | 账单缺必要字段 | 「账单里缺少 {field} 信息，这个分析做不了。如果你有 {source}，可以在上传页补充后重试。」 |
| `out-of-scope` | 超出账单数据能力范围 | 「这个问题需要账单之外的信息，我无法给出有依据的答案。可以试试问我：{suggestion}（账单内可回答的问题）。」 |

硬规则：**拒绝时永远附上「数据表」或可执行建议，绝不只说不**。

### 5.3 断点续跑入口

```ts
// src/lib/checkpoint.ts —— 断点 = 07 §17 localStorage spendct:run:latest（RunStateV1，#22/#41）
// RunStateV1 结构与续跑协议见 03 §1.4；UI 侧只读（写方为 pipeline slice）
import type { RunStateV1 } from "@/lib/pipeline/run-state";
export type Checkpoint = RunStateV1; // { version, runId, datasetTxHash, status, createdAt, updatedAt, stages, dataTables, cards, withheldCards, eventLog }（03 §1.4 全仓唯一定义，只 import 不复制）
```

入口与交互：

1. **检测**：`/upload` 与首页挂载时读 localStorage `spendct:run:latest`（07 §17 唯一检查点键）；若存在且 `datasetTxHash` 与当前数据一致 → 浮出恢复条/对话框：「检测到未完成的体检进度（已完成 4/6 阶段，14:32 暂停）。[继续体检] [重新开始] [忽略]」；
2. **暂停**：CheckpointBar [暂停] → 写 `spendct:run:latest` → ThinkingBubble 停更 → [继续] 从当前阶段恢复（确定性阶段直接续，LLM 产物按 stageCacheKey/llmCacheKey 缓存命中秒回，07 §10）；
3. **崩溃恢复**：`/checkup` 加载时发现 runState 且无活跃会话 → 自动进入恢复对话框（同上）；
4. datasetTxHash 不一致（换了账单）→ 静默丢弃旧 runState，不清 localStorage 中其它键。

---

## 6. 无障碍与细节打磨

### 6.1 键盘导航

- Tab 顺序 = 视觉顺序：TopNav → 主内容 → 追问面板 → 智能助理抽屉（开启时）→ 底部；所有操作不经快捷键也全程可达；
- 快捷键表（`?` 呼出帮助浮层，可一键关闭）：

| 键 | 作用 | 作用域 |
|---|---|---|
| `j` / `k` | 下一张 / 上一张洞察卡 | /insights |
| `Enter` | 展开卡片 / 确认锚点追问 | 卡片、确认条 |
| `Esc` | 取消锚点 / 关闭弹层 / 关闭 bottom sheet | 全局 |
| `1`–`6` | 聚焦流水线阶段 1–6 | /checkup |
| `/` | 聚焦追问输入框 | /insights |
| `t` | 当前图表切换数据表视图 | 图表聚焦时 |
| `?` | 演示帮助浮层（快捷键 + 演示控制台） | 全局 |

- 焦点环：`:focus-visible` 2px `var(--brand-500)` 外环 + 2px 间隙，永不禁用 outline；锚点选中的图表容器加 `role="button"` `aria-pressed` 与 `aria-label`（「2026-05 餐饮支出数据点，按 Enter 追问」）。

### 6.2 对比度

- 正文/次级文字 4.5:1 起：`ink-primary` 17.8:1、`ink-secondary` 7.3:1（亮面实测）；暗面 15.6:1 / 9.9:1；
- 图形元素 3:1 起：图表系列色见 §3.1.3 验证表（黄/品红槽靠强制数据表视图救济）；`ink-muted` 3.2:1 只用于轴线刻度；
- 状态色低于 3:1 的（warning/serious）必须图标+标签三件套（§3.1.2）；
- 色觉障碍：色板经 protan/deutan 模拟验证（§3.1.3）；系列 ≥2 必有图例、≤4 加直接标签（身份绝不只靠颜色）；色弱模式 ECharts `decal` 纹理可开；
- 全部数字 `tabular-nums`（§3.2）。

### 6.3 空态文案示例（逐页成品文案，W4 直接套用）

| 页面 | 标题 | 说明 | 按钮 |
|---|---|---|---|
| 上传页 | 还没有账单数据 | 上传微信/支付宝账单 CSV 或截图，或点右边按钮用脱敏示例数据一键体验 | [加载示例账单] |
| 体检运行页 | —（无空态，进入即跑） | — | — |
| 洞察流 | 体检完成前，这里还没有洞察 | AI 体检会生成 6 类可审阅的洞察卡，每条结论都附证据图表与来源引用 | [去上传账单] |
| 账本汇总（/insights 内） | 所选时间范围内没有交易 | 试试放宽时间范围，或清除部分筛选条件 | [清除筛选] |
| 订阅管理（原订阅雷达） | 没抓到连续扣费 | 这次体检没有命中连续小额扣费模式。如果你有已知订阅，可以去账本汇总视图点它的扣费记录，帮你核算总支出 | [去账本汇总] |
| 年度报告 | 报告需要至少 3 个月数据 | 当前账单覆盖 {n} 个月，继续积累或换一份时间跨度更长的账单 | [回洞察流] |
| 追问区（首次） | 从图表开始提问 | 点击或框选任何图表元素，AI 会制定分析计划并给出带图表的答案 | [看个例子] |
| 智能助理（首次） | 直接问我 | 示例问题 3-4 条 + [新对话]：本地规则/本地案例优先回答，答不上才在线生成，每条消息脚注标注来源 | [看示例问题] |
| 预算中心 | 还没有设置预算 | 给 12 个消费类别设一个月度预算，超支时 AI 会给你提示，还能预测下个月的花销 | [设置预算] |
| 知识课堂 | 没有找到相关案例 | 换一个关键词，或清空搜索浏览全部 {n} 条案例（案例库加载中态 = 骨架屏，见 §1.13） | [清除搜索] |
| 数据管理 | 还没有数据集 | 上传账单后，数据集会出现在这里，可导出 CSV/JSON 或一键删除 | [去上传账单] |

### 6.4 屏幕阅读器与 ARIA

- 卡片流用 `region` + `aria-label="洞察卡流"`；每张卡 `article`，结论区 `aria-live="polite"`（流式更新节流 120ms，避免刷屏）；置信度朗读为「置信度 72%，较高」；
- ThinkingBubble `aria-live="polite"` 但只公告阶段切换与错误（SQL 滚动不朗读）；图表容器 `aria-label` = 图表标题 + 关键结论一句话 + 「可切换数据表视图」；
- 计划步骤树：`role="tree"` / `treeitem` + `aria-expanded`，状态朗读「第 2 步：按月份聚合餐饮支出，执行中」；
- 弹层/浮层：焦点陷阱 + Esc 关闭 + 打开时焦点移入；智能助理聊天抽屉同此规则，消息列表 `aria-live="polite"` 按 §4.3 节流。

### 6.5 细节打磨清单（W4 起每周固定 2 天逐项过，全部通过才允许出新功能）

1. 每个页面 × 每个状态（空/加载/错误/成功）走查一遍，文案用 §6.3 成品；
2. 断网实测一遍全链路（明细计算正常 + AI 降级条出现）；
3. 10k 行账单：表格滚动 60fps、图表交互不卡、内存 < 400MB（01 §8 B5 唯一基准）；
4. 键盘全程走一遍（不开鼠标完成一次体检 + 一次锚点追问）；
5. 亮暗双主题截图对比，色板回归跑 Vitest 快照测试（设计令牌，无独立脚本路径，#71）；
6. 移动端 375px 宽度全页面截图检查；
7. 锚点追问 6 步流程各打断一次（Esc/中途关面板/刷新），状态可恢复不脏读；
8. 注入攻击演示账单（商户名恶意文本）上传：所有渲染点显示脱敏 hash，无 HTML 注入。
9. 智能助理输入闸门四类注入特征（指令覆盖、角色劫持、泄露诱导、SQL 痕迹）各注入一次，均命中固定拒绝话术且不进任何本地/在线路径（08 修订案 A12）。

---

## 7. sample-data 演示动线

### 7.1 交互范式差异化（一句话对比，完整竞品对标表在 PDF 技术文档）

| 产品 | 交互范式 | SpendCT 的差异 |
|---|---|---|
| Rocket Money | 订阅管理工具，列表+开关 | 体检流水线叙事 + 订阅只是六阶段之一 |
| Cleo | 聊天窗问 AI | **本地优先智能助理（非直连 API 聊天窗）**：洞察卡流 + 图表锚点追问，AI 先体检、用户审阅追问 |
| 随手记/钱迹 | 记账流水与报表 | AI 生成「可审阅结论」（置信度+引用+打标），而非纯报表 |

### 7.2 评委 30 秒动线（演示视频分镜即此表，全程无需真实账单）

| 秒 | 动作（演示者说 + 做） | 路由 | 屏幕关键内容 |
|---|---|---|---|
| 0–3 | 「给你的账单做一次 AI 体检」——点 [加载示例账单]（主 CTA，一次点击） | `/` | Hero + 三承诺条 |
| 3–8 | 「六项检查开始，注意右侧——它在执行真实的 SQL」 | `/checkup` | 流水线点亮 + ThinkingBubble 滚动 SQL（示例数据命中缓存，3.5s 跑完） |
| 8–18 | 「AI 不聊天，它先交作业：洞察卡一条条流出来」 | `/insights` | 3 张洞察卡流式发布：结论 + 证据图 + 置信度 + 引用折叠 |
| 18–24 | 「这张卡怀疑你有订阅刺客」点开订阅卡引用折叠 | `/insights` → `/insights?view=subscriptions` | 命中卡 + sparkline + 「取消攻略（RAG 引用）」展开 |
| 24–30 | 「看到可疑的点，直接点它提问」——点击扣费点 → 确认条 → [追问] → 步骤树点亮 → **新图落卡**（2s 高亮） | `/insights?view=subscriptions` | 锚点追问全流程 6 秒完成 |
| 收尾 | 鼠标悬停右上角盾牌：「明细数据从未离开浏览器」 | — | PrivacyBadge 弹出可见性对照表 |
| 富余可选 | 时间富余（评委未打断）时在 /report 滚动一屏——年度故事段逐段浮现 + 段位卡入镜（AnnualStorySchema 分段叙事证据，08 §12.1） | `/report` | 故事段 scroll-reveal + RankBadge（P1 未落地则跳过） |

**台词纪律**：每 10 秒只讲一个卖点，顺序 = 易用（一键示例）→ 技术深度（真实 SQL 思考）→ 范式创新（卡流+锚点追问）→ 隐私（收尾）。视频剪辑时本表即时间轴。

**30 秒动线不变**（08 §12.1）：核心叙事（一键示例 → 六阶段 → 卡流 → 订阅雷达 → 锚点追问 → 隐私）是评分主证据，新功能不挤占；**新增可选动作**（见上表「富余可选」行）：时间富余时在 /report 滚动一屏——年度故事段逐段浮现 + 段位卡；扩展镜头按序进 §7.4 v2。

**时长口径（#77，与 06 同源，不得混用）**：「3.5s」= 缓存后单次六阶段计算耗时；「60s」= 演示全流程上限（§7.2 30s 动线 + §7.4 60s 扩展动线均在其内）；视频成片 6'30"–7'30"。

### 7.3 演示控制台（`?` 键，评委提问时的应急武器）

浮层内按钮：`重放流水线`（回放事件流）/ `跳到最后阶段` / `注入一次错误`（演示错误边界与降级条）/ `切换暗色` / `断网模拟`（演示离线降级）/ `恢复断点`（演示续跑）/ 「跳转新功能」快捷键组（08 §12.1：`b`=预算中心、`l`=知识课堂、`s`=数据管理、`a`=智能助理）。**演示模式（demoMode）下所有网络请求预跑 + datasetTxHash 对应缓存键命中，保证 0 抖动**。

### 7.4 60 秒扩展动线 v2（时间富余时按序加，08 §12.1）

1. 账本汇总两大图+双视图（10s）：日历热力图/类别桑基两连切 + 点选桑基节点锚定 + 卡片流/图表廊切镜带一次收藏勾选（F03+F04，交互创新加分镜头）；
2. 快速记账（8s）：「中午食堂 15」→ zod 确认卡 → 一键入账 → 账本即时可见（F08，大模型集成结构化输出证据）；
3. 预算中心（10s）：预算环 + 超支贴士卡（AI 建议）+ 下月预测（F07，实用性镜头）；
4. 年度数据故事+海报（10s）：/report 故事段逐段 scroll-reveal（annual-story 分段叙事，AI 深度主镜头）→ 一键生成 PNG 海报（F05）；
5. 成就段位一屏（6s）：成就墙一屏 + 徽章弹出一枚（F10，UI 设计 4% + 前端交互 3% 的落点镜头）；
6. 数据导出（5s）：CSV/JSON 导出 + 隐私提示（F12，隐私信任收口）。
7. 智能助理（6s）：悬浮按钮 → 抽屉 → 示例问题本地命中（脚注「本地计算」）→ 一条在线兜底（plan 思考计划块 + ToolBadge）→ 语音输入一例（如浏览器支持）。（08 修订案 A12 未强制入动线，随 06 路线图 §6.3/§6.4 修订决定）
8. 三新页可选动作（时间再富余时加，08 修订案 A17）：/challenge 选类目定预算并打卡一笔（基线→节省即时反馈）→ /poster 切一款样式下载一张 PNG（6s）。不进 30 秒主动线；PDF/README 以「12 大能力」静态展示。

接 30 秒动线（§7.2）后的富余时间依次播放；若 P1/P2 已砍（08 §⑩），按 E1/E2 验收结果跳过对应段，回退旧版三镜头（OCR / 健康仪表 / 导出 PDF）。**F09/F11/F13（P2）不进任何动线**：PDF/README 静态展示 + 首页「即将上线」角标，T52b/T53/T54 点亮后才考虑 60s v2 加映。演示控制台「跳转新功能」快捷键组（§7.3）按同一顺序直达。

### 7.5 演示稳定性预案（与 06 路线图对齐）

1. **断网**：全程浏览器内计算 + 演示控制台断网模拟 → 提前录好这段备用；
2. **限流**：demoMode 预跑关键链路 + 缓存键命中（07 §10）；仍失败 → 备用录像（答辩备用录像为最终兜底，材料成员提前录 3 遍）；
3. **本地演示**：Vercel 不稳时评委现场用 localhost（README 一键 `pnpm dev`）+ Gitee 镜像；
4. 演示用浏览器固定 Chrome 最新版 1080p 窗口，`?` 控制台常备但只在提问时呼出。

---

## 8. 附录

### 8.1 验收清单（与 06 路线图闸门联动）

- **W2 最小闭环闸门（未达成砍 MCP/OCR/框选）**：`/` + `/upload` + `/checkup` + `/insights` 四页可用；示例账单一键 → 流水线 → **3 张流式洞察卡**（结论/证据图/置信度/引用/确认质疑）；ThinkingBubble 展示真实 SQL 与事件流。闸门判定在 UI 侧：无以上能力即不进入 W3。
- **W4 错误态周**：§6.5 清单 8 项全过。
- **E1 扩展闸门（11/2，随 G3，08 §①）**：P0 压缩版四项全部验收通过——F01 首页能力卡墙与架构展示条、F02 证据抽屉与产出计数卡（只渲染真实 stage:evidence 事件）、F03 两大图表（渲染/锚定/数据表三态 + 单图渲染 <250ms）、F06 订阅管理墙（倒计时徽标/年度订阅合计/步骤化清单）；**F04 双视图+收藏于 11/4 补验**（08 §1.2 E1 补验约定）。闸门判定在 UI 侧：P0 压缩版四项任一未过不进入扩展。
- **E2 扩展闸门（11/9 功能冻结，随 G4，08 §①）**：P1 按 08 §1.2 容量条件档实际落地项验收（落地顺序 F08→F10→F05→F12→F07，不宣称全量）或已按 08 §⑩ 砍法表降级——F05 数据故事+海报、F07 预算中心、F08 快速记账、F10 段位成就、F12 数据管理；砍伐后 24 小时内同步本文 §1.1 flag 与对应页面小节。
- **提交前预检**：色板 Vitest 快照测试通过；demoMode 全程无 console error；1080p 视频素材按 §7.2 时间轴拍摄。

### 8.2 评审维度落点索引（材料成员写 PDF 时引用；分值口径 = 06 §6.3 唯一口径表，#26）

| 评审点 | 本文档证据 | 一句话说法 |
|---|---|---|
| 交互模式创新（创新性 25% 内 7 分） | §4.1 | 「图表任意元素可点击/框选锚定追问，Plan-Execute-Observe 可视化为步骤树，每答必落图」 |
| AI 交互体验（前端工程 UX 10% 内 3 分） | §5.1 | 「思考面板展示真实 SQL、RAG 命中与流式 token，不放假进度条」 |
| 错误边界（AI 安全与可控性 4% 内） | §5.2、§2.9 | 「图表级错误边界 + 拒绝画图话术，把 AI 失败变成信任资产」 |
| UI 设计（UX 10% 内 4 分） | §3 | 「验证过的金融信任色板（CVD/对比度实测数据）+ 统一设计系统」 |
| 性能优化（前端工程 20% 内 3 分） | §4.3 | 「120ms 事件节流、图表实例 ≤6、DuckDB/ECharts 按路由懒加载、缓存键命中（07 §10）」 |
| AI 安全与可控性（4%） | §3.6-8、§6.5-8 | 「ECharts option 白名单清洗、SQL 白名单徽标可视化、注入演示账单脱敏显示」 |
| 实用性 / 社会价值（10%/10%） | §1.6 两大图、§1.8 管理墙、§1.12-1.14、§1.15-1.17 | 「预算/记账/订阅管理/数据导出四类实用功能 + 订阅倒计时与取消攻略 + 省钱挑战/攒钱目标/年度海报（08 A17），AI 先体检之外的可落地价值」 |
| 大模型集成（AI 深度内） | §1.12 zod 确认卡、§1.10 故事段、§2.3 新 schema、§2.10 assistant-plan（08 修订案 A12，deepseek） | 「6 个新 LLM 任务（08 5 个 + A12 assistant-plan）全部 zod 强校验 + 模板兜底 + 降级链（08 §⑥/07 §12），扩展不稀释 AI 深度主线」 |

### 8.3 本文档修订记录

| 日期 | 变更 |
|---|---|
| 2026-10-13 | v0.9 初稿：全页面/组件/交互/设计系统/演示动线；图表色板经验证实测（§3.1.3 数据） |
| 2026-10-13 | v1.0：对齐 07 契约——7 条路由（07 §14，#46）、insight-card@v1（07 §4，#4/#33/#60）、spendct协议@2（07 §2，#3/#28）、SelectionContext/PlanStepKind/工具短名（07 §18，#65）、ModelId 四枚举+展示名（07 §12，#64）、StageStatus（07 §1）、merchantRef 与金额单位分（07 §0.3/§3，#29/#50）、订阅业务规则（07 §3，#24/#48）、断点键 spendct:run:latest（07 §17，#22/#41）、组件注册表 13 组件（07 §14，#52）、Tailwind v4 @theme（01 锁表，#11）、评分口径引用 06 §6.3（#26）、演示时长口径（#77） |
| 2026-10-13 | v1.1：落实 08 功能扩展增量（08 §⑨ 索引 + 修订案 A1-A7）——路由 7→10（A7：/budget /learn /settings 三页完整四态，§1.11-1.13）；组件注册表 13→19（A7 六组件：BudgetRing/QuickEntryBar/ForecastChart/CaseCard/DatasetManager/NotificationBell）并新增四大静态图与 16 个页面级组件入表（§2.2）；§3.6 四大静态图渲染规范 +「LLM 答案仍限七类」声明（08 §④.2）；FeatureFlag 新增 budget/reportStory/achievements/learn（08 §2.3）；降级链表补快速记账/新任务两行（08 §⑥）；移动端「我的」→/settings、/budget 单列布局（§4.5）；空态文案补预算/课堂/设置 3 条（§6.3）；§7.4 扩展动线 v2 + 演示控制台跳转快捷键组 b/l/s（08 §12.1）；§8.1 补 E1（11/2）/E2（11/9）扩展闸门 |
| 2026-10-15 | v1.2：落实 08 修订案 A12 全局智能助理（07 §18 A12 / 07 §21 05 文档第 14 条）——新节 §2.10（悬浮入口右下固定 + 聊天抽屉桌面 400×600/移动全屏 + 空态示例问题与新对话 + 语音入口 feature-flag voice + PlanBlock 思考计划块 + 三态来源脚注 + 工具徽章复用 07 §18 A9）；§2.2 组件总表新增 AssistantDrawer/ChatBubbles/PlanBlock（两级注册口径，约 16→19 个）；§2.3 事件 20→21 类（plan，在线兜底第 0 步，8s 超时静默跳过）并标注 sanitizeResult async（WebCrypto）；§4.1 补 A12 共享管线 use-chat-pipeline 与输入闸门注记；§1.1 全局 Shell 补悬浮入口、FeatureFlag 新增 voice；§4.4 降级链补 assistant-plan 静默跳过/闸门拦截两行；§4.5 移动端补第 10 条；§6.3 空态补智能助理行；§6.5 补闸门四类注入特征走查；§7.1 竞品行改「本地优先智能助理」口径；§7.3/§7.4 补助理快捷键与扩展镜头 |
| 2026-10-15 | v1.3：落实 08 修订案 A13 商户统计视图（07 §14 A13）——§1.1/§1.5 视图切换器补第 4 视图「商户统计」（?view=merchants，与卡片流/图表廊/账本汇总并列，路由数不变仍 10 条）；新增 §1.7 商户统计视图节（全账单 expense 数据口径、两条白名单 SQL、排名横向条形图前 10 + 数据表全量（50 行上限，截断脚注「商户较多，按金额取前 50 名」/「全部展示」）、商户搜索同步过滤、点击柱子 → 追问锚点 merchant-view（§18 协议不变，无新工具）、演示行兜底 ledger-demo.ts seed 20261013 100 行、零新端点零新 env 键）；§1.6 补重构登记（演示行生成器与 ChartCard 外壳提取为共享模块 src/lib/insights/ledger-demo.ts、src/components/insights/chart-card.tsx，行为不变）；§2.1 组件树与 §2.2 组件总表登记页面级 MerchantView 与共享 ChartCard 口径；原 §1.7-1.12 顺延为 §1.8-1.13 并同步内部引用 |
| 2026-10-16 | v1.4：落实 08 修订案 A14 追问深度分析（07 §21）——§4.1 补「深度分析」开关交互规范（输入框上方 chip、aria-pressed 两态、开启/关闭提示文案、开启后回答气泡脚注「深度分析 · 已发送账单统计与明细」（三态来源脚注 + 深度分析档）、零新端点/路由/事件，协议仍 21 类）；§2.2 页面级组件「约 19 个」修正为「约 20 个」（MerchantView 已登记；深度分析 chip 为 FollowUpPanel 内部扩展、不新增组件） |
| 2026-10-16 | v1.5：落实 08 修订案 A15 订阅管理视图 + 消费日历 + 年度报告通俗化——§1.1 站点地图与路由表：新增 /calendar 消费日历页、/subscriptions 改静态重定向（页面总数仍 10、路由条目 11），top-nav「订阅」→「日历」/calendar、移动端底部 tab 同步、能力卡墙订阅卡 href 改 /insights?view=subscriptions；§1.5/§1.6/§2.2 视图切换器 4→5（+「订阅管理」?view=subscriptions）；§1.8 降级为订阅管理视图（内容全保留，SubscriptionView 页面级组件迁入、行为不变）；新增 §1.9 消费日历页节（CALENDAR_DAILY_SQL 白名单聚合 expense+paid 行数上限 2000、流水直连分页 LIMIT 200、深夜口径 23:00–05:00、演示确定性生成器每 9 笔 1 收入深夜约 1/4、全程浏览器内计算零 API、ECharts 注册 HeatmapChart/CalendarComponent/VisualMapComponent），原 §1.9-1.13 顺延为 §1.10-1.14 并同步内部引用；§1.10 年度报告补通俗化展示口径（六维健康明细「每 100 元消费里约 X 元用于…」+ 百分比小字 + 状态标签、健康指数大白话总评、四段叙事文案、段位成就口语化，仅展示层，底层计算口径不动，文案集中 src/lib/report/labels.ts）；§2.2 页面级组件约 20→23 个（CalendarView/CalendarTimeline/SubscriptionView 登记，CalendarHeatmap 扩 /calendar 页口径）；§4.5 补第 11 条 /calendar 移动端要点；§7.2 演示动线订阅镜头路由改 /insights?view=subscriptions |
| 2026-10-16 | v1.6：落实 08 修订案 A17 省钱挑战打卡 + 攒钱目标中心 + 年度海报分享（07 §14/§17 A17）——§1.1 站点地图与路由表：静态页 13→16（+ /challenge /goals /poster，top-nav 5→8 项「挑战/攒钱/海报」列报告之后、md 断点宽度预算口径，移动端不占 tab 位从首页能力卡进入）；新增 §1.15/§1.16/§1.17 三页完整四态与数据口径（challenge：白名单日聚合+21 天打卡+基线/节省、goals：月结余估算+目标进度+预计达成月、poster：三模板+标语+canvas 本地合成 PNG，全部本地计算零 API 零新端点零新 env）；§1.2 能力墙 10→12 卡（海报卡 href /report→/poster）；§1.10 成就墙 12→13 枚（第 13 枚「七日打卡王」由挑战页连续打卡解锁）；§2.1 组件树与 §2.2 组件总表登记页面级 ChallengeView/GoalsView/PosterStudio（约 23→26 个）；§8.2 实用性落点索引补 §1.15-1.17 |
| 2026-10-17 | v1.7：落实 08 修订案 A19 图形验证码 + 数据页强制登录 + 追加合并去重 + 挑战手动记账 + 成就全真实判定 + 文案收敛（07 §3/§12/§14/§17 A19）——§1.1 站点地图与路由表：公开页收敛为五页（/ /login /register /learn /privacy，新增 /login /register 两行），11 个数据功能页全部 AuthGuard 登录墙（游客重定向 /login?next=<原路径含查询串>、登录后回跳，/upload?sample=1 演示导入继续生效；上表「守卫」列改为登录墙之下的数据层守卫，两层守卫口径）；§2.2 组件总表增补 CaptchaField（canvas 自绘 120×40 按 dpr 缩放、±25° 旋转 + 干扰曲线 + 噪点、点击/键盘刷新、verify() 客户端本机比对失败自动换图 + 清空输入、错误走字段内 error 行、DEMO_MODE=mock 留空即过，零网络请求）与 AchievementWall 真实判定注；§1.15 挑战页补手动记账行（金额 inputMode=decimal + 保存/「已记 ¥X · 修改」两态、含手动时标「含手动记录」小注、渲染期派生合并账单点、累计节省两处口径脚注）与 recheckAll 解锁口径；§1.10 成就墙补 A19 注（13 枚全真实行为判定、演示回退删除、无本地记录一律空集、新访客全锁为正常初始态）；页脚三栏重排（品牌+口号、快捷链接 token 化、数据说明一行「账单本地计算 · 服务端零存储」）；首页六步序号徽章 size-6 + text-[11px] + leading-none（20px 容器 10px 字号下 font-mono 行高撑破裁字修复）；「不出浏览器」语句全站收敛（只留首页 hero/三承诺条/「为什么安全」、登录注册 trust-bar、个人中心账户区与 /privacy 完整页，功能页内分散小注删除或简化为「你的账单数据不受影响，可以重试」式提示）；顺带落实 08 修订案 A18 此前未落条目：§2.10 管线顺序补问答时间窗八类（本月/上月/上上个月/今年/最近 7 天/最近 30 天/最近 90 天/指定月份，与锚点标签窗口径一致）；同日晚补：§1.4 体检完成条删「重新播放」按钮（只留「立即查看」，重跑入口收敛到暂停条「重新开始」与刷新重载，启动失败提示改「刷新页面即可重新开始」） |
| 2026-10-17 | v1.8：全站收敛「去重」操作字样（用户实机反馈）——体检清洗卡 headline/narrative/significance 去「去重后 N 笔」分句、去「去重后笔数」统计项（卡面即「共 N 笔账单 · 支出总额 ¥X」）；清洗步骤副题「解析与去重」→「解析与清洗」（stage.ts 展示名，03/06/07 文档同源更新）；证据抽屉清洗结论句去「去除重复」；演示播放器清洗证据卡/结论/叙事三处去重措辞；mock 清洗叙事去「清理疑似重复」叙述；上传成功视图「新增 X 笔、跳过疑似重复 Y 笔」→「已导入 X 笔」（CSV/OCR 两路径同步，skippedCount 展示态删除，成就 cleaner 计数口径不变）；上传预览告警「导入时将去重」→「导入时会自动跳过」；成就「一尘不染」描述去操作化；上传页 SEO 描述去「去重」 |

