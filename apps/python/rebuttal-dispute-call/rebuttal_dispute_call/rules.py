"""The calling rules, as pure functions. CALL-E cannot recall a submitted call, so every rule runs before calls.create.

Each rule returns a blocking code or None. check_call() runs all of them and returns every code
that blocks, so an operator sees all the reasons at once. Ported from the calling rules in
Rebuttal's write-gate (rebuttal/gate.py), without the gate around them.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping

from .call import E164, authorized, build_task, local_hours_ok

NOT_E164 = "CALL_DESTINATION_NOT_E164"
NOT_ON_RECORD = "CALL_NUMBER_NOT_ON_RECORD"
NO_OPERATOR_INTENT = "CALL_WITHOUT_OPERATOR_INTENT"
NOT_AUTHORIZED = "CALL_DESTINATION_NOT_AUTHORIZED"
OUTSIDE_HOURS = "CALL_OUTSIDE_LOCAL_HOURS"
SCRIPT_NOT_FROM_TEMPLATE = "CALL_SCRIPT_NOT_FROM_TEMPLATE"
SECOND_CALL = "SECOND_CALL_TO_CUSTOMER"

RULES = (NOT_E164, NOT_ON_RECORD, NO_OPERATOR_INTENT, NOT_AUTHORIZED, OUTSIDE_HOURS, SCRIPT_NOT_FROM_TEMPLATE, SECOND_CALL)

MESSAGES = {
    NOT_E164: "the destination must be an E.164 number, for example +12125550101",
    NOT_ON_RECORD: "the destination is not the phone number on record for this order",
    NO_OPERATOR_INTENT: "a live call needs the operator's intent on this run: pass --i-have-consent",
    NOT_AUTHORIZED: "the destination is not listed in REBUTTAL_CALL_ALLOWLIST",
    OUTSIDE_HOURS: "the destination is outside 08:00-21:00 local time, or its country has no calling-hours rule",
    SCRIPT_NOT_FROM_TEMPLATE: "the task text is not exactly the fixed template",
    SECOND_CALL: "this dispute already has a live call on file",
}

BASE_URLS = ("https://api.heycall-e.com", "https://test-api.heycall-e.com")


def destination_e164(phone: str | None) -> str | None:
    return None if E164.fullmatch(phone or "") else NOT_E164


def number_on_record(phone: str | None, on_record: str | None) -> str | None:
    return NOT_ON_RECORD if not phone or phone != on_record else None


def operator_intent(live: bool, intent: bool) -> str | None:
    return NO_OPERATOR_INTENT if live and not intent else None


def destination_authorized(phone: str | None, allowlist: str | Iterable[str] | None, live: bool) -> str | None:
    if not live:
        return None
    items = allowlist if isinstance(allowlist, (str, type(None))) else set(allowlist)
    return None if authorized(phone or "", items) else NOT_AUTHORIZED


def local_hours(phone: str | None, now: datetime | None = None) -> str | None:
    ok, _ = local_hours_ok(phone or "", now)
    return None if ok else OUTSIDE_HOURS


def script_from_template(task: str | None, template_args: Mapping[str, Any] | None) -> str | None:
    try:
        expected = build_task(**dict(template_args or {}))
    except TypeError:
        return SCRIPT_NOT_FROM_TEMPLATE
    return None if task == expected else SCRIPT_NOT_FROM_TEMPLATE


def one_call_per_dispute(dispute_id: str, called: Iterable[str]) -> str | None:
    return SECOND_CALL if dispute_id in set(called) else None


def check_call(*, dispute_id: str, phone: str | None, on_record: str | None, task: str | None,
               template_args: Mapping[str, Any] | None, live: bool, intent: bool = False,
               allowlist: str | Iterable[str] | None = None, called: Iterable[str] = (),
               now: datetime | None = None) -> list[str]:
    """Every reason this call must not be placed. An empty list means every rule passed."""
    found = [
        destination_e164(phone),
        number_on_record(phone, on_record),
        operator_intent(live, intent),
        destination_authorized(phone, allowlist, live),
        local_hours(phone, now),
        script_from_template(task, template_args),
        one_call_per_dispute(dispute_id, called),
    ]
    return [code for code in found if code]


def base_url_allowed(url: str | None) -> bool:
    """The API key is only ever sent to CALL-E's own production or test API over HTTPS."""
    return (url or BASE_URLS[0]).strip().rstrip("/") in BASE_URLS
