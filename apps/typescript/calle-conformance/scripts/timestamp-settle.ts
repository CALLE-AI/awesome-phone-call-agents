/**
 * When does an attempt timestamp stop carrying its timezone?
 *
 * `npm run drift` found that connected calls read tz-aware at completion and
 * naive on a later read. That leaves the interesting number unmeasured: the gap
 * between the last reading that carries the zone and the first that does not.
 * A cache expiring, a write settling and two paths over one row all produce the
 * same two values, and the interval is the cheapest thing that tells them apart.
 *
 * So this places one call and then reads it in a loop, logging the
 * wall clock and the raw string at every read, from before it connects until
 * well after it completes. It prints the transition with the reads on either
 * side of it rather than a conclusion.
 *
 * It reads over plain fetch rather than through the SDK so the response headers
 * are visible: a stale copy served by a cache and a value rewritten at the
 * origin are different bugs, and `cache-control` is part of telling them apart.
 *
 *   npm run settle -- --i-understand-this-places-a-real-call
 *
 * One call, one unit of the daily allowance. Preview without the flag.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { CalleClient } from "@call-e/calle";
import { baseUrl, maskPhone, testDestination } from "../src/endpoint.ts";

const REQUIRED_LINE = "This is an automated call from an AI assistant.";
const TASK = [
  `Begin the call by saying, word for word: ${REQUIRED_LINE}`,
  "Then ask one question: can you hear me clearly?",
  "Accept whatever answer you get, thank them, and end the call.",
  "Do not say anything else.",
].join(" ");

const SCHEMA = {
  type: "object",
  required: ["heard_clearly"],
  properties: {
    heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] },
  },
  additionalProperties: false,
};

/**
 * Sleep between reads, and for how long after completion to keep going. The real
 * cadence is this plus the request, which measured about 13 to 14 seconds, so a
 * boundary is only ever known to within one observed gap and never to the sleep.
 */
const EVERY_MS = 10_000;
const AFTER_COMPLETION_MS = 240_000;

const phone = testDestination();
const region = process.env.CALLE_TEST_REGION ?? "US";
const locale = process.env.CALLE_TEST_LOCALE ?? "en-US";

process.stdout.write(`Destination  ${maskPhone(phone)} (${region} ${locale})\n`);
process.stdout.write(
  `Cadence      ${EVERY_MS / 1000}s sleep plus request time, until ${AFTER_COMPLETION_MS / 1000}s past completion\n\n`,
);

if (!process.argv.includes("--i-understand-this-places-a-real-call")) {
  process.stdout.write(
    "Preview only. Nothing was sent.\n" +
      "This places one real call and spends one unit of the daily allowance.\n" +
      "To dial, re-run with --i-understand-this-places-a-real-call\n",
  );
  process.exit(0);
}

const apiKey = process.env.CALLE_API_KEY ?? "";
if (apiKey === "") throw new Error("CALLE_API_KEY must be set to place the call.");

const client = new CalleClient({ apiKey });
const runId = new Date().toISOString().replace(/[:.]/g, "-");

const created = await client.calls.create(
  {
    task: TASK,
    recipients: [{ phones: [phone], region, locale }],
    recipientResultSchema: SCHEMA,
    metadata: { probe: "timestamp-settle", run: runId },
  },
  { idempotencyKey: `settle-${runId}` },
);
process.stdout.write(`Created ${created.id}\n\n`);

const hasZone = (s: unknown) => typeof s === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);

type Reading = {
  at: string;
  status: string;
  attemptId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  zone: boolean;
  cacheControl: string | null;
  age: string | null;
  upstreamMs: string | null;
};

const readings: Reading[] = [];
let completedAtWall: number | null = null;

process.stdout.write("wall clock (UTC)          status      zone  attempt.startedAt\n");

for (let i = 0; i < 200; i += 1) {
  const response = await fetch(`${baseUrl()}/v1/calls/${created.id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = (await response.json()) as Record<string, any>;
  const call = body.recipients ? body : (body.data ?? body);
  const attempt = call.recipients?.[0]?.attempts?.[0] ?? null;
  const startedAt = attempt?.started_at ?? attempt?.startedAt ?? null;

  const reading: Reading = {
    at: new Date().toISOString(),
    status: String(call.status ?? "?"),
    attemptId: attempt?.id ?? null,
    startedAt,
    completedAt: attempt?.completed_at ?? attempt?.completedAt ?? null,
    zone: hasZone(startedAt),
    cacheControl: response.headers.get("cache-control"),
    age: response.headers.get("age"),
    upstreamMs: response.headers.get("x-envoy-upstream-service-time"),
  };
  readings.push(reading);

  process.stdout.write(
    `${reading.at}  ${reading.status.padEnd(11)} ${startedAt === null ? "-   " : reading.zone ? "yes " : "NO  "}  ${startedAt ?? "-"}\n`,
  );

  const terminal = reading.status !== "queued" && reading.status !== "in_progress";
  if (terminal && completedAtWall === null) completedAtWall = Date.now();
  if (completedAtWall !== null && Date.now() - completedAtWall > AFTER_COMPLETION_MS) break;
  await new Promise((r) => setTimeout(r, EVERY_MS));
}

/**
 * The zone is not lost once. The first run of this showed it absent while the
 * call was in progress, present for a couple of readings around completion, and
 * absent again afterwards, so a single "last good, first bad" pair describes the
 * wrong thing. Every run of readings is printed instead, and the answer is which
 * runs exist rather than where one boundary sits.
 */
const seen = readings.filter((r) => r.startedAt !== null);
process.stdout.write("\n--- runs ---\n");
if (seen.length === 0) {
  process.stdout.write("No reading ever carried an attempt timestamp.\n");
} else {
  let runStart = seen[0]!;
  let previous = seen[0]!;
  const flush = (last: Reading) => {
    const span = (Date.parse(last.at) - Date.parse(runStart.at)) / 1000;
    process.stdout.write(
      `${runStart.zone ? "with a zone   " : "without a zone"}  ${runStart.at} to ${last.at}  (${span}s, ${runStart.status})\n`,
    );
  };
  for (const r of seen.slice(1)) {
    if (r.zone !== previous.zone) {
      flush(previous);
      runStart = r;
    }
    previous = r;
  }
  flush(previous);
  process.stdout.write(
    `\nA boundary sits between the last reading on one side and the first on the other,\n` +
      `so a run is at least the span above and at most that span plus the two gaps\n` +
      `around it. The sleep is not the cadence: the observed gaps are.\n`,
  );
}

const path = `probe-results/experiments/EVIDENCE-timestamp-settle-${runId}.json`;
await mkdir("probe-results/experiments", { recursive: true });
await writeFile(path, `${JSON.stringify({ callId: created.id, cadenceMs: EVERY_MS, readings }, null, 2)}\n`, "utf8");
process.stdout.write(`\nSaved to ${path}\n`);
