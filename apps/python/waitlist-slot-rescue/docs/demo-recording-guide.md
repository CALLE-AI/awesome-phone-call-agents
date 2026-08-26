# Competition demo recording guide

This guide produces a truthful sub-three-minute demonstration with real product
footage, one clearly authorized phone test, and no exposed personal data.

## Final cut

Target **2:35-2:45**. Use an English human voice for the narration. The live
conversation may be in German if English subtitles are burned in.

| Time | Picture | Human narration or on-screen copy |
| --- | --- | --- |
| 0:00-0:12 | Empty service slot and ordered waitlist | “A cancellation is valuable for minutes, but calling a waitlist by hand is slow and calling everyone creates a race.” |
| 0:12-0:28 | Judge console, request validation | “Waitlist Slot Rescue validates consent, expiry, category, unique recipients, and queue order before any call is allowed.” |
| 0:28-0:58 | Golden-path replay | “It calls one person at a time. A verified decline advances the queue. The first evidence-backed yes stops it, leaving the remaining candidate untouched.” |
| 0:58-1:14 | Decision panel and audit JSON | “The system records intent, never creates a booking, and exports a privacy-safe decision trace for review.” |
| 1:14-1:39 | Safe-halt replay | “A hang-up, silence, interruption, or conflicting evidence becomes unknown. Unknown stops the cascade. It never becomes consent.” |
| 1:39-2:08 | Real phone footage, German call with English subtitles | “This is one authorized call to the owner of the test number, using the corrected German locale.” |
| 2:08-2:27 | Terminal fixture run and public test evidence | “The same Python engine behind the demo has deterministic fixtures, stable idempotency keys, and regression coverage for the dangerous edge cases.” |
| 2:27-2:42 | Impact model and final decision | “In a reproducible 10,000-trial model, active operator time falls 81 percent. Humans keep the commitment; automation removes the dialing.” |

Do not use synthetic narration, copyrighted music, stock-brand footage, or a
marketing-only slide sequence. The project must be visibly functioning on the
screen.

## Authorized German phone scene

The recording participant must own the destination number and authorize this
exact test. Use only one candidate. Never show the phone number, CALL-E call ID,
account details, API key, dashboard notifications, or an unredacted transcript.

The expected wording may vary because the agent is goal-driven. The participant
should answer naturally and pause after each response:

1. Agent discloses that it is an AI assistant and that the number came from an
   opt-in waitlist.
2. Participant: **“Ja, das bin ich.”**
3. Agent asks permission to continue the AI-assisted conversation.
4. Participant: **“Ja, wir können fortfahren.”**
5. Agent explains that one slot is available but not yet reserved, and that a
   human must confirm it.
6. Participant: **“Ja, ich möchte den Termin. Bitte lassen Sie ihn von einem
   Mitarbeiter bestätigen.”**

If the agent cannot hear the participant, the participant should say once:
**“Können Sie mich hören?”** If the conversation is still unreliable, end the
call. The correct product result is then `unknown` and a safe halt, not a second
attempt during the same take.

## Camera and audio setup

- Use two devices: one receives the call on speakerphone; the other records a
  steady horizontal shot at 1080p/30 fps.
- Frame the participant and phone without showing the incoming number. Disable
  visible message previews and unrelated notifications.
- Record 10 seconds of room tone before the call. Avoid a loud room, echo, or a
  television in the background.
- Keep the phone close enough that both voices are intelligible. Do not add
  music beneath the conversation.
- Leave two seconds of silence before answering and after the call ends. This
  gives the editor clean cut points.
- Confirm that recording and publication are permitted for the account,
  provider, location, and every person captured before recording.

## One-call launch gate

Before execution, verify all of the following:

- destination is the authorized participant's number in E.164 format;
- candidate locale is `de-DE`;
- category is non-regulated and the slot is fictional or genuinely authorized;
- request contains exactly one candidate;
- offer expiry and slot time are still in the future;
- camera and screen recording are already running;
- live command includes both `--execute` and
  `--confirm-authorized-waitlist`; and
- no second live command is run if the result is unclear.

After the call, preserve only the minimum redacted evidence needed for the
video: connection state, duration, normalized outcome, workflow status,
booking-created flag, redial flag, and additional-candidate count.
