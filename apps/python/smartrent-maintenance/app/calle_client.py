"""CALL-E SDK wrapper for SmartRent Maintenance Coordinator.

Encapsulates all CALL-E interactions: tenant intake calls,
vendor dispatch calls, and tenant confirmation calls.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.config import CalleConfig
from app.models import (
    TENANT_CONFIRM_RESULT_SCHEMA,
    TENANT_INTAKE_RESULT_SCHEMA,
    VENDOR_DISPATCH_RESULT_SCHEMA,
    CallRecord,
    CallStatus,
)

logger = logging.getLogger(__name__)


# ─── Dry-run simulation data ─────────────────────────────────────────────────

DRY_RUN_TENANT_RESULT = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.94, "label": "high"},
    "evidence": [
        "The tenant said the kitchen sink is leaking under the cabinet.",
        "The tenant described it as urgent because water is pooling on the floor.",
        "The tenant said someone is usually home and the door code is 4521.",
    ],
    "structured_result": {
        "issue_type": "plumbing",
        "urgency": "urgent",
        "location_in_unit": "kitchen - under the sink cabinet",
        "access_instructions": "Door code is 4521, someone is usually home",
        "additional_details": "Water is pooling on the floor, started this morning. Tenant has placed towels to contain it."
    },
    "recipients": [{
        "structured_result": {
            "issue_type": "plumbing",
            "urgency": "urgent",
            "location_in_unit": "kitchen - under the sink cabinet",
            "access_instructions": "Door code is 4521",
            "additional_details": "Water pooling on floor since this morning"
        },
        "attempts": [{
            "transcript_turns": [
                {"offset_seconds": 0, "speaker": "bot", "text": "Hi, this is SmartRent Maintenance. I'm calling about the maintenance request you submitted for Unit 4B. Can you describe the issue?"},
                {"offset_seconds": 5, "speaker": "user", "text": "Yes, my kitchen sink is leaking. There's water coming from under the cabinet."},
                {"offset_seconds": 12, "speaker": "bot", "text": "I understand. How urgent would you say this is?"},
                {"offset_seconds": 15, "speaker": "user", "text": "It's pretty urgent. Water is pooling on the floor. It started this morning."},
                {"offset_seconds": 22, "speaker": "bot", "text": "Got it. And how can a maintenance person access your unit?"},
                {"offset_seconds": 25, "speaker": "user", "text": "The door code is 4521. Someone is usually home."},
                {"offset_seconds": 32, "speaker": "bot", "text": "Thank you. We'll get a plumber to you as soon as possible. Is there anything else?"},
                {"offset_seconds": 36, "speaker": "user", "text": "No, that's it. I've put towels down to contain the water for now."},
            ]
        }]
    }]
}

DRY_RUN_VENDOR_RESULT = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.91, "label": "high"},
    "evidence": [
        "The vendor confirmed they can come today.",
        "They estimated arrival within 2 hours.",
        "They quoted approximately $150-250 for a standard sink leak repair.",
    ],
    "structured_result": {
        "available": "yes",
        "eta": "within 2 hours",
        "cost_estimate": "$150-250",
        "notes": "Standard sink leak repair. Will bring replacement P-trap and supply lines."
    },
    "recipients": [{
        "structured_result": {
            "available": "yes",
            "eta": "within 2 hours",
            "cost_estimate": "$150-250",
            "notes": "Will bring replacement P-trap and supply lines"
        },
        "attempts": [{
            "transcript_turns": [
                {"offset_seconds": 0, "speaker": "bot", "text": "Hi, this is SmartRent Maintenance calling on behalf of SmartRent Demo Property. We have an urgent plumbing issue — a leaking kitchen sink in Unit 4B. Are you available?"},
                {"offset_seconds": 8, "speaker": "user", "text": "Let me check my schedule... yes, I can come today."},
                {"offset_seconds": 14, "speaker": "bot", "text": "Great. What's your estimated time of arrival?"},
                {"offset_seconds": 17, "speaker": "user", "text": "I can be there within 2 hours."},
                {"offset_seconds": 21, "speaker": "bot", "text": "And approximately how much would a standard sink leak repair cost?"},
                {"offset_seconds": 25, "speaker": "user", "text": "Usually between 150 and 250 dollars, depending on what needs replacing."},
            ]
        }]
    }]
}

DRY_RUN_VENDOR_UNAVAILABLE_RESULT = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.94, "label": "high"},
    "evidence": [
        "The vendor stated they are completely booked on an emergency job today.",
        "Earliest available opening is tomorrow afternoon.",
    ],
    "structured_result": {
        "available": "no",
        "eta": "tomorrow afternoon",
        "cost_estimate": "N/A",
        "notes": "Fully booked on emergency main line repairs today. Suggested calling another contractor."
    },
    "recipients": [{
        "structured_result": {
            "available": "no",
            "eta": "tomorrow afternoon",
            "cost_estimate": "N/A",
            "notes": "Fully booked today"
        },
        "attempts": [{
            "transcript_turns": [
                {"offset_seconds": 0, "speaker": "bot", "text": "Hi, this is SmartRent Maintenance calling on behalf of SmartRent Demo Property. We have an urgent repair in Unit 4B. Are you available for a dispatch today?"},
                {"offset_seconds": 7, "speaker": "user", "text": "I'm sorry, all our crew is tied up on an emergency commercial water main replacement until tomorrow."},
                {"offset_seconds": 15, "speaker": "bot", "text": "Understood. Thanks for checking your availability so quickly. Have a great day."},
                {"offset_seconds": 19, "speaker": "user", "text": "Thanks, good luck with the repair."},
            ]
        }]
    }]
}

DRY_RUN_CONFIRM_RESULT = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.96, "label": "high"},
    "evidence": [
        "The tenant confirmed the vendor visit.",
        "The tenant acknowledged the 2-hour ETA.",
    ],
    "structured_result": {
        "confirmed": "yes",
        "preferred_time": "",
        "notes": "Tenant will be home and door code is still 4521"
    },
    "recipients": [{
        "structured_result": {
            "confirmed": "yes",
            "preferred_time": "",
            "notes": "Will be home"
        },
        "attempts": [{
            "transcript_turns": [
                {"offset_seconds": 0, "speaker": "bot", "text": "Hi again, this is SmartRent Maintenance. We've found a plumber — Mike's Plumbing. They can arrive within 2 hours, estimated cost $150-250. Does that work for you?"},
                {"offset_seconds": 8, "speaker": "user", "text": "Yes, that sounds good. I'll be home."},
                {"offset_seconds": 12, "speaker": "bot", "text": "Great, I'll confirm the appointment. The door code is still 4521, correct?"},
                {"offset_seconds": 16, "speaker": "user", "text": "Yes, that's right. Thank you!"},
            ]
        }]
    }]
}


class CalleService:
    """Wrapper around the CALL-E Python SDK."""

    def __init__(self, config: CalleConfig):
        self.config = config
        self._client = None

        if not config.dry_run and config.api_key:
            try:
                from calle import CalleClient
                self._client = CalleClient(api_key=config.api_key)
                logger.info("CALL-E client initialized with live API key")
            except ImportError:
                logger.warning("calle-ai package not installed. Install with: pip install calle-ai")
            except Exception as e:
                logger.warning(f"Failed to initialize CALL-E client: {e}")

        if config.dry_run:
            logger.info("Running in DRY-RUN mode — no real calls will be placed")

    @property
    def is_dry_run(self) -> bool:
        return self.config.dry_run or self._client is None

    async def _make_call(
        self,
        phone: str,
        task: str,
        result_schema: dict,
        region: str = "US",
        locale: str = "en-US",
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        """Place a call via CALL-E SDK and wait for result without blocking the event loop."""
        if self.is_dry_run:
            raise RuntimeError("Cannot make live call in dry-run mode")

        call_params = {
            "task": task,
            "recipients": [{
                "phones": [phone],
                "region": region,
                "locale": locale,
            }],
            "result_schema": result_schema,
        }

        if self.config.webhook_url:
            call_params["webhook_url"] = self.config.webhook_url

        if idempotency_key:
            call_params["idempotency_key"] = idempotency_key

        logger.info(f"Placing CALL-E call to {phone[:7]}***")
        # Use asyncio.to_thread so that synchronous blocking polling inside the CALL-E SDK
        # does not freeze FastAPI's main event loop during live phone calls.
        result = await asyncio.to_thread(self._client.calls.create_and_wait, **call_params)
        logger.info(f"Call completed: status={result.get('status')}, task_completed={result.get('task_completed')}")
        return result

    def _parse_call_result(self, result: dict, call_type: str, phone: str) -> CallRecord:
        """Parse a CALL-E result into a CallRecord."""
        transcript = []
        if result.get("recipients"):
            for recip in result["recipients"]:
                for attempt in recip.get("attempts", []):
                    transcript = attempt.get("transcript_turns", [])

        confidence = result.get("completion_confidence", {})

        return CallRecord(
            call_id=result.get("id", f"dry-run-{call_type}"),
            call_type=call_type,
            phone=phone,
            status=CallStatus.COMPLETED if result.get("status") == "completed" else CallStatus.FAILED,
            started_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
            structured_result=result.get("structured_result"),
            evidence=result.get("evidence", []),
            transcript=transcript,
            task_completed=result.get("task_completed"),
            confidence_score=confidence.get("score"),
            confidence_label=confidence.get("label"),
            recording_url=result.get("recording_url") or result.get("audio_url"),
        )

    # ─── Tenant Intake Call ───────────────────────────────────────────────

    async def call_tenant_intake(
        self,
        phone: str,
        tenant_name: str,
        unit_number: str,
        property_name: str,
        initial_description: str = "",
    ) -> CallRecord:
        """Call tenant to gather detailed maintenance issue information."""
        task = (
            f"Call {tenant_name} at {phone} about a maintenance request for "
            f"Unit {unit_number} at {property_name}. "
        )
        if initial_description:
            task += f"They initially reported: '{initial_description}'. "
        task += (
            "Politely gather: (1) What type of issue it is (plumbing, electrical, HVAC, "
            "appliance, structural, pest, or other), (2) How urgent it is — emergency means "
            "safety hazard or major damage happening now, urgent means needs attention today, "
            "routine means can wait a few days, (3) Where exactly in the unit the issue is, "
            "(4) How a maintenance person can access the unit (door code, will someone be home, etc.), "
            "(5) Any additional details. Be friendly and professional. Thank them and let them know "
            "you'll find a vendor and call them back."
        )

        if self.is_dry_run:
            logger.info(f"[DRY RUN] Simulating tenant intake call to {phone}")
            return self._parse_call_result(DRY_RUN_TENANT_RESULT, "tenant_intake", phone)

        result = await self._make_call(
            phone=phone,
            task=task,
            result_schema=TENANT_INTAKE_RESULT_SCHEMA,
            idempotency_key=f"tenant_intake_{phone}_{int(time.time())}",
        )
        return self._parse_call_result(result, "tenant_intake", phone)

    # ─── Vendor Dispatch Call ─────────────────────────────────────────────

    async def call_vendor_dispatch(
        self,
        vendor_phone: str,
        vendor_name: str,
        issue_type: str,
        urgency: str,
        location: str,
        property_name: str,
        unit_number: str,
        additional_details: str = "",
        simulate_unavailable: bool = False,
    ) -> CallRecord:
        """Call a vendor to check availability and get ETA + cost estimate."""
        task = (
            f"Call {vendor_name} at {vendor_phone}. You are calling on behalf of "
            f"{property_name} property management. There is a {urgency} {issue_type} issue "
            f"in Unit {unit_number} — {location}. "
        )
        if additional_details:
            task += f"Details: {additional_details}. "
        task += (
            "Ask: (1) Are you available to handle this today? "
            "(2) What is your estimated time of arrival? "
            "(3) What is the approximate cost for this type of repair? "
            "Be professional and concise. If they are not available, thank them and end the call."
        )

        if self.is_dry_run:
            logger.info(f"[DRY RUN] Simulating vendor dispatch call to {vendor_phone} ({vendor_name})")
            base = DRY_RUN_VENDOR_UNAVAILABLE_RESULT if simulate_unavailable else DRY_RUN_VENDOR_RESULT
            result_copy = copy.deepcopy(base)
            # Personalize vendor in transcript if available
            try:
                turns = result_copy["recipients"][0]["attempts"][0]["transcript_turns"]
                turns[0]["text"] = f"Hi, this is SmartRent Maintenance calling {vendor_name} on behalf of {property_name}. We have an urgent {issue_type} issue in Unit {unit_number}. Are you available?"
            except Exception:
                pass
            return self._parse_call_result(result_copy, "vendor_dispatch", vendor_phone)

        result = await self._make_call(
            phone=vendor_phone,
            task=task,
            result_schema=VENDOR_DISPATCH_RESULT_SCHEMA,
            idempotency_key=f"vendor_{vendor_phone}_{int(time.time())}",
        )
        return self._parse_call_result(result, "vendor_dispatch", vendor_phone)

    # ─── Tenant Confirmation Call ─────────────────────────────────────────

    async def call_tenant_confirm(
        self,
        phone: str,
        tenant_name: str,
        vendor_name: str,
        eta: str,
        cost_estimate: str,
        unit_number: str,
    ) -> CallRecord:
        """Call tenant back to confirm vendor visit details."""
        task = (
            f"Call {tenant_name} at {phone}. You are calling back from SmartRent Maintenance "
            f"about the maintenance request for Unit {unit_number}. "
            f"Let them know you've found a vendor: {vendor_name}. "
            f"They can arrive {eta}, and the estimated cost is {cost_estimate}. "
            "Ask if this works for them. If they want to reschedule, ask for their preferred time. "
            "Thank them and let them know the vendor will be in touch."
        )

        if self.is_dry_run:
            logger.info(f"[DRY RUN] Simulating tenant confirmation call to {phone}")
            confirm_res = dict(DRY_RUN_CONFIRM_RESULT)
            confirm_res["recipients"] = [{
                "structured_result": {"confirmed": "yes", "preferred_time": "", "notes": "Will be home"},
                "attempts": [{
                    "transcript_turns": [
                        {
                            "offset_seconds": 0,
                            "speaker": "bot",
                            "text": f"Hi again, this is SmartRent Maintenance. We've coordinated with {vendor_name}. They can arrive {eta or 'within 2 hours'}, estimated cost {cost_estimate or '$150-250'}. Does that work for you?"
                        },
                        {
                            "offset_seconds": 8,
                            "speaker": "user",
                            "text": "Yes, that sounds good. I'll be home."
                        },
                        {
                            "offset_seconds": 12,
                            "speaker": "bot",
                            "text": f"Great, I'll confirm the appointment with {vendor_name}. Have a wonderful day!"
                        },
                        {
                            "offset_seconds": 16,
                            "speaker": "user",
                            "text": "Thank you so much!"
                        }
                    ]
                }]
            }]
            return self._parse_call_result(confirm_res, "tenant_confirm", phone)

        result = await self._make_call(
            phone=phone,
            task=task,
            result_schema=TENANT_CONFIRM_RESULT_SCHEMA,
            idempotency_key=f"confirm_{phone}_{int(time.time())}",
        )
        return self._parse_call_result(result, "tenant_confirm", phone)
