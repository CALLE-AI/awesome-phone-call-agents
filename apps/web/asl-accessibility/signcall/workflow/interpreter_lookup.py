"""
Step 3B's live interpreter source for Illinois clinics: the Illinois Deaf and
Hard of Hearing Commission's (IDHHC) public licensed-interpreter directory at
idhhc.illinois.gov, queried live on every run and never stored.

Why this source: it is a state licensing registry that offers its own "Export
To CSV" button, its pages and Illinois's site-wide terms contain no
anti-automation notice, and its robots.txt blocks named commercial scraper
bots while allowing a generic client. Re-check those terms before relying on
it; this is a judgment about a third-party site, not a guarantee.

Mechanism: one unauthenticated GET against the JSON endpoint the directory
page itself loads (IL_DIRECTORY_URL). It returns the full roster in one
response, each row shaped as:

    [name, "City, State", county, region, license level, license status,
     ever disciplined?, email <a>, primary phone <a>, alternate phone <a>,
     licensed deaf interpreter?]

No ZIP or street address is published per interpreter, only city, county and
region, so matching is by county rather than a mile radius. The clinic's
county comes from data/il_zip_centroids.json.

Filtering: license status "Active" and a published primary phone number.
Phone is an optional, self-reported field, so only a minority of rows have
one. The data has no freelance/agency flag, so every row that passes is
treated as an individually contactable interpreter.

Nothing is cached or written to disk. The one interpreter who ends up
confirmed for a booking is recorded as part of that booking's result, which
is an engagement record rather than a copy of the directory.

SIGNCALL_DISABLE_IL_LOOKUP=1 skips the request (offline development, tests).
A disabled or failed lookup returns an empty list, never a substitute roster.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import httpx

from .types import InterpreterCandidate

IL_DIRECTORY_URL = (
    "https://idhhc.illinois.gov/content/soi/idhhc/en/sign-language-interpreters/"
    "directory/jcr:content/responsivegrid/container/container/data_table.datatablejson.json"
)
USER_AGENT = "signcall-interpreter-lookup/1.0 (open-source demo; one lookup per call)"
REQUEST_TIMEOUT_SECONDS = 15.0

IL_ZIP_CENTROIDS_PATH = Path(__file__).resolve().parent.parent / "data" / "il_zip_centroids.json"

_TEL_HREF_RE = re.compile(r"tel:\+?1?(\d{10})")

# Column positions in a directory row.
_COL_NAME = 0
_COL_COUNTY = 2
_COL_REGION = 3
_COL_LICENSE_LEVEL = 4
_COL_LICENSE_STATUS = 5
_COL_PRIMARY_PHONE = 8

_il_zip_cache: dict | None = None


def _il_zip_centroids() -> dict:
    """ZIP -> {city, lat, lon, county} for Illinois."""
    global _il_zip_cache
    if _il_zip_cache is None:
        _il_zip_cache = json.loads(IL_ZIP_CENTROIDS_PATH.read_text(encoding="utf-8"))["zips"]
    return _il_zip_cache


def is_illinois_zip(zipcode: str) -> bool:
    """Whether the ZIP has Illinois county data; appointment.py uses this to
    decide whether a live interpreter source exists."""
    return zipcode in _il_zip_centroids()


def _county_for_zip(zipcode: str) -> str | None:
    entry = _il_zip_centroids().get(zipcode)
    return entry["county"] if entry else None


def _extract_phone(cell: str) -> str | None:
    """The E.164 number from a cell that is empty or an
    `<a href='tel:+1XXXXXXXXXX'>` anchor, read from the href rather than the
    visible text."""
    match = _TEL_HREF_RE.search(cell)
    return f"+1{match.group(1)}" if match else None


def _parse_row(row: list) -> InterpreterCandidate | None:
    """A candidate for an Active-license row with a phone, else None."""
    if row[_COL_LICENSE_STATUS] != "Active":
        return None
    phone = _extract_phone(row[_COL_PRIMARY_PHONE])
    if phone is None:
        return None
    level = row[_COL_LICENSE_LEVEL]
    return InterpreterCandidate(
        name=row[_COL_NAME],
        phone=phone,
        expertise=[f"{level} license"] if level else [],
        source="il_directory",
    )


def _fetch_directory() -> list[list]:
    response = httpx.get(
        IL_DIRECTORY_URL,
        headers={"User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()["data"]


def find_interpreters_il(clinic_zip: str) -> list[InterpreterCandidate]:
    """Interpreters for an Illinois clinic: same-county candidates first, then
    same-region candidates from other counties, which is as close as this data
    supports. Nothing outside the clinic's own region is included. The
    county-to-region pairing is read off the directory's own rows, so it can't
    drift from IDHHC's groupings.

    Returns an empty list if the lookup is disabled, the clinic's county is
    unknown, or the request fails."""
    if os.environ.get("SIGNCALL_DISABLE_IL_LOOKUP") == "1":
        return []

    county = _county_for_zip(clinic_zip)
    if county is None:
        return []

    try:
        rows = _fetch_directory()
    except (httpx.HTTPError, ValueError, KeyError):
        return []

    region = next((row[_COL_REGION] for row in rows if row[_COL_COUNTY] == county), None)

    same_county, same_region = [], []
    for row in rows:
        candidate = _parse_row(row)
        if candidate is None:
            continue
        if row[_COL_COUNTY] == county:
            same_county.append(candidate)
        elif region is not None and row[_COL_REGION] == region:
            same_region.append(candidate)
    return same_county + same_region
