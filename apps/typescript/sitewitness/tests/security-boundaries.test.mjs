import assert from "node:assert/strict";
import test from "node:test";
import {
  database,
  env,
  invoke,
  authorizedRequest,
} from "./helpers/route-runtime.mjs";
import { requirePrivateAccess } from "../app/lib/private-access.ts";
import {
  redactOutput,
  redactText,
  publicProviderError,
} from "../app/lib/output-privacy.ts";
import { resolvePrivateQuote } from "../app/lib/private-quote.ts";
import { citeQuote, extractTranscript } from "../app/lib/evidence.ts";
import {
  CalleCallsProvider,
  CalleGoalRunProvider,
  FAKE_PUBLISHED_GOAL,
} from "../app/lib/call-provider.ts";
import { demoFixture } from "../app/lib/demo-fixtures.ts";
import { INTERVIEW_ID } from "../app/lib/case-file.ts";
const routes = Object.fromEntries(
  await Promise.all(
    [
      "calle",
      "case-evidence",
      "case-file",
      "case-coverage",
      "demo-session",
      "workflow",
      "human-interview",
      "respondent",
    ].map(async (name) => [name, await import(`../app/api/${name}/route.ts`)]),
  ),
);
const credentials = {
  SITEWITNESS_BASIC_USER: "test-reviewer",
  SITEWITNESS_BASIC_PASSWORD: "test-password-not-a-real-secret",
};
const key = "test-only-private-api-key";
const phone = "+12025550123";
const quote = `I worked there in 1992 and 1993. My number is ${phone}.`;
const base = {
  interview_id: INTERVIEW_ID,
  authorization_version: 1,
  site_key: "dry_cleaner",
  selected_channel: "automated_callback",
  automated_call_allowed: true,
  transcription_allowed: true,
};
const get = async (name, request = authorizedRequest()) =>
  (await routes[name].GET(request)).json();
const launchRequest = {
  goalId: "goal-test",
  interviewId: "interview-test",
  authorizationVersion: 1,
  phone,
  variables: {},
  task: "Test interview",
};

test("credentials are rejected before any request for every unapproved provider base", () => {
  let requests = 0;
  for (const Provider of [CalleCallsProvider, CalleGoalRunProvider])
    for (const url of [
      "http://api.heycall-e.com",
      "https://evil.invalid",
      "https://api.heycall-e.com.evil.invalid",
      "https://api.heycall-e.com:8443",
      "https://user:pass@api.heycall-e.com",
      "https://api.heycall-e.com/api",
      "https://api.heycall-e.com?next=evil",
      "https://api.heycall-e.com#fragment",
      "//api.heycall-e.com",
    ])
      assert.throws(
        () =>
          new Provider(key, url, async () => {
            requests++;
            throw new Error("never");
          }),
        /approved HTTPS/,
      );
  assert.equal(requests, 0);
});

test("every credentialed operation uses an approved origin and disables redirects", async () => {
  const calls = [];
  const providerFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/events"))
      return Response.json({ data: [], next_cursor: null });
    if (url.endsWith("/v1/goals/goal-test"))
      return Response.json({
        id: "goal-test",
        status: "active",
        published_run_spec: {
          id: "spec",
          version: 1,
          input_schema: FAKE_PUBLISHED_GOAL.inputSchema,
          result_schema: FAKE_PUBLISHED_GOAL.resultSchema,
        },
      });
    return Response.json({ id: "call-test", status: "queued", recipients: [] });
  };
  const direct = new CalleCallsProvider(key, undefined, providerFetch),
    goal = new CalleGoalRunProvider(key, undefined, providerFetch);
  await direct.create(launchRequest);
  await direct.get("", "call-test");
  await goal.getGoal("goal-test");
  await goal.create(launchRequest);
  await goal.get("goal-test", "call-test");
  assert.equal(calls.length, 6);
  for (const { url, init } of calls) {
    assert.equal(new URL(url).origin, "https://api.heycall-e.com");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, `Bearer ${key}`);
  }
});

test("cross-origin, same-origin, and HTTP redirects never issue a second request", async () => {
  for (const location of [
    "https://evil.invalid/steal",
    "http://api.heycall-e.com/v1/calls",
    "https://api.heycall-e.com/other",
  ]) {
    let count = 0;
    const transport = async () => {
      count++;
      return new Response(null, { status: 307, headers: { location } });
    };
    await assert.rejects(
      new CalleCallsProvider(key, undefined, transport).create(launchRequest),
      /redirects/,
    );
    await assert.rejects(
      new CalleGoalRunProvider(key, undefined, transport).getGoal("goal-test"),
      /redirects/,
    );
    assert.equal(count, 2);
  }
  const foreign = Response.json({ id: "leaked" });
  Object.defineProperty(foreign, "url", { value: "https://evil.invalid" });
  await assert.rejects(
    new CalleCallsProvider(key, undefined, async () => foreign).create(
      launchRequest,
    ),
    /redirects/,
  );
});

test("provider HTTP failures, terminal errors and transport exceptions never echo provider secrets", async () => {
  const detail = `Rejected phone ${phone}, token ${key}`;
  for (const Provider of [CalleCallsProvider, CalleGoalRunProvider]) {
    const p = new Provider(key, undefined, async () =>
      Response.json(
        { error: { code: detail, message: detail } },
        { status: 401 },
      ),
    );
    await assert.rejects(
      p.create(launchRequest),
      (e) =>
        e.status === 401 &&
        !e.message.includes(key) &&
        !e.message.includes(phone) &&
        e.code === "HTTP_401",
    );
  }
  const p = new CalleCallsProvider(key, undefined, async () =>
    Response.json({
      id: "call",
      status: "failed",
      failure_message: detail,
      failure_code: detail,
    }),
  );
  assert.deepEqual(
    (await p.get("", "call")).error,
    publicProviderError({ code: "call_failed" }),
  );
  const g = new CalleGoalRunProvider(key, undefined, async () =>
    Response.json({
      id: "goal",
      status: "failed",
      error: { code: detail, message: detail },
    }),
  );
  assert.doesNotMatch(
    JSON.stringify((await g.get("", "goal")).error),
    /12025550123|test-only-private-api-key/,
  );
  const network = new CalleCallsProvider(key, undefined, async () => {
    throw new Error(detail);
  });
  await assert.rejects(
    network.create(launchRequest),
    (e) => !e.message.includes(key) && !e.message.includes(phone),
  );
});

test("local bypass requires development, loopback, no forwarding and same-origin browser use", async () => {
  assert.equal(
    await requirePrivateAccess(
      new Request("http://127.0.0.1:3000/api/calle"),
      {},
      true,
    ),
    null,
  );
  assert.equal(
    await requirePrivateAccess(
      new Request("http://127.0.0.1:3148/api/calle", {
        headers: {
          "x-forwarded-host": "127.0.0.1:3148",
          "cf-connecting-ip": "127.0.0.1",
        },
      }),
      {},
      true,
    ),
    null,
  );
  for (const [url, headers, dev] of [
    ["http://127.0.0.1/api/calle", {}, false],
    [
      "https://public.example/api/calle",
      { "x-demo-role": "coordinator" },
      true,
    ],
    [
      "http://localhost/api/calle",
      { "x-forwarded-host": "evil.example" },
      true,
    ],
    ["http://localhost/api/calle", { forwarded: "for=127.0.0.1" }, true],
    [
      "http://localhost/api/calle",
      { "cf-connecting-ip": "198.51.100.1" },
      true,
    ],
    ["http://localhost/api/calle", { host: "evil.example" }, true],
    ["http://localhost/api/calle", { origin: "https://evil.example" }, true],
    ["http://localhost/api/calle", { "sec-fetch-site": "cross-site" }, true],
  ])
    assert.equal(
      (await requirePrivateAccess(new Request(url, { headers }), {}, dev))
        .status,
      403,
    );
});

test("all private routes reject forged demo roles before database or provider access, even in fake mode", async () => {
  const previousDb = env.DB;
  env.DB = undefined;
  Object.assign(env, credentials);
  env.CALL_PROVIDER = "fake";
  try {
    for (const route of Object.values(routes))
      for (const verb of ["GET", "POST"])
        if (route[verb]) {
          const result = await route[verb](
            new Request("https://public.example/api?archive=1", {
              method: verb,
              headers: { "x-demo-role": "demo_admin" },
            }),
          );
          assert.equal(result.status, 401);
          assert.match(result.headers.get("www-authenticate"), /Basic/);
          assert.equal(result.headers.get("cache-control"), "no-store");
        }
  } finally {
    env.DB = previousDb;
  }
});

test("Basic access requires complete credentials, HTTPS, correct password and same-origin requests", async () => {
  assert.equal(
    await requirePrivateAccess(authorizedRequest(), credentials, false),
    null,
  );
  const navigation = authorizedRequest("https://public.example/", {
    headers: {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  });
  assert.equal(
    await requirePrivateAccess(navigation, credentials, false, true),
    null,
  );
  assert.equal(
    (await requirePrivateAccess(navigation, credentials, false)).status,
    403,
  );
  assert.equal(
    (
      await requirePrivateAccess(
        new Request("https://public.example"),
        credentials,
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await requirePrivateAccess(
        new Request("http://localhost", {
          headers: {
            authorization:
              "Basic " +
              Buffer.from(
                "test-reviewer:test-password-not-a-real-secret",
              ).toString("base64"),
          },
        }),
        credentials,
        true,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await requirePrivateAccess(
        authorizedRequest(),
        { SITEWITNESS_BASIC_USER: "test" },
        true,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await requirePrivateAccess(
        authorizedRequest(),
        { ...credentials, SITEWITNESS_BASIC_PASSWORD: "short" },
        false,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await requirePrivateAccess(
        authorizedRequest("https://public.example", {
          headers: {
            authorization:
              "Basic " + Buffer.from("wrong:wrong").toString("base64"),
          },
        }),
        credentials,
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await requirePrivateAccess(
        authorizedRequest("https://public.example", {
          headers: { origin: "https://evil.example" },
        }),
        credentials,
        false,
      )
    ).status,
    403,
  );
});

test("phone masking covers free text, nested JSON, international numbers and exports without losing years or identifiers", () => {
  for (const number of [
    phone,
    "(202) 555-0123",
    "202.555.0123",
    "+44 20 7946 0958",
    "020 7946 0958 ext. 123",
    "555-0123",
    "+1 (202) 555-0123",
    "202–555–0123",
    "+1‑202‑555‑0123",
    "＋１２０２５５５０１２３",
    "202/555/0123",
    "tel:%2B12025550123",
  ])
    assert.equal(
      redactText(`Call ${number}.`),
      "Call [phone redacted].",
      number,
    );
  for (const stable of [
    "1987–1994",
    "1987-1994",
    "1992 and 1993",
    "2026-09-14T00:52:14.123Z",
    "12345678-abcd-1234-abcd-123456789012",
    "CALL-EVIDENCE-14",
  ])
    assert.equal(redactText(stable), stable);
  assert.equal(
    redactText("I worked 1987 - 1994. 202-555-0123 is my number."),
    "I worked 1987 - 1994. [phone redacted] is my number.",
  );
  const result = redactOutput(
    {
      detail: JSON.stringify({ phone, notes: `call ${phone}` }),
      nested: [{ quote, token: key }],
      phone: 12025550123,
    },
    [key],
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /12025550123|test-only-private-api-key/,
  );
  assert.match(result.nested[0].quote, /1992 and 1993/);
  assert.doesNotMatch(
    redactText(JSON.stringify({ new_review_note: `Phone ${phone}` })),
    /12025550123/,
  );
  assert.doesNotMatch(redactText(`# Review\nCall ${phone}`), /12025550123/);
});

test("redaction collisions never establish private evidence matches", () => {
  const turns = extractTranscript(
    {
      recipients: [
        {
          attempts: [
            {
              transcript_turns: [
                { speaker: "user", text: quote },
                { speaker: "user", text: quote.replace(phone, "+12025550124") },
              ],
            },
          ],
        },
      ],
    },
    1,
  );
  assert.equal(citeQuote(quote, turns).status, "matched");
  assert.equal(
    citeQuote(quote.replace(phone, "+12025550125"), turns).status,
    "unmatched",
  );
  const display = redactText(quote);
  assert.equal(resolvePrivateQuote(display, turns), null);
  assert.equal(resolvePrivateQuote(display, turns, turns[0].id), quote);
  assert.equal(resolvePrivateQuote(display, turns, "invented"), null);
});

test("redacted evidence remains reviewable, coverage survives reload and history/errors remain private", async () => {
  const db = database();
  Object.assign(env, credentials, {
    CALL_PROVIDER: "calle_calls",
    LIVE_CALLS_ENABLED: "true",
    CALLE_API_KEY: key,
  });
  await get("workflow");
  const person = (await get("case-file")).contacts[0];
  const saved = await invoke(routes["case-file"], {
    action: "save_contact",
    ...person,
    phone,
    phoneSource: `Call ${phone}`,
    permissionNote: `Consent for ${phone}`,
    automatedAllowed: true,
    transcriptionAllowed: true,
    permissionReconfirmed: true,
  });
  assert.equal(saved.status, 200);
  const contact = saved.data.contacts[0];
  assert.doesNotMatch(JSON.stringify(saved.data), /12025550123/);
  const prepared = await invoke(routes.calle, {
    ...base,
    action: "prepare",
    contact_id: contact.id,
    contact_version: contact.version,
    scenario: "direct",
  });
  assert.equal(prepared.status, 200);
  const fixture = demoFixture("direct");
  const oldQuote = fixture.result.knowledge_period.quote;
  // Modify only a synthetic fixture; no real provider request is made.
  const data = JSON.parse(JSON.stringify(fixture).split(oldQuote).join(quote));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    Response.json(
      init?.method === "POST"
        ? { id: "private-test-call", status: "queued" }
        : {
            ...data.raw,
            id: "private-test-call",
            status: "completed",
            structured_result: data.result,
          },
    );
  try {
    const started = await invoke(routes.calle, {
      ...base,
      action: "launch",
      contact_id: contact.id,
      contact_version: contact.version,
      authorization_version: prepared.data.authorization_version,
      preview_fingerprint: prepared.data.variables_fingerprint,
      preview_confirmed: true,
      live_confirmation: "PLACE LIVE CALL",
    });
    assert.equal(started.status, 200);
    const runId = started.data.run_id;
    assert.equal(
      (await invoke(routes.calle, { action: "poll", run_id: String(runId) }))
        .status,
      200,
    );
    const evidence = await get("case-evidence");
    const run = evidence.runs[0];
    assert.equal(run.knowledgeCitation.status, "matched");
    assert.match(run.evidence.knowledge_quote, /\[phone redacted\]/);
    for (const name of [
      "case-evidence",
      "workflow",
      "case-file",
      "calle",
      "demo-session",
    ]) {
      const response = await routes[name].GET(authorizedRequest());
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(
        await response.text(),
        /12025550123|test-only-private-api-key/,
      );
    }
    const claim = evidence.statements.find(
      (item) =>
        item.citation.status === "matched" &&
        item.evidence.includes("[phone redacted]"),
    );
    assert.ok(claim);
    assert.equal(
      (
        await invoke(
          routes.workflow,
          {
            action: "review",
            statement_id: claim.id,
            status: "accepted",
            expected_revision: claim.revision,
          },
          "reviewer",
        )
      ).status,
      201,
    );
    const edited = await invoke(
      routes.workflow,
      {
        action: "edit",
        statement_id: claim.id,
        expected_revision: claim.revision,
        fact: claim.fact,
        evidence_quote: claim.evidence,
        note: "Retained the original statement quotation.",
      },
      "reviewer",
    );
    assert.equal(edited.status, 201);
    const years = await invoke(
      routes["case-coverage"],
      {
        runId,
        quote: run.suggestedCoverage.quote,
        sourceTurnId: run.suggestedCoverage.sourceTurnId,
        years: [1992, 1993],
        reviewed: true,
      },
      "reviewer",
    );
    assert.equal(years.status, 200, JSON.stringify(years.data));
    assert.deepEqual((await get("case-evidence")).coverage.years, [1992, 1993]);
    const privateRecord = db.sqlite
      .prepare(
        "SELECT detail FROM audit_events WHERE event_type='CASE_YEARS_CONFIRMED'",
      )
      .get();
    assert.equal(JSON.parse(privateRecord.detail).quote, quote);
    const next = await invoke(routes.calle, {
      ...base,
      action: "prepare",
      contact_id: contact.id,
      contact_version: contact.version,
    });
    assert.equal(next.status, 200);
    assert.doesNotMatch(JSON.stringify(next.data), /12025550123/);
    db.sqlite
      .prepare("UPDATE call_runs SET status=?,goal_error=? WHERE id=?")
      .run(
        `OLD-PROVIDER-TOKEN ${key.toUpperCase()} ${phone}`,
        JSON.stringify({
          code: `secret ${key}`,
          message: `Phone ${phone} old-provider-token`,
        }),
        runId,
      );
    const terminal = await invoke(routes.calle, {
      action: "poll",
      run_id: String(runId),
    });
    assert.doesNotMatch(
      JSON.stringify(terminal.data),
      /old-provider-token|12025550123|test-only-private-api-key/i,
    );
    const current = (await get("demo-session")).session;
    assert.equal(
      (
        await invoke(routes["demo-session"], {
          action: "start_new_demo",
          expectedCaseId: current.caseId,
        })
      ).status,
      200,
    );
    env.CALL_PROVIDER = "fake";
    env.LIVE_CALLS_ENABLED = "false";
    const history = await get(
      "case-evidence",
      authorizedRequest(
        `https://demo.test/api/case-evidence?archive=1&case=${current.caseId}`,
      ),
    );
    assert.equal(history.runs[0].error.code, "call_failed");
    assert.doesNotMatch(
      JSON.stringify(history),
      /old-provider-token|12025550123|test-only-private-api-key/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    env.CALL_PROVIDER = "fake";
    env.LIVE_CALLS_ENABLED = "false";
    delete env.CALLE_API_KEY;
  }
});
