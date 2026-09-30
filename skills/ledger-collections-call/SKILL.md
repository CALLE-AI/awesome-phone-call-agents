---
name: ledger-collections-call
description: HITL outbound collections phone call from overdue JSON (E.164, integer minor units, region); CALL-E create plus poll; structured promise out; dry-run default; never posts to unsupported regions including YE.
license: MIT
---

# Ledger Collections Call

Use this skill when a merchant (or an agent acting for one) has **explicit authority** to place **one** disclosed phone call about an overdue balance, and needs a structured promise back.

The directory name does **not** mean a money write. A CALL-E `promised` result is display-only. Payment stays a later human confirm (or another tool). Read `references/overlap.md` before treating this as a collections product: it is not [`kept`](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/python/kept).

This skill does not book a payment, post a ledger row, or run a campaign. A human reviews the result before any cash movement.

## When To Use

- One overdue contact the operator already authorized, with E.164, integer `amountMinor`, currency, locale, and region in JSON
- Preview the CALL-E task and recipient result schema without credentials
- Refuse Yemen and other unsupported regions **before** `POST /v1/calls`
- Hand a structured promise to a human, a display-only card, or `kept` capture — not to a cashier

## When Not To Use

- Consumer FDCPA / statutory debt-collection engines
- Collecting cards, CVV, bank passwords, or OTPs (PCI)
- Automatic retry when the outcome is `unknown`, timeout, voicemail, or `no_answer`
- Writing a ledger, invoice, or `kept` financial record from the structured result
- CSV campaigns, call budgets, bank-feed reconcile (that is `kept`)
- First-contact sales, scraped lists, or numbers the user did not authorize
- Hidden schedulers, webhooks, or `create_and_wait` on the HTTP request
- Inferring region from a leading `+1`

## Required Inputs

JSON object:

| Field | Type | Notes |
| --- | --- | --- |
| `contactId` | UUID string | Stable local id; used in the idempotency material |
| `displayName` | string | Spoken name |
| `phoneE164` | string | E.164, authorized |
| `amountMinor` | integer | Outstanding balance, smallest currency unit. No floats |
| `currency` | string | ISO code, e.g. `USD` |
| `locale` | `en` or `ar` | Task language. Documented in English; do not embed other scripts in this folder |
| `region` | ISO 3166-1 alpha-2 | Stated by the operator. Not inferred from the number |
| `doNotCall` | boolean | If true, refuse |

Optional: `storeName` (default `Store`), `promisedDate` (`YYYY-MM-DD` or empty; authorization material only).

## Preflight

1. Confirm the user authorized this one collections call.
2. Confirm E.164 and that `doNotCall` is false.
3. Confirm `amountMinor` is a JSON integer (no remainder).
4. Confirm `region` is supported and is not YE. See `references/regions.md`.
5. Run `scripts/preview.py` before any CALL-E plan.

## Dry-Run Preview

No CALL-E credentials. No network. `scripts/preview.py` never POSTs.

If the skill lives under `docs/skills/` (originating product repo):

```bash
python3 docs/skills/ledger-collections-call/scripts/preview.py \
  --request docs/skills/ledger-collections-call/assets/sample-overdue.json
```

If the skill lives under `skills/` (this awesome-list layout):

```bash
python3 skills/ledger-collections-call/scripts/preview.py \
  --request skills/ledger-collections-call/assets/sample-overdue.json
```

Preview prints a masked phone, the CALL-E task, the result schema, and an idempotency key. It exits 0 with `status: not_called`. `--live` is rejected: live execute is not implemented in this skill.

## CALL-E Goal Template

Device-owned English (locale `en`). Shame language and fake legal threats are forbidden. Disclose that the caller is the store's assistant. Ask for a promise date and amount. Do not collect card numbers.

```text
Call {displayName} on behalf of {storeName}. Identify yourself as the store's assistant, not a government collector. Their outstanding balance is {amountLine}. Ask whether they can promise a payment date and amount. Be brief, polite, and stop if they refuse. Return structured fields only: promised / refused / voicemail / no_answer / wrong_number / callback_requested, integer minor-unit amount if they state one, ISO date if they state one.
```

`amountLine` is formatted from integer `amountMinor` plus `currency` (for example `USD 15.00` for `1500` USD). Do not re-convert through floating point.

For locale `ar`, use the same constraints in Arabic at execute time. This folder stays English-only.

## Structured Result

See `references/result-schema.md`. Required `outcome` enum: `promised`, `refused`, `voicemail`, `no_answer`, `wrong_number`, `callback_requested`. Optional integer `promised_amount_minor`, `promised_currency`, `promised_date` (`YYYY-MM-DD`).

A `promised` result is not a payment. `voicemail`, `no_answer`, and unknown all need a human. Do not redial unknown.

## Live Planning

`preview.py` does not dial. Live requires a host that already has CALL-E authentication, a human confirm, and a second explicit gate (for example `--live` plus `--confirm PLACE-REAL-CALLS` on that host). This skill documents the gates; it does not implement `POST /v1/calls`.

If you use the CALL-E CLI after review:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone America/New_York --language English --region US
```

Do not run `calle call start` unless the user separately confirms. Do not post unsupported regions including YE.

## Cancellation And Idempotency

Idempotency key (hex SHA-256), **not** `uuid4`:

```text
sha256("{contactId}|{amountMinor}|{currency}|{promisedDate}|{utcDate}")
```

`utcDate` is `YYYY-MM-DD` in UTC for the authorization day. `promisedDate` may be empty.

If the user cancels before dial, do not execute. If a result is ambiguous, route to a human rather than calling again with a new key.

## Safety Notes

Read `references/safety.md`, `references/examples.md`, `references/regions.md`, `references/result-schema.md`, and `references/overlap.md` before live planning.
