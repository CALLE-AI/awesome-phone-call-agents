---
name: capacity-backfill-cascade
description: Confirm bookings and backfill freed capacity from a waitlist using CALL-E phone calls. Use when an agent needs to recover cancelled reservations, fill released slots, or run consent-based confirm-then-cascade call workflows safely.
---

# capacity-backfill-cascade

A phone-call workflow pattern for capacity recovery: confirm upcoming bookings, and when
a guest cancels, offer the freed slot to waitlist candidates in priority order until one
accepts. Works for restaurants, tours, classes, and any booking system with a waitlist.

## When to use

- An upcoming booking list where cancellations free capacity
- A waitlist of guests who consented to receive offers
- A need to recover lost capacity without staff dialing

## Prerequisites

- Python 3.10+ with the reference app installed:
  `cd apps/python/table-rescue && pip install -e .`
- CALL-E CLI installed and logged in (live mode only):
  `calle auth login --base-url https://seleven-mcp-sg.airudder.com --channel openagent_oauth`

## Workflow

1. Prepare two JSONL inputs (schemas in `references/io-schemas.md`): reservations and
   waitlist. Every record needs an explicit `consent` flag; non-consented records are
   never dialled.
2. Run a dry-run first and inspect the audit and report:
   `python scripts/run_cascade.py --data-dir <dir> --state-dir <dir>`
3. Only when the plan looks right, place real calls with an explicit budget:
   `python scripts/run_cascade.py --data-dir <dir> --state-dir <dir> --live --max-calls 6`
4. Review the masked staff report at `state/runs/<run-id>/report.md`; escalate
   no-answer and error targets manually.

## Safety rules

- Dry-run is the default; live requires `--live`.
- Never exceed the call budget; the engine stops before dialing when the budget is out.
- Never dial a record without consent.
- Reruns with the same run id skip already-dialled targets (duplicate prevention).
- Cancel a run with `table-rescue cancel --run-id <id>`; later runs refuse to dial.
- Mask phone numbers in any output you produce; never log full numbers or tokens.
- Out of scope: medical, legal, financial, and emergency content.

## References

- `references/flow.md` - phase diagram and decision table
- `references/io-schemas.md` - input and output schemas, OUTCOME protocol
- `references/calle-cli-mapping.md` - how each step maps to CALL-E auth and MCP calls
