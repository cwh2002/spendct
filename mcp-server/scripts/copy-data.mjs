/**
 * 把 src/data/ 下的静态 JSON 原样复制到 dist/data/，
 * 使编译产物运行时（node dist/index.js）与开发期（tsx src/index.ts）
 * 拥有相同的「代码同级 data/」相对路径结构（见 src/data/load.ts）。
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(pkgRoot, "src", "data");
const distDir = join(pkgRoot, "dist", "data");

// 先清空旧目录再逐文件复制。本机实测（Windows + 中文路径盘符）：
// cpSync 覆盖已存在的目标文件会以「unlink 失败（errno 0）」报错，
// 而 copyFileSync 稳定；重建目录后目标必不存在，可完全绕开该问题，
// 并顺带清掉历史残留文件
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
// 只复制静态 JSON；load.ts 由 tsc 正常编译进 dist/data/
for (const name of readdirSync(srcDir)) {
  if (name.endsWith(".json")) {
    copyFileSync(join(srcDir, name), join(distDir, name));
  }
}
console.log("[copy-data] src/data -> dist/data 复制完成");
