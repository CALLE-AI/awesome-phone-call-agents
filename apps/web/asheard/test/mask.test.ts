import assert from "node:assert/strict";
import test from "node:test";

import { deepMask, maskText } from "../src/lib/mask.ts";

test("phone-shaped text is masked in any form", () => {
  for (const raw of ["+13035550100", "+1 303 555 0100", "(303) 555-0100", "555-0100"]) {
    const masked = maskText(`call ${raw} now`);
    assert.ok(!masked.includes("0100"), masked);
    assert.match(masked, /\*/);
  }
});

test("timestamps, scores and ids are left alone", () => {
  const keep = [
    "2000-01-03T04:17:21.118300Z",
    "2000-01-02T21:14:05",
    "0.94",
    "21.118300",
    "call_EJrO2ugj1b5GisZDvpousA",
    "evt_f9d5c457f57b704d7dd9a1a2",
    "a8237461b09f3c2e8237461b09f3c2e1",
  ];
  for (const value of keep) assert.equal(maskText(value), value);
});

test("masking goes all the way down", () => {
  const out = deepMask({
    evidence: {
      timeline: [{ message: "dialled +1 303 555 0100", created_at: "2000-01-01T10:00:00Z" }],
    },
    spoken: { line: "Reached (303) 555-0100." },
    score: 0.94,
    ok: true,
  }) as {
    evidence: { timeline: Array<{ message: string; created_at: string }> };
    spoken: { line: string };
    score: number;
    ok: boolean;
  };
  assert.ok(!out.evidence.timeline[0]!.message.includes("0100"));
  assert.equal(out.evidence.timeline[0]!.created_at, "2000-01-01T10:00:00Z");
  assert.ok(!out.spoken.line.includes("0100"));
  assert.equal(out.score, 0.94);
  assert.equal(out.ok, true);
});

test("a field named for a number is masked whatever it holds", () => {
  const out = deepMask({
    destination: { id: "fiction", e164: "+13035550100" },
    phone: "+13035550100",
    to_phone: null,
  }) as Record<string, unknown>;
  assert.equal(out["destination"], "[masked]");
  assert.ok(!String(out["phone"]).includes("0100"));
  assert.equal(out["to_phone"], null);
});
