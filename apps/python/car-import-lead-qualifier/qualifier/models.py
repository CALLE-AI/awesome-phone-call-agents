"""Lead intake model with E.164 phone and IANA timezone validation.

A lead file never declares the caller's country. The number itself resolves to a
market (see `locales.py`), and the market supplies the locale, the timezone, and
the calling window. `locale` and `timezone` stay overridable per lead for the
cases the prefix cannot know, such as a Mozambican number whose owner lives
abroad.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .locales import Market, hours_label, resolve_market

E164 = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")
REGION = re.compile(r"^[A-Z]{2}$")
LOCALE = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")

MAX_LEADS = 50


@dataclass(frozen=True)
class Lead:
    """One qualification target. Contains no names and no account data."""

    campaign_id: str
    lead_id: str
    phone: str
    market: Market
    locale: str
    timezone: str
    business_hours: tuple[int, int]
    dealer_display_name: str
    inquiry_source: str
    inquiry_date: str
    vehicle_interest: str
    destination_country: str

    @property
    def masked_phone(self) -> str:
        return mask_phone(self.phone)

    @property
    def business_hours_label(self) -> str:
        return hours_label(self.business_hours)


@dataclass(frozen=True)
class LeadBatch:
    campaign_id: str
    dealer_display_name: str
    leads: tuple[Lead, ...]

    def select(self, lead_id: str | None) -> tuple[Lead, ...]:
        if lead_id is None:
            return self.leads
        chosen = tuple(lead for lead in self.leads if lead.lead_id == lead_id)
        if not chosen:
            raise ValueError(f"lead_id {lead_id!r} is not present in this file")
        return chosen


def mask_phone(phone: str) -> str:
    """Mask a phone number for logs, previews, and results."""
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def redact(value: Any) -> Any:
    """Remove phone-like digit runs from arbitrary provider output."""
    if isinstance(value, str):
        return PHONE_LIKE.sub("[phone-redacted]", value)
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value


def clean_text(value: Any, field: str, *, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = " ".join(value.split())
    if not minimum <= len(cleaned) <= maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} characters")
    return cleaned


def validate_timezone(value: str, field: str) -> str:
    """Accept only resolvable IANA timezone names such as Africa/Maputo."""
    if "/" not in value and value != "UTC":
        raise ValueError(f"{field} must be an IANA timezone name, for example Africa/Maputo")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"{field} is not a known IANA timezone: {value}") from exc
    return value


def validate_phone(value: str, field: str) -> str:
    if not E164.fullmatch(value):
        raise ValueError(f"{field} must use E.164 format, for example +258821234567")
    return value


def parse_lead(raw: Any, *, index: int, batch: dict[str, Any]) -> Lead:
    where = f"leads[{index}]"
    if not isinstance(raw, dict):
        raise ValueError(f"{where} must be an object")

    lead_id = clean_text(raw.get("lead_id"), f"{where}.lead_id", minimum=3, maximum=64)
    if not SAFE_ID.fullmatch(lead_id):
        raise ValueError(
            f"{where}.lead_id may contain only letters, numbers, dot, underscore, and hyphen"
        )

    phone = validate_phone(
        clean_text(raw.get("phone"), f"{where}.phone", minimum=8, maximum=16),
        f"{where}.phone",
    )
    # The dialled number, not a CRM field, decides language and calling hours.
    market = resolve_market(phone)

    if raw.get("submitted_import_inquiry") is not True:
        raise ValueError(
            f"{where}.submitted_import_inquiry must be true; only leads who asked to be "
            "contacted may be called"
        )

    locale = clean_text(
        raw.get("locale", market.locale), f"{where}.locale", minimum=2, maximum=16
    )
    if not LOCALE.fullmatch(locale):
        raise ValueError(f"{where}.locale must look like pt-MZ or en-US")

    timezone = validate_timezone(
        clean_text(
            raw.get("timezone", market.timezone),
            f"{where}.timezone",
            minimum=3,
            maximum=64,
        ),
        f"{where}.timezone",
    )

    destination_country = clean_text(
        raw.get("destination_country", market.region_hint),
        f"{where}.destination_country",
        minimum=2,
        maximum=2,
    )
    if not REGION.fullmatch(destination_country):
        raise ValueError(
            f"{where}.destination_country must be an ISO 3166-1 alpha-2 code such as AO"
        )

    inquiry_date = clean_text(
        raw.get("inquiry_date"), f"{where}.inquiry_date", minimum=10, maximum=10
    )
    try:
        datetime.strptime(inquiry_date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"{where}.inquiry_date must use YYYY-MM-DD") from exc

    return Lead(
        campaign_id=batch["campaign_id"],
        lead_id=lead_id,
        phone=phone,
        market=market,
        locale=locale,
        timezone=timezone,
        business_hours=market.business_hours,
        dealer_display_name=batch["dealer_display_name"],
        inquiry_source=clean_text(
            raw.get("inquiry_source"), f"{where}.inquiry_source", minimum=3, maximum=80
        ),
        inquiry_date=inquiry_date,
        vehicle_interest=clean_text(
            raw.get("vehicle_interest"),
            f"{where}.vehicle_interest",
            minimum=3,
            maximum=120,
        ),
        destination_country=destination_country,
    )


def parse_batch(raw: Any) -> LeadBatch:
    if not isinstance(raw, dict):
        raise ValueError("lead file must contain a JSON object")

    campaign_id = clean_text(raw.get("campaign_id"), "campaign_id", minimum=3, maximum=64)
    if not SAFE_ID.fullmatch(campaign_id):
        raise ValueError(
            "campaign_id may contain only letters, numbers, dot, underscore, and hyphen"
        )
    dealer_display_name = clean_text(
        raw.get("dealer_display_name"), "dealer_display_name", minimum=2, maximum=80
    )

    raw_leads = raw.get("leads")
    if not isinstance(raw_leads, list) or not 1 <= len(raw_leads) <= MAX_LEADS:
        raise ValueError(f"leads must contain 1-{MAX_LEADS} lead objects")

    batch_fields = {
        "campaign_id": campaign_id,
        "dealer_display_name": dealer_display_name,
    }
    leads: list[Lead] = []
    seen_ids: set[str] = set()
    seen_phones: set[str] = set()
    for index, item in enumerate(raw_leads):
        lead = parse_lead(item, index=index, batch=batch_fields)
        if lead.lead_id in seen_ids:
            raise ValueError(f"duplicate lead_id {lead.lead_id!r}")
        if lead.phone in seen_phones:
            raise ValueError(
                f"duplicate phone number for lead_id {lead.lead_id!r}; one call per number per run"
            )
        seen_ids.add(lead.lead_id)
        seen_phones.add(lead.phone)
        leads.append(lead)

    return LeadBatch(
        campaign_id=campaign_id,
        dealer_display_name=dealer_display_name,
        leads=tuple(leads),
    )


def load_batch(path: Path) -> LeadBatch:
    with Path(path).expanduser().open(encoding="utf-8") as handle:
        return parse_batch(json.load(handle))
