import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.recommended,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "public/duckdb/**",
    "public/spike/**",
    "mcp-server/**",
    "coverage/**",
    "playwright-report/**",
  ]),
  {
    // 架构边界：服务端与 mcp-server 禁止引用 DuckDB-WASM 与浏览器侧封装（01 §1.5，违规 CI 直接红）
    files: ["src/server/**", "src/app/api/**", "mcp-server/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "@duckdb/duckdb-wasm",
            { name: "@/lib/duckdb", message: "DuckDB-WASM 只在浏览器运行，禁止服务端引用" },
          ],
        },
      ],
    },
  },
]);
