# Redacted live verification

## What was verified

One authorized CALL-E call was placed on August 23, 2026 to the owner of the
test number. The participant had explicitly agreed to this exact test. No
other recipient was configured.

The provider connected the call for 25 seconds. The participant ended the
call before the workflow obtained enough evidence to classify an acceptance
or decline. Waitlist Slot Rescue returned `unknown`, set the workflow status
to `halted-ambiguous-outcome`, created no booking, and did not place another
call.

This is evidence of the live provider boundary and the fail-closed path. It is
not presented as a successful participant acceptance.

## Privacy-minimized evidence

| Signal | Result |
| --- | --- |
| Authorized live attempts | 1 |
| Provider connection | Connected |
| Duration | 25 seconds |
| Hang-up party | Participant |
| Normalized outcome | `unknown` |
| Workflow status | `halted-ambiguous-outcome` |
| Booking created | No |
| Automatic redial | No |
| Additional candidates contacted | 0 |
| CALL-E usage shown for the attempt | USD 0.05, covered by promotional credit |

The phone number, provider call identifier, transcript, recording, API key,
OAuth material, and account identifiers are intentionally excluded.

## Finding and corrective action

The test request used `en-US` even though the participant was using a German
number. The call record did not expose enough conversation evidence to prove
whether the bot heard the participant. The participant also reported being
unsure whether the bot was listening.

The corrective change makes the call task candidate-locale-aware, directs the
agent to use one short question per turn, requires it to wait after each
question, and explicitly forbids treating silence, interruption, a hang-up,
or an unclear answer as agreement. Privacy-safe diagnostics now explain an
`unknown` result without returning raw transcript or evidence text. A
regression test reproduces an answered-then-ended call and proves that the
queue halts without a second attempt.

No second live call is required to claim these safety properties. Any future
live retest must receive separate authorization and use the corrected locale.
