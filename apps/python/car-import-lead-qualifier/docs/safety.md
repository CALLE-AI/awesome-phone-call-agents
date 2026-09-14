# Safety rules for the car import lead qualifier

A qualification call reaches a real person about a purchase decision. Read this before enabling `--execute`.

## Explicit intent

- Only leads who submitted an import inquiry may be called. `submitted_import_inquiry` must be literally `true` for every lead, and parsing fails otherwise.
- `--execute` additionally requires `--confirm-lead-consent`, a separate operator action that cannot be set from the lead file.
- Purchased lists, scraped numbers, and general prospecting are out of scope for this app.
- Keep `inquiry_source` and `inquiry_date` accurate. The agent says both out loud, and a person who cannot place the inquiry should be able to end the call knowing why they were called.

## Phone numbers

- Numbers must be E.164 (`+` followed by 8 to 15 digits). Anything else is rejected at parse time.
- The number must fall in a market declared in `qualifier/locales.py`. An unsupported prefix is rejected before any call is created, and the error masks the number (`unsupported destination for +491***`). A mistyped country code fails loudly instead of reaching a stranger in another country.
- One call per number per run: duplicate numbers in a lead file are rejected.
- Numbers are masked as `+25*******001` in previews, results, logs, and errors. The unmasked number appears only in the request body sent to CALL-E.
- Phone-like digit runs are stripped from returned evidence text before the result is written.
- `example_leads.json` never contains a dialable number. `+1 202 555 0143` is an officially reserved US test number; the Mozambique entry uses an unallocated prefix (`+258 80…`) because the country publishes no documentation range. Treat them as placeholders, verify before reuse, and never commit a real number.

## Disclosure and opt-out

- The call opens by stating that the caller is an AI assistant, naming the business, and citing the inquiry.
- The agent asks whether it is the right person and whether now is a good moment before asking anything else.
- A wrong-person answer, a refusal, or a removal request ends the call immediately with an apology and no further questions.
- The agent never claims to be human, even if asked directly.
- Opt-out routing runs before any commercial routing. `right_person: "no"` and `continued_after_ai_disclosure: "no"` both produce `suppress_number`, which means the number must be removed from the calling list in your CRM. This app cannot enforce that on its own.
- A human callback is booked only on an explicit `wants_human_callback: "yes"`. `"no"` closes the lead and `"unknown"` goes to `manual_review`, so silence never turns into another call.
- Voicemail gets a minimal message: the business name and that it will try again. No inquiry details, no vehicle, no budget.

## Content boundaries

The call task forbids all of the following, and the result schema has no field that could carry them:

- price quotes, availability promises, and delivery-date promises;
- customs duty, import tax, homologation, and registration outcomes;
- legal, tax, customs, financial, or credit advice, including financing approval, exchange rates, and how to obtain foreign currency;
- payment card details, bank details, identity or passport numbers, home addresses, and document numbers;
- deposits, orders, cancellations, and any change to an existing arrangement.

`payment_blocker` is the one field that touches the person's finances, and it is a closed enum by design: it records the category of obstacle the person volunteered (`forex_unavailable`, `transfer_limit`, `deposit_too_high`, `needs_financing`, `awaiting_funds`) and nothing else. The agent must not ask for bank names, balances, or amounts already held, and the schema has no field able to store them. Treat the resulting values as commercially sensitive: they say something about a named person's finances even though the number is masked.

The agent defers all of these to a human specialist who confirms in writing. This is not a medical, legal, financial, emergency, collections, political, or marketing workflow.

## Language and calling hours

- The locale, the timezone, and the calling window are resolved from the dialled number's E.164 prefix, never from a country field in the lead file. A wrong CRM label cannot produce a call in the wrong language or at the wrong local hour.
- Each lead is checked against its own market window before a call is created. Leads outside the window are deferred with no call and a recorded next local window.
- `--allow-outside-business-hours` overrides this. Use it only with a documented reason; it is the operator's responsibility to comply with local calling-time rules.
- Calling days are a single app-wide policy (Monday to Friday) and the hours belong to each market. Both ignore public holidays and local rules for weekend calling. Adjust `qualifier/locales.py` to your own policy before a real campaign.
- The optional per-lead `locale` and `timezone` overrides exist for people whose number and residence differ. Use them from verified information, not from a guess.

## Credentials

- `CALLE_API_KEY` is read only from the environment, only in `--execute`, and is never written to a plan, a result, a state file, or an error message.
- Lead files, state files, and result files must not contain credentials. Keep them out of source control.
- Output and state files are written with mode `0600`, and result files are never overwritten.

## Scheduling and duplicates

- The app places at most one call per lead per run and creates no recurring job. Recurrence, if you want it, belongs to your host scheduler, which should invoke this app once per run.
- The idempotency key `carimport-<campaign_id>-<lead_id>-<phone digest>` is stable within one attempt, so an accidental rerun cannot duplicate that call. Changing the dialled number changes the key, so a corrected phone is a new call rather than a silent dedupe against the wrong number.
- Only leads routed to `retry_later` are dialled again, with a new attempt key, and only up to `--max-attempts` (default 3). Every other route is a decision and is never re-dialled. A number that never answers therefore stops being called instead of being retried forever.
- `--state-file` records the attempt count, call id, and route per lead, and makes reruns skip decided leads. Deleting an entry re-enables calling that lead; do that deliberately, and never to work around an opt-out or a spent retry budget.

## Data retention

- Results contain the structured answers, the routing decision, and a masked number. Transcripts and provider events are deliberately not fetched or stored.
- Keep only the redacted result, store it in the system where the lead's consent is already recorded, and delete lead files that are no longer needed.

## Cancellation

- Preview has no side effect.
- Before the provider accepts a call task, stop by omitting `--execute` or `--confirm-lead-consent`.
- After acceptance, this app cannot cancel the call. Use the CALL-E dashboard or provider controls if a cancel action exists. The person can always decline or hang up.
