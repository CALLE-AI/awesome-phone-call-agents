"""Find real, licensed community pharmacies to call.

The list comes from NPPES, the federal NPI registry every US healthcare provider must
enrol in. It is public, free and needs no key, and it carries the practice-location phone
number, which is the number a member of the public would dial.

Using the federal registry rather than a maps API matters for the result: it means the
sample is "licensed community pharmacies in this ZIP", a population somebody else defined,
not "whatever a search box returned to me".

    https://npiregistry.cms.hhs.gov/api-page
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import requests

NPPES = "https://npiregistry.cms.hhs.gov/api/"

# NUCC taxonomy. We want walk-in retail counters only. Mail-order, specialty, nuclear,
# long-term-care and home-infusion pharmacies do not quote a walk-in cash price, so
# including them would quietly corrupt the sample.
#
# NPPES filters on the human-readable description, not the code, and silently returns
# nothing for an unrecognised value rather than erroring. So we query by description and
# then verify the code on every record that comes back, which means a change to NPPES's
# wording shows up as an empty result we notice rather than a widened sample we do not.
COMMUNITY_RETAIL_CODE = "3336C0003X"
COMMUNITY_RETAIL_DESC = "Community/Retail Pharmacy"

DEFAULT_TIMEOUT = 30

# Suite/floor noise that stops two records at one street address from deduping.
_SUITE = re.compile(r"\b(ste|suite|apt|unit|fl|floor|rm|room|#)\b.*$", re.I)
_NONDIGIT = re.compile(r"\D")


class PharmacyLookupError(RuntimeError):
    pass


@dataclass
class Pharmacy:
    """One licensed pharmacy, as the federal registry describes it."""

    npi: str
    name: str
    phone: str
    address: str
    city: str
    state: str
    postal_code: str
    taxonomy: str = ""
    also_licensed_as: list[str] = field(default_factory=list)

    @property
    def e164(self) -> str:
        """The phone number in the format CALL-E expects."""
        digits = _NONDIGIT.sub("", self.phone)
        if len(digits) == 10:
            return f"+1{digits}"
        if len(digits) == 11 and digits.startswith("1"):
            return f"+{digits}"
        return f"+{digits}"

    @property
    def zip5(self) -> str:
        return self.postal_code[:5]

    def label(self) -> str:
        return f"{self.name}, {self.address}, {self.city} {self.zip5}"


def _dedupe_key(p: Pharmacy) -> str:
    """Group records that are the same physical counter.

    One storefront often holds several NPIs (a retail licence and a specialty licence, a
    predecessor owner's record). Calling it twice wastes a call and double-counts one
    price, so we collapse on phone number first, then on street address.
    """
    digits = _NONDIGIT.sub("", p.phone)
    if len(digits) >= 10:
        return f"tel:{digits[-10:]}"
    street = _SUITE.sub("", p.address).strip().lower()
    return f"adr:{street}|{p.zip5}"


def _parse(record: dict) -> Pharmacy | None:
    basic = record.get("basic", {})
    name = (basic.get("organization_name") or basic.get("name") or "").strip()

    location = None
    for addr in record.get("addresses", []):
        if addr.get("address_purpose") == "LOCATION":
            location = addr
            break
    if location is None:
        return None

    phone = (location.get("telephone_number") or "").strip()
    if not phone:
        return None

    taxonomies = record.get("taxonomies", [])
    primary = next((t for t in taxonomies if t.get("primary")), None) or (
        taxonomies[0] if taxonomies else {}
    )

    return Pharmacy(
        npi=str(record.get("number", "")),
        name=name or "(unnamed pharmacy)",
        phone=phone,
        address=(location.get("address_1") or "").strip(),
        city=(location.get("city") or "").strip().title(),
        state=(location.get("state") or "").strip(),
        postal_code=(location.get("postal_code") or "").strip(),
        taxonomy=primary.get("desc", ""),
    )


def _is_community_retail(record: dict) -> bool:
    """True only if the provider actually holds the community/retail pharmacy taxonomy."""
    return any(
        (t.get("code") or "").upper() == COMMUNITY_RETAIL_CODE
        for t in record.get("taxonomies", [])
    )


def find(
    postal_code: str,
    *,
    limit: int = 25,
    timeout: int = DEFAULT_TIMEOUT,
) -> list[Pharmacy]:
    """Return deduplicated community pharmacies whose practice address is in `postal_code`.

    `postal_code` may end in `*` to widen the search, e.g. "100*" for lower Manhattan.
    """
    params = {
        "version": "2.1",
        "taxonomy_description": COMMUNITY_RETAIL_DESC,
        "postal_code": postal_code,
        "limit": 200,
        "skip": 0,
    }
    resp = requests.get(NPPES, params=params, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()

    if "Errors" in payload:
        detail = "; ".join(e.get("description", "") for e in payload["Errors"])
        raise PharmacyLookupError(f"NPPES rejected the query: {detail}")

    seen: dict[str, Pharmacy] = {}
    for record in payload.get("results", []):
        if not _is_community_retail(record):
            continue
        pharmacy = _parse(record)
        if pharmacy is None:
            continue
        key = _dedupe_key(pharmacy)
        if key in seen:
            # Keep the first record but remember the duplicate licence, so the report can
            # be honest that one counter held several NPIs.
            if pharmacy.name and pharmacy.name != seen[key].name:
                seen[key].also_licensed_as.append(pharmacy.name)
            continue
        seen[key] = pharmacy

    return list(seen.values())[:limit]
