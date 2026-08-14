import hashlib
import hmac
import json
import logging
import os
import time
from typing import Optional

import requests

from ..core.enums import PlanState
from ..core.exceptions import InvalidStateTransition
from ..core.models import AuditEntry, CallPlan

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"


class HITLGate:
    """
    Human-in-the-loop approval gate via Telegram.
    Transport: webhook (Telegram pushes to /hitl/webhook — no polling).
    Token loaded from env only — never logged, never in source.
    Admin sees only masked phone and non-PHI plan fields.
    All approval actions are written to the audit log before state changes.
    """

    def __init__(self, audit_log) -> None:
        self._token       = os.environ["TELEGRAM_BOT_TOKEN"]     # server-side only
        self._chat_id     = os.environ["TELEGRAM_ADMIN_CHAT_ID"] # admin chat
        self._sign_secret = os.environ["HITL_SIGNING_SECRET"]   # HMAC for callback verification
        self._audit       = audit_log

    # ------------------------------------------------------------------
    # Outbound: notify admin of pending CallPlan
    # ------------------------------------------------------------------

    def notify(self, plan: CallPlan) -> None:
        """
        Sends a Telegram message with inline approval buttons.
        Shows only masked phone and non-PHI fields.
        """
        if not plan.is_approvable():
            raise InvalidStateTransition(plan.state, PlanState.PENDING_APPROVAL)

        text = (
            f"*[PENDING CALL APPROVAL]*\n"
            f"Plan ID: `{plan.plan_id[:8]}...`\n"
            f"Agent: `{plan.agent.value}`\n"
            f"Patient ID: `{plan.patient_id}`\n"
            f"Phone: `{plan.phone_masked}`\n"
            f"Priority: `{plan.priority}`\n"
            f"Trigger: `{plan.source_event}`\n\n"
            f"*Script preview:*\n_{plan.script[:200]}{'...' if len(plan.script) > 200 else ''}_"
        )

        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "Approve",    "callback_data": self._sign_callback(plan.plan_id, "approve")},
                    {"text": "Edit Script","callback_data": self._sign_callback(plan.plan_id, "edit")},
                ],
                [
                    {"text": "Snooze 24h", "callback_data": self._sign_callback(plan.plan_id, "snooze")},
                    {"text": "Dismiss",    "callback_data": self._sign_callback(plan.plan_id, "dismiss")},
                ],
            ]
        }

        self._send("sendMessage", {
            "chat_id":      self._chat_id,
            "text":         text,
            "parse_mode":   "Markdown",
            "reply_markup": json.dumps(keyboard),
        })
        logger.info("HITL notify sent plan_id=%s", plan.plan_id)

    # ------------------------------------------------------------------
    # Inbound: handle webhook callback from Telegram
    # ------------------------------------------------------------------

    def handle_callback(self, update: dict, admin_id: str, plan: CallPlan) -> str:
        """
        Processes an inline button callback from the admin.
        Verifies HMAC signature on callback_data before acting.
        Returns the action taken: 'approve' | 'edit' | 'snooze' | 'dismiss'.
        """
        callback_data = (
            update.get("callback_query", {})
                  .get("data", "")
        )
        plan_id, action = self._verify_callback(callback_data)

        if plan_id != plan.plan_id:
            logger.warning("Callback plan_id mismatch — ignoring")
            return "ignored"

        self._audit.append(AuditEntry(
            plan_id=plan.plan_id,
            action=action.upper(),
            admin_id=admin_id,
            reason="hitl_callback",
        ))

        return action

    # ------------------------------------------------------------------
    # Webhook registration — run once at deploy time
    # ------------------------------------------------------------------

    @classmethod
    def register_webhook(cls, webhook_url: str) -> bool:
        """
        Registers the webhook URL with Telegram.
        Call once at deploy: HITLGate.register_webhook('https://your-server.com/hitl/webhook')
        Token read from env — not stored after this call.
        """
        token = os.environ["TELEGRAM_BOT_TOKEN"]
        resp  = requests.post(
            TELEGRAM_API.format(token=token, method="setWebhook"),
            json={"url": webhook_url, "allowed_updates": ["callback_query"]},
            timeout=10,
        )
        resp.raise_for_status()
        result = resp.json()
        logger.info("Webhook registration: %s", result.get("description"))
        return result.get("ok", False)

    # ------------------------------------------------------------------
    # HMAC signing — prevents spoofed callback_data
    # ------------------------------------------------------------------

    def _sign_callback(self, plan_id: str, action: str) -> str:
        ts      = int(time.time())
        payload = f"{plan_id}:{action}:{ts}"
        sig     = hmac.new(
            self._sign_secret.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()[:16]
        return f"{plan_id}:{action}:{ts}:{sig}"

    def _verify_callback(self, data: str) -> tuple[str, str]:
        parts = data.split(":")
        if len(parts) != 4:
            raise ValueError("Invalid callback_data format")
        plan_id, action, ts_str, sig = parts
        ts = int(ts_str)
        if time.time() - ts > 3600:
            raise ValueError("Callback signature expired")
        payload  = f"{plan_id}:{action}:{ts_str}"
        expected = hmac.new(
            self._sign_secret.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()[:16]
        if not hmac.compare_digest(expected, sig):
            raise ValueError("Callback signature invalid")
        return plan_id, action

    def _send(self, method: str, payload: dict) -> dict:
        resp = requests.post(
            TELEGRAM_API.format(token=self._token, method=method),
            json=payload,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
