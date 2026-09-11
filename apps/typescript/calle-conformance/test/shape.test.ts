/**
 * A drift detector that never fires is indistinguishable from one that works,
 * and the difference only shows up on the day it mattered. So these tests do
 * not check that the corpus is stable, which it trivially is. They mutate a
 * real fixture in each of the ways a platform can actually change, and require
 * the detector to name the change and to classify it correctly.
 *
 * The last group is a different kind of check. The report is meant to be
 * publishable, so the fingerprint must never carry a transcript, a phone number
 * or a summary out of a payload that contains all three.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprint, merge, diff, breaking, type Change } from "../src/shape.ts";
import { callNodesIn, normalise } from "../src/payloads.ts";

const DIR = "fixtures/calls";

const load = (name: string): Record<string, unknown> =>
  callNodesIn(normalise(JSON.parse(readFileSync(join(DIR, name), "utf8"))))[0]!;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A completed call, which is the payload with the most surface to move. */
const CONNECTED = readdirSync(DIR).filter((n) => n.startsWith("completed-")).sort()[0]!;
/** A failed one, which is where the failure codes and the empty transcripts live. */
const FAILED = readdirSync(DIR).filter((n) => n.startsWith("failed-")).sort()[0]!;

const kinds = (cs: Change[]) => cs.map((c) => c.kind).sort();
const at = (cs: Change[], kind: Change["kind"]) => cs.find((c) => c.kind === kind);

describe("a fingerprint of the same payload does not move", () => {
  test("a payload compared with itself reports nothing", () => {
    const fp = fingerprint(load(CONNECTED));
    assert.deepEqual(diff(fp, fp), []);
  });

  // The last turn, not the first: behaviour 8 is about WHO speaks last, so
  // duplicating the opening turn moves a quirk and the detector rightly says so.
  test("array length is not a difference", () => {
    const call = load(CONNECTED);
    const longer = clone(call);
    const turns = (longer.recipients as any)[0].attempts[0].transcriptTurns;
    turns.push(clone(turns[turns.length - 1]));
    assert.deepEqual(diff(fingerprint(call), fingerprint(longer)), []);
  });

  test("the whole corpus matches the committed baseline", () => {
    const committed = JSON.parse(readFileSync("fixtures/shape.json", "utf8")).fingerprint;
    const now = merge(readdirSync(DIR).filter((n) => n.endsWith(".json")).map((n) => fingerprint(load(n))));
    assert.deepEqual(
      diff(committed, now),
      [],
      "fixtures/shape.json is stale. Run: npm run drift -- --record",
    );
  });
});

describe("it names the change a caller would break on", () => {
  test("a removed field is reported, and reported as breaking", () => {
    const call = load(CONNECTED);
    const without = clone(call);
    delete (without.recipients as any)[0].attempts[0].providerCallId;
    const changes = diff(fingerprint(call), fingerprint(without));
    const gone = at(changes, "path_gone");
    assert.equal(gone?.kind === "path_gone" && gone.path, "recipients[].attempts[].providerCallId");
    assert.ok(breaking(gone!));
  });

  test("a field that changes JSON type is reported as breaking", () => {
    const call = load(FAILED);
    const retyped = clone(call);
    (retyped.recipients as any)[0].attempts[0].failureCode = 486;
    const changes = diff(fingerprint(call), fingerprint(retyped));
    const c = at(changes, "retyped");
    assert.equal(c?.kind === "retyped" && c.was, "string");
    assert.equal(c?.kind === "retyped" && c.now, "number");
    assert.ok(breaking(c!));
  });

  test("a closed set gaining a member is reported, because a switch cannot have covered it", () => {
    const call = load(CONNECTED);
    const widened = clone(call);
    (widened.recipients as any)[0].attempts[0].status = "abandoned";
    const changes = diff(fingerprint(call), fingerprint(widened));
    const c = at(changes, "vocabulary_new");
    assert.equal(c?.kind === "vocabulary_new" && c.path, "recipients[].attempts[].status");
    assert.equal(c?.kind === "vocabulary_new" && c.value, "abandoned");
    assert.ok(breaking(c!));
  });

  test("a behaviour that stops holding is reported", () => {
    const call = load(FAILED);
    const fixed = clone(call);
    // The platform starting to send a documented word instead of a SIP number.
    (fixed.recipients as any)[0].attempts[0].failureCode = "busy";
    const changes = diff(fingerprint(call), fingerprint(fixed));
    assert.ok(kinds(changes).includes("quirk_gone"));
    const q = at(changes, "quirk_gone");
    assert.equal(q?.kind === "quirk_gone" && q.id, "raw-sip-code-as-failure-code");
  });
});

describe("it does not cry wolf", () => {
  test("a field the platform adds is reported, and not as breaking", () => {
    const call = load(CONNECTED);
    const wider = clone(call);
    (wider as any).recordingUrl = "https://example.invalid/r.mp3";
    const changes = diff(fingerprint(call), fingerprint(wider));
    const c = at(changes, "path_new");
    assert.equal(c?.kind === "path_new" && c.path, "recordingUrl");
    assert.equal(breaking(c!), false);
  });

  test("an optional that was null and now carries a value is not a type change", () => {
    const call = load(CONNECTED);
    const filled = clone(call);
    (filled.recipients as any)[0].summary = "a summary the platform did not send before";
    const changes = diff(fingerprint(call), fingerprint(filled));
    assert.equal(at(changes, "retyped"), undefined);
  });
});

describe("a fingerprint is publishable", () => {
  test("no transcript, phone number or summary reaches the vocabulary", () => {
    const call = load(CONNECTED);
    const spoken: string[] = [];
    const collect = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(collect);
      if (n === null || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (typeof v === "string" && ["text", "summary", "phone", "id", "providerCallId"].includes(k)) {
          spoken.push(v);
        }
        collect(v);
      }
    };
    collect(call);
    assert.ok(spoken.length > 0, "the fixture should contain speech and identifiers to leak");

    const printed = Object.values(fingerprint(call).vocabulary).flat();
    for (const secret of spoken) assert.ok(!printed.includes(secret), `fingerprint printed ${secret}`);
  });

  test("phones and text appear as paths but never as values", () => {
    const fp = fingerprint(load(CONNECTED));
    assert.ok(fp.shape.some((s) => s.startsWith("recipients[].attempts[].transcriptTurns[].text:")));
    assert.equal(fp.vocabulary["recipients[].attempts[].transcriptTurns[].text"], undefined);
    assert.equal(fp.vocabulary["recipients[].phones[]"], undefined);
  });
});
