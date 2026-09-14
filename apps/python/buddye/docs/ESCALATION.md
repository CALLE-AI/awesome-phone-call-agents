# Outcomes, the ladder, and the handoff

`backend/app/orchestrator/decide.py` and `backend/app/orchestrator/escalate.py`. Tests: `tests/test_decide.py` (33), `tests/test_escalate.py` (42).

This is the one place the outcome table is written down. Everything else links here.

---

## Part 1 — what one call established

`decide()` is pure: no model, no I/O, it never raises, and **it never returns SAFE on junk**. Its job is to turn one finished call attempt into one of five outcomes.

```python
decide(*, status, result, risk=None, hard_fields=None,
       validation_errors=None, completion_confidence=None) -> DecisionResult
```

`status` is the provider status verbatim. Only `COMPLETED` means "there is a conversation to reason about"; `NO_ANSWER`, `FAILED`, `INVALID_RESULT` and any transient `PENDING`/`DIALING` are silence, and **silence is an input here, not an early return**. `risk` is the triage assessment, because silence from Walter mid-outage and silence from a healthy 40-year-old during an advisory are not the same event and must not sort together.

### The table, in evaluation order

| Condition | Outcome |
| --- | --- |
| status is not `COMPLETED` | `UNREACHABLE` |
| completed, but no schema-valid `structured_result` at all | `UNREACHABLE` |
| `is_safe_now == "no"` | `URGENT` |
| `checks.equipment_working == "no"` — powered medical equipment has stopped | `URGENT` |
| `sounded_distressed == "yes"` | `URGENT` |
| critical band **and** any hazard-required need check answered badly | `URGENT` |
| `reached_intended_person != "yes"` — voicemail, a carer, or could not tell | `UNREACHABLE` |
| a need is established **and** they accepted an offer | `NEEDS_HELP` |
| a need is established **and** they turned down every offer that was made | `HELP_DECLINED` |
| a need is established **and** nothing was offered or nothing was answered | `NEEDS_HELP` |
| a hazard-required fact, `is_safe_now`, or `needs_help_now` was never established (or the result failed validation, or CALL-E's own confidence was low) — at critical/high band | `URGENT` |
| …the same, at elevated/routine band | `NEEDS_HELP` |
| everything established, safe, nothing needed | `SAFE` |

### Four orderings that were chosen against the obvious alternative

- **The alarm checks run before the reached-them gate.** A daughter picking up her mother's phone to say *"she's on the floor and I can't lift her"* arrives as `reached_intended_person = "no"` with `is_safe_now = "no"`. Gating on "did we speak to the person themselves" first — which is what a hiring cascade does, because an answer about someone you did not speak to is worthless there — would turn the most urgent call in the product into a shrug.
- **`sounded_distressed == "yes"` is `URGENT`, not a note on a `NEEDS_HELP`.** Someone confused, slurred, or unable to follow the conversation cannot self-report, so their own "I'm fine" carries no evidentiary weight at all; and confusion is itself a symptom of heat illness and hypoxia. Guarded on `"yes"` only — `"unknown"` is what a voicemail returns, and must not make every voicemail urgent.
- **`equipment_working == "no"` is urgent on its own, at any band.** The extraction guidance only permits `"no"` from someone who actually uses powered medical equipment (`"unknown"` if they use none), so a `"no"` there is never a routine neighbour's answer — it is life support that has stopped.
- **Safety asserted alongside an alarm resolves pessimistically.** ShiftFill parked that exact contradiction in a human review queue. There is no hold here — five outcomes, all actionable — so it resolves to `URGENT` and the reason says out loud that they told us they were fine, because *"I'm alright"* from someone whose cooler died two days ago is the single most common way this product could fail.

### The residue row deserves its own defence

"We reached them, nothing alarming, but a fact this hazard made non-negotiable came back unknown" cannot be `SAFE`. `SAFE` means somebody checked and there is nothing to do. It becomes `URGENT` in the bands where triage already said harm is plausible within hours and `NEEDS_HELP` elsewhere, and in both cases the reason **names the fact we could not establish** rather than claiming the person asked for anything. A captain reading *"could not establish whether her cooler is running"* and a captain reading *"she needs water"* must not be handed the same sentence.

CALL-E's own `completion_confidence` feeds this row: a low label or a score below 0.5 does not overturn what was said, it means we do not get to call the result complete, so `SAFE` is off the table.

### What comes back

```python
DecisionResult(outcome, reason,
               concerns[],        # their own words, verbatim
               last_words,        # the single most alarming sentence they said
               findings[],        # derived: what we concluded, in sentences a volunteer can read
               checks{},          # dotted path -> yes/no/unknown
               unresolved[],      # facts this hazard needed and we never got
               help_accepted[], help_declined[], reached, band, priority)
```

`escalates` is simply `outcome is not SAFE`.

### Priority — where a finding sorts on the board

Hand-written rather than computed, so that changing what "critical + unreachable" outranks is a visible edit to a table and not a side effect of retuning a coefficient.

| | routine | elevated | high | critical |
| --- | --- | --- | --- | --- |
| `UNREACHABLE` | 35 | 50 | 75 | **100** |
| `URGENT` | 60 | 70 | 85 | 95 |
| `NEEDS_HELP` | 25 | 35 | 50 | 65 |
| `HELP_DECLINED` | 15 | 22 | 40 | 58 |
| `SAFE` | 0 | 1 | 2 | 3 |

Read the top row against the second: **the worst thing you can be told is that a neighbour triage put hours from harm did not pick up the phone.** A call that was answered tells you what is wrong and lets the ladder start with information. Silence there is unbounded.

---

## Part 2 — the ladder

`app/orchestrator/escalate.py` is **the safety boundary of BuddyE**. Everything else decides who to call and reads what they said. This is where the software decides to involve someone other than the neighbour.

```text
EMERGENCY_CONTACT   the person they nominated   BuddyE MAY CALL this number
BLOCK_CAPTAIN       the volunteer running it    BuddyE NOTIFIES her
RESPONDER           911 / an agency             BuddyE PREPARES A PAGE AND STOPS
```

Every non-SAFE outcome opens an escalation — **`UNREACHABLE` opens one exactly like `URGENT` does.** That is the point: the neighbour who did not pick up is the one nobody would have chased, and an escalation is how the sweep refuses to forget her.

### Rung 1 — the emergency contact

Attempted only when the escalation actually *starts* at `EMERGENCY_CONTACT` — a neighbour with nobody on file opens at `BLOCK_CAPTAIN` and the runner never enters this branch at all — and then only for `URGENT` and `UNREACHABLE` (`CONTACT_CALL_OUTCOMES`), and only when `CALL_EMERGENCY_CONTACTS` is on. `NEEDS_HELP` means we reached them and they accepted a water drop; ringing their daughter about that would be telling a third party about someone's health because the software found it convenient, and it is the sort of thing that gets a check-in programme uninvited from the block. Those escalations open at the captain's board instead.

If we actually speak to the contact and they will look in, **the climb stops**: a human with a key is on their way.

**Skips are honest.** A neighbour with no contact on file starts at `BLOCK_CAPTAIN` and the audit trail carries an explicit *"skipped: no emergency contact on file"* — distinguished from *"skipped: Elena Delgado is on file with no phone number"* and from a rung that was worked and nobody answered. A captain standing on a doorstep will ask exactly which one it was. Walter's seeded row has no contact deliberately, so the demo exercises that path.

### Rung 2 — the block captain

A notification, not a dispatch. It carries the outcome, the reason, the concerns and the last words.

### Rung 3 — prepare a handoff, and stop

Reached only for `UNREACHABLE` or `URGENT`, and only at or above `HANDOFF_MIN_BAND` (default `high`). Below that, `handoff.not_prepared` is emitted with the reason: a packet is a page about a frail person's home, and cutting one for every routine no-answer would train the captain to ignore them.

`build_handoff_packet()` writes a `HandoffPacket` with **`released_at = None`** and moves the escalation to `AWAITING_AUTHORISATION`. Together those mean the system has told nobody anything.

A prepared packet never blocks the rest of the roster: `AWAITING_HUMAN → CALLING` is a legal transition, and the sweep keeps going.

---

## Part 3 — the packet, and the one door out

A packet is what a first responder actually wants, assembled as a **snapshot** — what was true when it was cut is what a responder would be told, and it stays that way even if the roster row is edited afterwards.

- `last_contact_at` — when we last actually **spoke to them**, not when we last dialled. *"Last heard from: 4:05 this afternoon"* and *"last dialled: four minutes ago"* are different facts, and the second is worthless to somebody deciding whether to force a door.
- `last_words` — their own voice, verbatim: `alarming_quote` if there is one, otherwise their last non-agent transcript turn. **Never `CheckCall.summary`** — that is CALL-E's paraphrase, and a paraphrase read out to a paramedic as if the person had said it is a lie with a badge on.
- `attempts_summary` — every dial, neighbour and emergency contact alike.
- `recommended_action` — phrased as a **request to a person**, never as something already done. No "dispatched", no "units en route".
- `spoken_script` — written to be read aloud by somebody under pressure. The first sentence carries the address and the medical fact and nothing else, because a person reading this at 11pm may be interrupted before the second sentence, and if they manage one line it has to be the line that gets someone to the right door prepared for what is behind it.

Snapshot defaults are deliberately conservative: a roster row missing `power_dependent` must not read to a paramedic as "no equipment"; it reads as a field that was blank.

Every script ends with the same sentence, said out loud every time:

> This is a neighbourhood check-in programme passing on information. No emergency service has been contacted by the system; nobody has been sent.

### Release

```python
release(session, packet, *, escalation, released_by, note="") -> HandoffPacket
```

`POST /api/handoffs/{id}/release`. This is the moment a person decides a responder should be told, and the row records who they were. It:

- **is the only function in the codebase that assigns `released_at`** — pinned at source level by `tests/test_escalate.py`;
- refuses an empty name, a name with no letters, and every entry in `NON_HUMAN_NAMES` (`system`, `automation`, `bot`, `buddye`, `service account`, `cron`, `admin`, `test`, …). A service account is not a person, and `released_by` is the only record that anyone accepted responsibility;
- refuses a packet that was already released, and refuses an escalation that is not `AWAITING_AUTHORISATION`;
- **transmits nothing.** It records the decision and hands back the script for a human to read.

`require_released(packet)` is the gate any future transmit path must call, kept as a function so that there is one obvious thing to call and one obvious thing to have failed to call in review.

### Why this holds structurally, not by intention

- `escalate.py` imports no provider and has no way to reach one. It cannot place a call even by accident, and it must stay that way.
- There is no endpoint anywhere in this codebase that calls an emergency service.
- The trace states `"emergency_services_contacted": 0` as a fact of the document.
- Every packet payload carries `released: false` and `status_note: "prepared only — no emergency service has been contacted and nobody has been sent"` rather than leaving a client to infer it from a null.
- The neighbour's own call task, and the emergency contact's, both forbid implying that anyone has been summoned.
- On the dispatch side of the domain model the same boundary is applied again: `domain.state.requires_authorisation()` lets an agent commit community resources (a volunteer with water, a ride, a power cart) but never `EMS_UNIT`, `FIRE_UNIT` or `POLICE_WELFARE`. A `Dispatch` stamps `requires_authorisation` at proposal time and never recomputes it, so a later policy edit cannot retroactively un-authorise something a human approved, nor silently authorise something they did not.

### Closing one

`POST /api/escalations/{id}/resolve` with `resolved_by`. Also requires a person's name, because somebody has decided this neighbour is accounted for. Note that `CONTACT_REACHED` is a state about **us reaching a contact** — never about the neighbour being safe. Only `resolve()` says the latter.

A hazard reaches `CLOSED` only when every neighbour has an outcome **and** every escalation is resolved. On the seeded evening it settles back to `OPEN`, which is not a tidy ending and is not meant to be: there is still someone on that block nobody has accounted for.
