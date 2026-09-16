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
# Optional: leave blank for a local demo with API delivery checks.
SMS_STATUS_CALLBACK_URL=
CALLE_FOLLOWUP_ENABLED=true
CALLE_FOLLOWUP_STORAGE_KEY=
```

Use an independent random storage key of at least 32 characters. Keep it stable
across restarts. Never put credentials or customer numbers in source, prompts or
logs. The sender can be the SMS-capable Twilio trial number already tested by the
operator; the recipient allowlist uses Australian `+614xxxxxxxx` mobiles. Replace
the leading zero of a local `04...` mobile with `+61`, not `+610`.

No public access is required for the local demo. The server checks Twilio message status using authenticated GET requests. If you opt into callbacks, only `/api/twilio/sms/status` needs public HTTPS exposure. Keep the operator UI
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
   API request. When a search is authorized, the customer message contains the
   concise verified answer and source link. The provider summary and conversational
   recap remain audit context and are never substituted for the requested answer.
   If search fails, no answer message is prepared or sent.
6. Open `/followups` to see SMS history: the exact attempted message, masked destination, send-attempt time, latest status-check time and numeric Twilio error code when available. The page refreshes every ten seconds.
   `queued` means accepted by Twilio; `sent` means Twilio confirmed delivery through an authenticated API lookup or signed callback. A provider `sent` response means carrier acceptance, not confirmed delivery.

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

## Local delivery history

The existing server worker checks at most one pending message per tick, with a
30-second minimum between checks of the same message, for up to 24 hours after
registration. Checks resume after restart and only fetch the stored Message SID;
they never create another SMS. A lookup failure retains the previous status and
shows that the latest check was unavailable. Messages with uncertain creation and
no saved SID require manual reconciliation in Twilio, never automatic resend.
Signed callbacks and lookups cannot overwrite an already terminal local result.

Disabling follow-ups stops delivery polling and new sends; existing history can
still be read with the storage key in live mode. The existing 24-hour privacy
retention remains: message text and recipient details are cleared on next access,
while status tombstones remain for deduplication. Polling currently applies only
to this local CALL-E workflow; the generic Supabase SMS service uses callbacks.

## Demo SMS preview with real calls

Set `SENIOR_PHONE_AI_MODE=live`, `CALLE_FOLLOWUP_ENABLED=true`,
`CALLE_FOLLOWUP_PREVIEW=true`, and `SMS_ENABLED=false`, then restart the app.
Keep the encrypted storage key and consented Australian test-recipient allowlist.
Twilio credentials and a callback URL are not needed in this mode. CALL-E calls
and requested OpenAI web searches remain live and can incur their normal charges.

The call uses natural language to ask whether the customer wants an SMS prepared
after the call. It does not repeatedly announce demo mechanics. The operator UI
remains explicit that the message is a preview and is not sent.
After the verified permission and completion checks, history records the exact
message as **Preview — not sent**. No Twilio send or delivery lookup occurs.
Preview registrations stay preview-only even if live sending is enabled later;
preview-only consent cannot authorize live SMS. A displayed prior failed message
can also be viewed as a preview without altering its failure history or retrying.
The existing 24-hour content retention still applies. Set
`CALLE_FOLLOWUP_ENABLED=false` to stop preparing new previews.
