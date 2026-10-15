/**
 * 构建脚本专用的 TS 装载器：把 src 下的 TS 模块转译为 CommonJS 后执行，
 * 使离线构建脚本（build-vocab / build-golden-embeddings / eval-hit3）
 * 与运行时共用同一份分词/嵌入实现，避免双源漂移。
 * 仅支持本项目用到的导入形态：@/ 别名、相对 .ts、相对 .json、裸包名。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..", "..");

const cache = new Map();

/**
 * 加载一个 TS 文件并返回其导出。
 * @param {string} tsPath 绝对路径
 */
export function loadTsModule(tsPath) {
  const abs = resolve(tsPath);
  if (cache.has(abs)) return cache.get(abs).exports;
  const src = readFileSync(abs, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: abs,
  });
  // 转译产物是 CommonJS：构造模块壳，注入 require/module/exports 后执行
  const moduleShim = { exports: {} };
  cache.set(abs, moduleShim);
  const localRequire = createRequire(abs);
  const myRequire = (spec) => {
    if (spec.startsWith("@/")) {
      const target = resolve(ROOT, "src", spec.slice(2));
      return loadTarget(target);
    }
    if (spec.startsWith(".")) {
      return loadTarget(resolve(dirname(abs), spec));
    }
    return localRequire(spec);
  };
  new Function("require", "module", "exports", outputText)(myRequire, moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

function loadTarget(target) {
  if (target.endsWith(".ts") || target.endsWith(".tsx")) return loadTsModule(target);
  if (target.endsWith(".json")) return JSON.parse(readFileSync(target, "utf8"));
  // 无扩展名的相对导入按 .ts 尝试
  if (!/\.\w+$/.test(target)) {
    const tsFile = target + ".ts";
    try {
      return loadTsModule(tsFile);
    } catch {
      // 落到 Node 默认解析
    }
  }
  return createRequire(target)(target);
}

export { ROOT, join };
