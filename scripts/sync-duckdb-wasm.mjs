// 把 duckdb-wasm 的运行时产物复制到 public/duckdb（01 §1.5 / 07 契约 §8）：
// 自托管、零 CDN 依赖，答辩与录屏演示断网可用。postinstall 自动执行，产物 git 提交。
//
// 除 wasm/worker 外还要带上三件东西，供 public/spike 独立静态页原生浏览器运行：
// 1. apache-arrow 的 .mjs 模块树 —— duckdb-browser.mjs 以裸模块名 import，需 import map 解析；
// 2. tslib.es6.mjs —— arrow 的运行时辅助库（同为裸模块名）；
// 3. flatbuffers 的 mjs 构建 —— arrow 的 fb/*.mjs 子模块同样裸引用它。
// Next 应用内不依赖这些副本（打包器自行解析），它们只服务 spike 页。
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const outDir = resolve(root, "public", "duckdb");

// 单线程 mvp 变体（pthreadWorker:null，无 SharedArrayBuffer 依赖）
const files = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser.mjs",
];

/** 递归复制目录下指定扩展名的模块文件，保留相对结构 */
async function copyModuleTree(srcDir, destDir, ext = ".mjs") {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    if (entry.isDirectory()) {
      // destDir 必须与 srcDir 同步推进，否则子目录文件会被平铺到顶层互相覆盖
      await copyModuleTree(src, join(destDir, entry.name), ext);
    } else if (entry.name.endsWith(ext)) {
      await copyFile(src, join(destDir, entry.name));
    }
  }
}

async function main() {
  if (!existsSync(distDir)) {
    console.log("[sync-duckdb-wasm] 未找到 @duckdb/duckdb-wasm 产物，跳过（pnpm install 后自动执行）");
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const name of files) {
    await copyFile(resolve(distDir, name), resolve(outDir, name));
    console.log(`[sync-duckdb-wasm] public/duckdb/${name}`);
  }

  // 这些包位于 pnpm 的实际包目录；tslib/flatbuffers 是 arrow 的传递依赖，
  // 项目根解析不到，要从 arrow 包内出发解析
  const { createRequire } = await import("node:module");
  const rootRequire = createRequire(import.meta.url);
  const arrowDir = dirname(rootRequire.resolve("apache-arrow"));
  const arrowRequire = createRequire(join(arrowDir, "noop.js"));
  const tslibDir = dirname(arrowRequire.resolve("tslib"));
  // flatbuffers 的 main 入口在包内 js/ 子目录：向上回退到包含 mjs/ 的包根
  let flatbuffersDir = dirname(arrowRequire.resolve("flatbuffers"));
  while (flatbuffersDir.length > 3 && !existsSync(join(flatbuffersDir, "mjs"))) {
    flatbuffersDir = dirname(flatbuffersDir);
  }
  await copyModuleTree(arrowDir, resolve(outDir, "arrow"));
  await copyFile(join(tslibDir, "tslib.es6.mjs"), resolve(outDir, "tslib", "tslib.es6.mjs"));
  // flatbuffers 的 ESM 构建在包内 mjs/ 子目录，整目录复制
  await copyModuleTree(join(flatbuffersDir, "mjs"), resolve(outDir, "flatbuffers"), ".js");
  console.log("[sync-duckdb-wasm] public/duckdb/arrow（.mjs 树）");
  console.log("[sync-duckdb-wasm] public/duckdb/tslib/tslib.es6.mjs");
  console.log("[sync-duckdb-wasm] public/duckdb/flatbuffers（mjs 构建）");
}

main().catch((err) => {
  console.error("[sync-duckdb-wasm] 同步失败：", err.message);
  process.exit(1);
});
