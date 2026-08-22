# Waitlist Slot Rescue

Fill a last-minute service cancellation without making the whole waitlist race for the same slot.

This focused Python app calls previously opted-in waitlist candidates in their existing order. It stops at the first explicit acceptance, never creates a booking, and hands the candidate's response to a human for final confirmation. An ambiguous result stops the cascade instead of risking a duplicate offer.

The workflow is for non-regulated services such as salons, vehicle or home services, tutoring, and fitness. It deliberately rejects medical, legal, financial, emergency, collections, political, and unsolicited-marketing use.

## Why this workflow

A cancellation creates a short-lived coordination problem. Calling everybody at once overbooks the slot; calling one person manually at a time is slow; treating voicemail or a vague answer as acceptance is unsafe. This app makes the queue, expiry, stopping rules, and commitment boundary explicit:

- contact only people who opted into waitlist calls;
- preserve the business's queue order;
- disclose the AI caller and confirm the intended participant;
- offer one unreserved slot with an explicit expiry;
- stop on the first clear yes or any ambiguous outcome; and
- require a human to make the actual booking.

## Zero-cost demo

Python 3.11 or newer is enough. The default preview and fixture simulation have no dependencies, credentials, network access, or phone side effects.

```bash
cd apps/python/waitlist-slot-rescue
python rescue.py --request example_request.json
python rescue.py \
  --request example_request.json \
  --simulate-results example_results.json
```

The simulation contacts candidate A, records a decline, receives candidate B's acceptance, and proves candidate C remained untouched. Every displayed phone number is masked.

## Live CALL-E run

Install the SDK and keep the server credential outside files and source control:

```bash
uv sync --dev
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"

uv run python rescue.py \
  --request your-authorized-waitlist.json \
  --execute \
  --confirm-authorized-waitlist \
  --output private-result.json
```

Live execution creates at most one call at a time. Each candidate has a stable, slot-specific idempotency key, so retrying the same workflow cannot silently create a second task for that person. Output files are mode `0600` and existing files are never overwritten.

## Input contract

- `workflow_id` and `slot_id`: stable, non-secret identifiers;
- `business_display_name`: the name disclosed during the call;
- `service_category`: one supported non-regulated category;
- `service_label`: a short, non-sensitive description;
- `slot_start` and `offer_expires_at`: timezone-aware ISO 8601 timestamps;
- `candidates`: 1-20 entries with a stable id, E.164 phone number, unique queue position, locale, and literal `consented_to_waitlist_calls: true`.

Do not put names, health details, account data, payment information, credentials, or other sensitive information in the request.

## Safety and side effects

- Preview and simulation never contact CALL-E and never place a call.
- Live mode requires both `--execute` and a separate `--confirm-authorized-waitlist` acknowledgement.
- The call identifies itself as AI, explains the opt-in waitlist source, confirms the intended participant, and honors opt-out immediately.
- The caller cannot book, cancel, take payment, negotiate, collect sensitive information, or promise that the slot is reserved.
- An acceptance is only a candidate response; `booking_created` remains `false` and the result says human confirmation is required.
- A conversational outcome is trusted only when CALL-E reports a completed task, high confidence, provider evidence, a transcript, and a consistent set of independent fields. A single generated `outcome` label can never fill the slot.
- A failed call advances as `no-answer` only with positive provider-authored no-contact evidence and no contradictory transcript or structured result; every other failure halts for review.
- The expiry is checked before and after every call. A response arriving after expiry is retained for human review but cannot select a candidate.
- Duplicate phone numbers are rejected even when they use different candidate IDs, preventing the same person from being called twice in one queue.
- The app has no scheduler, background worker, automatic retry, or recurring job. Stopping the process prevents the next call.
- Once CALL-E accepts a call task, this app cannot guarantee cancellation. Use provider controls if they expose cancellation; otherwise the script instructs the caller to end after one bounded answer.

## Tests

Tests use fake transports and fictional `+1 555-01xx` numbers. They never need an account or make a real call.

```bash
python -m pytest -q
python3 ../../../scripts/validate_repository.py
```

The regressions cover phone masking, consent and expiry validation, duplicate-recipient rejection, first-acceptance stopping, ambiguous-result stopping, expiry during a call, evidence-gated classification, verified no-answer handling, human-only booking, explicit live confirmation, CALL-E payload construction, result redaction, and stable candidate-specific idempotency.
