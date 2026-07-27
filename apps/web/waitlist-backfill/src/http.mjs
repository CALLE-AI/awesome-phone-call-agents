/**
 * The HTTP surface, as a request handler with its dependencies injected.
 *
 * Split out of server.mjs so that the rules which decide whether a request may dial anyone can be
 * tested by calling this directly, with no port, no child process and no network. Those are the
 * cases most worth having in a suite that runs anywhere, and they were previously reachable only
 * by spawning a real server.
 */

import { randomBytes } from "node:crypto";

import { runBackfill } from "./backfill.mjs";
import { maskPhone } from "./guardrails.mjs";

/**
 * Loopback by default. This is a demo workbench with a button that telephones real people, so
 * "reachable from the network" is the wrong default; binding wider has to be deliberate.
 */
export function resolveHost(env = {}) {
  return env.HOST ?? "127.0.0.1";
}

/**
 * A token is required exactly when the transport can dial, and is generated when not supplied, so
 * that forgetting to configure one produces a token you must go and read rather than an open
 * endpoint. Preview and simulate need none, because neither can reach a telephone.
 */
export function resolveOperatorToken(env = {}, liveMode, generate = () => randomBytes(24).toString("hex")) {
  if (!liveMode) return null;
  return env.CALLE_OPERATOR_TOKEN || generate();
}

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Constant-time string comparison, so a wrong token cannot be discovered a character at a time.
 * Length is compared first and leaks only the length, which is fixed and public anyway.
 */
export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function readJsonBody(req, limitBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("Request body too large.");
    chunks.push(Buffer.from(chunk));
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * @param {object}   deps
 * @param {Function} deps.loadScenario  () => Promise<scenario>
 * @param {Function} deps.createClient  (scenario) => transport client
 * @param {Function} deps.readIndex     () => Promise<string|Buffer>
 * @param {boolean}  deps.liveMode      the transport really dials people
 * @param {boolean}  deps.simulateMode  full loop against the fake transport
 * @param {string?}  deps.operatorToken required for live run/cancel; null when not live
 * @param {Function} [deps.now]         injectable clock, for tests
 */
export function createHandler({
  loadScenario,
  createClient,
  readIndex,
  liveMode = false,
  simulateMode = false,
  operatorToken = null,
  now = () => new Date(),
}) {
  const liveConfigured = liveMode || simulateMode;

  /**
   * Only one backfill at a time: there is one slot, and it keeps cancellation unambiguous.
   *
   * THIS IS A LOCK, NOT A FLAG, AND THE DISTINCTION IS THE WHOLE POINT. It used to be read, then
   * `await loadScenario()`, then written. Between the read and the write the event loop is free to
   * run another request, so two concurrent POSTs could both see null and both start a run - two
   * loops calling the same waitlist about one appointment. The reservation below happens in the
   * same synchronous turn as the check, before any await exists to interleave with.
   */
  let activeRun = null;

  /** Reserve synchronously. Returns the run, or null if one is already in flight. */
  function reserveRun() {
    if (activeRun) return null;
    activeRun = { cancelled: false };
    return activeRun;
  }

  function releaseRun(run) {
    if (activeRun === run) activeRun = null;
  }

  /**
   * Is this a real gesture from our own page, rather than something another site caused the
   * browser to send?
   *
   * A non-simple method, a same-origin `Origin`, and a JSON content type together are unforgeable
   * from a cross-site context, because the content type forces a preflight a form or an <img>
   * cannot make. These are browser-behaviour checks though, and a direct HTTP client is not a
   * browser: they stop a cross-site page, they do not prove an operator. Authentication does that,
   * and for anything live it is required separately below.
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

  /**
   * Anything that can place a real call needs the operator token.
   *
   * The header checks above describe where a request came from; this one establishes who sent it.
   * Without it, any client that can reach the port can POST a live confirmation, and the slot id
   * is not a secret - which is why it is also withheld from the scenario endpoint in live mode.
   * Preview and simulate need no token, because neither can dial a telephone.
   */
  function requireOperator(req, res) {
    if (!operatorToken) return true;
    const header = String(req.headers.authorization ?? "");
    const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!tokensMatch(supplied, operatorToken)) {
      json(res, 401, {
        error: "Live calling requires the operator token printed in the server console.",
      });
      return false;
    }
    return true;
  }

  async function handleRunStream(req, res, body, run) {
    const scenario = await loadScenario();
    const mode = body.mode === "live" ? "live" : "preview";
    const confirmSlotId = typeof body.confirmSlotId === "string" ? body.confirmSlotId : null;

    if (mode === "live" && !liveConfigured) {
      releaseRun(run);
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

    req.on?.("close", () => {
      run.cancelled = true;
    });

    try {
      const summary = await runBackfill({
        slot: scenario.slot,
        waitlist: scenario.waitlist,
        policy: scenario.policy,
        history: scenario.history,
        client: createClient(scenario),
        request: { mode, confirmSlotId },
        message: scenario.message,
        isCancelled: () => run.cancelled,
        onEvent: send,
        // THE CLOCK FOLLOWS THE TRANSPORT, NOT THE REQUESTED MODE. A simulated run asks for mode
        // "live" on purpose, to exercise the intent gate and the whole loop, so keying this on the
        // requested mode gave simulation the real clock: opened outside the sample calling window,
        // quiet hours skipped every contact and the scripted run never happened.
        now: liveMode ? now() : new Date(scenario.demoNow),
      });
      send({ type: "run_finished", summary });
    } catch (err) {
      send({ type: "run_error", detail: String(err.message ?? err) });
    } finally {
      releaseRun(run);
      res.end();
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = await readIndex();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      if (url.pathname === "/api/scenario") {
        const scenario = await loadScenario();
        // THE BROWSER NEVER RECEIVES A RAW NUMBER, and in live mode it does not receive the slot
        // id either. The id is the thing a live confirmation has to echo, so publishing it to any
        // unauthenticated client hands over half of the intent gate. The UI does not need it: the
        // operator types it, and the server is what actually checks it.
        const { waitlist, slot, ...rest } = scenario;
        const exposedSlot = liveMode ? { ...slot, id: undefined } : slot;
        return json(res, 200, {
          ...rest,
          slot: exposedSlot,
          slotIdWithheld: liveMode,
          waitlist: waitlist.map(({ phone, ...c }) => ({ ...c, phoneMasked: maskPhone(phone) })),
          liveConfigured,
          transport: liveMode ? "live" : "fake",
          operatorTokenRequired: Boolean(operatorToken),
        });
      }

      if (url.pathname === "/api/run") {
        if (!requireSameOriginPost(req, res)) return;
        if (!requireOperator(req, res)) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          return json(res, 400, { error: String(err.message ?? err) });
        }
        // Reserve BEFORE the awaits inside handleRunStream, in the same turn as the check.
        const run = reserveRun();
        if (!run) return json(res, 409, { error: "A backfill is already running." });
        return await handleRunStream(req, res, body, run);
      }

      if (url.pathname === "/api/cancel") {
        if (!requireSameOriginPost(req, res)) return;
        if (!requireOperator(req, res)) return;
        if (activeRun) activeRun.cancelled = true;
        return json(res, 200, { cancelled: Boolean(activeRun) });
      }

      json(res, 404, { error: "Not found" });
    } catch (err) {
      json(res, 500, { error: String(err.message ?? err) });
    }
  };
}
