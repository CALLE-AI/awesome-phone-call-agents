"""No-call preview. Never contacts CALL-E."""

from __future__ import annotations

from typing import Any

from .phone import mask_phone
from .schema import recipient_result_schema, task_result_schema
from .task import build_task, idempotency_key


def preview(intake: dict[str, Any]) -> dict[str, Any]:
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "request_id": intake["request_id"],
        "phone_masked": mask_phone(intake["phone"]),
        "region": intake["region"],
        "locale": intake["locale"],
        "timezone": intake["timezone"],
        "business_display_name": intake["business_display_name"],
        "appointment": intake["appointment"],
        "reschedule_windows": intake["reschedule_windows"],
        "idempotency_key": idempotency_key(intake),
        "task": build_task(intake),
        "result_schema": task_result_schema(),
        "recipient_result_schema": recipient_result_schema(),
        "side_effects": [
            "Preview does not dial, authenticate, or send network requests.",
            "A later --mock run uses a local fixture and still places no call.",
            "A later --execute --confirm-consent run places exactly one real CALL-E call.",
        ],
        "cancellation": (
            "This workflow is one-shot. Do not re-run --execute with the same "
            "request_id and starts_at. CALL-E will reuse the idempotency key."
        ),
    }
