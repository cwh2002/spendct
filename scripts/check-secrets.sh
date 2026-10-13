#!/usr/bin/env bash
# 提交前密钥扫描（01 §4.3 第 4 条）。挂 husky pre-commit；CI 再跑一遍做双保险。
# 失败（退出码 1）时禁止提交：命中真实密钥模式或 .env 被 git add。
set -uo pipefail

FAILED=0

# 1) .env / .env.local 绝不允许被 git add
if git diff --cached --name-only | grep -qE '(^|/)\.env(\.local)?$'; then
  echo "[check-secrets] 失败：.env / .env.local 被 git add，禁止提交"
  FAILED=1
fi

# 2) 已跟踪文件内容中不得出现非空密钥赋值（.env.example 只有占位空值）
if git grep -nE '^(DEEPSEEK_API_KEY|SILICONFLOW_API_KEY|GLM_API_KEY|QWEATHER_API_KEY)="[^"].+"' -- ':!.env.example' | grep -q .; then
  echo "[check-secrets] 失败：检出非空密钥赋值"
  git grep -nE '^(DEEPSEEK_API_KEY|SILICONFLOW_API_KEY|GLM_API_KEY|QWEATHER_API_KEY)="[^"].+"' -- ':!.env.example'
  FAILED=1
fi

# 3) 常见密钥串模式（sk- / Bearer 后跟疑似真值）
if git grep -nE 'sk-[A-Za-z0-9]{20,}' -- . ':(exclude)docs/**' ':(exclude)pnpm-lock.yaml' | grep -q .; then
  echo "[check-secrets] 失败：检出 sk- 密钥模式"
  git grep -nE 'sk-[A-Za-z0-9]{20,}' -- . ':(exclude)docs/**' ':(exclude)pnpm-lock.yaml'
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "[check-secrets] 通过"
fi
exit $FAILED
