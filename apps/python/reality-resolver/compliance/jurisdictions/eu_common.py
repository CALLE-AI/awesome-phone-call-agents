"""EU-wide jurisdiction rules (AI Act Art. 50 / ePrivacy Art. 13 / GDPR baseline).

Sourced from the multi-jurisdiction legal research report (2026-08-27),
Section 3. Always used stacked with a member-state module (see fr.py),
never alone - see compliance/dispatcher.py.
"""

from __future__ import annotations

from ..models import (
    CheckResult,
    ConfidenceLevel,
    JurisdictionRules,
    PreCallContext,
    RecordingConsentType,
)

DISCLOSURE_SCRIPT = (
    "Hello, I'm [AGENT_NAME], an artificial intelligence voice assistant calling on behalf "
    "of [ENTITY], and I'm calling [REASON_FOR_CALLING] "
    "You can ask to speak with a person or end this call at any time."
)

RULES = JurisdictionRules(
    jurisdiction_id="eu_common",
    display_name="European Union (bloc-wide baseline)",
    default_locale="en-US",  # no single EU-wide default locale; member-state layer sets its own
    region_code=None,  # bloc-wide; no single country code
    calling_window=None,  # EU-wide floor does not set one; member states do
    consent_required=True,
    disclosure_required=True,
    disclosure_script=DISCLOSURE_SCRIPT,
    dnc_check_required=False,  # national lists are a member-state layer, not EU-wide
    recording_consent_type=RecordingConsentType.UNKNOWN,
    source_confidence=ConfidenceLevel.MEDIUM,  # 13(1) vs 13(3) applicability is a gray area
    notes=(
        "GRAY AREA (medium confidence): whether a conversational AI agent counts as "
        "an 'automatic calling machine' under ePrivacy Art. 13(1) (strict EU-wide "
        "opt-in) or falls under the softer per-country Art. 13(3) discretion for "
        "live calls is not definitively settled. This module defaults to the "
        "stricter 13(1) reading and always requires opt-in - see check_consent."
    ),
)


def check_ai_disclosure() -> CheckResult:
    if "artificial intelligence" not in DISCLOSURE_SCRIPT.lower():
        return CheckResult(
            "eu_common_ai_disclosure",
            False,
            "disclosure_script does not clearly state an AI system is speaking "
            "(AI Act Art. 50, in force since 2026-08-02)",
        )
    return CheckResult(
        "eu_common_ai_disclosure", True, "disclosure_script discloses the AI interaction per AI Act Art. 50"
    )


def check_consent(context: PreCallContext) -> CheckResult:
    if not context.consent_obtained:
        return CheckResult(
            "eu_common_consent",
            False,
            "prior opt-in consent not documented (ePrivacy Art. 13(1) reading; consent_obtained=False)",
            confidence=ConfidenceLevel.MEDIUM,
        )
    return CheckResult(
        "eu_common_consent",
        True,
        "opt-in consent documented",
        confidence=ConfidenceLevel.MEDIUM,
    )


def check_gdpr_basis(context: PreCallContext) -> CheckResult:
    if not context.gdpr_basis_documented:
        return CheckResult(
            "eu_common_gdpr_basis", False, "GDPR Art. 6 lawful basis not documented (gdpr_basis_documented=False)"
        )
    return CheckResult("eu_common_gdpr_basis", True, "GDPR Art. 6 lawful basis documented")


def check_revocation(context: PreCallContext) -> CheckResult:
    if context.do_not_call_requested:
        return CheckResult("eu_common_revocation", False, "do_not_call_requested is set; must not call")
    return CheckResult("eu_common_revocation", True, "no revocation on record")


def check(context: PreCallContext) -> list[CheckResult]:
    return [
        check_ai_disclosure(),
        check_consent(context),
        check_gdpr_basis(context),
        check_revocation(context),
    ]
