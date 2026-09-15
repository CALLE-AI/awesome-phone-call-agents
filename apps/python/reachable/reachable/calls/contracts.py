"""Task-text templates and result schemas, from docs/CALL_CONTRACTS.md.

Task texts are assembled from fixed blocks. A model fills nothing but the
placeholder values listed per contract; it never authors policy.

Two properties are enforced here rather than asked for in a prompt:

* **No dedicated replacement-number field.** ``best_number_for_school`` is an
  enum and no contact update is automatic. Free-text evidence can still contain
  unsolicited numbers; presentation masking is separate from private storage.
* **Forbidden content cannot reach a rendered task.** Fines, penalties, legal
  action and medical advice are refused at render time.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from ..models import Workflow

# --------------------------------------------------------------------------
# Fixed blocks, verbatim from docs/CALL_CONTRACTS.md §1.7
# --------------------------------------------------------------------------

DISCLOSURE_BLOCK = """You are an automated assistant calling on behalf of {school_name}.
Say so in your first sentence.
If you are asked whether you are a person, say plainly that you are not.
If the person asks not to be called again, say you will record that, stop, and
do not ask anything further."""

IDENTITY_GATE_BLOCK = """Before you say anything about any child, you must confirm you are speaking to
{contact_name}. Ask "Am I speaking to {contact_name}?" and wait for an answer.
If they say no, or you are not sure, do not mention any child, any name, or any
reason for the call. Say only that you will call back, thank them, and end.
If you reach a voicemail or answering machine, say only: "This is an automated
message from {school_name}. Please call the school office when you can." Say
nothing else. Do not name any child."""

BOUNDARY_BLOCK = """You are gathering information only. You cannot agree to anything, confirm
anything as final, or commit {school_name} to any action.
Never ask for, accept, or repeat back a new phone number. If they want to change
their contact details, say the office will be in touch through the usual
channel, and record that.
Never mention fines, penalty notices, prosecution, court, or any legal action.
Never give medical advice. If the call touches a medical emergency, tell the
person to contact the emergency services and end the call.
Do not say or imply that the child is safe, present, or accounted for.
Use only the child's first name. Never use a surname, year group, or class."""

CONTACT_CHECK_BODY = """Once, and only once, you have confirmed you are speaking to {contact_name}:

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
this pupil, stop discussing the pupil, thank them, and end the call."""

PATTERN_BODY = """Once, and only once, you have confirmed you are speaking to {contact_name}:

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
is authorised or unauthorised."""

PLACEHOLDERS: dict[Workflow, frozenset[str]] = {
    Workflow.CONTACT_CHECK: frozenset({"school_name", "contact_name", "pupil_first_name"}),
    Workflow.PATTERN_FOLLOWUP: frozenset(
        {"school_name", "contact_name", "pupil_first_name", "attendance_officer_name"}
    ),
}

#: Forbidden content, as anchored patterns applied to **placeholder values**.
#:
#: Deliberately not a substring scan of the assembled task. The fixed blocks are
#: ours, reviewed, and legitimately contain these words in order to prohibit
#: them -- the pattern body instructs "do not reassure them that everything is
#: fine", and a substring check flags that prohibition as a violation. The real
#: injection surface is the placeholder values, which come from CSV files a
#: school edits, so that is what is checked.
#:
#: Stems where a stem is right ("prosecuting" is the same threat as
#: "prosecute"), word boundaries where a stem would over-match.
FORBIDDEN_VALUE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("fine", r"\bfine[sd]?\b"),
    ("penalty", r"\bpenalt"),
    ("prosecution", r"\bprosecut"),
    ("legal action", r"\blegal action\b"),
    ("court", r"\bcourt\b"),
    ("medical advice", r"\b(diagnos|medication|prescrib)"),
    ("attendance code", r"\bunauthorised\b|\bcode [A-Z]\b"),
)

#: Topics the boundary block must continue to prohibit. Asserted by a test so a
#: future edit cannot quietly drop one.
BOUNDARY_TOPICS = ("fine", "penalty", "prosecution", "court", "legal action", "medical")

_PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")


class ContractError(ValueError):
    """A task text that could not be rendered safely. It is never sent."""


# --------------------------------------------------------------------------
# Result schemas. Inside CALL-E's supported subset: type, properties, required,
# enum, nested object, simple array.items, description, additionalProperties
# false. Nothing else is used.
# --------------------------------------------------------------------------

CONTACT_CHECK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "outcome",
        "identity_confirmed",
        "still_willing_to_be_contact",
        "best_number_for_school",
        "language_preference_note",
        "verbatim_identity_quote",
    ],
    "properties": {
        "outcome": {
            "type": "string",
            "enum": ["reached", "voicemail", "no_answer", "not_in_service", "wrong_person"],
            "description": (
                "How the call ended. Use reached only if you spoke with a person. Use voicemail "
                "for an answering machine. Use no_answer if nobody picked up. Use not_in_service "
                "if the number is disconnected or unobtainable. Use wrong_person if a person "
                "answered but is not the named contact."
            ),
        },
        "identity_confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes only if the person clearly confirmed they are the named contact, in "
                "their own words. Use no if they said they are not. Use unknown if you did not "
                "ask, they did not answer clearly, or you are not certain."
            ),
        },
        "still_willing_to_be_contact": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the named contact say they are still willing to be an emergency contact "
                "for this pupil? Use unknown if it was not clearly answered."
            ),
        },
        "best_number_for_school": {
            "type": "string",
            "enum": ["this_number", "wants_to_update", "unknown"],
            "description": (
                "Use this_number if they confirmed this number is the right one. Use "
                "wants_to_update if they said their details should change. Never record a phone "
                "number anywhere in this result."
            ),
        },
        "language_preference_note": {
            "type": "string",
            "description": (
                "If the person indicated they would prefer to speak a language other than "
                "English, or had clear difficulty in English, note that in a few words. Empty "
                "string otherwise."
            ),
        },
        "verbatim_identity_quote": {
            "type": "string",
            "description": (
                "The exact words the person used to confirm or deny being the named contact, "
                "quoted as spoken. Empty string if they never addressed it."
            ),
        },
    },
}

PATTERN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
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
        "verbatim_quotes",
    ],
    "properties": {
        "outcome": {
            "type": "string",
            "enum": ["reached", "voicemail", "no_answer", "not_in_service", "wrong_person"],
            "description": (
                "How the call ended. Use reached only if you spoke with a person. Use voicemail "
                "for an answering machine. Use no_answer if nobody picked up. Use not_in_service "
                "if the number is disconnected. Use wrong_person if a person answered but is not "
                "the named contact."
            ),
        },
        "identity_confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes only if the person clearly confirmed they are the named contact, in "
                "their own words. Use unknown if you did not ask, they did not answer clearly, "
                "or you are not certain."
            ),
        },
        "aware_of_absence": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the contact already know the pupil was not in school? Use no if they were "
                "surprised, said they did not know, or thought the pupil was at school. Use "
                "unknown if this was not clearly established. Only use yes if they clearly "
                "indicated they already knew."
            ),
        },
        "reason_category": {
            "type": "string",
            "enum": [
                "illness",
                "medical_appointment",
                "family_emergency",
                "other",
                "prefers_to_speak_to_staff",
                "unknown",
            ],
            "description": (
                "The category that best matches the reason the contact gave. Use "
                "prefers_to_speak_to_staff if they would rather discuss it with a member of "
                "staff. Use unknown if no reason was given or it was unclear."
            ),
        },
        "reason_note": {
            "type": "string",
            "description": (
                "A short factual note of the reason in the contact's own terms. Do not add "
                "interpretation. Do not record medical detail beyond what is needed to "
                "understand the absence. Empty string if no reason was given."
            ),
        },
        "barrier_mentioned": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the contact mention anything making attendance difficult, such as "
                "transport, money, wellbeing, or something at school? Use unknown if not "
                "established."
            ),
        },
        "barrier_note": {
            "type": "string",
            "description": (
                "A short factual note of the barrier in the contact's own terms. Empty string "
                "if none was mentioned."
            ),
        },
        "wants_call_from_attendance_officer": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the contact say they would like a call from the attendance officer? Use "
                "unknown if not asked or not clearly answered."
            ),
        },
        "knows_child_whereabouts": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the contact indicate they know where the pupil is right now? Use yes only "
                "if they clearly did. Use no if they said they do not know. Use unknown if this "
                "did not come up or was unclear."
            ),
        },
        "verbatim_quotes": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Up to three short quotes of what the contact actually said, quoted as spoken, "
                "covering identity, awareness, and reason. Do not paraphrase."
            ),
        },
    },
}

SCHEMAS: dict[Workflow, dict[str, Any]] = {
    Workflow.CONTACT_CHECK: CONTACT_CHECK_SCHEMA,
    Workflow.PATTERN_FOLLOWUP: PATTERN_SCHEMA,
}

#: CALL-E reserves these recipient-result field names. Neither schema uses one.
RESERVED_RESULT_FIELDS = frozenset({"summary", "status", "transcript", "call_id"})


def result_schema(workflow: Workflow) -> dict[str, Any]:
    return SCHEMAS[Workflow(workflow)]


def _assert_value_is_safe(name: str, value: str, workflow: Workflow) -> None:
    """Refuse a placeholder value carrying forbidden content.

    Placeholder values come from CSV files a school edits, so they are untrusted
    input that is interpolated into text a model will read aloud.
    """
    lowered = value.lower()
    found = sorted(
        {label for label, pattern in FORBIDDEN_VALUE_PATTERNS if re.search(pattern, lowered)}
    )
    if found:
        raise ContractError(
            f"{workflow.value} placeholder {name!r} contains forbidden content: "
            f"{', '.join(found)}"
        )


def render_task(workflow: Workflow, values: Mapping[str, Any]) -> str:
    """Assemble a task text from fixed blocks and an exact placeholder set.

    Raises on an unknown placeholder, a missing one, or a value that smuggles
    forbidden content through a placeholder. All three are refusals, not repairs:
    a case whose task cannot be rendered safely goes to a human.
    """
    workflow = Workflow(workflow)
    expected = PLACEHOLDERS[workflow]
    supplied = {key for key, value in values.items() if value is not None}

    unknown = supplied - expected
    if unknown:
        raise ContractError(
            f"unknown placeholder(s) for {workflow.value}: {', '.join(sorted(unknown))}"
        )
    missing = expected - supplied
    if missing:
        raise ContractError(
            f"missing placeholder(s) for {workflow.value}: {', '.join(sorted(missing))}"
        )

    rendered = {key: str(values[key]) for key in expected}

    # Check the untrusted half before assembling anything.
    for name, value in sorted(rendered.items()):
        _assert_value_is_safe(name, value, workflow)

    body_template = (
        CONTACT_CHECK_BODY if workflow is Workflow.CONTACT_CHECK else PATTERN_BODY
    )
    body = body_template.format(**{k: rendered.get(k, "") for k in _keys(body_template)})
    disclosure = DISCLOSURE_BLOCK.format(school_name=rendered["school_name"])
    identity = IDENTITY_GATE_BLOCK.format(
        school_name=rendered["school_name"], contact_name=rendered["contact_name"]
    )
    boundary = BOUNDARY_BLOCK.format(school_name=rendered["school_name"])

    task = f"{disclosure}\n\n{identity}\n\n{body}\n\n{boundary}"
    leftover = sorted(set(_PLACEHOLDER_RE.findall(task)))
    if leftover:
        raise ContractError(f"unfilled placeholder(s) after render: {', '.join(leftover)}")
    return task


def _keys(template: str) -> set[str]:
    return set(_PLACEHOLDER_RE.findall(template))


def validate_result(workflow: Workflow, result: Any) -> list[str]:
    """Re-validate a structured result locally against the closed schema.

    Field descriptions guide extraction but are not validation, and the provider
    is not the last word on whether a payload is the shape we asked for.
    Returns a list of problems; empty means valid.
    """
    schema = result_schema(workflow)
    problems: list[str] = []
    if not isinstance(result, Mapping):
        return ["structured_result is not an object"]

    for name in schema["required"]:
        if name not in result:
            problems.append(f"missing required field {name}")

    for name, value in result.items():
        spec = schema["properties"].get(name)
        if spec is None:
            problems.append(f"unexpected field {name}")
            continue
        if spec["type"] == "string":
            if not isinstance(value, str):
                problems.append(f"{name} is not a string")
            elif "enum" in spec and value not in spec["enum"]:
                # An uppercase value here is the CLI/MCP vocabulary leaking into
                # a surface that never speaks it. Malformed, not coercible.
                problems.append(f"{name} has a value outside its enum")
        elif spec["type"] == "array":
            if not isinstance(value, list) or not all(isinstance(i, str) for i in value):
                problems.append(f"{name} is not an array of strings")
    return problems
