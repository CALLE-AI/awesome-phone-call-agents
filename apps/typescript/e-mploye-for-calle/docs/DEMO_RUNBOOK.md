# Public demo runbook

Public URL: <https://e-mploye-for-calle.vercel.app>

The production deployment is fake-only. It never places a real phone call, and the fake response selector lets a reviewer exercise every outcome without spending CALL-E credits. E-mploye is one virtual employee with three task templates; the guided demo offers three reproducible scenarios so every judge sees the same product surface.

## Primary video path: safe reschedule

Use a desktop browser at 100% zoom. The desktop layout keeps the E-mploye identity, task catalog, configuration, approval boundary, and call-run panel visible without an internal scroll. The activity log remains below for optional inspection. The **Live mode setup** button shows the production-ready CALL-E configuration without exposing credentials.

1. Open the public URL and point out `FAKE · NO CALLS` and `1 virtual employee` in the header. The footer clarifies that the public demo is sandboxed while the repository includes the controlled real-call path.
2. Point out the three task cards: **Appointment desk**, **Lead follow-up**, and **Shift coordination**.
3. Keep the first prepared scenario, **Appointment desk** for Luna Studio, with **Requests another time** selected.
4. Click **Preview task**. Show the masked phone number, language/region, exact task, and `Safety checks passed`.
5. Click **Request approval**. Explain that previewing and requesting approval do not call anyone.
6. Click **Authorize call**. This is the explicit manager approval boundary.
7. Point out the **CALL-E execution trace**: approval recorded, sandbox call created, status refreshed, and result received.
8. Wait for the fake call to complete, or click **Refresh**. The job should reach **Result needs review**.
9. Show the structured result, confidence, alternate date/time, transcript, evidence, and the trace event that brought it back.
10. Click **Approve & apply appointment**. The appointment should become **rescheduled** for `2026-09-08 · 10:00–11:00`.
11. Point out the final trace event and the human-approved success message.

## Other prepared scenarios

After resetting the demo, choose **Lead follow-up** or **Shift coordination** from the task catalog. The dashboard loads the matching recipient and scheduled context, and the same preview → authorize → review → apply sequence remains available. This demonstrates that the same E-mploye identity and approval engine work across service, sales, and operations contexts.

The three scenarios use the same fake provider, structured result contract, evidence panel, trace, and human decision gate. Keep the video focused on the appointment flow and use the other cards as proof of the reusable product surface.

## Optional safety branches

Use **Reset demo** between branches so the screen stays clean.

| Scenario | Expected result | Manager action |
| --- | --- | --- |
| Confirmed | Structured `confirmed` result | Apply → shift becomes `confirmed` |
| Requests another time | Structured alternate date/time | Apply → scheduled item becomes `rescheduled` |
| Declined | Structured `declined` result | Reject → shift remains unchanged |
| Unknown / unclear | Structured `unknown` result | Apply is disabled; keep it for review or reject |
| Provider failure | Failed call with no shift mutation | Retry safely or close |
| Queued fake call | Fake call remains in progress | Cancel simulated call |

## Talking points

- One E-mploye identity can be configured for different business tasks.
- The manager previews the exact instruction before any call.
- Each call requires explicit authorization and uses a stable idempotency key.
- Phone numbers are masked in the UI and audit trail.
- Structured results are evidence, not automatic appointment, follow-up, or shift mutations.
- The **CALL-E execution trace** makes the approval boundary and provider lifecycle visible during the demo.
- Unknown, declined, and failed outcomes stay under human control.
- The public deployment is deliberately fake-only; live CALL-E mode remains opt-in and server-side.

## Reset before handing off

Click **Reset demo** before recording the final frame so the reviewer starts from the prepared employee list and empty call history. The public link always stays in fake mode.

## Video format

The official rules require a public video under three minutes showing the project functioning; they do not state that narration or recorded audio is mandatory. A silent screen recording with clear English on-screen captions is acceptable in principle, but a short voiceover plus English captions is stronger for the product story. If the narration is in Spanish, include English subtitles or an English transcript because the submission materials must be in English or include an English translation.

## Controlled live verification (local only)

The public Vercel deployment must remain fake-only. A real phone call is not required for the public demo: the repository proves the CALL-E integration with SDK contract tests that mock documented HTTP `201`/`200` responses and never contact a phone. If a private live proof is useful, configure a local `.env` with a server-side key and one authorized E.164 test number:

The no-call evidence can be reproduced with `npm run test:calle`; it invokes the real `@call-e/calle` SDK against a local fixture and verifies the create, status, and developer-events contracts without spending credits. See [docs/CALLE_SMOKE_TEST.md](CALLE_SMOKE_TEST.md) for the recorded output and the boundary between contract verification and carrier delivery.

```text
CALLE_API_KEY=your_server_side_key
CALLE_LIVE_ENABLED=true
CALLE_BASE_URL=https://api.heycall-e.com
CALLE_TEST_PHONE=your_authorized_e164_test_number
CALLE_TEST_REGION=US
CALLE_TEST_LOCALE=en-US
EMPLOYE_API_TOKEN=private_app_bearer_token
```

Run the local server, verify the preview shows the masked test number, authorize the call once, and inspect the returned status/result before applying any scheduling change. The number must be yours or explicitly authorized and must match one of CALL-E's currently supported recipient regions; Argentina (`AR`) is not currently listed as supported. CALL-E documents international lines as primarily intended for testing and does not document buying a dashboard phone number as a prerequisite for the one-shot Calls API. Never commit this `.env` or put the key in frontend variables.

The local server reports live mode as ready only when the provider requirements are present: `CALLE_LIVE_ENABLED=true`, `CALLE_API_KEY`, the official HTTPS `CALLE_BASE_URL`, `CALLE_TEST_PHONE`, `CALLE_TEST_REGION`, and `CALLE_TEST_LOCALE`. The live-capable API also requires a separate `EMPLOYE_API_TOKEN` bearer on every route. The dashboard's **Live mode setup** panel shows which requirements are configured, accepts one masked workspace target, and never accepts or displays either secret.
