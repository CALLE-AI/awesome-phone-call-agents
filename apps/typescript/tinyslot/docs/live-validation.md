# Live Validation

TinySlot was validated with one authorized CALL-E call on September 14, 2026. No phone number, private transcript, or credential is included in this repository.

## Observed Result

- CALL-E call ID: `call_YjAE3eI6e4yLBj_NecUmuQ`
- Terminal status: `completed`
- `task_completed`: `true`
- Completion confidence: `0.86` (`high`)
- Recipient structured result: present and schema-valid
- TinySlot classification: `qualified`
- Deterministic checks: 8 pass, 0 fail, 0 unknown

## Reproduce the Sanitized Proof

The proof command performs only `GET /v1/calls/{call_id}` through the CALL-E SDK. It never creates or repeats a call and prints no phone number, transcript text, credential, or personal data.

```bash
cd apps/typescript/tinyslot
npm run proof:live -- --call-id call_YjAE3eI6e4yLBj_NecUmuQ
```

For the demo video, record the resulting table for 10-15 seconds. Keep the terminal tightly cropped so `.env.local` and unrelated shell history are not visible.

The test recipient confirmed the fictional Willow Room Childcare scenario. The result contained the expected identity, age band, vacancy, date, weekdays, care hours, tuition, registration fee, subsidy, tour, and evidence fields.

## Recovery Observation

The CALL-E create request returned a durable call ID, but a later status request encountered a transient DNS/fetch failure while the call remained queued. TinySlot did not create another call. Polling resumed against the original call ID until the terminal result was available.

This validated the product rule that an uncertain client-side poll is not evidence that a phone call did not start.

## Limitations

This was one author-run test against an authorized number. It does not establish production reliability, childcare availability, or the accuracy of arbitrary conversations. The committed default remains the synthetic no-call demo.
