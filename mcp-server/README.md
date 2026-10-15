# spendct-mcp-server

SpendCT 的独立 MCP 工具服务（设计口径：docs/04-rag-mcp.md §8-§9；契约口径：docs/07-canonical-contract.md §18/§19 A9）。

以 Streamable HTTP 传输暴露四个工具：

| 工具 | 数据来源 | 说明 |
| --- | --- | --- |
| `get_school_calendar` | `src/data/school-calendar-2026-2027.json` | 2026-2027 学年高校校历（考试周/假期/开学/毕业季） |
| `get_weather` | 和风天气 API（免费档） | 城市未来 3/7 天天气；无 key 时诚实降级 `unavailable` 信封 |
| `get_promo_calendar` | `src/data/promo-calendar-2026.json` | 2026-2027 电商大促档期（双11/双12/年货节等） |
| `query_bill_db_metadata` | 请求参数注入（per-request） | 账单元数据回执协议演示：只收聚合元数据快照，不接收明细行 |

## 快速开始

```bash
# 在仓库根（pnpm workspace）安装依赖后：
pnpm --filter mcp-server dev      # 开发模式（tsx），默认 http://127.0.0.1:3100
pnpm --filter mcp-server build    # 编译到 dist/（含数据文件复制）
pnpm --filter mcp-server start    # 运行编译产物
```

验证（需先启动服务）：

```bash
pnpm --filter mcp-server smoke    # initialize → tools/list（四工具）→ tools/call 信封
pnpm --filter mcp-server test     # Vitest 单测（31 用例）
pnpm --filter mcp-server typecheck
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3100` | HTTP 监听端口（`/mcp` 与 `/healthz` 同端口） |
| `HOST` | `127.0.0.1` | 监听地址；容器部署时设 `0.0.0.0` |
| `QWEATHER_API_KEY` | 空 | 和风天气免费档 key（仅存服务端环境，不返前端）；空且非 mock 时天气工具返回 `unavailable` 信封，绝不编造天气 |
| `DEMO_MODE` | 空 | `mock` 时天气工具返回明确标注的模拟数据（`meta.source` 含「演示模拟」字样），保证演示口径一致 |

四个工具统一遵循结果信封（`{ok:true, data, meta:{source, generatedAt}}` / `{ok:false, error:{code, message, retryAfterSec?}}`），错误码 `unavailable / quota_exhausted / timeout / invalid_input`。

## 与主站的关系

- 主站接入层（`src/server/ai/mcp.ts`）经 `MCP_SERVER_URL` 连接本服务（协议 2025-11-25，`@modelcontextprotocol/sdk@1.32.1` 锁死小版本）；
- 本服务不可达时，主站自动降级本地回退（`src/server/ai/mcp-fallback.ts`）：校历/大促日历本地静态过滤、天气诚实降级、元数据回执本地校验——过滤逻辑与 `src/tools/*` 保持镜像，数据文件单一来源为 `src/data/*.json`；
- 快照指纹口径：`datasetTxHash` = 主站导入层 `hashCleanRows` 的 SHA-256 前 16 位十六进制（regex `^[0-9a-f]{16,64}$`），本侧 schema 与主站 `src/lib/schema/session-schema.ts` 镜像一致。

## 目录

```
src/
├── index.ts        # express + StreamableHTTPServerTransport（/mcp、/healthz）
├── stdio.ts        # stdio 传输入口（本地调试）
├── types.ts        # ToolResult 信封与 zod schema
├── data/           # 静态 JSON 数据（校历/大促日历/城市天气 ID 表）+ load.ts
└── tools/          # 四个工具实现（bill-metadata / promo-calendar / school-calendar / weather）
scripts/            # smoke.mjs（协议冒烟）、copy-data.mjs（构建期复制数据）
tests/              # Vitest 单测
```

> Windows 说明：`copy-data.mjs` 使用「清空目录 + 逐文件复制」（`rmSync` + `copyFileSync`）而非 `cpSync` 覆盖——本机实测（Windows + 中文路径）`cpSync` 覆盖已存在文件会以「unlink 失败（errno 0）」报错。
