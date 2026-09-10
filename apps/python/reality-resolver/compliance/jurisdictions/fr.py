"""France jurisdiction rules (member-state variation on top of eu_common).

Sourced from the multi-jurisdiction legal research report (2026-08-27),
Section 4. Always used stacked on top of jurisdictions/eu_common.py for a
+33 number, never alone - see compliance/dispatcher.py.
"""

from __future__ import annotations

from datetime import datetime
from datetime import timezone as dt_timezone

from ..models import (
    CheckResult,
    ConfidenceLevel,
    JurisdictionRules,
    PreCallContext,
    RecordingConsentType,
)
from ..time_utils import UnknownTimezoneError, recipient_local_datetime

# Two sub-windows with a lunch gap - not representable by the single-range
# CallingWindow shape in models.py, so RULES.calling_window is left None
# below and this module enforces the real windows itself.
MORNING_WINDOW = (10, 13)
AFTERNOON_WINDOW = (14, 20)
ALLOWED_WEEKDAYS = range(0, 5)  # Monday=0 .. Friday=4

DISCLOSURE_SCRIPT = (
    "Bonjour, je suis [NOM_AGENT], l'assistant vocal IA de [ENTITE], et je vous appelle "
    "[RAISON_APPEL] "
    "Vous pouvez demander a parler a une personne ou raccrocher a tout moment."
)

RULES = JurisdictionRules(
    jurisdiction_id="fr",
    display_name="France",
    default_locale="fr-FR",
    region_code="FR",
    calling_window=None,  # real constraint is two sub-windows; see MORNING_WINDOW/AFTERNOON_WINDOW
    consent_required=True,
    disclosure_required=True,
    disclosure_script=DISCLOSURE_SCRIPT,
    dnc_check_required=True,
    recording_consent_type=RecordingConsentType.UNKNOWN,
    source_confidence=ConfidenceLevel.MEDIUM,  # public-holiday gap, see notes
    notes=(
        "Stacks on top of eu_common, never used alone. Opt-in required since "
        "2026-08-11 (Loi n. 2025-594). Fines up to EUR 375,000 per call "
        "(Consumer Code Art. L242-11), enforced jointly by CNIL and DGCCRF - "
        "informational only, not encoded as a check. "
        "GRAY AREA (medium confidence): French public holidays are not excluded "
        "from the calling window yet, only weekends - see check_calling_window."
    ),
)


def _now(context: PreCallContext) -> datetime:
    return context.now_utc or datetime.now(dt_timezone.utc)


def check_consent(context: PreCallContext) -> CheckResult:
    if not context.consent_obtained:
        return CheckResult(
            "fr_consent", False, "opt-in consent not documented (Loi n. 2025-594, effective 2026-08-11)"
        )
    return CheckResult("fr_consent", True, "opt-in consent documented")


def check_calling_window(context: PreCallContext) -> CheckResult:
    now_utc = _now(context)
    try:
        local_dt = recipient_local_datetime(now_utc, context.recipient_timezone)
    except UnknownTimezoneError as exc:
        return CheckResult("fr_calling_window", False, str(exc))

    if local_dt.weekday() not in ALLOWED_WEEKDAYS:
        return CheckResult(
            "fr_calling_window", False, f"{local_dt.strftime('%A')} is not an allowed calling day (weekdays only)"
        )

    hour = local_dt.hour
    in_morning = MORNING_WINDOW[0] <= hour < MORNING_WINDOW[1]
    in_afternoon = AFTERNOON_WINDOW[0] <= hour < AFTERNOON_WINDOW[1]
    if not (in_morning or in_afternoon):
        return CheckResult(
            "fr_calling_window",
            False,
            f"local time {local_dt.strftime('%H:%M')} is outside the allowed windows "
            f"({MORNING_WINDOW[0]}h-{MORNING_WINDOW[1]}h, {AFTERNOON_WINDOW[0]}h-{AFTERNOON_WINDOW[1]}h)",
        )

    return CheckResult(
        "fr_calling_window",
        True,
        f"local time {local_dt.strftime('%H:%M')} on {local_dt.strftime('%A')} is within an allowed window",
        confidence=ConfidenceLevel.MEDIUM,  # public-holiday gap applies to every pass, not just some
    )


def check_dnc_scrub(context: PreCallContext) -> CheckResult:
    if not context.dnc_checked:
        return CheckResult(
            "fr_dnc_scrub", False, "Bloctel/opposition list check not confirmed (dnc_checked=False)"
        )
    return CheckResult("fr_dnc_scrub", True, "Bloctel/opposition list check confirmed")


def check_revocation(context: PreCallContext) -> CheckResult:
    if context.do_not_call_requested:
        return CheckResult("fr_revocation", False, "do_not_call_requested is set; must not call")
    return CheckResult("fr_revocation", True, "no revocation on record")


def check(context: PreCallContext) -> list[CheckResult]:
    return [
        check_consent(context),
        check_calling_window(context),
        check_dnc_scrub(context),
        check_revocation(context),
    ]
