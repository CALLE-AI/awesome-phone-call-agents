"""Oregon jurisdiction rules (state-level variation on top of us_federal).

Sourced from the multi-jurisdiction legal research follow-up
(2026-08-29): Oregon HB 3865, effective 2026-01-01, tightens the federal
8am-9pm calling window to 8am-8pm and caps solicitations (calls AND
texts combined) at 3 per rolling 24 hours.

This is the first US state-level variation in this app. +1 alone does
not identify a state, so this module is routed by area code rather than
country code - see compliance/dispatcher.py's
_US_STATE_AREA_CODE_OVERLAY for how a +1 number reaches here, and how a
second state would be added the same way.

Always used stacked on top of jurisdictions/us_federal.py for an Oregon
area code, never alone - see compliance/dispatcher.py.
"""

from __future__ import annotations

from datetime import datetime
from datetime import timezone as dt_timezone

from ..models import (
    CallingWindow,
    CheckResult,
    ConfidenceLevel,
    JurisdictionRules,
    PreCallContext,
    RecordingConsentType,
)
from ..time_utils import UnknownTimezoneError, recipient_local_datetime

WINDOW_START_HOUR = 8
WINDOW_END_HOUR = 20  # exclusive; Oregon HB 3865, stricter than the federal 8am-9pm window
MAX_SOLICITATIONS_PER_24H = 3  # calls AND texts combined per HB 3865; this app only ever sees the calls it places itself

RULES = JurisdictionRules(
    jurisdiction_id="us_oregon",
    display_name="Oregon (stacks on US federal)",
    default_locale="en-US",
    region_code="US",
    calling_window=CallingWindow(start_local_hour=WINDOW_START_HOUR, end_local_hour=WINDOW_END_HOUR),
    consent_required=True,
    disclosure_required=True,
    disclosure_script=None,  # inherits us_federal's disclosure_script; no additional Oregon-specific script was found in this research pass
    dnc_check_required=True,
    recording_consent_type=RecordingConsentType.UNKNOWN,  # Oregon's own recording-consent statute (ORS 165.540) was not researched in this pass
    source_confidence=ConfidenceLevel.MEDIUM,
    notes=(
        "Stacks on top of us_federal, never used alone. Routed by area code "
        "(503/541/971/458), not country code - see compliance/dispatcher.py. "
        "GRAY AREA (medium confidence): the solicitation cap counts calls and "
        "texts combined under HB 3865, but this app only tracks the calls it "
        "places itself, via the operator-attested solicitations_in_last_24h "
        "field - see check_solicitation_cap. Oregon's own recording-consent "
        "rule was not researched in this pass; recording_consent_type is left "
        "UNKNOWN rather than guessed."
    ),
)


def _now(context: PreCallContext) -> datetime:
    return context.now_utc or datetime.now(dt_timezone.utc)


def check_calling_window(context: PreCallContext) -> CheckResult:
    now_utc = _now(context)
    try:
        local_dt = recipient_local_datetime(now_utc, context.recipient_timezone)
    except UnknownTimezoneError as exc:
        return CheckResult("us_oregon_calling_window", False, str(exc))

    in_window = WINDOW_START_HOUR <= local_dt.hour < WINDOW_END_HOUR
    if in_window:
        return CheckResult(
            "us_oregon_calling_window",
            True,
            f"recipient local time {local_dt.strftime('%H:%M')} is within "
            f"{WINDOW_START_HOUR}:00-{WINDOW_END_HOUR}:00 (Oregon HB 3865)",
        )
    return CheckResult(
        "us_oregon_calling_window",
        False,
        f"recipient local time {local_dt.strftime('%H:%M')} is outside "
        f"{WINDOW_START_HOUR}:00-{WINDOW_END_HOUR}:00 (Oregon HB 3865, stricter than the federal 8am-9pm window)",
    )


def check_solicitation_cap(context: PreCallContext) -> CheckResult:
    if context.solicitations_in_last_24h is None:
        return CheckResult(
            "us_oregon_solicitation_cap",
            False,
            "solicitations_in_last_24h not attested; Oregon HB 3865 caps contact at "
            f"{MAX_SOLICITATIONS_PER_24H} per 24h (calls and texts combined) and this cannot "
            "be evaluated without it",
        )
    if context.solicitations_in_last_24h >= MAX_SOLICITATIONS_PER_24H:
        return CheckResult(
            "us_oregon_solicitation_cap",
            False,
            f"{context.solicitations_in_last_24h} solicitations already recorded in the last 24h "
            f"(Oregon HB 3865 caps this at {MAX_SOLICITATIONS_PER_24H}, calls and texts combined)",
        )
    return CheckResult(
        "us_oregon_solicitation_cap",
        True,
        f"{context.solicitations_in_last_24h} of {MAX_SOLICITATIONS_PER_24H} allowed solicitations "
        "used in the last 24h (Oregon HB 3865)",
    )


def check_revocation(context: PreCallContext) -> CheckResult:
    if context.do_not_call_requested:
        return CheckResult("us_oregon_revocation", False, "do_not_call_requested is set; must not call")
    return CheckResult("us_oregon_revocation", True, "no revocation on record")


def check(context: PreCallContext) -> list[CheckResult]:
    return [
        check_calling_window(context),
        check_solicitation_cap(context),
        check_revocation(context),
    ]
