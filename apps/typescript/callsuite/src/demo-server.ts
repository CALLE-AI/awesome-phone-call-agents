import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runJudgeDemo } from "./demo.js";

export interface DemoServer {
  server: Server;
  url: string;
}

export async function startDemoServer(repositoryRoot = process.cwd(), port = 4173): Promise<DemoServer> {
  const outputDirectory = resolve(repositoryRoot, "artifacts", "judge-demo");
  await runJudgeDemo(repositoryRoot, outputDirectory);

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath = decodeURIComponent(requestUrl.pathname) === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname).slice(1);
      const filePath = resolve(outputDirectory, relativePath);
      if (filePath !== outputDirectory && !filePath.startsWith(`${outputDirectory}${sep}`)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentType(filePath),
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListening());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine the local demo address.");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

export function parseDemoPort(args: string[]): number {
  if (args.length === 0) return 4173;
  if (args.length !== 2 || args[0] !== "--port") {
    throw new Error("Usage: pnpm demo:serve [--port <1-65535>]");
  }
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Demo port must be an integer from 1 to 65535.");
  }
  return port;
}

function contentType(path: string): string {
  if (extname(path) === ".html") return "text/html; charset=utf-8";
  if (extname(path) === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  try {
    const demo = await startDemoServer(process.cwd(), parseDemoPort(process.argv.slice(2)));
    process.stdout.write([
      "CallSuite interactive demo is running",
      `Open: ${demo.url}`,
      "Safety: reviewed replay only · 0 credentials · 0 phone calls",
      "Press Ctrl+C to stop.",
    ].join("\n") + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CallSuite demo server error: ${message}\n`);
    process.exitCode = 3;
  }
}
