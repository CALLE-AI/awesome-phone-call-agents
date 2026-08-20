# PermitDiff

**One evidence-bound phone call only when a permit portal record is stale or contradictory.** PermitDiff uses CALL-E as a last-mile discrepancy resolver between a captured municipal portal snapshot and what permit-office staff currently report by phone.

It is not a permit expeditor, legal-advice bot, inspection scheduler, or generic phone automation. PermitDiff is designed around a narrow operational fact: many applicant-side teams can already read the portal, but the costly cases are the ones where the portal is old, another communication conflicts with it, or the next procedural step is unclear. In those cases, a human often calls the office, repeats the permit identifier, writes down status/missing-items/next-step notes, and still has to decide whether the official record actually changed.

PermitDiff automates that bounded evidence-gathering step while keeping municipal authority outside the phone call.

## The invariant

> A phone answer can surface a discrepancy; only the municipality's official record or an authorized human process establishes permit state.

That invariant is encoded in the output. Even if CALL-E hears "issued," PermitDiff does **not** produce `permit_approved=true`. A grounded difference becomes `discrepancy_detected` with `requires_official_record_confirmation=true`.

## Why a call is not the default

A phone call is expensive, interruptive, and sometimes unnecessary. PermitDiff first evaluates a deterministic no-call rule:

- if the portal snapshot is fresh and there is no explicit conflict, **do not call**;
- if the portal timestamp is in the future or otherwise inconsistent, **do not call and inspect the data**;
- if the snapshot exceeds the configured staleness threshold, a call becomes eligible;
- if a separate applicant-side source explicitly conflicts with the portal, a call becomes eligible regardless of age.

The application therefore treats CALL-E as an exception resolver, not as a polling mechanism.

## Core flow

```text
captured permit portal snapshot
          |
          v
staleness / explicit-conflict gate
          |
          +------ fresh, no conflict ------> no call
          |
          v
purpose-bound authorized office call
          |
          v
 durable reservation before dispatch
          |
          v
        CALL-E
          |
          v
terminal structured result
          |
          v
call + permit + snapshot-hash binding
          |
          v
recipient-side quote grounding
          |
          +---------- unknown/refused/unbound ----------> human review / no evidence
          |
          v
compare phone-reported status to frozen portal snapshot
          |
          +---------- same ----------> verified_match
          |
          +---------- different -----> discrepancy_detected
                                         |
                                         v
                              official record confirmation required
```

## What CALL-E asks

After AI disclosure and willingness to continue, the task asks only for facts attached to the exact permit identifier:

- current office-reported status;
- whether known missing items remain;
- the next procedural step; and
- whether the office currently considers the record ready for inspection.

The task explicitly prohibits asking staff to approve or accelerate the permit, waive a requirement, interpret law, accept payment, change an inspection, or make a commitment.

## Evidence binding

A terminal CALL-E result is not trusted merely because it is syntactically valid. PermitDiff checks that:

- the CALL-E call ID is the call accepted for this reserved intent;
- metadata contains the exact jurisdiction, permit ID, and SHA-256 hash of the frozen portal snapshot;
- the office destination is the exact reviewed E.164 number;
- `status_quote` is grounded in recipient-side transcript text;
- if a substantive next step is returned, `next_step_quote` is also grounded in recipient-side transcript text;
- CALL-E reports a terminal success, `task_completed=true`, complete schema, and confidence at or above the local floor;
- the office confirms the exact permit ID.

Anything weaker routes to `needs_human` or `no_phone_evidence` rather than producing a discrepancy claim.

## Ambiguous outcomes and duplicate-call protection

PermitDiff commits a stable reservation to SQLite **before** crossing the real-call boundary. A returned CALL-E ID is then bound to that reservation. If the client loses the result or another exception leaves acceptance ambiguous, the ledger moves to `outcome_unknown` and the same intent cannot automatically dial again.

That is intentional. A timeout describes what this client observed; it does not prove that no phone rang.

## Run without credentials

Requires Python 3.11+.

```bash
cd apps/python/permitdiff
python -m pytest -q
python permitdiff.py --request example-request.json
```

The preview masks the office phone, reports whether a call is recommended, shows the exact trigger and snapshot hash, and emits CALL-E arguments only when the no-call gate says a call is justified.

## Real-call boundary

A real call additionally requires:

```bash
export CALLE_API_KEY="<your key>"
export CALLE_LIVE_CALLS_ENABLED="true"

python permitdiff.py \
  --request request.json \
  --execute \
  --confirm-authorized-office-call \
  --allow +14155550123
```

The request itself must contain `caller_authorized_for_permit: true`; live execution must also pass the explicit CLI confirmation and exact destination allowlist. The CALL-E SDK is imported only after those gates pass. The production origin is pinned; plain HTTP is accepted only for an explicit loopback test server. A loopback test server receives only a fixed non-secret test key; `CALLE_API_KEY` is required and used only for the production origin.

## Input snapshot

`example-request.json` captures the facts PermitDiff is reconciling, including jurisdiction, exact permit ID, a bounded public project reference, portal status, portal update timestamp, portal missing-items summary, portal next step, office phone/region/locale, caller authorization, staleness threshold, and optional explicit discrepancy.

Any material change to those portal facts changes `snapshot_hash` and the stable idempotency identity. A new snapshot is not silently treated as the old call intent.

## Result contract

CALL-E returns exact fields for disclosure/answer disposition, permit-ID confirmation, office status, missing-items status/summary, next procedural step, inspection readiness, two evidence quotes, and notes. Unknown is a valid answer; invented certainty is not.

`office_status` is deliberately a bounded operational vocabulary: `submitted`, `reviewing`, `corrections_required`, `ready_for_inspection`, `issued`, `closed`, or `unknown`. A phone-reported value in this vocabulary is still only phone evidence. It does not supersede the official record.

## Tests

The initial deterministic suite has 15 tests covering stale-record call eligibility, fresh-record call avoidance, explicit discrepancy override, future-timestamp fail-closed behavior, masked no-call preview, exact-match reconciliation without legal overclaim, grounded portal/phone discrepancy detection, metadata/call/transcript binding failures, refusal and voicemail as no evidence, wrong permit-ID refusal, snapshot-hash and idempotency changes, explicit caller authorization, durable duplicate-intent protection, ambiguous provider outcome -> `outcome_unknown` with no redial, and exact result-schema enforcement.

All default tests run without credentials, network access, or a real call.

## Distinction from IncidentBridge and other operational callers

IncidentBridge gathers vendor incident evidence during an outage. PermitDiff reconciles a frozen public/municipal record against a bounded factual office call and computes a discrepancy without transferring authority to the call. The data model, call trigger, evidence contract, output state machine, and downstream authority are different.

The more important distinction is architectural: PermitDiff tries **not to call** when the existing system of record is sufficiently fresh. Its product value is the exception boundary and auditable record diff, not simply the ability to dial a government office.

## Award validation plan

The strongest demo is a three-state sequence rather than a generic happy path:

1. **Fresh portal snapshot:** judge sees that PermitDiff refuses to spend a call.
2. **Stale snapshot with matching office answer:** CALL-E produces grounded evidence and PermitDiff returns `verified_match`, while retaining the official-record authority boundary.
3. **Stale/conflicting snapshot with different office answer:** PermitDiff returns `discrepancy_detected`, shows the frozen before/phone-reported after values and quotes, and refuses to claim that the permit record itself changed.

Real-world dogfooding should report only measured operational units: calls avoided by the freshness gate, calls actually placed, answered/no-evidence rates, discrepancies surfaced, manual operator minutes displaced, and duplicate-call rate. It should not invent permit-approval speedups from a small sample.
