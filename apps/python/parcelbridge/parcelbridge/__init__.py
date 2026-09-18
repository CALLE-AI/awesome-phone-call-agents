"""ParcelBridge — refusal-first reference app for AI phone-agent integration.

This is the public, sanitized reference app extracted from the
ParcelBridge hackathon prototype. It is intended for inclusion in the
awesome-phone-call-agents curated list under
``apps/python/parcelbridge/``.

Public surface
--------------

The package exposes:

* ``python -m parcelbridge.cli demo --offline ...`` — the default
  offline synthetic demo.
* ``python -m parcelbridge.cli validate ...`` — workflow self-audit.
* :func:`run_offline_demo` — programmatic entry to the demo.
* :func:`validate_workflow` — programmatic self-audit.

Non-goals
---------

This package **does not** ship:

* real phone numbers,
* OAuth tokens, plan IDs, confirm tokens, or run IDs,
* live endpoint URLs, hostnames, or ports,
* recipient file content,
* audit reports or runtime artifacts from the originating prototype.

The package is governed by ``docs/DISCLOSURE.md`` at the bundle root.
"""

from parcelbridge.exceptions import (
    ParcelBridgeError,
    LiveModeRefusedError,
    ArgumentViolationError,
    SanitizationViolationError,
)
from parcelbridge.live_stub import (
    LiveStubResult,
    raise_live_mode_refused,
    run_live_stub_plan_call,
)
from parcelbridge.fake_mcp import (
    FakeMcpPlanCallResult,
    InlineFakeMcpServer,
    run_fake_mcp_plan_call,
)
from parcelbridge.offline import (
    OfflinePlanCallResult,
    run_offline_plan_call,
)
from parcelbridge.payload import (
    BusinessPayload,
    SCENARIOS,
    build_business_payload,
)
from parcelbridge.policy import (
    BANNED_PAYLOAD_SUBSTRINGS,
    BANNED_RESPONSE_SUBSTRINGS,
    SIDE_EFFECT_INVENTORY,
    is_payload_banned,
    is_response_banned,
    validate_policy,
)
from parcelbridge.sanitization import (
    SanitizedResponse,
    length_fingerprint,
    sanitize_plan_response,
)
from parcelbridge.sanitizer import (  # noqa: F401 (backwards-compat re-export)
    SanitizedResponse as _SanitizedResponseShim,
    length_fingerprint as _length_fingerprint_shim,
    sanitize_plan_response as _sanitize_plan_response_shim,
)
from parcelbridge.workflow import (
    run_offline_demo,
    validate_payload,
    validate_workflow,
)

__all__ = [
    # Errors
    "ParcelBridgeError",
    "LiveModeRefusedError",
    "ArgumentViolationError",
    "SanitizationViolationError",
    # Live-mode stub
    "LiveStubResult",
    "raise_live_mode_refused",
    "run_live_stub_plan_call",
    # Fake MCP server (canonical)
    "FakeMcpPlanCallResult",
    "InlineFakeMcpServer",
    "run_fake_mcp_plan_call",
    # Offline shim (backwards-compat)
    "OfflinePlanCallResult",
    "run_offline_plan_call",
    # Payload
    "BusinessPayload",
    "SCENARIOS",
    "build_business_payload",
    # Policy
    "BANNED_PAYLOAD_SUBSTRINGS",
    "BANNED_RESPONSE_SUBSTRINGS",
    "SIDE_EFFECT_INVENTORY",
    "is_payload_banned",
    "is_response_banned",
    "validate_policy",
    # Sanitization (canonical)
    "SanitizedResponse",
    "length_fingerprint",
    "sanitize_plan_response",
    # Workflow
    "run_offline_demo",
    "validate_payload",
    "validate_workflow",
]

__version__ = "0.1.0-public-ref"