"""Records and the JSON ledger.

The ledger never holds protected health information. A claim points at a patient
through an opaque ``patient_ref``; the identifiers themselves live in the vault
(``vault.py``) and are resolved only at call time, only for the fields a
workflow's disclosure envelope permits.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

LEDGER_VERSION = 1

# Claim lifecycle.
QUEUED = "queued"
PENDING_CALL = "pending_call"
PENDING_RECONCILIATION = "pending_reconciliation"
ANSWERED = "answered"
NEEDS_HUMAN = "needs_human"
CLOSED = "closed"
CLAIM_STATES = (QUEUED, PENDING_CALL, PENDING_RECONCILIATION, ANSWERED, NEEDS_HUMAN, CLOSED)

# Call outcomes. Every terminal call lands on exactly one of these.
OUTCOME_ANSWERED = "answered"
OUTCOME_PARTIAL = "partial"
OUTCOME_NOT_ON_FILE = "not_on_file"
OUTCOME_REP_REFUSED = "rep_refused"
OUTCOME_IVR_DEAD_END = "ivr_dead_end"
OUTCOME_HOLD_TIMEOUT = "hold_timeout"
OUTCOME_UNREACHED = "unreached"
OUTCOME_UNUSABLE = "unusable"
OUTCOMES = (
    OUTCOME_ANSWERED,
    OUTCOME_PARTIAL,
    OUTCOME_NOT_ON_FILE,
    OUTCOME_REP_REFUSED,
    OUTCOME_IVR_DEAD_END,
    OUTCOME_HOLD_TIMEOUT,
    OUTCOME_UNREACHED,
    OUTCOME_UNUSABLE,
)

UNKNOWN = "unknown"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return "%s_%s" % (prefix, uuid.uuid4().hex[:12])


def _coerce(cls, payload: Dict[str, Any]):
    known = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in payload.items() if k in known})


@dataclass
class Practice:
    id: str
    name: str
    npi: str
    tin_last4: str
    timezone: str = "America/New_York"


@dataclass
class Payer:
    """A health plan's provider-services line."""

    id: str
    name: str
    line_of_business: str
    phone: str
    region: str = "US"
    locale: str = "en-US"
    timezone: str = "America/New_York"
    claims_per_call_cap: int = 3
    call_window: str = "08:00-17:00"
    ivr_path: List[str] = field(default_factory=list)
    ivr_path_recorded_at: Optional[str] = None


@dataclass
class Claim:
    """One claim awaiting an answer from a payer.

    ``patient_ref`` is a pointer into the vault. No name, member id, or date of
    birth is ever stored on this record.
    """

    id: str
    practice_id: str
    payer_id: str
    patient_ref: str
    workflow: str
    claim_number: str
    date_of_service: str
    billed_amount: float
    filing_deadline: str
    state: str = QUEUED
    procedure_code: str = ""
    denial_code: str = ""
    priority_score: float = 0.0
    call_ids: List[str] = field(default_factory=list)
    result: Dict[str, Any] = field(default_factory=dict)
    review_note: str = ""
    updated_at: str = field(default_factory=now_iso)


@dataclass
class CallRecord:
    """One CALL-E call task covering one bundle of claims for one payer."""

    id: str
    practice_id: str
    payer_id: str
    workflow: str
    claim_ids: List[str]
    mode: str
    status: str = "planned"
    outcome: str = ""
    calle_call_id: str = ""
    idempotency_key: str = ""
    hold_seconds: int = 0
    talk_seconds: int = 0
    total_seconds: int = 0
    cost_estimate_usd: float = 0.0
    reference_number: str = UNKNOWN
    rep_name: str = UNKNOWN
    confidence: Dict[str, Any] = field(default_factory=dict)
    per_claim: Dict[str, Any] = field(default_factory=dict)
    findings: List[str] = field(default_factory=list)
    transcript: List[Dict[str, Any]] = field(default_factory=list)
    summary: str = ""
    created_at: str = field(default_factory=now_iso)
    completed_at: str = ""


@dataclass
class Ledger:
    version: int = LEDGER_VERSION
    practices: List[Practice] = field(default_factory=list)
    payers: List[Payer] = field(default_factory=list)
    claims: List[Claim] = field(default_factory=list)
    calls: List[CallRecord] = field(default_factory=list)
    hold_seconds_used: int = 0
    calls_placed: int = 0

    # -- lookups ---------------------------------------------------------
    def payer(self, payer_id: str) -> Payer:
        for item in self.payers:
            if item.id == payer_id:
                return item
        raise KeyError("unknown payer: %s" % payer_id)

    def practice(self, practice_id: str) -> Practice:
        for item in self.practices:
            if item.id == practice_id:
                return item
        raise KeyError("unknown practice: %s" % practice_id)

    def claim(self, claim_id: str) -> Claim:
        for item in self.claims:
            if item.id == claim_id:
                return item
        raise KeyError("unknown claim: %s" % claim_id)

    def call(self, call_id: str) -> CallRecord:
        for item in self.calls:
            if item.id == call_id:
                return item
        raise KeyError("unknown call: %s" % call_id)

    def claims_for(self, *, state: Optional[str] = None, payer_id: Optional[str] = None) -> List[Claim]:
        out = list(self.claims)
        if state is not None:
            out = [c for c in out if c.state == state]
        if payer_id is not None:
            out = [c for c in out if c.payer_id == payer_id]
        return out


def ledger_path(data_dir: str) -> str:
    return os.path.join(data_dir, "ledger.json")


def load_ledger(data_dir: str) -> Ledger:
    path = ledger_path(data_dir)
    if not os.path.exists(path):
        return Ledger()
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return Ledger(
        version=payload.get("version", LEDGER_VERSION),
        practices=[_coerce(Practice, item) for item in payload.get("practices", [])],
        payers=[_coerce(Payer, item) for item in payload.get("payers", [])],
        claims=[_coerce(Claim, item) for item in payload.get("claims", [])],
        calls=[_coerce(CallRecord, item) for item in payload.get("calls", [])],
        hold_seconds_used=payload.get("hold_seconds_used", 0),
        calls_placed=payload.get("calls_placed", 0),
    )


def save_ledger(data_dir: str, ledger: Ledger) -> None:
    """Write the ledger atomically so an interrupted run cannot truncate it."""
    os.makedirs(data_dir, exist_ok=True)
    payload = {
        "version": ledger.version,
        "practices": [asdict(item) for item in ledger.practices],
        "payers": [asdict(item) for item in ledger.payers],
        "claims": [asdict(item) for item in ledger.claims],
        "calls": [asdict(item) for item in ledger.calls],
        "hold_seconds_used": ledger.hold_seconds_used,
        "calls_placed": ledger.calls_placed,
    }
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=data_dir, prefix=".ledger-", suffix=".tmp", delete=False
    )
    try:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, ledger_path(data_dir))
