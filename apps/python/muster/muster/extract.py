"""Turn a terminal CALL-E call task into `Observations`.

Everything unrecognised becomes `unknown`. That is deliberate: CALL-E returns
`structured_result: null` when it could not produce a schema-valid result from
the evidence, and an absent field must never quietly read as "no".
"""

from __future__ import annotations

from typing import Any

from .models import Endpoint, KnowledgePrompt, Observations, Ternary, TranscriptTurn


def _ternary(value: Any) -> Ternary:
    try:
        return Ternary(str(value).strip().lower())
    except ValueError:
        return Ternary.UNKNOWN


def _endpoint(value: Any) -> Endpoint:
    try:
        return Endpoint(str(value).strip().lower())
    except ValueError:
        return Endpoint.UNKNOWN


def _strings(value: Any) -> tuple[str, ...]:
    if isinstance(value, list):
        return tuple(str(item) for item in value if str(item).strip())
    return ()


def transcript_turns(call: dict[str, Any]) -> tuple[TranscriptTurn, ...]:
    """Flatten `recipients[].attempts[].transcript_turns` in call order."""
    collected: list[TranscriptTurn] = []
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                try:
                    offset = float(turn.get("offset_seconds", 0.0))
                except (TypeError, ValueError):
                    offset = 0.0
                collected.append(
                    TranscriptTurn(
                        offset_seconds=offset,
                        speaker=str(turn.get("speaker", "unknown")),
                        text=str(turn.get("text", "")),
                    )
                )
    return tuple(collected)


def observations(call: dict[str, Any], prompts: tuple[KnowledgePrompt, ...]) -> Observations:
    """Read a terminal call task. A null structured result yields all-unknown."""
    result = call.get("structured_result") or {}
    answers = {
        prompt.prompt_id: str(result.get(f"answer_{prompt.prompt_id}", "") or "")
        for prompt in prompts
    }
    return Observations(
        answered_by=_endpoint(result.get("answered_by")),
        claimed_to_be_subject=_ternary(result.get("claimed_to_be_subject")),
        nonce_words_heard=_strings(result.get("nonce_words_heard")),
        nonce_words_reversed_heard=_strings(result.get("nonce_words_reversed_heard")),
        weekday_heard=str(result.get("weekday_heard", "") or ""),
        prompt_answers=answers,
        another_person_present=_ternary(result.get("another_person_present")),
        subject_reported_dead=_ternary(result.get("subject_reported_dead")),
        wrong_number=_ternary(result.get("wrong_number")),
        distress_or_confusion=_ternary(result.get("distress_or_confusion")),
        evidence_quotes=_strings(result.get("evidence_quotes")),
        turns=transcript_turns(call),
    )
