# Recorded role-play demonstration

This procedure connects one specifically authorized real CALL-E test to an explicitly fictional allocation. It is a procedure, not evidence that a call succeeded. The local verification uses fake providers and places no calls.

1. Prepare a private context with `"test_mode": true`, the consenting participant's exact number, existing permission reference, actual authorized window and a fictional category/quantity. The permission must cover the recorded/transcribed AI role-play and any separately authorized redacted publication. Verify account access, a no-new-charge allowance and an effective duration cutoff. Test mode does not supply those controls.
2. Prepare an entirely fictional planning snapshot with `"simulation": true`. Match the context's partner, batch and category. Use valid current planning/expiry/receiving times. Set the called partner's `manager_verified` to `false` initially. In simulation, every quantity and the optimizer's eventual `manager_verified` value concern the fictional exercise only.
3. Use the existing `calls.py` preview and exact approval procedure. The preview exposes the AI/recording/fictional disclosure and advisory timing request, masks the console phone, and sends nothing. A mode edit changes the approval digest. Only the coordinator may perform the separately authorized creation after all actual gates pass; never delete the ledger or create another attempt to recover an uncertain outcome.
4. After creation, read that same durable request using `calls.py --read-request-sha`. Retain the original private result envelope. This preserves the role-play scope before/after the provider response even when the provider omits its metadata. A call reaching a terminal status does not mean its task or recording succeeded.
5. Run the existing review command against the fictional snapshot and saved envelope. Use the actual confirmation time from the evidence. Review the real recipient identity/consent, AI role-play disclosure, recording/transcription, affirmative fictional quantity, exact quote and time. A result has `fictional_capacity`, not a real capacity confirmation. A refusal, uncertainty or invalid evidence remains held.

```text
python workflow.py review fictional-planning.json provider-result.json --db calls.sqlite3 --confirmed-at <ACTUAL_UTC_EPOCH> --output private-role-play-review.json
```

6. Only after human inspection, use the exact review SHA and acknowledgement:

```text
python workflow.py reconcile fictional-planning.json provider-result.json --db calls.sqlite3 --confirmed-at <ACTUAL_UTC_EPOCH> --approve-review-sha <EXACT_REVIEW_SHA> --acknowledge-evidence-review --output private-role-play-handoff.json
```

Both context and snapshot must opt in; either alone fails allocation. Evidence/snapshot edits invalidate approval. The result says `provider_role_play_simulation`; the plan and snapshot retain fictional labels, the snapshot retains its role-play source reference, and output provenance retains `call-e-rest-get`, request SHA, provider ID and fetch time. The plan hash covers the complete labeled snapshot. No live organization capacity, delivery or donation is established. Keep these labels in any demonstration or sanitized derivative.

Recomputing the approved snapshot with `optimizer.py` or the local browser preserves `simulation`, `evidence_scope`, `real_donation: false` and the snapshot's role-play provenance in the derived result. The browser visibly labels fictional quantities and its JSON download retains the same fields. Removing the simulation opt-in while retaining provenance/partner role-play markers, or changing provenance to claim real capacity, is rejected. A plain fictional snapshot with no provider provenance is labeled only as `fictional_simulation`.

The call prompt targets under 60 seconds and asks to end by 120 seconds. `duration_limit_enforced: false` records the actual limitation: the inspected provider contract has no duration or hangup control. A prompt, request timeout or stopping polling is not a guaranteed cutoff. Do not create a call under a strict duration authorization unless an effective cutoff has been arranged independently.

Private outputs contain actual evidence and may identify the participant. Keep full originals private; publish only a separately reviewed redacted demonstration within the participant's recorded permission. Do not describe fixture tests as authenticated calls. Do not edit timestamps to refresh old evidence for a later recording.
