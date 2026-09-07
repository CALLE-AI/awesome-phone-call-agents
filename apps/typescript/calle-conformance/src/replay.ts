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
 *   npm run replay -- <directory> [<directory> ...]
 *
 * Reads only. Places no call, contacts no API.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
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

/** Accepts `label=path` so a corpus can name itself in the table. */
const roots = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("-"))
  .map((arg) => {
    const eq = arg.indexOf("=");
    return eq === -1 ? { label: arg, path: arg } : { label: arg.slice(0, eq), path: arg.slice(eq + 1) };
  });
if (roots.length === 0) throw new Error("Usage: npm run replay -- [label=]<directory> ...");

type Row = { project: string; payloads: number; quirks: Set<string> };
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
    const row = rows.get(key) ?? { project: name, payloads: 0, quirks: new Set<string>() };
    row.payloads += calls.length;
    for (const call of calls) for (const q of quirksIn(call)) row.quirks.add(q);
    rows.set(key, row);
  }
}

const sorted = [...rows.values()].sort((a, b) => a.project.localeCompare(b.project));
const width = Math.max(24, ...sorted.map((r) => r.project.length));

process.stdout.write(`\n${sorted.length} projects carrying call-shaped payloads, ${QUIRKS.length} quirks.\n`);
process.stdout.write(`A dot means the behaviour never appears in that project's payloads.\n\n`);

process.stdout.write(`${"project".padEnd(width)}  n   ${QUIRKS.map((_, i) => String(i + 1).padStart(2)).join(" ")}\n`);
process.stdout.write(`${"-".repeat(width)}  --  ${QUIRKS.map(() => "--").join(" ")}\n`);
for (const r of sorted) {
  const cells = QUIRKS.map((q) => (r.quirks.has(q.id) ? " x" : " .")).join(" ");
  process.stdout.write(`${r.project.padEnd(width)}  ${String(r.payloads).padStart(2)}  ${cells}\n`);
}

process.stdout.write(`\nlegend\n`);
QUIRKS.forEach((q, i) => {
  const covered = sorted.filter((r) => r.quirks.has(q.id)).length;
  process.stdout.write(`  ${String(i + 1).padStart(2)}  ${q.id}\n      covered by ${covered} of ${sorted.length} projects\n`);
});

if (unreadable.length > 0) {
  process.stdout.write(
    `\n${unreadable.length} files carry transcript turns in a shape this tool cannot read.\n` +
      `They are listed rather than scored as empty, because silently dropping a payload is the\n` +
      `failure mode this corpus exists to expose.\n`,
  );
  for (const f of unreadable) process.stdout.write(`  ${f}\n`);
}
