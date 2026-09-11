---
name: invoice-payment-chaser
description: Chase an overdue cross-border invoice by phone when a written reminder has gone unanswered. Drafts a call goal scaled by the buyer's own learned payment history, places an authorized CALL-E call to the buyer, and returns a structured outcome (confirmed payment date or stated reason for delay) for human review before it is treated as resolved.
---

## When to use this skill

Use when an invoice is significantly overdue relative to the buyer's own
historical payment pattern, a written chaser has already been sent and gone
unanswered, and a live phone call is warranted to get an explicit status.

## Intent specification

The agent MUST have explicit intent for the run: the invoice (id, amount,
currency, days overdue), the buyer's own learned payment pattern (typical
lag, sample size) so tone is calibrated not generic, the authorized party to
call, and the two acceptable resolutions — a confirmed payment date, or a
specific stated reason for the delay.

## Phone number handling

Numbers must be supplied in strict E.164 format (e.g. `+14155550123`).
Output masking is required in logs/results unless the full number is
strictly necessary for the call operation. Sample numbers in this skill's
docs and fixtures use fictional reserved ranges only.

## Stopping mechanisms

One call per invoice per chase cycle — no re-dialing the same invoice within
a run. Ambiguous outcomes (no answer, refused, vague non-committal answers)
are treated as unresolved and reported, not auto-escalated.

## High-stakes boundaries

The agent must never confirm, negotiate, or alter payment terms on the
call, accept a payment or payment instrument over the call, or threaten
legal/collections action. It only gathers the buyer's stated status — any
account action is a human decision.

## Safety gate

A call is placed only behind explicit human confirmation (e.g. a
`--confirm` flag). Planning/drafting the call goal is free and does not
place a call — this is the recommended default path for dry runs.

## Installation and usage

No install beyond a CALL-E API key and a Python environment with `requests`.
Reference implementation: `calle_chaser.py` in
https://github.com/thanawinhvh/gotpaid — `run_for_unpaid_invoice(...,
confirm=False)` drafts the goal and plans the call with zero side effects;
pass `confirm=True` (or `--confirm` on the CLI) to place the real call.

## Result

Return: invoice id, amount, days overdue, buyer's historical lag, outcome
(`confirmed_date` | `stated_reason` | `unresolved`), the specific date/
reason if given, confidence, and the full call transcript for audit —
phone numbers masked.
