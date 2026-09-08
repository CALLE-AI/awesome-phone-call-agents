/**
 * Reads the same calls again, and reports what the platform changed.
 *
 * Every other tool here answers a question about code: which behaviours has
 * this project never been tested against. This one answers a question about the
 * platform, and it is the one question a corpus of recorded responses is
 * uniquely able to answer. A test suite can tell you your code still does what
 * it did. Nothing in a test suite can tell you the API underneath it stopped
 * doing what it did, because the suite's idea of the API is a fixture the suite
 * itself wrote.
 *
 * The method is to re-read, not to re-call. Each response in the corpus belongs
 * to a call that still exists, so `calls.get(id)` returns today's serialisation
 * of the same event, and the conversation is identical by construction.
 *
 * That last step rests on an assumption this tool cannot settle from outside:
 * that the platform renders a response from live code over stored data. If it
 * instead persists the rendered JSON when a call completes, or serves a
 * historical object from a cache, re-reading returns the bytes from capture day
 * and this reports no drift forever, which is the same output as a platform
 * that genuinely did not move. An alarm and a disconnected bell print the same
 * thing, so the assumption is stated here rather than asserted in the report.
 * What would settle it is a platform change known from outside, followed by a
 * re-read of a call captured before it: a fingerprint that moves proves the
 * read path is live. Comparing the earliest and latest captures in hand does
 * not settle it, because their shapes are identical, which is consistent both
 * with a live serialiser that did not change and with a store that cannot.
 *
 * A second limit follows from the same fact. A frozen conversation cannot
 * produce a new outcome, so on re-reads the vocabulary and behaviour channels
 * are close to inert: a status that reads `completed` will not become a member
 * of an enum added next week, because that member arrives on new calls. What
 * re-reading detects reliably is a removed path and a changed type. The other
 * two channels earn their place when the baseline meets fresh payloads, which
 * is what the offline comparison does.
 *
 *   npm run drift             re-read every recorded call and compare
 *   npm run drift -- --offline    compare the published corpus to the baseline,
 *                                 with no key and no network
 *   npm run drift -- --record     rewrite the baseline from the corpus
 *   npm run drift -- --json <p>   also write the findings as JSON
 *
 * What is compared is a fingerprint, never the payload: which paths exist, what
 * type sits at each, which values appear in the fields whose values are a closed
 * set, and which quirks hold. See src/shape.ts for why a value diff cannot work
 * and for the guarantee that no transcript, number or summary reaches the
 * report.
 *
 * Exit codes: 0 nothing a caller depends on moved, 20 something did, 45 there
 * was nothing to compare.
 *
 * Live mode creates no call. It re-reads calls that already happened.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callNodesIn, normalise } from "./payloads.ts";
import { fingerprint, merge, diff, breaking, type Change, type Fingerprint } from "./shape.ts";


const BASELINE = "fixtures/shape.json";
const CORPUS = "fixtures/calls";
/** Unmasked captures. Local only, git-ignored, and the only place real ids exist. */
const RAW = "probe-results";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const valueOf = (f: string) => {
  const i = args.indexOf(f);
  return i === -1 ? null : (args[i + 1] ?? null);
};

const out = (s: string) => process.stdout.write(s);

function read(dir: string): Array<{ file: string; call: Record<string, unknown> }> {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const found: Array<{ file: string; call: Record<string, unknown> }> = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { continue; }
    for (const call of callNodesIn(normalise(doc))) found.push({ file: name, call });
  }
  return found;
}

function loadBaseline(): Fingerprint | null {
  try { return JSON.parse(readFileSync(BASELINE, "utf8")).fingerprint as Fingerprint; }
  catch { return null; }
}

function describe(c: Change): string {
  switch (c.kind) {
    case "path_gone": return `field removed          ${c.path}  (was ${c.type})`;
    case "path_new": return `field added            ${c.path}  (${c.type})`;
    case "retyped": return `type changed           ${c.path}  ${c.was} -> ${c.now}`;
    case "vocabulary_new": return `value never seen       ${c.path} = ${c.value}`;
    case "vocabulary_gone": return `value no longer sent   ${c.path} = ${c.value}`;
    case "quirk_gone": return `behaviour gone         ${c.id}`;
    case "quirk_new": return `behaviour appeared     ${c.id}`;
  }
}

/** Sorted so the lines a caller must act on come first. */
const ordered = (cs: Change[]) => [...cs].sort((a, b) => Number(breaking(b)) - Number(breaking(a)));

function report(changes: Change[], scope: string): number {
  if (changes.length === 0) {
    out(`no drift. ${scope} matches the baseline on every path, value and behaviour.\n`);
    return 0;
  }
  const breaks = changes.filter(breaking);
  out(`${changes.length} difference${changes.length === 1 ? "" : "s"} against the baseline.\n\n`);
  for (const c of ordered(changes)) out(`  ${breaking(c) ? "!" : " "} ${describe(c)}\n`);
  out(
    `\n  a line marked ! breaks code written against the baseline: the path is gone,\n` +
      `  its type moved, or a closed set gained a member a switch cannot have covered.\n` +
      `  the rest is the platform saying more than it said, which breaks nothing.\n`,
  );
  return breaks.length > 0 ? 20 : 0;
}

if (has("--record")) {
  const prints = read(CORPUS);
  if (prints.length === 0) { out(`nothing in ${CORPUS} to record.\n`); process.exit(45); }
  const fp = merge(prints.map((f) => fingerprint(f.call)));
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ recordedFrom: `${prints.length} responses in ${CORPUS}`, fingerprint: fp }, null, 2)}\n`,
  );
  out(`baseline written from ${prints.length} responses: ${fp.shape.length} paths, ${fp.quirks.length} behaviours.\n`);
  process.exit(0);
}

const baseline = loadBaseline();
if (baseline === null) {
  out(`no baseline at ${BASELINE}. Run: npm run drift -- --record\n`);
  process.exit(45);
}

const findings: Array<{ scope: string; changes: Change[] }> = [];
let code = 0;

if (has("--offline") || !process.env.CALLE_API_KEY) {
  if (!has("--offline")) out("no CALLE_API_KEY, so this is the offline comparison.\n\n");
  const prints = read(CORPUS);
  if (prints.length === 0) { out(`nothing in ${CORPUS} to compare.\n`); process.exit(45); }
  out(`the published corpus, ${prints.length} responses, against the recorded baseline.\n\n`);
  const changes = diff(baseline, merge(prints.map((f) => fingerprint(f.call))));
  findings.push({ scope: "the published corpus", changes });
  code = report(changes, "the published corpus");
} else {
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

  // The corpus is masked, so its ids are synthetic. The real ones exist only in
  // the local captures, which is the whole reason this mode cannot run in CI.
  const recorded = new Map<string, Record<string, unknown>>();
  for (const { call } of read(RAW)) {
    if (typeof call.id === "string" && call.id.startsWith("call_")) recorded.set(call.id, call);
  }
  if (recorded.size === 0) {
    out(`no captures in ${RAW}/ carry a real call id, so there is nothing to re-read.\n`);
    process.exit(45);
  }

  out(`re-reading ${recorded.size} recorded calls. No call is created.\n\n`);
  const fresh: Fingerprint[] = [];
  let unobservable = 0;
  for (const [id, then] of recorded) {
    let live: Record<string, unknown> | undefined;
    try {
      live = callNodesIn(normalise(await client.calls.get(id)))[0];
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      // A call the platform no longer serves is a baseline that cannot be
      // observed. Reporting it as every path having been removed would turn a
      // retention sweep into a spectacular false alarm.
      unobservable += 1;
      out(`  ${id}  baseline unobservable: ${e.status ?? ""} ${e.code ?? e.message}\n`);
      continue;
    }
    if (live === undefined) { out(`  ${id}  returned nothing call-shaped\n`); continue; }
    const changes = diff(fingerprint(then), fingerprint(live));
    fresh.push(fingerprint(live));
    out(`  ${id}  ${changes.length === 0 ? "unchanged" : `${changes.length} differences`}\n`);
    if (changes.length > 0) findings.push({ scope: id, changes });
  }

  out("\n");
  if (fresh.length === 0) { out("nothing could be re-read.\n"); process.exit(45); }
  out(`${fresh.length} of ${recorded.size} calls re-read, against the corpus baseline.\n`);
  if (unobservable > 0) {
    out(
      `${unobservable} could not be read, so they are absent from this comparison rather than\n` +
        `counted as unchanged. A shrinking sample is not a quiet result.\n`,
    );
  }
  out(
    `re-reads detect a removed path and a changed type. A widened enum or a behaviour\n` +
      `that stops holding arrives on new calls, not on frozen ones.\n\n`,
  );
  const changes = diff(baseline, merge(fresh));
  findings.push({ scope: "the re-read calls", changes });
  code = report(changes, "the re-read calls");

  const perCall = findings.filter((f) => f.scope.startsWith("call_"));
  if (perCall.length > 0) {
    out(`\nand per call, where the conversation is identical by construction so every\n`);
    out(`difference below is the platform's serialisation and not the call:\n\n`);
    for (const f of perCall) {
      out(`  ${f.scope}\n`);
      for (const c of ordered(f.changes)) out(`    ${breaking(c) ? "!" : " "} ${describe(c)}\n`);
    }
    if (perCall.some((f) => f.changes.some(breaking))) code = 20;
  }
}

const jsonPath = valueOf("--json");
if (jsonPath !== null) {
  writeFileSync(jsonPath, `${JSON.stringify({ at: new Date().toISOString(), findings }, null, 2)}\n`);
  out(`\nfindings written to ${jsonPath}\n`);
}

process.exit(code);
