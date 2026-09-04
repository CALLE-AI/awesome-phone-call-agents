import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.mjs";
import { createApi } from "./api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const config = getConfig();
const api = createApi();
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const result = await api.dispatch(req.method || "GET", pathname, body);
    res.writeHead(result.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(result.body));
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.resolve(dist, requested.replace(/^\/+/, ""));
  const relative = path.relative(dist, file);
  const insideDist = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  const resolved = insideDist && existsSync(file) && statSync(file).isFile() ? file : path.join(dist, "index.html");
  res.writeHead(200, { "content-type": contentTypes[path.extname(resolved)] || "application/octet-stream" });
  createReadStream(resolved).pipe(res);
});

server.listen(config.port, config.host, () => console.log(`E-mploye production server listening on ${config.host}:${config.port}`));
