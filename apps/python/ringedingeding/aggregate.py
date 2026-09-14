"""Aggregate what several people said on the phone -- without inventing a majority.

Calling twenty people is the easy part. The hard part is the sentence afterwards:
"eleven of them prefer Tuesday." Eleven of how many? Of those who answered, or of
those who were invited? If four never picked up, do they count as indifferent?

They do not. This module keeps the groups apart and names the denominator every
time:

    answered    said something
    refused     picked up and declined to take part
    unreached   nobody answered, or the line was busy
    pending     not called yet
    unknown     the call ended in a state nobody can interpret

Three rules follow from that, and they are what the tests defend:

* Every share is reported against those who **answered**, never against those who
  were invited -- and the report says so in words.
* Silence about one option is **unknown**, not a no. Someone who answered but said
  nothing about Thursday has not ruled Thursday out.
* A tie stays a tie. There is no tie-break, because the caller was not asked to
  decide anything.

This is the collection edition: fixture-driven, no network, no telephone, no
credentials, no scheduler. The full application lives at
https://github.com/ellmos-ai/ringedingeding, field-tested live against the
real CALL-E service on 2026-08-11 and 2026-08-22 -- see its README's "How We
Tested" section.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Sequence

# --------------------------------------------------------------------------------------
# Phone numbers
# --------------------------------------------------------------------------------------

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class NumberRejected(ValueError):
    """Raised before any processing when a participant number is not valid E.164."""


def validate_number(raw: str) -> str:
    number = (raw or "").strip()
    if not E164.match(number):
        raise NumberRejected(f"not a valid E.164 number: {mask(number) or '<empty>'}")
    return number


def mask(number: str) -> str:
    """Country prefix and last two digits. Everything else is hidden, everywhere."""
    if not number:
        return ""
    keep_tail = 2
    if len(number) <= keep_tail + 3:
        return "*" * len(number)
    return f"{number[:3]}{'*' * (len(number) - 3 - keep_tail)}{number[-keep_tail:]}"


# --------------------------------------------------------------------------------------
# Who is where
# --------------------------------------------------------------------------------------


class Bucket(str, Enum):
    ANSWERED = "answered"
    REFUSED = "refused"
    UNREACHED = "unreached"
    PENDING = "pending"
    UNKNOWN = "unknown"


class Status(str, Enum):
    """Call statuses stay distinct. NO_ANSWER, BUSY and DECLINED are not the same thing."""

    COMPLETED = "completed"
    DECLINED = "declined"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    # An answering machine is not "nobody answered" and not "the person declined" --
    # it is its own outcome. Folding it into either would misreport a common,
    # innocuous case as its neighbour. Set by the fixture author when the call
    # reached a mailbox rather than a person.
    VOICEMAIL = "voicemail"
    # Set when the call reached someone, but confirming it was the invited person
    # failed -- a different person answered and no handover happened. Bucketed as
    # UNREACHED, not REFUSED: a stranger's answer, whatever it was, is not this
    # participant's answer. Collapsing it into REFUSED is exactly the
    # misattribution this aggregator exists to keep out of a merged result.
    WRONG_PERSON = "wrong_person"
    NOT_CALLED = "not_called"
    UNKNOWN = "unknown"

    @property
    def bucket(self) -> Bucket:
        return {
            Status.COMPLETED: Bucket.ANSWERED,
            Status.DECLINED: Bucket.REFUSED,
            Status.NO_ANSWER: Bucket.UNREACHED,
            Status.BUSY: Bucket.UNREACHED,
            Status.VOICEMAIL: Bucket.UNREACHED,
            Status.WRONG_PERSON: Bucket.UNREACHED,
            Status.NOT_CALLED: Bucket.PENDING,
            Status.UNKNOWN: Bucket.UNKNOWN,
        }[self]


@dataclass(frozen=True)
class Participant:
    id: str
    name: str
    phone: str

    def __post_init__(self) -> None:
        validate_number(self.phone)

    @property
    def phone_masked(self) -> str:
        return mask(self.phone)


class Stance(str, Enum):
    """Where one person stands on one option."""

    WORKS = "works"
    CANNOT = "cannot"
    SILENT = "silent"  # answered the call, said nothing about this option


@dataclass(frozen=True)
class Answer:
    """One person's response, raw text and interpretation side by side.

    `raw` is what was said. `stances`, `choice` and `conditions` are readings of it.
    The raw line travels with the result so a reader can check the interpretation
    instead of trusting it.
    """

    participant_id: str
    status: Status
    raw: str = ""
    stances: dict[str, Stance] = field(default_factory=dict)
    choice: str | None = None
    abstained: bool = False
    conditions: tuple[str, ...] = ()
    reason: str = ""

    @property
    def bucket(self) -> Bucket:
        return self.status.bucket


# --------------------------------------------------------------------------------------
# Coverage: who is behind the numbers, and who is not
# --------------------------------------------------------------------------------------


@dataclass
class Coverage:
    invited: list[Participant]
    by_bucket: dict[Bucket, list[Participant]]

    @property
    def answered(self) -> list[Participant]:
        return self.by_bucket[Bucket.ANSWERED]

    @property
    def basis(self) -> str:
        """The denominator, spelled out. This string goes into every report."""
        return f"{len(self.answered)} answered / {len(self.invited)} invited"

    @property
    def is_complete(self) -> bool:
        return len(self.answered) == len(self.invited)

    @property
    def caveat(self) -> str | None:
        """The sentence that must appear beside any incomplete result."""
        if self.is_complete:
            return None
        missing = {
            bucket.value: len(people)
            for bucket, people in self.by_bucket.items()
            if bucket is not Bucket.ANSWERED and people
        }
        parts = ", ".join(f"{count} {name}" for name, count in sorted(missing.items()))
        return (
            f"Incomplete: {parts}. These people are not in the figures below and are "
            f"not counted as indifferent."
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "basis": self.basis,
            "complete": self.is_complete,
            "caveat": self.caveat,
            "buckets": {
                bucket.value: [
                    {"name": p.name, "phone": p.phone_masked} for p in people
                ]
                for bucket, people in self.by_bucket.items()
            },
        }


def classify(participants: Sequence[Participant], answers: dict[str, Answer]) -> Coverage:
    buckets: dict[Bucket, list[Participant]] = {b: [] for b in Bucket}
    for person in participants:
        answer = answers.get(person.id)
        bucket = answer.bucket if answer is not None else Bucket.PENDING
        buckets[bucket].append(person)
    return Coverage(invited=list(participants), by_bucket=buckets)


# --------------------------------------------------------------------------------------
# Scheduling
# --------------------------------------------------------------------------------------


@dataclass
class SlotRow:
    slot: str
    works: list[str]
    cannot: list[str]
    silent: list[str]

    @property
    def works_for_everyone_who_answered(self) -> bool:
        """True only if nobody said no *and* nobody stayed silent.

        Silence is not agreement. A slot that half the respondents never mentioned
        is not a slot that works for them.
        """
        return not self.cannot and not self.silent and bool(self.works)

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot": self.slot,
            "works": list(self.works),
            "cannot": list(self.cannot),
            "silent_unknown": list(self.silent),
            "works_for_all_respondents": self.works_for_everyone_who_answered,
        }


def merge_schedule(
    slots: Sequence[str], participants: Sequence[Participant], answers: dict[str, Answer]
) -> tuple[Coverage, list[SlotRow]]:
    coverage = classify(participants, answers)
    by_id = {p.id: p for p in participants}

    rows: list[SlotRow] = []
    for slot in slots:
        works, cannot, silent = [], [], []
        for person in coverage.answered:
            stance = answers[person.id].stances.get(slot, Stance.SILENT)
            name = by_id[person.id].name
            {Stance.WORKS: works, Stance.CANNOT: cannot, Stance.SILENT: silent}[
                stance
            ].append(name)
        rows.append(SlotRow(slot=slot, works=works, cannot=cannot, silent=silent))
    return coverage, rows


# --------------------------------------------------------------------------------------
# Opinions
# --------------------------------------------------------------------------------------


@dataclass
class OpinionResult:
    tally: dict[str, int]
    leaders: list[str]
    abstentions: list[str]
    conditions: list[dict[str, Any]]
    reasons: list[dict[str, Any]]

    @property
    def is_tie(self) -> bool:
        return len(self.leaders) > 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "tally": dict(sorted(self.tally.items())),
            "leaders": list(self.leaders),
            "tie": self.is_tie,
            "abstentions": list(self.abstentions),
            "conditions": list(self.conditions),
            "reasons": list(self.reasons),
        }


def merge_opinions(
    participants: Sequence[Participant], answers: dict[str, Answer]
) -> tuple[Coverage, OpinionResult]:
    coverage = classify(participants, answers)
    by_id = {p.id: p for p in participants}

    tally: Counter[str] = Counter()
    abstentions: list[str] = []
    conditions: list[dict[str, Any]] = []
    reasons: list[dict[str, Any]] = []

    for person in coverage.answered:
        answer = answers[person.id]
        name = by_id[person.id].name
        if answer.abstained or answer.choice is None:
            abstentions.append(name)
        else:
            tally[answer.choice] += 1
        for condition in answer.conditions:
            conditions.append({"who": name, "condition": condition})
        if answer.reason:
            reasons.append({"who": name, "reason": answer.reason, "raw": answer.raw})

    # A tie is a result, not a problem to be solved. Every option on the highest
    # count is reported; nothing breaks the draw.
    top = max(tally.values(), default=0)
    leaders = sorted(option for option, count in tally.items() if count == top and top > 0)

    return coverage, OpinionResult(
        tally=dict(tally),
        leaders=leaders,
        abstentions=abstentions,
        conditions=conditions,
        reasons=reasons,
    )


# --------------------------------------------------------------------------------------
# Catch-up
# --------------------------------------------------------------------------------------


def pending_for_catch_up(
    participants: Sequence[Participant], answers: dict[str, Answer]
) -> list[Participant]:
    """Who a second round would call: the pending and the unreached, nobody else.

    Someone who answered is done, and someone who refused has given their answer.
    A catch-up round that calls them again is not a catch-up, it is pestering.
    """
    coverage = classify(participants, answers)
    return coverage.by_bucket[Bucket.PENDING] + coverage.by_bucket[Bucket.UNREACHED]


def apply_catch_up(
    answers: dict[str, Answer], fresh: dict[str, Answer], allowed: Sequence[Participant]
) -> dict[str, Answer]:
    """Fold new answers in without touching the ones that were already given."""
    allowed_ids = {p.id for p in allowed}
    merged = dict(answers)
    for participant_id, answer in fresh.items():
        if participant_id in allowed_ids:
            merged[participant_id] = answer
    return merged


# --------------------------------------------------------------------------------------
# Fixtures and CLI
# --------------------------------------------------------------------------------------


def load_fixture(path: pathlib.Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    kind = data["kind"]

    participants = [
        Participant(id=p["id"], name=p["name"], phone=p["phone"]) for p in data["participants"]
    ]
    answers = {
        a["participant_id"]: Answer(
            participant_id=a["participant_id"],
            status=Status(a["status"]),
            raw=a.get("raw", ""),
            stances={k: Stance(v) for k, v in a.get("stances", {}).items()},
            choice=a.get("choice"),
            abstained=bool(a.get("abstained", False)),
            conditions=tuple(a.get("conditions", [])),
            reason=a.get("reason", ""),
        )
        for a in data.get("answers", [])
    }
    return kind, data.get("question", ""), data.get("slots", []), participants, answers


def render_schedule(question: str, coverage: Coverage, rows: list[SlotRow]) -> str:
    lines = [
        "FIXTURE RUN -- SIMULATED, NO CALL PLACED",
        "No network, no telephone, no credentials. Answers come from the fixture file.",
        "",
        f"Question: {question}",
        f"Basis: {coverage.basis}",
    ]
    if coverage.caveat:
        lines.append(coverage.caveat)
    lines.append("")
    for row in rows:
        verdict = "works for all respondents" if row.works_for_everyone_who_answered else "-"
        lines.append(f"{row.slot}  [{verdict}]")
        lines.append(f"     works:  {', '.join(row.works) or '-'}")
        lines.append(f"     cannot: {', '.join(row.cannot) or '-'}")
        lines.append(f"     silent (unknown, not a no): {', '.join(row.silent) or '-'}")
    lines.append("")
    common = [r.slot for r in rows if r.works_for_everyone_who_answered]
    lines.append(
        f"Slots that work for everyone who answered: {', '.join(common) or 'none'}"
        + (" -- among respondents only." if not coverage.is_complete else "")
    )
    return "\n".join(lines)


def render_opinions(question: str, coverage: Coverage, result: OpinionResult) -> str:
    lines = [
        "FIXTURE RUN -- SIMULATED, NO CALL PLACED",
        "No network, no telephone, no credentials. Answers come from the fixture file.",
        "",
        f"Question: {question}",
        f"Basis: {coverage.basis}",
    ]
    if coverage.caveat:
        lines.append(coverage.caveat)
    lines.append("")
    for option, count in sorted(result.tally.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"  {option}: {count} of {len(coverage.answered)} who answered")
    if result.abstentions:
        lines.append(f"  abstained: {', '.join(result.abstentions)}")
    lines.append("")
    if result.is_tie:
        lines.append(f"Tie between {' and '.join(result.leaders)}. It is not broken here.")
    elif result.leaders:
        lines.append(f"Ahead: {result.leaders[0]}")
    else:
        lines.append("Nobody expressed a preference.")
    if result.conditions:
        lines.append("")
        lines.append("Conditions attached:")
        for item in result.conditions:
            lines.append(f"  - {item['who']}: {item['condition']}")
    if result.reasons:
        lines.append("")
        lines.append("Reasons given (raw alongside):")
        for item in result.reasons:
            lines.append(f"  - {item['who']}: {item['reason']}")
            lines.append(f"      raw: \"{item['raw']}\"")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate answers from several people over a fixture. Never places a call."
    )
    parser.add_argument("--fixture", required=True, type=pathlib.Path)
    parser.add_argument("--json", action="store_true", help="emit the structured result")
    args = parser.parse_args(argv)

    try:
        kind, question, slots, participants, answers = load_fixture(args.fixture)
    except NumberRejected as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2

    if kind == "schedule":
        coverage, rows = merge_schedule(slots, participants, answers)
        payload = {
            "mode": "fixture / simulated / no-call",
            "kind": kind,
            "question": question,
            "coverage": coverage.to_dict(),
            "slots": [r.to_dict() for r in rows],
        }
        text = render_schedule(question, coverage, rows)
    elif kind == "opinion":
        coverage, result = merge_opinions(participants, answers)
        payload = {
            "mode": "fixture / simulated / no-call",
            "kind": kind,
            "question": question,
            "coverage": coverage.to_dict(),
            "result": result.to_dict(),
        }
        text = render_opinions(question, coverage, result)
    else:
        print(f"unknown fixture kind: {kind}", file=sys.stderr)
        return 2

    print(json.dumps(payload, indent=2) if args.json else text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
