---
name: photo-evidence-followup
description: Turn a parcel-inspection trace into one focused CALL-E conversation that asks an authorized, consenting contact for the exact replacement photo needed. Use after vision analysis requests a retake, wider view, label photo, or side view; do not use when the trace already supports a decision.
license: MIT
---

# Photo Evidence Follow-up

Use this skill after a parcel-photo inspection produces one of four evidence requests:

- `REQUEST_RETAKE`
- `REQUEST_WIDER_VIEW`
- `REQUEST_LABEL_PHOTO`
- `REQUEST_SIDE_VIEW`

The call only explains the missing photo and asks whether the contact can provide it through an already-approved secure upload route. It does not decide claim eligibility, accept a settlement, request secrets, collect payment, or file a claim.

## Prepare a no-call preview

The inspection trace and call request must satisfy the contracts in [`references/contracts.md`](references/contracts.md). Create the preview before considering a live call:

```bash
python3 scripts/prepare_followup.py \
  --trace parcel-trace.json \
  --request followup-request.json \
  --output call-preview.json
```

This command is deterministic, uses no credentials, and never contacts CALL-E. If the trace action is `STAGE_CLAIM_PACKET`, `MARK_VISUALLY_CLEAR`, or anything unsupported, it returns `call_needed: false`.

Show the operator the masked recipient, exact spoken goal, requested evidence, approved upload route, and stable idempotency key. Never print the full number outside the provider tool argument.

## Place one live call

A previous general authorization does not replace the confirmation for this exact recipient and preview. Immediately before a live call:

1. Confirm the user approved this exact one-call preview and the recipient has consented to this kind of operational call.
2. Check that no pending or completed run already uses the preview's idempotency key.
3. Call CALL-E `plan_call` with the preview's `task` as the goal and the unmasked E.164 phone from the private request input. Planning must not dial.
4. Review the returned plan. If it adds another purpose, asks for sensitive data, changes the upload route, or is not ready, stop without calling.
5. Call `run_call` exactly once with the `plan_id` and `confirm_token` from that plan.
6. Persist the returned `run_id`. A timeout or restart is not permission to call again.
7. Wait about 60 seconds before the first `get_call_run`, then poll the same `run_id` until terminal.
8. Normalize the result with [`references/contracts.md`](references/contracts.md). Only a direct, unambiguous answer counts.

The call must identify itself as an AI calling assistant, confirm the recipient is the intended parcel contact, ask permission to continue, and reveal only the non-secret case reference and requested photo. If the person declines or is the wrong recipient, end the call without disclosing parcel details.

## Stopping rules

- Stop after one accepted call task, regardless of outcome.
- Do not call for a trace that already stages or clears the case.
- Do not automatically retry voicemail, no answer, refusal, contradiction, timeout, provider error, or an unknown result.
- Do not schedule recurrence.
- Treat dates or upload promises as reported information; they do not authorize a claim or customer action.
- Keep transcript text out of downstream claim records. Retain the normalized answer and provider run ID only as long as the host's approved policy requires.
- For medical, legal, financial, emergency, identity-proof, or other high-stakes content, stop and return the case to a person.

## Output

Return the masked contact, CALL-E run ID, terminal status, whether the request was understood, whether the recipient can provide the photo, any stated timing, and `next_action: WAIT_FOR_SECURE_UPLOAD` or `HUMAN_REVIEW`. Never infer that a photo was uploaded from a phone promise.

Review [`references/examples.md`](references/examples.md) for call and no-call paths. Review [`references/safety.md`](references/safety.md) before adapting the workflow to another evidence domain.
