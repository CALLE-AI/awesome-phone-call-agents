---
name: visitlock
description: Batch-confirm clinical research visit slots by phone with CALL-E. Use when a coordinator needs structured RSVPs (yes/no/reschedule/no_answer) across a CSV of study visits, an idempotent dial ledger, and a confirmation_rate HUD — not single appointment confirm.
license: MIT
compatibility: Requires calle-ai when placing live calls; fixture mode works offline without a key.
metadata:
  product: VisitLock
  repo: https://github.com/moscraciunxxx/visitlock-calle
---

# VisitLock

## When to use

- Batch research/clinical study visit confirmation (CSV of slots)
- Need structured visit_status + preferred_slot + notes
- Need confirmation_rate / confirmed-called / reschedule_count HUD
- Must avoid double-dial on re-runs (ledger)

Do **not** use this skill for single consumer appointment confirm (see appointment-confirm). VisitLock is batch study-ops.

## Safety

- Explicit research-visit consent language in the call task
- Fictional/masked phones in samples; live calls only to authorized numbers
- No hidden recurring schedules; ledger tracks completed dials
- Medical boundary: confirmation logistics only — not clinical advice or emergency care

## Workflow

1. Load participants CSV (participant_id, name, phone, visit_datetime, visit_type, site_label).
2. For each row, check ledger key participant_id::visit_datetime — skip if already completed.
3. Build CALL-E task with consent preamble + confirm/reschedule ask.
4. Call CalleClient.calls.create_and_wait with result_schema + recipient_result_schema.
5. Record structured result in ledger; refresh board JSON / HUD metrics.
6. If CALLE_API_KEY missing, use fixture results (deterministic).

## Schemas

Recipient: visit_status enum yes|no|reschedule|no_answer|unknown; preferred_slot string; notes string.

## References

- Upstream app: https://github.com/moscraciunxxx/visitlock-calle
- Judge path / static HUD: docs/index.html in that repo
