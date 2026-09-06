"""The attendance-specific parts: what we ask, what we accept back, what it is worth.

Everything else in this project is domain-neutral. This module is the only place that
knows the work is about school attendance, which is deliberate: the dispatcher, the double
and the validation layer would serve any "phone a list of people and bring back a
structured answer" problem unchanged.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass, field
from typing import Any

from dispatch import NO_CONSENT, Escalation, ItemResult, Resolution, WorkItem

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

def safeguarding_escalation(result: dict[str, Any]) -> Escalation:
    """Only an explicit `yes` closes an absence record without a person seeing it.

    This is the rule the rest of this app is an argument for, and until it was written the
    app did not have it. `parent_confirmed_aware` was collected on every call, printed on
    the evidence page, and read by nothing: a schema-valid answer was closed as RESOLVED
    whatever it said. So the exact case this software exists to catch, a parent learning
    from the call that a child who left for school never arrived, was filed automatically
    the moment that parent then offered any plausible reason.

    The field is not in the schema's `required` list either, so it can be absent rather
    than merely negative, and an absent field is not a reassuring one.

    Hence the shape of the test. Not "is it `no`", which would close both the missing and
    the `unknown` case, but "is it `yes`". A record is closed on a confirmation, and
    nothing else is a confirmation. That is the same standard the call itself is held to:
    the agent triages, and a person closes anything that is not unambiguously benign.

    The cost of this rule is a longer human queue, and that cost is the point. It is
    stated in the run summary and in `README.md` rather than tuned away.
    """
    confirmed = str(result.get("parent_confirmed_aware", "")).strip().lower()
    if confirmed == "yes":
        return Escalation.NONE
    return Escalation.SAFEGUARDING


# The window a district would have to agree to before this ran against real families. It
# is stated here rather than left to a deployment, because an escalation with no clock is
# a label, and this one names the case where a child's whereabouts are unaccounted for.
SAFEGUARDING_CALLBACK_MINUTES = 30


# Spoken first, before anything is asked. Several jurisdictions require disclosure that a
# caller is an AI system, and a school would need it in writing before it let this near a
# parent regardless. It is a constant rather than a template because it is not something a
# deployment should be able to reword or omit.
AI_DISCLOSURE = (
    "This is an automated call from the school attendance office. "
    "You are speaking with an AI assistant, not a person. "
    "You can ask to speak to a member of staff at any time and I will arrange a callback."
)


def _cited(text: str, *, indent: int) -> list[str]:
    """A citation nobody can read is decoration, so it wraps to the block's width.

    The URL is held back and printed whole on its own line, however long that line ends
    up. Wrapping a URL breaks the one part of a citation a reader might actually act on,
    and a reader who cannot open the source is being shown a number, not a source.
    """
    pad = " " * indent
    head, sep, url = text.partition("http")
    out = [pad + line for line in
           textwrap.wrap(head.strip(), width=96 - indent, break_on_hyphens=False)]
    if sep:
        out.append(pad + sep + url.strip())
    return out


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

@dataclass(frozen=True)
class StaffCost:
    """What an hour of the office's time costs, for the labour a run takes off the desk.

    Unlike `FundingRate` this has a named default, because the wage of a school office is
    a national statistic rather than a property of one district. The default is allowed
    only because it carries its own citation and prints it beside every number derived
    from it.
    """

    annual: float
    currency: str
    hours_per_year: int
    occupation: str
    industry: str
    source: str
    source_url: str
    year: int

    def __post_init__(self) -> None:
        if self.annual <= 0:
            raise ValueError("A staff cost must be positive.")
        if self.hours_per_year <= 0:
            raise ValueError("Hours per year must be positive.")
        for field_name in ("source", "occupation", "industry"):
            if not getattr(self, field_name).strip():
                raise ValueError(
                    f"StaffCost.{field_name} is required. A wage without a source is not "
                    "usable in a judge-facing claim."
                )

    @classmethod
    def us_school_office(cls) -> "StaffCost":
        """The median US school-office wage, and two reasons it understates the saving.

        2,080 hours is a full working year, so it reads a ten-month school contract as
        cheaper per hour than it really is. The figure is salary, so it excludes the
        benefits an employer pays on top. Both errors point the same way: they make the
        desk look cheaper and this app look worse.
        """
        return cls(
            annual=48_980.0,
            currency="$",
            hours_per_year=2_080,
            occupation="Secretaries and administrative assistants",
            industry="Educational services; state, local, and private",
            source="US Bureau of Labor Statistics, Occupational Outlook Handbook",
            source_url=(
                "https://www.bls.gov/ooh/office-and-administrative-support/"
                "secretaries-and-administrative-assistants.htm"
            ),
            year=2025,
        )

    @property
    def hourly(self) -> float:
        return self.annual / self.hours_per_year

    def cite(self) -> str:
        where = f"{self.source} {self.source_url}".strip()
        return (f"{self.currency}{self.hourly:,.2f}/hour, from {self.currency}"
                f"{self.annual:,.0f} over {self.hours_per_year:,} h. {self.occupation}, "
                f"{self.industry}, {self.year}. Source: {where}")


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
    # Skips are not one thing. A family that never consented is closed business; a
    # family the phone cannot reach is open work on somebody's desk. Counting both as
    # `skipped_no_consent`, which is what this did, also reported a cancelled run as a
    # wave of consent refusals.
    skipped_no_voice: int = 0
    skipped_not_dialled: int = 0
    calls_replayed: int = 0
    calls_unknown_provenance: int = 0
    live: bool = False
    rate: FundingRate | None = None
    staff: StaffCost | None = None
    attempts_resolved: int = 0
    attempts_open: int = 0
    # Cases that came back schema-valid and are still not closed. Counted separately
    # because the alternative is counting them twice: once as an answer received, and
    # again, silently, inside a rate that says the work is done.
    escalated: int = 0
    resolved_by_language: dict[str, int] = field(default_factory=dict)
    open_by_language: dict[str, int] = field(default_factory=dict)

    @property
    def closed(self) -> int:
        """Answers this run is entitled to close: schema-valid and not escalated."""
        return self.resolved - self.escalated

    @property
    def resolution_rate(self) -> float:
        """What fraction of the work this run took off somebody's desk.

        The numerator was `resolved`, which is every schema-valid answer including the
        ones routed to a person. That made the headline rate rise every time the app
        found something serious, which is precisely backwards, and it was the number
        printed largest.
        """
        attempted = self.resolved + self.undetermined + self.failed
        return (self.closed / attempted) if attempted else 0.0

    @property
    def non_english_resolved(self) -> int:
        return sum(n for loc, n in self.resolved_by_language.items()
                   if not loc.lower().startswith("en"))

    @property
    def break_even_per_call_minute(self) -> float | None:
        """The call price at which this run stops being cheaper than the desk.

        Returns money per call, per minute that one manual attempt takes. It is a rate
        rather than a flat saving because the two quantities a school actually knows are
        its own wage bill and how long a call takes its own staff. What CALL-E charges is
        unpublished, so the honest move is to report the ceiling and let the reader supply
        the price.

        The run is charged for every attempt it billed and credited only for the attempts
        behind records it actually closed. An undetermined or failed attempt is still on
        somebody's desk, so it is not a saving.
        """
        if self.staff is None or not self.calls_placed:
            return None
        return (self.attempts_resolved / self.calls_placed) * (self.staff.hourly / 60.0)

    @property
    def funding_recovered(self) -> float | None:
        """Only the absences this run actually closed count.

        An undetermined or failed call recovers nothing: the record is still open and a
        human still has to work it. Counting those would be the kind of arithmetic that
        makes a number impressive and false.

        An escalated call is open in exactly the same way, and for a worse reason, so it
        is subtracted here too. When the escalation rule was added this property still
        read `self.resolved`, which meant the money figure went up by one row every time
        the app found a child nobody could account for. The rule above was already written
        down; it just had not been applied to every number derived from it.
        """
        return None if self.rate is None else self.closed * self.rate.amount

    def lines(self) -> list[str]:
        out = [
            f"  attempted            {self.resolved + self.undetermined + self.failed}",
            f"  resolved             {self.resolved}   schema-valid reason on record",
            *([f"  of those, escalated  {self.escalated}   answer received, still not closed"]
              if self.escalated else []),
            f"  undetermined         {self.undetermined}   call happened, no usable answer, needs a person",
            f"  failed               {self.failed}   nobody reached on any number",
            f"  skipped, no consent  {self.skipped_no_consent}",
            *([f"  no voice channel     {self.skipped_no_voice}   never dialled, needs "
               "another way to reach them"] if self.skipped_no_voice else []),
            *([f"  skipped, not dialled {self.skipped_not_dialled}   cancelled, or "
               "stopped by another gate"] if self.skipped_not_dialled else []),
            f"  calls placed         {self.calls_placed}{'' if self.live else '   (no telephone call was placed)'}",
        ]
        if self.calls_replayed:
            out.append(
                f"  calls replayed       {self.calls_replayed}   idempotency key already "
                "used, so no call was made"
            )
        if self.calls_unknown_provenance:
            out.append(
                f"  provenance unknown   {self.calls_unknown_provenance}   the response "
                "carried no usable created_at"
            )
        out.append(f"  resolution rate      {self.resolution_rate:.0%}"
                   + ("   closed, not merely answered" if self.escalated else ""))

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
                f"  non-English families {self.non_english_resolved} of {self.closed} resolved"
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
                "                       this call. Seven US states funded on daily",
                "                       attendance as of 2022 (PPIC, citing the Urban",
                "                       Institute). Pass --funding-rate with a source",
                "                       if your jurisdiction is one of them.",
            ]
        else:
            assert self.rate is not None
            out += [
                "",
                f"  funding recovered    {self.rate.currency}{recovered:,.2f}",
                f"                       {self.closed} resolved x {self.rate.currency}{self.rate.amount:,.2f}",
            ] + _cited(self.rate.cite(), indent=23)

        ceiling = self.break_even_per_call_minute
        if ceiling is None:
            out += [
                "",
                "  staff time avoided   not computed",
                "                       Either no staff cost was supplied, or this run",
                "                       billed no attempts. Pass --staff-annual to set",
                "                       the wage this is computed from.",
            ]
        else:
            assert self.staff is not None
            cur = self.staff.currency
            out += [
                "",
                "  staff time avoided",
                f"    attempts billed     {self.calls_placed}",
                f"    attempts removed    {self.attempts_resolved}   behind the "
                f"{self.closed} record(s) this run closed",
                f"    attempts still open {self.attempts_open}   on somebody's desk, so "
                "not counted as saved",
                f"    break-even          {cur}{ceiling:,.2f} per call, for every minute "
                "one manual attempt takes",
                f"                        so cheaper than the desk below {cur}"
                f"{ceiling * 3:,.2f} a call at 3 minutes an attempt",
            ] + _cited(self.staff.cite(), indent=24)
        return out


def summarise(results: list[ItemResult], *, calls_placed: int | None = None,
              live: bool = False, rate: FundingRate | None = None,
              staff: StaffCost | None = None) -> ImpactSummary:
    """`calls_placed` is derived unless a caller overrides it.

    A call an idempotency key replayed was not placed by this run, was not billed, and
    made nobody's phone ring. Counting it as placed would overstate both the cost and the
    number of people disturbed, which is the kind of small dishonesty that is never
    noticed and never forgiven.
    """
    buckets = {True: 0, False: 0, None: 0}
    for r in results:
        buckets[r.placed_by_this_run] += r.attempts_made
    counts = {r: 0 for r in Resolution}
    resolved_by_language: dict[str, int] = {}
    open_by_language: dict[str, int] = {}
    for result in results:
        counts[result.resolution] += 1
        locale = result.item.locale or ""
        if result.resolution is Resolution.RESOLVED and not result.needs_a_human:
            resolved_by_language[locale] = resolved_by_language.get(locale, 0) + 1
        elif result.needs_a_human:
            open_by_language[locale] = open_by_language.get(locale, 0) + 1
    return ImpactSummary(
        contacted=counts[Resolution.RESOLVED] + counts[Resolution.UNDETERMINED],
        resolved=counts[Resolution.RESOLVED],
        undetermined=counts[Resolution.UNDETERMINED],
        failed=counts[Resolution.FAILED],
        skipped_no_consent=sum(1 for r in results if r.reason == NO_CONSENT),
        skipped_no_voice=sum(1 for r in results if r.needs_another_channel),
        skipped_not_dialled=(counts[Resolution.SKIPPED]
                             - sum(1 for r in results if r.reason == NO_CONSENT)
                             - sum(1 for r in results if r.needs_another_channel)),
        calls_placed=buckets[True] if calls_placed is None else calls_placed,
        calls_replayed=buckets[False],
        calls_unknown_provenance=buckets[None],
        live=live,
        rate=rate,
        staff=staff,
        escalated=sum(1 for r in results if r.escalation is not Escalation.NONE),
        attempts_resolved=sum(r.attempts_made for r in results
                              if r.resolution is Resolution.RESOLVED
                              and not r.needs_a_human),
        attempts_open=sum(r.attempts_made for r in results
                          if r.needs_a_human),
        resolved_by_language=resolved_by_language,
        open_by_language=open_by_language,
    )
