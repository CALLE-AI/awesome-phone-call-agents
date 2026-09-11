"""Who may be called, when, and what the agent may never do.

Every refusal is a named reason so the operator can see why a call did not happen.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

# Region -> (country calling code, allowed national significant number lengths). Only regions in this
# table can be dialled; an unknown region is refused rather than guessed. NANP regions get extra rules.
REGIONS: Dict[str, Tuple[str, Tuple[int, ...]]] = {
    "US": ("1", (10,)), "CA": ("1", (10,)),
    "GB": ("44", (10,)), "IE": ("353", (9,)),
    "AU": ("61", (9,)), "NZ": ("64", (8, 9, 10)),
    "DE": ("49", (10, 11)), "FR": ("33", (9,)), "NL": ("31", (9,)), "ES": ("34", (9,)), "IT": ("39", (9, 10)),
    "HK": ("852", (8,)), "SG": ("65", (8,)), "JP": ("81", (9, 10)), "IN": ("91", (10,)),
}
NANP_REGIONS = ("US", "CA")
# NANP: NXX-NXX-XXXX with N in 2-9; premium-rate area code 900 and exchange 976 are never dialled.
NANP_PATTERN = re.compile(r"^[2-9]\d{2}[2-9]\d{2}\d{4}$")
NANP_BLOCKED_AREA_CODES = ("900",)
NANP_BLOCKED_EXCHANGES = ("976",)
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")   # ITU-T E.164: country code + subscriber, 8 to 15 digits

# Hard boundaries spoken into every task prompt. The agent reports; the human decides.
HARD_BOUNDARIES = [
    "You are an AI assistant calling on behalf of the customer; say so if asked, and never claim to be the customer.",
    "Never give, confirm, or read back payment card numbers, bank details, passwords, one-time codes, or government ID numbers.",
    "Never accept, negotiate, or decline any settlement, refund amount, fee, credit, or new charge. If an offer is made, record the exact wording and say the customer will respond.",
    "Never agree to close, withdraw, or reopen the case, or to change the customer's contact details or plan.",
    "Never threaten, insult, or mention lawyers, regulators, or legal action.",
    "If the representative says they cannot discuss the case with a third party, ask what the customer must do to authorise this, record it, and end the call politely.",
    "If asked to hold, hold up to ten minutes. If transferred, restate the case reference to the new person.",
]

MAX_CALLS_PER_DAY = 2
MAX_TOTAL_CALLS = 8
MIN_HOURS_BETWEEN_CALLS = 20
CALLING_WINDOW = (9, 17)   # local hours, inclusive start, exclusive end
GRACE_DAYS_AFTER_PROMISE = 2


def destination_problems(hotline: str, region: str) -> List[Tuple[str, str]]:
    """Every reason a destination is not a valid, dialable, region-consistent E.164 number."""
    problems: List[Tuple[str, str]] = []
    if not isinstance(hotline, str) or not E164_PATTERN.match(hotline):
        return [("bad_number", "Hotline must be a full E.164 number: '+', country code, subscriber number, 8 to 15 digits, no spaces.")]
    if region not in REGIONS:
        return [("unsupported_region", f"Region {region!r} is not in the supported region table; add it to policy.REGIONS deliberately.")]
    cc, lengths = REGIONS[region]
    digits = hotline[1:]
    if not digits.startswith(cc):
        return [("region_mismatch", f"Hotline country code does not match region {region} (+{cc}).")]
    national = digits[len(cc):]
    if len(national) not in lengths:
        problems.append(("bad_number", f"National number length {len(national)} is not valid for region {region}."))
    if region in NANP_REGIONS:
        if not NANP_PATTERN.match(national):
            problems.append(("bad_number", "NANP numbers must be NXX-NXX-XXXX with N in 2-9; short codes and service codes are never dialled."))
        elif national[:3] in NANP_BLOCKED_AREA_CODES or national[3:6] in NANP_BLOCKED_EXCHANGES:
            problems.append(("blocked_number", "Premium-rate numbers (900 area code, 976 exchange) are never dialled."))
    elif national.startswith("0"):
        problems.append(("bad_number", "National number must not start with a trunk prefix 0 in E.164."))
    return problems


def local_now(timezone_name: str, now_utc: Optional[datetime] = None) -> datetime:
    now_utc = now_utc or datetime.now(timezone.utc)
    if ZoneInfo is None:
        return now_utc
    try:
        return now_utc.astimezone(ZoneInfo(timezone_name))
    except Exception:
        return now_utc


def suppression_reasons(case: Dict[str, Any], now_utc: Optional[datetime] = None) -> List[Tuple[str, str]]:
    """Return every reason this case must not be called right now. Empty list means callable."""
    now_utc = now_utc or datetime.now(timezone.utc)
    reasons: List[Tuple[str, str]] = []
    reasons.extend(destination_problems(case.get("hotline", ""), case.get("region", "")))
    if case.get("pending_call"):
        reasons.append(("pending_reconciliation", "A previous call was sent but never recorded; run `reconcile` before any new call."))
    if case["status"] in ("resolved", "denied", "abandoned"):
        reasons.append(("case_closed", f"Case is {case['status']}."))
    if case["status"] == "needs_human":
        reasons.append(("needs_human", "A human decision is pending; answer it in the dashboard first."))
    if case["status"] == "waiting_on_customer":
        reasons.append(("waiting_on_customer", "The company is waiting for the customer to act; calling again changes nothing."))
    calls = case.get("calls", [])
    if len(calls) >= MAX_TOTAL_CALLS:
        reasons.append(("call_budget", f"Total call budget of {MAX_TOTAL_CALLS} reached; escalate in writing instead."))
    today = now_utc.date().isoformat()
    todays = [c for c in calls if c.get("created_at", "").startswith(today)]
    if len(todays) >= MAX_CALLS_PER_DAY:
        reasons.append(("daily_cap", f"Already placed {len(todays)} call(s) today."))
    if calls:
        last = datetime.fromisoformat(calls[-1]["created_at"])
        if now_utc - last < timedelta(hours=MIN_HOURS_BETWEEN_CALLS):
            reasons.append(("too_soon", f"Last call was under {MIN_HOURS_BETWEEN_CALLS} hours ago."))
    nca = case.get("next_call_after")
    if nca and now_utc < datetime.fromisoformat(nca):
        reasons.append(("promise_pending", f"Company promised action; chase opens {nca[:10]}."))
    local = local_now(case.get("timezone", "UTC"), now_utc)
    if not (CALLING_WINDOW[0] <= local.hour < CALLING_WINDOW[1]) or local.weekday() >= 5:
        reasons.append(("quiet_hours", f"Local time {local.strftime('%a %H:%M')} is outside business hours in {case.get('timezone','UTC')}."))
    return reasons


def next_call_after(promise_by_date: Optional[str], now_utc: Optional[datetime] = None) -> str:
    """When to chase again: the promised date plus a grace period, or three business days from now."""
    now_utc = now_utc or datetime.now(timezone.utc)
    if promise_by_date:
        try:
            base = datetime.fromisoformat(promise_by_date).replace(tzinfo=timezone.utc)
            return (base + timedelta(days=GRACE_DAYS_AFTER_PROMISE)).replace(hour=9, minute=0, second=0).isoformat()
        except ValueError:
            pass
    d = now_utc
    added = 0
    while added < 3:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d.replace(hour=9, minute=0, second=0, microsecond=0).isoformat()
