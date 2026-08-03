/**
 * Waitlist Backfill - web workbench.
 *
 *   node server.mjs                                     preview only, no credentials, no calls
 *   CALLE_MODE=simulate node server.mjs                 the whole loop against a fake transport
 *   CALLE_MODE=live CALLE_API_KEY=... node server.mjs   real calls
 *
 * Live mode requires two things the environment variable alone does not give you: the operator
 * token this prints at startup, and confirmation of the specific slot id.
 *
 * Binds to loopback unless told otherwise. This is a demo workbench with a button that telephones
 * real people, and a default of "reachable from the network" is the wrong default for that.
 * Override deliberately with HOST=0.0.0.0 if you mean it.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { makeClient } from "./src/calle.mjs";
import { createHandler, resolveHost, resolveOperatorToken } from "./src/http.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = resolveHost(process.env);
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

const operatorToken = resolveOperatorToken(process.env, liveMode);

const handler = createHandler({
  loadScenario: async () => JSON.parse(await readFile(SCENARIO_PATH, "utf8")),
  createClient: (scenario) => makeClient(process.env, scenario.scriptedAnswers),
  readIndex: () => readFile(INDEX_PATH),
  liveMode,
  simulateMode,
  operatorToken,
});

createServer(handler).listen(PORT, HOST, () => {
  console.log(`Waitlist Backfill workbench: http://${HOST}:${PORT}`);
  if (liveMode) {
    console.log("Mode: LIVE. Real calls, gated on the operator token AND the slot id.");
    console.log(`Operator token: ${operatorToken}`);
    console.log("Paste that into the workbench. Set CALLE_OPERATOR_TOKEN to pin it across restarts.");
  } else if (simulateMode) {
    console.log("Mode: SIMULATE. The full run loop against the fake transport. No real calls.");
  } else {
    console.log("Mode: PREVIEW only. No credentials set, so this server cannot place a call.");
  }
  if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.log(`WARNING: listening on ${HOST}, so this is reachable beyond this machine.`);
  }
});
