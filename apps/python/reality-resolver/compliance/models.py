"""Data model for the pre-call compliance gate.

No jurisdiction rule content lives here - only the shapes that
compliance/jurisdictions/*.py files fill in and that
compliance/dispatcher.py consumes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class RecordingConsentType(Enum):
    NOT_APPLICABLE = "not_applicable"
    ONE_PARTY = "one_party"
    ALL_PARTY = "all_party"
    UNKNOWN = "unknown"


class ConfidenceLevel(Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNVERIFIED = "unverified"  # placeholder jurisdictions use this


@dataclass(frozen=True)
class CallingWindow:
    start_local_hour: int  # 0-23, inclusive
    end_local_hour: int  # 0-23, exclusive


@dataclass(frozen=True)
class JurisdictionRules:
    jurisdiction_id: str  # e.g. "us_federal", "eu_common", "fr"
    display_name: str
    default_locale: str  # BCP 47, e.g. "en-US", "fr-FR"
    region_code: str | None  # e.g. "US", "FR"; None for bloc-wide entries like eu_common
    calling_window: CallingWindow | None
    consent_required: bool
    disclosure_required: bool
    disclosure_script: str | None
    dnc_check_required: bool
    recording_consent_type: RecordingConsentType
    source_confidence: ConfidenceLevel
    notes: str


@dataclass(frozen=True)
class CheckResult:
    check_name: str
    passed: bool
    reason: str
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH


@dataclass(frozen=True)
class PreCallContext:
    phone_e164: str
    intends_to_record: bool = False
    consent_obtained: bool = False
    consent_timestamp: datetime | None = None  # UTC-aware
    dnc_checked: bool = False
    gdpr_basis_documented: bool = False
    do_not_call_requested: bool = False
    recipient_timezone: str | None = None  # IANA name, e.g. "America/New_York"
    now_utc: datetime | None = None  # inject for deterministic tests; None = real now
    # Oregon HB 3865 caps solicitations (calls AND texts combined) at 3 per
    # rolling 24h. This app has no call-history database, so the operator
    # must attest the count from their own records. None (not attested)
    # fails the check - same fail-closed treatment as recipient_timezone.
    solicitations_in_last_24h: int | None = None


@dataclass(frozen=True)
class PreCallDecision:
    allowed: bool
    jurisdiction_chain: tuple[str, ...]
    results: tuple[CheckResult, ...] = field(default_factory=tuple)

    @property
    def blocking_reasons(self) -> tuple[str, ...]:
        return tuple(r.reason for r in self.results if not r.passed)
