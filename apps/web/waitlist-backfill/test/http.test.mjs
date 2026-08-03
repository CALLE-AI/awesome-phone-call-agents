/**
 * HTTP-surface tests that run anywhere.
 *
 * These call the request handler directly with stub request/response objects: no port, no socket,
 * no child process, nothing to be blocked by a restricted sandbox. The rules that decide whether a
 * request may dial a telephone are the ones most worth having in a suite that always runs, so they
 * live here rather than behind a spawned server.
 *
 *   node --test test/http.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createHandler, resolveHost, resolveOperatorToken, tokensMatch } from "../src/http.mjs";
import { FakeCalleClient } from "../src/calle.mjs";

const scenario = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/scenario.sample.json", import.meta.url)), "utf8"),
);

const clone = () => JSON.parse(JSON.stringify(scenario));

function mockReq({ method = "GET", url = "/", headers = {}, body = null } = {}) {
  return {
    method,
    url,
    headers: { host: "localhost:8787", ...headers },
    on() {},
    async *[Symbol.asyncIterator]() {
      if (body !== null) yield Buffer.from(body);
    },
  };
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: null,
    chunks: [],
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers;
      return res;
    },
    write(chunk) {
      res.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) res.chunks.push(String(chunk));
      return res;
    },
    get body() {
      return res.chunks.join("");
    },
    json() {
      return JSON.parse(res.body);
    },
    events() {
      return res.body
        .split("\n\n")
        .filter((f) => f.startsWith("data: "))
        .map((f) => JSON.parse(f.slice(6)));
    },
  };
  return res;
}

function build(overrides = {}) {
  return createHandler({
    loadScenario: async () => clone(),
    createClient: (s) => new FakeCalleClient(s.scriptedAnswers),
    readIndex: async () => "<html></html>",
    simulateMode: true,
    ...overrides,
  });
}

const postRun = (body, headers = {}) =>
  mockReq({
    method: "POST",
    url: "/api/run",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/* ---------------------------------------------------------------------------
   The one-run lock
   --------------------------------------------------------------------------- */

test("two concurrent run requests: exactly one starts, the other is refused", async () => {
  // The run is held open on a gate, so the first request is provably still in flight when the
  // second arrives. Without a synchronous reservation both would pass the check and two loops
  // would call the same waitlist about one appointment.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const handler = build({
    createClient: () => ({
      mode: "fake",
      async placeCall() {
        await gate;
        return { id: "held", status: "completed", structuredResult: { can_take_slot: "no" } };
      },
    }),
  });

  const first = mockRes();
  const second = mockRes();
  const p1 = handler(postRun({ mode: "live", confirmSlotId: scenario.slot.id }), first);
  // Let the first request get past its body read and take the reservation.
  await Promise.resolve();
  await Promise.resolve();
  const p2 = handler(postRun({ mode: "live", confirmSlotId: scenario.slot.id }), second);

  await p2;
  assert.equal(second.statusCode, 409, "the second concurrent run must be refused");
  assert.deepEqual(second.json(), { error: "A backfill is already running." });

  release();
  await p1;
  assert.equal(first.statusCode, 200);
});

test("the lock is released, so a later run is accepted", async () => {
  const handler = build();
  const one = mockRes();
  await handler(postRun({ mode: "preview" }), one);
  const two = mockRes();
  await handler(postRun({ mode: "preview" }), two);
  assert.equal(one.statusCode, 200);
  assert.equal(two.statusCode, 200, "the lock must not leak once a run finishes");
});

/* ---------------------------------------------------------------------------
   Operator authentication - who, not just where from
   --------------------------------------------------------------------------- */

const liveHandler = (token = "s3cret-operator-token") =>
  build({ simulateMode: false, liveMode: true, operatorToken: token });

test("a live server refuses a run with no operator token", async () => {
  const res = mockRes();
  await liveHandler()(postRun({ mode: "live", confirmSlotId: scenario.slot.id }), res);
  assert.equal(res.statusCode, 401);
});

test("a live server refuses a wrong operator token", async () => {
  const res = mockRes();
  await liveHandler()(
    postRun({ mode: "live", confirmSlotId: scenario.slot.id }, { authorization: "Bearer wrong-token-here" }),
    res,
  );
  assert.equal(res.statusCode, 401);
});

test("a direct network client with a valid slot id still cannot start a live run", async () => {
  // The scenario in question: something that can reach the port, knows the slot id, and sends a
  // perfectly-formed same-origin POST. Header checks describe where a browser request came from;
  // they cannot establish that an operator sent it.
  const res = mockRes();
  await liveHandler()(
    postRun({ mode: "live", confirmSlotId: scenario.slot.id }, {
      origin: "http://localhost:8787",
      "sec-fetch-site": "same-origin",
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
});

test("a correct operator token is accepted", async () => {
  const token = "s3cret-operator-token";
  const res = mockRes();
  await liveHandler(token)(
    postRun({ mode: "live", confirmSlotId: scenario.slot.id }, { authorization: `Bearer ${token}` }),
    res,
  );
  assert.equal(res.statusCode, 200);
});

test("/api/cancel requires the operator token too", async () => {
  const res = mockRes();
  await liveHandler()(
    mockReq({ method: "POST", url: "/api/cancel", headers: { "content-type": "application/json" }, body: "{}" }),
    res,
  );
  assert.equal(res.statusCode, 401);
});

test("preview and simulate need no token, because neither can dial anyone", async () => {
  const res = mockRes();
  await build()(postRun({ mode: "preview" }), res);
  assert.equal(res.statusCode, 200);
});

test("the demo binds loopback unless told otherwise", () => {
  assert.equal(resolveHost({}), "127.0.0.1");
  assert.equal(resolveHost({ HOST: "0.0.0.0" }), "0.0.0.0", "widening must be possible, but deliberate");
});

test("live mode cannot start without a token, even if none was configured", () => {
  assert.equal(resolveOperatorToken({}, false), null, "preview dials nobody, so needs no token");
  assert.equal(resolveOperatorToken({}, true, () => "generated"), "generated");
  assert.equal(resolveOperatorToken({ CALLE_OPERATOR_TOKEN: "pinned" }, true), "pinned");
  // An empty variable must not read as "no authentication wanted".
  assert.equal(resolveOperatorToken({ CALLE_OPERATOR_TOKEN: "" }, true, () => "generated"), "generated");
});

test("token comparison is length-safe and constant-time in shape", () => {
  assert.equal(tokensMatch("abc", "abc"), true);
  assert.equal(tokensMatch("abc", "abd"), false);
  assert.equal(tokensMatch("abc", "abcd"), false);
  assert.equal(tokensMatch("", ""), true);
  assert.equal(tokensMatch(null, "abc"), false);
  assert.equal(tokensMatch("abc", undefined), false);
});

/* ---------------------------------------------------------------------------
   What the endpoints disclose
   --------------------------------------------------------------------------- */

test("a live server withholds the slot id from /api/scenario", async () => {
  const res = mockRes();
  await liveHandler()(mockReq({ url: "/api/scenario" }), res);
  const body = res.json();
  assert.equal(body.slot.id, undefined, "the id a live confirmation must echo is not public");
  assert.equal(body.slotIdWithheld, true);
  assert.equal(body.operatorTokenRequired, true);
  assert.ok(!res.body.includes(scenario.slot.id));
});

test("a non-live server still shows the slot id, since nothing can be dialled", async () => {
  const res = mockRes();
  await build()(mockReq({ url: "/api/scenario" }), res);
  assert.equal(res.json().slot.id, scenario.slot.id);
  assert.equal(res.json().operatorTokenRequired, false);
});

test("/api/scenario never sends a raw waitlist number", async () => {
  const res = mockRes();
  await build()(mockReq({ url: "/api/scenario" }), res);
  for (const c of scenario.waitlist) {
    assert.ok(!res.body.includes(c.phone), `raw number for ${c.id} was sent to the client`);
  }
  assert.ok(res.json().waitlist.every((c) => c.phone === undefined));
  assert.ok(res.json().waitlist.every((c) => typeof c.phoneMasked === "string"));
});

/* ---------------------------------------------------------------------------
   Cross-site protections
   --------------------------------------------------------------------------- */

test("/api/run refuses GET: starting calls is not a safe method", async () => {
  const res = mockRes();
  await build()(mockReq({ url: `/api/run?mode=live&confirmSlotId=${scenario.slot.id}` }), res);
  assert.equal(res.statusCode, 405);
});

test("/api/run refuses a cross-origin POST", async () => {
  const res = mockRes();
  await build()(postRun({ mode: "live" }, { origin: "https://evil.example" }), res);
  assert.equal(res.statusCode, 403);
});

test("/api/run refuses a cross-site fetch even without an Origin header", async () => {
  const res = mockRes();
  await build()(postRun({ mode: "live" }, { "sec-fetch-site": "cross-site" }), res);
  assert.equal(res.statusCode, 403);
});

test("/api/run refuses a form content type, which is what a silent CSRF post would use", async () => {
  const res = mockRes();
  await build()(
    mockReq({
      method: "POST",
      url: "/api/run",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "mode=live",
    }),
    res,
  );
  assert.equal(res.statusCode, 415);
});

test("/api/cancel is equally protected against cross-site use", async () => {
  const get = mockRes();
  await build()(mockReq({ url: "/api/cancel" }), get);
  assert.equal(get.statusCode, 405);

  const cross = mockRes();
  await build()(
    mockReq({
      method: "POST",
      url: "/api/cancel",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    }),
    cross,
  );
  assert.equal(cross.statusCode, 403);
});

/* ---------------------------------------------------------------------------
   The deterministic simulated run
   --------------------------------------------------------------------------- */

test("a simulated run is deterministic whatever the wall clock says", async () => {
  const res = mockRes();
  await build()(postRun({ mode: "live", confirmSlotId: scenario.slot.id }), res);
  const events = res.events();

  const filled = events.find((e) => e.type === "slot_filled");
  assert.ok(filled, "the scripted acceptance must happen regardless of the time of day");
  assert.equal(filled.contactId, "c_oyelaran");
  assert.deepEqual(
    events.filter((e) => e.type === "contact_suppressed").map((e) => e.contactId),
    ["c_raman"],
  );

  const finished = events.find((e) => e.type === "run_finished");
  assert.equal(finished.summary.filled, true);
  assert.equal(finished.summary.callsPlaced, 2);
  assert.equal(events[0].transport, "fake");
});
