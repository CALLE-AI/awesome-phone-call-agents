"""Resolves a phone number to its applicable jurisdictions and runs every
jurisdiction's pre-call checks. Fail-closed: any unknown jurisdiction, any
missing rule, or any single failing check blocks the call. There is no
default-allow path anywhere in this module.
"""

from __future__ import annotations

from .jurisdictions import eu_common, fr, us_federal, us_oregon
from .models import CheckResult, PreCallContext, PreCallDecision

# Country-code prefix -> ordered jurisdiction chain (broad to narrow).
#
# KNOWN LIMITATION: "+1" is the shared NANP calling code for the United
# States, Canada, and over twenty Caribbean territories - it does not
# uniquely identify the United States. Disambiguating all of NANP requires
# a full area-code-to-country lookup table this app does not have yet, so
# every "+1" number not matched by _US_STATE_AREA_CODE_OVERLAY below is
# still routed to us_federal alone. A Canadian or Caribbean NANP number
# will incorrectly be evaluated against US federal rules until that
# broader table exists. "+33" (France) has no such ambiguity: EU country
# calling codes are one-to-one with a single country.
_COUNTRY_CODE_CHAINS: dict[str, tuple[str, ...]] = {
    "+1": ("us_federal",),
    "+33": ("eu_common", "fr"),
}

# US state-level overlay, keyed by area code (NPA) since +1 alone cannot
# distinguish states (see the NANP limitation above). Appended after the
# base "+1" chain, the same way "fr" stacks after "eu_common". Area codes
# are unique across all of NANP, so this does not add to the Canada/
# Caribbean ambiguity - it only ever matches genuinely Oregon numbers.
# Oregon is the first entry; a second state means adding its area codes
# here, not changing the resolution logic below.
_US_STATE_AREA_CODE_OVERLAY: dict[str, str] = {
    "503": "us_oregon",
    "541": "us_oregon",
    "971": "us_oregon",
    "458": "us_oregon",
}

_MODULES = {
    "us_federal": us_federal,
    "eu_common": eu_common,
    "fr": fr,
    "us_oregon": us_oregon,
}


class UnknownJurisdictionError(Exception):
    """Raised when a phone number's country code has no mapped ruleset."""


def resolve_jurisdiction_chain(phone_e164: str) -> tuple[str, ...]:
    for prefix, chain in _COUNTRY_CODE_CHAINS.items():
        if not phone_e164.startswith(prefix):
            continue
        if prefix == "+1":
            area_code = phone_e164[len(prefix) : len(prefix) + 3]
            state_jurisdiction = _US_STATE_AREA_CODE_OVERLAY.get(area_code)
            if state_jurisdiction is not None:
                return chain + (state_jurisdiction,)
        return chain
    raise UnknownJurisdictionError(
        f"no jurisdiction mapped for {phone_e164!r}; fail-closed, refusing to call"
    )


def resolve_locale_and_region(
    jurisdiction_chain: tuple[str, ...]
) -> tuple[str | None, str | None, str | None]:
    """Locale/region/disclosure_script for the CALL-E recipient, derived
    from a resolved jurisdiction chain - never a caller-supplied override.

    Locale comes from the narrowest (last) jurisdiction in the chain.
    Region and disclosure_script each come from the narrowest
    jurisdiction that actually defines one, scanning from the end of the
    chain backward (a bloc-wide entry like eu_common has no region_code,
    and a state-level entry like us_oregon has no disclosure_script of
    its own - both are skipped in favor of the next jurisdiction out).
    """
    if not jurisdiction_chain:
        return None, None, None
    locale = _MODULES[jurisdiction_chain[-1]].RULES.default_locale
    region = None
    disclosure_script = None
    for jurisdiction_id in reversed(jurisdiction_chain):
        rules = _MODULES[jurisdiction_id].RULES
        if region is None and rules.region_code is not None:
            region = rules.region_code
        if disclosure_script is None and rules.disclosure_script is not None:
            disclosure_script = rules.disclosure_script
        if region is not None and disclosure_script is not None:
            break
    return locale, region, disclosure_script


def run_precall_checks(context: PreCallContext) -> PreCallDecision:
    try:
        chain = resolve_jurisdiction_chain(context.phone_e164)
    except UnknownJurisdictionError as exc:
        blocked_result = CheckResult(
            check_name="jurisdiction_resolved",
            passed=False,
            reason=str(exc),
        )
        return PreCallDecision(allowed=False, jurisdiction_chain=(), results=(blocked_result,))

    all_results: list[CheckResult] = []
    for jurisdiction_id in chain:
        module = _MODULES[jurisdiction_id]
        all_results.extend(module.check(context))

    # Fail-closed even if a jurisdiction's check() returns an empty list:
    # zero results means nothing was actually verified, so allowed stays
    # False rather than vacuously True.
    allowed = len(all_results) > 0 and all(result.passed for result in all_results)
    return PreCallDecision(allowed=allowed, jurisdiction_chain=chain, results=tuple(all_results))
