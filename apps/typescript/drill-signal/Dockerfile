# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3847
ENV DRILL_SIGNAL_BIND_HOST=0.0.0.0
ENV DRILL_SIGNAL_DATA_DIR=/data

RUN groupadd --system --gid 1001 drillsignal \
  && useradd --system --uid 1001 --gid drillsignal --home-dir /app drillsignal \
  && mkdir -p /data \
  && chown drillsignal:drillsignal /data /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=drillsignal:drillsignal /app/dist ./dist

USER drillsignal

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3847/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Set DRILL_SIGNAL_OPERATOR_TOKEN when binding non-loopback (default in Docker).
CMD ["node", "dist/server.js"]
