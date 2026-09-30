# Fraud Ops Caller

Path: `apps/typescript/fraud-ops-caller`

Hackathon desk for **CALL-E: Your Code Is Calling**. Voice is **execution on a pack-fired risk case** (KYC chase, evidence collection, collections, merchant outreach) -- not a recovery engine, consortium score, or chargeback CRM. A mock queue case is selected, a call plan is shown with a **masked** destination, a CALL-E stub dial runs by default, and a structured outcome writes back. Humans stay on the rails.

Product brief: [`BRIEF.md`](./BRIEF.md). MIT license.

This app does **not** host propensity ML or a consortium score. An optional Tarka-shaped `tarka` object may ride on the case schema as **passthrough only** (no decide-time claim).

## Run (stub / demo by default)

```bash
npm install
cp .env.example .env.local   # set OPS_RUN_SECRET; leave CALLE_* empty for demo
npm run dev
```

Desk: [http://127.0.0.1:43127](http://127.0.0.1:43127)

```bash
npm run check         # schema + mock-case contract (offline, no keys)
npm run check:live-sdk  # capture-server proof of the live SDK POST
npm run build         # production compile
```

Queue is four rows: KYC, a **two-party evidence investigation**, collections, merchant. Select a row to read `pack_fired`, `reason_plain`, and deep links. **Place call (demo)** waits 5–8 seconds, then writes an outcome JSON that matches [`schemas/outcome.schema.json`](./schemas/outcome.schema.json). On evidence, place a call per party; outcomes sit side by side.

## How CALL-E plugs in

**Demo (default)** = Confirm demo. No keys. Stub in [`src/lib/calle.ts`](./src/lib/calle.ts) sleeps 5–8s and returns a deterministic `DialResult`. No real phone rings.

**Live** = set `OPS_RUN_SECRET`, `CALLE_API_KEY`, `CALLE_BASE_URL=https://api.heycall-e.com`, and `CALLE_LIVE_CALLS_ENABLED=true`. Unlock the desk with the operator secret, then type exactly `I understand this places a real phone call`. The phrase is **not** access control. `/api/calls/run`, `/api/calls/authorize`, and `/api/calls/result` require the secret (Bearer, `x-ops-run-secret`, or unlock cookie). Live dial uses the case’s approved `phone_e164` only; a signed grant is HMAC-bound to that number. A client `to` that does not match is rejected.

The swap point is [`src/lib/calle-live.ts`](./src/lib/calle-live.ts): `CalleClient.calls.createAndWait` with the plan’s task, schema, and idempotency key. Timeout / malformed / illegal disposition fail closed to `handoff` + `outcome_unknown` and **halt for reconciliation** (durable claim keyed by case + destination). A later conflicting submission is rejected; do not auto-retry.

`CALLE_BASE_URL` is fail-closed to the HTTPS production origin `https://api.heycall-e.com`. Unset, HTTP, localhost, and any other host never receive `CALLE_API_KEY`.

Do not put real credentials in git. `.env*` is gitignored. The browser never receives the keys. Desk UI and API JSON mask E.164, formatted NANP, and local numbers in transcripts (last-4 or hash only).

`composeOutcome` in `src/lib/outcome.ts` turns `DialResult` into the write-back object and validates it before the UI shows it.

## Side effects

- **Default:** local stub dial only. No outbound telephony, no SMS, no CRM mutation. Outcomes stay in the browser session.
- **Live dial:** only when `OPS_RUN_SECRET` unlocks the desk, all three CALLE env gates are set, the origin is the pinned CALL-E host, a destination grant matches the approved E.164, and the exact confirm phrase is typed. That places one real CALL-E call and consumes CALL-E credit. Phrase alone is FAIL.
- **No recurring schedules.** There is no automatic retry loop. An uncertain live outcome writes a durable halt; a human must reconcile before a second live submit.
- Once a live call has started, use CALL-E dashboard controls; the agent script also ends the call if the recipient asks to stop.
- Sample phones in [`data/cases.json`](./data/cases.json) are reserved NANP fiction **NPA-555-01XX** (area code 212 + exchange 555 + 01xx), for example `+12125550101` / `(212) 555-0101`. 555 is never an area code. Contacts use clearly fictional Example / Placeholder names. Call plans and the desk show destinations **masked** (last-4, for example `+121****0101`). Do not replace them with real customer numbers in commits.

## Contracts

| File | Role |
| --- | --- |
| `schemas/case.schema.json` | Case in |
| `schemas/outcome.schema.json` | Outcome out |
| `data/cases.json` | Five mock cases (KYC, evidence pair, collections, merchant) |
| `src/lib/types.ts` | TypeScript mirror of the schemas |
| `src/lib/policy.ts` | Automate vs handoff gates (quiet hours, attempt caps) |

Evidence cases carry `counterpart_case_id`, `safety_sensitive`, `incident_summary_plain`, and `deep_links.evidence_share`.

Demo dispositions (deterministic so a 3-minute video is stable):

| Case | Intent | Disposition |
| --- | --- | --- |
| `case_demo_kyc_001` | `kyc_chase` | `uploading_now` |
| `case_demo_ev_001a` | `evidence_collection` | `statement_taken` |
| `case_demo_ev_001b` | `evidence_collection` | `will_upload` |
| `case_demo_col_001` | `collections` | `ptp` |
| `case_demo_mer_001` | `merchant_outreach` | `docs_promised` |

## Hard rails

Shown in the desk footer and enforced in the stub scripts:

- Never collect PAN, CVV, or a full national ID on the call
- Never invent fees
- Never allege merchant guilt
- HOLD if identity fails
- Quiet hours (`21:00-08:00` HKT on the mocks) and attempt caps

Evidence collection:

- Never share the other party’s statement
- No leading or coaching
- Passwords and PAN are not “evidence”
- Share link is voluntary and party-specific
- Ongoing danger → `unsafe_escalate` and a human immediately

Handoff when: identity fail, investigator/legal request, hardship, merchant disputes the review, the script would need PAN, max attempts, or ongoing danger.

Out of scope (per brief): production legal opinion, real bank core, hosted propensity ML, WhatsApp OCR, Tarka decide-time.

## Upstream

Source app: [pamu512/fraud-ops-caller](https://github.com/pamu512/fraud-ops-caller). Packaged under `apps/typescript/fraud-ops-caller` for Awesome Phone Call Agents. License: MIT.
