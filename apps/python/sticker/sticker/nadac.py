"""CMS NADAC lookup: what a pharmacy actually pays for a drug.

NADAC (National Average Drug Acquisition Cost) is published weekly by the Centers for
Medicare & Medicaid Services from a survey of invoice prices paid by retail community
pharmacies. It is the acquisition-cost half of Sticker's headline number, and it is the
reason that number is not self-graded: we did not author it and cannot influence it.

Public, free, no API key:
    https://data.medicaid.gov/dataset/dfa2ab14-06c2-457a-9e36-5cb6d80f8d93

Everything here is a read. Nothing in this module can be tuned to make a result look better.
"""

from __future__ import annotations

import datetime as _dt
import functools
import urllib.parse
from dataclasses import dataclass

import requests

METASTORE = "https://data.medicaid.gov/api/1/metastore/schemas/dataset/items"
DATASTORE = "https://data.medicaid.gov/api/1/datastore/query/{dist_id}"

# Pricing units used by NADAC. A "unit" is one tablet/capsule for EA, one millilitre for
# ML, one gram for GM. Quantity on a prescription is counted in the same unit.
PRICING_UNITS = {"EA": "each", "ML": "millilitre", "GM": "gram"}

DEFAULT_TIMEOUT = 30


class NadacError(RuntimeError):
    """Raised when the CMS dataset cannot be reached or has no row for a drug."""


@dataclass(frozen=True)
class NadacRow:
    """One published acquisition cost, exactly as CMS states it."""

    ndc_description: str
    ndc: str
    per_unit_usd: float
    pricing_unit: str
    effective_date: str
    otc: bool
    classification: str

    def cost_for(self, quantity: float) -> float:
        """Acquisition cost of `quantity` units, rounded to the cent."""
        return round(self.per_unit_usd * quantity, 2)

    @property
    def source_url(self) -> str:
        return (
            "https://data.medicaid.gov/dataset/dfa2ab14-06c2-457a-9e36-5cb6d80f8d93"
            f"?conditions[ndc]={self.ndc}"
        )

    def citation(self) -> str:
        return (
            f"CMS NADAC, {self.ndc_description} (NDC {self.ndc}): "
            f"${self.per_unit_usd:.5f} per {PRICING_UNITS.get(self.pricing_unit, self.pricing_unit)}, "
            f"effective {self.effective_date}."
        )


@functools.lru_cache(maxsize=8)
def _distribution_id(year: int, timeout: int = DEFAULT_TIMEOUT) -> str:
    """Resolve the NADAC distribution id for a calendar year.

    Looked up rather than hardcoded so the tool keeps working when CMS publishes next
    year's dataset.
    """
    resp = requests.get(
        METASTORE, params={"show-reference-ids": "true"}, timeout=timeout
    )
    resp.raise_for_status()
    want = f"NADAC (National Average Drug Acquisition Cost) {year}"
    for item in resp.json():
        if item.get("title") == want:
            dists = item.get("distribution") or []
            if dists:
                return dists[0]["identifier"]
    raise NadacError(f"CMS publishes no NADAC dataset for {year}")


def _query(dist_id: str, params: list[tuple[str, str]], timeout: int) -> list[dict]:
    url = DATASTORE.format(dist_id=dist_id) + "?" + urllib.parse.urlencode(params)
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json().get("results", [])


def lookup(
    description_prefix: str,
    *,
    year: int | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> NadacRow:
    """Return the most recent NADAC row whose description starts with `description_prefix`.

    `description_prefix` is matched against NADAC's own `ndc_description`, which looks
    like "METFORMIN HCL 500 MG TABLET". Matching is case-insensitive on the CMS side.

    Falls back to the previous year's dataset early in January, when the current year's
    file may not yet have rows.
    """
    years = [year] if year else [_dt.date.today().year, _dt.date.today().year - 1]
    last_error: Exception | None = None

    for candidate_year in years:
        try:
            dist_id = _distribution_id(candidate_year, timeout=timeout)
        except Exception as exc:  # dataset for that year may not exist yet
            last_error = exc
            continue

        rows = _query(
            dist_id,
            [
                ("limit", "40"),
                ("conditions[0][property]", "ndc_description"),
                ("conditions[0][operator]", "starts with"),
                ("conditions[0][value]", description_prefix.upper()),
                ("sorts[0][property]", "effective_date"),
                ("sorts[0][order]", "desc"),
            ],
            timeout,
        )
        if rows:
            return _row(_most_recent(rows))

    raise NadacError(
        f"No NADAC row starting with {description_prefix!r}. "
        "Check the spelling against CMS's own ndc_description wording."
    ) from last_error


def _most_recent(rows: list[dict]) -> dict:
    """Pick the newest row, then the cheapest NDC at that date.

    Several manufacturers share one description. CMS prices each NDC separately, so we
    take the lowest published cost among them: that is the most conservative choice,
    because it makes the markup we report the *smallest* markup consistent with the data.
    """
    newest = max(r["effective_date"] for r in rows if r.get("effective_date"))
    same_date = [r for r in rows if r.get("effective_date") == newest]
    return min(same_date, key=lambda r: float(r["nadac_per_unit"]))


def _row(raw: dict) -> NadacRow:
    return NadacRow(
        ndc_description=raw["ndc_description"].strip(),
        ndc=raw["ndc"],
        per_unit_usd=float(raw["nadac_per_unit"]),
        pricing_unit=raw.get("pricing_unit", "EA"),
        effective_date=raw.get("effective_date", ""),
        otc=(raw.get("otc") or "N").upper() == "Y",
        classification=raw.get("classification_for_rate_setting", ""),
    )
