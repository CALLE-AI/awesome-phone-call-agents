"""
call_service.py
===============
Handles all CALL-E interactions for CallFollowUp.

Key safety guarantees
---------------------
- prepare_call() is a plain function: no CalleClient is ever created for
  dry-run / preview.  It works with CALLE_API_KEY absent.
- CalleClient is instantiated only inside CallService.__init__(), which is
  only called when the user explicitly starts a LIVE call.
- On ambiguous creation (exception or missing call-id), create_call() returns
  {"status": "UNKNOWN"}.  It never re-raises and never retries automatically.
- wait_for_result() returns {"status": "UNKNOWN"} on timeout rather than
  raising, so the dashboard can distinguish a timeout from a confirmed failure.
- Raw provider responses are never returned; only safe extracted fields are.
"""

import logging
import re
import time

from config import get_calle_api_key
from calle import CalleClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# E.164 validation (Req 2)
# Exact format: + followed by 1-15 digits; first digit after + cannot be 0.
# ---------------------------------------------------------------------------
_E164_RE = re.compile(r'^\+[1-9]\d{1,14}$')


def validate_e164(phone: str) -> bool:
    """
    Return True only when *phone* is exact E.164:
      + followed by 1-15 digits, first digit after + is not 0.
    Spaces, hyphens, parentheses, and local numbers all return False.
    """
    if not isinstance(phone, str):
        return False
    return bool(_E164_RE.match(phone.strip()))


# ---------------------------------------------------------------------------
# Credential-free preview (Req 1)
# ---------------------------------------------------------------------------
def prepare_call(follow_up) -> dict:
    """
    Build a local preview of the call parameters.

    This function is entirely local: it does NOT import or instantiate
    CalleClient, does NOT make any network request, and works even when
    CALLE_API_KEY is not set.  Safe to call at any time.
    """
    return {
        "task": follow_up.call_goal,
        "recipient_masked": _mask_phone(follow_up.phone_number),
        "mode": "dry_run",
        "note": "Preview only - no call has been made and no credits used.",
    }


# ---------------------------------------------------------------------------
# Phone number masking helper
# ---------------------------------------------------------------------------
def _mask_phone(phone: str) -> str:
    """
    Mask a phone number for display: keep country code prefix and last 4 digits.
    e.g. +14155552671 -> +1*******2671
    """
    phone = phone.strip()
    if not phone.startswith("+"):
        return "**masked**"
    digits = phone[1:]
    if len(digits) <= 4:
        return "+****"
    visible_suffix = digits[-4:]
    masked_middle = "*" * (len(digits) - 4)
    return "+" + masked_middle + visible_suffix


# ---------------------------------------------------------------------------
# Live CALL-E service (only instantiated for real calls)
# ---------------------------------------------------------------------------
class CallService:
    """
    Wraps the CALL-E SDK for live calls.

    Do NOT instantiate this class during preview / dry-run.  Only create an
    instance when the user has explicitly confirmed they want a live call.
    """

    def __init__(self):
        api_key = get_calle_api_key()
        if not api_key:
            raise RuntimeError(
                "CALLE_API_KEY is not configured. "
                "Set it in .env or Streamlit Secrets before making a live call."
            )
        self.client = CalleClient(
            api_key=api_key,
            timeout=60.0,
        )
        self.calls = self.client.calls

    def create_call(self, follow_up) -> dict:
        """
        Submit a live call to CALL-E.

        Returns a dict that always contains a "status" key:
          - {"id": "...", "status": "accepted"} on definitive acceptance.
          - {"status": "UNKNOWN", "error": "<safe message>"} when the outcome
            is ambiguous (exception, timeout, missing id).

        NEVER re-raises.  NEVER retries.  Callers must check for UNKNOWN and
        halt the workflow for manual reconciliation (Req 5).
        """
        result_schema = {
            "type": "object",
            "properties": {
                "outcome": {"type": "string"},
                "notes": {"type": "string"},
                "next_action": {"type": "string"},
                "callback_at": {"type": "string"},
            },
            "required": ["outcome", "notes", "next_action"],
        }

        try:
            raw = self.calls.create(
                task=follow_up.call_goal,
                recipient={"phone": follow_up.phone_number},
                result_schema=result_schema,
            )
        except Exception:
            # Log the real error server-side but do NOT surface it to the UI.
            logger.exception("CALL-E create_call raised an exception")
            return {
                "status": "UNKNOWN",
                "error": (
                    "The call submission request encountered an error. "
                    "The call may or may not have been accepted by the provider. "
                    "Check your CALL-E dashboard before retrying."
                ),
            }

        if not isinstance(raw, dict):
            logger.error("CALL-E create_call returned non-dict: %s", type(raw))
            return {
                "status": "UNKNOWN",
                "error": (
                    "The provider returned an unexpected response format. "
                    "The call outcome is unknown."
                ),
            }

        call_id = raw.get("id") or raw.get("call_id")
        if not call_id:
            logger.error("CALL-E create_call returned no call id")
            return {
                "status": "UNKNOWN",
                "error": (
                    "The provider did not return a call ID. "
                    "The call outcome is unknown."
                ),
            }

        # Definitive acceptance: return only safe fields.
        return {
            "id": call_id,
            "status": raw.get("status", "accepted"),
        }

    def wait_for_result(self, call_id: str, timeout_seconds: int = 300) -> dict:
        """
        Poll CALL-E until a terminal status is reached or timeout expires.

        Returns a dict with a "status" key:
          - Terminal status dict on confirmed completion.
          - {"status": "UNKNOWN"} on timeout (Req 5 — do not claim cancellation).

        Never raises.
        """
        start_time = time.time()

        while time.time() - start_time < timeout_seconds:
            try:
                call = self.calls.get(call_id)
            except Exception:
                logger.exception("CALL-E get() raised during polling for %s", call_id)
                # Do not abort - transient errors during polling are expected.
                time.sleep(5)
                continue

            if not isinstance(call, dict):
                time.sleep(5)
                continue

            status = call.get("status", "")

            if status in {"completed", "failed", "cancelled", "canceled"}:
                return _extract_safe_result(call, status)

            time.sleep(5)

        logger.warning("CALL-E poll timed out for call %s", call_id)
        return {"status": "UNKNOWN"}

    def get_call(self, call_id: str) -> dict:
        """
        Fetch the current state of a call.

        Returns a safe dict or {"status": "UNKNOWN"} on error.
        Never raises.
        """
        try:
            call = self.calls.get(call_id)
        except Exception:
            logger.exception("CALL-E get() raised for call %s", call_id)
            return {"status": "UNKNOWN"}

        if not isinstance(call, dict):
            return {"status": "UNKNOWN"}

        return _extract_safe_result(call, call.get("status", "UNKNOWN"))

    def get_transcript(self, call_id: str) -> list:
        """
        Fetch transcript turns for a call.

        Returns a list of {"speaker": ..., "text": ...} dicts.
        Text is sanitised before return.  Returns [] on error.
        """
        try:
            call = self.calls.get(call_id)
        except Exception:
            logger.exception("CALL-E get() raised while fetching transcript for %s", call_id)
            return []

        if not isinstance(call, dict):
            return []

        attempts = []
        for recipient in call.get("recipients", []):
            attempts.extend(recipient.get("attempts", []))

        turns = attempts[0].get("transcript_turns", []) if attempts else []

        return [
            {
                "speaker": t.get("speaker", "unknown"),
                "text": _sanitise_text(t.get("text", "")),
            }
            for t in turns
            if isinstance(t, dict)
        ]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
_PHONE_RE = re.compile(r'\+?\d[\d\s\-().]{6,}\d')
_EMAIL_RE = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')


def _sanitise_text(text: str) -> str:
    """Remove phone numbers and email addresses from freeform transcript text."""
    text = _PHONE_RE.sub("[number redacted]", text)
    text = _EMAIL_RE.sub("[email redacted]", text)
    return text


def _extract_safe_result(raw: dict, status: str) -> dict:
    """
    Extract only the safe business fields from a raw CALL-E response.
    Never returns nested provider objects or raw IDs in the result.
    """
    result_data = raw.get("structured_result") or raw.get("result") or {}
    if not isinstance(result_data, dict):
        result_data = {}

    return {
        "status": status,
        "outcome": result_data.get("outcome", ""),
        "notes": result_data.get("notes", ""),
        "next_action": result_data.get("next_action", ""),
        "callback_at": result_data.get("callback_at", ""),
    }
