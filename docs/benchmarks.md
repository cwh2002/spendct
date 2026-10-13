# DuckDB-WASM 基准测试报告（T1 · W1D1）

> 指标出处：06 路线图 §2.0 W1D1 验收。数字留档：`public/spike/duckdb-wasm/result-*.json`。
> 复现：`python -m http.server 8787 --directory public` 后执行 `node scripts/run-spike-benchmark.mjs`（可选 `BENCH_ROWS=100000`）。

## 1. 方法与口径

- 被测页面：`/spike/duckdb-wasm/`（独立静态页），与正式管线同源加载 `/duckdb/` 自托管产物（`duckdb-mvp.wasm` + `duckdb-browser-mvp.worker.js`，`pthreadWorker:null`，07 契约 §8）。
- 数据：页面内生成 1 万行贴近真实账单形态的 CSV（12 类目、指数分布金额、96% 支出），经 `registerFileText` → `read_csv_auto` 建表，再执行与六阶段画像同形态的分组聚合 SQL。
- 冷加载 = 全新浏览器 context（无 HTTP 缓存、无 sessionStorage）；热加载 = 同页刷新后重测（HTTP 缓存命中，页面按 sessionStorage 判定口径）。
- 内存取 `performance.memory.usedJSHeapSize`（仅 Chromium 内核可读）。

## 2. 测试环境

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-13 |
| 操作系统 | Windows 11（x64） |
| 主测引擎 | Chromium（Playwright 1.64 自带 headless，build 1248） |
| 对照引擎 | Microsoft Edge 155.0.4283.45 |
| 网络 | 本地回环（127.0.0.1:8787，python http.server） |

## 3. 验收指标判定（1 万行档）

| 指标 | 阈值（06 §2.0） | 实测（chromium） | 判定 |
| --- | --- | --- | --- |
| WASM 冷加载 | < 4000 ms | 874 ms | ✅ 通过（余量 4.6×） |
| WASM 热加载 | < 1500 ms | 784 ms | ✅ 通过（余量 1.9×） |
| 1 万行导入 + 聚合 | < 2000 ms | 456 ms | ✅ 通过（余量 4.4×） |
| 内存占用 | < 400 MB | 10.1 MB | ✅ 通过（余量 40×） |

对照引擎（Edge 155）：冷 795 ms / 热 743 ms / 导入+聚合 504 ms / 内存 9.7 MB，同样全过。

## 4. 分项明细（chromium，1 万行）

| 阶段 | 冷加载轮 | 热加载轮 |
| --- | --- | --- |
| WASM 下载 + 实例化 | 874 ms | 784 ms |
| CSV 生成 + 注册 | 未单列（计入页面运行） | — |
| 建表导入（read_csv_auto） | 456 ms（与聚合合计） | 440 ms（与聚合合计） |
| 分组聚合（12 类目） | — | — |
| JS 堆内存 | 10.1 MB | 10.1 MB |

聚合结果校验：12 个类目分组、总金额 35,514,935 分（355,149.35 元），与生成数据总量一致（无丢行）。

## 5. 压力档（10 万行，扩展参考）

| 指标 | 实测 |
| --- | --- |
| 导入 + 聚合 | 657 ms |
| JS 堆内存 | 13.6 MB |

10 万行下导入+聚合仅比 1 万行增加约 200 ms、内存增加 3.5 MB，瓶颈仍在 WASM 首次加载而非数据规模。单用户账单量级（微信/支付宝一年账单通常 ≤5 万行）有 2 倍以上余量。

## 6. 结论与风险

1. **四项验收指标全部通过**，且余量充足：最紧的热加载也有 1.9× 余量，弱网/低配机演示场景有兜底空间。
2. 加载时间主要构成是 37.7 MB 的 wasm 下载，本地回环接近磁盘/内存速度；公网首次访问会受带宽影响，但 vercel.json 已对 `/duckdb/*` 配置 immutable 长缓存，二次访问全部命中缓存。
3. 待补测项：①OPFS 持久化路径（正式版启用 `registerFileHandle("spendct", …)` 后的重启保留验证，W1D2 集成时测）；②真机（非 headless）手感；③低配机（4GB 内存）复测。届时更新本文件对应行。
