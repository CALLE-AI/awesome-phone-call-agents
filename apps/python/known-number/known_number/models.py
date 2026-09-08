"""Data models for change requests, vendor master records, and verdicts."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from enum import Enum
from pathlib import Path
from typing import Any

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class Verdict(str, Enum):
    """Outcome of one callback. Only CONFIRMED may release the change."""

    CONFIRMED = "CONFIRMED"
    DENIED_BY_VENDOR = "DENIED_BY_VENDOR"
    MISMATCH = "MISMATCH"
    ESCALATE = "ESCALATE"
    INCONCLUSIVE = "INCONCLUSIVE"

    @property
    def releases_change(self) -> bool:
        return self is Verdict.CONFIRMED

    @property
    def is_fraud_signal(self) -> bool:
        return self in {Verdict.DENIED_BY_VENDOR, Verdict.MISMATCH, Verdict.ESCALATE}


@dataclass(frozen=True)
class VendorRecord:
    """A row from the vendor master. The only source of the number to dial."""

    vendor_id: str
    legal_name: str
    known_phone: str
    known_phone_since: date
    region: str
    locale: str
    authorized_contacts: tuple[str, ...]
    current_bank_name: str
    current_account_last4: str

    def __post_init__(self) -> None:
        if not E164.match(self.known_phone):
            raise ValueError(f"known_phone for {self.vendor_id} must be E.164, got {self.known_phone!r}")
        if not self.authorized_contacts:
            raise ValueError(f"vendor {self.vendor_id} has no authorized contacts")
        if not re.fullmatch(r"\d{4}", self.current_account_last4):
            raise ValueError("current_account_last4 must be exactly four digits")

    @staticmethod
    def from_dict(raw: dict[str, Any]) -> "VendorRecord":
        return VendorRecord(
            vendor_id=str(raw["vendor_id"]),
            legal_name=str(raw["legal_name"]),
            known_phone=str(raw["known_phone"]),
            known_phone_since=date.fromisoformat(str(raw["known_phone_since"])),
            region=str(raw.get("region", "US")),
            locale=str(raw.get("locale", "en-US")),
            authorized_contacts=tuple(str(c) for c in raw["authorized_contacts"]),
            current_bank_name=str(raw["current_bank_name"]),
            current_account_last4=str(raw["current_account_last4"]),
        )


@dataclass(frozen=True)
class ChangeRequest:
    """A request to change where a vendor is paid, exactly as it arrived.

    Nothing in this object is trusted. In particular ``callback_phone`` is the
    number the requester *asked* us to call; policy guarantees it is never
    dialed.
    """

    ticket_id: str
    vendor_id: str
    received_on: date
    channel: str
    requested_by_name: str
    new_bank_name: str
    new_account_last4: str
    callback_phone: str | None = None
    notes: str = ""

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", self.ticket_id):
            raise ValueError("ticket_id must be 1-64 chars of letters, digits, '.', '_' or '-'")
        if not re.fullmatch(r"\d{4}", self.new_account_last4):
            raise ValueError("new_account_last4 must be exactly four digits; never store the full number here")

    @staticmethod
    def from_dict(raw: dict[str, Any]) -> "ChangeRequest":
        return ChangeRequest(
            ticket_id=str(raw["ticket_id"]),
            vendor_id=str(raw["vendor_id"]),
            received_on=date.fromisoformat(str(raw["received_on"])),
            channel=str(raw.get("channel", "email")),
            requested_by_name=str(raw["requested_by_name"]),
            new_bank_name=str(raw["new_bank_name"]),
            new_account_last4=str(raw["new_account_last4"]),
            callback_phone=(str(raw["callback_phone"]) if raw.get("callback_phone") else None),
            notes=str(raw.get("notes", "")),
        )


@dataclass
class Reconciliation:
    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    recommended_action: str = ""

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["verdict"] = self.verdict.value
        data["releases_change"] = self.verdict.releases_change
        data["is_fraud_signal"] = self.verdict.is_fraud_signal
        return data


def load_vendors(path: Path) -> dict[str, VendorRecord]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = raw["vendors"] if isinstance(raw, dict) else raw
    vendors = {}
    for row in rows:
        record = VendorRecord.from_dict(row)
        if record.vendor_id in vendors:
            raise ValueError(f"duplicate vendor_id in master: {record.vendor_id}")
        vendors[record.vendor_id] = record
    return vendors


def load_request(path: Path) -> ChangeRequest:
    return ChangeRequest.from_dict(json.loads(path.read_text(encoding="utf-8")))


def mask_phone(phone: str) -> str:
    """Keep the country code and last two digits; hide the rest."""
    if len(phone) < 6:
        return "***"
    return phone[:3] + "*" * (len(phone) - 5) + phone[-2:]
