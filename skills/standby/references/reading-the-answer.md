# Reading the answer

Three outcomes, not two.

**Anything that is not a clear yes is not a yes** — and anything that is not
clear at all is not a no either. The second half of that sentence is the one
this file exists to enforce, and it is the half that was missing.

## The cost of being wrong, which is what the ordering encodes

| Getting it wrong | What it costs |
|---|---|
| A false **acceptance** | Ends the cascade. The shift is unfilled and everyone else has been stood down. The supervisor finds out at 06:00. |
| A false **decline** | Passes over someone who was willing, and rings the next person about a shift that may already be taken. Costs one more call and looks like nothing went wrong. |
| A **hold** for a person | Thirty seconds of a supervisor's attention. |

When there is genuine doubt, the hold is the cheapest of the three. That is why
doubt gets its own outcome rather than being rounded into a decline.

## Order of trust

1. **The structured extraction**, when the call returned one. `decision` of
   `accept` / `decline` / `callback`, plus `arrives_at` or `callback_at`.
2. **The call status**, for anything that never became a conversation:
   `no_answer`, `busy`, `voicemail` → no answer. `failed`, `invalid_number`,
   `rejected` → failed.
3. **The English summary and evidence.** CALL-E writes these in English whatever
   language the call was in, which makes them a better classification target
   than prose in the shift's language.
4. **The transcript**, only to classify, and only the **callee's** half of it.
   Never to invent a time.

## The trap

Check for refusal *before* agreement.

> "Sorry, I can't take it today."

contains "can". A naive yes-check reads that as an acceptance, stops the
cascade, and the station opens one short. Refusal markers are tested first, in
both the shift's language and English.

## The second trap: the agent's own words

A transcript interleaves both sides of the call. The agent's script is written
to be agreeable and contains "Ja", "gerne" and "danke" in nearly every call —
so matching a yes-word against the whole transcript matches the agent
congratulating itself. Only the callee's lines are classified.

## Hold, do not guess

Stop the cascade and ask a person when any of these is true:

- **Nothing decidable.** Half a sentence, background noise, a hang-up mid-word.
- **Both at once.** The summary contains a refusal *and* an agreement and the
  run claims it completed the task. There is no honest way to pick one.
- **An agreement the run does not stand behind.** The wording reads as a yes but
  `task_completed` is false. The flag is the only corroboration there is.
- **A yes with nothing behind it.** The single sign of agreement is one word in
  the transcript, with no summary and no completion flag. That is the weakest
  possible evidence for the most expensive decision available.

While a call is held:

- **No further call is placed**, by this skill or by anything else driving the
  same cascade. Attempting one is an error, not a slow path.
- **Nobody is stood down.** The roster stays exactly where it is; a hold is a
  pause, not an ending, and recording it as an ending misreports the morning.
- **The reason is stated**, on the attempt and on screen. "Held for review" with
  no reason attached is a shrug.

## Resolving a hold

A person listens to the call and records what it meant. That resolution:

- **must carry their name.** An audit line reading "reconciled by (unknown)"
  looks like accountability without being it.
- **must be a real outcome** — accepted, declined, no answer. A hold that can
  resolve into another hold is not a stop condition.
- **lands in the same state the classifier would have produced.** A supervisor
  recording "she accepted" fills the shift and stands the rest of the list down,
  exactly as a read acceptance would, or the audit log is describing two
  different products.

The cascade then continues from precisely where it stopped.

## No stated arrival time

An acceptance without a time is still an acceptance. Record the arrival as
unknown rather than assuming the shift start; the supervisor can ask.
