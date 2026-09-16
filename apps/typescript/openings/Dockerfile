# syntax = docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

# Native addons (better-sqlite3) need build tools during install.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN apk add --no-cache python3 make g++ && \
    pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && pnpm build:scheduler

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libstdc++
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist-scheduler ./dist-scheduler

# Persistent volume for the SQLite database (Fly.io).
ENV OPENINGS_STORE=sqlite
ENV OPENINGS_DB_PATH=/data/openings.db
EXPOSE 3000

# Run the Next.js server and the host-owned scheduler as sibling processes.
# The scheduler no-ops unless OPENINGS_CALL_MODE=live.
CMD ["sh", "-c", "node server.js & node dist-scheduler/scheduler.js & wait -n; exit $?"]
