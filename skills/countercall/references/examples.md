# Worked examples

Every outcome the skill can produce, including the ones that return nothing. The failure
paths matter more than the happy path: they are where a checklist skill is tempted to
guess.

> The payloads below are **illustrative**. They are not recordings of real calls. Results
> published in a demo, a README, or a screenshot must come from an actual run.

## 1. Confident answer — the case the skill exists for

Request:

```json
{
  "office_name": "Kantor Imigrasi Jakarta Selatan",
  "procedure": "perpanjangan paspor",
  "city": "Jakarta Selatan"
}
```

Result:

```json
{
  "required_documents_text": "KTP asli\nKartu Keluarga asli\npaspor lama",
  "total_fee_idr": 650000,
  "payment_method": "cash",
  "appointment_required": "yes",
  "originals_or_copies": "originals",
  "clerk_certainty": "confident",
  "clerk_quote": "Bawa KK yang asli ya, fotokopi saja tidak bisa. Dan harus daftar M-Paspor dulu."
}
```

The value is in the gap between this and the website. The published page says bring
"KTP, KK, paspor lama". It does not say the family card must be an original, and it does
not say an appointment must be booked first. Both are trips lost.

## 2. The clerk was unsure about one field

```json
{
  "required_documents_text": "KTP asli\nKartu Keluarga asli\npaspor lama",
  "payment_method": "unknown",
  "appointment_required": "yes",
  "originals_or_copies": "originals",
  "clerk_certainty": "unsure",
  "clerk_quote": "Untuk biayanya saya kurang tahu, nanti ditanyakan di loket saja."
}
```

The fee field is **absent entirely** — not `null`, which a Goal Run result cannot carry.
The card still renders the Fee row, as an em dash, and is labelled unsure. It does not fall
back to a typical fee, and it does not drop the row so the gap disappears.

This is a **successful** call. The user learns three documents and an appointment
requirement, and knows to ask about the fee at the window.

## 3. `no_answer` — the most common outcome in practice

```json
{ "error": { "code": "no_answer", "attempts": 2 } }
```

Rendered:

> The line at Kantor Imigrasi Jakarta Selatan did not answer on either attempt today.
> No checklist is available for this office.

No partial checklist. No cached answer from a previous day presented as current. One retry
under a `:v2` key, then abstain until tomorrow.

Public service lines go unanswered often. That is the premise of the skill, not a defect in
it, and the honest reporting of it is what makes the answered calls trustworthy.

## 4. `declined` — the office refused an automated caller

```json
{ "error": { "code": "declined" } }
```

Rendered:

> The office declined to answer an automated caller.

End the call politely, render nothing, and do not retry. If one office declines
consistently, remove it from the seed file. A refusal is an answer.

## 5. `result_invalid` — the call happened, the shape was wrong

```json
{ "error": { "code": "result_invalid", "reason": "required_documents_text decoded to zero documents" } }
```

Rendered:

> The call completed but the answer did not match the expected contract, so nothing is
> shown. The raw result has been kept for inspection.

This is the branch that protects the user from a half-parsed checklist. A checklist that is
70 percent right is more dangerous than no checklist, because it gets acted on.

## 6. Contract drift — refused before dialling

```text
$ node scripts/preflight.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor"

  contract           DRIFT DETECTED
  pinned version     3
  published version  4
  removed field      originals_or_copies

REFUSING TO DIAL. The published Goal no longer matches the contract this skill
was written against. Re-pin the contract and re-check the rendering before dialling.
```

No call is placed and no credit is spent. This is the one branch that costs nothing to get
right and is expensive to get wrong: a stale schema produces results that look correct.

## 7. Rejected before anything happens — a bad number

```text
$ node scripts/preflight.mjs --office bad-entry --procedure "perpanjangan paspor"

  phone              021-5225029
  E.164              FAIL - not in E.164 format

REFUSING TO DIAL. Numbers must match ^\+[1-9]\d{7,14}$ and come from the office's
own published page. Never guess a country code.
```

A local-format number reaching the dialler is how a stranger's phone rings.
