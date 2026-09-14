# Three-Minute Demo Script

## 0:00-0:25 - Problem

Show the TinySlot home screen.

Narration:

> Childcare availability is perishable information. A directory can tell a parent which centers exist, but not whether the toddler room has a Monday, Wednesday, Friday opening that covers their working day. TinySlot calls the approved centers and turns their current answers into comparable evidence.

## 0:25-0:50 - Privacy-Minimized Brief

Show the toddler profile, October 15 start date, required weekdays, care window, and budget.

Narration:

> The search uses an age band and constraints, not a child's name, birth date, diagnosis, or home address. The parent reviews every destination and the maximum three-call wave before anything runs.

## 0:50-1:20 - Adaptive CALL-E Wave

Choose **Run simulated search** for a reliable recording, then briefly show the documented live validation result.

Narration:

> CALL-E handles the conversations and returns one strict structured result per center. TinySlot keeps voicemail, refusal, waitlist, and unknown separate. It stops as soon as the requested number of qualified matches exists, avoiding three unnecessary calls in this example.

Overlay the author-run live evidence:

```text
Live call: completed
Task completed: true
Confidence: high (0.86)
Schema validation: passed
```

## 1:20-2:05 - Evidence Matrix

Open **Matches** and expand the three outcomes.

Narration:

> An AI summary does not decide the match. Deterministic code checks the intended business, age band, real opening, start date, weekdays, operating hours, subsidy requirement, and evidence. A waitlist is never upgraded into an opening, and missing evidence routes to review.

Show Willow Room and Alder House as qualified, then Moss & Moon as waitlist.

## 2:05-2:40 - Separate Tour Approval

Choose **Review tour request**, show the disclosure envelope, type `REQUEST TOUR`, and approve the synthetic follow-up.

Narration:

> Finding an opening does not authorize another call. The parent separately reviews exactly what may be shared. TinySlot cannot enroll, accept policies, pay fees, or disclose the child's identity.

## 2:40-3:00 - Outcome and Impact

Show the confirmed synthetic tour outcome and export the JSON evidence report.

Narration:

> TinySlot turns stale directory entries into a bounded, auditable childcare search: fewer calls, current evidence, explicit human authority, and a real next step. It is built with CALL-E's SDK, batch recipients, structured schemas, metadata, idempotency, and resumable result polling.

## Recording Notes

- Record at 1920x1080 with browser zoom near 100%.
- Keep the public demo in Demo mode so recording is deterministic.
- Do not show `.env.local`, real phone numbers, dashboard credentials, or a private transcript.
- Mention the live validation result without playing or exposing the private call.
- Keep the final video between 2:40 and 3:10.
