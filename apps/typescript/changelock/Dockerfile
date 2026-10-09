# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHANGELOCK_MODE=replay \
    CHANGELOCK_DB_PATH=/data/changelock.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["env", "-u", "CALLE_API_KEY", "CHANGELOCK_MODE=replay", "node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
