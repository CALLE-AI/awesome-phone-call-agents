/**
 * The fingerprint of a response, and the difference between two of them.
 *
 * A corpus of recorded responses is only worth keeping if it can answer a
 * question no single response can: did the platform change? Answering that by
 * diffing two payloads directly does not work. Every identifier and every
 * timestamp differs between any two calls, so a value diff reports hundreds of
 * differences and none of them mean anything.
 *
 * What a caller actually depends on is narrower than the payload and wider than
 * any one field. It is three things:
 *
 *   shape       which paths exist and what JSON type sits at each one, with
 *               array indices collapsed, so `recipients[0].attempts[1].status`
 *               and `recipients[3].attempts[0].status` are the same fact.
 *   vocabulary  for the fields whose values are a closed set, which values have
 *               actually been seen. A new member of an enum breaks a switch
 *               statement without changing a single type.
 *   quirks      which of the documented-as-absent behaviours the payload has.
 *
 * Those three survive re-reading the same call a week later, which is what
 * makes them comparable. Nothing here reads a phone number, a transcript, a
 * summary or a message: values are only lifted from paths on a fixed list of
 * closed-set fields, so a fingerprint can be printed without printing anybody.
 */

import { quirksIn } from "./quirks.ts";
import { asCall } from "./payloads.ts";

/**
 * Fields whose values are a closed set the caller branches on. A value that
 * appears here appears in the report, so nothing on this list may carry prose,
 * an identifier or anything a person said.
 */
const VOCABULARY: readonly string[] = [
  "object",
  "status",
  "taskCompleted",
  "completionConfidence",
  "recipients[].status",
  "recipients[].locale",
  "recipients[].region",
  "recipients[].attempts[].status",
  "recipients[].attempts[].failureCode",
  "recipients[].attempts[].transcriptTurns[].speaker",
];

export type Fingerprint = {
  /** Sorted `path:type` entries. */
  shape: string[];
  /** Sorted distinct values, per closed-set path. */
  vocabulary: Record<string, string[]>;
  /** Sorted quirk ids. */
  quirks: string[];
};

const typeOf = (v: unknown): string => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

function walk(node: unknown, path: string, shape: Set<string>, vocab: Map<string, Set<string>>): void {
  shape.add(`${path}:${typeOf(node)}`);
  if (VOCABULARY.includes(path) && node !== null && typeof node !== "object") {
    const bucket = vocab.get(path) ?? new Set<string>();
    bucket.add(String(node));
    vocab.set(path, bucket);
  }
  if (Array.isArray(node)) {
    // Every element folds onto one path, so a corpus of one call and a corpus
    // of fifty produce comparable fingerprints.
    node.forEach((v) => walk(v, `${path}[]`, shape, vocab));
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    walk(v, path === "" ? k : `${path}.${k}`, shape, vocab);
  }
}

/**
 * Takes the node as it arrived rather than the checker's projection of it: a
 * field no predicate reads is precisely the field whose removal nothing else
 * would notice.
 */
export function fingerprint(node: Record<string, unknown>): Fingerprint {
  const shape = new Set<string>();
  const vocab = new Map<string, Set<string>>();
  walk(node, "", shape, vocab);
  return {
    shape: [...shape].filter((s) => s !== ":object").sort(),
    vocabulary: Object.fromEntries([...vocab].sort().map(([k, v]) => [k, [...v].sort()])),
    quirks: quirksIn(asCall(node)).sort(),
  };
}

/** The union of several fingerprints, which is what a corpus baseline is. */
export function merge(prints: Fingerprint[]): Fingerprint {
  const shape = new Set<string>();
  const quirks = new Set<string>();
  const vocab = new Map<string, Set<string>>();
  for (const p of prints) {
    p.shape.forEach((s) => shape.add(s));
    p.quirks.forEach((q) => quirks.add(q));
    for (const [k, vs] of Object.entries(p.vocabulary)) {
      const bucket = vocab.get(k) ?? new Set<string>();
      vs.forEach((v) => bucket.add(v));
      vocab.set(k, bucket);
    }
  }
  return {
    shape: [...shape].sort(),
    vocabulary: Object.fromEntries([...vocab].sort().map(([k, v]) => [k, [...v].sort()])),
    quirks: [...quirks].sort(),
  };
}

export type Change =
  /** A path the baseline had and the new reading does not. */
  | { kind: "path_gone"; path: string; type: string }
  /** A path the new reading has and the baseline did not. */
  | { kind: "path_new"; path: string; type: string }
  /** Same path, different JSON type. */
  | { kind: "retyped"; path: string; was: string; now: string }
  /** A closed-set field emitting a value never recorded before. */
  | { kind: "vocabulary_new"; path: string; value: string }
  /** A closed-set field no longer emitting a value it used to. */
  | { kind: "vocabulary_gone"; path: string; value: string }
  | { kind: "quirk_gone"; id: string }
  | { kind: "quirk_new"; id: string };

/**
 * What changed between a baseline and a fresh reading.
 *
 * The asymmetry is deliberate. A path present in the baseline and absent now is
 * reported even for a single call, because a caller that reads it is already
 * broken. A path present now and absent from the baseline is reported too, but
 * it is the weaker signal: a corpus assembled from fifteen calls has never seen
 * every optional field, so a new path may be a field this call happens to fill
 * rather than a field the platform just added. The report says which is which
 * by never calling either one a regression.
 */
export function diff(baseline: Fingerprint, now: Fingerprint): Change[] {
  const out: Change[] = [];
  const split = (s: string) => {
    const at = s.lastIndexOf(":");
    return [s.slice(0, at), s.slice(at + 1)] as const;
  };
  const was = new Map(baseline.shape.map(split));
  const has = new Map(now.shape.map(split));

  for (const [path, type] of was) {
    const nowType = has.get(path);
    if (nowType === undefined) out.push({ kind: "path_gone", path, type });
    // A field that was null when recorded and carries a value now is the
    // platform filling an optional, not a change of contract, and the same the
    // other way round. Only a change between two real types is worth a line.
    else if (nowType !== type && type !== "null" && nowType !== "null") {
      out.push({ kind: "retyped", path, was: type, now: nowType });
    }
  }
  for (const [path, type] of has) {
    if (!was.has(path)) out.push({ kind: "path_new", path, type });
  }

  for (const [path, values] of Object.entries(now.vocabulary)) {
    const known = new Set(baseline.vocabulary[path] ?? []);
    for (const v of values) if (!known.has(v)) out.push({ kind: "vocabulary_new", path, value: v });
  }
  for (const [path, values] of Object.entries(baseline.vocabulary)) {
    const seen = new Set(now.vocabulary[path] ?? []);
    for (const v of values) if (!seen.has(v)) out.push({ kind: "vocabulary_gone", path, value: v });
  }

  const hadQuirk = new Set(baseline.quirks);
  const hasQuirk = new Set(now.quirks);
  for (const q of hadQuirk) if (!hasQuirk.has(q)) out.push({ kind: "quirk_gone", id: q });
  for (const q of hasQuirk) if (!hadQuirk.has(q)) out.push({ kind: "quirk_new", id: q });

  return out;
}

/**
 * Which changes mean a caller written against the baseline is now wrong.
 *
 * A path that disappeared and a field that changed type break code that reads
 * it. A closed-set field emitting a value never seen before breaks the switch
 * statement over it. Everything else is the platform having more to say than it
 * did, which is not a break and is not reported as one.
 */
export const breaking = (c: Change): boolean =>
  c.kind === "path_gone" || c.kind === "retyped" || c.kind === "vocabulary_new";
