# PermitDiff judge demo — target 2:30

The strongest demo is a three-state proof: first demonstrate that the app refuses an unnecessary call, then show a grounded match, then show a grounded discrepancy that still does not acquire permit authority.

## 0:00–0:18 — The problem

**Screen:** PermitDiff judge console.

**Narration:**

> Teams managing permits already have portals. The expensive cases are the exceptions: the record is stale, another communication conflicts with it, or the procedural next step is unclear. PermitDiff uses CALL-E only for that last-mile discrepancy, not to poll government offices by phone.

## 0:18–0:42 — State one: fresh record means no call

**Screen:** click `1 · Fresh record`; show `no_call_needed` and `CALL-E NOT CALLED`.

**Narration:**

> First, the no-call gate. This portal snapshot is fresh and there is no explicit conflict, so PermitDiff refuses to spend a CALL-E call. The exact portal facts are hashed before any reconciliation.

**Judge point:** the product value begins with calls avoided, not calls placed.

## 0:42–1:08 — State two: stale record, grounded match

**Screen:** click `2 · Stale + match`.

**Narration:**

> When the snapshot is stale or explicitly conflicting, one authorized office call becomes eligible. CALL-E asks only for the exact permit's current factual status, missing items, next procedural step, and reported inspection readiness. The result must bind to the call ID, destination, jurisdiction, permit ID, snapshot hash, and recipient-side transcript quotes.

> Here the grounded phone status still says `reviewing`, so PermitDiff returns `verified_match`.

## 1:08–1:38 — State three: discrepancy without authority escalation

**Screen:** click `3 · Stale + discrepancy`; highlight `reviewing → corrections_required` and the quote.

**Narration:**

> Now the office says corrections are required. PermitDiff surfaces the frozen before value, the phone-reported value, and the evidence quote as `discrepancy_detected`. The important part is what it refuses to do: a phone answer does not rewrite the portal and cannot declare a permit approved, issued, or legally effective. Official-record or authorized human confirmation is still required.

## 1:38–1:58 — Consequential-call reliability

**Screen:** ambiguous outcome policy / test.

**Narration:**

> The call intent is committed to SQLite before dispatch with a stable idempotency identity. If the client times out after CALL-E may already have accepted the call, PermitDiff records `outcome_unknown` and blocks automatic redial. A network error is not evidence that nobody's phone rang.

## 1:58–2:18 — Technical proof

**Screen:** exact schema / tests / CI status.

**Narration:**

> The live transport is the published CALL-E Python SDK. Low-confidence, incomplete, wrong-permit, mismatched metadata, wrong destination, or ungrounded quote results fail closed. The deterministic test suite covers the no-call gate, evidence binding, discrepancy routing, authorization, and ambiguous-outcome duplicate protection, and the repository validator passes without credentials.

## 2:18–2:30 — Real pilot boundary

**Screen:** `LIVE-VALIDATION.md`.

**Narration:**

> A real pilot requires an applicant-side participant authorized for the exact permit. If I cannot obtain that authorization, I keep the demo synthetic rather than weakening the trust boundary to manufacture a live-call claim.

## Recording rules

- Keep the final video under 3:00; target 2:20–2:35.
- The first state must visibly place no call; otherwise the core differentiation is lost.
- Do not show real permit PII, phone numbers, CALL-E credentials, or full transcripts.
- Label deterministic examples as deterministic; do not imply the municipality changed a record.
- If a real authorized call is later available, replace only the middle evidence clip; preserve the same authority boundary.
- End on `discrepancy_detected → official confirmation required`, not on source code.
