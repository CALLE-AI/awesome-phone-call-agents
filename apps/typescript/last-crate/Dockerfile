FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY engine.ts fixtures.ts provider.ts server.ts store.ts workflow.ts ./
COPY response-fixtures ./response-fixtures
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3210
EXPOSE 3210
VOLUME ["/app/data"]
CMD ["node", "server.ts"]
