# CareCall SG Pilot Runbook

This runbook is the operational gate for a small, consenting English-language pilot. CareCall is a reminder and check-in service, not a medical adviser, adherence monitor, or emergency service.

## 1. Deployment readiness

Configure these server-side values in the Vercel environment used for the pilot. Never paste their values into issues, pull requests, screenshots, or chat:

- `CALLE_ACCESS_TOKEN` and `CALLE_SERVER_URL`
- `CARECALL_OPERATORS_JSON`
- `CARECALL_SESSION_SECRET`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `CARECALL_DATA_ENCRYPTION_KEY`
- `CARECALL_MAX_CALLS_PER_DAY`
- `CARECALL_PUBLIC_BASE_URL`
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and `QSTASH_NEXT_SIGNING_KEY`
- `CRON_SECRET`

Use the [CareCall environment variable reference](./carecall-environment-variables.md) for safe acquisition, environment scoping, expiry checks, and rotation procedures. Never copy real values into this runbook.

Use a distinct preview or staging environment first. Ensure `CARECALL_PUBLIC_BASE_URL` points to that exact HTTPS deployment so QStash signs the same worker URL the application verifies.

Run the protected, read-only preflight from a trusted terminal:

```sh
npm run preflight
```

Before running it, inject `CARECALL_PUBLIC_BASE_URL` and `CRON_SECRET` from the deployment secret store rather than typing secret values into shell history.

The endpoint returns only booleans, counts, states, ages, and grouped failure reasons. It never returns credential values, phone numbers, operator IDs, senior IDs, job IDs, or care instructions.

Do not proceed unless `ready` is `true`. A `healthy: false` result means configuration is complete but an operational alert still requires review.

## 2. Queue acceptance matrix

Complete the following with fictional records and a fake or non-dialing provider before involving a participant:

| Scenario | Expected evidence |
| --- | --- |
| One manual request while idle | One job becomes ongoing and exactly one provider run exists. |
| Second manual request during a call | Second job remains queued until the active call is terminal. |
| Scheduled request during a manual call | Scheduled job waits behind the same global lease. |
| Cancel queued manual request | Job becomes cancelled, its phone ciphertext is cleared, and no provider run exists. |
| Duplicate QStash delivery | Stable request claim permits no second provider run. |
| Manual request waits 30 minutes | Job moves to human review and does not dial. |
| Provider creation is uncertain | Job moves to human review; operators inspect CALL-E before any new authorization. |
| Active lease is lost | Ongoing job moves to human review without redialing. |
| Scheduled occurrence is over 15 minutes late | Reconciliation marks it missed and never dials late. |
| Review date expires | Schedule stops, queued occurrence is invalidated, and fresh authority is required. |

Record the test time, environment, fictional job label, observed state, and pass/fail result. Do not record phone numbers or transcripts.

## 3. Accessibility and device gate

Verify the deployed interface with keyboard only at desktop and mobile widths:

1. Use the skip link and navigate every primary destination.
2. Open each call sheet and confirm focus enters the dialog, loops inside it, and returns to the invoking button.
3. Confirm Escape closes previews and authorization sheets but cannot dismiss an ongoing call view.
4. Test at 200% browser zoom and with increased text size; content must reflow without horizontal page scrolling or hidden actions.
5. Test light, dark, increased-contrast, reduced-motion, and reduced-transparency preferences.
6. Confirm queue and provider-state changes are announced without moving keyboard focus.
7. Confirm every action has a visible focus indicator and at least a 44-by-44-pixel target where practical.

## 4. Controlled live-call gate

The first live test requires a team member who has explicitly consented to receive the call. Do not use a senior or real medication details for the first test.

Start with one harmless English meal check-in:

1. Confirm the participant, phone number, exact time window, expected caller identity, and stop procedure immediately before authorization.
2. Confirm readiness is healthy and queue depth is zero.
3. Authorize exactly one call from the deployed interface.
4. Observe that the job moves from queued to ongoing to a terminal result.
5. Ask the participant whether the trust-first opening, automated-agent disclosure, purpose, anti-scam warning, and human callback option were clear.
6. Confirm the outcome says `Self-reported` and does not infer that food was eaten from provider completion alone.
7. Confirm logs, QStash messages, screenshots, and the browser contain no unmasked phone number after provider acceptance.
8. Confirm the next reconciliation run does not create another call.

Run the medication reminder scenario only after the meal check-in passes. Use a fictional instruction and verify that the agent gives no dosage, missed-dose, or repeat-dose advice.

## 5. Operational alerts

The readiness response may report:

- `queue_backlog`: five or more jobs are waiting.
- `oldest_queued_over_five_minutes`: investigate provider capacity, active-call state, and permitted windows.
- `active_lease_missing_job`: stop new authorizations and inspect Redis before changing the lease.
- `active_lease_terminal_job`: reconcile the terminal record and verify CALL-E before releasing anything manually.
- `active_call_stale`: inspect CALL-E and the latest audit event; never redial to test status.
- `human_review_required`: open Needs Attention and resolve each grouped reason using provider evidence.

If call creation is uncertain, the safe state is stopped and awaiting human review. Never retry blindly.

## 6. Pilot stop conditions

Pause all schedules and stop new authorizations when any of these occur:

- duplicate or unexpected calls
- unclear automated-agent disclosure or participant confusion
- any medical advice, unsupported outcome, or false emergency claim
- exposed credentials, phone numbers, transcripts, or health information
- an unreconciled active lease or unknown provider state
- queue delay that pushes a job outside its permitted call window

Cancellation cannot recall a call already accepted by the provider. If a live call must end, follow the provider's documented termination process and contact the participant directly.

## 7. Evidence and sign-off

Pilot sign-off requires:

- deployment preflight output with secrets excluded
- completed queue acceptance matrix
- keyboard, zoom, contrast, motion, transparency, and responsive audit results
- consent record for each controlled live test
- CALL-E run identifier and conservative CareCall result
- confirmation that no duplicate call occurred after reconciliation
- named operator and reviewer approval to increase volume

Keep the pull request in draft until these deployment and live-call gates are completed.
