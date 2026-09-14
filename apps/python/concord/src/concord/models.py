"""Data model.

Two rules are enforced here rather than left to convention:

1. An `Answer` carries only what the branch said. It has no verdict field, so a
   collector physically cannot record a ruling.
2. A `Finding` carries a verdict and must quote the answer it rules on. It has
   no phone number and no staff name, so a report cannot identify a person.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Literal

E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")

QUOTE_MAX = 240

# A quote is the one free-text field Concord carries, so it is the one place a
# person could enter the record: someone who answers "This is Sarah, no you
# don't need a prescription" has put their name in the report. The call task
# asks the agent not to record names, but a prompt is a request, not a
# guarantee. These patterns are the second line, applied when the answer is
# parsed so no caller can skip them. They are best effort on natural speech,
# not a proof, and the docs say so.
SELF_ID = re.compile(
    r"""(?ix)
    \b(?:
        (?:this\s+is|it'?s|my\s+name\s+is|you'?re\s+(?:speaking\s+)?(?:to|with))
        \s+[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?
      | [A-Z][a-z'-]+\s+speaking
    )\b[,.\s]*""",
)


def redact_quote(text: str) -> str:
    """Remove self-identification from a spoken quote and cap its length.

    Concord reports on branches. A name that arrives inside a quote would defeat
    that, so it is stripped here rather than at render time, where a new caller
    could forget to apply it.
    """
    cleaned = SELF_ID.sub("", text).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    if len(cleaned) > QUOTE_MAX:
        cleaned = cleaned[:QUOTE_MAX].rsplit(" ", 1)[0] + " [...]"
    return cleaned

Verdict = Literal["COMPLIANT", "DEVIATION", "UNCLEAR"]
VERDICTS: tuple[str, ...] = ("COMPLIANT", "DEVIATION", "UNCLEAR")


class ConcordError(ValueError):
    pass


@dataclass(frozen=True)
class Criterion:
    """One policy expectation, written by a human, in the policy's own words.

    `field` names the value the call is asked to extract, and `expect` is the
    answer policy requires. Judging compares those values, never the free text.

    An earlier version matched phrases against the transcript and reported
    "No, you don't need a prescription" as a deviation because the string "need
    a prescription" occurs inside it. Keyword matching cannot read negation, and
    in an audit of your own staff a false deviation is worse than a missed one:
    it sends a manager to correct a branch that answered correctly.
    """

    id: str
    question: str
    policy: str
    field: str
    expect: str
    options: tuple[str, ...] = ()

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Criterion":
        for key in ("id", "question", "policy", "field", "expect"):
            if not str(raw.get(key, "")).strip():
                raise ConcordError(f"Criterion is missing '{key}'.")
        options = tuple(str(o) for o in raw.get("options", ()))
        expect = str(raw["expect"]).strip()
        if options and expect not in options:
            raise ConcordError(
                f"Criterion {raw['id']!r} expects {expect!r}, which is not one of its options."
            )
        return cls(
            id=str(raw["id"]).strip(),
            question=str(raw["question"]).strip(),
            policy=str(raw["policy"]).strip(),
            field=str(raw["field"]).strip(),
            expect=expect,
            options=options,
        )


@dataclass(frozen=True)
class Rubric:
    """The written policy an answer is judged against, loaded separately from any call."""

    id: str
    title: str
    scenario: str
    criteria: tuple[Criterion, ...]

    @classmethod
    def load(cls, path: str) -> "Rubric":
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        criteria = tuple(Criterion.parse(c) for c in raw.get("criteria", ()))
        if not criteria:
            raise ConcordError("A rubric needs at least one criterion.")
        ids = [c.id for c in criteria]
        if len(set(ids)) != len(ids):
            raise ConcordError("Criterion ids must be unique within a rubric.")
        return cls(
            id=str(raw["id"]),
            title=str(raw["title"]),
            scenario=str(raw["scenario"]).strip(),
            criteria=criteria,
        )


@dataclass(frozen=True)
class Branch:
    """A location the operator owns and is authorised to audit."""

    id: str
    name: str
    phone: str
    authorization: str

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Branch":
        phone = str(raw.get("phone", "")).strip()
        if not E164.match(phone):
            raise ConcordError(f"Branch phone must be E.164, got {phone!r}.")
        if not str(raw.get("authorization", "")).strip():
            raise ConcordError(
                f"Branch {raw.get('id')!r} has no authorization reference. "
                "Concord only calls lines the operator has confirmed it owns."
            )
        return cls(
            id=str(raw["id"]).strip(),
            name=str(raw["name"]).strip(),
            phone=phone,
            authorization=str(raw["authorization"]).strip(),
        )

    @property
    def masked_phone(self) -> str:
        return f"{self.phone[:3]}{'*' * (len(self.phone) - 5)}{self.phone[-2:]}"


@dataclass(frozen=True)
class Answer:
    """What one branch said.

    `value` is the field the call extracted. `quote` is the spoken evidence for
    it. Carries no verdict, by construction, so a collector cannot rule.
    """

    branch_id: str
    criterion_id: str
    value: str
    quote: str
    reached: bool = True

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Answer":
        return cls(
            branch_id=str(raw["branch_id"]),
            criterion_id=str(raw["criterion_id"]),
            value=str(raw.get("value", "")).strip(),
            quote=redact_quote(str(raw.get("quote", ""))),
            reached=bool(raw.get("reached", True)),
        )


@dataclass(frozen=True)
class Finding:
    """A ruling on one answer. Carries no phone number and no person."""

    branch_id: str
    criterion_id: str
    verdict: Verdict
    rationale: str
    quote: str
    needs_human_review: bool = False

    def __post_init__(self) -> None:
        if self.verdict not in VERDICTS:
            raise ConcordError(f"Unknown verdict {self.verdict!r}.")
        if not self.quote and self.verdict != "UNCLEAR":
            raise ConcordError(
                "A COMPLIANT or DEVIATION finding must quote the words it rules on."
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Audit:
    """One authorised audit run."""

    id: str
    org: str
    rubric_id: str
    branches: tuple[Branch, ...]
    timezone: str
    call_window: tuple[str, str]
    requested_by: str

    @classmethod
    def load(cls, path: str) -> "Audit":
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        branches = tuple(Branch.parse(b) for b in raw.get("branches", ()))
        if not branches:
            raise ConcordError("An audit needs at least one branch.")
        if len(branches) > 12:
            raise ConcordError("Concord audits at most 12 branches in one run.")
        window = raw.get("call_window", {})
        return cls(
            id=str(raw["id"]),
            org=str(raw["org"]),
            rubric_id=str(raw["rubric_id"]),
            branches=branches,
            timezone=str(window.get("timezone", "UTC")),
            call_window=(str(window.get("start", "09:00")), str(window.get("end", "17:00"))),
            requested_by=str(raw.get("requested_by", "")),
        )
