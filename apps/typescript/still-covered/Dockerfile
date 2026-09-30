# Hosted dry-run demo of the Still Covered dashboard. Places no calls: SC_MODE is pinned to dry-run
# and the fake CALL-E server runs inside the container. Live mode is intentionally not supported
# from this image.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV SC_MODE=dry-run \
    SC_HOST=0.0.0.0 \
    SC_PORT=4800 \
    SC_QUIET_HOURS=none
EXPOSE 4800
CMD ["node", "--import", "tsx", "src/cli.ts", "serve", "--quiet"]
