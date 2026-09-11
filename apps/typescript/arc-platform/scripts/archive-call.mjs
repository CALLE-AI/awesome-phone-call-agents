/**
 * Preserve one call, completely, so it never has to be placed again.
 *
 *   node scripts/archive-call.mjs call_abc123
 *   node scripts/archive-call.mjs call_abc123 --dir docs/calls
 *
 * Writes everything CALL-E holds plus everything we hold, to a directory that
 * survives the account, the API and the demo:
 *
 *   raw-call.json      the provider's record verbatim, unedited
 *   events.json        the event stream, for timings
 *   our-record.json    our Call row: mandate, estimate, confirmation, outcome
 *   transcript.md      readable, timestamped, speaker-labelled, with the rate
 *                      confirmation marked
 *   summary.md         what happened, in numbers - queue, talk time, rate,
 *                      whether it was confirmed, what was offered
 *
 * A call good enough to put in a film is a call worth being unable to lose.
 * CALL-E exposes no recording,
 * so the transcript IS the artefact - and it lives behind an API that has been
 * returning 503 on create for two hours. Archiving it locally is not paranoia.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const callId = process.argv[2];
if (!callId) {
  console.error("Usage: node scripts/archive-call.mjs <call_id> [--dir docs/calls]");
  process.exit(1);
}
const dirArg = process.argv.indexOf("--dir");
const baseDir = dirArg > -1 ? process.argv[dirArg + 1] : "docs/calls";

const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));
const { findConfirmation } = await jiti.import(path.join(root, "lib/call-board.ts"));
const { resolveCalleBaseUrl } = await jiti.import(path.join(root, "lib/calle.ts"));
const { CalleClient } = await import(path.join(root, "node_modules/@call-e/calle/dist/index.js"));

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY,
  /* Through the allowlist. This script builds its own client, so the check
     in lib/calle.ts never ran for it. */
  baseUrl: resolveCalleBaseUrl(process.env.CALLE_BASE_URL),
});

const call = await client.calls.get(callId);
let events = null;
try { events = await client.calls.listEvents(callId); } catch { /* optional */ }

const row = await prisma.call.findFirst({ where: { calleCallId: callId } });
const rec = call.recipients?.[0];
const attempt = rec?.attempts?.[rec.attempts.length - 1];
const turns = (attempt?.transcriptTurns ?? []).map((t) => ({
  at: t.offset_seconds ?? null,
  speaker: t.speaker ?? "bot",
  text: (t.text ?? "").trim(),
}));

const out = path.join(root, baseDir, callId);
fs.mkdirSync(out, { recursive: true });

const write = (name, data) =>
  fs.writeFileSync(path.join(out, name), typeof data === "string" ? data : JSON.stringify(data, null, 1));

write("raw-call.json", call);
if (events) write("events.json", events);
write("our-record.json", row ?? { note: "no row in our database for this call" });

/* ── transcript.md ── */
const conf = findConfirmation(turns);
const clock = (s) =>
  s == null ? "--:--" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

const lines = turns.map((t, i) => {
  const mark = conf && (i === conf.askIndex || i === conf.yesIndex) ? "  **<- rate confirmation**" : "";
  const who = t.speaker === "bot" ? "Arc" : "Them";
  return `| ${clock(t.at)} | ${who} | ${t.text.replace(/\|/g, "\\|")} |${mark}`;
});

write("transcript.md",
`# ${row?.targetName ?? call.metadata?.targetName ?? callId}

\`${callId}\` · ${call.status} · ${turns.length} turns

| time | who | said |
|---|---|---|
${lines.join("\n")}
`);

/* ── summary.md ── */
const r = rec?.structuredResult ?? call.structuredResult ?? null;
const talk = attempt?.startedAt && attempt?.completedAt
  ? Math.round((new Date(attempt.completedAt) - new Date(attempt.startedAt)) / 1000)
  : null;
const concessions = Array.isArray(r?.concessions) ? r.concessions : [];

write("summary.md",
`# ${row?.targetName ?? callId}

- call id: \`${callId}\`
- status: ${call.status}${attempt?.failureCode ? ` (failure code ${attempt.failureCode})` : ""}
- created: ${call.createdAt}
- completed: ${call.completedAt ?? "—"}
- talk time: ${talk == null ? "—" : `${talk}s`}
- transcript turns: ${turns.length}
- dialled: ${rec?.phones?.[0] ?? "—"} (region ${rec?.region ?? "none"}, locale ${rec?.locale ?? "none"})

## Rate

- rate: ${r?.rate_per_spot ?? r?.rate ?? "—"} ${r?.rate_basis ?? ""}
- rate_confirmed: ${r?.rate_confirmed ?? "absent"}
- read back at: ${conf ? `${clock(turns[conf.askIndex]?.at)} — "${turns[conf.askIndex]?.text}"` : "not found in transcript"}
- agreed at: ${conf ? `${clock(turns[conf.yesIndex]?.at)} — "${turns[conf.yesIndex]?.text}"` : "—"}

## Negotiation

- mandate target: ${row?.mandateTargetPkr ?? "none — this call carried no mandate"}
- mandate walk-away: ${row?.mandateWalkAwayPkr ?? "—"}
- catalogue estimate at call time: ${row?.estimateAtCallPkr ?? "—"}
- opening rate: ${r?.opening_rate ?? "—"}
- levers offered: ${concessions.length}
${concessions.map((c, i) => `  ${i + 1}. offered ${c.offered}${c.response ? ` — ${c.response}` : ""}${c.rate_after != null ? ` -> ${c.rate_after}` : ""}`).join("\n") || "  (none)"}

## Structured result

\`\`\`json
${JSON.stringify(r, null, 1)}
\`\`\`
`);

console.log(`archived ${callId} -> ${path.relative(root, out)}`);
for (const f of fs.readdirSync(out)) {
  console.log(`  ${f}  ${fs.statSync(path.join(out, f)).size} bytes`);
}
await prisma.$disconnect();
