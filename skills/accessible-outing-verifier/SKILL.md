---
name: accessible-outing-verifier
description: Evaluates physical-world accessibility requirements for an outing by combining digital evidence with bounded CALL-E phone calls, strictly demoting qualified claims to protect patrons.
license: MIT
---

# Accessible Outing Verifier

[#accessible-outing-verifier](#accessible-outing-verifier)

Use this skill when someone is planning an outing to a venue and has non-negotiable physical accessibility constraints (e.g. elevator working today, step-free path, accessible restroom width).

Planning an accessibility-sensitive outing (e.g., for a power wheelchair user, someone who is deaf, or a person with sensory sensitivities) currently relies on static online directory tags ("Wheelchair Accessible").

Where online data exists, it is often one flattened claim that hides daily operational reality:
- **The Elevator Paradox:** A theater website lists an elevator, but is it operating today? Did maintenance sign off on it this morning?
- **The Qualified Guess:** Venue staff may say *"I think the ramp should be clear"* or *"The lift is usually fine"*. For a wheelchair user, a qualified guess can mean being stranded outside or facing physical danger.

This skill bridges the digital gap: it checks digital claims first, pinpoints physical operational gaps, and places at most **one bounded CALL-E phone call** with an explicit schema. Crucially, it routes staff answers through a **deterministic safety demotion engine**—demoting any hedged or qualified answer to `UNKNOWN` to ensure human safety.

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

1. **Dry-Run by Default:** Without `--real`, every execution evaluates offline fixtures. No socket is opened, no credits are spent, and no phone is dialed.
2. **Deterministic Demotion Firewall:** If venue staff answers with uncertainty (*"I think..."*, *"probably"*, *"should be"*), the skill strictly demotes the response from Confirmed to `UNKNOWN (STRICT SAFETY DEMOTION)`. It refuses to guess.
3. **Explicit Consent Gate:** The agent halts after digital gap analysis and requests explicit user authorization before dialing.
4. **Data Privacy & Masking:** Phone numbers are masked in all logs and outputs (e.g., `+1-555-***-0199`). No personal patron data or medical details are disclosed during the call.
5. **Fail-Closed Principle:** If a call fails, times out, or encounters a busy line, the verdict is `NEEDS_HUMAN_REVIEW` or `NOT FULLY VERIFIED`—never an assumed pass.

## Workflow

### 1. Establish Outing Profile & Digital Gap

Define the venue and constraints in a profile JSON:

```json
{
  "venue": "The Grand Theater",
  "phone": "+15555550199",
  "persona": "Power Wheelchair User",
  "constraints": [
    { "id": "c1", "type": "daily_operational", "label": "Main Elevator Operating Today", "critical": true },
    { "id": "c2", "type": "static_facility", "label": "Step-Free Main Entrance", "critical": true }
  ]
}
```

### 2. Dry Run First — Always

Run the standalone helper script `scripts/verify-outing.mjs` against offline test fixtures:

```bash
node scripts/verify-outing.mjs --profile assets/sample-outing-request.json
```

See `references/examples.md` for sample command output and scenario verdicts.

### 3. Place Bounded CALL-E Verification Call

When explicitly authorized, CALL-E dials the venue contact using the schema defined in `references/calle-task-schema.json`:

The deterministic normalizer evaluates the spoken response:
- `confirmed` -> Constraint marked `PASSED`.
- `qualified_confirmation` (*"I think it should be working..."*) -> Demoted to `UNKNOWN`. Outing verdict: `NOT FULLY VERIFIED`.
- `refuted` (*"Elevator is undergoing repairs today"*) -> Constraint marked `FAILED`. Outing verdict: `NOT FEASIBLE`.
