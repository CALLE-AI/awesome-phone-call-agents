# CALL-E: automatic SMS recaps and requested search results

The supported flow uses CALL-E for the telephone conversation, the app's web
search after completion, and Twilio for one SMS. `/followups` now lists calls from the existing CALL-E monitor.

## Configure the local pilot

In the app's ignored `.env.local`, configure these server-only values:

```dotenv
SENIOR_PHONE_AI_MODE=live
CALLE_API_KEY=
OPENAI_API_KEY=
SMS_ENABLED=true
SMS_ACCOUNT_ID=
SMS_AUTH_TOKEN=
SMS_FROM_NUMBER=
SMS_TEST_RECIPIENTS=
SMS_STATUS_CALLBACK_URL=https://your-public-host.example/api/twilio/sms/status
CALLE_FOLLOWUP_ENABLED=true
CALLE_FOLLOWUP_STORAGE_KEY=
```

Use an independent random storage key of at least 32 characters. Keep it stable
across restarts. Never put credentials or customer numbers in source, prompts or
logs. The sender can be the SMS-capable Twilio trial number already tested by the
operator; the recipient allowlist uses Australian `+614xxxxxxxx` mobiles. Replace
the leading zero of a local `04...` mobile with `+61`, not `+610`.

Only `/api/twilio/sms/status` needs public HTTPS exposure. Keep the operator UI
and APIs on loopback; never make a public proxy impersonate a local Origin/Host.
No CALL-E inbound webhook or Supabase database is needed for this pilot.
See [Twilio setup](twilio-sms.md) for account and sender requirements.

Restart the Next.js server after setup. Setting `CALLE_FOLLOWUP_ENABLED=true`
explicitly enables automatic processing for newly created calls to the configured
test recipients. The server worker checks existing call jobs every ten seconds
while the app runs; each still-active call is polled at most every thirty seconds.
This does not schedule calls or recurring messages. A restart resumes pending jobs
within their two-hour registration window.
Completed calls must also have a verified creation timestamp within two hours;
connecting an old call does not renew the customer's earlier permission.

## Conversation and delivery

1. Place an explicitly confirmed call through `/calls` or `/briefings`. For an
   allowlisted recipient with follow-ups enabled, the app attaches a CALL-E result
   schema and instructions, and registers the resulting call automatically.
2. On every ordinary conversation, CALL-E offers a short SMS recap. It speaks a
   factual recap (prefer under 100 characters, maximum 240), lets the customer
   acknowledge or correct it, and asks in a separate turn: **May I text this
   summary to this same number after our call?** It waits for explicit agreement.
3. If the customer also wants public information, CALL-E collects one complete
   request and separately asks permission to text the search results to the same
   number after the call. It explains that results require successful verification.
4. After completion, the worker verifies the called destination, transcript quotes,
   adjacent permission question and affirmative customer answer from the same
   attempt. It sends the exact recap the customer heard, not an unreviewed provider
   summary. Failed/unanswered calls, missing evidence and later refusal do not
   authorize a text. The first pilot supports allowlisted Australian mobiles;
   landlines cannot receive these SMS follow-ups.
5. One durable job sends at most one SMS. A normal conversation needs no search
   API request. When separately authorized, a search adds a verified answer and
   source link to the recap if both fit the 480-character limit. Otherwise the
   complete sourced answer takes priority. If search fails, an independently
   approved recap is still sent with a short search-failure notice. Without recap
   permission, a failed search sends nothing. No additional operator action is
   needed after the call.
6. Open `/followups` and refresh to see progress and the resulting message.
   `queued` means accepted by Twilio; `sent` means a verified delivered callback.

Existing calls can be selected from the monitor on `/followups` and bound to their
same allowed mobile. The provider result must already contain the new
`post_call_summary` or `post_call_search` structured fields. Older calls without the schema do not acquire
consent retroactively. They stop with `no_permission`; the app does not infer an
SMS request from a free-text summary. If automatic registration fails after CALL-E
accepts a new call, the call monitor reports it; connect that same call manually.

## Safety and failure handling

- This is one bounded after-call authorization, not unrestricted agent permission.
  It cannot change recipient, book, buy, contact third parties, create recurring
  jobs, expose credentials or make medical/legal/financial/emergency decisions.
- CALL-E schema descriptions guide extraction; they are not trusted as hard
  enforcement. Local code also requires quote matches, adjacent explicit SMS
  permission to the same number after the call, and an affirmative customer turn.
  This first pilot supports conservative English consent matching. An unclear or
  unsupported phrasing results in no message rather than guessed consent.
- The query and sources are untrusted data. Searches request ordinary verified
  public facts. If there is no source, the result fails, or the complete answer
  and URL exceed 480 characters, the search result is not sent. An independently
  approved recap may still be sent with a search-failure notice. Answers are never truncated
  mid-sentence to force a fit.
- **Cancel follow-up** wins while waiting, checking or searching. Cancellation or
  disabling is checked again immediately before the durable send claim. Once the
  claim is made, delivery cannot be recalled.
- Before contacting Twilio, the app persists `unknown` under an encrypted
  cross-process lock. Duplicate polling and restarts cannot resend. A crash or
  timeout may leave an uncertain result even if the provider accepted the SMS;
  reconcile in Twilio instead of creating another job or resetting its state.
- An interrupted read can be retried; an interrupted search becomes `search_failed`.
  No automatic retry sends a second SMS. A terminal result without evidence stops
  honestly. Provider-read failures are retried within the two-hour window only.
- The ignored registry `data/calle-followups.enc.json` encrypts destinations,
  requests, messages and dispatch state. Content is cleared on the next worker or
  page access after 24 hours; tombstones remain for deduplication. The pilot caps
  registrations at 100. Do not delete unresolved records or rotate the storage key
  to force a retry. There is no background purge when the server is stopped.
- `CALLE_FOLLOWUP_ENABLED=false` and restart disables new processing. Accepted SMS
  cannot be recalled. Keep the service available for receipts until reconciled, or
  check Twilio directly. Incoming SMS replies and opt-out automation remain outside
  this one-off test; do not enable recurring or general messaging with this pilot.

## Verification

Run `npm run check` in the app and `python scripts/validate_repository.py` from the
repository root. Tests use synthetic calls, injected search/SMS adapters and local
encrypted files. They cover permission evidence, later refusal, wrong speakers,
mixed attempts, call correlation, no early search, cancelled/disabled work, expiry,
search failure, delivery receipts and one send across concurrent workers/restarts.
No default test places a call or sends a message. Live CALL-E extraction, search
quality and receipt on the test phone remain separate acceptance checks.

Provider contract: [CALL-E calls and structured results](https://docs.heycall-e.com/api-reference/calls).
