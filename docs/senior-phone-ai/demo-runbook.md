# Margaret MVP demo runbook

Use a synthetic Margaret profile and a reserved fictional number for offline demonstrations. Do not display `.env.local`, provider dashboards, real contact data, browser storage, or raw private transcripts.

## Offline rehearsal

1. Set `SENIOR_PHONE_AI_MODE=preview` and run the automated suite.
2. Open `/dashboard` signed out and confirm it shows the private-workspace boundary without records.
3. Use the embedded PostgreSQL test as evidence for consent, family isolation, reminder claiming, post-call retention, and cross-account denial.
4. Use fake-provider tests as labeled no-call evidence for CALL-E lifecycle, SMS idempotency, scheduler retries, unknown dispatch, and post-call summaries.

Label offline evidence **Preview — no call or SMS sent**. It proves application behavior, not provider compatibility.

## Approved live browser demo

1. Use a non-production Supabase project and a test account with an authorized Margaret membership.
2. Open `/realtime` on `127.0.0.1` and start only after microphone consent.
3. Ask an unscripted current-news question, then request an event near the test location during the next seven days. Use results retrieved during this run; never substitute hardcoded event answers.
4. Request an SMS summary and review its exact masked destination, content, and source. Keep it in preview unless that recipient explicitly consented to this test.
5. Request a one-time reminder, repeat the time with AM/PM and timezone, review the action, and confirm it once.
6. Run the authenticated host scheduler. Before SPA-004, use preview/fake SMS and a separately approved CALL-E test recipient.
7. Open `/dashboard` and verify the completed-call timestamp, grounded summary, confirmed action, reminder state, and actual SMS state. Do not describe `queued` or `unknown` as delivered.
8. End Realtime, cancel pending work, stop the scheduler, clear synthetic retained records, and revoke temporary credentials.

Capture redacted evidence of same-session search status, retrieval time, UUID correlation ID, and safe source links. Mask phone numbers, provider call IDs, credentials, and unnecessary transcript text.

The inbound telephone proof remains SPA-004. Calling a venue is optional SPA-016 and is outside the required MVP demo.
