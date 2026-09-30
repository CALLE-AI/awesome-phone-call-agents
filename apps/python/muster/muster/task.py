"""The words the agent says on the phone.

Three things are non-negotiable in this script and are asserted in the tests:
disclosure of who is calling and why, disclosure of what the call causes, and
an explicit statement that the call cannot take anything away. A person who
believes their pension is about to be cut will say whatever they think is
needed, which is exactly the pressure that produces bad evidence.

The recipient's number never appears in the script. It is carried in the
request's `recipients` field instead, so a plan preview, a log line or the
console can show the whole spoken text without disclosing the line.
"""

from __future__ import annotations

from .models import KnowledgePrompt, Nonce, Subject


def build_task(
    subject: Subject,
    issued_nonce: Nonce,
    prompts: tuple[KnowledgePrompt, ...],
    scheme_name: str,
) -> str:
    """Compose the natural-language instruction for one attestation call."""
    questions = " ".join(
        f"Question {i}: {p.question}" for i, p in enumerate(prompts, start=1)
    )
    asking = (
        f" Then ask these questions one at a time and wait for an answer to each. {questions}"
        if prompts
        else ""
    )
    return (
        f"Speak {subject.language}. "
        f"Say that you are an automated call on behalf of {scheme_name}, "
        f"that you are calling {subject.display_name} about reference "
        f"{subject.reference}, and that this is the periodic check confirming "
        "they are still receiving their payments. "
        "Say clearly that this call cannot stop or reduce any payment, and that "
        "if anything is unclear a person will call them back. "
        "Ask whether you are speaking to "
        f"{subject.display_name} themselves. "
        "If the person says they are somebody else, do not ask them anything "
        "further about the person you are calling: thank them and end the call. "
        "If they say they are the right person, ask them to "
        f"{issued_nonce.spoken_instruction()}."
        f"{asking} "
        "If you reach a recorded menu, hold music, or an automated greeting "
        "rather than a person, do not wait and do not press anything: end the "
        "call immediately. "
        "Otherwise be patient, speak slowly, and repeat a question if asked. "
        "Never say whether an answer was right or wrong. "
        "If the person becomes distressed or cannot follow the questions, stop "
        "asking, tell them a person will call them back, and end the call politely."
    )
