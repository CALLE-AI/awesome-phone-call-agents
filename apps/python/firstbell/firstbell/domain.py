"""The attendance-specific parts: what we ask, what we accept back, what it is worth.

Everything else in this project is domain-neutral. This module is the only place that
knows the work is about school attendance, which is deliberate: the dispatcher, the double
and the validation layer would serve any "phone a list of people and bring back a
structured answer" problem unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from dispatch import ItemResult, Resolution, WorkItem

# What a usable answer looks like. Kept small on purpose: every field here is one the
# office actually needs to close the record, and nothing is asked that a parent would not
# reasonably answer on a thirty-second call.
RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["reason_category", "expected_return"],
    "properties": {
        "reason_category": {
            "type": "string",
            "enum": ["illness", "medical_appointment", "family_emergency",
                     "religious_observance", "transport", "other", "unknown"],
        },
        "expected_return": {
            "type": "string",
            "enum": ["today", "tomorrow", "later_this_week", "longer", "unknown"],
        },
        "parent_confirmed_aware": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
        },
        "free_text_note": {"type": "string"},
    },
}

# Spoken first, before anything is asked. Several jurisdictions require disclosure that a
# caller is an AI system, and a school would need it in writing before it let this near a
# parent regardless. It is a constant rather than a template because it is not something a
# deployment should be able to reword or omit.
AI_DISCLOSURE = (
    "This is an automated call from the school attendance office. "
    "You are speaking with an AI assistant, not a person. "
    "You can ask to speak to a member of staff at any time and I will arrange a callback."
)


@dataclass(frozen=True)
class FundingRate:
    """Per-student, per-day funding attached to attendance.

    This carries its source with it, and there is no default. A money figure asserted
    without a citation is worth less than no money figure at all, because the first thing
    a reader does with a number is ask where it came from.
    """

    amount: float
    currency: str
    jurisdiction: str
    source: str
    source_url: str
    year: int

    def __post_init__(self) -> None:
        if self.amount <= 0:
            raise ValueError("A funding rate must be positive.")
        for field_name in ("source", "source_url", "jurisdiction"):
            if not getattr(self, field_name).strip():
                raise ValueError(
                    f"FundingRate.{field_name} is required. A rate without a source is "
                    "not usable in a judge-facing claim."
                )

    def cite(self) -> str:
        return (f"{self.currency}{self.amount:,.2f} per student per day, "
                f"{self.jurisdiction}, {self.year}. Source: {self.source} {self.source_url}")


def build_task(item: WorkItem) -> str:
    """The instruction CALL-E carries into the conversation.

    The disclosure goes first and is not negotiable. The rest is deliberately narrow: ask
    the reason, ask when the student returns, and stop. An agent given a broad remit on a
    call about somebody's child is a liability, not a feature.
    """
    student = item.context.get("student_name", "the student")
    school = item.context.get("school_name", "the school")
    absence_date = item.context.get("absence_date", "today")

    return (
        f"{AI_DISCLOSURE}\n\n"
        f"You are calling on behalf of {school} about {student}, "
        f"who was marked absent on {absence_date} and whose absence has not yet been "
        f"explained.\n\n"
        "Ask, politely and briefly: the reason for the absence, and when you should "
        "expect the student back. Confirm the person you are speaking to is aware the "
        "student is absent.\n\n"
        "Do not give advice. Do not discuss anything except this absence. If the person "
        "is distressed, asks to speak to a human, disputes that the student is absent, or "
        "says anything that suggests the student may be at risk, stop asking questions, "
        "say a member of staff will call back today, and end the call politely."
    )


@dataclass
class ImpactSummary:
    """What the run was worth, computed from the run's own output rather than asserted."""

    contacted: int
    resolved: int
    undetermined: int
    failed: int
    skipped_no_consent: int
    calls_placed: int
    live: bool = False
    rate: FundingRate | None = None
    resolved_by_language: dict[str, int] = field(default_factory=dict)
    open_by_language: dict[str, int] = field(default_factory=dict)

    @property
    def resolution_rate(self) -> float:
        attempted = self.resolved + self.undetermined + self.failed
        return (self.resolved / attempted) if attempted else 0.0

    @property
    def non_english_resolved(self) -> int:
        return sum(n for loc, n in self.resolved_by_language.items()
                   if not loc.lower().startswith("en"))

    @property
    def languages_covered(self) -> list[str]:
        return sorted({loc for loc in self.resolved_by_language if loc})

    @property
    def funding_recovered(self) -> float | None:
        """Only the absences that came back with a usable reason count.

        An undetermined or failed call recovers nothing: the record is still open and a
        human still has to work it. Counting those would be the kind of arithmetic that
        makes a number impressive and false.
        """
        return None if self.rate is None else self.resolved * self.rate.amount

    def lines(self) -> list[str]:
        out = [
            f"  attempted            {self.resolved + self.undetermined + self.failed}",
            f"  resolved             {self.resolved}   schema-valid reason on record",
            f"  undetermined         {self.undetermined}   call happened, no usable answer, needs a person",
            f"  failed               {self.failed}   nobody reached on any number",
            f"  skipped, no consent  {self.skipped_no_consent}",
            f"  calls placed         {self.calls_placed}{'' if self.live else '   (no telephone call was placed)'}",
            f"  resolution rate      {self.resolution_rate:.0%}",
        ]

        # The headline this project is entitled to claim. It needs no external source,
        # because it is counted from what this run actually did. The legal duty it speaks
        # to is Title VI: a district must reach a family in a language that family
        # understands, and must provide free oral interpretation where translating is not
        # practicable. No money figure is claimed, because explaining an absence does not
        # make a student present and recovers no attendance funding.
        if self.resolved_by_language:
            out += ["", "  reached in-language"]
            for locale in sorted(self.resolved_by_language):
                label = locale or "unspecified"
                out.append(f"    {label:<18s} {self.resolved_by_language[locale]}")
            out.append(
                f"  non-English families {self.non_english_resolved} of {self.resolved} resolved"
            )
        if self.open_by_language:
            out += ["", "  still open, by language"]
            for locale in sorted(self.open_by_language):
                label = locale or "unspecified"
                out.append(f"    {label:<18s} {self.open_by_language[locale]}   needs a person")
        recovered = self.funding_recovered
        if recovered is None:
            out += [
                "",
                "  funding recovered    not claimed",
                "                       Explaining an absence does not make a student",
                "                       present, so no attendance funding is recovered by",
                "                       this call. Only 5 US states fund on daily",
                "                       attendance at all. Pass --funding-rate with a",
                "                       source if your jurisdiction is one of them.",
            ]
        else:
            assert self.rate is not None
            out += [
                "",
                f"  funding recovered    {self.rate.currency}{recovered:,.2f}",
                f"                       {self.resolved} resolved x {self.rate.currency}{self.rate.amount:,.2f}",
                f"                       {self.rate.cite()}",
            ]
        return out


def summarise(results: list[ItemResult], *, calls_placed: int, live: bool = False,
              rate: FundingRate | None = None) -> ImpactSummary:
    counts = {r: 0 for r in Resolution}
    resolved_by_language: dict[str, int] = {}
    open_by_language: dict[str, int] = {}
    for result in results:
        counts[result.resolution] += 1
        locale = result.item.locale or ""
        if result.resolution is Resolution.RESOLVED:
            resolved_by_language[locale] = resolved_by_language.get(locale, 0) + 1
        elif result.resolution.needs_a_human:
            open_by_language[locale] = open_by_language.get(locale, 0) + 1
    return ImpactSummary(
        contacted=counts[Resolution.RESOLVED] + counts[Resolution.UNDETERMINED],
        resolved=counts[Resolution.RESOLVED],
        undetermined=counts[Resolution.UNDETERMINED],
        failed=counts[Resolution.FAILED],
        skipped_no_consent=counts[Resolution.SKIPPED],
        calls_placed=calls_placed,
        live=live,
        rate=rate,
        resolved_by_language=resolved_by_language,
        open_by_language=open_by_language,
    )
