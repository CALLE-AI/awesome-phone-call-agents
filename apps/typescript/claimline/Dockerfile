# ---- build stage ------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Install all deps (incl. dev) for the TypeScript build.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# App code + runtime assets (compiled output, fixtures, flow diagram).
COPY --from=build /app/dist ./dist
COPY fixtures ./fixtures
COPY assets ./assets

# Writable location for the SQLite database (ephemeral unless a disk is mounted).
RUN mkdir -p /app/data
ENV CLAIMLINE_DB=/app/data/claimline.db
ENV PORT=8787
EXPOSE 8787

# node:sqlite ships with Node 22 but is gated behind this flag.
CMD ["node", "--experimental-sqlite", "dist/index.js"]
