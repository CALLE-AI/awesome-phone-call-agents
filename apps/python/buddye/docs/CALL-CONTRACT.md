# The welfare call contract

`backend/app/calls/contract.py`. Tests: `tests/test_contract.py`. Preview any contract without dialling: `GET /api/hazards/{id}/contract?neighbour_id=`.

```python
compile_contract(hazard: HazardView, neighbour: NeighbourView) -> CallContract
```

Two views in, one contract out: the **task** (what the agent says to a frightened person) and the **`result_schema`** (the typed object the call must come home with). The hazard decides which facts are non-negotiable for this person, so the thing that matters today is a `required` field in a JSON Schema rather than a suggestion in a prompt the model may skip.

## Three rules the compiler enforces

### 1. Every required field is answerable when nobody picked up

Tri-states carry `unknown`, arrays may be empty, quotes may be `""`. A schema that could only be satisfied by a completed conversation would make the most important outcome in this product — silence — look like a validation error. `tests/test_contract.py` pins it.

### 2. BuddyE never summons anyone, and the task says so in words

> You cannot summon anyone and you must not suggest you can. If it is an emergency, tell them to hang up and dial 911 themselves if they are able, stay with them until they do, and say you will tell Alma Reyes right away. Do not offer to make that call for them.

There is no transfer, no dispatch, and no promise that anyone is on the way. Help is offered only from the hazard's `help_offered` list, **in the exact supplied words**, which is the only place a time, an address or a promise may come from:

> Never invent help, never say when it will arrive, and never give a place or a time that is not in those words.

### 3. The dossier stays home

`CheckCall.task` is persisted and the task text rides along in event payloads, and `obs.redact` masks phone numbers and credentials — not health text. So the task is parameterised from **derived** facts only (`power_dependent`, `mobility`, `lives_alone`, `cooling`, `has_transport`) and never interpolates a condition, a medication, or an address. `NeighbourView` is deliberately thin so that no construction path can smuggle them in, and it fills `first_name` in a validator so a hand-built view is as safe as one off a roster row.

First name only. And on voicemail:

> Voicemail, or anyone who is not Rosa: say only that the neighbourhood check-in programme called about the heat and will try again. Do not say why they are on the list, and never mention health, medicine, or equipment — you do not know who is listening.

## What decides `required`

```text
HAZARD_CHECKS[kind]                 heat        -> too_hot, has_power, has_water
                                    cold        -> too_cold, has_power
                                    power_outage-> has_power, equipment_working, has_medication
                                    flood       -> can_evacuate, has_water
                                    smoke       -> can_evacuate, has_medication
                                    storm       -> has_power, can_evacuate
                                    boil_water  -> has_water
                                    (unknown)   -> has_power, has_water
+ the person                        power_dependent      -> equipment_working
                                    not independent / no transport -> can_evacuate
                                    lives_alone          -> someone_with_them
```

Plus `equipment_hours_remaining` becomes required for a power-dependent neighbour. *"The concentrator is on"* is not the answer that matters during an outage; *"and it has about four hours"* is — the number is the escalation input, so the key may not be silently absent (`""` is still a legal answer).

**`required` means "the call may not come home without this fact". It does not mean "this must be yes".** `checks.has_power == "no"` during a blackout is not a failed requirement; it is the finding the escalation ladder exists for. That distinction is why `decide()` never rejects anyone.

Worked, from the seeded roster:

| | Rosa · heat warning | Walter · power outage |
| --- | --- | --- |
| `checks.required` | `too_hot, has_power, has_water, can_evacuate, someone_with_them` | `has_power, has_medication, equipment_working, can_evacuate, someone_with_them` |
| extra top-level required | — | `equipment_hours_remaining` |

`can_evacuate` and `someone_with_them` appear in both because Rosa uses a cane and has no car, and both of them live alone.

## The schema

Always required at the top level: `reached_intended_person`, `is_safe_now`, `needs_help_now`, `checks`, `help_offers_stated`, `help_accepted`, `help_declined`, `concerns`, `alarming_quote`, `call_back_requested`.

Below is one compiled instance — **Walter under the power outage**. The `checks.required` list, the top-level `equipment_hours_remaining`, and the identifiers named in `help_accepted`'s description all come from that hazard and that person; under the heat warning the same compiler produces `too_hot, has_power, has_water` and the heat hazard's offer keys.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["reached_intended_person", "is_safe_now", "needs_help_now", "checks",
               "help_offers_stated", "help_accepted", "help_declined", "concerns",
               "alarming_quote", "call_back_requested", "equipment_hours_remaining"],
  "properties": {
    "reached_intended_person": {"type": "string", "enum": ["yes", "no", "unknown"], "description": "Did you actually speak with Walter themselves? \"no\" if you reached voicemail, an answering machine, a carer, a relative, or anyone else. \"unknown\" only if you truly could not tell who was on the line."},
    "is_safe_now":  {"type": "string", "enum": ["yes", "no", "unknown"], "description": "…"},
    "needs_help_now": {"type": "string", "enum": ["yes", "no", "unknown"], "description": "…"},
    "checks": {
      "type": "object", "additionalProperties": false,
      "required": ["has_power", "has_medication", "equipment_working", "can_evacuate", "someone_with_them"],
      "description": "One answer per condition, from what they actually said. Never fill one in from another: having power does not mean the house is cool, and sounding well does not mean they have their medicine.",
      "properties": {
        "too_hot": {…}, "too_cold": {…}, "has_power": {…}, "has_water": {…}, "has_food": {…},
        "has_medication": {…}, "equipment_working": {…}, "can_evacuate": {…}, "someone_with_them": {…}
      }
    },
    "equipment_hours_remaining": {"type": "string", "description": "…their answer in their own words (\"about four hours\", \"the battery's nearly gone\"). Empty string if they use none, or it never came up."},
    "help_offers_stated": {"type": "string", "enum": ["yes", "no", "unknown"], "description": "Did you actually say the help options out loud on this call? … Never \"yes\" for something you only intended to say."},
    "help_accepted": {"type": "array", "items": {"type": "string"}, "description": "…as these exact identifiers, one per item: resource_center, ride, ice_drop, wellness_visit. Include an option ONLY if you actually offered it and they actually said yes…"},
    "help_declined": {"type": "array", "items": {"type": "string"}, "description": "…An option you never said out loud is never listed here."},
    "concerns": {"type": "array", "items": {"type": "string"}, "description": "…as close to their own words as you can (\"my cooler quit yesterday\", \"I haven't been able to get up today\")…"},
    "alarming_quote": {"type": "string", "description": "The single most alarming thing they said, word for word in their own voice — the sentence a neighbour or a paramedic would need to hear. Never paraphrase, never write your own words here."},
    "sounded_distressed": {"type": "string", "enum": ["yes", "no", "unknown"], "description": "Did they sound frightened, confused, or unwell — crying, breathless, slurred, disoriented…? Judge from HOW they spoke, not from what has happened to them."},
    "call_back_requested": {…}, "call_back_time": {…}, "notes": {…}
  }
}
```

## Descriptions are extraction guidance, not documentation

CALL-E's field descriptions reach its extraction model. They are the only place the product's judgment about **meaning over phrasing** can be stated, and they are written accordingly:

> **`is_safe_now`** — Taking everything they said together, are they safe where they are right now? Judge by MEANING, not by their reassurance: *"I'm fine"* from someone who then says they have not been able to get out of their chair, or that the house is boiling and the cooler is dead, is **NOT** safe — answer `"no"`. Answer `"yes"` only if nothing they said gives a neighbour reason to worry tonight. `"unknown"` if you never established enough to say, **including when nobody answered.**

> **`too_hot`** — Is it dangerously hot inside their home **for them**? Judge by what they describe, not by the word "hot": *"the cooler quit yesterday"*, *"it's close in here"*, *"I've been sweating all day"* are all `"yes"`.

> **`needs_help_now`** — `"yes"` even if they turned down the help you offered, and `"yes"` even if they were cheerful about it.

Two polarity notes that would invert the product if got wrong: for `too_hot`/`too_cold` the alarming answer is `"yes"`; for `has_power`/`has_water`/`has_food`/`has_medication`/`equipment_working`/`can_evacuate` it is `"no"`. And `someone_with_them: "no"` is **context, not a need** — living alone is most of this roster's normal Tuesday, and a well person on their own must still be able to come out of a sweep `SAFE`.

`equipment_working` has one more subtlety: the guidance says `"unknown"` is the answer for someone who uses no powered medical equipment, which is what makes a `"no"` there unambiguous life support that has stopped — and that is why `decide()` treats it as `URGENT` on its own at any band.

## The CALL-E `result_schema` subset

Confirmed against the live API, enforced at compile time by `assert_calle_schema_subset()`:

- keywords: `type`, `properties`, `required`, `enum`, `items`, `description`, `additionalProperties` — nothing else. No `$ref`, no `oneOf`/`anyOf`/`allOf`, no `format`, no `patternProperties`.
- **no nullable type arrays.** `{"type": ["string","null"]}` is rejected with `result_schema_invalid`. Optional strings are plain `{"type": "string"}` and `""` means "not stated".
- objects nest at most **one** level deep, and every object sets `additionalProperties: false`.
- arrays of plain strings only — not even a `description` or an `enum` may ride inside `items`; the enumerated help keys live in the array's own description instead.
- every string enum carries an `"unknown"` value.
- every name in `required` must be a real property.

Whether the server accepts a schema can only be confirmed by a live call, so this assertion plus a test that walks the compiled schema is the offline stand-in for server acceptance. Keep it, and keep it passing.

## Validation, and what invalid means

`CallContract.validate_result()` checks the returned object locally with `jsonschema` against the exact schema that was sent — CALL-E exposes no server-side validation field. A `null` `structured_result` means CALL-E could not produce a schema-valid object, which the runner records as `INVALID_RESULT`.

**An invalid result is not a rejection of the person.** It goes to `decide()` like any other leg and comes back `UNREACHABLE`, because a call we cannot read is a person we have not accounted for.

## The second contract: calling the emergency contact

`sweep.contact_contract()` builds the call to the person a neighbour nominated, reusing the neighbour's schema verbatim — it already clears the subset check, and the useful answers from a daughter are the same fields. Only the task changes, and three constraints in it are not stylistic:

- **Say what we know and no more.** *"She hasn't answered twice this evening"* is a fact; *"we think something has happened"* is a guess that sends a frightened person driving.
- **Never imply anyone has been dispatched.** *"Do not say or imply that an ambulance, the fire service, the police, or any other emergency service has been called or is on its way: none has been, and nobody has been sent."* The failure mode is a family standing down because they believe help is coming.
- **Do not recite the medical file.** *"You are asking someone to knock on a door, not briefing a clinician."*

`hard_fields` is emptied on this contract: it means "the hazard makes this fact non-negotiable for this person", and this call is not a check on the contact's own welfare. The runner does not route a contact call through `decide()` at all.

## Reconcile: the understanding step

`backend/app/orchestrator/reconcile.py` (+ `reconcile_glm.py`, `reconcile_anthropic.py`). The happy path never touches an LLM. When fields come back invalid or `unknown`, the reconciler is given the transcript, the help the caller could offer, and **the failing fields only**.

In a hiring cascade an unresolved field means "move on to the next candidate". On a welfare call it means the block captain does not know whether a 78-year-old with no air conditioning is sitting in a hot house. So this step exists to squeeze a real answer out of a transcript CALL-E's extractor gave up on — and where it cannot, `unknown` is passed on as a **finding to escalate**, never as a gap to skip.

Two limits are enforced in code rather than trusted to the model:

- **It may resolve, never overturn.** `merge_reconciled` refuses to replace a definite provider answer with a different definite answer. CALL-E heard the audio; the reconciler is reading a text transcript of it.
- **Quotes must be grounded.** A quote it returns must be traceable (fuzzily — transcripts are punctuated by a machine and people repeat themselves) to something a human turn actually contains. `alarming_quote` is copied verbatim into a handoff packet and may be read out to a responder, so an invented sentence would be words put into a frightened person's mouth.

With no reconciler configured, `reconcile.skipped` is emitted and the unknowns stand.
