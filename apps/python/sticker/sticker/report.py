"""Turn a set of answered calls into the one number a person can act on.

The arithmetic here is deliberately dull. The interesting decisions are about what is
allowed to count, and there are three:

  1. A price only counts if a pharmacy said a dollar amount aloud for the quantity we
     asked about. A quote for a different bottle size is recorded and reported, and kept
     out of the spread, because rescaling ninety tablets to thirty assumes a linearity
     that pharmacy pricing does not have.
  2. A refusal is data, not a gap. The share of pharmacies that will not price a drug by
     phone is a finding about price opacity, and it is reported next to the prices rather
     than quietly dropped from the denominator.
  3. Markup is computed against CMS NADAC, which we did not author. NADAC is a national
     average of what pharmacies paid, surveyed from invoices across the country, so it is
     a benchmark and not this pharmacy's invoice. Every figure derived from it is an
     estimate, and the report says so rather than implying it knows a shop's own cost.
"""

from __future__ import annotations

import datetime as _dt
import statistics
from dataclasses import dataclass, field

from .call_design import DrugRequest
from .nadac import NadacRow
from .safety import mask


@dataclass
class Quote:
    """One pharmacy's answer, after the call."""

    pharmacy: str
    city: str
    phone_masked: str
    quote_status: str
    answered_by: str
    price_usd: float | None
    quantity: int | None
    requires_prescription_on_file: str = "unknown"
    discount_program_mentioned: str = "unknown"
    notes: str = ""
    call_id: str = ""
    # False for a pharmacy the run stopped before reaching. Those rows still appear in the
    # report, because the operator needs to see who was left, but counting them as calls
    # placed would overstate what actually happened on the phone network.
    dialled: bool = True

    @property
    def counts_toward_spread(self) -> bool:
        return self.quote_status == "quoted" and self.price_usd is not None


@dataclass
class Survey:
    """Everything one run of Sticker found."""

    drug: DrugRequest
    postal_code: str
    quotes: list[Quote]
    nadac: NadacRow | None
    started_at: _dt.datetime
    finished_at: _dt.datetime
    live: bool = False
    excluded: list[Quote] = field(default_factory=list)

    @property
    def calls_placed(self) -> int:
        """How many calls were actually created, not how many pharmacies were queued.

        A halted run leaves rows nobody dialled, and reporting the queue length as calls
        placed would inflate both the effort and any per-call cost derived from it.
        """
        return len([q for q in self.quotes if q.dialled])

    # -- what counts -------------------------------------------------------------

    @property
    def comparable(self) -> list[Quote]:
        """Quotes for the exact quantity asked about, cheapest first."""
        return sorted(
            (
                q
                for q in self.quotes
                if q.counts_toward_spread and q.quantity == self.drug.quantity
            ),
            key=lambda q: q.price_usd or 0.0,
        )

    @property
    def other_quantity(self) -> list[Quote]:
        """Real prices for a different bottle size. Reported, never rescaled."""
        return [
            q
            for q in self.quotes
            if q.counts_toward_spread and q.quantity != self.drug.quantity
        ]

    @property
    def refused(self) -> list[Quote]:
        return [q for q in self.quotes if q.quote_status == "refused"]

    @property
    def unreached(self) -> list[Quote]:
        return [q for q in self.quotes if q.answered_by in {"voicemail", "unknown", "ivr"}]

    # -- the headline ------------------------------------------------------------

    @property
    def prices(self) -> list[float]:
        return [q.price_usd for q in self.comparable if q.price_usd is not None]

    @property
    def cheapest(self) -> Quote | None:
        return self.comparable[0] if self.comparable else None

    @property
    def dearest(self) -> Quote | None:
        return self.comparable[-1] if self.comparable else None

    @property
    def median_price(self) -> float | None:
        return round(statistics.median(self.prices), 2) if self.prices else None

    @property
    def spread_multiple(self) -> float | None:
        """How many times the cheapest price the most expensive one is."""
        if len(self.prices) < 2 or min(self.prices) <= 0:
            return None
        return round(max(self.prices) / min(self.prices), 1)

    @property
    def acquisition_cost(self) -> float | None:
        """The national average acquisition cost for this quantity, per CMS NADAC.

        Not this pharmacy's invoice. NADAC is a survey average across the country, so a
        given shop paid somewhat more or less depending on its wholesaler and volume.
        """
        if self.nadac is None:
            return None
        return self.nadac.cost_for(self.drug.quantity)

    def markup(self, price: float | None) -> float | None:
        """`price` as a multiple of the national average acquisition cost.

        An estimate, because the denominator is a national benchmark rather than what
        this pharmacy paid. It is the right order of magnitude and the wrong number for
        any single invoice.
        """
        cost = self.acquisition_cost
        if price is None or cost is None or cost <= 0:
            return None
        return round(price / cost, 1)

    @property
    def annual_difference_usd(self) -> float | None:
        """A year of monthly fills at the median, minus a year at the cheapest.

        This is the number the person actually feels, and it is the only figure here
        that involves an assumption: that they fill this once a month for a year.
        """
        if self.median_price is None or self.cheapest is None or self.cheapest.price_usd is None:
            return None
        return round((self.median_price - self.cheapest.price_usd) * 12, 2)

    # -- the receipts ------------------------------------------------------------

    @property
    def elapsed_seconds(self) -> int:
        return max(0, int((self.finished_at - self.started_at).total_seconds()))

    @property
    def elapsed_human(self) -> str:
        seconds = self.elapsed_seconds
        return f"{seconds // 60} min {seconds % 60} sec"

    @property
    def quote_rate(self) -> float | None:
        """Share of pharmacies called that said a price aloud."""
        if not self.quotes:
            return None
        priced = len(self.comparable) + len(self.other_quantity)
        return round(100.0 * priced / len(self.quotes), 1)


def render_text(survey: Survey) -> str:
    """The report, as a person reads it."""
    d = survey.drug
    lines: list[str] = []
    mode = "LIVE CALLS" if survey.live else "SIMULATED, no calls placed"
    lines.append(f"Sticker: cash price survey ({mode})")
    lines.append("=" * 66)
    lines.append(f"{d.quantity} x {d.spoken()}  |  ZIP {survey.postal_code}")
    lines.append(f"{survey.started_at:%Y-%m-%d %H:%M} local  |  {len(survey.quotes)} pharmacies called")
    lines.append("")

    if not survey.comparable:
        lines.append("No pharmacy quoted a price for this quantity.")
    else:
        lines.append(f"{'PHARMACY':<34}{'CITY':<16}{'PRICE':>10}{'vs NADAC':>10}")
        lines.append("-" * 70)
        for q in survey.comparable:
            markup = survey.markup(q.price_usd)
            markup_text = f"{markup:.0f}x" if markup else "-"
            lines.append(
                f"{q.pharmacy[:33]:<34}{q.city[:15]:<16}"
                f"{'$' + format(q.price_usd, '.2f'):>10}{markup_text:>10}"
            )
        lines.append("")

    cheapest, dearest = survey.cheapest, survey.dearest
    if cheapest and dearest and survey.spread_multiple:
        lines.append(
            f"Lowest ${cheapest.price_usd:.2f} at {cheapest.pharmacy}. "
            f"Highest ${dearest.price_usd:.2f} at {dearest.pharmacy}."
        )
        lines.append(
            f"That is a {survey.spread_multiple}x spread across the "
            f"{len(survey.comparable)} pharmacies here that gave a price for this quantity. "
            "Somewhere else in the same ZIP may be cheaper."
        )

    if survey.nadac and survey.acquisition_cost is not None:
        lines.append("")
        lines.append(
            f"Published national average acquisition cost for {d.quantity} of these: "
            f"${survey.acquisition_cost:.2f}."
        )
        lines.append(f"  {survey.nadac.citation()}")
        lines.append(
            "  CMS surveys invoices nationwide and publishes a per-unit average; the "
            "figure above is that average multiplied out. It is a benchmark, not any "
            "pharmacy's invoice, so every multiple here is an estimate."
        )

    if survey.annual_difference_usd:
        lines.append("")
        lines.append(
            f"Filling at the median of these instead of the lowest would cost about "
            f"${survey.annual_difference_usd:.2f} more a year, assuming a monthly refill."
        )

    # What did not count, said plainly rather than dropped.
    if survey.other_quantity or survey.refused or survey.unreached:
        lines.append("")
        lines.append("Not in the comparison:")
        for q in survey.other_quantity:
            lines.append(
                f"  {q.pharmacy}: ${q.price_usd:.2f} for {q.quantity}, a different bottle size."
            )
        for q in survey.refused:
            lines.append(f"  {q.pharmacy}: would not price it by phone. {q.notes}")
        for q in survey.unreached:
            lines.append(f"  {q.pharmacy}: {q.answered_by}, no price obtained.")

    lines.append("")
    not_dialled = len([q for q in survey.quotes if not q.dialled])
    tail = f", {not_dialled} not dialled" if not_dialled else ""
    # A simulated run places no calls at all, so saying "calls placed" here would
    # contradict the header two dozen lines above and overstate what happened.
    noun = "calls placed" if survey.live else "simulated calls, none placed"
    lines.append(f"{survey.calls_placed} {noun}{tail}, {survey.elapsed_human} of wall clock.")
    if survey.quote_rate is not None:
        lines.append(f"{survey.quote_rate}% of pharmacies called gave a price over the phone.")
    return "\n".join(lines)
