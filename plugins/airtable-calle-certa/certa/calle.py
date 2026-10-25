"""Build one Calls v2 request and interpret only a ready, evidenced result.

A refusal is final. Missing facts, unsupported quotes and contradictions go to
human review; result availability alone never verifies employment.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Sequence

from .schema import CONTACT_GATE_KEY, UNKNOWN, DerivedSchema, call_result_schema, valid_answer
from .tasks import build_task
from .types import ConsentedEmployerContact, redact

# Operator-defined columns vary, but these carry meaning to the state machine
# when present.
EMPLOYMENT_KEY = "employment_confirmed"
DECLINED_KEY = "declined_to_answer"

TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})

READY_RESULT_STATUSES = frozenset({"available", "unavailable", "not_applicable"})


class CalleError(Exception):
    """A request could not be built from these contacts."""


class Disposition(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    PARTIAL = "partial"
    NOT_VERIFIED = "not_verified"
    EMPLOYER_UNREACHABLE = "employer_unreachable"
    DECLINED = "declined"
    NEEDS_REVIEW = "needs_review"


# Dispositions a human must look at before anything downstream acts on them.
HUMAN_REVIEW = frozenset({Disposition.NEEDS_REVIEW, Disposition.PARTIAL})


@dataclass(frozen=True, slots=True)
class Interpretation:
    disposition: Disposition
    reason: str
    retryable: bool = False
    evidence: tuple[str, ...] = ()
    answers: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Reasons are displayed in the CLI, panel, audit and Airtable. Keep
        # private answers intact for interpretation and second-read comparison.
        object.__setattr__(self, "reason", redact(self.reason))

    @property
    def is_terminal(self) -> bool:
        return self.disposition is not Disposition.PENDING


def idempotency_key(contacts: Sequence[ConsentedEmployerContact]) -> str:
    """A stable key for one authorised intent.

    Bound to the request, the exact numbers, the spec version and the consent
    tokens, so re-running an unchanged view never places a second call, while
    re-consenting after an edit correctly produces a new intent.
    """
    if not contacts:
        raise CalleError("no contacts to key")
    material = "\x1f".join(
        [contacts[0].request_id, contacts[0].task_spec_version]
        + sorted(f"{c.number.e164}:{c.consent_token}" for c in contacts)
    )
    return f"certa-{hashlib.sha256(material.encode()).hexdigest()[:32]}"


def build_call_payload(
    contacts: Sequence[ConsentedEmployerContact],
    *,
    derived: DerivedSchema,
    requester_name: str,
    region: str | None = None,
    locale: str | None = None,
) -> dict[str, Any]:
    """Assemble one consented destination for `POST /v2/calls`."""
    if len(contacts) != 1:
        raise CalleError("Calls v2 requires exactly one consented contact per request")
    first = contacts[0]
    payload = {
        "task": build_task(first, requester_name=requester_name),
        "phone": first.number.e164,
        "result_schema": call_result_schema(derived),
        "metadata": {
            "request_id": first.request_id,
            "applicant_ref": first.applicant_ref,
            "consent_receipt_id": first.consent_receipt_id,
            "task_spec_version": first.task_spec_version,
            "number_sources": [first.number.source.value],
        },
    }
    if region:
        payload["region"] = region
    if locale:
        payload["locale"] = locale
    return payload


def interpret(
    call: dict[str, Any],
    derived: DerivedSchema,
) -> Interpretation:
    """Turn a CALL-E call object into a disposition. Fails closed at every step."""
    status = call.get("status")
    readiness = call.get("result_status")
    if not isinstance(status, str) or status not in TERMINAL_STATUSES or not isinstance(readiness, str) or readiness not in READY_RESULT_STATUSES:
        return Interpretation(Disposition.PENDING, "waiting for the final Call result")
    if status in ("failed", "canceled") or call.get("error"):
        return Interpretation(Disposition.NEEDS_REVIEW, f"call ended {status}; review the Call error before retrying")
    outcome = call.get("call_outcome")
    if outcome == "declined":
        return Interpretation(Disposition.DECLINED, "the recipient declined; do not redial")
    if outcome in ("no_answer", "busy"):
        return Interpretation(Disposition.EMPLOYER_UNREACHABLE, f"call outcome is {outcome}", retryable=True)
    answers = call.get("result")
    if outcome != "completed" or readiness != "available" or not isinstance(answers, dict) or not answers:
        return Interpretation(Disposition.NEEDS_REVIEW, "no structured result is available for this Call")

    quote = answers.get("evidence_quote")
    turns = call.get("transcript")
    spoken = [" ".join(t["text"].casefold().split()) for t in turns
              if isinstance(t, dict) and t.get("speaker") == "user" and isinstance(t.get("text"), str)] if isinstance(turns, list) else []
    normalized = " ".join(quote.casefold().split()) if isinstance(quote, str) else ""
    evidence = (redact(quote),) if normalized and any(normalized in text for text in spoken) else ()

    # A refusal prevents another call even if the remaining answers are incomplete.
    if answers.get(DECLINED_KEY) == "yes":
        return Interpretation(Disposition.DECLINED, "the employer declined to confirm; this is a final outcome", answers=answers, evidence=evidence)

    # A completed telephone call does not establish contact with an employer.
    if answers.get(CONTACT_GATE_KEY) != "yes":
        return Interpretation(
            Disposition.EMPLOYER_UNREACHABLE if answers.get(CONTACT_GATE_KEY) == "no" else Disposition.NEEDS_REVIEW,
            (
                f"{CONTACT_GATE_KEY} is "
                f"{answers.get(CONTACT_GATE_KEY, 'absent')!r}; nothing is "
                "reported as verified without evidence a person was reached"
            ),
            evidence=evidence,
            answers=answers,
        )

    if not evidence:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "no evidence quote can be matched to a recipient transcript turn",
            answers=answers,
        )

    off_schema = [key for key, rule in derived.schema["properties"].items()
                  if not valid_answer(rule, answers.get(key))]
    if off_schema:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "the provider returned a value outside the schema for "
            + ", ".join(f"{key} ({answers.get(key)!r})" for key in off_schema),
            evidence=evidence, answers=answers,
        )

    employment = answers.get(EMPLOYMENT_KEY)
    if employment == "no":
        return Interpretation(
            Disposition.NOT_VERIFIED,
            "the employer stated the person is not employed there",
            evidence=evidence,
            answers=answers,
        )
    if employment != "yes":
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            f"{EMPLOYMENT_KEY} is {employment!r}",
            evidence=evidence,
            answers=answers,
        )

    # shortcut: English denial cues only; review other languages or ambiguous wording manually.
    words = re.sub(r"['‘’ʼ`]", "", normalized)
    if re.search(r"\b(no|not|never|cannot|cant|dont|doesnt|didnt|isnt|arent|wasnt|werent|wont|wouldnt|couldnt|havent|hasnt|hadnt|unsure|uncertain)\b", words):
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "the supporting quote contains a denial or uncertainty; review it against the employment answer",
            evidence=evidence, answers=answers,
        )

    # Employment confirmed. Anything that contradicts it goes to a human;
    # anything merely unestablished is partial.
    checks = [
        key
        for key in derived.keys
        if key not in (CONTACT_GATE_KEY, EMPLOYMENT_KEY, DECLINED_KEY)
        and isinstance(derived.schema["properties"].get(key, {}).get("enum"), list)
    ]
    contradicted = [key for key in checks if answers.get(key) == "no"]
    if contradicted:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "employment confirmed but the employer contradicted "
            + ", ".join(sorted(contradicted)),
            evidence=evidence,
            answers=answers,
        )

    unestablished = [key for key in checks if answers.get(key) in (UNKNOWN, None)]
    if unestablished:
        return Interpretation(
            Disposition.PARTIAL,
            "employment confirmed; " + ", ".join(sorted(unestablished)) + " unestablished",
            evidence=evidence,
            answers=answers,
        )

    return Interpretation(
        Disposition.VERIFIED,
        "reached the employer and confirmed every requested fact",
        evidence=evidence,
        answers=answers,
    )
