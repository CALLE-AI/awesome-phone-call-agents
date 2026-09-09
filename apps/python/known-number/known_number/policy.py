"""Pre-call policy gates. Every gate runs before any network activity.

A gate failure is a hard stop, not a warning. The gates exist because the
callback control is only as strong as the number it dials: an attacker who
can first change the vendor's phone number on file, then the bank account,
would otherwise be "verified" by talking to themselves.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .models import ChangeRequest, VendorRecord, mask_phone

DEFAULT_MIN_KNOWN_PHONE_AGE_DAYS = 30


@dataclass
class PolicyDecision:
    allowed: bool
    dial_phone: str | None
    contact_names: tuple[str, ...]
    blocking_reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "dial_phone_masked": mask_phone(self.dial_phone) if self.dial_phone else None,
            "contact_names": list(self.contact_names),
            "blocking_reasons": list(self.blocking_reasons),
            "warnings": list(self.warnings),
        }


def evaluate(
    request: ChangeRequest,
    vendor: VendorRecord | None,
    *,
    today: date | None = None,
    min_known_phone_age_days: int = DEFAULT_MIN_KNOWN_PHONE_AGE_DAYS,
    live: bool = False,
    approver: str | None = None,
) -> PolicyDecision:
    today = today or date.today()
    blocking: list[str] = []
    warnings: list[str] = []

    if vendor is None:
        return PolicyDecision(
            allowed=False,
            dial_phone=None,
            contact_names=(),
            blocking_reasons=[
                f"vendor {request.vendor_id} is not in the vendor master; a change request for an unknown vendor cannot be verified by callback"
            ],
        )

    # Gate 1: the number on file must predate the request by a safe margin.
    cutoff = request.received_on - timedelta(days=min_known_phone_age_days)
    if vendor.known_phone_since > cutoff:
        blocking.append(
            "known_phone on file was recorded on "
            f"{vendor.known_phone_since.isoformat()}, less than {min_known_phone_age_days} days before the request "
            f"({request.received_on.isoformat()}); a recently changed phone number cannot anchor a callback"
        )

    # Gate 2: a callback number supplied by the requester is never dialed.
    if request.callback_phone:
        if request.callback_phone == vendor.known_phone:
            warnings.append("request supplied a callback number; it matches the number on file and is ignored anyway")
        else:
            warnings.append(
                "request supplied a callback number that does NOT match the number on file "
                f"({mask_phone(request.callback_phone)} vs {mask_phone(vendor.known_phone)}); "
                "it will not be dialed and is itself a fraud indicator"
            )

    # Gate 3: the proposed change must actually be a change.
    if request.new_account_last4 == vendor.current_account_last4 and _norm(request.new_bank_name) == _norm(
        vendor.current_bank_name
    ):
        blocking.append("requested details are identical to the details already on file; nothing to verify")

    # Gate 4: the request date must be plausible.
    if request.received_on > today:
        blocking.append("request received_on is in the future")
    if request.received_on < today - timedelta(days=90):
        warnings.append("request is more than 90 days old; confirm it is still pending before calling")

    # Gate 5: a live call needs a named approver.
    if live and not (approver and approver.strip()):
        blocking.append("a live call requires --approver <name>; dry-run does not")

    return PolicyDecision(
        allowed=not blocking,
        dial_phone=vendor.known_phone,
        contact_names=vendor.authorized_contacts,
        blocking_reasons=blocking,
        warnings=warnings,
    )


def _norm(text: str) -> str:
    return " ".join(text.lower().replace(".", " ").replace(",", " ").split())
