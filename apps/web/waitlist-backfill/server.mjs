/**
 * Waitlist Backfill - web workbench.
 *
 *   node server.mjs                 preview only, no credentials, no calls
 *   CALLE_MODE=live CALLE_API_KEY=... node server.mjs
 *
 * Live mode still requires the operator to confirm the specific slot id in the UI. Setting the
 * environment variable alone does not place a call.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { runBackfill } from "./src/backfill.mjs";
import { makeClient } from "./src/calle.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const SCENARIO_PATH = fileURLToPath(new URL("./data/scenario.sample.json", import.meta.url));
const INDEX_PATH = fileURLToPath(new URL("./public/index.html", import.meta.url));

/**
 * Three server modes:
 *   (unset)             preview only. The default, and the only mode with no way to place a call.
 *   CALLE_MODE=simulate the full run loop - intent gate, calls, acceptance, suppression - against
 *                       the fake transport. No credentials, no real calls. This exists so the
 *                       complete behaviour is reviewable without a CALL-E account.
 *   CALLE_MODE=live     real calls through the CALL-E API. Needs CALLE_API_KEY.
 */
const simulateMode = process.env.CALLE_MODE === "simulate";
const liveMode = process.env.CALLE_MODE === "live" && Boolean(process.env.CALLE_API_KEY);
const liveConfigured = liveMode || simulateMode;

/** Only one backfill at a time: there is only one slot, and it keeps cancellation unambiguous. */
let activeRun = null;

async function loadScenario() {
  return JSON.parse(await readFile(SCENARIO_PATH, "utf8"));
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function handleRunStream(req, res, url) {
  if (activeRun) return json(res, 409, { error: "A backfill is already running." });

  const scenario = await loadScenario();
  const mode = url.searchParams.get("mode") === "live" ? "live" : "preview";
  const confirmSlotId = url.searchParams.get("confirmSlotId") ?? null;

  if (mode === "live" && !liveConfigured) {
    return json(res, 400, {
      error: "This server is preview-only. Start it with CALLE_MODE=simulate to see the full run "
        + "without placing calls, or CALLE_MODE=live plus CALLE_API_KEY to place real ones.",
    });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  activeRun = { cancelled: false };
  const run = activeRun;
  req.on("close", () => {
    run.cancelled = true;
  });

  try {
    const summary = await runBackfill({
      slot: scenario.slot,
      waitlist: scenario.waitlist,
      policy: scenario.policy,
      history: scenario.history,
      client: makeClient(process.env, scenario.scriptedAnswers),
      request: { mode, confirmSlotId },
      message: scenario.message,
      isCancelled: () => run.cancelled,
      onEvent: send,
      // A fixed instant keeps the sample deterministic, so every guardrail demonstrates itself
      // whatever time of day the app is opened. Live mode uses the real clock.
      now: mode === "live" ? new Date() : new Date(scenario.demoNow),
    });
    send({ type: "run_finished", summary });
  } catch (err) {
    send({ type: "run_error", detail: String(err.message ?? err) });
  } finally {
    activeRun = null;
    res.end();
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(INDEX_PATH);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (url.pathname === "/api/scenario") {
      const scenario = await loadScenario();
      return json(res, 200, {
        ...scenario,
        liveConfigured,
        transport: liveMode ? "live" : "fake",
      });
    }
    if (url.pathname === "/api/run") {
      return await handleRunStream(req, res, url);
    }
    if (url.pathname === "/api/cancel" && req.method === "POST") {
      if (activeRun) activeRun.cancelled = true;
      return json(res, 200, { cancelled: Boolean(activeRun) });
    }
    json(res, 404, { error: "Not found" });
  } catch (err) {
    json(res, 500, { error: String(err.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`Waitlist Backfill workbench: http://localhost:${PORT}`);
  if (liveMode) {
    console.log("Mode: LIVE. Real calls, gated on confirming the slot id in the UI.");
  } else if (simulateMode) {
    console.log("Mode: SIMULATE. The full run loop against the fake transport. No real calls.");
  } else {
    console.log("Mode: PREVIEW only. No credentials set, so this server cannot place a call.");
  }
});
