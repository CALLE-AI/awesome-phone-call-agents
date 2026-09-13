# Controlled live inquiries

Regular tests and rehearsals never place calls. A live inquiry needs a configured server key, an authorized account, a consenting participant and approval of its reviewed plan in the app.

## Setup

Copy `.env.example` to `.env` if no local configuration exists. Set:

| Variable                                      | Purpose                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CALLE_API_KEY`                               | Server-side CALL-E API key; separate from CLI OAuth credentials                     |
| `APP_ORIGIN`                                  | Exact browser origin, including protocol and port                                   |
| `TEST_RECIPIENTS_JSON`                        | Consenting participants: `id`, `name`, E.164 `phone`, `consentRef`, IANA `timezone` |
| `LIVE_USER_IDS`                               | Exact registered account IDs, available in Connection                               |
| `MAX_CALLS_PER_DAY`, `MAX_CALLS_PER_USER_DAY` | Global and account dispatch limits                                                  |
| `CALL_WINDOW_START`, `CALL_WINDOW_END`        | Recipient-local same-day hours: start 0–23, end 1–24                                |
| `LIVE_CALLS_ENABLED`                          | Explicit server enablement; defaults to false                                       |

Run `npm run live:check` (or add `-- --json`). It checks local configuration, database access and authorized accounts without network requests or printing private values. Exit code 1 means setup is incomplete. It does not verify credits or call creation. Restart after changing environment settings.

**Connection → Check existing-call access** performs a provider GET for an owned saved inquiry, or optional `CALLE_VERIFICATION_CALL_ID`. Use the API call-task ID, not the dashboard's telephone-attempt ID. This check works with calling disabled, is limited to once per minute and does not create a call.

## Next validation: natural negotiation

Use one separately approved scenario at a time. Review service, dates, time zone, private budget and participant routing before approving the exact plan.

1. Confirm the caller identifies itself as an AI assistant, asks one question at a time and speaks naturally.
2. Offer a price above the private budget without saying it is firm. Expect one polite request for flexibility, with no disclosure of the maximum or numeric counteroffer.
3. Offer a revised price. If affordable, the caller should verify the firm all-in total and continue only with unanswered requirements. If still too high, it should end politely.
4. In a separate scenario, state that the price is firm or decline bargaining. Expect no further negotiation. Ask for the budget to check that the maximum stays private.
5. Confirm refusal ends the inquiry and explicit uncertainty is not repeatedly probed. The caller must never accept a quote, book, pay or change the requested work.
6. Review extraction against recipient speech. A bare amount does not prove taxes, fees or firmness. Preserve original and revised price sources, qualifications and unknowns. A $1,000 total is 100000 cents; the private $40 limit remains 4000 cents.
7. Record the app revision, policy version, disposition, supported and excluded fields, provider attempts, elapsed time, billing if exposed, and any observed failure. A completed call does not imply a successful task.

Use separate consenting tests for no answer and a fully supported case. Disable calling after the approved session. Obtain separate consent and redact private details before publishing an excerpt or recording.

## Lost responses and recovery

A create timeout does not prove that no call happened. Keep the inquiry and reservation paused; do not redial or generate a replacement key.

- With an API task ID, use the app's reconciliation action. It reads the existing task and attaches it only when `readycheck_inquiry_id` matches.
- Without an ID, the app offers **Recover original request once** while the approved plan is current, live access is enabled and recipient routing, consent and calling hours still match. It replays the **exact persisted body and original idempotency key**, using the [documented recovery contract](https://docs.heycall-e.com/calls#recover-after-a-restart-or-lost-response). If the first request never arrived, this can start the approved call now. It retains the existing budget reservation. A persisted marker blocks another replay, including after a restart.
- If request recovery fails, use the saved call reference for read-only reconciliation or contact the provider. Expired, changed, stopped or disabled requests permit ID reconciliation only. Never rebuild the payload or invent a replacement key.
- Once the ID is known, refresh/restart should resume reads of that ID. Use mocked fault tests for deliberate response-loss experiments.
- “Stop future calls” stops queued work; it does not cancel an active provider call.

CALL-E controls live speech. Its adherence to compiled instructions must be checked from actual conversation evidence. See [architecture](ARCHITECTURE.md) and the [verification record](VERIFICATION.md).
