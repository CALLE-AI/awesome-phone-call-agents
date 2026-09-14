# Hosted dry-run demo of the Canopy dashboard. Places no calls: CANOPY_MODE is pinned to dry-run
# and the fake CALL-E server runs inside the container. Live mode is intentionally not
# supported from this image.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV CANOPY_MODE=dry-run \
    CANOPY_HOST=0.0.0.0 \
    CANOPY_PORT=4700 \
    CANOPY_ORG="Canopy demo (dry-run)" \
    CANOPY_EMERGENCY_NUMBER=911 \
    CANOPY_QUIET_HOURS=none
EXPOSE 4700
CMD ["node", "--import", "tsx", "src/cli.ts", "serve", "--quiet"]
