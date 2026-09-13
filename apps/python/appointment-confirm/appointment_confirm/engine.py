"""Preview, mock, and live execution for one appointment-confirmation call."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from . import WORKFLOW_TYPE
from .dispositions import classify
from .mock_client import MockCalleClient, load_fixture
from .phone import mask_phone
from .preview import preview
from .schema import recipient_result_schema, task_result_schema
from .task import build_task, idempotency_key


class CallClient(Protocol):
    def create_and_wait(self, **kwargs: Any) -> dict[str, Any]: ...


def default_fixture_path() -> Path:
    return Path(__file__).resolve().parent.parent / "fixtures" / "conversation_confirm_yes.json"


def execute_with_client(
    intake: dict[str, Any],
    client: CallClient,
    *,
    mode: str,
) -> dict[str, Any]:
    payload = client.create_and_wait(
        task=build_task(intake),
        recipients=[
            {
                "phones": [intake["phone"]],
                "region": intake["region"],
                "locale": intake["locale"],
            }
        ],
        result_schema=task_result_schema(),
        recipient_result_schema=recipient_result_schema(),
        metadata={
            "workflow_run_id": intake["request_id"],
            "workflow_type": WORKFLOW_TYPE,
            "business": intake["business_display_name"],
        },
        idempotency_key=idempotency_key(intake),
    )
    if not isinstance(payload, dict):
        raise RuntimeError("CALL-E client returned a non-object result")
    ticket = classify(intake, payload, mode=mode)
    transcript = []
    recipients = payload.get("recipients") or []
    if recipients and isinstance(recipients[0], dict):
        attempts = recipients[0].get("attempts") or []
        if attempts and isinstance(attempts[0], dict):
            transcript = attempts[0].get("transcript_turns") or []
    ticket["transcript_turns"] = transcript
    ticket["phone_masked"] = mask_phone(intake["phone"])
    return ticket


def execute_mock(intake: dict[str, Any], fixture_path: Path | None = None) -> dict[str, Any]:
    path = fixture_path or default_fixture_path()
    fixture = load_fixture(path)
    client = MockCalleClient(fixture, intake)
    ticket = execute_with_client(intake, client, mode="mock")
    ticket["fixture"] = str(path)
    ticket["creates_phone_call"] = False
    return ticket
