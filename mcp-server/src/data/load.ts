/**
 * 静态数据 JSON 加载：数据文件与源码同目录管理（src/data/），
 * 编译产物由 scripts/copy-data.mjs 原样复制到 dist/data/，
 * 因此开发（tsx）与生产（node dist/）两种运行方式下相对路径结构一致。
 */
import { readFileSync } from "node:fs";

export function readJson<T>(fileName: string): T {
  // load.ts 本身位于 data/ 目录内（src/data 与 dist/data 结构一致），
  // 因此相对本文件的同级路径即数据文件所在目录
  const url = new URL(`./${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}
