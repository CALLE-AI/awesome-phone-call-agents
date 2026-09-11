# Safety

Phone calls cost money and a person's attention. This skill places **zero** calls unless a human later runs CALL-E live outside `preview.py`. Dry-run is the default and the only path this repository implements.

## Intent

- Require an explicit overdue JSON file the user authorized for **this** call.
- Do not scrape numbers, guess country codes, or infer `US` from a leading `+1`.
- Honor `doNotCall: true` before any other check.

## Phone numbers

- Destination must be E.164 (`+` then 8–15 **ASCII** digits `[0-9]`, first digit 1–9). Unicode digits are not E.164.
- Mask to last four digits in every preview, log, and example.
- Samples use only the NANP-reserved `555-01xx` block (fixture `+12025550100`). Never commit a real person's number or a full non-reserved E.164.

## Financial boundary

The skill name does **not** mean a money write.

- Do not collect card numbers, CVV, bank credentials, or one-time passcodes (PCI).
- Do not threaten legal action, credit reporting, or service cut-off.
- Do not offer discounts, waivers, or new terms. Record what the recipient proposes.
- A structured `promised` result is **not** a payment and **not** a ledger row.
- `amountMinor` on intake and `promised_amount_minor` on output must be integers with no remainder. Refuse floats instead of rounding.

## Region

Refuse **before** `POST /v1/calls` when the ISO region is unsupported, including **YE**, or when the E.164 calling-code **prefix** is YE (`+967`). Published fixtures still use the reserved NANP number; do not put a full YE subscriber number in this skill. See `references/regions.md`.

## Retries and cancellation

- There is no scheduler and no daemon. Nothing redials on its own.
- Do not treat `unknown`, client timeout, voicemail, or `no_answer` as a yes.
- Do not mint a fresh UUID as the idempotency key. Derive it from the authorization (see SKILL.md). Reusing the key is the safe retry; a new key is a second dial.
- If the user cancels before live execute, do not run `calle call start`.

## Credentials

- Dry-run needs no `CALLE_API_KEY`.
- Never put API keys in intake JSON, git, or preview stdout.

## Consumer collections

This skill is for a shop calling its own overdue **business** contacts with consent the operator already has. It does not implement US FDCPA / consumer-debt statutory scripts. Do not use it as a consumer collection engine.
