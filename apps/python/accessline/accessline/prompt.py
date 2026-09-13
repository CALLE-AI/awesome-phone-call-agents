"""Fixed call script and disclosure for AccessLine."""

from __future__ import annotations

from accessline.schema import AccessLineInput

AUTOMATION_DISCLOSURE = (
    "Hello, this is an automated assistant calling to verify public accessibility "
    "information for a visitor. I am not a person and I am not calling on behalf "
    "of any government agency or medical provider."
)

FIXED_QUESTIONS = (
    "Is there a step-free public entrance currently available?",
    "Is an accessible restroom currently available?",
    "Is there any access limitation or arrival instruction the visitor should know?",
)

CONVERSATION_STYLE = (
    "Be calm, polite, professional, and concise. Do not sound salesy or overly cheerful."
)

REPEAT_BEHAVIOR = (
    "If the recipient did not hear or understand, or asks you to repeat, rephrase once "
    "naturally. A repeat request is not refusal. If an answer is ambiguous, clarify once; "
    "record unknown if still unclear."
)

ACKNOWLEDGMENT_GUIDANCE = (
    'Use brief acknowledgments between answers when natural (for example: "Thank you.", '
    '"Got it.", "Thanks, one more question.").'
)

CLOSING_REQUIREMENT = (
    'After the third answer, close clearly: say questions are finished, thank them, and '
    'say goodbye (for example: "That\'s all we needed. Thank you for your time. Bye."). '
    "Do not end abruptly."
)

UNCERTAINTY_REQUIREMENT = (
    "Do not invent facts. Record unknown when evidence is insufficient."
)

SENSITIVE_QUESTION_PATTERNS = (
    "social security",
    "date of birth",
    "medical diagnosis",
    "credit card",
    "password",
)

DECEPTION_PATTERNS = (
    "pretend to be human",
    "sound human",
    "hide that you are ai",
    "do not mention you are automated",
)


def build_call_script(input_data: AccessLineInput) -> str:
    visit_line = (
        f"The visitor is planning a visit around {input_data.visit_date}."
        if input_data.visit_date
        else "The visitor is planning a future visit."
    )
    question_block = "\n".join(f"{index + 1}. {question}" for index, question in enumerate(FIXED_QUESTIONS))
    return (
        f"{AUTOMATION_DISCLOSURE}\n"
        f"Call about accessibility at {input_data.venue_name}. {visit_line}\n"
        f"{CONVERSATION_STYLE} Stay disclosed as an automated assistant.\n"
        "Ask these three factual questions one at a time:\n"
        f"{question_block}\n"
        f"{REPEAT_BEHAVIOR}\n"
        f"{ACKNOWLEDGMENT_GUIDANCE}\n"
        "Do not ask for personal information.\n"
        f"{UNCERTAINTY_REQUIREMENT}\n"
        f"{CLOSING_REQUIREMENT}"
    )


def script_contains_disclosure(script: str) -> bool:
    lowered = script.lower()
    return "automated assistant" in lowered and "not a person" in lowered


def script_contains_sensitive_expansion(script: str) -> bool:
    lowered = script.lower()
    return any(pattern in lowered for pattern in SENSITIVE_QUESTION_PATTERNS)


def script_contains_repeat_behavior(script: str) -> bool:
    lowered = script.lower()
    return "repeat" in lowered and "rephrase once" in lowered


def script_contains_polite_closing(script: str) -> bool:
    lowered = script.lower()
    return "that's all we needed" in lowered and "thank you for your time" in lowered


def script_preserves_three_question_scope(script: str) -> bool:
    return all(question.lower() in script.lower() for question in FIXED_QUESTIONS)


def script_does_not_conceal_ai_identity(script: str) -> bool:
    lowered = script.lower()
    if not script_contains_disclosure(script):
        return False
    return not any(pattern in lowered for pattern in DECEPTION_PATTERNS)
