# RevisitZero — Devpost submission draft

## Submission identity

- **Product:** RevisitZero — Meter Access Recovery
- **Category:** Order / exception follow-up
- **Promise:** One failed visit. One controlled call. One trustworthy rebook decision.
- **One-sentence real-world task:** RevisitZero contacts one authorised service recipient after a failed meter-access visit and produces a human-reviewable rebook-readiness recommendation.
- **Repository contribution title:** `feat(apps): add RevisitZero meter-access recovery`
- **Suggested branch:** `feat/revisit-zero-meter-access`
- **Event:** [CALL-E: Your Code Is Calling](https://call-e.devpost.com/)

## Short description

RevisitZero turns one failed meter-access visit into a safe, auditable rebook recommendation. It applies deterministic eligibility checks, asks an operator to approve one exact CALL-E conversation, validates only a closed structured result, and stops at a human-approved local export packet.

## The problem

A technician can arrive ready to work and still leave because a gate is locked, a dog is unsecured, an obstruction remains, or nobody can provide access. Rebooking immediately risks another failed visit. Uncontrolled outreach, however, can create privacy, safety, consent and operational risks.

RevisitZero handles the narrow gap between those two choices. It does not automate field-service operations. It collects only the minimum structured facts needed to decide whether a case is ready for a human rebook review.

## What it does

1. Reads a fictional failed-visit case.
2. Applies a deterministic pre-call gate. Safety defects, vulnerability, emergency, disputes, missing authorisation, invalid numbers and expired windows are blocked or routed to manual review.
3. Shows the operator the exact recipient, objective, allowed questions and offered windows.
4. Records content-bound approval. Editing any bound field invalidates that approval.
5. In controlled live mode, allows one CALL-E attempt to one consenting test recipient. The default demo uses a fake transport and makes no call.
6. Strictly validates a closed structured response and detects contradictions.
7. Produces a deterministic disposition. Unknown, malformed or conflicting information can never become ready.
8. Requires a separate human decision before downloading a local JSON export packet.

It never books an appointment, updates a CRM, contacts a body corporate, sends a notification, retries automatically or collects a gate code.

## The three-case demo

- **MTR-2026-0042 — ready:** A locked side gate and unsecured dog prevented a smart-meter replacement. In fake mode the authorised contact confirms the gate will be unlocked, dog secured, obstruction removed and adult presence arranged, then selects Thursday 12pm–4pm. The validated disposition is `READY_FOR_REBOOK_REVIEW`.
- **MTR-2026-0043 — manual:** A shared locked meter room is controlled by a body corporate. RevisitZero will not broaden the recipient or contact an external access party. It returns `MANUAL_REVIEW` without a call.
- **MTR-2026-0044 — blocked:** A suspected electrical/site defect is detected by the pre-call safety gate. It returns `AUTOMATION_BLOCKED` before approval or contact.

## How CALL-E is used

The CALL-E boundary is intentionally small: one outbound conversation to one pre-authorised recipient, using an exact operator-approved objective and closed question set. A stable idempotency key prevents duplicate attempts. Ambiguous provider outcomes are preserved for reconciliation and never trigger an automatic redial.

The public demo runs in fake/no-call mode, so judges need no credentials and no real person is contacted. Controlled live mode is server-side, disabled by default, and requires explicit configuration, Bearer authentication for one server-authorized operator, an open call window, fresh exact-content approval and a consenting test recipient. Client-supplied operator identity or live-approval flags cannot authorize dispatch. On 2026-08-16, one participant-authorised controlled-live test completed at the provider; RevisitZero rejected a contradictory opt-out/outcome result, routed it to `MANUAL_REVIEW`, blocked export, and prevented a duplicate call. The corrective pass removed the redundant provider field, made `contactOutcome` authoritative, derived local opt-out state, bound exact outcome rules into approval, and added regression coverage. The test verifies the live boundary and fail-closed behavior, but not a golden-path end-to-end result.

## Safety, privacy and human control

RevisitZero is deterministic where it matters. Policy checks and the final disposition are local rules, not model judgements. The accepted result schema excludes names, addresses, account numbers, gate or security codes, passwords, payment or banking data, medical data, photos and free-form personal narratives. The provider schema uses only the documented CALL-E subset: explicit types, no unions, a one-value string enum for the schema version, and exact approved window IDs plus `NONE`. `NONE` normalizes locally to no selected window; unapproved window strings fail strict validation. Phone numbers are masked in the workbench.

Opt-out creates a suppression record for future automated contact. A qualified human owns every manual or safety exception. Even a ready result is only `READY_FOR_REBOOK_REVIEW`; an operator still decides whether to export the packet. The system stops there.

## Judging-criteria narrative

### Real World Impact

The product targets a common, costly exception without pretending to solve the whole utility workflow. It helps an operator distinguish a genuinely recoverable access case from one requiring a human or safety process, reducing the chance of a preventable repeat visit.

### Quality of the Idea

The distinctive idea is not “AI makes a call.” It is a content-bound, one-attempt control system around a call: deterministic eligibility, exact approval, minimal structured collection, contradiction detection, idempotency, opt-out suppression and a separate export approval. The two refusal cases are part of the product, not edge cases hidden from the demo.

### Technical Implementation

RevisitZero imports the official CALL-E TypeScript runtime and implements a controlled live adapter that can invoke it only after every live-mode guard passes. The default judged path injects a fake transport, so no credentials or phone call are required. The full suite passes 71 tests, including 34 isolated adapter tests, 43 focused adapter-plus-validation tests, and 6 live-authorization cases covering request construction, exact dispatch-bound idempotency, Bearer authentication, server-attributed operator identity, the supported provider-schema subset, authoritative contact outcome and derived local opt-out, exact outcome instructions, provider-wire mismatch rejection, exact-window/`NONE` normalization, unapproved-window rejection, and provider-state handling without contacting CALL-E. Because the Calls contract does not enumerate `failureCode`, all failed or cancelled Calls states are quarantined for reconciliation rather than inferred to be unreachable; candidate, unknown, mixed, and contradictory strings all fail closed. Both transports use the exact approved payload; the provider key binds the normalized recipient, generated task, locale, result schema, and approval receipt. The app submits one task for one recipient/phone and never resubmits; any response showing multiple attempts is quarantined. Ambiguity can never trigger an automatic redial. Strict runtime validation protects the deterministic decision layer from malformed or contradictory results. The participant-authorised live test verified a single provider attempt and the fail-closed boundary; its contradictory structured result was not accepted as a successful golden-path outcome, and the corrective contract is now regression-tested offline.

### Product Experience & Demo

The one-page desktop workbench keeps source evidence, call controls and the resulting decision visible at the same time. The three demo cases show the happy path and, more importantly, two credible refusals. Safety status, fake-mode status and side effects are explicit rather than hidden in settings.

The repository includes a credential-free fake demo, focused automated tests, a production build, controlled-live documentation and an evidence matrix. A reviewer can reproduce all three outcomes without real customer data or external side effects.

## Testing access and instructions

No account, phone number or CALL-E credential is required for the judged demo.

1. Install the project with the repository-documented package command.
2. Start the demo and open the local URL shown in the terminal.
3. Select **MTR-2026-0042**, approve the exact call preview, and run the fake CALL-E transport.
4. Confirm the structured result is valid and the disposition is `READY_FOR_REBOOK_REVIEW`.
5. Approve the local export and inspect the downloaded fictional JSON packet.
6. Select **MTR-2026-0043** and confirm it stops at `MANUAL_REVIEW` without a call.
7. Select **MTR-2026-0044** and confirm it stops at `AUTOMATION_BLOCKED` before approval.
8. Run the repository-documented test and build commands.

Use only the included fictional data. Do not enable controlled live mode for judging.

## Architecture image and screenshot plan

Primary architecture graphic, designed for a 16:9 Devpost image:

`Failed visit → deterministic gate → exact operator approval → CALL-E adapter (fake by default) → strict schema + contradiction checks → deterministic recommendation → human export decision`

Place three guardrail labels under the flow: **one recipient / one attempt**, **closed non-sensitive result**, **stops at local export**. Use muted green for completed/control stages, amber for human checkpoints and red only for blocked safety paths.

Capture these product images at 1440×900 or larger:

1. **Hero / ready case:** Full three-column workbench after fake result validation, with `READY_FOR_REBOOK_REVIEW`, masked recipient and pending export approval visible.
2. **Exact approval:** Crop of the call preview showing objective, allowed questions, “never collect,” one-attempt limit and content-bound receipt.
3. **Manual boundary:** Case 2 with `MANUAL_REVIEW_REQUIRED`, body-corporate explanation and “Call unavailable.”
4. **Safety boundary:** Case 3 with `AUTOMATION_BLOCKED`, suspected defect reason and no approval controls.
5. **Evidence:** Test runner and successful production build side-by-side, with no credentials or customer data visible.

Before capture: use the fake/no-call banner, reset Case 1 to the intended state, close unrelated browser tabs and notifications, and inspect every frame for secrets or real identifiers.

## Limitations

- English-only and desktop-only.
- Exactly one authorised recipient and at most one controlled call per case.
- No technical diagnosis or scheduling action.
- No CRM, retailer, field-service, landlord or body-corporate integration.
- No SMS, email, inbound calls, multilingual flow, bulk calling or automatic retry.
- Live mode is for a consenting test recipient only and is not required for the public demo.

## Suggested Devpost gallery copy

- **Hero:** “One screen keeps the source failure, controlled contact and human decision in view.”
- **Approval:** “The operator approves the exact call—not a general permission to contact.”
- **Safe refusal:** “RevisitZero’s most important outputs are sometimes ‘manual’ and ‘blocked.’”
- **Auditability:** “A closed result, deterministic reasons and stable references make the recommendation reviewable.”

## User-owned publication steps

- Record and upload the public demo video.
- Confirm the final public repository and contribution URL.
- Add the official team/member details, hackathon-specific links and required declarations in Devpost.
- Enable a real call only if the user separately authorises it and provides a consenting test recipient, credentials and a current call window.
- Submit Devpost and open/publish the repository PR only after explicit user approval.

## Devpost form completion checklist

The [Official Rules](https://call-e.devpost.com/rules) list a submission deadline of **September 14, 2026 at 11:45 AM SGT** (September 14 at 1:45 PM Melbourne/AEST). Devpost’s structured key-date value conflicts and indicates 11:45 PM SGT; because the Rules say they prevail, target the earlier Rules deadline.

Project-supplied fields:

- **App status:** Newly created
- **If pre-existing, explain what you updated during the submission period:** Not applicable—newly created during the submission period.
- **Which best describes the primary use case your project addresses?:** Order / exception follow-up
- **In one sentence, what real-world task does your CALL-E application handle?:** RevisitZero contacts one authorised service recipient after a failed meter-access visit and produces a human-reviewable rebook-readiness recommendation.
- **Testing instructions for application:** Use the credential-free steps in “Testing access and instructions” above.
- **Text description:** Use the short description, problem, workflow and judging narrative above.
- **Public demonstration video:** YouTube or Vimeo, under three minutes; use the 2:45 storyboard in `docs/demo-script.md`.

User-owned fields that must not be invented:

- Submitter Type.
- Country of residence/incorporation.
- Organization name, if applicable.
- Eligible Age attestation.
- Country eligibility attestation.
- Conflict of interest attestation.
- Email address associated with the user’s CALL-E account.
- Public pull-request URL for the contribution to `CALLE-AI/awesome-phone-call-agents`.
- Public YouTube or Vimeo URL.
- Optional functional demo URL, if the user chooses to host one.
