/**
 * Derives the publishable corpus from the raw captures.
 *
 * The raw payloads in probe-results/ carry a personal phone number, a carrier's
 * branding and real platform identifiers. None of that is what the fixtures are
 * for: the finding lives in the SHAPE. So every identifier is replaced with a
 * synthetic one of the same form, every number with a reserved fictional one,
 * and every timestamp is shifted onto a fixed synthetic date while preserving
 * both its offset from the others and whether the original string carried a
 * timezone designator, because that presence or absence IS one of the findings.
 *
 * The masking is only trustworthy if it can be shown not to have changed the
 * answer. So after writing each fixture this compares the quirks present in the
 * raw payload against the quirks present in the masked one, and refuses to emit
 * a fixture whose quirk set moved in either direction.
 *
 * Raw captures are never published. Only fixtures/ is.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { quirksIn, type CallPayload } from "./quirks.js";

const RAW_DIR = "probe-results";
const OUT_DIR = "fixtures/calls";

/** A fixed instant, so regenerating the corpus produces identical files. */
const SYNTHETIC_BASE = Date.parse("2026-03-04T14:00:00.000Z");

/** Reserved by the ITU for documentation. Safe to print, rings for nobody. */
const RESERVED = ["+12025550142", "+12025550167", "+12025550188", "+12025550109"];

/** Vendor-branded machine speech, replaced with a neutral equivalent. */
const VENDOR_SPEECH: Array<[RegExp, string]> = [
  [/This is an automated call generated on the \w+ platform\. Please report any abuse to [^.]+\./gi,
   "This is an automated call generated on a carrier test platform. Please report any abuse to the operator."],
  [/This number isn't verified for the trial\. Verify to continue or upgrade to receive calls from any number\./gi,
   "This number is not verified for the trial. Verify to continue or upgrade to receive calls from any number."],
];

const stable = (kind: string, value: string, len: number) =>
  createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, len);

class Synth {
  private phones = new Map<string, string>();
  private earliest: number | null = null;

  phone(real: string): string {
    const known = this.phones.get(real);
    if (known !== undefined) return known;
    const next = RESERVED[this.phones.size % RESERVED.length]!;
    this.phones.set(real, next);
    return next;
  }

  /** Learns the earliest instant so the whole call is shifted by one delta. */
  noteInstant(raw: string): void {
    const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`);
    if (!Number.isNaN(t) && (this.earliest === null || t < this.earliest)) this.earliest = t;
  }

  /** Shifts an instant, keeping the original string's zone marker and precision. */
  instant(raw: string): string {
    const hadZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
    const parsed = Date.parse(hadZone ? raw : `${raw}Z`);
    if (Number.isNaN(parsed)) return raw;
    const shifted = new Date(parsed - (this.earliest ?? parsed) + SYNTHETIC_BASE).toISOString();
    const hasMicros = /\.\d{6}/.test(raw);
    const body = hasMicros ? shifted.replace(/\.(\d{3})Z$/, ".$1000Z") : shifted;
    return hadZone ? body : body.replace(/\.\d+Z$/, "").replace(/Z$/, "");
  }
}

function transform(node: unknown, s: Synth): unknown {
  if (Array.isArray(node)) return node.map((n) => transform(n, s));
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") {
      switch (key) {
        case "id": out[key] = value.replace(/^([a-z_]+_)?.*$/, (_m, p) => `${p ?? ""}${stable(key, value, 16)}`); continue;
        case "providerCallId": out[key] = stable(key, value, 32); continue;
        case "phone": out[key] = s.phone(value); continue;
        case "startedAt": case "completedAt": case "createdAt": out[key] = s.instant(value); continue;
        case "run": out[key] = "corpus"; continue;
        case "text": {
          let t = value;
          for (const [re, replacement] of VENDOR_SPEECH) t = t.replace(re, replacement);
          out[key] = t;
          continue;
        }
      }
    }
    if (key === "phones" && Array.isArray(value)) {
      out[key] = value.map((p) => (typeof p === "string" ? s.phone(p) : p));
      continue;
    }
    out[key] = transform(value, s);
  }
  return out;
}

function collectInstants(node: unknown, s: Synth): void {
  if (Array.isArray(node)) { node.forEach((n) => collectInstants(n, s)); return; }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string" && ["startedAt", "completedAt", "createdAt"].includes(key)) s.noteInstant(value);
    else collectInstants(value, s);
  }
}

/** Every call_task object anywhere in a capture file. */
function callsIn(node: unknown, found: CallPayload[] = []): CallPayload[] {
  if (Array.isArray(node)) { node.forEach((n) => callsIn(n, found)); return found; }
  if (node === null || typeof node !== "object") return found;
  const o = node as Record<string, unknown>;
  if (o.object === "call_task" && Array.isArray(o.recipients)) found.push(o as unknown as CallPayload);
  Object.values(o).forEach((v) => callsIn(v, found));
  return found;
}

mkdirSync(OUT_DIR, { recursive: true });

const seen = new Set<string>();
const index: Array<{ file: string; quirks: string[]; status: string; failureCode: string | null; turns: number }> = [];
let refused = 0;

for (const file of readdirSync(RAW_DIR).filter((f) => f.endsWith(".json")).sort()) {
  for (const raw of callsIn(JSON.parse(readFileSync(`${RAW_DIR}/${file}`, "utf8")))) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);

    const before = quirksIn(raw);
    const s = new Synth();
    collectInstants(raw, s);
    const masked = transform(raw, s) as CallPayload;
    const after = quirksIn(masked);

    if (before.join("|") !== after.join("|")) {
      process.stdout.write(
        `REFUSED ${raw.id}: masking moved the quirk set\n  before ${JSON.stringify(before)}\n  after  ${JSON.stringify(after)}\n`,
      );
      refused += 1;
      continue;
    }

    const attempt = masked.recipients[0]?.attempts.at(-1);
    const turns = attempt?.transcriptTurns.length ?? 0;
    const slug = `${masked.status}-${attempt?.failureCode ?? "no-failure"}-${turns}turns-${masked.id.slice(-6)}`;
    writeFileSync(`${OUT_DIR}/${slug}.json`, `${JSON.stringify(masked, null, 2)}\n`, "utf8");
    index.push({ file: `${slug}.json`, quirks: after, status: masked.status, failureCode: attempt?.failureCode ?? null, turns });
  }
}

writeFileSync("fixtures/index.json", `${JSON.stringify({ generated: "deterministic", calls: index }, null, 2)}\n`, "utf8");

process.stdout.write(`\n${index.length} fixtures written, ${refused} refused.\n\n`);
for (const entry of index) process.stdout.write(`  ${entry.file}\n     ${entry.quirks.join(", ") || "(no quirk)"}\n`);
