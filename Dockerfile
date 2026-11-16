# ── 构建阶段：装全部依赖、编译前端与联机服务器 ────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts vitest.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
RUN node scripts/build.mjs

# ── 运行阶段：只保留运行时需要的 ws 依赖与构建产物 ─────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
USER node
CMD ["node", "dist-server/index.mjs"]
