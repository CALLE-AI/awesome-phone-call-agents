# Kol

Kol is an evidence gate for healthcare claim-status calls. CALL-E can navigate a payer phone tree and return structured fields; Kol decides whether those fields are safe to enter into a financial record.

The narrow failure Kol targets is a correctly shaped, confidently wrong result: the call reached provider services instead of claims, never asked the claim-specific question, invented a payment amount, or replayed a stale keypress route. A completed call is therefore not automatically a verified call.

## What is functional

- `npm run demo` replays four fictional calls without credentials or network access.
- `npm run eval` runs 640 deterministic cases across eight families: clean paid, clean denied, fabricated amount, wrong department, question never asked, route mismatch, missing independent route receipt, and low confidence.
- `npm run live -- ...` calls the CALL-E Developer API at runtime with a strict healthcare `result_schema`, polls the call, stores the response locally, and evaluates its evidence.
- The verifier requires the claim-specific question in the agent transcript, the claim reference and every financial field in payer speech, a payer-side department marker, and an independent route receipt.
- Model-reported keypresses are not allowed to verify themselves. Without a fixture log, decoded DTMF audio, or provider event, the result is held for review.

The included synthetic corpus currently accepts 160/160 supported cases and withholds 480/480 unsafe or incomplete cases. This measures the deterministic verifier on constructed fixtures; it is not a production accuracy, payer coverage, or clinical-safety claim.

## Quick start: no call

Requires Node.js 22.18 or newer.

```bash
npm install
npm run validate
npm run demo
```

The default command never places a phone call. Every fixture, payer, person, claim reference, and amount is fictional.

## Live CALL-E test

Copy `.env.example` to `.env`, add the API key from the CALL-E dashboard, and use only a phone line you own or are explicitly authorised to test. The destination must be supplied twice and match exactly:

```bash
npm run live -- \
  --to +1-202-555-0147 \
  --authorise +1-202-555-0147 \
  --claim 4417 \
  --department "claims status department" \
  --route 2,1
```

`+1-202-555-0147` is a reserved fictional example and must be replaced by an owned fixture number. The live path calls `POST /v1/calls`, then read-only `GET /v1/calls/{id}` polling. It can incur CALL-E and carrier charges and can ring another party. The POST has a stable hourly idempotency key and is deliberately not retried after an ambiguous network outcome. Check the CALL-E dashboard before retrying.

CALL-E does not expose a cancellation operation in the public Developer API used here. Closing the terminal only stops local polling; it does not cancel a call already accepted by CALL-E. There are no recurring jobs to disable or roll back.

## Output and evidence

Live responses are written to `artifacts/`, which is gitignored. Those files can contain transcripts and identifiers. Keep them encrypted and access-controlled, apply a retention policy, and never commit them. The CLI masks destination numbers in normal logs and never prints the API key.

The live CLI intentionally produces `needs_review` when it has only CALL-E's reported menu path. For a fixture-backed demonstration, attach the fixture's own DTMF log as a `RouteReceipt` before calling `verifyClaimOutcome`. Production adapters can instead use decoded call audio or a provider event only after validating that it is independent of the model-generated result.

## Safety and scope

Kol is a hackathon prototype, not a HIPAA-compliant service, medical device, clearinghouse integration, or substitute for a biller. Do not send PHI, member IDs, dates of birth, or real claim data through this repository. A production deployment needs legal review, payer authorisation, appropriate agreements, encryption, access controls, audit retention, incident response, and human review policy.

Kol never submits an appeal, changes a claim, posts a payment, accepts an offer, or represents an inferred next action as payer testimony. Unreachable, incomplete, low-confidence, or contradictory results are fail-closed.

## Project links

- Product source and interface: <https://github.com/N-45div/kol>
- Live Vercel demo: <https://kol-verified-payer-calls.vercel.app>
- CALL-E Developer API: <https://github.com/CALLE-AI/call-e-integrations>

The project motivation is based on the documented cost of manual claim-status calls. The separate trust problem - whether billing teams are currently harmed by wrong AI answers - remains a product hypothesis until validated in interviews with revenue-cycle operators.
