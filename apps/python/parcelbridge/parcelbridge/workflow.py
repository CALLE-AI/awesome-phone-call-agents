"""Top-level workflow orchestration module.

This module glues together :mod:`parcelbridge.payload`,
:mod:`parcelbridge.fake_mcp`, and
:mod:`parcelbridge.sanitization`. The CLI's ``demo`` and
``validate`` subcommands call into this module so the CLI
itself stays thin and focused on argparse.

The workflow module exposes:

* :func:`run_offline_demo` — the canonical entry point for
  the offline synthetic demo.
* :func:`validate_payload` — runs the payload builder, the
  policy check, and the sanitizer's secret-shape detection
  on a candidate payload, returning a self-audit dict.
* :func:`validate_workflow` — returns a self-audit dict
  covering the entire workflow's invariants.

The workflow module **never** imports or references
``run_call``, ``get_call_run``, or ``track_ui_events``.
Those functions are intentionally absent from the package.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from parcelbridge.exceptions import (
    ArgumentViolationError,
    ParcelBridgeError,
    SanitizationViolationError,
)
from parcelbridge.fake_mcp import (
    FakeMcpPlanCallResult,
    InlineFakeMcpServer,
    run_fake_mcp_plan_call,
)
from parcelbridge.payload import (
    SCENARIOS,
    BusinessPayload,
    build_business_payload,
)
from parcelbridge.policy import (
    BANNED_PAYLOAD_SUBSTRINGS,
    BANNED_RESPONSE_SUBSTRINGS,
    SIDE_EFFECT_INVENTORY,
    is_payload_banned,
    validate_policy,
)
from parcelbridge.sanitization import (
    SanitizedResponse,
    sanitize_plan_response,
)


__all__ = [
    "run_offline_demo",
    "validate_payload",
    "validate_workflow",
    "BANNED_PAYLOAD_SUBSTRINGS",
    "BANNED_RESPONSE_SUBSTRINGS",
    "SIDE_EFFECT_INVENTORY",
]


def run_offline_demo(
    scenario: str = "gate-code-failure",
    language: str = "en-US",
    region: str = "US",
    server: Optional[InlineFakeMcpServer] = None,
) -> FakeMcpPlanCallResult:
    """Run the canonical offline synthetic demo.

    The demo is the default-mode behaviour of the reference
    app. It exercises the official CALL-E client code path
    *shape* without contacting any network endpoint. The
    output is sanitized and the capability values are
    reduced to length-only fingerprints.

    Parameters
    ----------
    scenario:
        A scenario name from :data:`SCENARIOS`.
    language:
        A BCP-47 language tag.
    region:
        An ISO 3166-1 alpha-2 region code.
    server:
        Optional pre-built :class:`InlineFakeMcpServer`
        instance. If omitted, a fresh instance is created.

    Returns
    -------
    FakeMcpPlanCallResult
        The sanitized response, the bridge mode label, and
        the outcome label.
    """

    payload = build_business_payload(
        scenario=scenario,
        language=language,
        region=region,
    )
    return run_fake_mcp_plan_call(payload, server=server)


def validate_payload(
    scenario: str,
    language: str = "en-US",
    region: str = "US",
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate a candidate payload without running any side effect.

    The function builds the payload, runs the policy
    module's denylist check, and returns a self-audit dict
    describing what was checked. It does not contact a
    network endpoint and does not invoke the sanitizer.

    Returns
    -------
    dict
        Mapping of check name to boolean (or string
        summary). Used by the CLI ``validate`` subcommand
        and by ``validate_workflow``.
    """

    checks: Dict[str, Any] = {}

    # 1. Scenario name is in the allow-list.
    checks["scenario_allowed"] = scenario in SCENARIOS
    checks["scenario_value"] = scenario

    # 2. Language tag has at least the language subtag.
    checks["language_has_subtag"] = (
        isinstance(language, str) and len(language) >= 2
    )
    checks["language_value"] = language

    # 3. Region tag is two-letter ASCII.
    checks["region_is_two_letter"] = (
        isinstance(region, str) and len(region) == 2 and region.isalpha()
    )
    checks["region_value"] = region

    # 4. The optional notes field does not contain banned
    #    substrings. If the field is absent, the check is
    #    vacuously True.
    if notes is None:
        checks["notes_field_absent"] = True
        checks["notes_banned"] = False
    else:
        checks["notes_field_absent"] = False
        checks["notes_banned"] = is_payload_banned(notes)
        if checks["notes_banned"]:
            # Raise the same exception that build_business_payload
            # would raise, so callers can use this function as a
            # dry-run.
            raise ArgumentViolationError(
                f"notes field contains a banned substring"
            )

    # 5. The payload can actually be constructed without
    #    raising. We catch ArgumentViolationError so the
    #    function can still return a partial report.
    try:
        build_business_payload(
            scenario=scenario,
            language=language,
            region=region,
            notes=notes,
        )
        checks["payload_build_succeeded"] = True
    except ArgumentViolationError as exc:
        checks["payload_build_succeeded"] = False
        checks["payload_build_error"] = str(exc)

    return checks


def validate_workflow() -> Dict[str, Any]:
    """Run the workflow's self-audit and return the report.

    The report contains:

    * the policy module's own self-audit,
    * a check that the inline fake MCP server reports the
      expected bridge mode,
    * a check that the workflow can be exercised without
      raising.

    The CLI's ``validate`` subcommand surfaces this report
    to operators. The defensive test suite also asserts
    each top-level invariant.
    """

    report: Dict[str, Any] = {}

    # 1. The policy module's own self-audit.
    report["policy"] = validate_policy()

    # 2. The inline fake MCP server reports the expected
    #    bridge mode label.
    server = InlineFakeMcpServer()
    report["fake_mcp_bridge_mode"] = server.bridge_mode == "offline"

    # 3. The default scenario can be exercised without
    #    raising.
    try:
        result = run_offline_demo()
        report["default_demo_outcome"] = result.outcome
        report["default_demo_succeeded"] = (
            result.outcome == "PASS_WITH_LIMITATION"
        )
        report["default_demo_fingerprints_present"] = (
            "confirm_token" in result.sanitized_response.fingerprints
        )
    except ParcelBridgeError as exc:
        report["default_demo_succeeded"] = False
        report["default_demo_error"] = str(exc)

    # 4. The package surface contains the expected names
    #    and does NOT contain the dial-path names.
    import parcelbridge as _pb  # noqa: WPS433 (intentional import-time audit)

    expected_present = {
        "run_offline_demo",
        "run_fake_mcp_plan_call",
        "InlineFakeMcpServer",
        "build_business_payload",
        "sanitize_plan_response",
    }
    report["expected_names_present"] = expected_present.issubset(
        set(dir(_pb))
    )

    forbidden_present = {
        "run_call",
        "get_call_run",
        "track_ui_events",
        "dial",
        "place_call",
    }
    forbidden_actually_present = forbidden_present & set(dir(_pb))
    report["dial_path_names_absent"] = not forbidden_actually_present
    if forbidden_actually_present:
        report["dial_path_names_found"] = sorted(forbidden_actually_present)

    return report


# Re-export the policy constants so callers that want a
# single import can pull them from ``workflow``.