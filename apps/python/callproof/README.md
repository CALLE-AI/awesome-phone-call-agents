# CallProof

CallProof is an authority-aware operational verification app built for CALL-E. It turns a specific real-world assumption into one of three bounded outcomes: `VERIFIED`, `CONTRADICTED`, or `UNRESOLVED`.

The key design rule is simple: **a completed phone call is not proof**. CallProof only upgrades a claim when the answer is direct and the person answering is authoritative for that fact. Otherwise it abstains.

## Why this exists

Operational plans routinely depend on facts that are difficult to settle through web data or internal systems alone: access windows, site permissions, delivery constraints, approval status, dispatch readiness, and similar last-mile conditions.

CallProof uses CALL-E to ask the accountable real world, then separates:

- whether the claim itself was established;
- whether the recipient was authoritative;
- evidence quality;
- material qualifiers or conditions; and
- confidence in the returned evidence/result.

That means a result can correctly be **high-confidence `UNRESOLVED`** when the recipient clearly says they cannot authoritatively confirm the claim.

## Core loop

```text
CLAIM -> CALL-E -> WARRANT
```

1. State one operational claim precisely enough that the answer changes what happens next.
2. CALL-E contacts the nominated operational recipient and asks only what is needed to test the claim.
3. CallProof returns `VERIFIED`, `CONTRADICTED`, or `UNRESOLVED`, with authority, evidence quality, qualifiers, confidence and provenance.

## Run locally

Python 3.11+ is recommended.

```bash
cd apps/python/callproof
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

On Windows PowerShell you can instead run:

```powershell
.\run.ps1
```

Then open `http://127.0.0.1:8000`.

The **Production scenario** and **Recorded live proof** modes are no-call paths and work without credentials.

## Live CALL-E mode

Live Developer API calls require a server-side CALL-E credential:

```bash
export CALLE_API_KEY="..."
```

or in PowerShell:

```powershell
$env:CALLE_API_KEY="..."
```

The live UI requires an operator-supplied E.164 phone number plus region and locale. Only use a number you are authorized to contact and a region/language combination currently supported by CALL-E. Example displays use masked phone placeholders rather than real personal numbers.

Live requests are loopback-only and require a fresh recipient-authorization checkbox for each run (`authorized: true` for local API clients). Do not expose the live endpoint through a tunnel or reverse proxy. This local operator demo is not a remotely hosted calling service. Displayed live results mask phone numbers, and provider error bodies are not returned to the browser.

A live verification creates a real outbound phone call and may consume CALL-E quota or billable usage. Review the claim, contact, region and locale before dispatch.

## Result contract

The CALL-E recipient result schema captures:

- `claim_status`: `confirmed`, `contradicted`, or `unknown`;
- `answer`: concise factual answer;
- `authority_status`: `authoritative`, `non_authoritative`, or `unknown`;
- `evidence_quality`: `direct`, `qualified`, or `insufficient`; and
- `qualifier`: any material condition, dependency or approval requirement.

The deterministic warrant policy is intentionally conservative:

- `VERIFIED` requires an authoritative recipient plus direct confirmation.
- `CONTRADICTED` requires an authoritative recipient plus direct or materially qualified contradiction.
- everything else is `UNRESOLVED`.

Result confidence is confidence in the evidence/result, not a probability that the claim itself is true.

## Example

Claim:

> A 7.5-tonne production vehicle may enter the site at 05:30 tomorrow.

A site contact says normal access starts at 06:00 and earlier access requires written duty-manager approval. Because the contact is authoritative and the answer directly rejects the 05:30 assumption, CallProof returns `CONTRADICTED` and preserves the approval condition as a material qualifier.

## Recorded live CALL-E proof

The app includes a sanitized replay of a real CALL-E MCP run against the official hackathon test hotline.

The test claim was:

> The verification call successfully reached the test endpoint.

The call connected, but the hotline explicitly said it could identify itself only as a general inbound test hotline and could not confirm the stronger claim about a specific test endpoint. CALL-E completed the task with 0.90 (`high`) result confidence.

CallProof therefore returns:

```text
UNRESOLVED
Result confidence: 90%
Authority: non_authoritative
Evidence: insufficient
```

This is intentional: successful contact is not automatically evidence for the claim being tested.

## Side effects, cancellation and rollback

- **Production scenario:** deterministic, no call.
- **Recorded live proof:** fixture replay, no call.
- **Live verification:** creates a real outbound CALL-E call after the operator clicks the live action.
- CallProof does **not** implement post-dispatch cancellation or rollback. Treat dispatch as the side-effect boundary and do not start a live call unless the recipient, claim and routing inputs are ready.
- If infrastructure fails or the recipient is non-authoritative, ambiguous or unable to confirm, the app does not promote that failure into a positive claim verdict.
- After a timeout or unknown provider outcome, stop and reconcile in the CALL-E dashboard before requesting another call; refreshing the UI does not cancel an accepted call.

## Safety boundaries

- Live calls require explicit operator action; there are no hidden or recurring schedules.
- Only call numbers the operator is authorized to contact.
- Credentials remain server-side in `CALLE_API_KEY` and are never shown in the browser UI or fixtures.
- A call connecting is never treated as evidence that the claim is true.
- Non-authoritative, ambiguous, failed or insufficient outcomes resolve to `UNRESOLVED`.
- Material qualifiers are surfaced rather than silently flattened into a yes/no result.
- CallProof does not make legal, medical, financial, emergency, identity or other high-stakes personal decisions.

## Validation

```bash
python -m unittest test_verdicts.py test_safety.py
```

The tests cover authority gating, direct verification, contradiction, ambiguity, qualified evidence and high-confidence unresolved results.

## Standalone source

The standalone prototype, submission material and development history live at:

https://github.com/adamblackoak/tool_shed/tree/main/callproof
