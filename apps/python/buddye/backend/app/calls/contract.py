"""Compile a hazard and one neighbour into a CALL-E welfare-check contract.

The contract is the heart of BuddyE: what the call says to a frail person, and the typed result it
must come back with. The hazard decides which facts *must* be established for this person — a power
cut makes `checks.has_power` and `checks.equipment_working` required fields in the JSON Schema
CALL-E has to return, a heat warning makes `checks.too_hot` required — so the thing that matters
today is not a suggestion in a prompt the model may skip. Anything the call could not establish
comes back as "unknown", and "unknown" for a power-dependent neighbour during an outage is a
finding the escalation layer acts on.

Four rules are load-bearing and are enforced here rather than left to the caller:

* **The call is paced for an emergency.** The brief gets to the point in two sentences, establishes
  safety first, and is written to be over in well under two minutes when the person is fine — and to
  expand, slow down and stay on the line the moment they are not. The shortness is not a saving: the
  voice engine re-reads the whole brief on every turn (a long one is where the dead air in an earlier
  live call came from) and a sweep is a queue, so a minute spent on somebody who is fine is a
  minute the next neighbour waits. `test_the_task_stays_inside_the_length_budget_on_the_worst_case`
  pins the budget, and what it is really pinning is the latency of every single turn.
* **Silence is a finding.** Every required field is answerable when nobody picked up: the tri-states
  have an "unknown", the arrays may be empty, the quotes may be "". A schema that could only be
  satisfied by a completed conversation would make the most important outcome in the product look
  like a validation error. `tests/test_contract.py` pins this.
* **BuddyE never summons anyone.** The task text tells the agent, in words, that it cannot send
  help; in an emergency the neighbour dials 911 themselves and BuddyE tells the block captain. There
  is no transfer, no dispatch, and no promise that anyone is on their way.
* **The dossier stays home.** `CheckCall.task` is persisted and the task text rides along in event
  payloads, and `app.obs.redact` masks phone numbers and credentials — not health text. So the task
  is parameterised from *derived* facts (power_dependent, mobility, lives_alone) and never
  interpolates conditions, medications, or an address. First name only, and on voicemail not even
  the reason for the call.

Schema shape follows the CALL-E `result_schema` subset confirmed against the live API: plain
draft-07 subset (type, properties, required, enum, one level of nested object, arrays of *plain*
strings, description, additionalProperties:false); no nullable type arrays; every string enum
carries "unknown"; descriptions are written as extraction guidance because they reach CALL-E's
extraction model. `assert_calle_schema_subset` enforces that at compile time.
"""
from __future__ import annotations

import re
from typing import Any

import jsonschema
from pydantic import BaseModel, Field, model_validator

TRI = {"type": "string", "enum": ["yes", "no", "unknown"]}
# CALL-E rejects nullable type arrays (`["string","null"]`) with result_schema_invalid, confirmed
# against the live API. Optional strings are therefore plain strings and "" means "not stated".
OPTIONAL_TEXT = {"type": "string"}
STRING_ARRAY = {"type": "array", "items": {"type": "string"}}

# Keywords CALL-E documents as supported in result_schema. Anything else is refused at compile time.
ALLOWED_SCHEMA_KEYS = frozenset({"type", "properties", "required", "enum", "items", "description", "additionalProperties"})
ALLOWED_TYPES = frozenset({"object", "string", "array", "number", "integer", "boolean"})

LANGUAGE_NAMES = {"en": "English", "es": "Spanish", "fr": "French", "pt": "Portuguese", "zh": "Chinese", "vi": "Vietnamese", "tl": "Tagalog", "ko": "Korean"}

PROGRAMME = "neighbourhood check-in programme"

# A headline is written for a captain's screen ("Excessive Heat Warning — 114F"); a frightened person
# on the phone needs three words. The full headline is stated once, and everything else — including
# the voicemail message, which a stranger may hear — uses the short phrase.
KIND_PHRASE = {
    "heat": "the heat", "cold": "the cold", "power_outage": "the power outage", "flood": "the flooding",
    "smoke": "the smoke", "storm": "the storm", "boil_water": "the water advisory",
}

# The condition checks, in the order a person would actually ask them. Which of these are *required*
# is decided per call by _required_checks: a heat warning and a blackout do not put the same facts at
# stake, and a required field the hazard has nothing to do with only spends the call's attention.
CHECK_FIELDS: dict[str, dict[str, Any]] = {
    "too_hot": {**TRI, "description": (
        "Is it dangerously hot inside their home FOR THEM? Judge by what they describe, not by the word \"hot\": "
        "\"the cooler quit yesterday\", \"it's close in here\", \"I've been sweating all day\" are all \"yes\". "
        "\"no\" only if they said the house is comfortable or cool. \"unknown\" if it never came up.")},
    "too_cold": {**TRI, "description": (
        "Is it dangerously cold inside their home for them — no heat, wearing coats indoors, cannot get warm? "
        "\"no\" only if they said the house is warm enough. \"unknown\" if it never came up.")},
    "has_power": {**TRI, "description": (
        "Do they have electricity in the home right now? \"no\" if the lights are out, the power is off, or they are "
        "running on a generator or candles. \"unknown\" if it never came up.")},
    "has_water": {**TRI, "description": (
        "Do they have water they can safely drink right now — running water, or enough bottled water for today? "
        "\"no\" if the taps are dry, the water is unsafe to drink, or they have nothing left. \"unknown\" if it never came up.")},
    "has_food": {**TRI, "description": (
        "Do they have food in the home they can eat today without going out? \"no\" if they are out of food, cannot "
        "cook it, or cannot get to a shop. \"unknown\" if it never came up.")},
    "has_medication": {**TRI, "description": (
        "Do they have the medicine they need, on hand and usable? \"no\" if they have run out, cannot get to the "
        "pharmacy, or medicine that must stay cold has been warm. \"unknown\" if it never came up. Do not guess from "
        "the fact that they sound well.")},
    "equipment_working": {**TRI, "description": (
        "Is the powered medical equipment they depend on running right now? \"yes\" if it is running, even on battery "
        "— put how long the battery will last in equipment_hours_remaining and the worry in concerns. \"no\" if it has "
        "stopped, will not start, or the battery has run out. \"unknown\" if they do not use any, or it never came up.")},
    "can_evacuate": {**TRI, "description": (
        "Could they leave the home under their own power today if they had to — get up, walk out, get into a car? "
        "Judge by meaning: someone who says \"I'm fine\" and then that they have not been able to get out of their "
        "chair is \"no\". \"no\" also if they have no way to travel and nobody to take them. \"unknown\" if it never came up.")},
    "someone_with_them": {**TRI, "description": (
        "Is another person with them in the home right now, or coming to them today? A pet is not a person, and a "
        "neighbour they have not spoken to is not a person coming. \"no\" if they are on their own. \"unknown\" if it never came up.")},
}

# Which checks each hazard makes non-negotiable. Person-driven additions are layered on top of these.
HAZARD_CHECKS: dict[str, list[str]] = {
    "heat": ["too_hot", "has_power", "has_water"],
    "cold": ["too_cold", "has_power"],
    "power_outage": ["has_power", "equipment_working", "has_medication"],
    "flood": ["can_evacuate", "has_water"],
    "smoke": ["can_evacuate", "has_medication"],
    "storm": ["has_power", "can_evacuate"],
    "boil_water": ["has_water"],
}
DEFAULT_CHECKS = ["has_power", "has_water"]


class HelpOffer(BaseModel):
    """One thing that actually exists today. `text` is spoken verbatim, so it is the only place a
    time, an address, or a promise may come from."""

    key: str    # cooling_center, ride, water_drop, wellness_visit — the identifier CALL-E returns
    label: str  # "Cooling centre"
    text: str   # the exact sentence the agent says


class HazardView(BaseModel):
    kind: str = "heat"
    headline: str = ""
    area: str = ""
    severity: str = "warning"
    help_offered: list[HelpOffer] = Field(default_factory=list)
    captain_name: str = ""     # the human who asked for the sweep; named on every call
    callback_number: str = ""  # only stated if a real number was supplied

    @classmethod
    def from_row(cls, hazard: Any, captain_name: str = "") -> "HazardView":
        """Build the view from a `Hazard` row (duck-typed, so a stub works in tests)."""
        return cls(
            kind=getattr(hazard, "kind", "") or "heat",
            headline=getattr(hazard, "headline", "") or "",
            area=getattr(hazard, "area", "") or "",
            severity=getattr(hazard, "severity", "") or "warning",
            help_offered=parse_help_offers(getattr(hazard, "help_offered", []) or []),
            captain_name=captain_name or getattr(hazard, "declared_by", "") or "",
            callback_number=str((getattr(hazard, "facts", {}) or {}).get("callback_number", "") or ""),
        )


class NeighbourView(BaseModel):
    """Only what the call needs. Deliberately no conditions, no medications, no address: this view is
    interpolated into task text that gets persisted and published on the event stream."""

    name: str
    first_name: str = ""
    preferred_language: str = "en-US"
    lives_alone: bool = False
    power_dependent: bool = False
    power_backup_hours: float = 0.0
    cooling: str = "unknown"
    heating: str = "unknown"
    mobility: str = "independent"
    has_transport: bool = True

    @model_validator(mode="after")
    def _default_first_name(self) -> "NeighbourView":
        # The task text says the person's name out loud and is then persisted on the call row, so
        # there must be no construction path where the surname rides along. Filling it here rather
        # than in compile_contract means a hand-built view is as safe as one off a roster row.
        if not self.first_name:
            self.first_name = (self.name.split() or [""])[0]
        return self

    @classmethod
    def from_row(cls, nbr: Any) -> "NeighbourView":
        name = getattr(nbr, "name", "") or ""
        return cls(
            name=name,
            first_name=(name.split() or [""])[0],
            preferred_language=getattr(nbr, "preferred_language", "") or "en-US",
            lives_alone=bool(getattr(nbr, "lives_alone", False)),
            power_dependent=bool(getattr(nbr, "power_dependent", False)),
            power_backup_hours=float(getattr(nbr, "power_backup_hours", 0.0) or 0.0),
            cooling=getattr(nbr, "cooling", "") or "unknown",
            heating=getattr(nbr, "heating", "") or "unknown",
            mobility=getattr(nbr, "mobility", "") or "independent",
            has_transport=bool(getattr(nbr, "has_transport", True)),
        )


class CallContract(BaseModel):
    task: str
    result_schema: dict[str, Any]
    objectives: list[str]
    # hard = the tri-states this hazard makes non-negotiable ("checks.has_power"). It means "the call
    # may not come home without this fact" — NOT "this must be yes". `is_safe_now == "no"` is not a
    # gap, it is the finding the escalation ladder exists for.
    hard_fields: list[str]
    soft_fields: list[str]   # every other leaf, asked if it fits
    must_return: list[str]   # every leaf the schema marks required, arrays and quotes included
    help_offers: list[HelpOffer] = Field(default_factory=list)
    offer_keys: list[str] = Field(default_factory=list)
    locale: str = "en-US"

    def validate_result(self, result: dict[str, Any] | None) -> list[str]:
        """Return a list of human-readable validation errors (empty = valid)."""
        if result is None:
            return ["provider returned no schema-valid structured_result"]
        validator = jsonschema.Draft7Validator(self.result_schema)
        return [f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}" for e in validator.iter_errors(result)]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_") or "help"


def parse_help_offers(raw: list[Any]) -> list[HelpOffer]:
    """Turn `Hazard.help_offered` rows into the sentences the agent may say.

    Tolerant on purpose: a captain declaring a hazard writes down a cooling centre and its address,
    not a script. Where no sentence was written we compose one from the parts, because the agent is
    forbidden to invent wording that carries a place or a time.
    """
    out: list[HelpOffer] = []
    for item in raw:
        if isinstance(item, HelpOffer):
            out.append(item)
            continue
        if isinstance(item, str):
            out.append(HelpOffer(key=_slug(item), label=item, text=item))
            continue
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or item.get("title") or item.get("name") or item.get("kind") or item.get("key") or "").strip()
        key = _slug(str(item.get("key") or item.get("id") or item.get("kind") or label))
        text = str(item.get("text") or item.get("say") or item.get("script") or "").strip()
        if not text:
            where = str(item.get("address") or item.get("location") or "").strip()
            when = str(item.get("hours") or item.get("window") or item.get("when") or "").strip()
            detail = str(item.get("detail") or item.get("details") or item.get("notes") or "").strip()
            if where or when or not detail:
                text = label or key.replace("_", " ")
                if where:
                    text += f" at {where}"
                if when:
                    text += f", {when}"
                if detail:
                    text += f". {detail.rstrip('.')}"
            else:
                text = detail  # a written-out offer already says its own name; do not stutter it
            text = text.rstrip(".") + "."
        if not label:
            label = key.replace("_", " ").capitalize()
        out.append(HelpOffer(key=key, label=label, text=text))
    return out


def _language_name(tag: str) -> str:
    return LANGUAGE_NAMES.get(tag.split("-")[0].lower(), tag)


def _required_checks(hazard: HazardView, neighbour: NeighbourView) -> list[str]:
    """The condition checks this call may not come home without.

    Hazard first, then the facts about the person that change what the hazard means for them: life
    support on wall power, no way of getting out, nobody in the house.
    """
    keys = list(HAZARD_CHECKS.get(hazard.kind, DEFAULT_CHECKS))
    if neighbour.power_dependent and "equipment_working" not in keys:
        keys.append("equipment_working")
    if (neighbour.mobility != "independent" or not neighbour.has_transport) and "can_evacuate" not in keys:
        keys.append("can_evacuate")
    if neighbour.lives_alone and "someone_with_them" not in keys:
        keys.append("someone_with_them")
    return [k for k in CHECK_FIELDS if k in keys]  # stable, asking order


def assert_calle_schema_subset(schema: dict[str, Any], path: str = "$", depth: int = 0) -> None:
    """Refuse any schema feature the CALL-E API does not document for result_schema.
    No $ref, no oneOf/anyOf/allOf, no format, no patternProperties, nesting at most one object deep,
    arrays of strings only, and additionalProperties:false on every object."""
    unknown = set(schema) - ALLOWED_SCHEMA_KEYS
    if unknown:
        raise ValueError(f"{path}: unsupported schema keyword(s) {sorted(unknown)}")
    typ = schema.get("type")
    # Confirmed against the live API: a type ARRAY (the usual JSON-Schema way to say "nullable")
    # is rejected with result_schema_invalid. Single types only; use "" for "not stated".
    if isinstance(typ, list):
        raise ValueError(f"{path}: nullable type arrays are not supported by CALL-E, got {typ!r}")
    if typ not in ALLOWED_TYPES:
        raise ValueError(f"{path}: unsupported type {typ!r}")
    types = {typ}
    if "object" in types:
        if depth > 1:
            raise ValueError(f"{path}: objects may nest at most one level deep")
        if schema.get("additionalProperties") is not False:
            raise ValueError(f"{path}: objects must set additionalProperties: false")
        props = schema.get("properties", {})
        for r in schema.get("required", []):
            if r not in props:
                raise ValueError(f"{path}: required field {r!r} is not a property")
        for name, sub in props.items():
            assert_calle_schema_subset(sub, f"{path}.{name}", depth + 1)
    if "array" in types:
        items = schema.get("items")
        # Not even a description or an enum may ride inside `items`: the enumerated help keys live in
        # the array field's own description instead.
        if items != {"type": "string"}:
            raise ValueError(f"{path}: arrays must be simple arrays of strings")
    if "enum" in schema and "unknown" not in schema["enum"]:
        raise ValueError(f"{path}: string enums must include an 'unknown' value")


def _base_fields(neighbour: NeighbourView, offer_keys: list[str]) -> dict[str, dict[str, Any]]:
    first = neighbour.first_name or neighbour.name
    keys_line = ", ".join(offer_keys) if offer_keys else "(no help options were available on this call)"
    return {
        "reached_intended_person": {**TRI, "description": (
            f"Did you actually speak with {first} themselves? \"no\" if you reached voicemail, an answering machine, a "
            f"carer, a relative, or anyone else. \"unknown\" only if you truly could not tell who was on the line.")},
        "is_safe_now": {**TRI, "description": (
            "Taking everything they said together, are they safe where they are right now? Judge by MEANING, not by "
            "their reassurance: \"I'm fine\" from someone who then says they have not been able to get out of their "
            "chair, or that the house is boiling and the cooler is dead, is NOT safe — answer \"no\". Answer \"yes\" "
            "only if nothing they said gives a neighbour reason to worry tonight. \"unknown\" if you never established "
            "enough to say, including when nobody answered.")},
        "needs_help_now": {**TRI, "description": (
            "Is there something they need today that they cannot get for themselves — water, a cool place, a ride, "
            "medicine, someone to look in on them? \"yes\" even if they turned down the help you offered, and \"yes\" "
            "even if they were cheerful about it. \"no\" only if they are genuinely set for the day.")},
        "checks": {
            "type": "object",
            "additionalProperties": False,
            "description": (
                "One answer per condition, from what they actually said. Never fill one in from another: having power "
                "does not mean the house is cool, and sounding well does not mean they have their medicine."),
            "required": [],  # filled in by compile_contract
            "properties": dict(CHECK_FIELDS),
        },
        "equipment_hours_remaining": {**OPTIONAL_TEXT, "description": (
            "If they depend on powered medical equipment and said how long it will keep going without wall power, "
            "their answer in their own words (\"about four hours\", \"the battery's nearly gone\"). Empty string if "
            "they use none, or it never came up.")},
        "help_offers_stated": {**TRI, "description": (
            "Did you actually say the help options out loud on this call? \"no\" if the call ended before you got to "
            "them or there was nothing to offer. Never \"yes\" for something you only intended to say.")},
        "help_accepted": {**STRING_ARRAY, "description": (
            f"The help options they agreed to, as these exact identifiers, one per item: {keys_line}. Include an option "
            f"ONLY if you actually offered it and they actually said yes — any clear assent counts (\"yes please\", "
            f"\"that would help\", \"send them round\"). Empty array if they accepted nothing.")},
        "help_declined": {**STRING_ARRAY, "description": (
            f"The help options you offered and they turned down, as the same identifiers: {keys_line}. An option you "
            f"never said out loud is never listed here. Empty array if none.")},
        "concerns": {**STRING_ARRAY, "description": (
            "Everything a neighbour would want to know about, one item each, as close to their own words as you can "
            "(\"my cooler quit yesterday\", \"I haven't been able to get up today\", \"I ran out of my pills Friday\"). "
            "Include worries they mentioned in passing. Empty array if nothing.")},
        "alarming_quote": {**OPTIONAL_TEXT, "description": (
            "The single most alarming thing they said, word for word in their own voice — the sentence a neighbour or "
            "a paramedic would need to hear. Never paraphrase, never write your own words here. Empty string if "
            "nothing they said was alarming.")},
        "sounded_distressed": {**TRI, "description": (
            "Did they sound frightened, confused, or unwell — crying, breathless, slurred, disoriented about the day or "
            "where they are, unable to follow the conversation? Judge from HOW they spoke, not from what has happened "
            "to them. \"unknown\" if you could not tell.")},
        "call_back_requested": {**TRI, "description": (
            "Did they ask to be called or looked in on again, or say now is a bad time? This is not a refusal: \"yes\" "
            "even if they sounded perfectly well.")},
        "call_back_time": {**OPTIONAL_TEXT, "description": (
            "If they asked to be called back, when they said would suit, in their own words (\"after supper\", "
            "\"tomorrow morning\"). Empty string otherwise.")},
        "notes": {**OPTIONAL_TEXT, "description": "Anything else a neighbour should know. Empty string if nothing."},
    }


BASE_REQUIRED = [
    "reached_intended_person", "is_safe_now", "needs_help_now", "checks",
    "help_offers_stated", "help_accepted", "help_declined", "concerns", "alarming_quote", "call_back_requested",
]


def compile_contract(hazard: HazardView, neighbour: NeighbourView) -> CallContract:
    first = neighbour.first_name or neighbour.name
    captain = hazard.captain_name or "your block captain"
    headline = hazard.headline or hazard.kind.replace("_", " ")
    short = KIND_PHRASE.get(hazard.kind, hazard.kind.replace("_", " ") or "the weather")
    area = hazard.area or "the neighbourhood"
    offers = list(hazard.help_offered)
    offer_keys = [o.key for o in offers]

    fields = _base_fields(neighbour, offer_keys)
    required_checks = _required_checks(hazard, neighbour)
    fields["checks"] = {**fields["checks"], "required": required_checks}

    required = list(BASE_REQUIRED)
    if neighbour.power_dependent:
        # "The concentrator is on" is not the answer that matters during an outage; "and it has about
        # four hours" is. For this person the number is the escalation input, so the key must come
        # back — "" is still a legal answer, it just may not be silently absent.
        required.append("equipment_hours_remaining")

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": fields,
    }
    assert_calle_schema_subset(schema)

    # hard is deliberately narrower than required: only the tri-states where "neither yes nor no" is
    # a hole in what we know about this person tonight. The required arrays and quotes are things the
    # call must RETURN (empty is a fine answer), which is a different statement, so they live in
    # must_return and nothing should gate on them being "yes".
    leaves = iter_schema_fields(schema)
    hard_fields = [p for p, spec, req in leaves if req and spec.get("enum")]
    soft_fields = [p for p, _, _ in leaves if p not in set(hard_fields)]
    must_return = [p for p, _, req in leaves if req]

    # The equipment question is asked in general terms on purpose: this text is stored on the call
    # row and published on the event stream, and naming a person's device would put a diagnosis
    # there. They know what their own equipment is.
    if neighbour.power_dependent:
        equipment_clause = ("is the equipment they rely on that needs electricity still running, and how many hours it "
                            "would last without wall power")
    else:
        equipment_clause = "has anything they rely on that needs electricity stopped working"

    if offers:
        offer_lines = "\n".join(f"  - {o.label}: {o.text}" for o in offers)
        help_block = (
            f"The help you can offer. These exist; nothing else does. Offer them one at a time, in these exact words, "
            f"where they fit:\n{offer_lines}\n"
            f"Never invent help, never say when it will arrive, never give a place or a time that is not in those "
            f"words, and never give medical advice."
        )
    else:
        help_block = (
            f"You have nothing concrete to offer today. Do not invent anything, and never give medical advice. If they "
            f"need something, say you will tell {captain} tonight."
        )

    lang = neighbour.preferred_language or "en-US"
    language_line = "" if lang.lower().startswith("en") else f" Speak the whole call in {_language_name(lang)}."
    callback_line = (f" If they ask how to reach a person, the number is {hazard.callback_number}."
                     if hazard.callback_number else "")

    # This brief is written for HASTE, and its shortness is a safety property rather than a saving.
    # Two reasons: the voice engine re-reads the whole brief on every turn, which is where the dead
    # air and the fragmented speech in an earlier live call came from; and a sweep is a queue, so
    # every minute spent on a neighbour who is fine is a minute the next one waits. The expansion —
    # confused, frightened, crying, hard of hearing, something wrong — is stated in the same breath
    # as the default so the model reads "be quick" and "unless" as one instruction, not as a rule
    # with an exception it may forget. Nothing that establishes safety, states the programme's
    # identity, or bounds what may be promised has been shortened to get here; what went was the
    # duplication between the opening paragraph and the opening script, and between the task text
    # and the field descriptions that carry the same guidance to the extraction model.
    task = (
        f"You are an automated check-in call from the {area} {PROGRAMME}. You are not a person and you never pretend "
        f"to be one.{language_line} {captain} asked you to phone everyone on the block because of {headline}. "
        f"{first} may be elderly, unwell, asleep, or frightened that a machine is calling.\n\n"
        f"This is a routine neighbourhood check-in, not an emergency service. Say who you are and why in one "
        f"breath — {short}, never the headline — then get to whether {first} is alright. If they are fine, let "
        f"them go: under two minutes. If they are "
        f"confused, frightened, crying, hard of hearing, or something is wrong, slow right down, be kind, keep them "
        f"talking, and take as long as it takes. Nobody in trouble is hurried off this phone. If they ask whether you "
        f"are a real person, say plainly that you are an automated voice and that {captain}, a real neighbour, reads "
        f"what you find out.{callback_line}\n\n"
        f"How to speak. This matters as much as what you say:\n"
        f"- Warm, calm, unhurried, brief. A neighbour, not a form being filled in.\n"
        f"- Short sentences. One idea per turn. Say a thing, then let them answer.\n"
        f"- The moment they start talking, stop and listen. Never talk over them.\n"
        f"- Do not narrate what you are about to do. Just say it. Only ask whether they are still there after a "
        f"long silence.\n"
        f"- If they ask you to repeat or slow down, just do it. A request to repeat is never an answer — ask again.\n\n"
        f"What you need, never read aloud: are they safe right now, and is anything wrong at this moment; is it too "
        f"hot or too cold in the house for them; electricity, water they can drink, food for today, their medicine; "
        f"{equipment_clause}; could they get out of the house if they had to, and is anyone there with them. Ask what "
        f"fits, follow them, and stop once you have enough. \"I'm fine\" is not the end of it: ask one gentle "
        f"follow-up, older people play things down.\n\n"
        f"{help_block}\n\n"
        f"Rules:\n"
        f"- This call cannot arrange anything and must never suggest it can: you are checking in, not responding. "
        f"If someone needs medical help, say you are an automated call and cannot get it for them, that they should "
        f"dial 911 themselves, and that you will tell {captain} right away. Do not offer to make that call for them.\n"
        f"- Once they are accounted for, ask whether they would like someone to check on them again, thank them, end.\n"
        f"- Voicemail, or anyone who is not {first}: say only that the {PROGRAMME} called about {short} and will try "
        f"again. Do not say why they are on the list, and never mention health, medicine, or equipment — you do not "
        f"know who is listening. Then end.\n\n"
        f"Recording it: judge by meaning, not by their words. Anything you did not ask, or they did not answer, is "
        f"\"unknown\" — never \"yes\", never \"no\". Help you never said out loud was never offered. A field you "
        f"have no value for is an empty string, never the word null.\n"
    )

    objectives = [
        f"Establish whether {first} is safe right now, in the first minute",
        "Establish whether the home is too hot or too cold for them",
        "Establish power, drinkable water, food, and medication",
        "Establish whether powered medical equipment is working, and for how long",
        "Establish whether they can get out, and whether anyone is with them",
        "Offer only the help that exists and record what they accepted",
        "Record anything alarming in their own words",
        f"End the call quickly once {first} is accounted for, and never while they are in trouble",
    ]

    return CallContract(
        task=task,
        result_schema=schema,
        objectives=objectives,
        hard_fields=hard_fields,
        soft_fields=soft_fields,
        must_return=must_return,
        help_offers=offers,
        offer_keys=offer_keys,
        locale=lang,
    )


# ------------------------------------------------------------------ result helpers
def get_path(result: dict[str, Any] | None, path: str, default: Any = None) -> Any:
    """Read a dotted path ("checks.has_power") out of a nested result."""
    cur: Any = result
    for part in path.split("."):
        if not isinstance(cur, dict):
            return default
        cur = cur.get(part, default)
    return default if cur is None else cur


def set_path(result: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cur = result
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value


def iter_schema_fields(schema: dict[str, Any], prefix: str = "") -> list[tuple[str, dict[str, Any], bool]]:
    """Every leaf field of the schema as (dotted_path, spec, required), nested objects walked one level."""
    out: list[tuple[str, dict[str, Any], bool]] = []
    required = set(schema.get("required", []))
    for key, spec in schema.get("properties", {}).items():
        path = f"{prefix}{key}"
        if spec.get("type") == "object" and "properties" in spec:
            out.extend(iter_schema_fields(spec, f"{path}."))
        else:
            out.append((path, spec, key in required))
    return out
