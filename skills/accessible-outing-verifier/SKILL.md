---
name: accessible-outing-verifier
description: Demonstrates advisory accessibility-planning checks with offline fixtures and a proposed bounded CALL-E workflow; use for exploring unknown or qualified venue claims without making calls.
license: MIT
---

# Accessible Outing Verifier

[#accessible-outing-verifier](#accessible-outing-verifier)

Use this skill when someone is planning an outing to a venue and has non-negotiable physical accessibility constraints (e.g. elevator working today, step-free path, accessible restroom width).

Planning an accessibility-sensitive outing (e.g., for a power wheelchair user, someone who is deaf, or a person with sensory sensitivities) currently relies on static online directory tags ("Wheelchair Accessible").

Where online data exists, it is often one flattened claim that hides daily operational reality:
- **The Elevator Paradox:** A theater website lists an elevator, but is it operating today? Did maintenance sign off on it this morning?
- **The Qualified Guess:** Venue staff may say *"I think the ramp should be clear"* or *"The lift is usually fine"*. For a wheelchair user, a qualified guess can mean being stranded outside or facing physical danger.

The shipped helper reads supplied fixture labels and demonstrates how a `qualified_confirmation` can become `UNKNOWN`. It does not query a venue directory, interpret arbitrary speech, or place a call. The CALL-E schema and steps below are a proposed manual integration pattern, not an implemented live adapter. All findings are experimental and advisory; a person must verify critical conditions with the venue and plan a suitable backup before an outing.

Consult `references/safety.md` for explicit consent rules, phone number validation, and privacy boundaries before initiating any phone call.

## When To Use

[#when-to-use](#when-to-use)

Use this skill for:

- someone planning an outing with non-negotiable physical accessibility requirements
- published accessibility claims that require phone verification of current operational status
- producing an auditable Feasibility Brief (`FEASIBLE`, `NOT FULLY VERIFIED`, or `NOT FEASIBLE`) with direct staff quotes and timestamps

## When Not To Use

[#when-not-to-use](#when-not-to-use)

Do not use this skill to:

- conduct formal ADA or building code compliance audits; this verifies today's operational conditions, not legal certifications
- make repeated nuisance calls to a business; strictly one call per venue per outing plan
- call domestic or personal phone numbers; this is exclusively for public and commercial venues
- place a phone call without the user's explicit consent to the specific question and target phone number

## Safety Boundaries

[#safety-boundaries](#safety-boundaries)

Read `references/safety.md` for full requirements. Core rules:

1. **Offline Only:** Every supported execution evaluates local fixtures. `--real` is unsupported and refused; no socket is opened, no credits are spent, and no phone is dialed.
2. **Demonstrated Demotion Rule:** The fixed example maps `qualified_confirmation` to `UNKNOWN`. It does not detect every hedge, validate an extraction, or establish physical safety.
3. **Proposed Consent Gate:** Any future live integration must request explicit authorization for the exact venue and question before dialing. Printed fixture authorization is not consent.
4. **Data Privacy & Masking:** Use synthetic profiles only. The helper masks the phone field; venue names, persona text and other free text are not a general-purpose privacy filter. A future call must disclose no personal patron or medical details.
5. **Fail-Closed Principle:** If a call fails, times out, or encounters a busy line, the verdict is `NEEDS_HUMAN_REVIEW` or `NOT FULLY VERIFIED`—never an assumed pass.

## Workflow

### 1. Establish Outing Profile & Digital Gap

Define the venue and constraints in a profile JSON:

```json
{
  "venue_name": "The Grand Theater",
  "phone": "+15555550199",
  "persona": "Power Wheelchair User",
  "constraints": [
    { "id": "c1", "category": "daily_operational", "label": "Main Elevator Operating Today", "critical": true },
    { "id": "c2", "category": "static_facility", "label": "Step-Free Main Entrance", "critical": true }
  ]
}
```

### 2. Dry Run First — Always

Run the standalone helper script `scripts/verify-outing.mjs` against offline test fixtures:

```bash
node scripts/verify-outing.mjs --profile assets/sample-outing-request.json
```

See `references/examples.md` for sample command output and scenario verdicts.

### 3. Proposed Bounded CALL-E Verification Pattern

No live runner is included. A future operator-controlled integration can use the schema in `references/calle-task-schema.json`, after confirming an authorized E.164 venue destination and reviewing the exact question. Stop on an unknown submission or result; do not automatically redial. Explain that a submitted call may continue after closing the host. This is information gathering, not emergency assistance, medical advice, or authorization to dispatch a person.

The proposed normalizer would evaluate extracted labels, subject to human verification; the shipped helper demonstrates only the qualified-confirmation fixture:
- `confirmed` -> Constraint marked `PASSED`.
- `qualified_confirmation` (*"I think it should be working..."*) -> Demoted to `UNKNOWN`. Outing verdict: `NOT FULLY VERIFIED`.
- `refuted` (*"Elevator is undergoing repairs today"*) -> Constraint marked `FAILED`. Outing verdict: `NOT FEASIBLE`.
