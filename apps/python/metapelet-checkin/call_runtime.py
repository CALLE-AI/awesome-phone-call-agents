"""Live CALL-E execution with local checkpoints and safe exports."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from task_builder import (
    build_recipients,
    mask_phone,
    structured_result_for_export,
)

DEFAULT_BASE_URL = "https://api.heycall-e.com"
TRUSTED_BASE_URLS = frozenset({DEFAULT_BASE_URL})
STATE_DIR = Path(__file__).resolve().parent / ".call-state"


def normalize_trusted_base_url(value: str | None) -> str:
    raw = str(value or DEFAULT_BASE_URL).strip().rstrip("/")
    if raw.endswith("/v1"):
        raw = raw[:-3].rstrip("/")
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise ValueError("CALLE base_url must use https.")
    if parsed.username or parsed.password:
        raise ValueError("CALLE base_url must not include credentials.")
    if parsed.params or parsed.query or parsed.fragment:
        raise ValueError("CALLE base_url must not include query strings or fragments.")
    if parsed.path not in {"", "/"}:
        raise ValueError("CALLE base_url must be a host URL only; do not include a path except /v1.")
    normalized = f"https://{parsed.netloc.lower()}".rstrip("/")
    if normalized not in TRUSTED_BASE_URLS:
        raise ValueError(
            "CALLE base_url must be a trusted CALL-E API host. Use https://api.heycall-e.com"
        )
    return normalized


def resolve_base_url() -> str:
    return normalize_trusted_base_url(os.environ.get("CALLE_BASE_URL"))


def checkpoint_path(idempotency_key: str) -> Path:
    digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32]
    return STATE_DIR / f"{digest}.json"


def read_checkpoint(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)
    path.chmod(0o600)


def write_output(path: Path | None, payload: dict[str, Any]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path is None:
        return
    destination = path.expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as handle:
        handle.write(rendered)
    destination.chmod(0o600)


def _call_field(call: Any, key: str) -> Any:
    if isinstance(call, dict):
        return call.get(key)
    return getattr(call, key, None)


def execute_live(
    request: dict[str, Any],
    client: Any,
    *,
    task: str,
    schema: dict[str, Any],
    idempotency_key: str,
    timeout_seconds: float,
) -> dict[str, Any]:
    checkpoint = checkpoint_path(idempotency_key)
    masked_phone = mask_phone(request["phone"])
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    state = read_checkpoint(checkpoint)

    if state.get("idempotency_key") not in (None, idempotency_key):
        raise RuntimeError("Checkpoint idempotency mismatch; use a new workflow request file.")

    call_id = state.get("call_id")
    if not isinstance(call_id, str) or not call_id:
        write_checkpoint(
            checkpoint,
            {
                "version": 1,
                "phase": "reserved",
                "idempotency_key": idempotency_key,
                "workflow_id": request["workflow_id"],
                "masked_phone": masked_phone,
                "updated_at": now,
            },
        )
        created = client.calls.create(
            task=task,
            recipients=build_recipients(request),
            result_schema=schema,
            idempotency_key=idempotency_key,
        )
        call_id = _call_field(created, "id")
        if not isinstance(call_id, str) or not call_id:
            write_checkpoint(
                checkpoint,
                {
                    "version": 1,
                    "phase": "create_failed",
                    "idempotency_key": idempotency_key,
                    "workflow_id": request["workflow_id"],
                    "masked_phone": masked_phone,
                    "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                },
            )
            raise RuntimeError("CALL-E create response did not contain a call id")
        write_checkpoint(
            checkpoint,
            {
                "version": 1,
                "phase": "accepted",
                "idempotency_key": idempotency_key,
                "workflow_id": request["workflow_id"],
                "masked_phone": masked_phone,
                "call_id": call_id,
                "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            },
        )

    try:
        completed = client.calls.wait_for_result(
            call_id,
            timeout_seconds=timeout_seconds,
            interval_seconds=2,
        )
    except Exception as exc:
        write_checkpoint(
            checkpoint,
            {
                "version": 1,
                "phase": "wait_failed",
                "idempotency_key": idempotency_key,
                "workflow_id": request["workflow_id"],
                "masked_phone": masked_phone,
                "call_id": call_id,
                "error": str(exc)[:240],
                "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            },
        )
        raise

    completed_dict = completed if isinstance(completed, dict) else {
        "status": _call_field(completed, "status"),
        "task_completed": _call_field(completed, "task_completed"),
        "structured_result": _call_field(completed, "structured_result"),
    }
    export_result = structured_result_for_export(completed_dict)
    payload = {
        "mode": "execute",
        "creates_phone_call": True,
        "workflow_id": request["workflow_id"],
        "idempotency_key": idempotency_key,
        "call_id": call_id,
        "status": completed_dict.get("status"),
        "task_completed": completed_dict.get("task_completed"),
        "structured_result": export_result,
        "structured_result_released": export_result is not None,
        "checkpoint": str(checkpoint),
    }
    write_checkpoint(
        checkpoint,
        {
            "version": 1,
            "phase": "finished",
            "idempotency_key": idempotency_key,
            "workflow_id": request["workflow_id"],
            "masked_phone": masked_phone,
            "call_id": call_id,
            "status": completed_dict.get("status"),
            "task_completed": completed_dict.get("task_completed"),
            "structured_result_released": export_result is not None,
            "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        },
    )
    return payload
