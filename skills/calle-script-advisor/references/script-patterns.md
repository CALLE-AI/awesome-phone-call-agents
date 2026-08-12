# Script Patterns

CALL-E's `task` field description says: "Include the goal, relevant details the voice agent should know, and the exact information you want collected." A task that does this reads as ordinary prose, not a form. This reference breaks that prose down into the parts a reliable task needs.

## Anatomy Of A Good Task

1. **Identification** - who is calling, and on whose behalf. State it plainly in the first sentence: "This is <company/agent>, calling on behalf of <person or org>". A call that never says who it is trains the person on the other end to hang up, and gives them no way to verify the call was legitimate.

2. **Purpose** - the reason for the call, in one sentence, right after identification. Not a list of topics - the one reason this call exists.

3. **The single ask** - the exact question or confirmation the call must resolve. This is what the `result_schema` will capture. If the task cannot be reduced to one primary ask, the call is probably trying to do two calls' worth of work; see `references/safety.md` for why that matters and split it.

4. **Edge-case handling** - what the agent should do when the call does not go as planned:
   - **Voicemail or an answering machine** - leave a short message with a callback path, or hang up without leaving one, and say which.
   - **Wrong person** - confirm identity before proceeding with the ask; if it is the wrong person, apologize and end the call without disclosing details.
   - **Refusal** - if the person declines to answer or asks not to be called again, accept that immediately and end the call. See `references/safety.md`.
   - **Request to call back** - capture the preferred time if offered, but do not promise a specific callback unless the agent is authorized to commit to one.

5. **The close** - an explicit instruction for how the call ends once the ask is resolved: thank them and end the call, or the equivalent.

## Before / After

**Before** (vague, no identification, no edge cases, no close):

```text
Ask about the appointment.
```

This produces a low-confidence, unusable result. There is no stated goal, no identification, no instruction for voicemail, and no closing instruction. Run through the linter, this fails `TASK_TOO_SHORT`, `TASK_NO_IDENTIFICATION`, `TASK_NO_VOICEMAIL_GUIDANCE`, and `TASK_NO_CLOSING`.

**After**:

```text
This is Riverside Dental, calling on behalf of Dr. Alvarez's office about your upcoming appointment.
Please confirm whether Tuesday at 2pm still works for you, or ask to reschedule if not.
If you reach voicemail, leave a short message asking them to call the office back.
Thank them for their time and end the call.
```

Every part of the anatomy is present: identification, purpose, a single ask, voicemail handling, and a close. Check it with the linter before treating it as final:

```bash
node scripts/check-call-script.mjs --task "This is Riverside Dental, calling on behalf of Dr. Alvarez's office about your upcoming appointment. Please confirm whether Tuesday at 2pm still works for you, or ask to reschedule if not. If you reach voicemail, leave a short message asking them to call the office back. Thank them for their time and end the call."
```

## Matching The Schema To The Ask

Write the `result_schema` after the task, and make it capture exactly the single ask - not a transcript of everything the agent might hear. See `references/examples.md` for three complete task-plus-schema pairs, and `references/safety.md` for the rules that apply to both.
