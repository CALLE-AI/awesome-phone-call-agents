"""Whether this call may be placed at all. Checked before CALL-E is ever reached.

CALL-E is integrated *behind* these rules, not around them. If this module says
no, no plan is created, no run is started, and no telephone rings. That ordering
is the whole difference between a system that calls organizations and a system
that calls organizations it has permission to call.

Five gates, in the order they are cheapest to fail:

1. **The destination allowlist.** A live call may only reach a number that has
   been explicitly authorised for this deployment. An empty allowlist means no
   live call can be placed at all, which is the default. This is the gate that
   makes it impossible to point a demo at a stranger by mistake.
2. **Permanent suppression.** One "stop calling" is permanent and applies to
   every service that organization runs, not just the one under verification.
3. **Recorded consent**, with a validity window, a day-of-week set, and a
   local-time window in the organization's own timezone.
4. **A call cap** that the consent record itself carries, decremented in the
   same transaction that reserves the call.
5. **Spacing**, so a busy queue cannot phone one small charity twice in a day.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

DAY_CODES = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


@dataclass(frozen=True, slots=True)
class Eligibility:
    allowed: bool
    reason: str
    consent_id: str = ""
    destination: str = ""

    def __bool__(self) -> bool:
        return self.allowed


def normalise_number(number: str) -> str:
    """Compare phone numbers by their digits, not their punctuation."""
    return "+" + "".join(character for character in str(number or "") if character.isdigit())


def parse_allowlist(raw: str) -> list[str]:
    """Read `CBR_CALL_ALLOWLIST`. Blank means no live destination is permitted."""
    return [normalise_number(item) for item in str(raw or "").split(",") if item.strip()]


def allowlist_permits(number: str, allowlist: list[str]) -> bool:
    if not allowlist:
        return False
    return normalise_number(number) in allowlist


def consent_permits(consent: dict[str, Any] | Any, at: datetime | None = None) -> tuple[bool, str]:
    """Whether one consent record covers a call placed at this instant.

    The window is evaluated in the organization's timezone, not the server's,
    because "not before nine" means nine where the phone is.
    """
    at = at or datetime.now(UTC)
    try:
        local = at.astimezone(ZoneInfo(consent["timezone"]))
    except Exception:
        return False, f"consent has an unusable timezone {consent['timezone']!r}"

    if consent["status"] != "active":
        return False, f"consent is {consent['status']}"
    if consent["calls_placed"] >= consent["max_calls"]:
        return False, "the consented call allowance is used up"

    local_date = local.date().isoformat()
    if not (consent["valid_from"] <= local_date <= consent["valid_until"]):
        return False, f"consent is valid {consent['valid_from']} to {consent['valid_until']}"

    allowed_days = json.loads(consent["allowed_days_json"])
    if DAY_CODES[local.weekday()] not in allowed_days:
        return False, f"{DAY_CODES[local.weekday()]} is not a consented calling day"

    local_time = local.strftime("%H:%M")
    earliest, latest = consent["earliest_local"], consent["latest_local"]
    in_window = (
        earliest <= local_time <= latest
        if earliest <= latest
        else local_time >= earliest or local_time <= latest
    )
    if not in_window:
        return False, f"{local_time} local is outside the consented window {earliest}-{latest}"
    return True, "consented"


def spacing_permits(
    last_call_at: str | None, *, minimum_interval_days: int, at: datetime | None = None
) -> tuple[bool, str]:
    at = at or datetime.now(UTC)
    if not last_call_at:
        return True, "no recent call to this organization"
    try:
        previous = datetime.fromisoformat(last_call_at)
    except ValueError:
        return True, "no readable recent call"
    if previous.tzinfo is None:
        previous = previous.replace(tzinfo=UTC)
    next_allowed = previous + timedelta(days=minimum_interval_days)
    if at < next_allowed:
        return False, f"this organization is not callable again before {next_allowed.isoformat(timespec='seconds')}"
    return True, "spacing satisfied"


def evaluate(
    *,
    destination: str,
    allowlist: list[str],
    live: bool,
    do_not_call: bool,
    consents: list[Any],
    last_call_at: str | None,
    minimum_interval_days: int,
    at: datetime | None = None,
) -> Eligibility:
    """Run every gate and name the first one that refuses."""
    at = at or datetime.now(UTC)

    if do_not_call:
        return Eligibility(False, "this organization asked never to be called again")

    if live and not allowlist_permits(destination, allowlist):
        return Eligibility(
            False,
            "the destination is not on this deployment's call allowlist, so no live call can be "
            "placed to it",
        )

    spaced, spacing_reason = spacing_permits(
        last_call_at, minimum_interval_days=minimum_interval_days, at=at
    )
    if not spaced:
        return Eligibility(False, spacing_reason)

    refusals: list[str] = []
    for consent in consents:
        permitted, reason = consent_permits(consent, at)
        if permitted:
            return Eligibility(True, "consented", consent["id"], consent["phone_number"])
        refusals.append(reason)

    if not refusals:
        return Eligibility(False, "no consent to call this organization has been recorded")
    return Eligibility(False, f"no consent permits a call now ({refusals[0]})")
