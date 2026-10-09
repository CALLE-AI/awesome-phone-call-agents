"""Guardrails: what may be disclosed, what the agent may never do, when a call may happen.

Three separate ideas live here and are deliberately kept apart:

* ``DISCLOSURE_ENVELOPES`` bound what leaves the vault. They are enforced in code
  by ``vault.resolve_envelope``, not by asking a model to behave.
* ``AGENT_BOUNDARIES`` bound what the agent may say or agree to on the call.
* the suppression reasons bound when a call may be placed at all.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Minimum necessary: the only patient identifiers each workflow may disclose.
# ---------------------------------------------------------------------------
# HIPAA permits a provider to disclose protected health information to a health
# plan for payment activities without patient authorisation, but only the
# minimum necessary for that activity. These sets are that rule, written down.
# A field absent from a workflow's envelope cannot reach a call: the resolver
# refuses to read it out of the vault.

DISCLOSURE_ENVELOPES: Dict[str, Tuple[str, ...]] = {
    "claim_status": ("member_id", "date_of_birth", "patient_last_name"),
    "denial_reason": ("member_id", "date_of_birth", "patient_last_name"),
    "prior_auth_status": ("member_id", "date_of_birth", "patient_last_name"),
    "eligibility": ("member_id", "date_of_birth"),
}

# Everything the vault can hold. Anything here that is not in a workflow's
# envelope is unreachable for that workflow.
VAULT_FIELDS: Tuple[str, ...] = (
    "member_id",
    "date_of_birth",
    "patient_first_name",
    "patient_last_name",
    "ssn_last4",
    "medical_record_number",
    "address_line1",
    "phone",
    "email",
)

# Fields no workflow may ever disclose on a payer call, regardless of envelope.
NEVER_DISCLOSE: Tuple[str, ...] = (
    "ssn_last4",
    "medical_record_number",
    "address_line1",
    "phone",
    "email",
)

# ---------------------------------------------------------------------------
# Call-time boundaries. Appended verbatim to every task prompt.
# ---------------------------------------------------------------------------

AI_DISCLOSURE = (
    "Open the call by stating that you are an AI assistant calling on behalf of the "
    "provider's billing office, and say so again at any point if you are asked."
)

RECORDING_DISCLOSURE = (
    "State that the call may be recorded for accuracy before asking the first question."
)

AGENT_BOUNDARIES: Tuple[str, ...] = (
    "You are gathering information only. You may not agree to anything.",
    "Never file, initiate, withdraw, or escalate an appeal, reconsideration, grievance, or "
    "peer-to-peer review. If the representative offers to start one, say the billing office "
    "will follow up and do not accept.",
    "Never accept, waive, negotiate, or dispute any amount, adjustment, refund, offset, or "
    "recoupment.",
    "Never agree to a corrected claim, a resubmission, a void, or any change to a claim.",
    "Never provide a Social Security number, a full patient address, a medical record number, "
    "a credit card, a bank account, or a password. If a representative insists on one of these "
    "to continue, say the billing office will call back and end the call.",
    "Never discuss clinical care, diagnosis, treatment, or medical advice. You are calling about "
    "claim administration only.",
    "Never state or imply that a claim is owed, incorrect, or fraudulent. Ask what the plan's "
    "record says.",
    "Do not guess. If the representative does not state a value clearly, report it as unknown.",
    "Always ask for a call reference number and the representative's first name before ending.",
    "If the representative says they cannot discuss this without different credentials, ask what "
    "the billing office must provide, record it, and end the call.",
)

# Twelve states require all-party consent for call recording. Payers announce
# recording on their own provider lines, so a symmetric disclosure is low
# friction; Trunkline discloses in every state rather than tracking each one.
ALL_PARTY_CONSENT_STATES: Tuple[str, ...] = (
    "CA", "CT", "DE", "FL", "IL", "MD", "MA", "MI", "MT", "NH", "OR", "WA",
)

# ---------------------------------------------------------------------------
# Destination validation.
# ---------------------------------------------------------------------------

REGIONS: Dict[str, Dict[str, object]] = {
    "US": {"cc": "1", "min": 10, "max": 10, "nanp": True},
    "CA": {"cc": "1", "min": 10, "max": 10, "nanp": True},
    # Australian geographic and mobile numbers have a nine-digit national
    # significant number after +61. The domestic trunk prefix (0) is omitted.
    "AU": {"cc": "61", "min": 9, "max": 9},
}

E164_RE = re.compile(r"^\+[1-9][0-9]{6,14}$")
NANP_RE = re.compile(r"^[2-9][0-9]{2}[2-9][0-9]{2}[0-9]{4}$")
PREMIUM_NANP_AREA_CODES = {"900", "976"}


class PolicyError(ValueError):
    pass


def validate_destination(phone: str, region: str) -> str:
    """Refuse anything that is not a plain E.164 number in the payer's region."""
    if not isinstance(phone, str) or not E164_RE.match(phone):
        raise PolicyError("phone must be E.164, for example +12125550100")
    spec = REGIONS.get(region.upper())
    if spec is None:
        raise PolicyError("region %r is not enabled; add it to policy.REGIONS deliberately" % region)
    cc = str(spec["cc"])
    national = phone[1 + len(cc):]
    if not phone.startswith("+" + cc):
        raise PolicyError("phone %s does not match region %s (+%s)" % (mask_phone(phone), region, cc))
    if not (int(spec["min"]) <= len(national) <= int(spec["max"])):
        raise PolicyError("phone %s has the wrong length for region %s" % (mask_phone(phone), region))
    if spec.get("nanp"):
        if not NANP_RE.match(national):
            raise PolicyError("phone %s is not a valid NANP number" % mask_phone(phone))
        if national[:3] in PREMIUM_NANP_AREA_CODES:
            raise PolicyError("refusing a premium-rate area code")
    return phone


def mask_phone(phone: str) -> str:
    """Mask a number for printing. Keeps country code and last two digits."""
    if not phone:
        return "unknown"
    digits = [ch for ch in phone if ch.isdigit()]
    if len(digits) < 4:
        return "*" * len(digits)
    keep_head = 2 if phone.startswith("+") else 0
    head = "".join(digits[:keep_head])
    tail = "".join(digits[-2:])
    stars = "*" * max(0, len(digits) - keep_head - 2)
    return ("+" if phone.startswith("+") else "") + head + stars + tail


# ---------------------------------------------------------------------------
# Call windows.
# ---------------------------------------------------------------------------

def parse_window(window: str) -> Tuple[time, time]:
    try:
        start_raw, end_raw = window.split("-", 1)
        start = datetime.strptime(start_raw.strip(), "%H:%M").time()
        end = datetime.strptime(end_raw.strip(), "%H:%M").time()
    except ValueError:
        raise PolicyError("call_window must look like 08:00-17:00, got %r" % window) from None
    if start >= end:
        raise PolicyError("call_window start must be before end: %r" % window)
    return start, end


def within_window(local_now: datetime, window: str) -> bool:
    """Business-hours check. Weekends are never a calling window for a payer line."""
    if local_now.weekday() >= 5:
        return False
    start, end = parse_window(window)
    return start <= local_now.time() <= end


# ---------------------------------------------------------------------------
# Suppression reasons: the named holds that stop a call.
# ---------------------------------------------------------------------------

SUPPRESSION_REASONS: Dict[str, str] = {
    "kill_switch": "the kill switch file is present; every call is refused",
    "claim_not_queued": "the claim is not in the queued state",
    "outside_call_window": "the payer's local time is outside its configured calling window",
    "filing_deadline_passed": "the timely-filing deadline has already passed; a call cannot help",
    "pending_reconciliation": "an earlier call for this claim was submitted and never reconciled",
    "hold_budget_exhausted": "the practice's hold-minute budget for this run is spent",
    "daily_call_cap": "the per-run call cap is reached",
    "cost_cap_exceeded": "the projected call cost exceeds the share of claim value allowed",
    "no_authorization": "live mode requires a written authorization record for this payer",
    "authorization_expired": "the authorization record for this payer has expired",
    "authorization_exhausted": "the authorization record's call budget is spent",
    "authorization_mismatch": "the payer's number does not match the authorized destination",
    "no_vault_record": "the patient reference has no vault record, so nothing can be verified",
}


def describe_suppression(reason: str) -> str:
    return SUPPRESSION_REASONS.get(reason, reason)


def days_until(deadline: str, today: Optional[date] = None) -> int:
    reference = today or date.today()
    try:
        parsed = datetime.strptime(deadline, "%Y-%m-%d").date()
    except ValueError:
        raise PolicyError("filing_deadline must be YYYY-MM-DD, got %r" % deadline) from None
    return (parsed - reference).days


def boundaries_block() -> str:
    lines: List[str] = [AI_DISCLOSURE, RECORDING_DISCLOSURE]
    lines.extend(AGENT_BOUNDARIES)
    return "\n".join("- " + line for line in lines)
