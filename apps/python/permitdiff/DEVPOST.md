# PermitDiff — CALL-E Devpost submission packet

This file is the final copy source for the CALL-E Devpost entry. It keeps the core authority boundary explicit: phone evidence may reveal a discrepancy, but it never becomes permit truth.

## Title

PermitDiff

## One-line summary

PermitDiff calls a permit office only when a captured municipal record is stale or conflicting, binds CALL-E evidence to that exact snapshot, and surfaces discrepancies without letting a phone answer rewrite the official permit state.

## Problem

Applicant-side construction teams already have permit portals. The expensive cases are the exceptions: a portal record is stale, another communication conflicts with it, or the next procedural step is unclear. A human then stops work, calls the office, repeats the permit identifier, writes down status/missing-items/next-step notes, and still has to decide whether the official record actually changed.

A generic AI phone caller is not enough. If it calls every time, it creates unnecessary interruptions and cost. If it treats what one staff member says on the phone as authoritative permit state, it creates a worse failure: apparent automation that silently transfers legal/administrative authority to an unverified conversation.

The workflow complexity is visible in current municipal systems. Los Angeles Bureau of Engineering instructs staff to review its “Unprocessed Permits” queue several times during the day. Fairfax County publishes permit processing metrics and explicitly tells applicants to contact the department when a current task exceeds the shown timeframe. Miami exposes permit state across iBuild and ProjectDox, with separate plan-history, review-status, event, routing-slip, comments, and review-detail views, plus an email escalation path when a user cannot access project status. San Diego publishes an explicit mapping between internal workflow task status and applicant-visible record status.

References: [Los Angeles A-Permit staff workflow](https://permitmanual.engineering.lacity.gov/construction-permits/technical-procedures/01-b-how-process-permit-staff-review), [Fairfax County development-review metrics](https://www.fairfaxcounty.gov/plan2build/development-review-metrics), [City of Miami permit-status workflow](https://www.miami.gov/Permits-Construction/Permitting-Resources/Track-the-Status-of-a-Permit-Application), and [City of San Diego workflow/status mapping](https://www.sandiego.gov/development-services/permits/workflowrecord-status-mapping-and-definitions).

These sources do **not** prove that every contractor repeatedly calls permit offices or that PermitDiff saves time. They establish that real permitting environments contain queues, time thresholds, multiple status layers, and applicant escalation paths — exactly the exception class this project is designed to reconcile. Pilot impact must still be measured separately.

## Solution

PermitDiff first evaluates a deterministic no-call gate against a frozen portal snapshot. Fresh record with no explicit conflict means no call. A future/inconsistent timestamp fails closed for data review. Only staleness or an explicit applicant-side discrepancy makes one authorized CALL-E call eligible.

For an eligible exception, CALL-E asks only for factual information tied to the exact permit ID: current office-reported status, known missing items, next procedural step, and reported inspection readiness. The task forbids asking staff to approve or accelerate the permit, waive a requirement, interpret law, accept payment, change an inspection, or make a commitment.

The returned result is useful only when it is terminal, complete, sufficiently confident, bound to the accepted CALL-E call ID, exact office destination, jurisdiction, permit ID, and SHA-256 hash of the frozen portal snapshot, with action-driving quotes grounded in recipient-side transcript text.

PermitDiff then computes the diff. Agreement becomes `verified_match`. A grounded difference becomes `discrepancy_detected` with `requires_official_record_confirmation=true`. Even if the phone-reported status is `issued`, PermitDiff does not create an approval claim or rewrite the portal.

## Why this matters

The value starts with calls avoided. CALL-E is used as an exception resolver, not a polling mechanism. That makes the product useful even when the best action is to do nothing.

For real users, the measurable unit is manual exception-handling time displaced while preserving the authority boundary. A real pilot should measure calls avoided by the freshness gate, calls actually placed, answered/no-evidence rates, discrepancies surfaced, operator minutes displaced, and duplicate-call rate. It should not infer permit-speed improvements or approval rates from a small sample.

## What is technically non-trivial

- Deterministic no-call eligibility based on snapshot age and explicit conflict.
- Exact SHA-256 snapshot identity; material portal changes create a new intent.
- Published CALL-E Python SDK on the real execution path.
- Strict CALL-E result schema with bounded operational status vocabulary.
- Exact call ID, destination, jurisdiction, permit ID, and snapshot-hash binding.
- `status_quote` and substantive next-step evidence grounded in recipient-side transcript text.
- Wrong permit ID, refusal, voicemail, low confidence, incomplete schema, mismatched metadata/destination, or ungrounded evidence fail closed.
- Purpose-bound applicant-side authorization plus exact destination allowlist and explicit live-call confirmation.
- Durable SQLite reservation committed before dispatch.
- Ambiguous provider outcome becomes `outcome_unknown`; automated redial is blocked because a timeout does not prove that nobody's phone rang.
- Phone evidence never acquires permit approval authority.

## Distinction from IncidentBridge and generic government-office callers

IncidentBridge gathers vendor-support evidence during an outage. PermitDiff reconciles a frozen municipal/public record against one bounded factual office call. Its trigger is record staleness/conflict, its identity includes the snapshot hash, its output is a record diff, and its downstream authority remains with the municipality or authorized human process.

The architectural distinction from a generic office caller is stronger: PermitDiff tries not to call. A fresh record is a successful no-call outcome, not an incomplete workflow. A current search of the official contribution repository found no directly overlapping permit/municipal reconciliation contribution; the substantive novelty remains the no-call gate plus snapshot-bound evidence and non-transferable authority.

## Product experience

The deterministic browser judge console presents three states in one surface:

1. **Fresh record:** `no_call_needed`; CALL-E visibly not invoked.
2. **Stale + match:** grounded phone evidence agrees with the frozen snapshot; `verified_match`.
3. **Stale + discrepancy:** before/after values and evidence quote are shown; `discrepancy_detected` while official confirmation remains required.

This three-state sequence should be the centre of the demo. Showing only a successful call would erase the project's main differentiation.

## Testing instructions

1. Clone the contribution branch and enter `apps/python/permitdiff`.
2. Use Python 3.11+.
3. Run `python -m pytest -q`; default tests require no credentials or network.
4. Run `python permitdiff.py --request example-request.json`; preview is the default and creates no call.
5. Inspect call eligibility, trigger, masked office destination, snapshot hash, and CALL-E arguments.
6. Open `judge-console.html` locally and click all three states: Fresh record, Stale + match, Stale + discrepancy. The console is deterministic and invokes no network APIs.
7. Read `LIVE-VALIDATION.md` to verify the applicant-side authorization boundary for any real call.
8. For live execution, use only an exact permit case where the participant is actually authorized to make the office inquiry; pass the explicit CLI confirmation and exact allowlist documented in README.

## Demo video outline — target 2:25

**0:00–0:18 — Problem.** Show the console. Explain that portals solve the normal case; stale/conflicting records create manual exception work. Briefly show one municipal workflow reference rather than a market-size slide.

**0:18–0:42 — State 1: do not call.** Click Fresh record. Show `CALL-E NOT CALLED` and `no_call_needed`. State that product value begins with avoiding unnecessary calls.

**0:42–1:08 — State 2: grounded match.** Click Stale + match. Explain that one authorized call becomes eligible only after the record gate. Show permit/snapshot/call/destination/quote binding and `verified_match`.

**1:08–1:38 — State 3: discrepancy without authority transfer.** Click Stale + discrepancy. Highlight portal `reviewing` versus phone `corrections_required`, the grounded quote, and `requires_official_record_confirmation`. State explicitly that even “issued” on the call never becomes automatic permit approval.

**1:38–1:58 — Consequential-call reliability.** Show SQLite reservation and `outcome_unknown` no-redial behavior.

**1:58–2:18 — Technical proof.** Show tests/CI and the published CALL-E SDK runtime path. Mention fail-closed wrong-permit, metadata, destination, confidence, and grounding checks.

**2:18–2:25 — Real pilot boundary.** Show LIVE-VALIDATION.md. State that a real pilot requires an actually authorized applicant-side participant; if none is available, deterministic evidence stays honestly labeled rather than weakening the boundary to manufacture a live badge.

## Screenshot shot list

1. Hero showing Fresh record → `CALL-E NOT CALLED`.
2. Stale + match state with grounded quote and `verified_match`.
3. Stale + discrepancy showing the before/phone-reported after values and official-confirmation requirement.
4. Architecture/preview showing snapshot hash and exact destination binding.
5. Ambiguous-outcome/SQLite duplicate protection.
6. Test/CI proof.
7. One concise municipal-workflow evidence slide/reference.
8. Optional authorized live result only if it exists and can be privacy-minimized.

## Official CALL-E form fields

- **Submitter Type:** Individual
- **Country of residence/incorporation:** TODO — user must supply the truthful country value used for eligibility.
- **Organization name:** leave blank unless applicable.
- **App status:** Newly created
- **If pre-existing, explain updates:** Not applicable — PermitDiff was newly created during the submission period.
- **Testing instructions for application:** use the Testing instructions section above.
- **Functional demo URL:** optional; TODO if a hosted judge console is published.
- **Project submission pull request URL:** TODO — required upstream PR into `CALLE-AI/awesome-phone-call-agents`; staging PR is https://github.com/yangyangnovelist-hub/awesome-phone-call-agents/pull/5 and is not a substitute for the required upstream PR.
- **Email associated with CALL-E account:** TODO — confirm the actual CALL-E account email; do not infer it from Devpost email.
- **Primary use case:** Workflow & back-office automation
- **One-sentence real-world task:** Reconciles stale or conflicting permit-portal snapshots with one authorized evidence-bound CALL-E office call and surfaces discrepancies without changing official permit state.
- **Eligible Age / Country eligibility / Conflict of interest:** user must affirm truthfully on Devpost.

## Current evidence status

- Initial deterministic suite: 15 passing tests, plus reviewer-console contract coverage added later.
- Repository-level `Validate` workflow: passed on staging heads tested before this evidence-only documentation update.
- Staging PR: open, draft, mergeable.
- Authorized real permit pilot: not yet obtained.
- Real CALL-E PermitDiff calls: none should be claimed unless an applicant-side participant with authority over the exact permit case explicitly authorizes the inquiry.

## Final readiness gates

Before final Devpost submission: obtain the required upstream PR URL; confirm truthful country and CALL-E account email; record/upload the <3 minute public video; and include a real result only if it satisfies the LIVE-VALIDATION authorization boundary. If not, keep the deterministic three-state proof clearly labeled rather than weakening the product's authority model.