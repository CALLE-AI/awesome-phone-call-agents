# The welfare call contract

Two inputs — the hazard, and a thin view of the person — produce the **task** (what the agent says) and the **result schema** (the typed object the call must come home with).

## Three rules the compiler enforces

### Every required field must be answerable when nobody picked up

Tri-states carry `"unknown"`, arrays may be empty, quotes may be `""`. A schema that only a completed conversation could satisfy would make the most important outcome in this product look like a validation error. Pin it with a test that feeds the schema a "nobody answered" object and expects it to validate.

### The task says, in words, that the agent cannot summon anyone

Not a system-prompt aspiration — a sentence in the task, because the model has to follow it live:

> You cannot summon anyone and you must not suggest you can. If it is an emergency, tell them to hang up and dial 911 themselves if they are able, stay with them until they do, and say you will tell [the coordinator] right away. Do not offer to make that call for them.

And for the help you *can* give:

> Never invent help, never say when it will arrive, and never give a place or a time that is not in those words.

### The dossier stays home

The task text gets persisted on the call row and published on event streams, and generic redaction masks phone numbers and credentials — not health prose. So parameterise the task from **derived** facts only: power-dependent, mobility, lives alone, what they cool with, whether they have a car. Never interpolate a condition, a medication, or an address. First name only. Make the view object thin enough that there is no construction path that could smuggle them in.

## What the hazard makes required

```text
hazard kind      -> heat          : too_hot, has_power, has_water
                    cold          : too_cold, has_power
                    power_outage  : has_power, equipment_working, has_medication
                    flood         : can_evacuate, has_water
                    smoke         : can_evacuate, has_medication
                    storm         : has_power, can_evacuate
                    boil_water    : has_water
                    (unrecognised): has_power, has_water
the person       -> power-dependent            : equipment_working, and how many hours are left
                    not independent / no car   : can_evacuate
                    lives alone                : someone_with_them
```

**`required` means "the call may not come home without this fact". It does not mean "this must be yes."** `has_power: "no"` during a blackout is not a failed requirement; it is the finding the whole escalation ladder exists for. Getting this distinction wrong turns a welfare call into a compliance check and starts rejecting people.

For a power-dependent person, make the *hours* required too. "The concentrator is on" is not the answer that matters during an outage; "and it has about four hours" is — that number is the escalation input, so the key may not be silently absent, though `""` is a legal answer.

## The shape

Required at the top level, every hazard:

`reached_intended_person`, `is_safe_now`, `needs_help_now`, `checks`, `help_offers_stated`, `help_accepted`, `help_declined`, `concerns`, `alarming_quote`, `call_back_requested`.

The schema below is one compiled instance — **a power-dependent person under a power outage**. `checks.required` and the top-level `equipment_hours_remaining` come from that combination, and the identifiers listed inside `help_accepted`'s description are that hazard's `help_offered` keys, not a fixed vocabulary. A heat warning for the same person would require `too_hot, has_power, has_water` and enumerate `cooling_center, ride, water_ice_drop` instead.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["reached_intended_person", "is_safe_now", "needs_help_now", "checks",
               "help_offers_stated", "help_accepted", "help_declined", "concerns",
               "alarming_quote", "call_back_requested", "equipment_hours_remaining"],
  "properties": {
    "reached_intended_person": {"type": "string", "enum": ["yes", "no", "unknown"],
      "description": "Did you actually speak with Walter themselves? \"no\" if you reached voicemail, an answering machine, a carer, a relative, or anyone else. \"unknown\" only if you truly could not tell who was on the line."},

    "is_safe_now": {"type": "string", "enum": ["yes", "no", "unknown"],
      "description": "Taking everything they said together, are they safe where they are right now? Judge by MEANING, not by their reassurance: \"I'm fine\" from someone who then says they have not been able to get out of their chair, or that the house is boiling and the cooler is dead, is NOT safe - answer \"no\". Answer \"yes\" only if nothing they said gives a neighbour reason to worry tonight. \"unknown\" if you never established enough to say, including when nobody answered."},

    "needs_help_now": {"type": "string", "enum": ["yes", "no", "unknown"],
      "description": "Is there something they need today that they cannot get for themselves - water, a cool place, a ride, medicine, someone to look in on them? \"yes\" even if they turned down the help you offered, and \"yes\" even if they were cheerful about it. \"no\" only if they are genuinely set for the day."},

    "checks": {
      "type": "object",
      "additionalProperties": false,
      "required": ["has_power", "has_medication", "equipment_working", "can_evacuate", "someone_with_them"],
      "description": "One answer per condition, from what they actually said. Never fill one in from another: having power does not mean the house is cool, and sounding well does not mean they have their medicine.",
      "properties": {
        "too_hot": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Is it dangerously hot inside their home FOR THEM? Judge by what they describe, not by the word \"hot\": \"the cooler quit yesterday\", \"it's close in here\", \"I've been sweating all day\" are all \"yes\". \"no\" only if they said the house is comfortable or cool. \"unknown\" if it never came up."},
        "too_cold": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Is it dangerously cold inside their home for them - no heat, wearing coats indoors, cannot get warm? \"no\" only if they said the house is warm enough. \"unknown\" if it never came up."},
        "has_power": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Do they have electricity in the home right now? \"no\" if the lights are out, the power is off, or they are running on a generator or candles. \"unknown\" if it never came up."},
        "has_water": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Do they have water they can safely drink right now - running water, or enough bottled water for today? \"no\" if the taps are dry, the water is unsafe to drink, or they have nothing left. \"unknown\" if it never came up."},
        "has_food": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Do they have food in the home they can eat today without going out? \"no\" if they are out of food, cannot cook it, or cannot get to a shop. \"unknown\" if it never came up."},
        "has_medication": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Do they have the medicine they need, on hand and usable? \"no\" if they have run out, cannot get to the pharmacy, or medicine that must stay cold has been warm. \"unknown\" if it never came up. Do not guess from the fact that they sound well."},
        "equipment_working": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Is the powered medical equipment they depend on running right now? \"yes\" if it is running, even on battery - put how long the battery will last in equipment_hours_remaining and the worry in concerns. \"no\" if it has stopped, will not start, or the battery has run out. \"unknown\" if they do not use any, or it never came up."},
        "can_evacuate": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Could they leave the home under their own power today if they had to - get up, walk out, get into a car? Judge by meaning: someone who says \"I'm fine\" and then that they have not been able to get out of their chair is \"no\". \"no\" also if they have no way to travel and nobody to take them. \"unknown\" if it never came up."},
        "someone_with_them": {"type": "string", "enum": ["yes", "no", "unknown"],
          "description": "Is another person with them in the home right now, or coming to them today? A pet is not a person, and a neighbour they have not spoken to is not a person coming. \"no\" if they are on their own. \"unknown\" if it never came up."}
      }
    },

    "equipment_hours_remaining": {"type": "string",
      "description": "If they depend on powered medical equipment and said how long it will keep going without wall power, their answer in their own words (\"about four hours\", \"the battery's nearly gone\"). Empty string if they use none, or it never came up."},

    "help_offers_stated": {"type": "string", "enum": ["yes", "no", "unknown"],
      "description": "Did you actually say the help options out loud on this call? \"no\" if the call ended before you got to them or there was nothing to offer. Never \"yes\" for something you only intended to say."},
    "help_accepted": {"type": "array", "items": {"type": "string"},
      "description": "The help options they agreed to, as these exact identifiers, one per item: resource_center, ride, ice_drop, wellness_visit. Include an option ONLY if you actually offered it and they actually said yes - any clear assent counts (\"yes please\", \"that would help\", \"send them round\"). Empty array if they accepted nothing."},
    "help_declined": {"type": "array", "items": {"type": "string"},
      "description": "The help options you offered and they turned down, as the same identifiers. An option you never said out loud is never listed here. Empty array if none."},

    "concerns": {"type": "array", "items": {"type": "string"},
      "description": "Everything a neighbour would want to know about, one item each, as close to their own words as you can (\"my cooler quit yesterday\", \"I haven't been able to get up today\", \"I ran out of my pills Friday\"). Include worries they mentioned in passing. Empty array if nothing."},
    "alarming_quote": {"type": "string",
      "description": "The single most alarming thing they said, word for word in their own voice - the sentence a neighbour or a paramedic would need to hear. Never paraphrase, never write your own words here. Empty string if nothing they said was alarming."},
    "sounded_distressed": {"type": "string", "enum": ["yes", "no", "unknown"],
      "description": "Did they sound frightened, confused, or unwell - crying, breathless, slurred, disoriented about the day or where they are, unable to follow the conversation? Judge from HOW they spoke, not from what has happened to them. \"unknown\" if you could not tell."},

    "call_back_requested": {"type": "string", "enum": ["yes", "no", "unknown"],
      "description": "Did they ask to be called or looked in on again, or say now is a bad time? This is not a refusal: \"yes\" even if they sounded perfectly well."},
    "call_back_time": {"type": "string",
      "description": "If they asked to be called back, when they said would suit, in their own words (\"after supper\", \"tomorrow morning\"). Empty string otherwise."},
    "notes": {"type": "string", "description": "Anything else a neighbour should know. Empty string if nothing."}
  }
}
```

## Polarity, and one field that is not a need

Getting these backwards inverts the product.

- **Alarming answer is `"yes"`**: `too_hot`, `too_cold`, `sounded_distressed`.
- **Alarming answer is `"no"`**: `has_power`, `has_water`, `has_food`, `has_medication`, `equipment_working`, `can_evacuate`.
- **`someone_with_them: "no"` is context, not a need.** Living alone is most of this roster's ordinary Tuesday, and a well person on their own must still be able to come out of a sweep `SAFE`.

`equipment_working` deserves its own note: because the guidance says `"unknown"` is the answer for somebody who uses no powered equipment, a `"no"` there can only have come from someone who uses some. That is what makes it urgent on its own, at any band, with no other corroboration.

## The provider's schema subset

Confirmed against the CALL-E API; assert it at compile time rather than discovering it on a live call:

- keywords: `type`, `properties`, `required`, `enum`, `items`, `description`, `additionalProperties`. No `$ref`, no `oneOf`/`anyOf`/`allOf`, no `format`, no `patternProperties`.
- **no nullable type arrays.** `{"type": ["string", "null"]}` is rejected outright. Optional strings are plain strings and `""` means "not stated".
- objects nest at most **one** level; every object sets `additionalProperties: false`.
- arrays of plain strings only — not even a description or an enum inside `items`. Put the enumerated help keys in the array's own description instead.
- every string enum carries `"unknown"`.
- every name in `required` is a real property.

Validate the returned object **locally**, against the exact schema you sent, because the API exposes no server-side validation result. A null structured result means the provider could not produce a schema-valid object.

**An invalid result is not a rejection of the person.** It is a call you cannot read, which is a kind of silence, and it takes the silence path.

## The second contract: the nominated contact

When the ladder rings the person the neighbour nominated, **reuse the same schema** — it already clears the subset check, and the useful answers from a daughter are the same fields: did we reach her, is her mother safe, does she need something, what did she say. Only the task changes. Three constraints in it are not stylistic:

- **Say what you actually know and no more.** *"She hasn't answered twice this evening"* is a fact. *"We think something has happened"* is a guess that sends a frightened person driving.
- **Never imply anyone has been dispatched.** Nobody has been.
- **Do not recite the medical file.** You are asking someone to knock on a door, not briefing a clinician.

Clear the hazard-required field list on this contract: it means *the hazard makes this fact non-negotiable for this person*, and this call is not a check on the contact's own welfare. Do not route it through the outcome decision at all.
