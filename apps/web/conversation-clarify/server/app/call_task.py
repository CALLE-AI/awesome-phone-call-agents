"""Turn a finding into the one call that would settle it.

The task text is bounded on purpose. It discloses that it is an AI, asks a
single question, reads the answer back, and refuses to do anything else. A
caller that can be talked into a second topic is a caller that can commit the
user to something they never approved.
"""

from __future__ import annotations

from .detect import Finding

# Regions and locales come from the destination's dialling code and CALL-E's
# published coverage table. Nothing here is inferred from a name or a language.
_REGIONS = {
    "+91": ("IN", "en-IN"), "+1": ("US", "en-US"), "+65": ("SG", "en-SG"),
    "+60": ("MY", "en-MY"), "+61": ("AU", "en-AU"), "+44": ("GB", "en-GB"),
    "+971": ("AE", "en-AE"), "+52": ("MX", "es-MX"), "+55": ("BR", "pt-BR"),
}


def region_for(phone: str) -> dict:
    for prefix, (region, locale) in sorted(_REGIONS.items(), key=lambda kv: -len(kv[0])):
        if phone.startswith(prefix):
            return {"region": region, "locale": locale}
    return {}


def build_task(finding: Finding, *, caller_name: str, recipient_name: str, subject: str) -> str:
    # Only ask the caller to check who answered when we have a name that is
    # actually distinguishable from the caller's own. Reading a thread can
    # produce a recipient name equal to the sender's -- a self-test, a shared
    # display name, a misattributed message -- and "end the call if this is not
    # Charles Miller" spoken on Charles Miller's behalf is a contradiction that would hang up on
    # the right person. Say nothing rather than something incoherent.
    named = recipient_name.strip()
    identity_check = bool(named) and named.casefold() != caller_name.strip().casefold()

    # Numbered steps rather than a paragraph: given prose, the caller reordered
    # the sequence and on one live call dropped the read-back entirely.
    #
    # Disclosure comes first even though identity is unconfirmed. Observed over
    # three live calls: CALL-E always discloses in its opening turn regardless of
    # instruction, which is the right norm anyway -- asking "is this Alex?" before
    # saying who is calling is how a cold caller sounds. So rather than fight it,
    # the opening discloses but withholds detail: the subject line and the
    # situation wait until the right person has confirmed, so a stranger who
    # picks up learns only that an assistant called, not what about.
    steps = []
    if identity_check:
        steps.append(
            f"Say only that you are an AI assistant calling on {caller_name}'s behalf, then "
            f"ask whether you are speaking to {named}. Do not mention the subject of the "
            f"email or any details yet. If it is not {named}, go to the ending rule below."
        )
        steps.append(
            f"Once {named} has confirmed, say it is about the email thread titled "
            f"'{subject}' and that it will take less than a minute."
        )
    else:
        steps.append(
            f"Say that you are an AI assistant calling on {caller_name}'s behalf about the "
            f"email thread titled '{subject}', and that it will take less than a minute."
        )
    steps.append(_situation(finding, caller_name))
    steps.append(f"Ask exactly this and nothing more: {finding.call_question}")
    steps.append(
        "Repeat their answer back to them and ask them to confirm you heard it correctly. "
        "Do not skip this step, and do not end the call before they have confirmed."
    )
    steps.append("Thank them and end the call.")

    numbered = " ".join(f"Step {i}. {text}" for i, text in enumerate(steps, start=1))
    wrong_person = f", or someone who is not {named}," if identity_check else ""

    return (
        f"Follow these steps in order, and do not reorder or skip any of them. "
        f"{numbered} "
        f"Throughout the call: greet the person once only, at the start, and do not greet "
        f"them again mid-call. Keep the whole call under one minute. Discuss nothing else. "
        f"Do not agree to anything, commit to anything, negotiate, or answer questions on "
        f"{caller_name}'s behalf. If you are asked anything else, say {caller_name} will follow up "
        f"by email. "
        f"Ending rule: if you reach voicemail, an automated system{wrong_person} "
        f"end the call politely without leaving any of the details above."
    )


def _situation(finding: Finding, caller_name: str) -> str:
    if finding.kind == "unclear_choice":
        return (
            f"The situation: {caller_name} asked '{finding.question}' and the reply was "
            f"'{finding.reply}', which does not say which option was meant."
        )
    return (
        f"The situation: {caller_name} asked '{finding.question}' and the reply was "
        f"'{finding.reply}', which agrees but does not say when."
    )


# Three schema constraints, each confirmed against the live API: a type is one
# value (no union types -- express absence with an empty string), some field
# names are reserved, and an unsatisfiable schema returns structured_result:
# null for the whole call. So only the closed enums -- which always have a
# valid fallback value -- are required.

_COMMON_ANSWERED_BY = {
    "type": "string",
    "enum": ["human", "ivr", "voicemail", "unknown"],
    "description": "Classify the final endpoint of the call. If an IVR transferred to a person, use human.",
}

_COMMON_QUOTE = {
    "type": "string",
    "description": (
        "The recipient's own words that establish the answer, quoted verbatim from the "
        "transcript. Empty string if no such words were spoken."
    ),
}


def build_schema(finding: Finding) -> dict:
    if finding.kind == "unclear_choice":
        options = ", ".join(finding.options)
        return {
            "type": "object",
            "required": ["resolved", "answered_by"],
            "properties": {
                "resolved": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                    "description": (
                        f"yes only if the recipient clearly named one of these options: {options}. "
                        "no if they declined or said neither. unknown if the call did not establish "
                        "it, including voicemail, a wrong person, or an ambiguous answer."
                    ),
                },
                "answered_by": _COMMON_ANSWERED_BY,
                "chosen_option": {
                    "type": "string",
                    "description": (
                        f"The option chosen, copied exactly from this list: {options}. "
                        "Empty string whenever resolved is not yes."
                    ),
                },
                "evidence_quote": _COMMON_QUOTE,
            },
            "additionalProperties": False,
        }

    return {
        "type": "object",
        "required": ["resolved", "answered_by"],
        "properties": {
            "resolved": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": (
                    "yes only if the recipient named a specific date or deadline. "
                    "no if they refused to commit. unknown if the call did not establish it, "
                    "including voicemail, a wrong person, or another vague answer such as 'soon'."
                ),
            },
            "answered_by": _COMMON_ANSWERED_BY,
            "committed_date": {
                "type": "string",
                "description": (
                    "The date they committed to, exactly as they said it, for example "
                    "'Thursday' or 'the 14th'. Empty string whenever resolved is not yes."
                ),
            },
            "evidence_quote": _COMMON_QUOTE,
        },
        "additionalProperties": False,
    }


def answer_field(finding: Finding) -> str:
    """Which schema field holds the answer for this finding kind."""
    return "chosen_option" if finding.kind == "unclear_choice" else "committed_date"
