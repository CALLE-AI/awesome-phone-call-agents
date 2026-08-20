# Worked examples

Every example uses Ofcom-reserved fictional numbers and invented patients. Four of the
six outcomes below look like failures and are not.

## 1 — Clean pass, auto-closed

Margaret, seen on Tuesday for a knee review. No medication change.

```
agent    You saw someone here on Tuesday, and the practice asked me to check how
         you've been getting on since.
other    Oh, much better thank you. Walking to the shop again.
agent    Since Tuesday, are you feeling better, about the same, or worse?
other    Better. Much better.
agent    Is there anything worrying you?
other    No, I don't think so. It's all been fine.
agent    Would you like the surgery to see you again?
other    No, no need.
```

```json
{"feeling": "better", "medication_ok": "not_asked", "wants_seen": "no",
 "carried_words_text": null, "carried_words_turn": null,
 "stop_condition": false, "stop_reason": null}
```

Auto-closed. All four clauses hold, so nobody is asked to read it. `medication_ok` is
`not_asked` because the appointment changed nothing, and `not_asked` counts as set.

Note that `carried_words_text` is null and the item still auto-closes. She was asked
whether anything worried her and said no. There is nothing to carry, and inventing a
reassuring quote from "it's all been fine" would be generating prose.

## 2 — Wants to be seen, queues for a human

Arthur, seen on Monday, blood-pressure tablets changed.

```
agent    Are you getting on alright with what they gave you?
other    I think so. They make me a bit light-headed when I stand up but I'm
         taking them.
agent    Is there anything worrying you?
other    Well, the dizziness. I have to hold the worktop for a minute when I get
         up in the morning.
agent    Would you like the surgery to see you again?
other    Yes, I would, if that's alright.
```

```json
{"feeling": "same", "medication_ok": "unsure", "wants_seen": "yes",
 "carried_words_text": "I have to hold the worktop for a minute when I get up in the morning",
 "carried_words_turn": 6,
 "stop_condition": false, "stop_reason": null}
```

Queues, because `wants_seen` is yes. The quote is a substring of turn 6, ending where
his sentence ends — not extended into the agent's next turn, and not smoothed into
"patient reports postural dizziness". If a Reviewer releases this, a receptionist hears
Arthur's own words about the worktop.

## 3 — Red flag, agent stopped, Safety Line read

Joan, seen on Wednesday.

```
agent    Since Wednesday, are you feeling better, about the same, or worse?
other    Worse I'd say. I've had a pain in my chest since yesterday teatime.
agent    Thank you for telling me. That's something a person needs to hear, not
         a computer, so I'm going to stop here rather than get it wrong.
         Please ring 111 and tell them what you've just told me. They're there
         day and night, and they'll decide what happens next. If it feels like
         an emergency, ring 999.
         I'm letting the practice know we spoke, and someone there will see this
         today.
```

```json
{"feeling": "worse", "medication_ok": "not_asked", "wants_seen": null,
 "carried_words_text": null, "carried_words_turn": null,
 "stop_condition": true, "stop_reason": "red_flag_phrase"}
```

Flagged, at the top of the queue. Questions 3 and 4 were never asked, so `wants_seen`
is null — an incomplete call that stopped correctly, not a failed one. The Safety Line
is read verbatim, with nothing added about chest pain.

## 4 — The red flag the agent walked straight past

The case that justifies the second layer. Same symptom, but the model completed all
four questions without stopping.

```
agent    Since Wednesday, are you feeling better, about the same, or worse?
other    About the same. Though I've had a pain in my chest on and off.
agent    Is there anything worrying you?
other    Not really, no.
agent    Would you like the surgery to see you again?
other    No, I'll see how it goes.
```

The agent reported:

```json
{"feeling": "same", "wants_seen": "no", "stop_condition": false, "stop_reason": null}
```

The scanner reported:

```
flagged, red_flag_phrase
```

The scanner wins. On the agent's own account this would have auto-closed — `same`, no
stop, does not want to be seen, medication set — and a woman who mentioned chest pain
would have had her call filed as nothing needed. `scan()` runs over every finished
transcript for exactly this call. See ADR 0005.

## 5 — Refused before the questions

```
agent    Is now a good time?
other    No, I'm just going out.
agent    That's no trouble. I'll leave you be. Take care.
```

A complete outcome. Nothing retries, nothing reschedules automatically, and no Review
Item claims an answer she never gave. Being told no is the workflow working.

## 6 — No consent recorded

```
POST /checkins/{appointment_id}
409 {"refused": "no_consent"}
```

Refused before any provider call is made and before any credential is read. A 409 here
is the expected path, not an error condition — there is no consent question to ask on a
call that is never placed.
