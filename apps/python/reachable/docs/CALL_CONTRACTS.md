# Reachable — Call Contracts

Reachable places exactly two kinds of call: the **contact check** and the
**pattern follow-up**. Nothing else dials.

This document is the source for the task-text and disposition modules. Every
CALL-E fact is carried from [`SOURCES.md`](SOURCES.md) §2, verified against
OpenAPI 0.7.0.

The governing rule: **every mapping fails closed**. Anything ambiguous,
low-confidence, schema-invalid or not backed by the transcript goes to
`NEEDS_HUMAN`. Anything suggesting the contact did not know about the absence, or
does not know where the child is, goes to `URGENT_HUMAN`.

---

## 1. Rules that apply to both calls

### 1.1 Which vocabulary we consume

Reachable consumes the **Developer API** vocabulary: `queued`, `in_progress`,
`completed`, `failed`, `canceled`. Terminal are the last three.

The uppercase CLI and MCP vocabulary, which includes `NO_ANSWER` and `VOICEMAIL`,
does not map one-to-one onto it. Any uppercase value reaching the classifier is
**malformed** and routes to `NEEDS_HUMAN`, never coerced. There is a test.

**Voicemail, no answer and not-in-service are not statuses.** They do not exist
in any CALL-E enum, and `failure_code` has no published enum and is never branched
on. The `outcome` field in our own schemas is the only supported channel for them
([`SOURCES.md` §2.6](SOURCES.md#26-how-voicemail-no-answer-not-in-service-and-failure-are-reported)).

### 1.2 Schema subset

Both schemas stay inside CALL-E's supported subset: `type`, `properties`,
`required`, `enum`, nested `object`, simple `array.items`, `description`,
`additionalProperties: false`. No `$ref`, `oneOf`, `anyOf`, `allOf`, recursion,
format validation, or `additionalProperties: true`.

Stricter checks — string length, control characters, enum casing — run **locally**
after the result returns. Field descriptions guide extraction but are not
validation: "Hard validation comes from `type`, `required`, `enum`, and
`additionalProperties`."

Every decision field is a **string enum containing `unknown`**, never a boolean.
A boolean forces a guess; `unknown` lets the extraction report honestly that the
call did not establish the answer — which, for a safeguarding-adjacent question,
is the most useful thing it can say.

Neither schema uses a reserved recipient-result field name (`summary`, `status`,
`transcript`, `call_id`, timing fields).

### 1.3 No schema field can carry a phone number

Deliberate and load-bearing. `best_number_for_school` is an **enum**, not a
string: `this_number`, `wants_to_update`, `unknown`. There is nowhere for a new
number to go, so a new number cannot be captured by voice
([`SAFETY.md` §3.1](SAFETY.md#31-these-are-enforced-in-code-not-by-prompting)).

### 1.4 Signals read before any mapping applies

Classified on all of these together. If any fails, the case goes to `NEEDS_HUMAN`
and the `outcome` tables below are never reached:

| Check | Fails when |
| --- | --- |
| Binding | Call id, idempotency key, destination, `metadata.pupil_id` or `metadata.contact_id` disagrees with the reserved intent |
| Event type | Not one of `call.completed`, `call.failed`, `call.result_validation_failed` |
| `status` | `failed` or `canceled` |
| `failure_code` | Non-null. Logged verbatim, never branched on |
| `task_completed` | `false`, or `null` on a terminal call |
| `completion_confidence.score` | Below `REACHABLE_CONFIDENCE_FLOOR` (default 0.6), or null |
| `completion_confidence.label` | `low`, or outside the documented examples. Checked **as well as** the score |
| `structured_result` | `null`, empty, or missing a required field |
| Enum values | Outside our enum, or uppercase |
| Transcript | `identity_confirmed = yes` with no `speaker: user` turn supporting it |

### 1.5 Placeholders

A closed, validated set. A rendered task containing an unknown or unfilled
placeholder fails the preflight and cannot be sent.

`{school_name}` · `{contact_name}` · `{pupil_first_name}` ·
`{attendance_officer_name}`

**`{pupil_first_name}` is the only pupil-identifying value in either template.**
There is no placeholder for a surname, year group, form group, address, or the
absence reason.

### 1.6 Forbidden content

The assembled task must never contain the stems `fine`, `penalt`, `prosecut`,
`legal action`, `court`, or any medical-advice phrasing, outside the boundary
block that prohibits them. Asserted at render time; a violation refuses the
render and routes the case to a human
([`SAFETY.md` §3.1](SAFETY.md#31-these-are-enforced-in-code-not-by-prompting)).

### 1.7 Blocks used by both templates

**Disclosure block** — prepended verbatim:

```text
You are an automated assistant calling on behalf of {school_name}.
Say so in your first sentence.
If you are asked whether you are a person, say plainly that you are not.
If the person asks not to be called again, say you will record that, stop, and
do not ask anything further.
```

**Identity gate block** — prepended verbatim, immediately after disclosure:

```text
Before you say anything about any child, you must confirm you are speaking to
{contact_name}. Ask "Am I speaking to {contact_name}?" and wait for an answer.
If they say no, or you are not sure, do not mention any child, any name, or any
reason for the call. Say only that you will call back, thank them, and end.
If you reach a voicemail or answering machine, say only: "This is an automated
message from {school_name}. Please call the school office when you can." Say
nothing else. Do not name any child.
```

**Boundary block** — appended verbatim:

```text
You are gathering information only. You cannot agree to anything, confirm
anything as final, or commit {school_name} to any action.
Never ask for, accept, or repeat back a new phone number. If they want to change
their contact details, say the office will be in touch through the usual
channel, and record that.
Never mention fines, penalty notices, prosecution, court, or any legal action.
Never give medical advice. If the call touches a medical emergency, tell the
person to contact the emergency services and end the call.
Do not say or imply that the child is safe, present, or accounted for.
Use only the child's first name. Never use a surname, year group, or class.
```

---

## 2. The contact-check call

**Purpose.** Establish that this is still a good number for this named person,
and that they are still willing to be an emergency contact.

**Placeholders:** `school_name`, `contact_name`, `pupil_first_name`.

### 2.1 Task text

```text
{disclosure_block}

{identity_gate_block}

Once, and only once, you have confirmed you are speaking to {contact_name}:

The purpose of this call is a routine check of the school's emergency contact
list. It is not about anything that has happened.

Do these things in order.

1. Say that {contact_name} is listed as an emergency contact for a pupil at the
   school, and that the school is checking its list is up to date.
2. Say the pupil's first name, {pupil_first_name}, and ask whether they are
   still happy to be an emergency contact for {pupil_first_name}.
3. Ask whether this number is the best number for the school to use in an
   emergency.
4. If they say their details should be changed, say that the office will be in
   touch through the usual channel to update them. Do not ask for a new number
   and do not accept one if it is offered.
5. Thank them and end the call.

If at any point they say they are not the right person, or that they do not know
this pupil, stop discussing the pupil, thank them, and end the call.

{boundary_block}
```

### 2.2 Result schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "outcome",
    "identity_confirmed",
    "still_willing_to_be_contact",
    "best_number_for_school",
    "language_preference_note",
    "verbatim_identity_quote"
  ],
  "properties": {
    "outcome": {
      "type": "string",
      "enum": ["reached", "voicemail", "no_answer", "not_in_service", "wrong_person"],
      "description": "How the call ended. Use reached only if you spoke with a person. Use voicemail for an answering machine. Use no_answer if nobody picked up. Use not_in_service if the number is disconnected or unobtainable. Use wrong_person if a person answered but is not the named contact."
    },
    "identity_confirmed": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes only if the person clearly confirmed they are the named contact, in their own words. Use no if they said they are not. Use unknown if you did not ask, they did not answer clearly, or you are not certain."
    },
    "still_willing_to_be_contact": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did the named contact say they are still willing to be an emergency contact for this pupil? Use unknown if it was not clearly answered."
    },
    "best_number_for_school": {
      "type": "string",
      "enum": ["this_number", "wants_to_update", "unknown"],
      "description": "Use this_number if they confirmed this number is the right one. Use wants_to_update if they said their details should change. Never record a phone number anywhere in this result."
    },
    "language_preference_note": {
      "type": "string",
      "description": "If the person indicated they would prefer to speak a language other than English, or had clear difficulty in English, note that in a few words. Empty string otherwise."
    },
    "verbatim_identity_quote": {
      "type": "string",
      "description": "The exact words the person used to confirm or deny being the named contact, quoted as spoken. Empty string if they never addressed it."
    }
  }
}
```

`verbatim_identity_quote` exists to make the binding check reviewable by a human.
The code does not trust it on its own — it checks the `speaker: user` transcript
turns directly — but a member of staff reading a `NEEDS_HUMAN` case needs to see
what was actually said.

### 2.3 Mapping

| `outcome` | Additional condition | Next state |
| --- | --- | --- |
| `reached` | `identity_confirmed = yes`, transcript-backed, `still_willing = yes`, `best_number = this_number` | **`CC_VERIFIED`** |
| `reached` | `identity_confirmed = yes`, transcript-backed, `best_number = wants_to_update` | **`CC_UPDATE_REQUESTED`** + office task |
| `reached` | `identity_confirmed = yes`, transcript-backed, `still_willing = no` | **`CC_NO_LONGER_A_CONTACT`** |
| `reached` | `identity_confirmed = yes`, **no `speaker: user` turn supports it** | `CC_NEEDS_HUMAN` |
| `reached` | `identity_confirmed = unknown` | `CC_NEEDS_HUMAN` |
| `reached` | `still_willing = unknown` | `CC_NEEDS_HUMAN` |
| `reached` | `language_preference_note` non-empty | `CC_NEEDS_HUMAN` + staff task, whatever else is true |
| `wrong_person`, or `identity_confirmed = no` | — | **`CC_WRONG_PERSON`** + contact-health flag |
| `not_in_service` | — | **`CC_NUMBER_NOT_WORKING`** + contact-health flag |
| `voicemail` / `no_answer` | attempts remain | `CC_READY`, awaiting a **new** authorisation |
| `voicemail` / `no_answer` | budget spent | `CC_UNREACHED` |
| anything else, or any §1.4 check fails | — | `CC_NEEDS_HUMAN` |

Note `language_preference_note` overrides a success. A contact who struggled in
English may have agreed to something they did not fully follow, so the
"verification" is not trustworthy and a human should call.

### 2.4 Worked example A — clean

A contact answers, confirms, and is happy.

```json
{
  "id": "call_7a2f",
  "object": "call_task",
  "status": "completed",
  "task_completed": true,
  "completion_confidence": { "score": 0.93, "label": "high" },
  "failure_code": null,
  "metadata": { "pupil_id": "P-1041", "contact_id": "C-2088", "workflow": "contact_check" },
  "recipients": [
    {
      "id": "rcp_1",
      "phones": ["+447700900142"],
      "region": "GB",
      "locale": "en-GB",
      "status": "completed",
      "attempts": [
        {
          "id": "att_1",
          "phone": "+447700900142",
          "status": "completed",
          "transcript_turns": [
            { "offset_seconds": 0, "speaker": "bot", "text": "Am I speaking to Janet Okoro?" },
            { "offset_seconds": 4, "speaker": "user", "text": "Yes, this is Janet speaking." },
            { "offset_seconds": 22, "speaker": "user", "text": "Yes, of course, this is the best number for me." }
          ]
        }
      ]
    }
  ],
  "structured_result": {
    "outcome": "reached",
    "identity_confirmed": "yes",
    "still_willing_to_be_contact": "yes",
    "best_number_for_school": "this_number",
    "language_preference_note": "",
    "verbatim_identity_quote": "Yes, this is Janet speaking."
  }
}
```

**Processing.** Binding: call id, key, `+447700900142` against
`attempts[0].phone`, pupil `P-1041`, contact `C-2088` — all match. Score 0.93
clears 0.6, label `high`. Result complete. Transcript carries a `speaker: user`
turn affirming identity.

**Outcome:** `CC_IN_FLIGHT` → **`CC_VERIFIED`**. Contact health shows verified for
this term. This contact stays at cascade position 1.

### 2.5 Worked example B — messy

The number has changed hands. Someone helpful answers.

```json
{
  "id": "call_3d90",
  "status": "completed",
  "task_completed": true,
  "completion_confidence": { "score": 0.58, "label": "medium" },
  "failure_code": null,
  "metadata": { "pupil_id": "P-1041", "contact_id": "C-2089", "workflow": "contact_check" },
  "recipients": [
    {
      "phones": ["+447700900377"],
      "attempts": [
        {
          "phone": "+447700900377",
          "transcript_turns": [
            { "offset_seconds": 0, "speaker": "bot", "text": "Am I speaking to Daniel Fry?" },
            { "offset_seconds": 3, "speaker": "unknown", "text": "...yeah?" },
            { "offset_seconds": 9, "speaker": "user", "text": "Sorry, who did you say? I've had this number about a year." }
          ]
        }
      ]
    }
  ],
  "structured_result": {
    "outcome": "reached",
    "identity_confirmed": "yes",
    "still_willing_to_be_contact": "unknown",
    "best_number_for_school": "unknown",
    "language_preference_note": "",
    "verbatim_identity_quote": "...yeah?"
  }
}
```

**Processing.** This is schema-valid and almost every part of it is a trap.

- `task_completed` is `true`. Read alone, the call "worked".
- `identity_confirmed` is `yes`, extracted from the "...yeah?" at 3 seconds.
- But that turn's **`speaker` is `unknown`**, not `user`. It is unattributed and
  is therefore not evidence. The only genuine `speaker: user` turn says the
  opposite: they have had the number about a year.
- The **score is 0.58**, below the 0.6 floor, while the label is `medium` — a
  classifier checking only the label would accept it.
- `still_willing` and `best_number` are both `unknown`.

Four independent checks each catch this; one would have been enough.

**Outcome:** `CC_NEEDS_HUMAN`, reasons
`identity_not_transcript_backed; confidence_below_floor; willingness_unknown`.

**What a human sees:** the sanitised transcript with the speaker labels, the
three reasons, and a one-click route to mark it `CC_WRONG_PERSON`. Which is
almost certainly what it is — but "almost certainly" is a judgement for a person,
and the consequence of getting it wrong is that a stranger stays on a child's
emergency contact list, or a real contact is deleted from it.

**What never happens:** the contact is not marked verified, no number is
captured, and nothing redials on its own.

---

## 3. The pattern follow-up call

**Purpose.** Find out whether the contact is aware of the absence, what the
reason is, and whether the family needs support.

**Placeholders:** `school_name`, `contact_name`, `pupil_first_name`,
`attendance_officer_name`.

### 3.1 Task text

```text
{disclosure_block}

{identity_gate_block}

Once, and only once, you have confirmed you are speaking to {contact_name}:

This call is about a pupil's recent absence from school. Your purpose is to
understand what is happening and whether the family needs any support. It is not
to challenge anyone and not to warn anyone about anything.

Be warm and brief. This may be a difficult conversation.

Do these things in order.

1. Say the pupil's first name, {pupil_first_name}, and say that the school has
   recorded {pupil_first_name} as absent and does not yet have a reason.
2. Ask whether they were aware {pupil_first_name} has not been in school.
3. Listen carefully to the answer. If they say they did not know, or they sound
   surprised, or they say they do not know where {pupil_first_name} is, stay
   calm, say that someone from the school will call them straight back, thank
   them, and end the call. Do not ask further questions and do not reassure
   them that everything is fine.
4. Otherwise, ask what the reason for the absence is.
5. Ask whether there is anything making it difficult for {pupil_first_name} to
   attend at the moment, and whether the school can help with anything.
6. Ask whether they would like {attendance_officer_name} to give them a call.
7. Say that the school will record what they have told you, and that a member of
   staff will confirm it. Thank them and end the call.

Do not tell them what attendance code will be recorded. Do not say the absence
is authorised or unauthorised.

{boundary_block}
```

Step 3 is the most important instruction in either template. When a contact does
not know the child is absent, the correct behaviour is to **stop**, not to
investigate. Continuing to ask questions would delay the one thing that matters,
which is a member of school staff calling back within minutes, and could give
false reassurance. The model is told to end the call, and the state machine
routes it to `PF_URGENT_HUMAN` regardless of anything else in the result.

### 3.2 Result schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "outcome",
    "identity_confirmed",
    "aware_of_absence",
    "reason_category",
    "reason_note",
    "barrier_mentioned",
    "barrier_note",
    "wants_call_from_attendance_officer",
    "knows_child_whereabouts",
    "verbatim_quotes"
  ],
  "properties": {
    "outcome": {
      "type": "string",
      "enum": ["reached", "voicemail", "no_answer", "not_in_service", "wrong_person"],
      "description": "How the call ended. Use reached only if you spoke with a person. Use voicemail for an answering machine. Use no_answer if nobody picked up. Use not_in_service if the number is disconnected. Use wrong_person if a person answered but is not the named contact."
    },
    "identity_confirmed": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes only if the person clearly confirmed they are the named contact, in their own words. Use unknown if you did not ask, they did not answer clearly, or you are not certain."
    },
    "aware_of_absence": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did the contact already know the pupil was not in school? Use no if they were surprised, said they did not know, or thought the pupil was at school. Use unknown if this was not clearly established. Only use yes if they clearly indicated they already knew."
    },
    "reason_category": {
      "type": "string",
      "enum": ["illness", "medical_appointment", "family_emergency", "other", "prefers_to_speak_to_staff", "unknown"],
      "description": "The category that best matches the reason the contact gave. Use prefers_to_speak_to_staff if they would rather discuss it with a member of staff. Use unknown if no reason was given or it was unclear."
    },
    "reason_note": {
      "type": "string",
      "description": "A short factual note of the reason in the contact's own terms. Do not add interpretation. Do not record medical detail beyond what is needed to understand the absence. Empty string if no reason was given."
    },
    "barrier_mentioned": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did the contact mention anything making attendance difficult, such as transport, money, wellbeing, or something at school? Use unknown if not established."
    },
    "barrier_note": {
      "type": "string",
      "description": "A short factual note of the barrier in the contact's own terms. Empty string if none was mentioned."
    },
    "wants_call_from_attendance_officer": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did the contact say they would like a call from the attendance officer? Use unknown if not asked or not clearly answered."
    },
    "knows_child_whereabouts": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did the contact indicate they know where the pupil is right now? Use yes only if they clearly did. Use no if they said they do not know. Use unknown if this did not come up or was unclear."
    },
    "verbatim_quotes": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Up to three short quotes of what the contact actually said, quoted as spoken, covering identity, awareness, and reason. Do not paraphrase."
    }
  }
}
```

### 3.3 Mapping

Evaluated **in this order**. The first matching row wins.

| # | Condition | Next state |
| --- | --- | --- |
| 1 | `outcome = reached` and `aware_of_absence ≠ yes` (i.e. `no` or `unknown`) | **`PF_URGENT_HUMAN`** |
| 1b | `outcome = reached` and `knows_child_whereabouts = no` | **`PF_URGENT_HUMAN`** |
| 2 | Any §1.4 signal check fails | `PF_NEEDS_HUMAN` |
| 3 | `identity_confirmed = yes` with no `speaker: user` turn supporting it | `PF_NEEDS_HUMAN` |
| 4 | `outcome = wrong_person`, or `identity_confirmed = no` | `PF_CASCADE_ADVANCE` + contact-health flag |
| 5 | `outcome = not_in_service` | `PF_CASCADE_ADVANCE` + contact-health flag |
| 6 | `outcome ∈ {voicemail, no_answer}` | `PF_CASCADE_ADVANCE` |
| 7 | `reason_category = prefers_to_speak_to_staff` | `PF_SUPPORT_REQUESTED` |
| 8 | `barrier_mentioned = yes` or `wants_call_from_attendance_officer = yes` | `PF_SUPPORT_REQUESTED` |
| 9 | `reason_category` set and not `unknown` | `PF_REASON_GIVEN` + suggested reason for approval |
| 10 | anything else | `PF_NEEDS_HUMAN` |

**Rows 1 and 1b are deliberately first.** Awareness is the primary signal and is
evaluated before everything else: `aware_of_absence = unknown` escalates, because
"we could not establish whether this adult knew their child was missing from
school" is not a neutral result.

**Whereabouts is a secondary signal, and the two values are not symmetric.** An
explicit `knows_child_whereabouts = no` — the contact saying they do not know
where the child is — escalates on its own, even when they were aware of the
absence, because that sentence is the whole reason this product exists.
`knows_child_whereabouts = unknown` does **not** escalate by itself: the question
often does not arise naturally in a call where the contact clearly knew about the
absence and gave a reason, and escalating on it would fire on most ordinary
calls. It is recorded and shown on the case, so a member of staff can see that it
was never established.

The asymmetry is the point. A stated "I don't know" is evidence; a question that
never came up is not. Where evidence points at risk we escalate on weak signal;
where there is simply no evidence we do not manufacture an alarm from its
absence.

If the escalation rate still proves unworkable in practice, the fix is a better
question in step 2 of the task text, not a looser rule here.

Rows 7 and 8 come before row 9 because a family asking for help is more
actionable than a reason category. A case can carry both; the state reflects the
one that needs a person.

### 3.4 Worked example C — clean

Contact 2 in the cascade, after contact 1 turned out to be a wrong number.

```json
{
  "id": "call_b4e1",
  "status": "completed",
  "task_completed": true,
  "completion_confidence": { "score": 0.87, "label": "high" },
  "failure_code": null,
  "metadata": { "pupil_id": "P-1041", "contact_id": "C-2090", "workflow": "pattern_followup", "trigger_date": "2026-09-11" },
  "recipients": [
    {
      "phones": ["+447700900218"],
      "attempts": [
        {
          "phone": "+447700900218",
          "transcript_turns": [
            { "offset_seconds": 0, "speaker": "bot", "text": "Am I speaking to Martin Dunn?" },
            { "offset_seconds": 3, "speaker": "user", "text": "Speaking, yes." },
            { "offset_seconds": 18, "speaker": "user", "text": "Yes I know, she's been really poorly since Monday." },
            { "offset_seconds": 41, "speaker": "user", "text": "Honestly the bus fare has been the hard part this month." }
          ]
        }
      ]
    }
  ],
  "structured_result": {
    "outcome": "reached",
    "identity_confirmed": "yes",
    "aware_of_absence": "yes",
    "reason_category": "illness",
    "reason_note": "Unwell since Monday.",
    "barrier_mentioned": "yes",
    "barrier_note": "Bus fare has been difficult this month.",
    "wants_call_from_attendance_officer": "yes",
    "knows_child_whereabouts": "yes",
    "verbatim_quotes": [
      "Speaking, yes.",
      "Yes I know, she's been really poorly since Monday.",
      "Honestly the bus fare has been the hard part this month."
    ]
  }
}
```

**Processing.** Row 1 does not fire: both `aware_of_absence` and
`knows_child_whereabouts` are `yes`. Binding matches; score 0.87; identity backed
by the `speaker: user` turn at 3 seconds. Row 8 matches before row 9.

**Outcome:** **`PF_SUPPORT_REQUESTED`**, carrying the illness reason as a
suggestion for staff approval and a task for the attendance officer with the
barrier note.

This is the case that shows why the workflow is worth running. The school wanted
an attendance reason and got one; what it actually needed to know was that bus
fares are the problem, and nobody would have found that out from a text message.
Reachable does not act on it — it puts it in front of the attendance officer.

### 3.5 Worked example D — messy

The one the product exists for.

```json
{
  "id": "call_f772",
  "status": "completed",
  "task_completed": true,
  "completion_confidence": { "score": 0.71, "label": "medium" },
  "failure_code": null,
  "metadata": { "pupil_id": "P-1177", "contact_id": "C-2301", "workflow": "pattern_followup", "trigger_date": "2026-09-11" },
  "recipients": [
    {
      "phones": ["+447700900455"],
      "attempts": [
        {
          "phone": "+447700900455",
          "transcript_turns": [
            { "offset_seconds": 0, "speaker": "bot", "text": "Am I speaking to Paul Adeyemi?" },
            { "offset_seconds": 4, "speaker": "user", "text": "Yes, that's me." },
            { "offset_seconds": 20, "speaker": "user", "text": "Sorry, what? He left for school this morning, same as always." },
            { "offset_seconds": 27, "speaker": "user", "text": "What do you mean he's not there? He's not been there since when?" }
          ]
        }
      ]
    }
  ],
  "structured_result": {
    "outcome": "reached",
    "identity_confirmed": "yes",
    "aware_of_absence": "no",
    "reason_category": "unknown",
    "reason_note": "",
    "barrier_mentioned": "unknown",
    "barrier_note": "",
    "wants_call_from_attendance_officer": "unknown",
    "knows_child_whereabouts": "no",
    "verbatim_quotes": [
      "Yes, that's me.",
      "Sorry, what? He left for school this morning, same as always.",
      "What do you mean he's not there?"
    ]
  }
}
```

**Processing.** Row 1 fires immediately on two independent grounds:
`aware_of_absence = no` and `knows_child_whereabouts = no`. Nothing else in the
mapping is consulted. The confidence score of 0.71 is above the floor, but it
would not have mattered — **row 1 is evaluated before the signal checks**, so a
low-confidence result showing the same pattern also escalates. Fail-closed here
means escalating on weak evidence, not withholding on it.

**Outcome:** **`PF_URGENT_HUMAN`**, immediately, to the DSL queue, with the
sanitised transcript attached and the cascade stopped.

**What happens next in the product:** the case appears at the top of the Today
view with the count that cannot be dismissed, and in the DSL's queue. A person
calls the family back. Reachable's involvement is over.

**What Reachable does not do:** it does not conclude anything, does not contact
anyone else, does not record an attendance code, does not tell the contact
everything is fine, and does not mark the child as anything. It has done the one
thing it exists to do — got a person in front of this within minutes instead of
at the end of the week — and then stopped.

---

## 4. Summary of the fail-closed rule

| Situation | Where it goes |
| --- | --- |
| Contact unaware of absence, or whereabouts not confirmed | `URGENT_HUMAN`, before every other check |
| Everything clear, confident, transcript-backed | The one matching success state |
| Provider-reported voicemail, no answer or not-in-service | Cascade advances, or budget spent |
| Wrong person or dead number | Contact-health flag, cascade advances |
| Unclear, contradictory, low-confidence, malformed, unbound, or not transcript-backed | `NEEDS_HUMAN` |
| Anything not positively matched by a row above | `NEEDS_HUMAN` |

The last row is the one that matters: `NEEDS_HUMAN` is the default fall-through,
not a branch that has to be reached deliberately.
