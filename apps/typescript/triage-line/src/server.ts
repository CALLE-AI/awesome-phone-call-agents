/**
 * Switchboard HTTP server.
 *
 * Endpoints:
 *   POST /api/runs            { scenario } -> starts a run, returns { id }
 *   GET  /api/runs/:id        -> current RunSnapshot (for polling / initial load)
 *   GET  /api/runs/:id/events -> Server-Sent Events stream of RunEvents
 *                                (replays history, then follows live)
 *   GET  /                    -> the accessible web UI (static web/)
 *
 * The server uses the mock CALL-E by default (USE_MOCK=true). Set USE_MOCK=false
 * with CALLE_API_KEY to place real calls.
 */

// Must be the FIRST import: loads .env (override:true) before anything reads it.
import "./env.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { MockCalleClient } from "../mock/calle-mock.js";
import type { CalleClient } from "./calle/client.js";
import { RealCalleClient } from "./calle/real-client.js";
import { HybridCalleClient } from "./calle/hybrid-client.js";
import { buildReachbackGraph } from "./scenarios/reachback.js";
import { buildRunaroundGraph } from "./scenarios/runaround.js";
import { createRun, getRun } from "./server/runs.js";
import type { CallGraph } from "./graph/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");

/** Mock timing spread so results trickle in gradually (a "timelapse"). */
function mockTiming() {
  return {
    minDelayMs: Number(process.env.MOCK_MIN_DELAY_MS ?? "4000"),
    maxDelayMs: Number(process.env.MOCK_MAX_DELAY_MS ?? "30000"),
  };
}

/** Node ids placed as real calls in hybrid mode (default: reachback-1). */
function realNodeIds(): Set<string> {
  const raw = (process.env.REAL_NODE_IDS ?? "reachback-1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(raw);
}

type Mode = "mock" | "live" | "hybrid";

function currentMode(): Mode {
  // CALL_MODE is the explicit control and takes precedence.
  const m = (process.env.CALL_MODE ?? "").toLowerCase();
  if (m === "hybrid") return "hybrid";
  if (m === "mock") return "mock";
  if (m === "live") return "live";
  // Legacy fallback when CALL_MODE is unset.
  const useMock = (process.env.USE_MOCK ?? "true").toLowerCase() !== "false";
  return useMock ? "mock" : "live";
}

/** Host to bind. Live/hybrid are only allowed on loopback. */
const HOST = process.env.HOST ?? "127.0.0.1";

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** Explicit operator opt-in required to place any real calls from the server. */
function liveConfirmed(): boolean {
  return (process.env.LIVE_CONFIRM ?? "") === "i-understand-this-places-real-calls";
}

function makeClient(): { client: CalleClient; mode: Mode } {
  const mode = currentMode();

  if (mode === "mock") {
    // In pure-mock demos we still want the gradual timelapse effect.
    return { client: new MockCalleClient(mockTiming()), mode };
  }

  // From here on the server would place REAL calls. Enforce three gates:
  //   1. the server must be bound to loopback (never exposed to a network),
  //   2. an explicit LIVE_CONFIRM operator opt-in must be set,
  //   3. a valid API key must be present.
  if (!isLoopbackHost(HOST)) {
    throw new Error(
      `CALL_MODE=${mode} is only permitted when bound to loopback ` +
        `(HOST=127.0.0.1). Refusing to serve real calls on ${HOST}.`
    );
  }
  if (!liveConfirmed()) {
    throw new Error(
      `CALL_MODE=${mode} requires explicit operator opt-in: set ` +
        `LIVE_CONFIRM=i-understand-this-places-real-calls.`
    );
  }
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) {
    throw new Error(`CALL_MODE=${mode} requires CALLE_API_KEY to be set.`);
  }
  const real = new RealCalleClient({
    apiKey,
    baseUrl: process.env.CALLE_BASE_URL,
  });

  if (mode === "live") {
    return { client: real, mode };
  }

  // hybrid: one (or a few) real nodes alongside staggered mock nodes.
  const mock = new MockCalleClient(mockTiming());
  return {
    client: new HybridCalleClient({ realNodeIds: realNodeIds(), real, mock }),
    mode,
  };
}

function buildGraph(scenario: string): CallGraph | undefined {
  if (scenario === "reachback") return buildReachbackGraph();
  if (scenario === "runaround") return buildRunaroundGraph();
  return undefined;
}

const app = express();
app.use(express.json());
app.use(express.static(WEB_DIR));

const maxConcurrency = Number(process.env.MAX_CONCURRENCY ?? "4");

app.get("/api/health", (_req, res) => {
  let mode: string;
  try {
    mode = makeClient().mode;
  } catch {
    mode = `${currentMode()} (missing key)`;
  }
  res.json({
    ok: true,
    mode,
    maxConcurrency,
    realNodeIds: currentMode() === "hybrid" ? [...realNodeIds()] : undefined,
  });
});

app.post("/api/runs", (req, res) => {
  const scenario = String(req.body?.scenario ?? "reachback");
  const graph = buildGraph(scenario);
  if (!graph) {
    res.status(400).json({ error: `Unknown scenario "${scenario}".` });
    return;
  }

  // A run that would place real calls (live/hybrid) requires explicit per-run
  // intent in the request body, on top of the server-level gates. Mock runs
  // never need it.
  const mode = currentMode();
  if (mode !== "mock" && req.body?.confirmLive !== true) {
    res.status(403).json({
      error:
        `This server is in ${mode} mode and would place real calls. Resend ` +
        `with { "confirmLive": true } to explicitly authorize this run.`,
    });
    return;
  }

  let client: CalleClient;
  try {
    client = makeClient().client;
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const run = createRun(scenario, graph);
  // Fire and forget; clients follow progress via SSE.
  void run.execute(client, maxConcurrency);
  res.status(201).json({ id: run.id, scenario });
});

app.get("/api/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  res.json(run.snapshot());
});

// Human review: approve a flagged node (needs_review / needs_user) -> done.
app.post("/api/runs/:id/nodes/:nodeId/approve", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  const ok = run.approveNode(req.params.nodeId, note);
  if (!ok) {
    res.status(409).json({
      error: "Node cannot be approved (not found or not awaiting review).",
    });
    return;
  }
  res.json({ ok: true, snapshot: run.snapshot() });
});

app.get("/api/runs/:id/events", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay history so a late joiner catches up, then follow live.
  for (const past of run.history()) send(past);

  const unsubscribe = run.subscribe(send);

  // Heartbeat to keep the connection alive through proxies.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

const PORT = Number(process.env.PORT ?? "3000");
// Bind to loopback by default. Real-call modes are refused on any non-loopback
// host (see makeClient); a deployed public demo must run in mock mode.
app.listen(PORT, HOST, () => {
  const mode = currentMode();
  const extra =
    mode === "hybrid" ? ` real=[${[...realNodeIds()].join(",")}]` : "";
  const liveNote =
    mode !== "mock" && (!isLoopbackHost(HOST) || !liveConfirmed())
      ? " — real calls DISABLED (needs loopback + LIVE_CONFIRM)"
      : "";
  console.log(
    `TriageLine server on http://${HOST}:${PORT}  (mode=${mode}, concurrency=${maxConcurrency}${extra}${liveNote})`
  );
});
