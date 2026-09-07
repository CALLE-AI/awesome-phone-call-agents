/**
 * Conformance probes against the CALL-E Developer API.
 *
 * The point of this file is evidence. Every probe writes the raw response or the
 * raw error to probe-results/ so a claim about the platform can be checked later
 * against something the platform actually sent, not against a recollection.
 *
 * Probes are tiered by what they can cost:
 *
 *   tier 0  reads only. Cannot dial. Cannot spend a call.
 *   tier 1  creates calls whose recipient is deliberately unusable, so the
 *           request is expected to be rejected during validation, before any
 *           number is dialed. Expected cost is zero, and the results record
 *           whether that expectation held.
 *   tier 2  places one real call to a number you own. Costs at least one call
 *           from the free budget, more if an attempt is retried.
 *
 * Tier 2 refuses to run without an explicit flag.
 */

import { CalleClient } from "@call-e/calle";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RESULTS_DIR = "probe-results";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

/** Never a real destination. Deliberately malformed so it cannot be dialed. */
const UNDIALABLE = "+1555";
/** Reserved fictional range used by the repository's own examples. */
const FICTIONAL = "+14155550100";

type ProbeOutcome = {
  probe: string;
  issue: string | null;
  question: string;
  costedACall: "no" | "unknown" | "yes";
  observed: unknown;
  error: unknown;
};

const outcomes: ProbeOutcome[] = [];

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { raw: String(error) };
  const extra = error as Error & {
    code?: unknown;
    status?: unknown;
    details?: unknown;
  };
  return {
    name: error.name,
    message: error.message,
    code: extra.code ?? null,
    status: extra.status ?? null,
    details: extra.details ?? null,
  };
}

async function probe(
  spec: Omit<ProbeOutcome, "observed" | "error">,
  run: () => Promise<unknown>,
) {
  process.stdout.write(`\n[${spec.probe}] ${spec.question}\n`);
  try {
    const observed = await run();
    outcomes.push({ ...spec, observed, error: null });
    process.stdout.write("  resolved\n");
  } catch (error) {
    const shown = serializeError(error);
    outcomes.push({ ...spec, observed: null, error: shown });
    process.stdout.write(
      `  rejected: ${"name" in shown ? shown.name : "error"} ${"code" in shown ? shown.code ?? "" : ""} ${"status" in shown ? shown.status ?? "" : ""}\n`,
    );
  }
}

function readEnv() {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CALLE_API_KEY is not set. Copy .env.example to .env and paste the key from " +
        "https://dashboard.heycall-e.com/account/api-keys",
    );
  }
  return {
    apiKey,
    baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
    ownPhone: process.env.CALLE_OWN_PHONE ?? "",
    ownRegion: process.env.CALLE_OWN_REGION ?? "US",
    ownLocale: process.env.CALLE_OWN_LOCALE ?? "en-US",
  };
}

/* ------------------------------------------------------------------ tier 0 */

async function tier0(client: CalleClient, baseUrl: string) {
  await probe(
    {
      probe: "auth",
      issue: null,
      question: "Is the key accepted? A 404 means yes, a 401 means no.",
      costedACall: "no",
    },
    () => client.calls.get("call_probe_does_not_exist"),
  );

  await probe(
    {
      probe: "goals-available",
      issue: null,
      question:
        "Does this account reach the Goals API? The published-requirements design " +
        "depends on the answer being yes.",
      costedACall: "no",
    },
    () => client.goals.list({ limit: 1 }),
  );

  process.stdout.write(`\n  base URL in use: ${baseUrl}\n`);
}

/* ------------------------------------------------------------------ tier 1 */

const PLAIN_SCHEMA = {
  type: "object",
  required: ["answered"],
  properties: { answered: { type: "string", enum: ["yes", "no", "unknown"] } },
  additionalProperties: false,
};

/** The shape issue #120 reports as rejected. */
const NULLABLE_UNION_SCHEMA = {
  type: "object",
  required: ["answered"],
  properties: { answered: { type: ["string", "null"] } },
  additionalProperties: false,
};

/**
 * A plain, plausible goal.
 *
 * An earlier version of this file said "this must never dial" inside the task.
 * The planner read it and refused with `call_not_ready` 422, returning a
 * clarifying question rather than an error about the request. That made the task
 * text the variable under test instead of the schema or the recipient, so the
 * wording here is deliberately ordinary. Safety comes from the malformed
 * recipient, not from asking the planner nicely.
 */
const HARMLESS_TASK =
  "Ask whether the person can hear the call clearly, thank them, and end the call.";

async function tier1(client: CalleClient) {
  // Baseline. Establishes which error an unusable recipient produces, so the next
  // probe can tell a schema rejection apart from a recipient rejection.
  await probe(
    {
      probe: "baseline-undialable-recipient",
      issue: null,
      question: "What error comes back for a malformed recipient with a plain schema?",
      costedACall: "no",
    },
    () =>
      client.calls.create({
        task: HARMLESS_TASK,
        recipients: [{ phones: [UNDIALABLE], region: "US", locale: "en-US" }],
        recipientResultSchema: PLAIN_SCHEMA,
        metadata: { probe: "baseline", run: RUN_ID },
      }),
  );

  // #120. Same malformed recipient, so the only variable is the schema. A schema
  // error here rather than the baseline error means schema validation runs first
  // and the nullable union is rejected.
  await probe(
    {
      probe: "nullable-union-schema",
      issue: "#120",
      question: "Is a nullable union rejected in the result schema, and does the error say so?",
      costedACall: "no",
    },
    () =>
      client.calls.create({
        task: HARMLESS_TASK,
        recipients: [{ phones: [UNDIALABLE], region: "US", locale: "en-US" }],
        recipientResultSchema: NULLABLE_UNION_SCHEMA,
        metadata: { probe: "nullable-union", run: RUN_ID },
      }),
  );

  // The idempotency probes for #234 and #315 used to live here and were
  // inconclusive. Recipient validation rejects before the idempotency layer is
  // reached, so every variant returned the same `invalid_phone` and nothing was
  // learned about replay semantics. Testing those needs a request that is
  // actually accepted, which costs a call, so they moved to tier 2 where they
  // reuse the key of the one real call and add nothing to the bill.

  // #235. Two recipients carrying the same number.
  await probe(
    {
      probe: "duplicate-recipients",
      issue: "#235",
      question: "Do two recipients sharing one phone produce one recipient or two?",
      costedACall: "no",
    },
    () =>
      client.calls.create({
        task: HARMLESS_TASK,
        recipients: [
          { phones: [UNDIALABLE], region: "US", locale: "en-US" },
          { phones: [UNDIALABLE], region: "US", locale: "en-US" },
        ],
        recipientResultSchema: PLAIN_SCHEMA,
        metadata: { probe: "duplicate-recipients", run: RUN_ID },
      }),
  );

  // Does a well-formed reserved number reach dialing, or is it refused earlier?
  // The answer decides whether fixtures can use that range safely. This one is
  // opt-in: with an ordinary task the planner no longer refuses, so the request
  // can reach the dialing path and may spend a call.
  if (!process.argv.includes("--probe-reserved-range")) {
    process.stdout.write(
      "\n[reserved-fictional-number] skipped. Pass --probe-reserved-range to run it. " +
        "It may spend a call.\n",
    );
    return;
  }

  await probe(
    {
      probe: "reserved-fictional-number",
      issue: "#180",
      question: `Is the reserved fictional range (${FICTIONAL}) refused before dialing?`,
      costedACall: "unknown",
    },
    () =>
      client.calls.create({
        task: HARMLESS_TASK,
        recipients: [{ phones: [FICTIONAL], region: "US", locale: "en-US" }],
        recipientResultSchema: PLAIN_SCHEMA,
        metadata: { probe: "reserved-fictional", run: RUN_ID },
      }),
  );
}

/* ------------------------------------------------------------------ tier 2 */

/**
 * The spoken line is in the recipient's language, matching CALLE_OWN_LOCALE, so a
 * language mismatch cannot be confused with the agent declining to say the line.
 * Whether that exact sentence survives into the transcript is the measurement.
 */
const ATTESTATION_TASK = [
  "Habla en español.",
  "Empieza diciendo, palabra por palabra: Soy un asistente de inteligencia artificial.",
  "Después haz una sola pregunta: ¿se me escucha con claridad?",
  "Acepta la respuesta, agradece y termina la llamada. No preguntes nada más.",
].join(" ");

const ATTESTATION_SCHEMA = {
  type: "object",
  required: ["heard_clearly"],
  properties: {
    heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] },
  },
  additionalProperties: false,
};

/**
 * Region and locale candidates, tried in order.
 *
 * The configured pair is tried first. A pair the platform does not route is
 * refused at creation with `call_not_ready` and costs nothing, so walking the
 * list is cheap: only the first pair that is actually accepted places a call.
 * The refusals are themselves the finding, because the supported matrix is not
 * published anywhere.
 */
function routeCandidates(region: string, locale: string) {
  const configured = { region, locale };
  const fallbacks = [
    { region, locale: "es-419" },
    { region, locale: "es-ES" },
    { region, locale: "en-US" },
    { region: "US", locale: "es-US" },
    { region: "US", locale: "en-US" },
  ];
  return [
    configured,
    ...fallbacks.filter((r) => !(r.region === region && r.locale === locale)),
  ];
}

async function tier2(
  client: CalleClient,
  phone: string,
  region: string,
  locale: string,
) {
  let callId: string | null = null;
  let acceptedKey: string | null = null;

  // Each candidate carries its own key. Sharing one key across candidates does not
  // work, and finding that out was itself a result: a create that is rejected with
  // 422, having produced no call, still burns the key. Retrying that key with a
  // corrected payload returns `idempotency_conflict` 409. So a request refused for
  // a fixable reason cannot be retried under the key it was first sent with.
  for (const route of routeCandidates(region, locale)) {
    if (callId !== null) break;
    const routeKey = `probe-live-${RUN_ID}-${route.region}-${route.locale}`;

    await probe(
      {
        probe: `live-call[${route.region}|${route.locale}]`,
        issue: "#180",
        question:
          "Does this region and locale pair route? If it does, the call is placed and " +
          "the full raw Call object is captured so transcriptTurns, offset_seconds, " +
          "evidence and completionConfidence can be inspected against real data.",
        costedACall: "unknown",
      },
      async () => {
        const call = await client.calls.createAndWait(
          {
            task: ATTESTATION_TASK,
            recipients: [{ phones: [phone], region: route.region, locale: route.locale }],
            recipientResultSchema: ATTESTATION_SCHEMA,
            metadata: { probe: "live-call", run: RUN_ID },
          },
          { idempotencyKey: routeKey, timeoutMs: 300_000 },
        );
        callId = call.id;
        acceptedKey = routeKey;
        return call;
      },
    );
  }

  if (callId === null) {
    process.stdout.write(
      "\nNo region and locale pair was accepted for this number. No call was placed.\n",
    );
  }

  if (callId === null) return;
  const id: string = callId;
  const liveKey: string = acceptedKey ?? "";

  // #315. Replay the key that was just accepted. If the platform returns the same
  // call, nothing extra is billed, and the question is whether the response says
  // anywhere that this was a replay rather than a new call.
  await probe(
    {
      probe: "idempotency-replay-identical",
      issue: "#315",
      question:
        "Replaying the accepted key with an identical payload. Does the response " +
        "distinguish a replay from a new call?",
      costedACall: "no",
    },
    () =>
      client.calls.create(
        {
          task: ATTESTATION_TASK,
          recipients: [{ phones: [phone], region, locale }],
          recipientResultSchema: ATTESTATION_SCHEMA,
          metadata: { probe: "live-call", run: RUN_ID },
        },
        { idempotencyKey: liveKey },
      ),
  );

  // #234. Same key, changed payload. This is where the reported 422 should appear.
  await probe(
    {
      probe: "idempotency-replay-changed-payload",
      issue: "#234",
      question: "Same accepted key, changed task. Does this produce the reported 422?",
      costedACall: "unknown",
    },
    () =>
      client.calls.create(
        {
          task: `${ATTESTATION_TASK} This sentence changes the payload.`,
          recipients: [{ phones: [phone], region, locale }],
          recipientResultSchema: ATTESTATION_SCHEMA,
          metadata: { probe: "live-call", run: RUN_ID },
        },
        { idempotencyKey: liveKey },
      ),
  );

  // #179. Page through the event stream and record whether the cursor advances.
  await probe(
    {
      probe: "events-cursor",
      issue: "#179",
      question: "Does listEvents advance its cursor on a completed call?",
      costedACall: "no",
    },
    async () => {
      const pages: unknown[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const result = await client.calls.listEvents(id, {
          limit: 20,
          ...(cursor === null ? {} : { cursor }),
        });
        pages.push({
          page,
          requestedCursor: cursor,
          nextCursor: result.nextCursor,
          count: result.data.length,
        });
        if (result.nextCursor === null || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }
      return pages;
    },
  );
}

/* -------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const tierArg = args.find((a) => a.startsWith("--tier="))?.split("=")[1];
  const tier = Number(tierArg ?? "0");
  const consented = args.includes("--i-understand-this-places-a-real-call");

  const env = readEnv();

  // Every precondition is checked before the first request goes out. Discovering
  // a missing flag halfway through means the earlier tiers already ran.
  if (!Number.isInteger(tier) || tier < 0 || tier > 2) {
    throw new Error(`--tier must be 0, 1 or 2. Received ${String(tierArg)}.`);
  }
  if (tier >= 2 && !consented) {
    throw new Error(
      "Tier 2 places a real call and spends at least one call from the free budget. " +
        "Pass --i-understand-this-places-a-real-call to proceed.",
    );
  }
  if (tier >= 2 && env.ownPhone === "") {
    throw new Error("Tier 2 needs CALLE_OWN_PHONE set to a number you own, in E.164.");
  }

  const client = new CalleClient({ apiKey: env.apiKey, baseUrl: env.baseUrl });

  process.stdout.write(`CALL-E conformance probes. Run ${RUN_ID}. Tier ${tier}.\n`);

  try {
    await tier0(client, env.baseUrl);

    if (tier >= 1) {
      process.stdout.write(
        "\nTier 1. These requests are expected to be refused during validation and " +
          "must never dial. The results record whether that held.\n",
      );
      await tier1(client);
    }

    if (tier >= 2) {
      process.stdout.write(`\nTier 2. Placing one real call to ${env.ownPhone}.\n`);
      await tier2(client, env.ownPhone, env.ownRegion, env.ownLocale);
    }
  } finally {
    // Whatever was observed before an abort is still evidence, so it gets written.
    await mkdir(RESULTS_DIR, { recursive: true });
    const path = join(RESULTS_DIR, `${RUN_ID}-tier${tier}.json`);
    await writeFile(
      path,
      JSON.stringify(
        { runId: RUN_ID, tier, baseUrl: env.baseUrl, sdk: "@call-e/calle@0.7.0", outcomes },
        null,
        2,
      ),
      "utf8",
    );
    process.stdout.write(`\nWrote ${outcomes.length} outcomes to ${path}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
