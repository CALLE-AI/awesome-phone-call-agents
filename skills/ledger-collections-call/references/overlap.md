# Overlap — why this skill is not `kept`

This skill exists because a shop already knows **who** is overdue and needs **one disclosed phone call** that returns a structured promise. It does not exist to invent collections, and it does not replace [`apps/python/kept`](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/python/kept).

`kept` is a runnable **app**: invoice CSV in, call budget, eleven named capture rejections, a hash-chained ledger of financial records, then bank-feed reconcile. That is a different artifact and a different contribution area.

`ledger-collections-call` is an installable **skill**: one authorized overdue JSON in, dry-run by default, a CALL-E `create` + poll only after separate HITL, a structured **promise** out. The promise is display-only. The host (or a human, or `kept`) may capture money later. This skill never cashiers.

## This skill vs `kept`

| This skill | `kept` |
| --- | --- |
| One authorized recipient JSON | Invoice CSV campaign plus a call budget |
| Stops at a structured promise | Eleven capture rejections, then a financial record |
| Never writes a ledger | Own hash-chained ledger plus bank reconcile |
| Refuses YE / unsupported ISO **before** `POST /v1/calls` | Quiet hours, DNC, and policy; not unsupported-region refuse including YE as the product |
| Integer `amountMinor` in and `promised_amount_minor` out; float refused | Decimal parse into its own ledger |

Do not claim this skill invented collections promises. Do not re-implement `kept/capture.py`, `kept/reconcile.py`, or `kept/promises.py` here.

## Adjacent, not duplicates

| Artifact | Why it is not this skill |
| --- | --- |
| `creditcall` (app) | Invoice-exception handoff, not an overdue collections call from merchant JSON |
| `ringer-consumer-tasks` | Consumer outbound (bills, cancel, refund). This skill calls people who owe the **shop** |
| `appointment-confirm` | Confirms a booking. Its When Not To Use includes collections — clone its SKILL.md **shape**, not its job |
| `service-dispatch-call` | Vendor availability. Pattern to clone: gather is not commit |

## Handoff

After a terminal `promised` result, the host may:

- show a display-only promise card in a host app
- feed the structured result into `kept` capture
- do nothing until a human records payment

This skill must not POST a ledger row, clamp an over-promise into a debt, or schedule a bank reconcile.
