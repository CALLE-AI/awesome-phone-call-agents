# CALL-E developer feedback from building PharmaBridge

Concrete friction we hit while integrating the CALL-E Developer API (v0.7.0), the TypeScript SDK
(`@call-e/calle` 0.7.0), the docs, and the showcase repository. Each item includes where we saw it,
why it matters for real phone-agent workflows, and a suggested fix.

## API

1. **No way to cancel a call.** `canceled` is a documented `CallStatus`, but there is no
   `POST /v1/calls/{id}/cancel`. PharmaBridge calls several pharmacies in parallel and stops once
   one confirms stock. We can avoid dialing the queued ones, but calls already in flight keep
   using credits and pharmacist time.
   *Suggestion:* a cancel endpoint that ends a call cleanly and returns `status: canceled`.

2. **Call failure outcomes are not enumerated.** The errors page says the Calls API does not
   guarantee a distinct no-answer or decline value, and `failure_code` has no published enum. Goal
   Runs, however, have `no_answer`, `declined`, `timed_out`, and so on. Without stable codes,
   retry policy (retry a busy line, never retry a decline) turns into guesswork.
   *Suggestion:* expose the `GoalRunError.code` vocabulary on `CallTask.failure_code` as well.

3. **Result schemas cannot express "not stated".** `result_schema` does not support
   `type: ["string", "null"]`. We use sentinel values (`""`, `0`), but for numbers `0` is
   ambiguous: `hold_duration_hours: 0` could mean "no hold" or "not mentioned".
   *Suggestion:* support nullable scalar types, or document a recommended "unknown" convention
   for numbers.

4. **No list endpoint for calls.** There is no `GET /v1/calls`, so if a browser tab or server
   restarts mid-mission, in-flight call ids are unrecoverable unless the client persisted them.
   *Suggestion:* `GET /v1/calls?metadata[mission_id]=...` with cursor pagination.

5. **Unsigned webhooks.** The SDK marks `webhooks.verify()` / `unwrap()` deprecated because
   deliveries are no longer signed. Receivers therefore have to treat payloads as hints and
   re-fetch from the API before trusting them, which is what PharmaBridge does.
   *Suggestion:* HMAC signatures with a per-project secret and a timestamp header.

6. **Event types are undocumented.** `GET /v1/calls/{id}/events` returns `type` strings, but
   only `call.completed` appears in the docs. A real-time UI needs to know which events exist
   (dialing, IVR menu, DTMF sent, hold detected, human detected, and so on) and whether
   `transcript_turns` fill in while a call is `in_progress`.
   *Suggestion:* publish the event type enum and the transcript streaming behavior.

7. **Locale codes per region are implicit.** The regions page lists languages (for example,
   India: English, Hindi, Tamil) but not the BCP 47 `locale` values the API accepts, so
   `unsupported_language` is only discovered at runtime.
   *Suggestion:* list accepted locale codes per region.

## Observed on a live call (2026-09-14, India test line, provider id `b827f0ed…`)

12. **Top-level status lags the attempt.** While the phone was ringing, `CallTask.status` stayed
    `queued` although the attempt was `in_progress`. A client that reads only the top-level status
    shows "queued" for the whole ring. *Suggestion:* move the task to `in_progress` once an attempt
    starts, or document that attempts are the source of truth for live progress.

13. **Telephony states arrive as free text.** The events were `call.started`, `call.in_progress`,
    and many `call.updated` rows whose messages carried the real state ("Call is ringing.",
    "calling task status=NO ANSWER"). PharmaBridge has to pattern-match messages to show
    ringing versus talking. *Suggestion:* typed events such as `call.ringing`, `call.answered`,
    `call.voicemail_detected`, `call.ivr_dtmf_sent`, and `call.ended`.

14. **The no-answer reason only lives in a message string.** The call ended with
    `failure_code: "call_failed"` and `failure_message: "calling task status=NO ANSWER (Hangup by: bot)"`.
    This confirms item 2 with real data: retry logic has to parse English.

15. **The summary reads like a chat reply.** For that failed call, `summary` said the recipient "may
    be busy or unavailable; you can confirm retrying in about 45 minutes, provide a different retry
    time, or ask to retry immediately." In an API response this is confusing. *Suggestion:* a
    neutral outcome summary plus a machine-readable `retry_after_seconds`.

16. **What worked well.** Even for the no-answer call, the extractor returned a schema-valid
    `structured_result` (`reached: "no_answer"`, every field present) with a completion confidence
    of 0.88. That let PharmaBridge treat failures uniformly without special cases, and the
    `provider_call_id` made the ledger record traceable to the CALL-E dashboard.

17. **A call that never rang was reported as "no answer".** The handset never rang, and the attempt's
    `started_at` equals its `completed_at` with attempt-level `failure_code: "408"`. The task still
    reported `NO ANSWER` and a summary suggesting the recipient "may be busy". A caregiver app then
    tells the family the facility didn't pick up, when the call never reached the network. This
    matches the India zero-ring reports in awesome-phone-call-agents#591. *Suggestion:* a distinct
    `not_delivered` / `route_unavailable` outcome, and a documented meaning for attempt-level codes
    such as `404` and `408`.

18. **Region restrictions change outside the API.** The regions page lists India as supported, but
    the September 7 tightening of some regions was announced only on Discord and in an issue comment
    (call-e-integrations#102). The API accepted the call and it failed later at the carrier.
    *Suggestion:* reject the create request with `region_unavailable` when a route is restricted,
    and keep the regions page's current availability in step with that.

## Observed on a completed live call (2026-09-14, CALL-E US test line, provider id `9a9adaad…`)

19. **Transcripts arrive only after hang-up.** `transcript_turns` stayed empty for the whole call and
    all seven turns appeared at completion. During the call the conversation existed only as
    free-text event messages ("Callee said: …", "Bot is speaking: …"). PharmaBridge rebuilds a live
    transcript by parsing those strings. *Suggestion:* fill `transcript_turns` while the attempt is
    `in_progress`, or emit typed `transcript.turn` events with `speaker`, `text`, and an offset.

20. **"Callee interrupted" carries the agent's words.** The message
    "Callee interrupted: Hi, this is an a ... [interrupted]" holds the agent's cut-off sentence, not
    the callee's, which is easy to misattribute. *Suggestion:* typed speech events with an explicit
    speaker and an `interrupted` flag.

21. **What worked well.** The official US test line answered about five seconds after ringing, and a
    generic receptionist reply ("I don't have inventory or dispensing information") produced
    `stock_status: "unknown"` with a verbatim evidence quote instead of a guess. That is exactly the
    abstention a caregiver-facing app needs.

## SDK (`@call-e/calle` 0.7.0)

8. **Inconsistent casing.** Every SDK field is camelCase except transcript turns, which are passed
   through raw as `{ offset_seconds, speaker, text }` (`dist/calls.js`, attempt mapping). Typed
   consumers end up with mixed casing in one object.
   *Suggestion:* map turns to `{ offsetSeconds, speaker, text }`, or document the exception.

## Docs

9. **The OpenAPI server URL is labelled a placeholder.** `servers[0]` is
   `https://api.heycall-e.com` with the description "Placeholder developer API base URL", even
   though it is the live endpoint. That makes developers wonder whether they have the right host.

10. **The docs landing page is nearly empty for AI tooling.** Fetching `docs.heycall-e.com`
    returns little beyond links to the quickstart and the OpenAPI file, so coding agents and
    crawlers miss the calls, errors, regions, and goal-run pages.
    *Suggestion:* an `llms.txt` / `llms-full.txt` index.

## Showcase repository (`awesome-phone-call-agents`)

11. **The repository cannot be checked out on Windows by default.** `git clone` fails with
    "Filename too long" because of committed Next.js build output
    (`apps/python/aftercare/static/frontend/_next/...`), Salesforce metadata, and long fixture
    names. Contributors on Windows need `git config core.longpaths true` before cloning.
    *Suggestion:* a validator check for maximum path length and for committed build artifacts,
    plus a note in CONTRIBUTING.
