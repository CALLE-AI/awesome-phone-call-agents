# PourReady — CALL-E Devpost submission packet

This file is the final copy source for the CALL-E Devpost entry. It is intentionally honest about what is deterministic, what has been verified, and what is still pending.

## Title

PourReady

## One-line summary

PourReady is a human-controlled pre-pour coordination gate: CALL-E calls four authorized concrete-operation roles, reconciles their explicit answers into `ALIGNED`, `CONFLICT`, or `INCOMPLETE`, and leaves Proceed or Hold to a human.

## Problem

A concrete pour is an expensive chain of verbal commitments. The schedule can look green while the site, supplier, pump, and tester are each working from a different version of the plan. One late pump can leave trucks waiting and concrete aging past its placement window.

The coordination burden is visible in published industry material. The Australian concrete-operations training standard covers placing, compacting, finishing, and curing with explicit sequencing requirements. The Cement Concrete & Aggregates Australia pump delivery guidelines define a shared vocabulary of site, supplier, and pump responsibilities before concrete moves. Planning and scheduling tooling exists for the plan on paper, but the morning-of verbal confirmation still happens by phone.

References: [Australian training standard](https://training.gov.au/TrainingComponentFiles/CPC/CPCCCO4001_R2.pdf), [CCAA concrete pump delivery guidelines](https://www.ccaa.com.au/CCAA/CCAA/Docs/Industry/Concrete_Pump_Delivery_Guidelines.aspx), and [Planning Ops scheduling alternative](https://planningops.com/). These sources establish the problem class; they do **not** prove that any operator will accept a disclosed AI coordination call. That remains an empirical product question, tracked in `docs/market-validation.md`.

## Solution

Before any side effect, the operator defines one shared pour plan (project, location, date, time, volume, mix reference, AU/SG region) and four role contacts, then inspects four bounded role-specific call previews. Each preview shows exactly which coordination questions CALL-E will ask and states the authority boundary: CALL-E reports existing facts only and never changes an order, approves safety or engineering, makes a financial commitment, or issues a go/no-go decision.

On an authorized run, `POST /api/runs` validates the plan, region-matching E.164 numbers, exactly four unique roles, and explicit live confirmation, then creates four independent CALL-E calls with stable idempotency keys (`pour-ready:<run-id>:<role>`). The client polls `GET /api/calls/:callId`, which checks caller-owned run metadata and returns only lifecycle state, strict structured result, confidence, redacted evidence, redacted transcript turns, and the masked destination. Raw tasks, unmasked recipients, provider messages, and credentials are never exposed.

Every result is parsed by a fail-closed contract: seven required fields, no additional properties, enum-only values, cross-field consistency (a non-`reached` contact cannot carry a commitment, alignment, or scope verdict), a non-empty evidence summary, and a blocker or reported time whenever a schedule conflict is claimed. A wrong contact, voicemail, failed call, missing result, unknown answer, or confidence below `high` is `INCOMPLETE`; the app never guesses. The board then shows `ALIGNED` when every role confirmed, `CONFLICT` with the contradiction explained and the supporting evidence opened, or `INCOMPLETE` when evidence is missing. A supervisor records Proceed or Hold as a timestamped audit event through the normal safety process.

## Why this matters

The value is not "AI can make calls." The value is making hidden verbal disagreement visible early enough to act on. In the golden demo, three roles confirm 06:30 while the pump operator explicitly reports 08:00 because of an earlier job. Without the gate, that contradiction surfaces when trucks are already staged. Pre-pour concrete is the wedge; the same four-call coordination pattern applies anywhere one operation depends on multiple external parties agreeing to the same plan.

## What is technically non-trivial

- Published CALL-E TypeScript SDK (`@call-e/calle@0.2.2`) on the real execution path.
- Bounded role-specific call tasks with AI disclosure, contact verification, and a wrong-person exit that never requests another number.
- Strict seven-field result schema enforced on both the CALL-E side and the application side with cross-field consistency checks.
- Stable idempotency keys derived from run id plus role; partial dispatch failures returned beside successful, recoverable call IDs.
- Run-ownership check on every poll: a call ID is only readable with its matching run id.
- Fail-closed reconciliation: unknown outcomes are a state (`INCOMPLETE`), never an error to retry; no automatic retries exist anywhere.
- Live calls disabled by default behind both a server flag and an explicit UI authorization for four owned or authorized numbers.
- Phone numbers never persist in the browser; redaction applied to evidence and transcript turns; masked destinations everywhere.
- Default tests, the golden demo, and the judge path require no credentials, network, or real call.

## Distinction from existing CALL-E projects

A current search of the official contribution repository found no pre-pour or construction-coordination contribution; the substantive novelty is the multi-party reconcile-to-one-plan verdict (`ALIGNED` / `CONFLICT` / `INCOMPLETE`) with a human-owned hold decision, rather than a single confirmation or a dispatch handoff. Scope-adjacent work differs in mechanism: appointment scheduling confirms one time with everybody, service dispatch asks one vendor about availability and cost, and survey runners standardize data collection. PourReady asks four independent parties to report facts about an already-fixed plan and refuses to let any phone answer become a proceed decision.

## Product experience

The app is a three-stage Next.js flow:

1. **Pour setup** — one fictional pour plan plus four named role contacts. Phone fields are live-only and labeled as such.
2. **Preview & authorize** — dry-run versus live mode switch, four per-role call previews with bounded questions, the authority boundary, and (live only) the explicit four-number authorization checkbox.
3. **Readiness board** — the `ALIGNED` / `CONFLICT` / `INCOMPLETE` verdict, the conflict strip, four role cards with commitment, reported time, schedule alignment, confidence, blocker, evidence summary, and expandable supporting evidence, plus the human control point that records Proceed or Hold as a timestamped audit event.

The deterministic golden demo animates queued → calling → completed across the four cards and lands on `CONFLICT` (pump 08:00 vs planned 06:30) with the pump evidence opened.

## Testing instructions

1. Clone the contribution branch and enter `apps/typescript/pour-ready`.
2. Use Node.js 22+.
3. Run `npm install --legacy-peer-deps`.
4. Run `npm run validate` (typecheck, lint, 22 tests, production build); no credentials or network needed.
5. Run `npm run dev` and open `http://localhost:3000`.
6. Keep **Dry-run** selected, complete the fictional pour plan, preview the four role-specific plans, and run the golden demo. No credential is read and no call is placed.
7. For live verification, follow the opt-in steps in the app README using exactly four owned or authorized AU (`+61`) or SG (`+65`) numbers. Do not use a random public number for testing.

## Demo video outline — target 2:40

**0:00–0:25 — Failure mode.** A pour is a chain of verbal commitments; the plan looks green while four parties hold four versions of it. Show the fictional Harbour Point pour: Singapore, 06:30, 85 m³, C40 / P-217.

**0:25–1:00 — Inspect before any side effect.** Open **Preview call plan**. Each role gets a bounded checklist; show the automated-assistant disclosure and the authority boundary. Show the masked destinations and the explicit authorization checkbox (dry-run selected for the repeatable path).

**1:00–1:30 — CALL-E at runtime.** Start the run; the four cards move through queued, calling, completed. If a controlled authorized live excerpt exists, play the disclosure plus one bounded confirmation here. Never display an unmasked number or credential.

**1:30–2:05 — Reveal the contradiction.** The board changes to `CONFLICT`: site, dispatch, and testing report 06:30; the pump operator explicitly reports 08:00. Open the pump evidence. State: this is not an AI forecast; it is the contact's reported commitment in a strict schema, linked to redacted evidence.

**2:05–2:25 — Human control and reliability.** Select **Hold**; show the timestamped audit event. Show the fail-closed path: voicemail or low confidence becomes `INCOMPLETE`, partial dispatch failures surface without auto-retry, and repeat runs reuse stable idempotency keys.

**2:25–2:40 — Wedge and boundary.** Pre-pour concrete is the wedge; the pattern generalizes to any operation depending on multiple parties agreeing to one plan. Close with evidence-backed demand, separating published requirements from interview results. Claim no authorized live call or customer interview that has not actually happened.

## Screenshot shot list

1. Hero: "Before the trucks roll, align every voice" with the golden-demo stamp.
2. Preview grid showing the four bounded per-role call plans and the authority boundary.
3. Live-mode preview with masked destinations and the explicit authorization checkbox.
4. Readiness board on `CONFLICT` with the conflict strip (pump 08:00 vs 06:30).
5. Open supporting evidence on the pump card (redacted).
6. Human control point with the timestamped Hold audit event.
7. Test/build proof (`npm run validate` green).
8. Optional: redacted authorized live-call excerpt, only if obtained from controlled actors.

## Official CALL-E form fields

- **Submitter Type:** Individual
- **Country of residence/incorporation:** TODO — user must supply the truthful country value used for eligibility.
- **Organization name:** leave blank unless applicable.
- **App status:** Newly created
- **If pre-existing, explain updates:** Not applicable — PourReady was newly created during the submission period.
- **Testing instructions for application:** use the Testing instructions section above.
- **Functional demo URL:** optional; TODO if a hosted dry-run build is published.
- **Project submission pull request URL:** TODO — required upstream PR into `CALLE-AI/awesome-phone-call-agents`; no upstream PR is open yet.
- **Email associated with CALL-E account:** TODO — confirm the actual CALL-E account email; do not infer it from Devpost email.
- **Primary use case:** TODO — suggested: Workflow & back-office automation (confirm against the live Devpost category list).
- **One-sentence real-world task:** Calls four authorized concrete-pour roles to confirm one shared plan and surfaces verbal contradictions with redacted evidence before a supervisor decides proceed or hold.
- **Eligible Age / Country eligibility / Conflict of interest:** user must affirm truthfully on Devpost.

## Current evidence status

- `npm run validate`: green — typecheck, lint, 22/22 tests, production build.
- Repository-level `Validate` workflow (`python scripts/validate_repository.py`): passed.
- Production smoke test: home renders 200; both live endpoints return 403 with live calls disabled.
- Golden dry-run demo: implemented and demo-scripted; no-call by default.
- Authorized live CALL-E calls: 0 — no live excerpt claimed.
- Market interviews: 0 of 5 — demand remains evidence-backed but unvalidated; no traction claim is made.
- Demo video: not recorded.
- Upstream PR: not opened.
- Public demo URL: none.

## Final readiness gates

Before final Devpost submission: run one authorized live-call excerpt with controlled actors and four owned/authorized numbers; record/upload the sub-3-minute public video; open the required upstream PR and paste its URL; confirm truthful country and CALL-E account email; complete at least the first market interviews or keep the demand claim honestly labeled as unvalidated; and verify that screenshots, video, logs, fixtures, and commits contain no secrets or private phone data.
