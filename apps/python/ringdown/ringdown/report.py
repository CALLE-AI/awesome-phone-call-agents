from __future__ import annotations

from datetime import datetime
from typing import Sequence
from zoneinfo import ZoneInfo

from ringdown.escalate import Attempt, LadderResult
from ringdown.exits import EXIT_UNRESOLVED, EXIT_UNVERIFIED
from ringdown.incident import Incident, Policy, Rung, mask_phone

ATTEMPT_INDENT = " " * 6
SPAN_INDENT = " " * 8
SPAN_LABEL = 13
HEAD_HEX = len("sha256:") + 4

INJECTION_NOTE = (
    "note: the transcript contains an instruction addressed to this agent. It was recorded as",
    "      evidence and not followed.",
)

UNKNOWN_ADVICE = "Reconcile this call before running again. Do not re-run to find out."

MISMATCH_ADVICE = (
    "The acknowledgement recorded on the placing channel is not supported by the second channel.",
    "Treat this incident as unowned.",
)

UNRESOLVED_ADVICE = (
    "The second channel could not be reached, so the recorded acknowledgement is unconfirmed.",
    "Nothing contradicts it. Confirm the owner another way before you stand down.",
)

NOTHING_PLACED = (
    "CALL-E accepted no call on this ladder, so there is nothing to verify and nobody was asked.",
    "Fix the refusal reported above and run again. No phone rang.",
)

ADVICE = {EXIT_UNVERIFIED: MISMATCH_ADVICE, EXIT_UNRESOLVED: UNRESOLVED_ADVICE}

LADDER_VERDICT_TAIL = {
    "unacknowledged": "the ladder is exhausted and this incident has no owner",
    "unknown": "call state could not be established",
    "declined": "the ladder was not continued",
}


def header_lines(incident: Incident, rungs: Sequence[Rung], moment: datetime) -> list[str]:
    return [
        f"incident {incident.id}  {incident.severity}  {incident.service}",
        f"  {incident.title}",
        "",
        *ladder_lines(rungs, moment),
        "",
    ]


def local_time(rung: Rung, moment: datetime) -> str:
    return moment.astimezone(ZoneInfo(rung.contact.timezone)).strftime("%H:%M")


def ladder_lines(rungs: Sequence[Rung], moment: datetime) -> list[str]:
    scope = max(len(rung.scope) for rung in rungs) + 2
    name = max(len(rung.contact.name) for rung in rungs) + 3
    return ["ladder"] + [
        f"  {position}. {rung.scope.ljust(scope)}{rung.contact.name.ljust(name)}"
        f"{mask_phone(rung.contact.phone)}  {local_time(rung, moment)} local"
        for position, rung in enumerate(rungs, 1)
    ]


def attempt_header(position: int, total: int, rung: Rung) -> str:
    return (
        f"[{position}/{total}] {rung.scope}  {rung.contact.name}  "
        f"{mask_phone(rung.contact.phone)}"
    )


def progress_line(line: str) -> str:
    return f"{ATTEMPT_INDENT}{line}"


def reason_prose(attempt: Attempt, policy: Policy) -> tuple[str, ...]:
    snapshot = attempt.snapshot
    if attempt.reason == "no_answer":
        return ("nobody picked up",)
    if attempt.reason == "voicemail":
        return ("a recording is not a person",)
    if attempt.reason == "low_confidence" and snapshot is not None:
        return (
            f"label {snapshot.confidence_label} carried a score of "
            f"{snapshot.confidence_score}, below the {policy.min_confidence} floor",
        )
    if attempt.reason == "no_eta":
        return (
            "the call completed and the provider was confident,",
            "and no number of minutes was committed to when asked",
        )
    return ()


def _wrapped(label: str, prose: Sequence[str]) -> list[str]:
    prefix = progress_line(f"{label}  ")
    if not prose:
        return [progress_line(label)]
    return [f"{prefix}{prose[0]}"] + [f"{' ' * len(prefix)}{line}" for line in prose[1:]]


def _call_line(attempt: Attempt) -> list[str]:
    snapshot = attempt.snapshot
    if snapshot is None:
        return []
    tail = (
        f"failure {snapshot.failure_code}"
        if snapshot.failure_code
        else f"confidence {snapshot.confidence_score} {snapshot.confidence_label}"
    )
    return [progress_line(f"call {snapshot.id}  status {snapshot.status}  {tail}")]


def _span(label: str, value: str) -> str:
    return f"{SPAN_INDENT}{label.ljust(SPAN_LABEL)}{value}"


def _quoted(span: str) -> str:
    return f'"{span}"'


def _span_lines(attempt: Attempt) -> list[str]:
    extraction, snapshot = attempt.extraction, attempt.snapshot
    if extraction is None or snapshot is None:
        return []
    if attempt.verdict == "acknowledged":
        return [
            _span("disposition", _quoted(extraction.disposition_span)),
            _span("owner", _quoted(extraction.owner_span)),
            _span("eta", _quoted(extraction.eta_span)),
        ]
    if attempt.verdict == "declined":
        return [_span("disposition", _quoted(extraction.disposition_span))]
    if snapshot.status != "completed" or attempt.reason == "low_confidence":
        return []
    disposition = (
        _quoted(extraction.disposition_span)
        if extraction.disposition_span
        else extraction.disposition
    )
    eta = _quoted(extraction.eta_span) if extraction.eta_span else "absent"
    return [_span("disposition", disposition), _span("eta", eta)]


def _outcome_lines(attempt: Attempt, policy: Policy) -> list[str]:
    name = attempt.rung.contact.name
    extraction = attempt.extraction
    if attempt.verdict == "acknowledged" and extraction is not None:
        return [progress_line(f"acknowledged  owner {name}  eta {extraction.eta_minutes} minutes")]
    if attempt.verdict == "declined":
        return [progress_line(f"declined  {name} is not taking this incident")]
    if attempt.verdict == "unknown":
        return []
    return _wrapped(f"not acknowledged ({attempt.reason})", reason_prose(attempt, policy))


def attempt_lines(attempt: Attempt, policy: Policy) -> list[str]:
    lines = _call_line(attempt) + _outcome_lines(attempt, policy) + _span_lines(attempt)
    if attempt.instructed:
        lines.extend(progress_line(note) for note in INJECTION_NOTE)
    return lines


def verdict_lines(result: LadderResult) -> list[str]:
    last = result.deciding
    tail = LADDER_VERDICT_TAIL.get(result.verdict, "")
    if result.verdict == "acknowledged" and last is not None and last.extraction is not None:
        return [
            f"verdict acknowledged  owner {last.rung.contact.id}  "
            f"eta {last.extraction.eta_minutes} minutes"
        ]
    if result.verdict == "declined" and last is not None:
        return [f"verdict declined by {last.rung.contact.id}  {tail}"]
    return [f"verdict {result.verdict}  {tail}"]


def unknown_lines(result: LadderResult) -> list[str]:
    live = result.live_call_id
    return ([f"call {live} may still be live"] if live else []) + [UNKNOWN_ADVICE]


def ledger_lines(records: int, head: str, result: LadderResult) -> list[str]:
    short = f"{head[:HEAD_HEX]}…" if records else "none"
    return [f"ledger {records} records  head {short}  calls placed {result.placed}"]
