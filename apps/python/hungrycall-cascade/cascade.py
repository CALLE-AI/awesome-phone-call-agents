"""Sequential call cascade: phone candidates in order until one meets every condition.

A single call has one target. A cascade is a search: several candidates, criteria
that are only settled during the conversation, a verdict per call, and a state that
carries across calls -- who was asked, and what it failed on.

The interesting part is not the dialling. It is the judgement afterwards:

    must        without it there is no deal            "no further than 30 km"
    boundary    up to here and no further              "45 euros at most, all in"
    concession  available, but staged                  "pay privately -- but not first"
    wish        improves the ranking, blocks nothing   "preferably above four stars"

A concession is an authorisation, not a hint. The caller may only spend what the
user handed over, and only in the order the user set. A result that used a tier
nobody granted is rejected -- exactly like an offer above the boundary. An agent
that bought the table with money it was never given exceeded its mandate, and its
yes does not count.

This is the collection edition: fixture-driven, no network, no telephone, no
credentials, no scheduler. The full application lives at
https://github.com/ellmos-ai/hungrycall, field-tested live against the real
CALL-E service on 2026-08-11 and 2026-08-22 -- see its README's "How We
Tested" section.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterable, Sequence

# --------------------------------------------------------------------------------------
# Phone numbers
# --------------------------------------------------------------------------------------

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class NumberRejected(ValueError):
    """Raised before any processing when a candidate number is not valid E.164."""


def validate_number(raw: str) -> str:
    """Return the number if it is E.164, otherwise refuse to go on.

    Validation happens before processing, not before dialling: a malformed number
    must never reach the point where a real transport could pick it up.
    """
    number = (raw or "").strip()
    if not E164.match(number):
        raise NumberRejected(f"not a valid E.164 number: {mask(number) or '<empty>'}")
    return number


def mask(number: str) -> str:
    """Show the country prefix and the last two digits, hide the rest.

    Every output path goes through this. A full number never appears in a report,
    a log line or an error message.
    """
    if not number:
        return ""
    keep_tail = 2
    if len(number) <= keep_tail + 3:
        return "*" * len(number)
    return f"{number[:3]}{'*' * (len(number) - 3 - keep_tail)}{number[-keep_tail:]}"


# --------------------------------------------------------------------------------------
# Conditions
# --------------------------------------------------------------------------------------


class Kind(str, Enum):
    MUST = "must"
    BOUNDARY = "boundary"
    WISH = "wish"


@dataclass(frozen=True)
class Criterion:
    """One condition the candidate is judged against after the call."""

    key: str
    kind: Kind
    label: str
    limit: float | None = None  # boundary only: the number that must not be exceeded

    def canonical(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "kind": self.kind.value,
            "limit": self.limit,
        }


@dataclass(frozen=True)
class Concession:
    """Something the user is willing to give -- but not all at once.

    tier 1 is offered first. tier 2 only after tier 1 failed in the same call.
    The order matters: an agent that plays every card at once gives away more
    than a person would.
    """

    key: str
    label: str
    tier: int = 1

    def canonical(self) -> dict[str, Any]:
        return {"key": self.key, "tier": self.tier}


@dataclass(frozen=True)
class Request:
    """What the user wants, independent of who might provide it."""

    subject: str
    criteria: tuple[Criterion, ...]
    concessions: tuple[Concession, ...] = ()

    def granted_keys(self) -> frozenset[str]:
        return frozenset(c.key for c in self.concessions)

    def concession_order(self) -> list[Concession]:
        """Concessions sorted by tier, then by key for a stable order within a tier."""
        return sorted(self.concessions, key=lambda c: (c.tier, c.key))


@dataclass(frozen=True)
class Candidate:
    """One place that might be able to help."""

    id: str
    name: str
    phone: str
    rank_hint: float = 0.0  # higher is better; wishes feed this in the full app

    def __post_init__(self) -> None:
        validate_number(self.phone)


# --------------------------------------------------------------------------------------
# What came back
# --------------------------------------------------------------------------------------


class Outcome(str, Enum):
    """Terminal states plus the one that is deliberately not terminal."""

    ACCEPTED = "accepted"
    DECLINED = "declined"
    NO_ANSWER = "no_answer"
    UNKNOWN = "unknown"

    @property
    def is_terminal(self) -> bool:
        return self is not Outcome.UNKNOWN


@dataclass(frozen=True)
class CallReport:
    """What the fixture says came out of one conversation.

    `values` holds what the candidate stated for each criterion key. `tiers_used`
    holds the concession keys the agent says it played. Both are claims, and both
    are checked before the call counts as a success.
    """

    candidate_id: str
    outcome: Outcome
    values: dict[str, float] = field(default_factory=dict)
    satisfied: tuple[str, ...] = ()
    tiers_used: tuple[str, ...] = ()
    transcript_note: str = ""


class Verdict(str, Enum):
    ACCEPTED = "accepted"
    REJECTED_MUST = "rejected_must_unmet"
    REJECTED_BOUNDARY = "rejected_boundary_exceeded"
    REJECTED_MANDATE = "rejected_unauthorised_concession"
    REJECTED_ORDER = "rejected_concession_order"
    DECLINED = "declined"
    NO_ANSWER = "no_answer"
    HALTED_UNKNOWN = "halted_outcome_unknown"
    NOT_CALLED = "not_called"


@dataclass
class Attempt:
    candidate: Candidate
    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    intent_key: str = ""
    tiers_used: tuple[str, ...] = ()
    raw: CallReport | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate": self.candidate.name,
            "phone": mask(self.candidate.phone),
            "verdict": self.verdict.value,
            "reasons": list(self.reasons),
            "intent_key": self.intent_key,
            "concession_tiers_used": list(self.tiers_used),
            "raw_response": (
                {
                    "outcome": self.raw.outcome.value,
                    "stated_values": dict(self.raw.values),
                    "note": self.raw.transcript_note,
                }
                if self.raw is not None
                else None
            ),
        }


# --------------------------------------------------------------------------------------
# The intent key
# --------------------------------------------------------------------------------------


def intent_key(request: Request, candidate: Candidate) -> str:
    """Bind the canonical content of the intent, not the moment it was made.

    A key derived from a time window collides whenever two different intents share
    a minute, and differs whenever the same intent is retried a minute later. Both
    are wrong. The key here covers subject, candidate, every criterion and every
    granted concession -- change any of them and it is a different call.
    """
    payload = {
        "subject": request.subject,
        "candidate": candidate.id,
        "criteria": [c.canonical() for c in sorted(request.criteria, key=lambda c: c.key)],
        "concessions": [c.canonical() for c in request.concession_order()],
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------------------
# The judgement
# --------------------------------------------------------------------------------------


def judge(request: Request, report: CallReport) -> tuple[Verdict, list[str]]:
    """Decide whether this call closed the search. Claims are checked, not believed."""
    if not report.outcome.is_terminal:
        return Verdict.HALTED_UNKNOWN, [
            "outcome is not terminal; treating it as success, refusal or "
            "unreachability would all be inventions"
        ]
    if report.outcome is Outcome.NO_ANSWER:
        return Verdict.NO_ANSWER, ["nobody picked up"]
    if report.outcome is Outcome.DECLINED:
        return Verdict.DECLINED, ["candidate declined"]

    reasons: list[str] = []

    # A concession the user never granted is beyond the mandate. This is checked
    # first: an accepted offer bought with ungranted authority is not a success
    # that merely needs annotating, it is not a success at all.
    granted = request.granted_keys()
    ungranted = [k for k in report.tiers_used if k not in granted]
    if ungranted:
        return Verdict.REJECTED_MANDATE, [
            f"used concession '{k}' that was never authorised" for k in ungranted
        ]

    # Staging: a later tier may only appear once every earlier tier was tried.
    order = request.concession_order()
    tier_of = {c.key: c.tier for c in order}
    used_tiers = sorted({tier_of[k] for k in report.tiers_used})
    if used_tiers:
        expected = [c.tier for c in order if c.tier < max(used_tiers)]
        missing = sorted(set(expected) - set(used_tiers))
        if missing:
            return Verdict.REJECTED_ORDER, [
                f"tier {max(used_tiers)} was offered while tier {t} was never tried"
                for t in missing
            ]

    for criterion in request.criteria:
        if criterion.kind is Kind.BOUNDARY:
            stated = report.values.get(criterion.key)
            if stated is None:
                return Verdict.REJECTED_BOUNDARY, [
                    f"'{criterion.key}' is a boundary but the call returned no value for it"
                ]
            if criterion.limit is not None and stated > criterion.limit:
                return Verdict.REJECTED_BOUNDARY, [
                    f"{criterion.label}: {stated} exceeds the limit of {criterion.limit}"
                ]
            reasons.append(f"{criterion.label}: {stated} within {criterion.limit}")
        elif criterion.kind is Kind.MUST:
            if criterion.key not in report.satisfied:
                return Verdict.REJECTED_MUST, [f"{criterion.label}: not met"]
            reasons.append(f"{criterion.label}: met")
        else:  # wish -- never blocks
            met = criterion.key in report.satisfied
            reasons.append(f"{criterion.label}: {'met' if met else 'not met'} (wish)")

    return Verdict.ACCEPTED, reasons


# --------------------------------------------------------------------------------------
# The cascade
# --------------------------------------------------------------------------------------


@dataclass
class CascadeResult:
    subject: str
    attempts: list[Attempt]
    closed_by: str | None
    halted: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": "fixture / simulated / no-call",
            "subject": self.subject,
            "closed_by": self.closed_by,
            "halted_on_unknown_outcome": self.halted,
            "called": sum(1 for a in self.attempts if a.verdict is not Verdict.NOT_CALLED),
            "not_called": sum(1 for a in self.attempts if a.verdict is Verdict.NOT_CALLED),
            "attempts": [a.to_dict() for a in self.attempts],
        }


def order_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
    """Deterministic order: better rank hint first, then id. Never insertion order."""
    return sorted(candidates, key=lambda c: (-c.rank_hint, c.id))


def run_cascade(
    request: Request,
    candidates: Sequence[Candidate],
    reports: dict[str, CallReport],
) -> CascadeResult:
    """Work through the candidates one at a time and stop as soon as one fits.

    Two things end the run early. An acceptance ends it because the search is
    answered. An unknown outcome ends it because the next call would be built on
    a guess -- and a cascade that guesses spends the user's remaining candidates
    on a mistake.
    """
    attempts: list[Attempt] = []
    closed_by: str | None = None
    halted = False

    for candidate in order_candidates(candidates):
        if closed_by is not None or halted:
            attempts.append(Attempt(candidate=candidate, verdict=Verdict.NOT_CALLED))
            continue

        key = intent_key(request, candidate)
        report = reports.get(candidate.id)
        if report is None:
            attempts.append(
                Attempt(
                    candidate=candidate,
                    verdict=Verdict.HALTED_UNKNOWN,
                    reasons=["no fixture response for this candidate"],
                    intent_key=key,
                )
            )
            halted = True
            continue

        verdict, reasons = judge(request, report)
        attempts.append(
            Attempt(
                candidate=candidate,
                verdict=verdict,
                reasons=reasons,
                intent_key=key,
                tiers_used=report.tiers_used,
                raw=report,
            )
        )
        if verdict is Verdict.ACCEPTED:
            closed_by = candidate.name
        elif verdict is Verdict.HALTED_UNKNOWN:
            halted = True

    return CascadeResult(
        subject=request.subject, attempts=attempts, closed_by=closed_by, halted=halted
    )


# --------------------------------------------------------------------------------------
# Fixture loading and CLI
# --------------------------------------------------------------------------------------


def load_fixture(path: pathlib.Path) -> tuple[Request, list[Candidate], dict[str, CallReport]]:
    data = json.loads(path.read_text(encoding="utf-8"))

    criteria = tuple(
        Criterion(
            key=c["key"],
            kind=Kind(c["kind"]),
            label=c["label"],
            limit=c.get("limit"),
        )
        for c in data["request"]["criteria"]
    )
    concessions = tuple(
        Concession(key=c["key"], label=c["label"], tier=int(c.get("tier", 1)))
        for c in data["request"].get("concessions", [])
    )
    request = Request(
        subject=data["request"]["subject"], criteria=criteria, concessions=concessions
    )

    candidates = [
        Candidate(
            id=c["id"],
            name=c["name"],
            phone=c["phone"],
            rank_hint=float(c.get("rank_hint", 0.0)),
        )
        for c in data["candidates"]
    ]

    reports = {
        r["candidate_id"]: CallReport(
            candidate_id=r["candidate_id"],
            outcome=Outcome(r["outcome"]),
            values={k: float(v) for k, v in r.get("values", {}).items()},
            satisfied=tuple(r.get("satisfied", [])),
            tiers_used=tuple(r.get("tiers_used", [])),
            transcript_note=r.get("transcript_note", ""),
        )
        for r in data.get("responses", [])
    }
    return request, candidates, reports


def render(result: CascadeResult) -> str:
    lines = [
        "FIXTURE RUN -- SIMULATED, NO CALL PLACED",
        "No network, no telephone, no credentials. Responses come from the fixture file.",
        "",
        f"Subject: {result.subject}",
        "",
    ]
    for index, attempt in enumerate(result.attempts, start=1):
        head = f"{index}. {attempt.candidate.name}  {mask(attempt.candidate.phone)}"
        lines.append(f"{head}  ->  {attempt.verdict.value}")
        for reason in attempt.reasons:
            lines.append(f"     - {reason}")
        if attempt.tiers_used:
            lines.append(f"     - concessions played: {', '.join(attempt.tiers_used)}")
        if attempt.intent_key:
            lines.append(f"     - intent key: {attempt.intent_key}")
    lines.append("")
    if result.closed_by:
        lines.append(f"Closed by: {result.closed_by}. Remaining candidates were not called.")
    elif result.halted:
        lines.append("Halted on an unknown outcome. No further candidate was called.")
    else:
        lines.append("No candidate met every condition.")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sequential call cascade over a fixture. Never places a call."
    )
    parser.add_argument("--fixture", required=True, type=pathlib.Path)
    parser.add_argument("--json", action="store_true", help="emit the structured result")
    args = parser.parse_args(argv)

    try:
        request, candidates, reports = load_fixture(args.fixture)
    except NumberRejected as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2

    result = run_cascade(request, candidates, reports)
    print(json.dumps(result.to_dict(), indent=2) if args.json else render(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
