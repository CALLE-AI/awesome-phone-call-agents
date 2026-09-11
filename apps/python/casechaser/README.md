# CaseChaser

**The company owes you something. CaseChaser phones them until it arrives, writes down every promise they make, and escalates the ones they break. It never touches your money or your legal position: those decisions stop at you.**

CaseChaser is a Python app on the CALL-E Developer API for the slow, repetitive phone work behind an open case: an insurance claim in "processing", a refund that is "five business days away" for the third time, a warranty repair, a lost delivery, a billing dispute. It turns each call into a dated, quoted **commitment record**, decides from that record when to call again, climbs a fixed **escalation ladder** when commitments break, and ships a quoted **evidence pack** for the written complaint that ends most of these cases.

```text
case ledger ──► may we call? ──► CALL-E call ──► what did they commit to?
                    │                                     │
             ten named holds                  commitment │ offer │ customer action │ resolved
                                                          │
                              due date passed? ──► broken ──► escalate: agent › supervisor › written complaint › regulator
                                                          │
                                        offer or denial ──► human decision ──► carried into the next call
```

## Why this is different from "call them and ask"

| Problem with chasing a case by hand | What CaseChaser does about it |
| --- | --- |
| "They said next week" is never written down, so nobody notices when next week passes. | Every commitment is stored with the representative's exact words and an ISO date; a grace period later it is marked kept or broken. |
| Each call starts from zero. | The task prompt carries the full history: who said what, on which date, which reference, which commitments broke. |
| The IVR maze is re-solved every time. | The path that reached a person is remembered on the case and reused. |
| A confident-sounding assistant accepts a "goodwill credit" it had no right to accept. | A closed result schema with an `offer_made` outcome plus hard prompt boundaries: the agent records the offer verbatim and stops; the case goes to `needs_human`. |
| Calling too often, too late, or on the wrong number. | Named suppression reasons (quiet hours in the company's time zone, daily cap, total budget, pending promise, pending human decision, closed case, waiting on customer, too soon, unreconciled call) plus region-aware E.164 validation: the country code must match the case region, NANP numbers must be NXX-NXX-XXXX, premium-rate and short codes are refused. |
| The complaint letter has no evidence. | `casechaser evidence` writes a markdown pack: every call, quote, reference, commitment status, and customer decision, with phone numbers masked. |

## Quick start (no calls, no API key)

```bash
cd apps/python/casechaser
python3 -m casechaser --data ./data init-demo          # two fictional cases
python3 -m casechaser --data ./data status             # who may be called right now, and why not
python3 -m casechaser --data ./data plan <case_id> --force      # the exact CALL-E task text, nothing sent
python3 -m casechaser --data ./data run <case_id> --mode fixture --force
python3 -m casechaser --data ./data serve              # http://127.0.0.1:8765, loopback only
python3 -m pytest                                      # 27 tests, all offline
```

Python 3.9 or newer, standard library only. `pytest` is the only development dependency.

`--force` ignores the suppression reasons so a fixture demo works outside business hours. It exists only for `preview` and `fixture`; live mode refuses it.

### Fixture scenarios

Fixture mode runs the real client against a local fake of the CALL-E Calls API (`casechaser/client.py`, `FakeCalleServer`) that returns canned transcripts and structured results. Every workflow path has one:

| Scenario | What the fixture returns | What the ledger does |
| --- | --- | --- |
| `first_call_commitment` | Claim approved, payment "within five business days" | Records a commitment due 2026-09-09; next chase opens two days after that |
| `broken_promise_supervisor` | Supervisor Daniel gives a new date | Marks the old commitment broken, escalation level 1, records the new commitment |
| `offer_made` | "Goodwill credit of 60 dollars instead of the refund" | Case becomes `needs_human` with the exact offer; no further calls until a decision |
| `needs_customer_action` | Signed form required | Case becomes `waiting_on_customer`; calling is suppressed |
| `identity_refused` | Third-party authorisation needed | `needs_human` with the authorisation step recorded |
| `unreached_voicemail` | Office closed message | Retry scheduled, nothing recorded as a commitment |
| `resolved` | Refund confirmed as issued | Case closed; pending commitments marked kept |

Run the dashboard, pick a case, choose a scenario, and press **Run fixture call**. The trace shows the transcript, the structured result, the commitments, and the policy hold that now applies.

## Live mode

1. Create a CALL-E account (new accounts get free calls) and put the key in `.env` (copy `.env.example`). The key is read only by the CLI in live mode and is sent to `https://api.heycall-e.com` only; a `CALLE_BASE_URL` override is refused. The dashboard cannot place live calls.
2. Add a real case with `casechaser add ...`. The hotline must be a full E.164 number whose country code matches the region (`policy.REGIONS`); anything else is refused at `add`.
3. Authorize that exact destination: `python3 -m casechaser --data ./data authorize <case_id> --hotline +12125550100 --until 2026-10-31 --max-calls 6`. This writes `data/authorizations/<case_id>.json`; live runs refuse without it, or if the case hotline no longer matches it character for character, or after expiry, or once the budget is used.
4. Interactive call: `python3 -m casechaser --data ./data run <case_id> --mode live --yes`. Scheduled call: `--authorization data/authorizations/<case_id>.json` on a record written with `--unattended`, and no `--yes` (see `docs/scheduler.md`).

Before the request leaves the machine the case records a `pending_call` with a fresh idempotency key. If the process dies after CALL-E accepted the call, the case holds with `pending_reconciliation` and nothing dials it again until `casechaser reconcile <case_id>` fetches the recorded call, or `--clear` after you have confirmed in the CALL-E dashboard that no call exists. The client polls `GET /v1/calls/{id}` until the task is terminal; if you run `apps/python/webhook-result-receiver`, set `CASECHASER_WEBHOOK_URL` and the same terminal payload is delivered there too.

Side effects: one outbound phone call per cycle to the case hotline, disclosed as an AI assistant calling on behalf of the customer. Nothing else: no emails, no payments, no account changes.

## What the agent is told, and what it may never do

`casechaser/plan.py` builds the task from the case, the identity facts you chose to share, the IVR path, the call history, and the escalation level. Every task ends with the boundaries in `casechaser/policy.py`:

- it is an AI assistant calling on behalf of the customer and says so if asked;
- it never gives card, bank, password, one-time-code, or ID numbers;
- it never accepts, negotiates, or declines any amount, credit, fee, or charge;
- it never closes, withdraws, reopens, or changes the case or the account;
- it never threatens or mentions lawyers or regulators;
- if the representative will not talk to a third party, it asks what the customer must do to authorise this and ends the call.

The result schema is closed (`additionalProperties: false`) and every field is required. The app does not rely on CALL-E to enforce that: `engine.validate_result` checks the returned object locally before any state changes (no extra fields, every field present, exact JSON type per field, outcome in the enum, date as YYYY-MM-DD). Any failure marks the call `unusable` and the case goes to `needs_human`; an `unknown` outcome does the same. Only `unreached` (no human on the line) schedules a retry.

## Escalation ladder

| Level | Trigger | What the next call asks for |
| --- | --- | --- |
| agent | first contact | status, reference, a dated commitment |
| supervisor | one commitment broken | a supervisor, the broken commitment stated with its date, a firm new date |
| written complaint | two broken | the formal complaints channel and a complaint reference |
| regulator | three broken | same as above; the evidence pack is ready for an ombudsman or regulator |

The ladder only ever goes up by one level per broken commitment, and the agent never announces it on the call.

## Scheduling and cancellation

CaseChaser does not run its own scheduler. Run one cycle per case from a host scheduler with `--authorization <record>` and let the suppression reasons decide whether a call happens; see `docs/scheduler.md`. The scheduler never carries `--yes`; the authorization record is the operator's separately written, expiring, budgeted consent. To stop chasing a case: delete its authorization record, or `casechaser decide <case_id> "stopping" --close abandon`. Deleting the cron line stops all future cycles; a call already in progress at CALL-E completes and is folded in by `reconcile`.

## Data and privacy

The ledger is a single JSON file in `--data`. Phone numbers are masked in every printed line, in the dashboard, and in the evidence pack. Fixtures use the NANP fictional range 555-01XX (`+1 212 555 0100`, `+1 312 555 0199`) and placeholder names and references (`EXAMPLE-CLAIM-0001`). The dashboard has no authentication and therefore refuses to bind anywhere but loopback, rejects requests whose `Host` is not loopback, requires an `X-CaseChaser` header on writes, and HTML-escapes every rendered field.

## Layout

```text
casechaser/models.py     case, call, commitment records; JSON ledger
casechaser/policy.py     suppression reasons, calling window, boundaries, chase timing
casechaser/plan.py       task text and the closed result schema
casechaser/client.py     CALL-E Calls API client (urllib) and FakeCalleServer
casechaser/engine.py     run_cycle, commitment tracking, escalation, decisions, evidence pack
casechaser/dashboard.py  local UI and JSON API
casechaser/cli.py        commands, including authorize and reconcile
fixtures/                seven terminal call fixtures
data/authorizations/     per-case live authorization records (created by `authorize`)
examples/demo_cases.json two fictional cases
tests/                   pytest suite, offline
docs/safety.md, docs/scheduler.md
```

## Limitations

- One recipient per call task; conference or three-way calls are out of scope.
- The agent cannot pass identity checks that require a one-time code sent to the customer; such calls end as `identity_refused`.
- Dates spoken as "next week" are converted by CALL-E's extraction; the app validates the YYYY-MM-DD format but not plausibility.
- Region validation covers the regions in `policy.REGIONS` (North America, Western Europe, HK, SG, JP, IN, AU, NZ) with length rules, not a full numbering-plan library; add a region deliberately before dialling it.
- The escalation ladder is deliberately conservative: it never skips levels and never mentions regulators on the phone.
