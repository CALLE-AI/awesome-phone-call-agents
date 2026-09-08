/**
 * Scores a body of call-response fixtures against the quirks observed in real
 * CALL-E responses.
 *
 * The claim this makes is narrow on purpose. It does not say a project is
 * wrong. It says: these are the payloads that project's tests run against, and
 * these real behaviours never appear in them, so a bug that only shows up
 * against one of those behaviours cannot be caught by that suite.
 *
 * The REST API answers in snake_case and the TypeScript SDK answers in
 * camelCase, so both are normalised before the predicates run.
 *
 *   node src/replay.ts <directory> [<directory> ...]
 *
 * By default it reports and exits 0, because an absence is not a defect. Passing
 * --require turns it into a gate, and the gate reports three outcomes rather
 * than two: covered, missing, and unknown. "Your fixtures never contain this"
 * and "I could not read your fixtures" are different facts, and collapsing them
 * into one failure loses the one an operator needs.
 *
 *   --require <id|all>   fail if a required behaviour is not covered
 *   --html <path>        also write the report as a standalone HTML file
 *
 * Exit codes: 0 every requirement covered (or no gate asked for), 20 a required
 * behaviour is missing, 45 nothing readable to judge.
 *
 * Reads only. Places no call, contacts no API.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { QUIRKS, quirksIn, type CallPayload } from "./quirks.ts";

const RENAMES: Record<string, string> = {
  transcript_turns: "transcriptTurns",
  failure_code: "failureCode",
  failure_message: "failureMessage",
  structured_result: "structuredResult",
  started_at: "startedAt",
  created_at: "createdAt",
  completed_at: "completedAt",
  provider_call_id: "providerCallId",
  task_completed: "taskCompleted",
  completion_confidence: "completionConfidence",
};

function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[RENAMES[k] ?? k] = normalise(v);
  }
  return out;
}

/** A payload is call-shaped if it has recipients carrying attempts. */
function callsIn(node: unknown, found: CallPayload[] = []): CallPayload[] {
  if (Array.isArray(node)) { node.forEach((n) => callsIn(n, found)); return found; }
  if (node === null || typeof node !== "object") return found;
  const o = node as Record<string, unknown>;
  const rs = o.recipients;
  if (Array.isArray(rs) && rs.some((r) => r !== null && typeof r === "object" && Array.isArray((r as Record<string, unknown>).attempts))) {
    found.push({
      id: String(o.id ?? "unknown"),
      object: String(o.object ?? ""),
      status: String(o.status ?? ""),
      createdAt: String(o.createdAt ?? ""),
      completedAt: (o.completedAt as string) ?? null,
      taskCompleted: Boolean(o.taskCompleted),
      failureCode: (o.failureCode as string) ?? null,
      structuredResult: o.structuredResult ?? null,
      recipients: rs as CallPayload["recipients"],
    });
  }
  Object.values(o).forEach((v) => callsIn(v, found));
  return found;
}

function jsonFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    // probe-results holds unmasked captures. It is git-ignored and must never be
    // scored: a corpus that reads its own private inputs is measuring nothing.
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    if (name === "probe-results") continue;
    const full = join(dir, name);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) jsonFiles(full, acc);
    else if (name.endsWith(".json")) acc.push(full);
  }
  return acc;
}

/** Groups a path under its owning project, e.g. apps/python/casechaser. */
function project(root: string, label: string, file: string): string {
  const parts = relative(root, file).split(sep);
  const first = parts[0] ?? "";
  if (["apps", "skills", "plugins", "docs"].includes(first) && parts.length > 2) {
    return first === "apps" ? `${parts[0]}/${parts[1]}/${parts[2]}` : `${parts[0]}/${parts[1]}`;
  }
  if (["skills", "plugins"].includes(first) && parts.length > 1) return `${parts[0]}/${parts[1]}`;
  return label;
}

const argv = process.argv.slice(2);

function flagValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== name) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${name} needs a value.`);
    }
    out.push(value);
  }
  return out;
}

const htmlPath = flagValues("--html").at(-1) ?? null;
const requested = flagValues("--require").flatMap((v) => v.split(","));
const required = requested.includes("all") ? QUIRKS.map((q) => q.id) : requested;
const unknownIds = required.filter((id) => !QUIRKS.some((q) => q.id === id));
if (unknownIds.length > 0) {
  const known = QUIRKS.map((q) => `  ${q.id}`).join("\n");
  throw new Error(
    `--require names behaviours that do not exist: ${unknownIds.join(", ")}\n` +
      `Known ids:\n${known}\n`,
  );
}

/** Accepts `label=path` so a corpus can name itself in the table. */
const flagged = new Set<number>();
argv.forEach((a, i) => {
  if (a === "--html" || a === "--require") { flagged.add(i); flagged.add(i + 1); }
});
const roots = argv
  .filter((a, i) => !flagged.has(i) && !a.startsWith("-"))
  .map((arg) => {
    const eq = arg.indexOf("=");
    return eq === -1 ? { label: arg, path: arg } : { label: arg.slice(0, eq), path: arg.slice(eq + 1) };
  });
if (roots.length === 0) throw new Error("Usage: npm run replay -- [label=]<directory> ...");

/**
 * `counts` exists so the legend can say how many responses a behaviour was seen in,
 * not merely that it was seen. Eight behaviours drawn from fifteen responses is a floor,
 * and a behaviour observed once should not print with the same authority as one observed
 * twelve times.
 */
type Row = { project: string; payloads: number; quirks: Set<string>; counts: Map<string, number> };
const rows = new Map<string, Row>();

/** Files that look like call data but carry no recipients[].attempts[]. */
const unreadable: string[] = [];

for (const root of roots) {
  for (const file of jsonFiles(root.path)) {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const calls = callsIn(normalise(parsed));
    if (calls.length === 0) {
      const text = readFileSync(file, "utf8");
      if (/"(transcript_turns|transcriptTurns)"/.test(text)) unreadable.push(relative(root.path, file));
      continue;
    }
    const name = project(root.path, root.label, file);
    const key = `${root.path}:${name}`;
    const row = rows.get(key) ?? { project: name, payloads: 0, quirks: new Set<string>(), counts: new Map<string, number>() };
    row.payloads += calls.length;
    for (const call of calls)
      for (const q of quirksIn(call)) {
        row.quirks.add(q);
        row.counts.set(q, (row.counts.get(q) ?? 0) + 1);
      }
    rows.set(key, row);
  }
}

/**
 * A project that ships no call payloads at all cannot appear in the table, and
 * that silence is the loudest result the tool can produce. It means every
 * behaviour is absent, not that none is. These are found by looking for source
 * that consumes the API rather than for fixtures that describe it.
 */
const CONSUMES = /@call-e\/calle|calle-ai|CALLE_API_KEY|heycall-e/;
const SOURCE = /\.(ts|tsx|js|mjs|py)$/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    if (name === "probe-results" || name === ".venv" || name === "__pycache__") continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) sourceFiles(full, acc);
    else if (SOURCE.test(name)) acc.push(full);
  }
  return acc;
}

const scored = new Set([...rows.values()].map((r) => r.project));
const unscoreable = new Set<string>();
for (const root of roots) {
  for (const file of sourceFiles(root.path)) {
    const name = project(root.path, root.label, file);
    if (scored.has(name) || unscoreable.has(name) || name === root.label) continue;
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (CONSUMES.test(text)) unscoreable.add(name);
  }
}

const sorted = [...rows.values()].sort((a, b) => a.project.localeCompare(b.project));
const width = Math.max(24, ...sorted.map((r) => r.project.length));

// The corpus size is printed by the program that owns it, not quoted from a
// README. A figure a reader cannot see the tool produce is a figure they have to
// take on trust, and this tool exists to remove that.
const corpusSize = (() => {
  try {
    const index = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "index.json"), "utf8")) as {
      calls?: unknown[];
    };
    return Array.isArray(index.calls) ? index.calls.length : 0;
  } catch {
    return 0;
  }
})();

process.stdout.write(`\ncorpus: ${corpusSize} real responses, ${QUIRKS.length} behaviours declared as predicates.\n`);
process.stdout.write(`${sorted.length} projects carry call-shaped payloads to score against them.\n`);
process.stdout.write(`A dot means the behaviour never appears in that project's payloads.\n`);
// The gap between what this measures and what a reader hears is the tool's own biggest
// risk, so it is printed next to the table rather than left to a README nobody opens.
// A dot is about recorded test data. Promoting it to "this project is broken" is the one
// misreading that would make the matrix worse than nothing.
process.stdout.write(
  `That is a statement about recorded test data, not a verdict on a project's code: a\n` +
    `project can handle a behaviour and ship no fixture for it, and a fixture is data\n` +
    `rather than an assertion. Read a row as coverage against this corpus, nothing wider.\n\n`,
);

process.stdout.write(`${"project".padEnd(width)}  n   ${QUIRKS.map((_, i) => String(i + 1).padStart(2)).join(" ")}\n`);
process.stdout.write(`${"-".repeat(width)}  --  ${QUIRKS.map(() => "--").join(" ")}\n`);
// The corpus's own row scores full marks by construction: it is where the behaviours were
// derived from. Unmarked, it reads as this tool's author topping this tool's own table.
const OWNER = "calle-conformance";
for (const r of sorted) {
  const cells = QUIRKS.map((q) => (r.quirks.has(q.id) ? " x" : " .")).join(" ");
  const note = r.project.endsWith(OWNER) ? "   <- the corpus itself, full by construction" : "";
  process.stdout.write(`${r.project.padEnd(width)}  ${String(r.payloads).padStart(2)}  ${cells}${note}\n`);
}

// A behaviour seen once and a behaviour seen twelve times print the same cross, so the
// legend carries the difference. It says "observed", not a rate: fifteen responses from
// one account is a record of what was seen and not a sample of anything, and one
// observation establishes that a behaviour is real exactly as well as seven do. Printed
// as a bare fraction it would be read as a frequency, which is a claim this cannot make.
const corpusRow = sorted.find((r) => r.project.endsWith(OWNER));
process.stdout.write(`\nlegend\n`);
process.stdout.write(`  counts are observations in this corpus, which is a record and not a sample\n`);
QUIRKS.forEach((q, i) => {
  const covered = sorted.filter((r) => r.quirks.has(q.id)).length;
  const seen = corpusRow?.counts.get(q.id) ?? 0;
  process.stdout.write(
    `  ${String(i + 1).padStart(2)}  ${q.id}\n` +
      `      observed in ${seen} of the ${corpusSize} corpus responses, covered by ${covered} of ${sorted.length} projects\n`,
  );
});

if (unreadable.length > 0) {
  process.stdout.write(
    `\n${unreadable.length} files carry transcript turns in a shape this tool cannot read.\n` +
      `They are listed rather than scored as empty, because silently dropping a payload is the\n` +
      `failure mode this corpus exists to expose.\n`,
  );
  for (const f of unreadable) process.stdout.write(`  ${f}\n`);
}

if (unscoreable.size > 0) {
  const names = [...unscoreable].sort();
  const shown = names.slice(0, 12);
  process.stdout.write(
    `\n${names.length} projects call this API and ship no JSON payload for this checker to read.\n` +
      `They cannot appear in the table, so no dot describes them. That is a stronger statement\n` +
      `than any dot, not a weaker one: there is nothing recorded to compare against reality.\n` +
      `A project keeping its fixtures inline in test code is invisible here and is counted among\n` +
      `them, so read this as the size of the blind spot rather than as a verdict on each name.\n`,
  );
  for (const n of shown) process.stdout.write(`  ${n}\n`);
  if (names.length > shown.length) {
    process.stdout.write(`  and ${names.length - shown.length} more.\n`);
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/**
 * The same report as a standalone file. No stylesheet, no script, no network:
 * a report that needs a server to be read is not a report, it is an app.
 */
function html(rows: Row[], unread: string[], result: Outcome): string {
  const head = QUIRKS.map((_, i) => `<th>${i + 1}</th>`).join("");
  const body = rows
    .map((r) => {
      const cells = QUIRKS.map((q) =>
        r.quirks.has(q.id)
          ? '<td class="y" title="present">&#9632;</td>'
          : '<td class="n" title="never appears">&middot;</td>',
      ).join("");
      return `<tr><th scope="row">${esc(r.project)}</th><td class="n">${r.payloads}</td>${cells}</tr>`;
    })
    .join("");
  const legend = QUIRKS.map((q, i) => {
    const covered = rows.filter((r) => r.quirks.has(q.id)).length;
    return `<li><b><span class="num">${i + 1}</span>${esc(q.title)}</b><br><code>${esc(q.id)}</code>` +
      `<p>${esc(q.consequence)}</p><small>present in ${covered} of ${rows.length} projects</small></li>`;
  }).join("");
  const unreadBlock = unread.length === 0 ? "" :
    `<h2>${unread.length} files could not be read</h2><p>They carry transcript turns in a shape ` +
    `this tool does not understand. They are listed rather than counted as empty, because silently ` +
    `dropping a payload is the failure this corpus exists to expose.</p><ul class="files">` +
    unread.map((f) => `<li><code>${esc(f)}</code></li>`).join("") + "</ul>";
  const gateBlock = required.length === 0 ? "" :
    `<h2>Gate</h2><p class="gate"><b>${esc(result.label)}</b>, exit ${result.code}. ` +
    `Required: <code>${esc(required.join(", "))}</code></p>` +
    (result.missing.length === 0 ? "" :
      `<ul class="files">${result.missing.map((m) => `<li><code>${esc(m)}</code></li>`).join("")}</ul>`);

  return [
    '<!doctype html><meta charset="utf-8"><title>calle-conformance report</title>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<style>",
    ":root{color-scheme:light dark;--ink:#16150f;--dim:#6d6a5e;--line:#dcd8c9;--bg:#faf8f2}",
    "@media (prefers-color-scheme:dark){:root{--ink:#eceadf;--dim:#918d80;--line:#33322c;--bg:#141410}}",
    "body{background:var(--bg);color:var(--ink);margin:0;padding:3rem 1.5rem;",
    "font:16px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}",
    "main{max-width:60rem;margin:0 auto}h1{font-size:1.5rem;font-weight:500;margin:0 0 .4rem}",
    "h2{font-size:1rem;font-weight:500;margin:2.6rem 0 .6rem;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}",
    "p{max-width:44rem}table{border-collapse:collapse;margin-top:.6rem;font-variant-numeric:tabular-nums}",
    "th,td{padding:.32rem .6rem;text-align:right;border-bottom:1px solid var(--line)}",
    "th[scope=row]{text-align:left;font-weight:400}",
    "thead th{color:var(--dim);font-weight:400;font-size:.8rem;letter-spacing:.06em}",
    "thead th:first-child{text-align:left}thead th{border-bottom:1px solid var(--ink)}",
    "tbody tr:hover th[scope=row]{color:var(--ink)}",
    "td.y{color:var(--ink)}td.n{color:var(--dim)}code{color:var(--dim)}",
    "ol{list-style:none;padding:0;counter-reset:none}ol li{margin:1.4rem 0}",
    "ol p{margin:.25rem 0;color:var(--dim);max-width:44rem}",
    "b .num{display:inline-block;width:2.2rem;color:var(--dim);font-weight:400}",
    "ol code{display:inline-block;margin-left:2.2rem;font-size:.85rem}",
    "ol p,ol small{margin-left:2.2rem;display:block}",
    "small{color:var(--dim)}ul.files{list-style:none;padding:0}ul.files li{color:var(--dim)}",
    ".gate{border-left:0;padding:.7rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}",
    "</style>",
    "<main><h1>calle-conformance</h1>",
    "<p>Seven behaviours real CALL-E responses carry, against the fixtures each project tests ",
    "against. A filled square means the behaviour appears in that project&#39;s payloads. A dot ",
    "means it never does. A dot is not a defect: it says a behaviour is absent from what that ",
    "project was tested against, and nothing more.</p>",
    `<table><thead><tr><th scope="col">project</th><th>n</th>${head}</tr></thead><tbody>${body}</tbody></table>`,
    gateBlock,
    `<h2>The seven behaviours</h2><ol>${legend}</ol>`,
    unreadBlock,
    `<h2>Provenance</h2><p>Generated by <code>src/replay.ts</code> on ${esc(new Date().toISOString())}. ` +
      "No network, no credentials, no call placed.</p></main>",
  ].join("");
}

/**
 * The gate.
 *
 * Three outcomes, not two. "Your fixtures never contain this behaviour" and "I
 * could not read anything to judge" are different facts, and an operator acting
 * on them does different things. Collapsing them into one failure destroys the
 * distinction at exactly the moment it is needed.
 *
 * Failure is asymmetric on purpose. A behaviour counts as covered only when a
 * predicate positively decided so on a payload that parsed. Every other path,
 * including a predicate that threw on an unfamiliar payload, leaves it
 * uncovered. A checker whose own crash reports success is worse than no checker.
 */
/**
 * The corpus is where the behaviours were defined, so it covers all of them by
 * construction. Grading it would be grading the ruler against itself.
 */
const SELF = "apps/typescript/calle-conformance";

const PASS = 0;
const MISSING = 20;
const NOTHING_TO_JUDGE = 45;

type Outcome = { code: number; label: string; missing: string[] };

function gate(): Outcome {
  if (required.length === 0) return { code: PASS, label: "no gate requested", missing: [] };

  const judged = sorted.filter((r) => r.project !== SELF);
  if (judged.length === 0 || judged.every((r) => r.payloads === 0)) {
    return { code: NOTHING_TO_JUDGE, label: "nothing readable to judge", missing: [] };
  }

  const missing: string[] = [];
  for (const row of judged) {
    for (const id of required) {
      if (!row.quirks.has(id)) missing.push(`${row.project}  ${id}`);
    }
  }
  return missing.length === 0
    ? { code: PASS, label: "every requirement covered", missing }
    : { code: MISSING, label: "a required behaviour is not covered", missing };
}

const outcome = gate();

// The invariant leash asserts about its own lease, applied here: a non-zero exit
// and a non-empty missing list must agree, or the gate is lying about why.
if ((outcome.code === MISSING) !== (outcome.missing.length > 0)) {
  throw new Error("gate inconsistency: exit code and missing list disagree");
}

if (required.length > 0) {
  process.stdout.write(`GATE  ${outcome.label}, exit ${outcome.code}\n`);
  process.stdout.write(`      required: ${required.join(", ")}\n`);
  for (const line of outcome.missing) process.stdout.write(`      not covered  ${line}\n`);
  if (outcome.code === NOTHING_TO_JUDGE && unreadable.length > 0) {
    process.stdout.write(`      ${unreadable.length} files carried turns this tool could not read.\n`);
  }
}

if (htmlPath !== null) {
  writeFileSync(htmlPath, html(sorted, unreadable, outcome), "utf8");
  process.stdout.write(`\nWrote ${htmlPath}\n`);
}

process.exitCode = outcome.code;

