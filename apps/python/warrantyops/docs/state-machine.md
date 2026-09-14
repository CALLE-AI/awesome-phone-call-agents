# State machine

Generated from ``warrantyops/statemachine.py`` — regenerate with
``make docs`` (``python -m warrantyops --generate-docs``). Do not
edit by hand; the tests assert this file matches the tables.

Six vocabularies, never mixed: a value belongs to exactly one
table. ``∅`` marks the start of a run. A state with no outgoing
edges is terminal for that vocabulary. Recovery is an edge from
``UNKNOWN`` to ``COMPLETED`` through a GET-only re-read during
human reconciliation — never back into a retriable reservation;
a retried claim starts a new key, therefore a new ``∅``.

## Attempt — the local attempt ledger

- `COMPLETED` — terminal
- `RESERVED` → `COMPLETED` / `UNKNOWN` / `RESERVED`
- `UNKNOWN` → `COMPLETED`
- `*start*` → `RESERVED`

Terminal: `COMPLETED`.

## Transport — as the provider reports it

- `NOT_ATTEMPTED` — terminal
- `canceled` — terminal
- `completed` — terminal
- `failed` — terminal
- `in_progress` → `completed` / `failed` / `canceled`
- `queued` → `in_progress` / `completed` / `failed` / `canceled`
- `*start*` → `NOT_ATTEMPTED` / `queued` / `in_progress` / `completed` / `failed` / `canceled`

Terminal: `NOT_ATTEMPTED`, `canceled`, `completed`, `failed`.

## Terminal — the folded classification

- `ACTION_REQUIRED` — terminal
- `BUSINESS_UNRESOLVED` — terminal
- `INFORMATION_OBTAINED` — terminal
- `IN_FLIGHT` → `TRANSPORT_FAILED` / `RESULT_UNAVAILABLE` / `RESULT_INVALID` / `INFORMATION_OBTAINED` / `ACTION_REQUIRED` / `BUSINESS_UNRESOLVED` / `MENU_UNRESOLVED`
- `MENU_UNRESOLVED` — terminal
- `NOT_ATTEMPTED` — terminal
- `RESULT_INVALID` — terminal
- `RESULT_UNAVAILABLE` — terminal
- `TRANSPORT_FAILED` — terminal
- `*start*` → `NOT_ATTEMPTED` / `IN_FLIGHT`

Terminal: `ACTION_REQUIRED`, `BUSINESS_UNRESOLVED`, `INFORMATION_OBTAINED`, `MENU_UNRESOLVED`, `NOT_ATTEMPTED`, `RESULT_INVALID`, `RESULT_UNAVAILABLE`, `TRANSPORT_FAILED`.

## Claim — what the counterparty stated

- `STATED_IN_PROCESS` → `UNKNOWN`
- `STATED_PAID` → `UNKNOWN`
- `STATED_REJECTED` → `UNKNOWN`
- `STATED_RETURNED` → `UNKNOWN`
- `UNKNOWN` — terminal
- `*start*` → `STATED_REJECTED` / `STATED_RETURNED` / `STATED_IN_PROCESS` / `STATED_PAID` / `UNKNOWN`

Terminal: `UNKNOWN`.

## Review — the human decision

- `APPROVE` → `RECEIPT`
- `REFUSE` — terminal
- `RETURN_TO_DIGITAL` — terminal
- `*start*` → `APPROVE` / `REFUSE` / `RETURN_TO_DIGITAL`

Terminal: `REFUSE`, `RETURN_TO_DIGITAL`.

## Write-back — what persisted

- `NOT_REVIEWED` — terminal
- `NO_BUSINESS_RESULT` — terminal
- `RECEIPT` → `RECEIPT` / `REVIEW_CONFLICT`
- `REVIEW_CONFLICT` — terminal
- `SOURCE_CHANGED` — terminal
- `*start*` → `RECEIPT` / `NO_BUSINESS_RESULT` / `NOT_REVIEWED` / `SOURCE_CHANGED` / `REVIEW_CONFLICT`

Terminal: `NOT_REVIEWED`, `NO_BUSINESS_RESULT`, `REVIEW_CONFLICT`, `SOURCE_CHANGED`.
