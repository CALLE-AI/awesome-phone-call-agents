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
import { maskPhone } from "./src/guardrails.mjs";

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

/**
 * Is this request a real gesture from our own page, rather than something another site caused the
 * browser to send?
 *
 * A typed confirmation in the UI proves nothing at the server boundary: the server sees only an
 * HTTP request. Starting a run is a side effect that dials real people, so it needs the three
 * things a cross-site attacker cannot all produce - a non-simple method, a same-origin `Origin`,
 * and a JSON content type, which forces a CORS preflight that a plain form or an <img> cannot make.
 * `Sec-Fetch-Site` is checked when the browser sends it and ignored when it does not, since it is
 * a hardening signal rather than the guarantee.
 */
function requireSameOriginPost(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "This endpoint changes state and must be a POST." });
    return false;
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin") {
    json(res, 403, { error: `Cross-site request refused (sec-fetch-site: ${site}).` });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      json(res, 403, { error: "Unparseable Origin header." });
      return false;
    }
    if (host !== req.headers.host) {
      json(res, 403, { error: "Cross-origin request refused." });
      return false;
    }
  }
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim();
  if (type !== "application/json") {
    json(res, 415, { error: "Expected content-type: application/json." });
    return false;
  }
  return true;
}

async function readJsonBody(req, limitBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleRunStream(req, res, body) {
  if (activeRun) return json(res, 409, { error: "A backfill is already running." });

  const scenario = await loadScenario();
  const mode = body.mode === "live" ? "live" : "preview";
  const confirmSlotId = typeof body.confirmSlotId === "string" ? body.confirmSlotId : null;

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
      // THE CLOCK FOLLOWS THE TRANSPORT, NOT THE REQUESTED MODE.
      //
      // This read `mode === "live" ? new Date() : demoNow`, which broke simulation: a simulated
      // run asks for mode "live" on purpose, to exercise the intent gate and the whole loop, so it
      // took the real clock. Open the app outside the sample calling window and quiet hours then
      // skipped every contact, and the deterministic acceptance-and-suppression run the README
      // promises never happened.
      //
      // Only a genuinely live transport dials real people, and only that case must obey the real
      // clock. Anything against the fake transport gets the scripted instant.
      now: liveMode ? new Date() : new Date(scenario.demoNow),
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
      // THE BROWSER NEVER RECEIVES A RAW NUMBER. This used to spread the scenario wholesale, which
      // shipped every waitlist phone number to the client and made the app's own claim false. The
      // masked form is all the UI ever displays, so it is all the UI is given; masking in the page
      // is not a control, because the raw value has already left the building by then.
      const { waitlist, ...rest } = scenario;
      return json(res, 200, {
        ...rest,
        waitlist: waitlist.map(({ phone, ...c }) => ({ ...c, phoneMasked: maskPhone(phone) })),
        liveConfigured,
        transport: liveMode ? "live" : "fake",
      });
    }
    if (url.pathname === "/api/run") {
      if (!requireSameOriginPost(req, res)) return;
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return json(res, 400, { error: String(err.message ?? err) });
      }
      return await handleRunStream(req, res, body);
    }
    if (url.pathname === "/api/cancel") {
      if (!requireSameOriginPost(req, res)) return;
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
