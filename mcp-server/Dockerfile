# spendct-mcp 独立部署镜像（构建上下文 = 仓库根目录）
# 构建：docker build -f mcp-server/Dockerfile -t spendct-mcp .
# 运行：docker run --rm -p 3100:3100 -e HOST=0.0.0.0 -e QWEATHER_API_KEY=... spendct-mcp

# ---------- 依赖层：仅安装本子包（锁文件保证可复现） ----------
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY mcp-server/package.json mcp-server/package.json
RUN pnpm install --filter spendct-mcp-server --frozen-lockfile

# ---------- 构建层 ----------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/mcp-server/node_modules mcp-server/node_modules
COPY --from=deps /repo/pnpm-lock.yaml pnpm-lock.yaml
COPY --from=deps /repo/pnpm-workspace.yaml pnpm-workspace.yaml
COPY --from=deps /repo/package.json package.json
COPY mcp-server/package.json mcp-server/package.json
COPY mcp-server/tsconfig.json mcp-server/tsconfig.json
COPY mcp-server/scripts mcp-server/scripts
COPY mcp-server/src mcp-server/src
RUN pnpm --filter spendct-mcp-server build

# ---------- 运行层 ----------
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /repo/mcp-server/package.json ./
COPY --from=build /repo/mcp-server/dist ./dist
COPY --from=build /repo/pnpm-lock.yaml /repo/package.json /repo/pnpm-workspace.yaml /repo/
WORKDIR /repo
RUN pnpm install --filter spendct-mcp-server --frozen-lockfile --prod
ENV HOST=0.0.0.0 PORT=3100 NODE_ENV=production
EXPOSE 3100
CMD ["node", "/repo/mcp-server/dist/index.js"]
