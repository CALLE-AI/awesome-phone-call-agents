# Safety

Read this before compiling a ClaimKill plan that a host might later dial.

## Required

- Obtain explicit user intent to reconcile one freight fact on one ticket.
- Use only E.164 numbers supplied on the ticket. Mask them in summaries, for example `+1555****0184`.
- Preview the exact Party B destination, the kept refute question, dropped leak questions, and the spoken-time budget before asking for approval.
- Bind approval to that ticket, claim set, and question. Changed inputs need a new preview.
- Place at most one Party B refute call per approved run. A retry needs a new idempotency key and a new approval.
- Keep credentials, tokens, and webhook secrets out of fixtures, logs, and summaries.
- Treat voicemail, silence, empty transcripts, and unreachable dispositions as `UNREACHABLE`, not confirmation.
- Treat extraction confidence below 0.45 as `ABSTAIN`.
- If Party B consent is false, set `blocked_reason` to `missing consent` and do not ask a host to dial.

## Prohibited

- Booking appointments, cascade-until-yes outreach, surveys, or one-shot identity verification.
- Questions that disclose Party A's answer, including `warehouse said dock 3` on FR-1842.
- Hidden recurring schedules or duplicate jobs for the same ticket.
- Treating silence or voicemail as `SUPPORTED`.
- Medical, legal, financial, emergency, or authentication workflows.

## Content boundary

ClaimKill reconciles operational freight facts such as dock, arrival, and seal. Cargo labels are SKU references, not clinical advice. If a party refuses or asks to stop, end the call and mark remaining live nodes `UNREACHABLE` or `ABSTAIN`.

## Host responsibilities

The bundled scripts never place a call. A live host must enforce calling hours, consent storage, rate limits, audit logs, and legal review. The default path is `preview()` on fixtures with zero live CALL-E calls.
