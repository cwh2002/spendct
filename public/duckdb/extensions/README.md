# DuckDB 扩展自托管目录

本目录是 DuckDB-WASM 自动安装（autoinstall）的**同源扩展仓库**。

## 为什么需要它

transactions 表的 `_meta` 列是 JSON 类型，依赖 DuckDB 的 `json` 扩展（`json`
运行期又会按需拉起 `icu` 依赖）。wasm 引擎的自动安装默认从
`https://extensions.duckdb.org` 下载扩展，这带来两个问题：

1. 第三方网络请求，违背「账单数据零第三方请求」的隐私承诺；
2. 外网不可用时 LOAD 失败，体检管线无法装配。

服务初始化时执行 `SET custom_extension_repository='<origin>/duckdb/extensions'`
（见 `src/lib/duckdb/service.ts`），自动安装改为从本站静态目录拉取，请求全部
同源、离线也可用。

## 目录结构约定

下载 URL 由引擎按「仓库地址 + 引擎版本 + 平台 + 扩展名」拼接：

```
<origin>/duckdb/extensions/<引擎版本>/<平台>/<扩展名>.duckdb_extension.wasm
```

- 引擎版本：`SELECT version()` 的返回值（如 `v1.4.3`），与 @duckdb/duckdb-wasm
  的打包版本一一对应；
- 平台：`wasm_mvp`，与 self-host 的 mvp 产物一致（见 `../README` 与
  `service.ts` 的 selectBundle 配置）。

## 升级 @duckdb/duckdb-wasm 时的检查清单

1. `SELECT version()` 得到新引擎版本号，如 `v1.5.0`；
2. 新建 `v1.5.0/wasm_mvp/` 目录，从
   `https://extensions.duckdb.org/v1.5.0/wasm_mvp/` 下载 `json` 与 `icu` 两个
   扩展文件放入其中（文件名保持 `*.duckdb_extension.wasm` 不变）；
3. 保留旧版本目录，删除确认不再使用的版本；
4. 运行 `tests/e2e/pipeline.spec.ts` 确认管线照常装配。
