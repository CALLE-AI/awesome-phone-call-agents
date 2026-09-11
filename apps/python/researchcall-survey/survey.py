"""Run a standardised telephone survey -- and report it honestly afterwards.

A survey that dials is easy. A survey whose numbers survive scrutiny is not, and
almost every way of getting it wrong flatters the result:

* Reporting completions against *reached* people instead of against everyone drawn
  hides the non-response. A study that reached 12 of 200 and completed 10 does not
  have an 83 percent yield.
* Storing a coded category without the words it came from makes the coding
  unfalsifiable. Nobody can later check whether "rather dissatisfied" was a fair
  reading of what was said.
* Treating withdrawal as a flag rather than a deletion leaves the person in the
  data they asked to leave.
* Asking for consent before the call has said it is automated puts the decision in
  the wrong order: a person cannot meaningfully consent to being interviewed by a
  machine if nobody told them a machine was on the line.

So four things are structural here rather than configurable:

    disclosure   the call states that it is automated before it asks anything
                 else, including for consent
    consent      no question is asked before explicit consent is recorded
    withdrawal   removes the identifier and the number, and drops the record out
                 of every later denominator
    yield        completed / included drawn -- never completed / reached

The ethics rules are locked. A study file may add to them, but the load path
refuses to overwrite them: a survey whose consent requirement can be switched off
in configuration does not have a consent requirement.

This is the collection edition: fixture-driven, no network, no telephone, no
credentials, no scheduler. The full application lives at
https://github.com/ellmos-ai/researchcall, field-tested live against the
real CALL-E service on 2026-08-11 and 2026-08-22 -- see its README's "How We
Tested" section.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Sequence

# --------------------------------------------------------------------------------------
# Locked ethics
# --------------------------------------------------------------------------------------

# ``ai_disclosure_before_consent`` comes first in this dict on purpose, and not
# only because ``merge_ethics`` treats every locked rule the same afterwards: an
# automated caller has to say what it is before it asks for anything, consent
# included. Consent obtained from someone who was never told they were talking to
# a machine is not informed consent -- it is a question asked in the wrong order.
# Like every other entry here, a study file may add rules of its own but cannot
# redefine this one; a survey whose disclosure can be switched off in
# configuration does not have a disclosure requirement.
LOCKED_ETHICS: dict[str, str] = {
    "ai_disclosure_before_consent": (
        "The call states, before anything else and before it asks for consent, "
        "that an automated assistant is calling."
    ),
    "explicit_consent_before_questions": (
        "No question is asked before the person has consented in this call."
    ),
    "right_to_stop_immediately": (
        "The interview ends the moment the person asks, without a further question."
    ),
    "right_to_withdraw_afterwards": (
        "A withdrawal removes the identifier and the number, and the record leaves "
        "every later denominator."
    ),
    "no_high_risk_topics": (
        "Medical, legal, financial and emergency topics are refused, not handled -- "
        "checked for the study subject and for every single question."
    ),
}

HIGH_RISK = (
    "medical", "diagnosis", "medication", "therapy", "symptom",
    "legal", "lawsuit", "court", "attorney",
    "financial", "investment", "loan", "debt", "credit",
    "emergency", "suicide", "crisis",
)


class EthicsViolation(RuntimeError):
    """Raised when a study tries to weaken a locked rule, or asks a locked question."""


def check_topic(text: str, what: str = "subject") -> None:
    """Refuse high-risk subjects and questions rather than handling them carefully.

    The study subject is checked at load time. Every single question is checked
    again when it is constructed, because a benign subject is no guarantee: a
    transport survey can still smuggle in a medication question, and the person
    on the phone answers the question, not the subject line.
    """
    lowered = text.lower()
    for word in HIGH_RISK:
        if re.search(rf"\b{re.escape(word)}", lowered):
            raise EthicsViolation(
                f"{what} touches a high-risk area ('{word}'); this instrument refuses it"
            )


def merge_ethics(extra: dict[str, str] | None) -> dict[str, str]:
    """Additional rules are welcome. Overwriting a locked one is not."""
    merged = dict(LOCKED_ETHICS)
    for key, value in (extra or {}).items():
        if key in LOCKED_ETHICS:
            raise EthicsViolation(f"'{key}' is locked and cannot be redefined by a study")
        merged[key] = value
    return merged


# --------------------------------------------------------------------------------------
# Phone numbers
# --------------------------------------------------------------------------------------

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class NumberRejected(ValueError):
    """Raised before any processing when a number is not valid E.164."""


def validate_number(raw: str) -> str:
    number = (raw or "").strip()
    if not E164.match(number):
        raise NumberRejected(f"not a valid E.164 number: {mask(number) or '<empty>'}")
    return number


def mask(number: str) -> str:
    if not number:
        return ""
    keep_tail = 2
    if len(number) <= keep_tail + 3:
        return "*" * len(number)
    return f"{number[:3]}{'*' * (len(number) - 3 - keep_tail)}{number[-keep_tail:]}"


# --------------------------------------------------------------------------------------
# Sampling
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Entry:
    """One line of the frame -- a public directory listing, in the example."""

    id: str
    phone: str
    stratum: str = ""

    def __post_init__(self) -> None:
        validate_number(self.phone)


@dataclass(frozen=True)
class Drawn:
    """One drawn person and the time window assigned to them."""

    entry: Entry
    window: str


WINDOWS = ("Mon-Fri 09-12", "Mon-Fri 12-15", "Mon-Fri 15-18", "Mon-Fri 18-20", "Sat 10-14")


def draw_sample(frame: Sequence[Entry], size: int, seed: int) -> list[Drawn]:
    """Draw reproducibly and assign a contact window to each person.

    The seed is the whole point: a sample that cannot be redrawn cannot be checked
    by anyone else. Same frame, same size, same seed -- same people, same windows.
    Spreading the windows matters too, because calling everyone at eleven in the
    morning samples the people who are home at eleven in the morning.
    """
    if size > len(frame):
        raise ValueError(f"cannot draw {size} from a frame of {len(frame)}")
    rng = random.Random(seed)
    chosen = rng.sample(list(frame), size)
    return [Drawn(entry=entry, window=rng.choice(WINDOWS)) for entry in chosen]


# --------------------------------------------------------------------------------------
# Fieldwork
# --------------------------------------------------------------------------------------


class Disposition(str, Enum):
    COMPLETED = "completed"
    CONSENT_REFUSED = "consent_refused"
    BROKE_OFF = "broke_off"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    # A mailbox pickup is not a person declining and not a person absent for a
    # different, unknown reason -- it is its own outcome, and collapsing it into
    # either loses exactly the distinction ``Report.reached`` exists to keep. It
    # is therefore treated like ``NO_ANSWER``/``BUSY`` below: nobody was reached.
    VOICEMAIL = "voicemail"
    INELIGIBLE = "ineligible"
    NOT_ATTEMPTED = "not_attempted"


@dataclass
class Response:
    """One answer: what was said, and how it was coded. Never one without the other."""

    question: str
    raw: str
    category: str | None = None

    def __post_init__(self) -> None:
        check_topic(self.question, what="question")
        if self.category is not None and not self.raw.strip():
            raise EthicsViolation(
                f"question '{self.question}': a category without the words it came from "
                f"cannot be checked by anyone"
            )


@dataclass
class Interview:
    person_id: str
    disposition: Disposition
    consent_given: bool = False
    responses: list[Response] = field(default_factory=list)
    note: str = ""

    def __post_init__(self) -> None:
        if self.responses and not self.consent_given:
            raise EthicsViolation(
                f"{self.person_id}: {len(self.responses)} answers recorded without consent"
            )
        if self.disposition is Disposition.BROKE_OFF and self.responses:
            # Someone who ended the call did not finish answering, and half an
            # answer is not data. Partial answers after stopping are deleted,
            # not stored and not emitted.
            self.responses = []


@dataclass
class Record:
    """A drawn person plus what became of them. Withdrawal deletes it in place."""

    drawn: Drawn | None
    interview: Interview | None = None
    withdrawn: bool = False

    @property
    def person_id(self) -> str:
        return "<withdrawn>" if self.withdrawn or self.drawn is None else self.drawn.entry.id

    @property
    def phone_masked(self) -> str:
        return "" if self.withdrawn or self.drawn is None else mask(self.drawn.entry.phone)

    @property
    def disposition(self) -> Disposition:
        if self.interview is None:
            return Disposition.NOT_ATTEMPTED
        return self.interview.disposition


def withdraw(record: Record) -> Record:
    """Honour a withdrawal: delete the identifier, the number and the answers.

    Not a flag on a row whose data stays. The drawn entry -- id and phone -- and
    the whole interview -- person id, answers, note -- are deleted from the
    record itself, not merely hidden from the output. What remains is the bare
    fact that a withdrawal happened, so `withdrawn` can be counted and
    `included_drawn` below stops counting them, which is what keeps the
    denominator honest rather than merely smaller.
    """
    record.withdrawn = True
    record.drawn = None  # id and phone leave memory, not merely the report
    record.interview = None  # person id, note and any answers leave with them
    return record


# --------------------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------------------


@dataclass
class Report:
    study: str
    seed: int
    drawn: int
    withdrawn: int
    dispositions: dict[str, int]
    by_window: dict[str, dict[str, int]]

    @property
    def included_drawn(self) -> int:
        """Everyone drawn, minus those who withdrew. The one honest denominator."""
        return self.drawn - self.withdrawn

    @property
    def completed(self) -> int:
        return self.dispositions.get(Disposition.COMPLETED.value, 0)

    @property
    def reached(self) -> int:
        """Anyone who picked up -- including those who refused or broke off."""
        return sum(
            self.dispositions.get(d.value, 0)
            for d in (
                Disposition.COMPLETED,
                Disposition.CONSENT_REFUSED,
                Disposition.BROKE_OFF,
                Disposition.INELIGIBLE,
            )
        )

    @property
    def completion_yield(self) -> float:
        """completed / included drawn. Never completed / reached."""
        if self.included_drawn == 0:
            return 0.0
        return self.completed / self.included_drawn

    @property
    def flattering_yield(self) -> float:
        """What the number would look like against reached -- shown for contrast only.

        It is printed beside the real one, labelled as not the result, because the
        gap between the two is the non-response nobody should have to compute
        themselves.
        """
        if self.reached == 0:
            return 0.0
        return self.completed / self.reached

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": "fixture / simulated / no-call",
            "study": self.study,
            "seed": self.seed,
            "drawn": self.drawn,
            "withdrawn": self.withdrawn,
            "included_drawn": self.included_drawn,
            "completed": self.completed,
            "completion_yield": round(self.completion_yield, 4),
            "completion_yield_basis": "completed / included drawn",
            "not_the_result_yield_against_reached": round(self.flattering_yield, 4),
            "dispositions": dict(sorted(self.dispositions.items())),
            "non_response_by_window": self.by_window,
        }


def build_report(study: str, seed: int, records: Sequence[Record]) -> Report:
    dispositions: dict[str, int] = {}
    by_window: dict[str, dict[str, int]] = {}
    withdrawn = 0

    for record in records:
        if record.withdrawn or record.drawn is None:
            withdrawn += 1
            continue  # out of every denominator, and its data already deleted
        name = record.disposition.value
        dispositions[name] = dispositions.get(name, 0) + 1
        window = by_window.setdefault(record.drawn.window, {})
        window[name] = window.get(name, 0) + 1

    return Report(
        study=study,
        seed=seed,
        drawn=len(records),
        withdrawn=withdrawn,
        dispositions=dispositions,
        by_window=by_window,
    )


def collect_answers(records: Sequence[Record]) -> list[dict[str, Any]]:
    """Every coded answer with the words it was coded from, side by side."""
    rows: list[dict[str, Any]] = []
    for record in records:
        if record.withdrawn or record.interview is None:
            continue
        for response in record.interview.responses:
            rows.append(
                {
                    "person": record.person_id,
                    "question": response.question,
                    "raw": response.raw,
                    "category": response.category,
                }
            )
    return rows


# --------------------------------------------------------------------------------------
# Fixtures and CLI
# --------------------------------------------------------------------------------------


def load_study(path: pathlib.Path) -> tuple[str, int, int, dict[str, str], list[Entry], dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    check_topic(data["subject"])
    ethics = merge_ethics(data.get("additional_ethics"))
    frame = [
        Entry(id=e["id"], phone=e["phone"], stratum=e.get("stratum", ""))
        for e in data["frame"]
    ]
    return (
        data["subject"],
        int(data["seed"]),
        int(data["sample_size"]),
        ethics,
        frame,
        data.get("fieldwork", {}),
    )


def run_fieldwork(sample: Sequence[Drawn], fieldwork: dict) -> list[Record]:
    """Turn fixture outcomes into records. One attempt per person, no retries."""
    records: list[Record] = []
    seen: set[str] = set()

    for drawn in sample:
        person_id = drawn.entry.id
        if person_id in seen:
            raise RuntimeError(f"{person_id} drawn twice; a person is contacted once")
        seen.add(person_id)

        outcome = fieldwork.get(person_id)
        if outcome is None:
            records.append(Record(drawn=drawn))
            continue

        responses = [
            Response(
                question=r["question"], raw=r.get("raw", ""), category=r.get("category")
            )
            for r in outcome.get("responses", [])
        ]
        interview = Interview(
            person_id=person_id,
            disposition=Disposition(outcome["disposition"]),
            consent_given=bool(outcome.get("consent_given", False)),
            responses=responses,
            note=outcome.get("note", ""),
        )
        record = Record(drawn=drawn, interview=interview)
        if outcome.get("withdrew"):
            withdraw(record)
        records.append(record)

    return records


def render(report: Report, answers: list[dict[str, Any]], ethics: dict[str, str]) -> str:
    lines = [
        "FIXTURE RUN -- SIMULATED, NO CALL PLACED",
        "No network, no telephone, no credentials. Outcomes come from the study file.",
        "",
        f"Study: {report.study}",
        f"Seed:  {report.seed}  (same seed, same sample, same windows)",
        "",
        "Locked ethics rules in force:",
    ]
    lines.extend(f"  - {text}" for text in ethics.values())
    lines.extend(
        [
            "",
            f"Drawn:          {report.drawn}",
            f"Withdrew:       {report.withdrawn}  (removed from the data and every denominator)",
            f"Included drawn: {report.included_drawn}",
            f"Completed:      {report.completed}",
            "",
            f"Completion yield: {report.completion_yield:.1%}  "
            f"({report.completed} of {report.included_drawn} included drawn)",
            f"  For contrast, not the result: {report.flattering_yield:.1%} against the "
            f"{report.reached} who picked up.",
            "",
            "Dispositions:",
        ]
    )
    for name, count in sorted(report.dispositions.items()):
        lines.append(f"  {name}: {count}")
    lines.append("")
    lines.append("Non-response by contact window:")
    for window, counts in sorted(report.by_window.items()):
        detail = ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
        lines.append(f"  {window}: {detail}")
    if answers:
        lines.append("")
        lines.append("Answers, coded category beside the words it came from:")
        for row in answers:
            lines.append(f"  [{row['person']}] {row['question']}")
            lines.append(f"      said:  \"{row['raw']}\"")
            lines.append(f"      coded: {row['category']}")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Standardised telephone survey over a fixture. Never places a call."
    )
    parser.add_argument("--fixture", required=True, type=pathlib.Path)
    parser.add_argument("--json", action="store_true", help="emit the structured result")
    args = parser.parse_args(argv)

    try:
        subject, seed, size, ethics, frame, fieldwork = load_study(args.fixture)
        sample = draw_sample(frame, size, seed)
        records = run_fieldwork(sample, fieldwork)
    except (EthicsViolation, NumberRejected, ValueError) as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2

    report = build_report(subject, seed, records)
    answers = collect_answers(records)

    if args.json:
        payload = report.to_dict()
        payload["ethics"] = ethics
        payload["answers"] = answers
        print(json.dumps(payload, indent=2))
    else:
        print(render(report, answers, ethics))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
