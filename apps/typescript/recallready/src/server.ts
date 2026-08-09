import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getRecallById, searchRecalls } from "./cpsc.js";
import { CalleCallProvider, MockCallProvider } from "./providers.js";
import { cleanShortText } from "./privacy.js";
import type { PreviewInput } from "./types.js";
import { RecallWorkflow } from "./workflow.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = normalize(join(here, "..", "..", "public"));
const workflow = new RecallWorkflow();
const liveCallsEnabled = process.env.LIVE_CALLS_ENABLED === "true";

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 50_000) throw new Error("Request is too large.");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required.");
  return parsed as Record<string, unknown>;
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const target = normalize(join(publicRoot, relative));
  if (!target.startsWith(publicRoot)) return json(res, 404, { error: "Not found" });
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  try {
    const content = await readFile(target);
    res.writeHead(200, {
      "content-type": types[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
    });
    res.end(content);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

export const app = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, mode: liveCallsEnabled ? "live-enabled" : "mock-only" });
    }
    if (req.method === "POST" && url.pathname === "/api/recalls/search") {
      const input = await body(req);
      const recalls = await searchRecalls(cleanShortText(input.query, 80));
      return json(res, 200, { recalls });
    }
    if (req.method === "POST" && url.pathname === "/api/previews") {
      const input = await body(req);
      const recallId = Number(input.recallId);
      const recall = await getRecallById(recallId);
      const previewInput: PreviewInput = {
        recallId,
        modelNumber: cleanShortText(input.modelNumber, 60),
        dateCode: cleanShortText(input.dateCode, 40) || undefined,
        demoPhone: cleanShortText(input.demoPhone, 30) || undefined,
        demoConsent: input.demoConsent === true,
      };
      return json(res, 201, { preview: workflow.createPreview(recall, previewInput, liveCallsEnabled) });
    }
    if (req.method === "POST" && url.pathname === "/api/calls") {
      const input = await body(req);
      const previewId = cleanShortText(input.previewId, 80);
      const approvalPhrase = cleanShortText(input.approvalPhrase, 20);
      const mode = input.mode === "live" ? "live" : "mock";
      if (mode === "live" && !liveCallsEnabled) throw new Error("Live calls are disabled on this deployment.");
      const provider = mode === "live"
        ? new CalleCallProvider(process.env.CALL_E_API_KEY ?? "")
        : new MockCallProvider();
      return json(res, 200, { result: await workflow.execute(previewId, approvalPhrase, provider) });
    }
    if (req.method === "GET") return void (await serveStatic(url.pathname, res));
    json(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    json(res, 400, { error: message });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8788);
  app.listen(port, "127.0.0.1", () => {
    console.log(`RecallReady listening on http://127.0.0.1:${port} (${liveCallsEnabled ? "live enabled" : "mock only"})`);
  });
}
