# syntax=docker/dockerfile:1.7
# ── Build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
# Toolchain for better-sqlite3, in case no prebuilt binary matches this platform.
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/orqevio/package.json packages/orqevio/
COPY packages/create-orqevio/package.json packages/create-orqevio/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @orqevio/server deploy --prod --legacy /out \
 && cp -r apps/server/dist /out/dist \
 && mkdir -p /out/web && cp -r apps/web/dist /out/web/dist

# ── Runtime ───────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app
RUN addgroup -S orqevio && adduser -S orqevio -G orqevio \
 && mkdir -p /data && chown orqevio:orqevio /data
COPY --from=build --chown=orqevio:orqevio /out /app
USER orqevio
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
