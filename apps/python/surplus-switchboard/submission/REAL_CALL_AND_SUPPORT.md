# Actual call and unresolved integration

One specifically authorized CALL-E role-play completed on September 13, 2026 at approximately 9:08 PM Eastern. The authenticated dashboard displayed a 46-second call ended ByRobot. This is actual provider evidence, distinct from the bundled fictional fixtures. The recipient also confirmed completion.

At 18–30 seconds the recipient said: "Yes. I understand. This is an AI call being recorded for a fictional demonstration. For this role play, I can accept 6 portions of produce." At 38–40 seconds the recipient confirmed the read-back with "Correct."

The AI disclosure was interrupted by call screening. The agent subsequently used the operator's name. This observed defect is retained here; the local prompt now instructs the agent to identify as AI on behalf of the operator and repeat disclosure after screening.133 tests pass; no second live call validates that prompt change.

## API evidence

api-request.redacted.json is a sanitized copy of the actual request. It omits the phone, credential and exact private idempotency key. The request was recorded in a durable creation ledger before transmission. No confirmed logical call task ID was received, so the ledger holds the attempt as unknown_reconcile_manually. The dashboard physical recording ID returns404 from GET /v1/calls/{id}. Authenticated GET /v1/goals succeeds but returns no goals. No retry, redial or invented structured REST result occurred.

The real telephone interaction succeeded. Automated result-to-planner reconciliation has NOT been demonstrated. The video separates earlier local planner footage from this subsequent real-call outcome. All portions are fictional; this is not a real organization, donation, reservation, delivery or food-safety confirmation.

## Support email, sanitized

Sent to support@heycall-e.com on September14 at01:17:42UTC; sent copy verified in the entrant's mailbox. No response was present at the pre-submission check. This is the entrant's outgoing request, not an endorsement or response from CALL-E.

Subject: Recover completed Calls API task ID after uncertain create response — Surplus Switchboard

Hello CALL-E team,

I am finishing Surplus Switchboard for the CALL-E hackathon. One authorized fictional role-play call completed successfully, but our POST /v1/calls did not return a confirmed logical task ID. We have not retried or redialed.

The original Idempotency-Key is [REDACTED]. The dashboard shows physical call ID [REDACTED], September13 at9:08PM Eastern, duration46seconds, ended ByRobot. GET /v1/calls/[REDACTED] returns404. Authenticated GET /v1/goals succeeds but returns no goals.

Please provide the logical call task ID associated with this existing attempt, or a read-only recovery procedure, so we can retrieve its structured result and reconcile the recorded evidence. Please do not initiate another call. Our durable ledger remains locked against duplicate creation.

Your documentation says replaying an identical request with the same idempotency key returns the original call. Before attempting any POST recovery, please confirm whether that applies to this completed request and whether the key remains retained. We would prefer read-only recovery.

No phone number, audio, transcript or API credential is included in this message.

Thank you, Belal
