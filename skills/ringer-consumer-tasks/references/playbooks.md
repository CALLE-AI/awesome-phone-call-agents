# Playbooks reference

Field semantics and the strict `result_schema` for each playbook. `build-task.mjs`
is the source of truth; this document explains the inputs and outputs. All values
are passed as a single JSON object to `--values`. Names in **bold** are required.

Every result schema is a strict object (`additionalProperties: false`) whose only
required key is `outcome` (except the batch aggregate — see the bottom). `outcome`
is always one of: `success`, `partial`, `failed`, `callback_required`.

---

## negotiate-bill — Negotiate a bill

Inputs:
- **`company`** — who to call (e.g. "Xfinity retention line").
- **`goal`** — `lower` | `waive_fee` | `match` | `promo`.
- `currentAmount` — current monthly bill (number-ish string).
- `leverage` — loyalty, competitor quotes, hardship — anything that strengthens the case.
- `accountRef` — account reference the user is comfortable sharing (never fabricated).
- `walkAway` — `yes` lets the agent use cancellation as leverage (transfer to retention); `no` forbids it.
- `approvalMode` — `ask` (default; capture offer, do not commit) | `auto` (may accept under a limit).
- `autoAcceptBelow` — with `approvalMode: auto`, the monthly amount at/below which the agent may accept.

Result: `outcome`, `previous_amount`, `new_amount`, `monthly_savings`,
`promo_length`, `confirmation_number`, `agent_name`, `next_steps`.

## cancel-subscription — Cancel a subscription

Inputs:
- **`company`** — what to cancel.
- `accountRef` — name on account / last 4 / member id.
- `reason` — optional; can speed cancellation.
- `declineOffers` — `yes` (decline all, just cancel) | `consider` (report offers back, still push to cancel).

Result: `outcome`, `cancellation_confirmation`, `effective_date`, `final_charge`,
`retention_offer`, `next_steps`.

## chase-refund — Chase a refund

Inputs:
- **`company`** — who owes the refund.
- **`issue`** — what happened and any prior promises made.
- `orderRef` — order/confirmation number.
- `amount` — amount in dispute.
- `resolution` — `refund` (default) | `replacement` | `credit` | `either`.

Result: `outcome`, `amount_recovered`, `method`, `expected_date`, `case_number`,
`next_steps`.

## book-appointment — Book an appointment  *(batchable)*

Inputs:
- **`business`** — where to book.
- **`purpose`** — what the appointment is for.
- `preferredTimes` — array of constraints in priority order (e.g. `["Weekday mornings","Not Wednesdays"]`).
- `patientName` — name to book under.

Result: `outcome`, `appointment_datetime`, `appointment_iso` (ISO-8601 when
determinable, for calendar export), `location`, `provider_name`,
`confirmation_number`, `notes`.

## get-quote — Get a price quote  *(batchable — Quote Shootout)*

Inputs:
- **`business`** — the business (in batch, supplied per recipient).
- **`service`** — describe the job/product precisely so quotes are apples-to-apples.
- `timeframe` — when it's needed.

Result: `outcome`, `price_low`, `price_high`, `includes`, `availability`,
`contact_name`, `notes`.

## general-inquiry — Ask a question  *(batchable)*

Inputs:
- **`business`** — who to call.
- **`question`** — one or more specific questions.
- `reference` — account/order/case number if relevant.

Result: `outcome`, `answer`, `contact_name`, `next_steps`.

## custom — Something else  *(batchable)*

Inputs:
- **`task`** — the call goal in plain English.
- `collect` — array of items to find out; each becomes an `answer_N` field.

Result: `outcome`, `summary`, and one `answer_1..N` per `collect` item.

---

## Batch mode (Quote Shootout)

Add `--batch` to a batchable playbook. Output then contains:

- `recipient_result_schema` — the playbook's normal per-call schema, applied to
  **each** business.
- `result_schema` — a call-level **aggregate**:
  - `get-quote`: `businesses_called`, `reached`, `quotes_received`,
    `cheapest_business`, `cheapest_price`, `potential_savings`, `note`.
  - others: `recipients_called`, `reached`, `completed_count`, `note`.

**Denominator honesty.** The batch task also instructs CALL-E to count only
businesses that actually gave an answer, and to record how many were *called*,
*reached*, and *answered* — so a business that hit voicemail or declined is
never counted as agreement or folded into the comparison. `note` names who was
left out. Comparisons (cheapest, savings) are computed over answered businesses
only, and the denominator is stated, not implied.

In batch mode the business name is provided per recipient (via `--to-phone`
repetition in `place-call.mjs`), so `business`/`company` is not required in the
shared `--values`.
