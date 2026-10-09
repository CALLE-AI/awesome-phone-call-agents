/**
 * Tamper matrix — 5 attack classes must FAIL verify.
 */
import {
  tamperPackByKind,
  verifyEvidencePack,
  type TamperKind,
} from "../../src/runtime/evidence.js";
import { runMockProof } from "../../src/server/proofs.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const snap = await runMockProof("cross_party");
const base = snap.evidence!;
assert(verifyEvidencePack(base).ok, "base pack must verify");

const cases: Array<{ kind: TamperKind; expect: (e: string[]) => boolean }> = [
  {
    kind: "hash",
    expect: (e) => e.some((x) => /hash|mismatch/i.test(x)),
  },
  {
    kind: "event_id",
    expect: (e) => e.some((x) => /event_hash mismatch/i.test(x)),
  },
  {
    kind: "event_actor",
    expect: (e) => e.some((x) => /event_hash mismatch/i.test(x)),
  },
  {
    kind: "illegal_unlock",
    expect: (e) => e.some((x) => /unlock after unresolved/i.test(x)),
  },
  {
    kind: "dup_run",
    expect: (e) => e.some((x) => /provider runs/i.test(x)),
  },
  {
    kind: "missing_fact",
    expect: (e) => e.some((x) => /fact .*provenance/i.test(x)),
  },
  {
    kind: "post_cancel_dispatch",
    expect: (e) => e.some((x) => /dispatch after cancel/i.test(x)),
  },
];

for (const c of cases) {
  const t = tamperPackByKind(base, c.kind);
  const v = verifyEvidencePack(t);
  assert(!v.ok, `${c.kind} must FAIL`);
  assert(c.expect(v.errors), `${c.kind} expected error missing: ${v.errors.join("; ")}`);
  console.log(`tamper ${c.kind}: FAIL as expected · badge.chain=${v.badge.chain}`);
}

const empty = structuredClone(base);
empty.events = [];
empty.ledger_summary = [];
empty.facts = [];
const emptyVerification = verifyEvidencePack(empty);
assert(!emptyVerification.ok, "empty pack must fail");
assert(
  emptyVerification.errors.some((error) => /event stream empty/i.test(error)),
  "empty pack error missing",
);

const omittedLedger = structuredClone(base);
omittedLedger.ledger_summary.shift();
const omittedVerification = verifyEvidencePack(omittedLedger);
assert(!omittedVerification.ok, "ledger omission must fail");
assert(
  omittedVerification.errors.some((error) => /missing from ledger/i.test(error)),
  "ledger omission error missing",
);

const omittedFact = structuredClone(base);
omittedFact.facts.shift();
const omittedFactVerification = verifyEvidencePack(omittedFact);
assert(!omittedFactVerification.ok, "fact omission must fail");
assert(
  omittedFactVerification.errors.some((error) => /recorded fact missing/i.test(error)),
  "fact omission error missing",
);

const wrongMission = structuredClone(base);
if (wrongMission.events[1]) wrongMission.events[1].mission_id = "msn_tampered";
const wrongMissionVerification = verifyEvidencePack(wrongMission);
assert(!wrongMissionVerification.ok, "event mission reassignment must fail");
assert(
  wrongMissionVerification.errors.some((error) => /mission_id mismatch/i.test(error)),
  "event mission mismatch error missing",
);

console.log(
  JSON.stringify(
    { ok: true, live_calls: 0, cases: cases.length + 4 },
    null,
    2,
  ),
);
