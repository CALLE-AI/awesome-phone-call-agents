"""Authoritative CALL-E Developer API contract constants.

Sourced from CALLE-AI/calle-docs OpenAPI v0.6.0 (main branch).
"""

from __future__ import annotations

OFFICIAL_OPENAPI_URL = (
    "https://github.com/CALLE-AI/calle-docs/blob/main/openapi/calle.openapi.yaml"
)
OFFICIAL_DOCS_REPO = "https://github.com/CALLE-AI/calle-docs"
OFFICIAL_OPENAPI_RAW = (
    "https://raw.githubusercontent.com/CALLE-AI/calle-docs/main/openapi/calle.openapi.yaml"
)
OFFICIAL_AUTH_GUIDE = (
    "https://github.com/CALLE-AI/calle-docs/blob/main/content/guides/authentication.mdx"
)
OFFICIAL_CALLS_GUIDE = (
    "https://github.com/CALLE-AI/calle-docs/blob/main/content/guides/calls.mdx"
)
OFFICIAL_SDKS_GUIDE = (
    "https://github.com/CALLE-AI/calle-docs/blob/main/content/guides/sdks.mdx"
)

API_VERSION = "0.6.0"
BASE_URL_DEFAULT = "https://api.heycall-e.com"
AUTH_ENV_VAR = "CALLE_API_KEY"
BASE_URL_ENV_VAR = "CALLE_BASE_URL"
IDEMPOTENCY_HEADER = "Idempotency-Key"

CREATE_CALL_METHOD = "POST"
CREATE_CALL_PATH = "/v1/calls"
GET_CALL_PATH_TEMPLATE = "/v1/calls/{call_id}"
GET_CALL_EVENTS_PATH_TEMPLATE = "/v1/calls/{call_id}/events"

CALL_STATUSES = frozenset({"queued", "in_progress", "completed", "failed", "canceled"})
RECIPIENT_STATUSES = frozenset({"pending", "in_progress", "completed", "failed", "skipped"})
CALL_ID_FIELD = "id"
TERMINAL_CALL_STATUSES = frozenset({"completed", "failed", "canceled"})
NON_TERMINAL_CALL_STATUSES = frozenset({"queued", "in_progress"})
POLL_INTERVAL_SECONDS = 2.0
POLL_MAX_ATTEMPTS = 90

IMPLEMENTATION_STATE_READY = (
    "API_INTEGRATION_COMPLETE_AWAITING_CREDENTIAL_AND_LIVE_CALL_AUTHORIZATION"
)
IMPLEMENTATION_STATE_BLOCKED = "BLOCKED_PENDING_AUTHORITATIVE_CALL_E_API_INTEGRATION"

ACCESSLINE_RECIPIENT_RESULT_SCHEMA: dict = {
    "type": "object",
    "required": [
        "step_free_entrance",
        "accessible_restroom",
        "access_instructions",
        "uncertainty_notes",
    ],
    "properties": {
        "step_free_entrance": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes when staff clearly confirms a step-free public entrance. "
                "Use no when they clearly deny it. Use unknown if unclear."
            ),
        },
        "accessible_restroom": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes when an accessible restroom is clearly available for visitors. "
                "Use no when clearly unavailable. Use unknown if unclear."
            ),
        },
        "access_instructions": {
            "type": "string",
            "description": (
                "Any access limitations or arrival instructions stated by staff. "
                "Use an empty string if none were provided."
            ),
        },
        "uncertainty_notes": {
            "type": "string",
            "description": (
                "Note any ambiguous, unverified, or missing answers without inventing facts."
            ),
        },
    },
    "additionalProperties": False,
}
