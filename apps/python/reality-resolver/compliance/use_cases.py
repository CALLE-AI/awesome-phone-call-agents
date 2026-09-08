"""Filters a jurisdiction's generic compliance checks down to the ones
actually applicable to a given use case.

compliance/dispatcher.py and compliance/jurisdictions/*.py stay
purpose-agnostic: they produce the full set of checks for a phone
number regardless of why the call is being made. This module is the
one place that knows which of those checks are about commercial
solicitation specifically - and therefore do not apply to a
non-commercial use case like appointment_confirmation - versus
generically applicable regardless of purpose (AI-disclosure,
revocation, a documented legal basis for processing personal data).

Sourced from the multi-jurisdiction legal research: the calling-window
statutes (47 CFR 64.1200(c)(1), Oregon HB 3865), the prior-express-consent
requirements (US PEWC, EU/FR opt-in), the DNC/opposition-list scrubs, and
Oregon's solicitation-frequency cap are each scoped in their own text to
"telephone solicitation" / "telemarketing" / "demarchage telephonique" -
not to calls in general. A non-commercial call this app makes (resolving
a genuine factual uncertainty, at the recipient's own request or in their
own interest) falls outside that scope. AI-disclosure and revocation are
not scoped to solicitation in their source statutes and stay applicable
regardless of use case - see README's "Compliance by use case" section
for the full reasoning and its honest limits.

Adding a second use case means adding one entry to
_EXEMPT_SUFFIXES_BY_USE_CASE, not building a jurisdiction x use case
matrix.
"""

from __future__ import annotations

from .models import PreCallDecision


class UnknownUseCaseError(Exception):
    """Raised for a use_case with no known applicability rule. Fail-closed,
    same principle as dispatcher.UnknownJurisdictionError: an unmapped
    use_case must never silently keep every check (or drop every check).
    """


# Check-name suffixes tied specifically to commercial solicitation, shared
# across every jurisdiction module today (us_federal, us_oregon, fr).
_COMMERCIAL_SOLICITATION_SUFFIXES = (
    "_calling_window",
    "_consent",
    "_dnc_scrub",
    "_solicitation_cap",
)

# use_case -> which check-name suffixes do NOT apply to it. Every check
# not matching a listed suffix stays applicable regardless of use_case
# (today: AI-disclosure, revocation, GDPR basis, and jurisdiction
# resolution itself).
_EXEMPT_SUFFIXES_BY_USE_CASE: dict[str, tuple[str, ...]] = {
    "appointment_confirmation": _COMMERCIAL_SOLICITATION_SUFFIXES,
}


def apply_use_case(decision: PreCallDecision, use_case: str) -> PreCallDecision:
    """A new PreCallDecision containing only the checks applicable to
    use_case, with `allowed` recomputed from that subset alone.

    Fail-closed on an unmapped use_case (raises UnknownUseCaseError)
    and on an empty applicable set (allowed=False, not vacuously True) -
    same two fail-closed properties as run_precall_checks itself.
    """
    try:
        exempt_suffixes = _EXEMPT_SUFFIXES_BY_USE_CASE[use_case]
    except KeyError:
        raise UnknownUseCaseError(
            f"no compliance applicability rule for use_case {use_case!r}; fail-closed, refusing to call"
        ) from None

    applicable_results = tuple(
        result
        for result in decision.results
        if not any(result.check_name.endswith(suffix) for suffix in exempt_suffixes)
    )
    allowed = len(applicable_results) > 0 and all(result.passed for result in applicable_results)
    return PreCallDecision(allowed=allowed, jurisdiction_chain=decision.jurisdiction_chain, results=applicable_results)
