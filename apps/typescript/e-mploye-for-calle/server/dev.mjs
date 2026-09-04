import { createServer } from "node:http";
import { getConfig, publicRuntimeConfig } from "./config.mjs";
import { createApi } from "./api.mjs";

const config = getConfig();
const api = createApi();

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    res.end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const result = await api.dispatch(req.method || "GET", new URL(req.url || "/api/health", "http://localhost").pathname, body);
  res.writeHead(result.status, { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(result.body));
});

server.listen(config.port, config.host, () => {
  console.log(`E-mploye API listening on http://127.0.0.1:${config.port}`);
  const runtime = publicRuntimeConfig(config);
  console.log(`Provider mode: ${runtime.provider === "live" ? "live CALL-E" : "fake (no calls)"}`);
  if (runtime.provider === "fake" && runtime.liveRequested) console.log("Live mode requested but not ready: configure the server-only API key and test phone.");
});
