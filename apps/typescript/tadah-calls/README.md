# Tadah Calls

Tadah is an iOS app that explains confusing mail (bills, government letters, insurance notices) and turns each letter into a short to-do list. When a to-do needs a phone call, Tadah offers to make it. The user confirms who will be called, what to ask and what Tadah may agree to; CALL-E places the call in English; and the answer goes back on the to-do.

This folder is that call module, taken from Tadah's backend so it runs on its own. The iOS app is not included.

## Try it (no account, no call)

```bash
cd apps/typescript/tadah-calls
npm install
npm test                                   # no network, nothing dialled
npm run preview                            # the exact CALL-E request for a sample bill
npm run demo                               # the full flow against an in-process fake CALL-E
npm run call -- examples/water-bill.json   # dry run: the call path runs, nothing is dialled
```

The demo places a call, refuses a second call while the first is live, delivers the webhook, ignores a duplicate delivery, refuses a wrong secret, and prints what lands on the to-do. `examples/water-bill.json` is fictional and uses a reserved 555-01xx number.

## One live call

```bash
CALLE_API_KEY=... npm run call -- my-request.json --live --confirm-last4 1234
```

A live call needs the API key, `--live`, and the last four digits of the number typed back. It places one call, checks its status every 10 seconds for up to 10 minutes, and prints the result. This live path has not been run against a real phone line from this package.

Request fields: `phone` (a US number), `goal` (what to ask, in any language), `mayAgreeTo` (empty means nothing), and optional `name` and `itemId`.

## Safety

Enforced in code, before dialling:

- US numbering rules; 211 to 911, 900 and 976 numbers are refused.
- Card numbers (Luhn check), SSNs, and requests for bank, PIN or date-of-birth details are refused.
- One live call per person, a monthly limit reserved before dialling, and no automatic retries.
- An `Idempotency-Key` derived from the request and UTC hour. It only deduplicates the same request within that hour; it is not a guarantee across hours or restarts.
- Webhooks: a secret path, duplicate events ignored, and the result always re-read from CALL-E.

Asked of the agent in the task text: say it is an AI first, speak English, never give personal numbers, never agree to a charge, commit to nothing beyond `mayAgreeTo`, and hang up after four minutes.

## Side effects, credentials, cancellation

- Only `call --live` contacts CALL-E. It places one outbound call and spends CALL-E credits. Nothing is scheduled.
- `CALLE_API_KEY` is read from the environment, never printed or stored, and only sent to `https://api.heycall-e.com` or loopback. Phone numbers are masked in output.
- CALL-E has no cancel endpoint: Ctrl+C stops watching, not the call. End a running call from the CALL-E dashboard.

## Known limits

- If CALL-E's answer to a create request is lost, the call is marked failed even though it may be ringing. Stop and reconcile in the provider dashboard before another call; do not retry based on that label. The hour-scoped key and in-memory state do not provide cross-hour or restart recovery.
- The answer is not yet requested in the user's own language.
- Call length is limited only by the task text.
