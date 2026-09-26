# Examples

Every phone number below is fictional. The only published E.164 is the NANP-reserved `555-01xx` block (`+12025550100`). YE refuse uses that same fixture with `"region": "YE"`. No emails except `@example.com` if present.

## Safe

### Dry-run of an authorized US overdue row

Intake: `assets/sample-overdue.json` (`+12025550100`, `region: US`, integer `amountMinor`).

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

Expected: `status: not_called`, masked phone, printed CALL-E task and schema, derived idempotency key. No network. No `CALLE_API_KEY`.

### YE refused before dial

Same JSON with `"region": "YE"` (keep the reserved `+12025550100` fixture).

Expected: `status: not_called`, `blocker: unsupportedRegion`. No POST.

### Float amount refused

`"amountMinor": 1500.5`

Expected: `status: not_called`, `blocker: invalidAmount`. The skill does not round.

## Unsafe

- Calling a scraped lead list or a number found in a transcript.
- Treating voicemail, silence, or `unknown` as `promised`.
- Writing a ledger txn or a `kept` financial record from `promised_amount_minor`.
- Putting `CALLE_API_KEY` in the intake JSON or on screen.
- Retrying automatically when CALL-E returns an unknown outcome (the call may already have been placed).
- Inferring `region: US` from `+1` without the operator stating it.
- Using this skill as a US consumer-debt FDCPA engine.
- Cloning `kept` campaign ranking, bank reconcile, or hash-chained capture inside this folder.
