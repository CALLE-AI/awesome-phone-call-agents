import { runMockProof } from "../../src/server/proofs.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const snap = await runMockProof("cross_party");
assert(snap.proof === "cross_party", "kind");
assert(snap.live_calls === 0, "no live");
assert(snap.handoff, "handoff present");
assert(snap.handoff!.fact === "appointment_time", "fact name");
assert(snap.handoff!.practice_outcome === "practice_acknowledged", "practice");
assert(snap.facts.length >= 2, "facts recorded");
assert(snap.verify.ok, "verify");
assert(snap.ledger.every((r) => r.provider_runs <= 1), "runs ≤ 1");

console.log(
  JSON.stringify(
    {
      ok: true,
      live_calls: 0,
      handoff: snap.handoff,
      facts_traceable: snap.verify.facts_traceable,
      ledger: snap.ledger.map((r) => ({
        label: r.label,
        state: r.state,
        outcome: r.outcome,
        provider_runs: r.provider_runs,
      })),
    },
    null,
    2,
  ),
);
