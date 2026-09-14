import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

# Hosts CALL-E credentials are allowed to be sent to. A misconfigured or
# attacker-controlled CALLE_BASE_URL must never receive the API key.
DEFAULT_ALLOWED_HOSTS = {"api.heycall-e.com"}


def _allowed_hosts() -> set[str]:
    extra = os.environ.get("CALLE_ALLOWED_HOSTS", "")
    hosts = {h.strip().lower() for h in extra.split(",") if h.strip()}
    return DEFAULT_ALLOWED_HOSTS | hosts


def _mask_phone_in_text(text: str) -> str:
    """Redacts anything that looks like a phone number from free-text/error output."""
    if not text:
        return text
    text = re.sub(r"\+?\d[\d\-\s()]{7,}\d", "[REDACTED-PHONE]", text)
    return text


class CalleConfigError(Exception):
    """Raised when the configured CALL-E endpoint is not an approved host."""


class CalleClient:
    """
    Python client for the CALL-E Developer API.

    Mock mode is checked BEFORE any network request is made — no live HTTP
    call, and therefore no credential exposure, ever happens when
    CALLE_MOCK_MODE=1 is set. This keeps local/demo/test runs fully offline.
    """

    def __init__(self, api_key: str, base_url: Optional[str] = None) -> None:
        self.api_key = api_key
        self.base_url = (base_url or "https://api.heycall-e.com").rstrip("/")
        self._validate_base_url(self.base_url)
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "MedOpsCallCommander/1.0",
        }
        self._mock_calls: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def _validate_base_url(base_url: str) -> None:
        """Refuses to attach the CALL-E credential to a non-approved host."""
        from urllib.parse import urlparse

        parsed = urlparse(base_url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or host not in _allowed_hosts():
            raise CalleConfigError(
                f"Refusing to send CALL-E credentials to unapproved origin '{base_url}'. "
                f"Set CALLE_ALLOWED_HOSTS to add trusted hosts explicitly."
            )

    def _mock_enabled(self) -> bool:
        return os.environ.get("CALLE_MOCK_MODE", "").lower() in ("1", "true", "yes", "on")

    def calls_create(self, task: str, phone: Optional[str] = None, plan_id: Optional[str] = None) -> Dict[str, Any]:
        """Creates an outbound call, or returns a simulated call if mock mode is on."""
        if self._mock_enabled():
            call_id = f"call_e_mock_{uuid.uuid4().hex[:10]}"
            mock_data = {
                "id": call_id,
                "status": "completed",
                "task_completed": True,
                "task": task,
                "structured_result": {
                    "reschedule_confirmed": True,
                    "promise_date": "2026-08-12",
                    "call_summary": "[MOCK DEMO] Patient confirmed appointment reschedule.",
                },
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            self._mock_calls[call_id] = mock_data
            return mock_data

        url = f"{self.base_url}/v1/calls"
        payload = {
            "task": task,
            "recipients": [{"phones": [phone or "+14155550100"], "region": "US"}] if phone else [],
            "metadata": {"plan_id": plan_id} if plan_id else {},
        }
        try:
            resp = requests.post(url, json=payload, headers=self.headers, timeout=60)
        except requests.RequestException as exc:
            logger.warning("CALL-E API request exception (status unknown): %s", _mask_phone_in_text(str(exc)))
            return {
                "id": f"call_unknown_{uuid.uuid4().hex[:8]}",
                "status": "unknown",
                "task_completed": None,
                "error": "network_or_read_error",
                "structured_result": {},
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }

        if resp.status_code in (200, 201):
            return resp.json()

        logger.error("CALL-E API creation error HTTP %s", resp.status_code)
        return {
            "id": f"call_failed_{uuid.uuid4().hex[:8]}",
            "status": "failed",
            "task_completed": False,
            "error": f"API returned status {resp.status_code}",
            "structured_result": {},
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

    def calls_get(self, call_id: str) -> Dict[str, Any]:
        """Fetch call status and result."""
        if call_id in self._mock_calls:
            return self._mock_calls[call_id]

        url = f"{self.base_url}/v1/calls/{call_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=5)
        except requests.RequestException as exc:
            logger.warning("Error fetching CALL-E call %s (status unknown): %s", call_id, _mask_phone_in_text(str(exc)))
            return {
                "id": call_id,
                "status": "unknown",
                "task_completed": None,
                "error": "network_or_read_error",
                "structured_result": {},
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }

        if resp.status_code == 200:
            return resp.json()

        logger.warning("CALL-E get status error HTTP %s for call %s", resp.status_code, call_id)
        return {
            "id": call_id,
            "status": "failed",
            "task_completed": False,
            "error": f"HTTP {resp.status_code}",
            "structured_result": {},
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

    def calls_cancel(self, call_id: str) -> None:
        """
        Best-effort cancellation of an in-flight call.

        This only asks the provider to stop the call; it does not guarantee
        the call has actually stopped ringing/talking by the time this
        returns, and a failure here does not mean the call is still active.
        """
        if call_id in self._mock_calls:
            self._mock_calls[call_id]["status"] = "canceled"
            return
        url = f"{self.base_url}/v1/calls/{call_id}/cancel"
        try:
            requests.post(url, headers=self.headers, timeout=5)
        except requests.RequestException as exc:
            logger.warning("Best-effort cancel request failed for call %s: %s", call_id, _mask_phone_in_text(str(exc)))
