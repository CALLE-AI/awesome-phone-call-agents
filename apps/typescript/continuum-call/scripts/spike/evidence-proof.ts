import {
  tamperEvidencePack,
  verifyEvidencePack,
} from "../../src/runtime/evidence.js";
import { runMockProof } from "../../src/server/proofs.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const snap = await runMockProof("cross_party");
assert(snap.evidence, "evidence pack attached");
const v = verifyEvidencePack(snap.evidence!);
assert(v.ok, `verify failed: ${v.errors.join("; ")}`);
assert(v.illegal_unresolved_unlocks === 0, "illegal unlocks");
assert(v.provider_runs_per_intent_ok, "runs");
assert(v.facts_traceable === "2/2", "facts");
assert(v.badge.dup_runs === "0 dup runs", "badge dup");
assert(v.badge.chain === "chain intact", "badge chain");

const tampered = tamperEvidencePack(snap.evidence!);
const vt = verifyEvidencePack(tampered);
assert(!vt.ok, "tamper must FAIL verify");
assert(vt.badge.chain === "chain BROKEN", "tamper badge chain");
assert(vt.errors.some((e) => /prev_hash|event_hash|mismatch/i.test(e)), "tamper error");

const amb = await runMockProof("ambiguous_block");
const v2 = verifyEvidencePack(amb.evidence!);
assert(v2.ok, `ambiguous pack: ${v2.errors.join("; ")}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      live_calls: 0,
      cross_party: v,
      ambiguous_block: v2,
      tamper_demo: {
        ok: vt.ok,
        badge: vt.badge,
        errors: vt.errors.slice(0, 2),
      },
    },
    null,
    2,
  ),
);
