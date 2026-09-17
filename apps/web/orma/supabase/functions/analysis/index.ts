/**
 * T7.3 computes and delivers the weekly pattern report.
 *
 * A scheduler invokes this function weekly. For every profile it derives the
 * last seven local days ending yesterday in that profile timezone, computes
 * the facts through the `compute_pattern_facts` RPC, phrases them with the
 * T7.2 prose stage, stores one `pattern_reports` row, and delivers the same
 * validated prose through Telegram and email. Each channel honours its own
 * toggle inside its helper. One broken profile never stops the next.
 *
 * `ORMA_API_URL` is the only Supabase origin used here, since the project
 * host does not resolve on every supported network.
 *
 * The scheduler authenticates with the Vault-backed named secret API key
 * that T2.1 established for its nightly cron. `secret:materialise` validates
 * that same named key here, so no second credential path exists.
 *
 * Pin with:
 * deno test --allow-read --allow-env supabase/functions/analysis/index.ts
 */

import { withSupabase } from "npm:@supabase/server@1.6.0";
import { deliverPatternTelegram } from "../_shared/deliver-telegram.ts";
import { deliverPatternEmail } from "../_shared/deliver-email.ts";
import { testServiceAccountJson } from "../_shared/vertex.ts";
import { generatePatternProse, patternProseDepsFromEnv, type PatternProseDeps } from "./prose.ts";

export type AnalysisProfile = {
  id: string;
  timezone: string;
};

/** The facts object the `compute_pattern_facts` RPC returns. */
export type PatternFacts = {
  sufficient_history?: unknown;
} & Record<string, unknown>;

export type AnalysisDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  botToken: string;
  resendApiKey: string;
  resendFrom: string;
  /** Shared Vertex credentials for the T7.2 prose stage. */
  vertex: PatternProseDeps;
  fetch: typeof fetch;
  now: () => Date;
};

export type AnalysisOutcome =
  | { userId: string; status: "stored"; deliveryErrors?: string[] }
  | { userId: string; status: "skipped"; reason: "insufficient_history" }
  | { userId: string; status: "failed"; error: string };

export type AnalysisResult = {
  profiles: number;
  stored: number;
  skipped: number;
  failed: number;
  outcomes: AnalysisOutcome[];
};

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export function analysisDepsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): AnalysisDeps {
  return {
    apiUrl: requireNamedEnv("ORMA_API_URL", getEnv),
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    botToken: requireNamedEnv("TELEGRAM_BOT_TOKEN", getEnv),
    resendApiKey: requireNamedEnv("RESEND_API_KEY", getEnv),
    resendFrom: requireNamedEnv("RESEND_FROM", getEnv),
    vertex: patternProseDepsFromEnv(getEnv, fetchImpl),
    fetch: fetchImpl,
    now: () => new Date(),
  };
}

/** Renders a UTC calendar date as an ISO date without touching a zone. */
function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The local calendar date of an instant in a zone. */
export function localDateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * The report window is the last seven local days ending yesterday. Today is
 * still in progress, so the window stops at the last complete local day.
 */
export function reportWindow(
  now: Date,
  timeZone: string,
): { periodStart: string; periodEnd: string } {
  const periodEnd = shiftIsoDate(localDateInZone(now, timeZone), -1);
  return { periodStart: shiftIsoDate(periodEnd, -6), periodEnd };
}

function serviceHeaders(key: string, prefer?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

function restUrl(base: string, path: string, query = ""): string {
  return `${base.replace(/\/+$/, "")}/rest/v1/${path}${query ? `?${query}` : ""}`;
}

async function readProfiles(deps: AnalysisDeps): Promise<AnalysisProfile[]> {
  if (deps.apiUrl.includes("supabase.co")) {
    throw new Error("must not use the project host");
  }
  const response = await deps.fetch(restUrl(deps.apiUrl, "profiles?select=id,timezone"), {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("profiles read failed");
  return await response.json() as AnalysisProfile[];
}

function assertFacts(value: unknown): PatternFacts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("compute_pattern_facts returned no facts object");
  }
  return value as PatternFacts;
}

async function computeFacts(
  deps: AnalysisDeps,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PatternFacts> {
  const response = await deps.fetch(restUrl(deps.apiUrl, "rpc/compute_pattern_facts"), {
    method: "POST",
    headers: serviceHeaders(deps.serviceRoleKey),
    body: JSON.stringify({
      p_user_id: userId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    }),
  });
  if (!response.ok) throw new Error("compute_pattern_facts failed");
  return assertFacts(await response.json());
}

async function insertReport(
  deps: AnalysisDeps,
  input: {
    userId: string;
    periodStart: string;
    periodEnd: string;
    facts: PatternFacts;
    prose: string;
  },
): Promise<string> {
  const response = await deps.fetch(restUrl(deps.apiUrl, "pattern_reports"), {
    method: "POST",
    headers: serviceHeaders(deps.serviceRoleKey, "return=representation"),
    body: JSON.stringify({
      user_id: input.userId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      facts: input.facts,
      prose: input.prose,
    }),
  });
  if (!response.ok) throw new Error("pattern_reports insert failed");
  const rows = (await response.json()) as Array<{ id: string }>;
  if (rows.length !== 1) throw new Error("pattern_reports insert must return one row");
  return rows[0].id;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "analysis failed";
}

/**
 * One profile's report, isolated from the rest. A failure anywhere before the
 * report row is stored marks the profile failed. A channel failure after the
 * row is stored keeps the report and names the channel instead.
 */
async function analyzeProfile(deps: AnalysisDeps, profile: AnalysisProfile): Promise<AnalysisOutcome> {
  try {
    const { periodStart, periodEnd } = reportWindow(deps.now(), profile.timezone);
    const facts = await computeFacts(deps, profile.id, periodStart, periodEnd);
    if (facts.sufficient_history !== true) {
      return { userId: profile.id, status: "skipped", reason: "insufficient_history" };
    }
    const prose = await generatePatternProse(facts, deps.vertex);
    await insertReport(deps, { userId: profile.id, periodStart, periodEnd, facts, prose });

    // The channel helpers each read their own toggle, so a switched-off
    // channel reports skipped inside the helper and costs no deliveries row.
    const deliveryErrors: string[] = [];
    try {
      const telegram = await deliverPatternTelegram(
        { userId: profile.id, prose },
        {
          apiUrl: deps.apiUrl,
          serviceRoleKey: deps.serviceRoleKey,
          botToken: deps.botToken,
          fetch: deps.fetch,
        },
      );
      if (telegram.status === "failed") deliveryErrors.push(`telegram: ${telegram.error}`);
    } catch (error) {
      deliveryErrors.push(`telegram: ${errorMessage(error)}`);
    }
    try {
      const email = await deliverPatternEmail(
        { userId: profile.id, prose },
        {
          apiUrl: deps.apiUrl,
          serviceRoleKey: deps.serviceRoleKey,
          resendApiKey: deps.resendApiKey,
          resendFrom: deps.resendFrom,
          fetch: deps.fetch,
        },
      );
      if (email.status === "failed") deliveryErrors.push(`email: ${email.error}`);
    } catch (error) {
      deliveryErrors.push(`email: ${errorMessage(error)}`);
    }
    return deliveryErrors.length === 0
      ? { userId: profile.id, status: "stored" }
      : { userId: profile.id, status: "stored", deliveryErrors };
  } catch (error) {
    return { userId: profile.id, status: "failed", error: errorMessage(error) };
  }
}

/** Runs the weekly analysis for every profile. */
export async function analyze(deps: AnalysisDeps): Promise<AnalysisResult> {
  const profiles = await readProfiles(deps);
  const outcomes: AnalysisOutcome[] = [];
  for (const profile of profiles) {
    outcomes.push(await analyzeProfile(deps, profile));
  }
  return {
    profiles: profiles.length,
    stored: outcomes.filter((outcome) => outcome.status === "stored").length,
    skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    outcomes,
  };
}

export function createAnalysisHandler(
  deps: AnalysisDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    try {
      return Response.json(await analyze(deps));
    } catch (error) {
      console.error("analysis failed", error instanceof Error ? error.message : "unknown error");
      return new Response(null, { status: 500 });
    }
  };
}

export function createAuthenticatedAnalysisHandler(
  deps: AnalysisDeps,
): (request: Request) => Promise<Response> {
  // The weekly cron posts the same Vault-backed scheduler credential as the
  // T2.1 nightly materialise. The named secret is the API key that
  // @supabase/server validates here, so no second credential path exists.
  return withSupabase({ auth: "secret:materialise" }, createAnalysisHandler(deps));
}

if (import.meta.main) Deno.serve(createAuthenticatedAnalysisHandler(analysisDepsFromEnv()));

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const kolkata = {
    id: "00000000-0000-4000-8000-0000000000c1",
    timezone: "Asia/Kolkata",
    telegram_chat_id: 424242 as number | null,
    telegram_receipts: true,
    email_receipts: true,
  };
  const newYork = {
    id: "00000000-0000-4000-8000-0000000000c2",
    timezone: "America/New_York",
    telegram_chat_id: 424242 as number | null,
    telegram_receipts: true,
    email_receipts: true,
  };

  // The account email lives in Supabase Auth, never in the profiles table.
  const authEmails: Record<string, string> = {
    [kolkata.id]: "kolkata@example.com",
    [newYork.id]: "newyork@example.com",
  };

  const sufficientFacts = {
    period_start: "2026-09-07",
    period_end: "2026-09-13",
    period_days: 7,
    observed_days: 7,
    completed_runs: 5,
    answered_runs: 4,
    required_days: 3,
    sufficient_history: true,
    mentions: [{ item_id: "i1", text: "the dentist", mention_count: 3 }],
    ages: [],
    retirements: {
      retired_count: 1,
      avg_days_open: 4,
      items: [{ item_id: "i2", text: "physio", days_open: 4 }],
    },
    longest_surviving: [],
    answer_rate_by_slot: [{
      slot_id: "s1",
      part_of_day: "morning",
      local_time: "08:00",
      scheduled: 7,
      answered: 4,
      answer_rate: 0.57,
    }],
    mood_distribution: [{ mood: "focused", count: 2 }],
  };

  // Every numeral here is a value of the facts object above.
  const validProse = "The dentist came up 3 times across 7 observed days.";

  type RestDeliveryRow = {
    id: string;
    user_id: string;
    channel: string;
    kind: string;
    call_run_id: string | null;
    payload: Record<string, unknown>;
    sent_at: string | null;
    error: string | null;
  };

  type FullProfile = typeof kolkata;

  type MockState = {
    profiles: FullProfile[];
    deliveries: RestDeliveryRow[];
    reports: Array<Record<string, unknown>>;
    rpcBodies: Array<{ p_user_id: string; p_period_start: string; p_period_end: string }>;
    factsByUser: Record<string, unknown | "fail">;
    authUsers: Record<string, string | null>;
    telegramCalls: Array<{ url: string; body: string }>;
    resendCalls: Array<{ url: string; body: string }>;
    seenUrls: string[];
    calls: string[];
    telegramOk: boolean;
    resendOk: boolean;
  };

  function project(row: FullProfile, select: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const column of select.split(",").map((c) => c.trim())) {
      if (column !== "") out[column] = (row as unknown as Record<string, unknown>)[column];
    }
    return out;
  }

  function createMockFetch(state: MockState): typeof fetch {
    return (async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : "";
      state.seenUrls.push(url);
      if (url.includes("supabase.co")) throw new Error("must not use the project host");
      if (url.includes("/rest/v1/profiles") && method === "GET") {
        state.calls.push("profiles");
        const params = new URL(url).searchParams;
        const idParam = params.get("id");
        let rows = state.profiles;
        if (idParam !== null) {
          const id = idParam.replace(/^eq\./, "");
          rows = rows.filter((profile) => profile.id === id);
        }
        const select = params.get("select") ?? "id,timezone";
        return new Response(
          JSON.stringify(rows.map((row) => project(row, select))),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/rest/v1/rpc/compute_pattern_facts") && method === "POST") {
        state.calls.push("rpc");
        const posted = JSON.parse(body) as {
          p_user_id: string;
          p_period_start: string;
          p_period_end: string;
        };
        state.rpcBodies.push(posted);
        const facts = state.factsByUser[posted.p_user_id];
        if (facts === "fail" || facts === undefined) return new Response("rpc failed", { status: 500 });
        return new Response(JSON.stringify(facts), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/rest/v1/pattern_reports") && method === "POST") {
        state.calls.push("reports");
        const posted = JSON.parse(body) as Record<string, unknown>;
        state.reports.push(posted);
        return new Response(
          JSON.stringify([{ id: `report-${state.reports.length}` }]),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/rest/v1/deliveries") && method === "POST") {
        state.calls.push("deliveries-insert");
        const posted = JSON.parse(body) as RestDeliveryRow;
        const row: RestDeliveryRow = {
          id: posted.id,
          user_id: posted.user_id,
          channel: posted.channel,
          kind: posted.kind,
          call_run_id: posted.call_run_id,
          payload: posted.payload,
          sent_at: null,
          error: null,
        };
        state.deliveries.push(row);
        return new Response(JSON.stringify([row]), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/rest/v1/deliveries") && method === "PATCH") {
        state.calls.push("deliveries-patch");
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
        const patch = JSON.parse(body) as {
          sent_at?: string | null;
          error?: string | null;
          payload?: Record<string, unknown>;
        };
        const row = state.deliveries.find((d) => d.id === id);
        if (!row) return new Response("missing", { status: 404 });
        if ("sent_at" in patch) row.sent_at = patch.sent_at ?? null;
        if ("error" in patch) row.error = patch.error ?? null;
        if ("payload" in patch) row.payload = patch.payload ?? row.payload;
        return new Response(null, { status: 204 });
      }
      const adminMatch = url.match(/\/auth\/v1\/admin\/users\/([^/?]+)$/);
      if (adminMatch !== null && method === "GET") {
        state.calls.push("auth-admin");
        const id = decodeURIComponent(adminMatch[1]);
        if (!(id in state.authUsers)) return new Response("missing user", { status: 404 });
        return new Response(JSON.stringify({ id, email: state.authUsers[id] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("api.telegram.org") && url.includes("/sendMessage")) {
        state.calls.push("telegram");
        state.telegramCalls.push({ url, body });
        if (!state.telegramOk) return new Response("fail", { status: 500 });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("api.resend.com/emails") && method === "POST") {
        state.calls.push("resend");
        state.resendCalls.push({ url, body });
        if (!state.resendOk) return new Response("fail", { status: 500 });
        return new Response(JSON.stringify({ id: "re_fixture_1" }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://oauth2.googleapis.com/token" && method === "POST") {
        state.calls.push("token");
        return new Response(JSON.stringify({ access_token: "ya29.analysis-test" }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("aiplatform.googleapis.com") && method === "POST") {
        state.calls.push("vertex");
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: validProse }] } }] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    }) as typeof fetch;
  }

  async function baseDeps(state: MockState) {
    return {
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "service-role-test-value",
      botToken: "bot-token-test",
      resendApiKey: "resend-test-key",
      resendFrom: "Orma <reports@example.com>",
      vertex: {
        project: "fixture-project",
        location: "us-central1",
        model: "gemini-3.8-flash",
        credentialsJson: await testServiceAccountJson(),
        fetch: createMockFetch(state),
      },
      fetch: createMockFetch(state),
      now: () => new Date("2026-09-14T02:00:00.000Z"),
    } satisfies AnalysisDeps;
  }

  function freshState(profiles: FullProfile[], factsByUser: Record<string, unknown | "fail">): MockState {
    return {
      profiles,
      deliveries: [],
      reports: [],
      rpcBodies: [],
      factsByUser,
      authUsers: { ...authEmails },
      telegramCalls: [],
      resendCalls: [],
      seenUrls: [],
      calls: [],
      telegramOk: true,
      resendOk: true,
    };
  }

  testFn("reportWindow derives seven local days ending yesterday", () => {
    const now = new Date("2026-09-14T02:00:00.000Z");
    const kolkataWindow = reportWindow(now, "Asia/Kolkata");
    if (kolkataWindow.periodStart !== "2026-09-07" || kolkataWindow.periodEnd !== "2026-09-13") {
      throw new Error(`Kolkata window wrong: ${JSON.stringify(kolkataWindow)}`);
    }
    const newYorkWindow = reportWindow(now, "America/New_York");
    if (newYorkWindow.periodStart !== "2026-09-06" || newYorkWindow.periodEnd !== "2026-09-12") {
      throw new Error(`New York window wrong: ${JSON.stringify(newYorkWindow)}`);
    }
    // 15:00Z on the 13th is already the 14th in Auckland, so the window ends
    // on the local 13th even though the UTC date is still the 13th.
    const aucklandWindow = reportWindow(new Date("2026-09-13T15:00:00.000Z"), "Pacific/Auckland");
    if (aucklandWindow.periodStart !== "2026-09-07" || aucklandWindow.periodEnd !== "2026-09-13") {
      throw new Error(`Auckland window wrong: ${JSON.stringify(aucklandWindow)}`);
    }
  });

  testFn("each profile queries the RPC with its own timezone-derived dates", async () => {
    const state = freshState(
      [kolkata, newYork],
      { [kolkata.id]: sufficientFacts, [newYork.id]: sufficientFacts },
    );
    const result = await analyze(await baseDeps(state));
    if (result.stored !== 2 || result.failed !== 0 || result.skipped !== 0) {
      throw new Error(`expected two stored profiles, got ${JSON.stringify(result)}`);
    }
    if (state.rpcBodies.length !== 2) throw new Error("expected one RPC call per profile");
    const byUser = new Map(state.rpcBodies.map((call) => [call.p_user_id, call]));
    const kolkataRpc = byUser.get(kolkata.id);
    if (!kolkataRpc || kolkataRpc.p_period_start !== "2026-09-07" || kolkataRpc.p_period_end !== "2026-09-13") {
      throw new Error(`Kolkata RPC window wrong: ${JSON.stringify(kolkataRpc)}`);
    }
    const newYorkRpc = byUser.get(newYork.id);
    if (!newYorkRpc || newYorkRpc.p_period_start !== "2026-09-06" || newYorkRpc.p_period_end !== "2026-09-12") {
      throw new Error(`New York RPC window wrong: ${JSON.stringify(newYorkRpc)}`);
    }
  });

  testFn("insufficient history skips prose, report and delivery", async () => {
    const state = freshState([kolkata], {
      [kolkata.id]: { ...sufficientFacts, sufficient_history: false },
    });
    const result = await analyze(await baseDeps(state));
    if (result.skipped !== 1 || result.stored !== 0 || result.failed !== 0) {
      throw new Error(`expected one skipped profile, got ${JSON.stringify(result)}`);
    }
    const outcome = result.outcomes[0];
    if (outcome.status !== "skipped" || outcome.reason !== "insufficient_history") {
      throw new Error(`expected insufficient_history, got ${JSON.stringify(outcome)}`);
    }
    for (const step of ["token", "vertex", "reports", "deliveries-insert", "telegram", "resend"]) {
      if (state.calls.includes(step)) throw new Error(`${step} must not run without sufficient history`);
    }
    if (state.deliveries.length !== 0 || state.reports.length !== 0) {
      throw new Error("a skipped profile must write nothing");
    }
  });

  testFn("the report row carries the exact facts and the validated prose", async () => {
    const state = freshState([kolkata], { [kolkata.id]: sufficientFacts });
    const result = await analyze(await baseDeps(state));
    if (result.stored !== 1) throw new Error(`expected one stored profile, got ${JSON.stringify(result)}`);
    if (state.reports.length !== 1) throw new Error("expected one report row");
    const report = state.reports[0];
    if (report.user_id !== kolkata.id) throw new Error("report must name the user");
    if (report.period_start !== "2026-09-07" || report.period_end !== "2026-09-13") {
      throw new Error(`report period wrong: ${JSON.stringify(report)}`);
    }
    if (JSON.stringify(report.facts) !== JSON.stringify(sufficientFacts)) {
      throw new Error("report facts must equal the RPC response exactly");
    }
    if (report.prose !== validProse) throw new Error("report must carry the validated prose");
    const reportsIndex = state.calls.indexOf("reports");
    const telegramIndex = state.calls.indexOf("telegram");
    const resendIndex = state.calls.indexOf("resend");
    if (reportsIndex === -1 || reportsIndex > telegramIndex || reportsIndex > resendIndex) {
      throw new Error("the report row must be stored before either delivery");
    }
  });

  testFn("both channels receive the same validated prose", async () => {
    const state = freshState([kolkata], { [kolkata.id]: sufficientFacts });
    await analyze(await baseDeps(state));
    if (state.telegramCalls.length !== 1 || state.resendCalls.length !== 1) {
      throw new Error("both channels must be attempted once");
    }
    const tgText = (JSON.parse(state.telegramCalls[0].body) as { text: string }).text;
    if (!tgText.includes(validProse)) throw new Error("Telegram must carry the prose");
    const resend = JSON.parse(state.resendCalls[0].body) as { text: string };
    if (resend.text !== validProse) throw new Error("Resend must carry the prose as text");
    const telegramRow = state.deliveries.find((d) => d.channel === "telegram");
    const emailRow = state.deliveries.find((d) => d.channel === "email");
    if (!telegramRow || telegramRow.kind !== "pattern" || telegramRow.sent_at === null) {
      throw new Error("Telegram must record a sent pattern delivery");
    }
    if (!emailRow || emailRow.kind !== "pattern" || emailRow.sent_at === null) {
      throw new Error("email must record a sent pattern delivery");
    }
  });

  testFn("a switched-off Telegram toggle costs no Telegram row or send", async () => {
    const state = freshState(
      [{ ...kolkata, telegram_receipts: false }],
      { [kolkata.id]: sufficientFacts },
    );
    const result = await analyze(await baseDeps(state));
    if (result.stored !== 1) throw new Error(`expected the report stored, got ${JSON.stringify(result)}`);
    if (state.telegramCalls.length !== 0) throw new Error("a disabled Telegram channel must not send");
    if (state.deliveries.some((d) => d.channel === "telegram")) {
      throw new Error("a disabled Telegram channel must write no deliveries row");
    }
    if (state.resendCalls.length !== 1) throw new Error("email must still run");
  });

  testFn("a switched-off email toggle costs no email row or send", async () => {
    const state = freshState(
      [{ ...kolkata, email_receipts: false }],
      { [kolkata.id]: sufficientFacts },
    );
    const result = await analyze(await baseDeps(state));
    if (result.stored !== 1) throw new Error(`expected the report stored, got ${JSON.stringify(result)}`);
    if (state.resendCalls.length !== 0) throw new Error("a disabled email channel must not send");
    if (state.deliveries.some((d) => d.channel === "email")) {
      throw new Error("a disabled email channel must write no deliveries row");
    }
    if (state.telegramCalls.length !== 1) throw new Error("Telegram must still run");
  });

  testFn("a Telegram failure is recorded while the report stays stored", async () => {
    const state = freshState([kolkata], { [kolkata.id]: sufficientFacts });
    state.telegramOk = false;
    const result = await analyze(await baseDeps(state));
    if (result.stored !== 1 || result.failed !== 0) {
      throw new Error(`expected the report stored, got ${JSON.stringify(result)}`);
    }
    const outcome = result.outcomes[0];
    if (outcome.status !== "stored" || !outcome.deliveryErrors ||
      !outcome.deliveryErrors.some((e) => e.startsWith("telegram:"))) {
      throw new Error(`expected a telegram delivery error, got ${JSON.stringify(outcome)}`);
    }
    const telegramRow = state.deliveries.find((d) => d.channel === "telegram");
    if (!telegramRow || telegramRow.sent_at !== null || !telegramRow.error) {
      throw new Error("the Telegram row must record the failure");
    }
    if (state.reports.length !== 1) throw new Error("the report must stay stored");
    if (state.resendCalls.length !== 1) throw new Error("email must still be attempted");
  });

  testFn("a Resend failure is recorded while the report stays stored", async () => {
    const state = freshState([kolkata], { [kolkata.id]: sufficientFacts });
    state.resendOk = false;
    const result = await analyze(await baseDeps(state));
    if (result.stored !== 1 || result.failed !== 0) {
      throw new Error(`expected the report stored, got ${JSON.stringify(result)}`);
    }
    const outcome = result.outcomes[0];
    if (outcome.status !== "stored" || !outcome.deliveryErrors ||
      !outcome.deliveryErrors.some((e) => e.startsWith("email:"))) {
      throw new Error(`expected an email delivery error, got ${JSON.stringify(outcome)}`);
    }
    const emailRow = state.deliveries.find((d) => d.channel === "email");
    if (!emailRow || emailRow.sent_at !== null || !emailRow.error) {
      throw new Error("the email row must record the failure");
    }
    if (state.reports.length !== 1) throw new Error("the report must stay stored");
    if (state.telegramCalls.length !== 1) throw new Error("Telegram must still be attempted");
  });

  testFn("one failing profile does not block the next", async () => {
    const state = freshState(
      [kolkata, newYork],
      { [kolkata.id]: "fail", [newYork.id]: sufficientFacts },
    );
    const result = await analyze(await baseDeps(state));
    if (result.failed !== 1 || result.stored !== 1) {
      throw new Error(`expected one failed and one stored, got ${JSON.stringify(result)}`);
    }
    const failed = result.outcomes.find((o) => o.userId === kolkata.id);
    if (!failed || failed.status !== "failed" || failed.error !== "compute_pattern_facts failed") {
      throw new Error(`expected a failed outcome, got ${JSON.stringify(failed)}`);
    }
    if (state.reports.length !== 1 || state.reports[0].user_id !== newYork.id) {
      throw new Error("the healthy profile must still store its report");
    }
    if (state.telegramCalls.length !== 1 || state.resendCalls.length !== 1) {
      throw new Error("the healthy profile must still deliver");
    }
  });

  testFn("an empty profile list runs nothing", async () => {
    const state = freshState([], {});
    const result = await analyze(await baseDeps(state));
    if (result.profiles !== 0 || result.stored !== 0 || result.skipped !== 0 || result.failed !== 0) {
      throw new Error(`expected an empty result, got ${JSON.stringify(result)}`);
    }
    if (state.calls.length !== 1 || state.calls[0] !== "profiles") {
      throw new Error(`expected only the profiles read, got ${state.calls.join(",")}`);
    }
  });

  testFn("no request reaches the project host and no key leaks", async () => {
    const state = freshState([kolkata], { [kolkata.id]: sufficientFacts });
    state.telegramOk = false;
    const result = await analyze(await baseDeps(state));
    const frontDoor = "https://orma-api.nryn.dev";
    for (const url of state.seenUrls) {
      if (url.includes("supabase.co")) throw new Error("must not use the project host");
      if (url.startsWith(frontDoor) || url.includes("api.telegram.org") ||
        url.includes("api.resend.com") || url.includes("googleapis.com")) continue;
      throw new Error(`unexpected origin: ${url}`);
    }
    if (!state.seenUrls.some((url) => url.startsWith(frontDoor))) {
      throw new Error("every Supabase read must go through ORMA_API_URL");
    }
    const outcome = result.outcomes[0];
    const deliveryErrors = outcome.status === "stored" ? outcome.deliveryErrors ?? [] : [];
    const blobs = [
      ...state.reports.map((report) => JSON.stringify(report)),
      ...state.deliveries.map((row) => JSON.stringify(row.payload)),
      ...state.telegramCalls.map((call) => call.body),
      ...state.resendCalls.map((call) => call.body),
      JSON.stringify(deliveryErrors),
    ];
    for (const secret of ["service-role-test-value", "resend-test-key", "bot-token-test"]) {
      for (const blob of blobs) {
        if (blob.includes(secret)) throw new Error("a secret must never leak into a request or a row");
      }
    }
  });


  testFn("only the named materialise secret API key reaches analysis", async () => {
    const oldUrl = Deno.env.get("SUPABASE_URL");
    const oldKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    const oldPublishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    Deno.env.set("SUPABASE_URL", "https://orma-api.nryn.dev");
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ materialise: "fixture-materialise-key" }));
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "fixture-publishable-key" }));
    let reads = 0;
    const handler = createAuthenticatedAnalysisHandler({
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "test-service-key",
      botToken: "test-bot-token",
      resendApiKey: "test-resend-key",
      resendFrom: "Orma <reports@example.com>",
      vertex: {
        project: "fixture-project",
        location: "us-central1",
        model: "gemini-3.8-flash",
        credentialsJson: "{}",
        fetch,
      },
      fetch: async () => {
        reads += 1;
        return Response.json([]);
      },
      now: () => new Date("2026-09-14T02:00:00.000Z"),
    });
    try {
      const rejected = await handler(new Request("https://orma-api.nryn.dev/functions/v1/analysis", { method: "POST" }));
      if (rejected.status !== 401 || reads !== 0) throw new Error("missing secret must not reach analysis");
      const accepted = await handler(new Request("https://orma-api.nryn.dev/functions/v1/analysis", {
        method: "POST", headers: { apikey: "fixture-materialise-key" },
      }));
      if (accepted.status !== 200 || Number(reads) !== 1) {
        throw new Error("named materialise secret must authenticate the scheduler");
      }
    } finally {
      if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
      if (oldKeys === undefined) Deno.env.delete("SUPABASE_SECRET_KEYS"); else Deno.env.set("SUPABASE_SECRET_KEYS", oldKeys);
      if (oldPublishableKeys === undefined) Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS");
      else Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", oldPublishableKeys);
    }
  });
}
