from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections.abc import Mapping
from typing import Any

from calle import CalleClient


logger = logging.getLogger(__name__)


# ============================================================
# LIVE-CALL SAFETY CONTROLS
# ============================================================
#
# CALL-E calls can consume credits and create real-world side effects.
#
# This service intentionally:
# - places at most one call per start_call() invocation;
# - performs no automatic redial;
# - blocks duplicate concurrent calls;
# - applies a cooldown between calls;
# - limits live calls per backend process;
# - requires explicit live-call enablement through .env.
#
# Restarting the backend resets the in-process call counter.
# ============================================================

_CALL_LOCK = threading.Lock()
_LAST_CALL_STARTED_AT = 0.0
_LIVE_CALL_COUNT = 0


# ============================================================
# ENVIRONMENT HELPERS
# ============================================================

def _env_bool(
    name: str,
    default: bool = False,
) -> bool:
    """Read a boolean environment variable safely."""

    raw_value = os.getenv(
        name,
        str(default),
    ).strip().lower()

    return raw_value in {
        "1",
        "true",
        "yes",
        "on",
    }


def _env_int(
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    """Read and bound an integer environment variable."""

    raw_value = os.getenv(
        name,
        str(default),
    ).strip()

    try:
        value = int(raw_value)

    except ValueError:
        logger.warning(
            "Invalid value for %s. Using default %s.",
            name,
            default,
        )
        return default

    return max(
        minimum,
        min(value, maximum),
    )


def _get_api_key() -> str | None:
    """Return a real CALL-E API key or None for empty placeholders."""

    api_key = os.getenv(
        "CALLE_API_KEY",
        "",
    ).strip()

    invalid_values = {
        "",
        "NOT_USED",
        "YOUR_CALLE_API_KEY",
        "YOUR_CALL_E_API_KEY",
        "YOUR_NEW_ROTATED_CALLE_KEY",
    }

    if api_key in invalid_values:
        return None

    return api_key


# ============================================================
# GENERIC HELPERS
# ============================================================

def _clean_text(value: Any) -> str:
    """Normalize whitespace without changing meaning."""

    return " ".join(
        str(value or "").split()
    ).strip()


def _mask_phone(phone: str) -> str:
    """Mask a phone number before writing it to logs."""

    clean_phone = phone.strip()

    if len(clean_phone) <= 4:
        return "****"

    return (
        "*" * (len(clean_phone) - 4)
        + clean_phone[-4:]
    )


def _validate_phone(phone: str) -> str:
    """
    Validate basic E.164 formatting.

    The caller must use only a phone number they own or are authorized
    to contact.
    """

    clean_phone = re.sub(
        r"[\s()-]",
        "",
        phone.strip(),
    )

    if not clean_phone:
        raise ValueError(
            "The on-call phone number is missing."
        )

    if not clean_phone.startswith("+"):
        raise ValueError(
            "The phone number must use E.164 format "
            "and begin with '+'."
        )

    digits = clean_phone[1:]

    if not digits.isdigit():
        raise ValueError(
            "The phone number contains unsupported characters."
        )

    if not 8 <= len(digits) <= 15:
        raise ValueError(
            "The phone number length is invalid for E.164 format."
        )

    return clean_phone


def _to_dictionary(value: Any) -> dict[str, Any]:
    """
    Convert common CALL-E SDK response objects into a dictionary.
    """

    if value is None:
        return {}

    if isinstance(value, dict):
        return value

    if isinstance(value, Mapping):
        return dict(value)

    model_dump = getattr(
        value,
        "model_dump",
        None,
    )

    if callable(model_dump):
        try:
            dumped = model_dump(
                mode="json",
            )

        except TypeError:
            dumped = model_dump()

        if isinstance(dumped, dict):
            return dumped

    to_dict = getattr(
        value,
        "to_dict",
        None,
    )

    if callable(to_dict):
        dumped = to_dict()

        if isinstance(dumped, dict):
            return dumped

    object_values = getattr(
        value,
        "__dict__",
        None,
    )

    if isinstance(object_values, dict):
        return {
            key: item
            for key, item in object_values.items()
            if not key.startswith("_")
        }

    try:
        return dict(value)

    except (TypeError, ValueError):
        return {
            "raw_value": str(value),
        }


def _find_value(
    data: Any,
    candidate_keys: tuple[str, ...],
    *,
    max_depth: int = 5,
) -> Any:
    """
    Recursively find the first matching key in a nested response.
    """

    if max_depth < 0:
        return None

    if isinstance(data, Mapping):
        for key in candidate_keys:
            if key in data and data[key] is not None:
                return data[key]

        for value in data.values():
            found = _find_value(
                value,
                candidate_keys,
                max_depth=max_depth - 1,
            )

            if found is not None:
                return found

    elif isinstance(data, list):
        for value in data:
            found = _find_value(
                value,
                candidate_keys,
                max_depth=max_depth - 1,
            )

            if found is not None:
                return found

    return None


def _collect_text(
    value: Any,
    *,
    max_depth: int = 5,
) -> str:
    """Collect human-readable text from nested result data."""

    if max_depth < 0 or value is None:
        return ""

    if isinstance(value, str):
        return value

    if isinstance(value, Mapping):
        parts = [
            _collect_text(
                item,
                max_depth=max_depth - 1,
            )
            for item in value.values()
        ]

        return " ".join(
            part
            for part in parts
            if part
        )

    if isinstance(value, list):
        parts = [
            _collect_text(
                item,
                max_depth=max_depth - 1,
            )
            for item in value
        ]

        return " ".join(
            part
            for part in parts
            if part
        )

    return str(value)


def _normalize_status(value: Any) -> str:
    """Normalize a provider status into an application-safe value."""

    status = _clean_text(
        value
    ).upper().replace(
        " ",
        "_",
    ).replace(
        "-",
        "_",
    )

    return status or "UNKNOWN"


def _as_bool(value: Any) -> bool:
    """Convert common boolean-like SDK values."""

    if isinstance(value, bool):
        return value

    normalized = _clean_text(
        value
    ).lower()

    return normalized in {
        "true",
        "1",
        "yes",
        "completed",
        "success",
        "succeeded",
    }


# ============================================================
# CALL-E OUTCOME EXTRACTION
# ============================================================

def _get_outcome_only_data(
    call_data: dict[str, Any],
) -> dict[str, Any]:
    """
    Build a reduced response containing only provider outcomes.

    The original task prompt is intentionally excluded because it
    contains instructions such as "ask the engineer to acknowledge",
    which must not be mistaken for an actual acknowledgement.
    """

    return {
        "status": call_data.get("status"),
        "summary": call_data.get("summary"),
        "task_completed": call_data.get("task_completed"),
        "completion_confidence": call_data.get(
            "completion_confidence"
        ),
        "evidence": call_data.get("evidence"),
        "failure_code": call_data.get("failure_code"),
        "failure_message": call_data.get(
            "failure_message"
        ),
        "recipients": call_data.get("recipients"),
    }


def _infer_acknowledgement(
    call_data: dict[str, Any],
) -> str:
    """
    Infer acknowledgement only from CALL-E outcome evidence.

    Returns:
        "yes"     explicit acknowledgement;
        "no"      confirmed lack of response or explicit rejection;
        "unknown" insufficient evidence.

    Important:
    The task prompt is never used for this decision.
    """

    outcome_data = _get_outcome_only_data(
        call_data
    )

    explicit_value = _find_value(
        outcome_data,
        (
            "acknowledged",
            "acknowledgement",
            "engineer_acknowledged",
            "incident_acknowledged",
        ),
    )

    if explicit_value is not None:
        explicit_text = _clean_text(
            explicit_value
        ).lower()

        if explicit_text in {
            "yes",
            "true",
            "acknowledged",
            "accepted",
        }:
            return "yes"

        if explicit_text in {
            "no",
            "false",
            "declined",
            "rejected",
        }:
            return "no"

    outcome_text = _clean_text(
        _collect_text(
            outcome_data
        )
    ).lower()

    # Check negative evidence first.
    negative_patterns = (
        "no live response",
        "no acknowledgement was received",
        "acknowledgement and ownership remain unknown",
        "only the automated incidentops ai caller",
        "only the automated",
        "only the bot",
        "no engineer response",
        "no recipient response",
        "no answer",
        "not answered",
        "recipient may be busy",
        "recipient may be unavailable",
        "did not acknowledge",
        "didn't acknowledge",
        "declined ownership",
        "did not accept ownership",
        "no voicemail delivery",
        "voicemail was left",
        "left a voicemail",
        "unreachable",
    )

    if any(
        pattern in outcome_text
        for pattern in negative_patterns
    ):
        return "no"

    positive_patterns = (
        "recipient acknowledged the incident",
        "engineer acknowledged the incident",
        "responder acknowledged the incident",
        "recipient accepted ownership",
        "engineer accepted ownership",
        "responder accepted ownership",
        "confirmed acknowledgement",
        "explicitly acknowledged",
        "acknowledged and accepted ownership",
        "will begin investigation immediately",
        "will start investigating immediately",
    )

    if any(
        pattern in outcome_text
        for pattern in positive_patterns
    ):
        return "yes"

    return "unknown"


def _infer_ownership_status(
    call_data: dict[str, Any],
    acknowledgement: str,
) -> str:
    """
    Infer ownership status conservatively from outcome-only data.
    """

    outcome_data = _get_outcome_only_data(
        call_data
    )

    outcome_text = _clean_text(
        _collect_text(
            outcome_data
        )
    ).lower()

    if any(
        phrase in outcome_text
        for phrase in (
            "accepted ownership",
            "accepts ownership",
            "confirmed ownership",
            "will own the incident",
        )
    ):
        return "accepted"

    if any(
        phrase in outcome_text
        for phrase in (
            "declined ownership",
            "did not accept ownership",
            "refused ownership",
        )
    ):
        return "declined"

    if acknowledgement == "yes":
        return "accepted"

    return "unconfirmed"


def _extract_summary(
    call_data: dict[str, Any],
) -> str:
    """Extract the most useful terminal CALL-E summary."""

    summary = _clean_text(
        call_data.get("summary")
    )

    if summary:
        return summary

    recipient_summary = _find_value(
        call_data.get(
            "recipients",
            [],
        ),
        (
            "summary",
            "call_summary",
            "outcome_summary",
        ),
    )

    cleaned_recipient_summary = _clean_text(
        recipient_summary
    )

    if cleaned_recipient_summary:
        return cleaned_recipient_summary

    return (
        "CALL-E returned a terminal result. "
        "Review the evidence and technical response for details."
    )


# ============================================================
# TASK GENERATION
# ============================================================

def _build_task(
    phone: str,
    goal: str,
) -> str:
    """
    Build one authorized, goal-driven incident escalation task.

    This account does not support result_schema, so the task asks CALL-E
    to express acknowledgement and ownership clearly in its normal
    terminal summary.
    """

    return f"""
Call {phone} in English.

This is an authorized IncidentOps AI production-incident escalation.

Clearly identify yourself as an automated IncidentOps AI caller.

Incident objective:

{goal}

During the call:

1. State the incident summary and priority clearly.
2. Ask whether the recipient acknowledges the incident.
3. Ask whether the recipient accepts ownership.
4. Ask for the immediate next action.
5. Ask for an estimated time to begin mitigation, if available.
6. Never request passwords, authentication codes, payment details,
   financial information, or sensitive personal information.
7. Do not claim acknowledgement unless the recipient explicitly says
   they acknowledge the incident.
8. Do not claim ownership was accepted unless the recipient explicitly
   confirms ownership.
9. If voicemail answers, leave a concise incident summary, priority,
   and callback request.
10. In the final normal CALL-E summary, state clearly:
    - whether a live recipient responded;
    - whether acknowledgement was yes, no, or unknown;
    - whether ownership was accepted, declined, or unconfirmed;
    - the responder's immediate next action, if provided.

Complete this single authorized phone task and return the normal CALL-E
terminal result.
""".strip()


# ============================================================
# RESPONSE NORMALIZATION
# ============================================================

def _format_call_result(
    call: Any,
) -> dict[str, Any]:
    """
    Normalize the CALL-E terminal result for the existing application.

    The result remains compatible with:
    - FastAPI routes;
    - SQLite history;
    - Streamlit dashboard;
    - Safe Demo Mode.
    """

    call_data = _to_dictionary(
        call
    )

    provider_status = _normalize_status(
        call_data.get(
            "status",
            "UNKNOWN",
        )
    )

    task_completed = _as_bool(
        call_data.get(
            "task_completed",
            False,
        )
    )

    summary = _extract_summary(
        call_data
    )

    acknowledgement = _infer_acknowledgement(
        call_data
    )

    ownership_status = _infer_ownership_status(
        call_data=call_data,
        acknowledgement=acknowledgement,
    )

    if acknowledgement == "yes":
        application_status = "ENGINEER_ACKNOWLEDGED"
        success = True
        retry_available = False

    elif acknowledgement == "no":
        application_status = "NO_ACKNOWLEDGEMENT"
        success = False
        retry_available = True

    elif task_completed:
        application_status = "CALL_COMPLETED"
        success = True
        retry_available = False

    elif provider_status in {
        "NO_ANSWER",
        "DECLINED",
        "FAILED",
        "CANCELLED",
        "CANCELED",
        "BUSY",
    }:
        application_status = provider_status
        success = False
        retry_available = True

    elif provider_status in {
        "COMPLETED",
        "SUCCEEDED",
        "SUCCESS",
        "FINISHED",
        "DONE",
    }:
        # The provider workflow finished, but the business task was not
        # confirmed as completed.
        application_status = "CALL_FINISHED_UNCONFIRMED"
        success = False
        retry_available = True

    else:
        application_status = (
            provider_status
            if provider_status != "UNKNOWN"
            else "CALL_RESULT_RECEIVED"
        )
        success = False
        retry_available = True

    call_id = call_data.get(
        "id"
    )

    completion_confidence = call_data.get(
        "completion_confidence"
    )

    evidence = call_data.get(
        "evidence",
        [],
    )

    transcript = call_data.get(
        "transcript"
    )

    if transcript is None:
        transcript = _find_value(
            call_data.get(
                "recipients",
                [],
            ),
            (
                "transcript",
                "transcript_turns",
            ),
        )

    structured_result = {
        "acknowledged": acknowledgement,
        "ownership_status": ownership_status,
        "task_completed": task_completed,
        "provider_status": provider_status,
        "summary": summary,
    }

    return {
        "success": success,
        "status": application_status,
        "message": summary,
        "attempts": 1,
        "retry_available": retry_available,
        "demo_mode": False,
        "acknowledgement": acknowledgement == "yes",
        "task_completed": task_completed,
        "call_id": call_id,
        "completion_confidence": completion_confidence,
        "structured_result": structured_result,
        "evidence": evidence,
        "transcript": transcript,
        "raw_response": call_data,
    }


# ============================================================
# PUBLIC SERVICE FUNCTION
# ============================================================

def start_call(
    phone: str,
    goal: str,
) -> dict[str, Any]:
    """
    Place one real CALL-E incident-escalation call.

    Public function signature is unchanged, so no route, dashboard,
    database, or Safe Demo Mode modification is required.

    Safety behavior:
    - no result_schema;
    - no automatic retry;
    - no concurrent live calls;
    - configurable cooldown;
    - configurable per-process limit;
    - explicit live-call enablement required.
    """

    global _LAST_CALL_STARTED_AT
    global _LIVE_CALL_COUNT

    if not _env_bool(
        "CALLE_LIVE_CALLS_ENABLED",
        default=False,
    ):
        return {
            "success": False,
            "status": "LIVE_CALLS_DISABLED",
            "message": (
                "Live CALL-E calls are disabled. "
                "Set CALLE_LIVE_CALLS_ENABLED=true in backend/.env "
                "only when you intentionally want to place one real call."
            ),
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    try:
        clean_phone = _validate_phone(
            phone
        )

    except ValueError as error:
        return {
            "success": False,
            "status": "INVALID_PHONE",
            "message": str(error),
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    clean_goal = _clean_text(
        goal
    )

    if not clean_goal:
        return {
            "success": False,
            "status": "INVALID_GOAL",
            "message": "The CALL-E call goal is missing.",
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    api_key = _get_api_key()

    if not api_key:
        return {
            "success": False,
            "status": "API_KEY_MISSING",
            "message": (
                "CALLE_API_KEY is not configured. "
                "No live call was started."
            ),
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    cooldown_seconds = _env_int(
        "CALLE_CALL_COOLDOWN_SECONDS",
        default=60,
        minimum=10,
        maximum=600,
    )

    max_calls_per_process = _env_int(
        "CALLE_MAX_LIVE_CALLS_PER_PROCESS",
        default=1,
        minimum=1,
        maximum=20,
    )

    if _LIVE_CALL_COUNT >= max_calls_per_process:
        return {
            "success": False,
            "status": "LIVE_CALL_LIMIT_REACHED",
            "message": (
                "The configured live-call limit for this backend "
                "process has been reached. Restart the backend only "
                "when you intentionally need another authorized test."
            ),
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    seconds_since_last_call = (
        time.monotonic()
        - _LAST_CALL_STARTED_AT
    )

    if (
        _LAST_CALL_STARTED_AT > 0
        and seconds_since_last_call < cooldown_seconds
    ):
        remaining = max(
            1,
            int(
                cooldown_seconds
                - seconds_since_last_call
            ),
        )

        return {
            "success": False,
            "status": "CALL_COOLDOWN_ACTIVE",
            "message": (
                "A live call was recently started. "
                f"Wait approximately {remaining} seconds before "
                "intentionally starting another call."
            ),
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    lock_acquired = _CALL_LOCK.acquire(
        blocking=False,
    )

    if not lock_acquired:
        return {
            "success": False,
            "status": "CALL_ALREADY_IN_PROGRESS",
            "message": (
                "A CALL-E live call is already in progress. "
                "No second call was started."
            ),
            "attempts": 0,
            "retry_available": False,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    client: CalleClient | None = None

    try:
        # Increment before the provider request to prevent repeated
        # button clicks from creating multiple chargeable attempts.
        _LIVE_CALL_COUNT += 1
        _LAST_CALL_STARTED_AT = time.monotonic()

        logger.info(
            "Starting one authorized CALL-E live call. "
            "Destination: %s. Process call count: %s/%s.",
            _mask_phone(
                clean_phone
            ),
            _LIVE_CALL_COUNT,
            max_calls_per_process,
        )

        task = _build_task(
            phone=clean_phone,
            goal=clean_goal,
        )

        client = CalleClient(
            api_key=api_key,
        )

        # Do not send result_schema.
        # The tested account successfully places calls using task-only
        # requests but rejects result_schema.
        call = client.calls.create_and_wait(
            task=task,
        )

        result = _format_call_result(
            call
        )

        logger.info(
            "CALL-E live call returned. "
            "Status: %s. Acknowledged: %s. "
            "Task completed: %s.",
            result.get(
                "status"
            ),
            result.get(
                "acknowledgement"
            ),
            result.get(
                "task_completed"
            ),
        )

        return result

    except Exception as error:
        logger.exception(
            "CALL-E live call failed after one attempt. "
            "No automatic redial will be performed."
        )

        error_message = _clean_text(
            error
        )

        is_timeout = any(
            keyword in error_message.lower()
            for keyword in (
                "timeout",
                "timed out",
                "deadline",
            )
        )

        return {
            "success": False,
            "status": (
                "PLATFORM_TIMEOUT"
                if is_timeout
                else "CALL_FAILED"
            ),
            "message": (
                "CALL-E could not complete the live incident "
                f"escalation: {error_message}"
            ),
            "attempts": 1,
            "retry_available": True,
            "demo_mode": False,
            "acknowledgement": False,
            "structured_result": {},
        }

    finally:
        if client is not None:
            close_method = getattr(
                client,
                "close",
                None,
            )

            if callable(close_method):
                try:
                    close_method()

                except Exception:
                    logger.debug(
                        "CALL-E client did not close cleanly.",
                        exc_info=True,
                    )

        _CALL_LOCK.release()
