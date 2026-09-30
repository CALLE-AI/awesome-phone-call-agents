# Demo Guide

A no-call walkthrough, followed by an optional authorized exercise call.
This is an experimental notification demo, not validated emergency dispatch.

## 0. Preconditions

- Node 20+; only step 4 needs `npm i @call-e/calle`.
- `CALLE_API_KEY` exported only for step 4.
- A number you are authorized to call — for first tests, your own phone.

## 1. Preview (no call, no key)

```bash
node scripts/relay.mjs \
  --case-id DEMO-1 \
  --incident "Synthetic training exercise" \
  --location "Fictional training room" \
  --unit-name "Training unit" \
  --phone "+12025550123" --region US --locale en-US \
  --confirmed-by "fictional-operator"
```

Inspect the phone-masked goal, recipient, locale, schema, and policy. The original
destination remains in the private request; the preview is not byte-identical.
Prompt constraints request a bounded conversation but cannot guarantee model behavior.

## 2. The refusal (no call, by design)

Drop `--confirmed-by` and re-run: the script exits non-zero with usage. No
human decision, no call — demonstrate the boundary.

## 3. Schema talk-track

`unit_accepted` is yes/no/unknown. `eta_minutes` returns digits ("12") or the
word "unknown". `notes` is one English sentence. Unknown is a real answer for
a bad line. Missing, invalid, or mistaken provider results remain possible; the
operator must treat unverified answers as unknown and review any proposed confirmation.

## 4. One real call (authorized, budgeted)

```bash
# Replace the fictional preview recipient with an authorized exercise number
# and the confirmed assignment; do not call an emergency service for a demo.
node scripts/relay.mjs ... --confirmed-by "your-name" --real
```

The script prints the provider call id, reminds that a submitted call cannot
be recalled through this CLI, polls every 5s, and prints an advisory structured
result alongside the provider's validation status. Phone-shaped text is masked;
raw transcripts and provider error details are omitted. Answer your own authorized
exercise phone; reply in the relay locale; review the JSON without automatic actions.

## 5. After the demo

Nothing to clean up: single attempt, no schedules, no recurrence. The
stable case key requests provider deduplication, subject to provider retention and
enforcement. After any ambiguous error or timeout, stop and reconcile manually
before another intent. No live call is needed to verify this contribution.
