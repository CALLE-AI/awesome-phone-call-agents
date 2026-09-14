"""Building the CALL-E request, and deciding what came back means.

The interpretation half is where a verification product earns or loses trust,
so the rules are explicit and ordered, and each one fails closed:

  1. A call that has not reached a terminal state is pending. Nothing else.
  2. `reached_employer` must be `yes` before any positive disposition. CALL-E
     issue #341 reports `task_completed: true` when voice-agent setup fails
     before dialing; without this gate that becomes "employment confirmed"
     with no conversation. This is the same shape as `agency-status-watch`
     refusing a status it did not hear through the IVR.
  3. A refusal is terminal and never retried. Someone declining to confirm
     anything has given a complete answer; redialling them is harassment.
  4. Low confidence goes to a human. So does a positive claim with no
     supporting evidence string, and so does any internal contradiction.
  5. Only a reached, confident, evidenced, internally consistent result may
     say verified.

No rule promotes a result. Every one of them can only move a disposition
toward human review.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Sequence

from .schema import CONTACT_GATE_KEY, UNKNOWN, DerivedSchema, derive_task_schema
from .tasks import build_task
from .types import ConsentedEmployerContact, redact

# Operator-defined columns vary, but these carry meaning to the state machine
# when present.
EMPLOYMENT_KEY = "employment_confirmed"
DECLINED_KEY = "declined_to_answer"

TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})

DEFAULT_CONFIDENCE_FLOOR = 0.7


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
    confidence: float | None = None
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
    """Assemble `POST /v1/calls` for one verification request.

    Several contacts are allowed when they are different numbers for the same
    employer -- a switchboard and a direct HR line, say. CALL-E returns a
    separate structured result per recipient, which is exactly the shape of
    "we tried two numbers, here is what each said".
    """
    if not contacts:
        raise CalleError("no consented contacts to call")

    first = contacts[0]
    for contact in contacts[1:]:
        if contact.request_id != first.request_id:
            raise CalleError(
                "a single call task must belong to one verification request; "
                f"got {first.request_id} and {contact.request_id}"
            )
        if contact.task_spec_version != first.task_spec_version:
            raise CalleError(
                f"{first.request_id}: contacts were consented under different "
                "task spec versions"
            )

    seen: set[str] = set()
    recipients: list[dict[str, Any]] = []
    for contact in contacts:
        if contact.number.e164 in seen:
            raise CalleError(
                f"{first.request_id}: the same number appears twice; one "
                "employer should not be dialed twice in one task"
            )
        seen.add(contact.number.e164)
        recipient: dict[str, Any] = {"phones": [contact.number.e164]}
        if region:
            recipient["region"] = region
        if locale:
            recipient["locale"] = locale
        recipients.append(recipient)

    return {
        "task": build_task(first, requester_name=requester_name),
        "recipients": recipients,
        "result_schema": derive_task_schema(),
        "recipient_result_schema": derived.schema,
        "metadata": {
            "request_id": first.request_id,
            "applicant_ref": first.applicant_ref,
            "consent_receipt_id": first.consent_receipt_id,
            "task_spec_version": first.task_spec_version,
            # Provenance travels with the call so an audit can show the dialed
            # number did not come from the application.
            "number_sources": [c.number.source.value for c in contacts],
        },
    }


def _first_recipient_result(call: dict[str, Any]) -> tuple[dict[str, Any] | None, float | None]:
    recipients = call.get("recipients") or []
    if not recipients:
        return None, None
    recipient = recipients[0] or {}
    result = recipient.get("structured_result")
    confidence = None
    conf = call.get("completion_confidence") or {}
    if isinstance(conf, dict) and isinstance(conf.get("score"), (int, float)):
        confidence = float(conf["score"])
    return (result if isinstance(result, dict) else None), confidence


def interpret(
    call: dict[str, Any],
    derived: DerivedSchema,
    *,
    confidence_floor: float = DEFAULT_CONFIDENCE_FLOOR,
) -> Interpretation:
    """Turn a CALL-E call object into a disposition. Fails closed at every step."""
    status = (call.get("status") or "").lower()
    if status not in TERMINAL_STATUSES:
        return Interpretation(
            Disposition.PENDING, f"call status is {status or 'unknown'}"
        )

    # Provider-written text. It lands in an Airtable cell, the console and
    # the audit record, and it can quote a number back at us, so it is
    # redacted once here rather than at each of those surfaces.
    evidence = tuple(
        redact(e)
        for e in (call.get("evidence") or [])
        if isinstance(e, str) and e.strip()
    )

    if status in ("failed", "canceled"):
        return Interpretation(
            Disposition.EMPLOYER_UNREACHABLE,
            f"call ended {status} without a conversation",
            retryable=(status == "failed"),
            evidence=evidence,
        )

    answers, confidence = _first_recipient_result(call)

    if not answers:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "no structured result was returned for the recipient",
            evidence=evidence,
            confidence=confidence,
        )

    # Gate: evidence of contact, before anything positive can be said.
    # CALL-E issue #341 -- task_completed can be true with no call placed.
    if answers.get(CONTACT_GATE_KEY) != "yes":
        return Interpretation(
            Disposition.EMPLOYER_UNREACHABLE,
            (
                f"{CONTACT_GATE_KEY} is "
                f"{answers.get(CONTACT_GATE_KEY, 'absent')!r}; nothing is "
                "reported as verified without evidence a person was reached"
            ),
            retryable=True,
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    # A refusal is a complete answer. It is never retried.
    if answers.get(DECLINED_KEY) == "yes":
        return Interpretation(
            Disposition.DECLINED,
            "the employer declined to confirm; this is a final outcome",
            retryable=False,
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    if confidence is None:
        # A skipped check is not a passed one. Without a score there is
        # nothing to compare against the floor, so this cannot be called
        # confident and a person decides.
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "the call carried no completion confidence, so the floor could "
            "not be applied",
            evidence=evidence,
            confidence=None,
            answers=answers,
        )

    if confidence < confidence_floor:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            f"completion confidence {confidence:.2f} is below {confidence_floor:.2f}",
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    if not evidence:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "a positive result with no supporting evidence is not acted on",
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    employment = answers.get(EMPLOYMENT_KEY)
    if employment == "no":
        return Interpretation(
            Disposition.NOT_VERIFIED,
            "the employer stated the person is not employed there",
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )
    if employment != "yes":
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            f"{EMPLOYMENT_KEY} is {employment!r}",
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    # Employment confirmed. Anything that contradicts it goes to a human;
    # anything merely unestablished is partial.
    checks = [
        key
        for key in derived.keys
        if key not in (CONTACT_GATE_KEY, EMPLOYMENT_KEY, DECLINED_KEY)
        and isinstance(derived.schema["properties"].get(key, {}).get("enum"), list)
    ]
    # A value the schema does not define is not a fact. "probably" is
    # neither a contradiction nor an unknown, so it passed both checks below
    # and counted as established until this gate existed.
    off_schema = [
        key
        for key in checks
        if answers.get(key) is not None
        and answers.get(key) not in derived.schema["properties"][key]["enum"]
    ]
    if off_schema:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "the provider returned a value outside the schema for "
            + ", ".join(f"{k} ({answers.get(k)!r})" for k in sorted(off_schema)),
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    contradicted = [key for key in checks if answers.get(key) == "no"]
    if contradicted:
        return Interpretation(
            Disposition.NEEDS_REVIEW,
            "employment confirmed but the employer contradicted "
            + ", ".join(sorted(contradicted)),
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    unestablished = [key for key in checks if answers.get(key) in (UNKNOWN, None)]
    if unestablished:
        return Interpretation(
            Disposition.PARTIAL,
            "employment confirmed; " + ", ".join(sorted(unestablished)) + " unestablished",
            evidence=evidence,
            confidence=confidence,
            answers=answers,
        )

    return Interpretation(
        Disposition.VERIFIED,
        "reached the employer and confirmed every requested fact",
        evidence=evidence,
        confidence=confidence,
        answers=answers,
    )
