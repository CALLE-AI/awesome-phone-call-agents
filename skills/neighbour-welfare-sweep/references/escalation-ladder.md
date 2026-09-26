# Outcomes and the escalation ladder

## Part 1 — deciding what one call established

Pure function. No model, no I/O. It never raises, and **it never returns `SAFE` on junk** — a call that produced no readable result is a person nobody has accounted for, not a person who is fine.

Inputs: the provider status, the structured result, **the person's triage assessment**, the fields this hazard made non-negotiable, any validation errors, and the provider's own completion confidence.

The triage assessment is an input for a reason: silence from a man on an oxygen concentrator mid-outage and silence from a healthy 40-year-old during an advisory are not the same event and must not sort together.

### Five outcomes

`SAFE` · `HELP_DECLINED` · `NEEDS_HELP` · `URGENT` · `UNREACHABLE`

There is deliberately no "hold for a human" outcome. All five are actionable, and a contradiction resolves pessimistically rather than parking.

### The table, in evaluation order

| Condition | Outcome |
| --- | --- |
| status is not "completed" (no answer, failed, unreadable, still dialling) | `UNREACHABLE` |
| completed, but no schema-valid result at all | `UNREACHABLE` |
| `is_safe_now == "no"` | `URGENT` |
| `equipment_working == "no"` — powered medical equipment has stopped | `URGENT` |
| `sounded_distressed == "yes"` | `URGENT` |
| critical band, and a hazard-required need check answered badly | `URGENT` |
| `reached_intended_person != "yes"` — voicemail, a carer, could not tell | `UNREACHABLE` |
| a need is established and they accepted an offer | `NEEDS_HELP` |
| a need is established and they turned down every offer made | `HELP_DECLINED` |
| a need is established and nothing was offered or answered | `NEEDS_HELP` |
| a required fact was never established (or the result failed validation, or provider confidence was low) — critical/high band | `URGENT` |
| …the same, at elevated/routine band | `NEEDS_HELP` |
| everything established, safe, nothing needed | `SAFE` |

### Four orderings that were chosen against the obvious alternative

- **The alarm checks run before the reached-them gate.** A daughter picking up her mother's phone to say *"she's on the floor and I can't lift her"* arrives as `reached_intended_person: "no"` **and** `is_safe_now: "no"`. Gating on "did we speak to the person themselves" first — the sensible order in a cascade where an answer about someone else is worthless — turns the most urgent call in the product into a shrug.
- **Distress is urgent, not a footnote on a need.** See `references/reading-distress.md`.
- **Life-support equipment stopping is urgent at any band**, with no corroboration, because the field guidance makes a `"no"` there impossible for someone who uses no equipment.
- **Safety asserted alongside an alarm resolves pessimistically**, and the reason says out loud that they told you they were fine. *"I'm alright"* from someone whose cooler died two days ago is the most common way this workflow fails.

### Provider confidence

A low completion confidence does not overturn what was said. It means you do not get to call the result complete — so `SAFE` comes off the table and the finding says which fact is unestablished.

### Priority: where a finding sorts

Write it as a hand-written table of (outcome × band), not a formula. Then changing what "critical + unreachable" outranks is a visible edit rather than a side effect of retuning a coefficient.

And put **critical + `UNREACHABLE` at the top, above `URGENT`**. A call that was answered tells you what is wrong and lets the ladder start with information. Silence from someone triage put hours from harm is unbounded, and it is exactly the person nobody would otherwise have chased.

## Part 2 — the ladder

```text
EMERGENCY_CONTACT   the person they nominated     the agent MAY CALL this number
BLOCK_CAPTAIN       the coordinator running it    the agent NOTIFIES them
RESPONDER           911 / an agency               the agent PREPARES A PAGE AND STOPS
```

**Every non-SAFE outcome opens an escalation, and `UNREACHABLE` opens one exactly like `URGENT` does.** That is the point of the whole design: an escalation is how the sweep refuses to forget the person who did not pick up.

One ladder per person per sweep. A second finding for the same person adds a rung; it does not start a parallel climb.

### Rung 1 — the nominated contact

Attempted only when the escalation actually *starts* on this rung — a person with nobody on file opens at the coordinator rung and this branch is never entered — and then only for the outcomes that justify telling a third party about someone's health: in practice `URGENT` and `UNREACHABLE`. `NEEDS_HELP` means you reached the person and they accepted a water drop; ringing their daughter about that is telling a third party about somebody's health because the software found it convenient, and it is the sort of thing that gets a check-in programme uninvited from the block. Those findings wait at the coordinator's board.

If you actually speak to the contact and they will go and look in, **stop climbing.** A human with a key is on their way, and that is a better outcome than anything further up the ladder.

**Skip honestly.** A person with nobody on file starts at the coordinator rung, and the audit trail must say *"skipped: no emergency contact on file"* — distinguishable from *"skipped: on file with no phone number"* and from *"called, no answer"*. A volunteer standing on a doorstep will ask exactly which one it was. Never let an escalation appear to have "escalated past the daughter" when there is no daughter.

### Rung 2 — the coordinator

A notification, carrying the outcome, the reason, the concerns and the person's last words. Not a dispatch.

### Rung 3 — prepare a handoff, and stop

Reached only for the worst outcomes (`UNREACHABLE`, `URGENT`) and only **at or above a configured triage band**. Below it, record that no packet was prepared and why. A packet is a page about a frail person's home; cutting one for every routine no-answer trains the coordinator to ignore them.

A prepared packet must **never block the rest of the roster**. The sweep goes back to calling immediately — awaiting a human is a state of one escalation, not of the evening.

## Part 3 — the packet

A **snapshot**, not a set of joins: what was true when it was cut is what a responder would be told, and it stays that way if the roster row is edited afterwards. Defaults are conservative — a blank "power dependent" field must not read to a paramedic as "no equipment".

- **`last_contact_at`** — when you last actually **spoke to them**, not when you last dialled. *"Last heard from 16:05"* and *"last dialled four minutes ago"* are different facts, and the second is worthless to somebody deciding whether to force a door.
- **`last_words`** — their voice, verbatim. Never the provider's summary.
- **`attempts`** — every dial, to them and to their contact, in order.
- **`recommended_action`** — phrased as a **request to a person**: *"Request an in-person welfare check at the address."* Never "dispatched", never "units en route", nothing in the past tense.
- **`spoken_script`** — written to be read aloud by someone under pressure. The first sentence carries the address and the medical fact and nothing else, because the reader may be interrupted before the second sentence, and if they manage one line it has to be the line that gets somebody to the right door prepared for what is behind it. Address, then hazard, then when you last spoke to them, then access notes, then their own words, then the ask.

End every script with the same sentence, every time:

> This is a neighbourhood check-in programme passing on information. No emergency service has been contacted by the system; nobody has been sent.

## Part 4 — release

One function, one door, one name.

- It is the **only** place `released_at` is ever assigned. Pin that with a test that greps your own source.
- It requires the name of a human, refuses an empty one, refuses anything with no letters, and refuses service-account names.
- It refuses a packet already released, and refuses an escalation that never reached the responder rung.
- **It transmits nothing.** It records that a named person decided a responder should be told, and hands back the script for them to read.

Provide `require_released(packet)` as the gate any future send path must call, so that in review there is one obvious thing to have failed to call.

## Part 5 — ending the sweep

- Work the list to the end. No early exit. The only stopping conditions are a spent call budget and a provider failure that is the same for every recipient.
- **Emit the unaccounted list** after the terminal state is persisted: everyone with no outcome and why — did not consent, never dialled, sweep ended before reaching them.
- Close an escalation only with a person's name attached. "We reached the contact" is a state about reaching a contact, never a statement that the neighbour is safe.
- Close the hazard only when **every** person has an outcome and **every** escalation is resolved. Otherwise it goes back to open, which is not a tidy ending and is not meant to be: there is still somebody on that block nobody has accounted for.
