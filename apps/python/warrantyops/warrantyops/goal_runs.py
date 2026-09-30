"""The Goal Runs surface: one failure enum, mapped; one probe, honest.

D2 (locked): Goal Runs are conditional, never assumed. The Calls API is
primary until a real GoalRun response proves per-attempt transcript turns
with speaker labels. Until then the Goal surface contributes exactly one
thing to this workflow — the ``GoalRunError`` failure enum, the one contract
the Calls API does not offer — and this module is its comparator.

Two public pieces:

- the **transport mapping**: every ``GoalRunError`` names an explicit
  ``(TransportState, TerminalState, ClaimStatus)`` triple. ``ClaimStatus``
  is ``UNKNOWN`` in every row: a claim status is grounded only in
  counterparty transcript evidence, never inferred from a transport code.
- the **capability probe**: evaluates a GET-returned GoalRun payload against
  the five promotion criteria. Against the documented surface (authoring is
  dashboard-only; a run may not carry a task, schema or RunSpec selector;
  transcript exposure unverified) the probe is not proven, and that is the
  recorded conclusion — not a gap to paper over.

``NO_PERSON`` and ``Person: yes`` are deliberately absent: they are not
platform codes. Such facts are derived from ``user``-speaker transcript
turns and labelled derived, or omitted — never presented as an error enum
member.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import Enum
from typing import Any, Optional

from .contract import ClaimStatus
from .outcome import TERMINAL_TRANSPORT_STATES, TerminalState, TransportState

__all__ = [
    "GOAL_ERROR_TRIPLES",
    "GoalRunErrorCode",
    "goal_error_triple",
    "probe_goal_capability",
    "resolve_against_get",
]


class GoalRunErrorCode(str, Enum):
    """The documented ``GoalRun.error.code`` values. Exactly eight."""

    CALL_FAILED = "call_failed"
    NO_ANSWER = "no_answer"
    DECLINED = "declined"
    TIMED_OUT = "timed_out"
    CANCELED = "canceled"
    RESULT_INVALID = "result_invalid"
    RESULT_UNAVAILABLE = "result_unavailable"
    RESULT_FAILED = "result_failed"


#: The locked mapping. ``ClaimStatus`` is UNKNOWN in every row by design.
GOAL_ERROR_TRIPLES: dict[GoalRunErrorCode, tuple[TransportState, TerminalState, ClaimStatus]] = {
    GoalRunErrorCode.CALL_FAILED: (
        TransportState.FAILED,
        TerminalState.TRANSPORT_FAILED,
        ClaimStatus.UNKNOWN,
    ),
    # no_answer is FAILED unless the authoritative GET says COMPLETED; the
    # GET resolution records which of the two happened.
    GoalRunErrorCode.NO_ANSWER: (
        TransportState.FAILED,
        TerminalState.TRANSPORT_FAILED,
        ClaimStatus.UNKNOWN,
    ),
    GoalRunErrorCode.DECLINED: (
        TransportState.FAILED,
        TerminalState.TRANSPORT_FAILED,
        ClaimStatus.UNKNOWN,
    ),
    # timed_out stays in flight until GET confirms; the GET resolution moves
    # it to FAILED (never guessed from the timeout itself).
    GoalRunErrorCode.TIMED_OUT: (
        TransportState.IN_PROGRESS,
        TerminalState.IN_FLIGHT,
        ClaimStatus.UNKNOWN,
    ),
    GoalRunErrorCode.CANCELED: (
        TransportState.CANCELED,
        TerminalState.TRANSPORT_FAILED,
        ClaimStatus.UNKNOWN,
    ),
    GoalRunErrorCode.RESULT_INVALID: (
        TransportState.COMPLETED,
        TerminalState.RESULT_INVALID,
        ClaimStatus.UNKNOWN,
    ),
    GoalRunErrorCode.RESULT_UNAVAILABLE: (
        TransportState.COMPLETED,
        TerminalState.RESULT_UNAVAILABLE,
        ClaimStatus.UNKNOWN,
    ),
    GoalRunErrorCode.RESULT_FAILED: (
        TransportState.COMPLETED,
        TerminalState.RESULT_UNAVAILABLE,
        ClaimStatus.UNKNOWN,
    ),
}


def goal_error_triple(code: Any) -> tuple[TransportState, TerminalState, ClaimStatus]:
    """The pre-GET triple for a GoalRun error code. Unknown codes refuse."""

    try:
        return GOAL_ERROR_TRIPLES[GoalRunErrorCode(code)]
    except (KeyError, ValueError) as error:
        raise ValueError(
            f"{code!r} is not a documented GoalRunError code; refusing to "
            "invent a mapping"
        ) from error


def resolve_against_get(
    code: Any,
    get_state: Optional[TransportState],
) -> tuple[TransportState, TerminalState, ClaimStatus]:
    """Refine the triple with the authoritative GET state. GET is truth.

    Only the two rows the locked table makes conditional move:

    - ``timed_out`` is ``IN_PROGRESS``/``IN_FLIGHT`` until GET confirms a
      terminal state, then ``FAILED``/``TRANSPORT_FAILED``;
    - ``no_answer`` is ``FAILED`` unless GET says ``COMPLETED``, in which
      case the transport records COMPLETED — the terminal stays
      ``TRANSPORT_FAILED`` and the run records which occurred.

    Every other row ignores the GET state for transport purposes (the GET
    payload still governs the business outcome; this function is the
    transport comparator, not the business classifier). A non-terminal GET
    never resolves anything: the run stays in flight.
    """

    member = GoalRunErrorCode(code)
    transport, terminal, claim = GOAL_ERROR_TRIPLES[member]
    if get_state is None or get_state not in TERMINAL_TRANSPORT_STATES:
        return (transport, terminal, claim)
    if member is GoalRunErrorCode.TIMED_OUT:
        return (TransportState.FAILED, TerminalState.TRANSPORT_FAILED, claim)
    if member is GoalRunErrorCode.NO_ANSWER and get_state is TransportState.COMPLETED:
        return (TransportState.COMPLETED, terminal, claim)
    return (transport, terminal, claim)


#: Speaker labels the grounding layer understands. A GoalRun whose attempts
#: carry transcript turns under any other labeling is not equivalent to the
#: Calls API surface, whatever else it exposes.
DOCUMENTED_SPEAKER_LABELS = frozenset({"bot", "user", "unknown"})


def probe_goal_capability(
    run_payload: Mapping[str, Any],
    *,
    keypad_plan_supplied: bool = False,
    keypad_evidence: Optional[Mapping[str, Any]] = None,
) -> dict[str, Any]:
    """Evaluate a GET-returned GoalRun payload against the promotion gate.

    The probe answers five questions, each a named check in the report:
    transcript turns with documented speaker labels (including at least one
    ``user`` turn, or grounding cannot work), a result shape compatible with
    the extraction contract, readable status values, keypad-plan support
    when a plan is supplied, and the completeness of the eight-error
    mapping against GET truth. ``capable`` is true only when every
    applicable check passes.

    The payload is what a GET actually returned — never an assertion about
    what a deployed Goal might do. Repository prompt text is the authored
    source, not proof of deployed text.
    """

    checks: list[dict[str, Any]] = []

    speakers: set[str] = set()
    turns_found = False
    attempts = run_payload.get("attempts")
    if isinstance(attempts, list):
        for attempt in attempts:
            turns = (
                attempt.get("transcript_turns")
                if isinstance(attempt, Mapping)
                else None
            )
            if not isinstance(turns, list):
                continue
            for turn in turns:
                if isinstance(turn, Mapping) and "speaker" in turn:
                    turns_found = True
                    speaker = turn.get("speaker")
                    if isinstance(speaker, str):
                        speakers.add(speaker)
    labeled = speakers <= DOCUMENTED_SPEAKER_LABELS
    checks.append(
        {
            "name": "transcript_turns_with_speaker_labels",
            "ok": turns_found and labeled and "user" in speakers,
            "detail": (
                f"speakers seen: {sorted(speakers) if speakers else 'none'}"
                if turns_found
                else "no transcript turns exposed"
            ),
        }
    )

    result = run_payload.get("structured_result", run_payload.get("result"))
    result_ok = isinstance(result, Mapping) and isinstance(
        result.get("claim_status"), str
    )
    checks.append(
        {
            "name": "result_compatible_with_extraction_contract",
            "ok": result_ok,
            "detail": (
                "structured_result carries a claim_status"
                if result_ok
                else "no structured result shape the contract can read"
            ),
        }
    )

    status = run_payload.get("status")
    status_ok = isinstance(status, str) and bool(status)
    checks.append(
        {
            "name": "status_reads",
            "ok": status_ok,
            "detail": f"status: {status!r}" if status_ok else "no readable status",
        }
    )

    if keypad_plan_supplied:
        keypad_ok = isinstance(keypad_evidence, Mapping) and bool(keypad_evidence)
        checks.append(
            {
                "name": "keypad_plan_supported",
                "ok": keypad_ok,
                "detail": (
                    "provider exposes keypad support evidence"
                    if keypad_ok
                    else "no keypad support surface; a supplied plan cannot run"
                ),
            }
        )

    mapping_ok = (
        len(GOAL_ERROR_TRIPLES) == 8
        and all(
            claim is ClaimStatus.UNKNOWN
            and terminal is not TerminalState.INFORMATION_OBTAINED
            for _transport, terminal, claim in GOAL_ERROR_TRIPLES.values()
        )
    )
    checks.append(
        {
            "name": "all_eight_errors_mapped_against_get_truth",
            "ok": mapping_ok,
            "detail": (
                "8 documented codes; no mapping invents a business fact"
                if mapping_ok
                else "mapping incomplete"
            ),
        }
    )

    return {
        "capable": all(check["ok"] for check in checks),
        "checks": checks,
        "conclusion": (
            "Goal Runs may be promoted"
            if all(check["ok"] for check in checks)
            else "Goal Runs not proven; Calls API remains primary"
        ),
    }


#: What this repository can honestly conclude today: the documented surface
#: does not expose transcripts on GoalRun results, run requests cannot carry
#: this workflow's schema, and publication is a dashboard action. The probe
#: software exists so a future payload can be evaluated mechanically; the
#: conclusion below changes only when a real GET payload passes it.
PUBLISHED_CONCLUSION = (
    "Goal Runs are not proven capable: no GoalRun payload exposing "
    "per-attempt transcript turns with speaker labels is available to this "
    "repository, and a run request may not carry this workflow's extraction "
    "schema (schema_override_not_allowed). Calls API remains primary; the "
    "GoalRunError enum is used as a failure-enum comparator only."
)
