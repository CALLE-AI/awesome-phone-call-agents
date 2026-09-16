"""Live CALL-E execution with local checkpoints and safe exports."""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from task_builder import build_recipients, mask_phone, structured_result_for_export
from safety_text import export_execute_payload

DEFAULT_BASE_URL = "https://api.heycall-e.com"
TRUSTED_BASE_URLS = frozenset({DEFAULT_BASE_URL})
STATE_DIR = Path(__file__).resolve().parent / ".call-state"
CHECKPOINT_VERSION = 1
LOCK_TIMEOUT_SECONDS = 60.0


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


def provider_account_hash(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:24]


def checkpoint_path(provider_hash: str, workflow_id: str, idempotency_key: str) -> Path:
    workflow_slug = hashlib.sha256(workflow_id.encode("utf-8")).hexdigest()[:16]
    idem_slug = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:16]
    return STATE_DIR / provider_hash / workflow_slug / f"{idem_slug}.json"


def _lock_path(checkpoint: Path) -> Path:
    return checkpoint.with_suffix(checkpoint.suffix + ".lock")


@contextmanager
def _checkpoint_lock(checkpoint: Path):
    lock_path = _lock_path(checkpoint)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
    acquired = False
    while time.monotonic() < deadline:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("ascii"))
            os.close(fd)
            acquired = True
            break
        except FileExistsError:
            time.sleep(0.05)
    if not acquired:
        raise RuntimeError(f"Could not acquire checkpoint lock: {lock_path.name}")
    try:
        yield
    finally:
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass


def _quarantine_corrupt_checkpoint(path: Path) -> Path:
    quarantine = path.with_name(f"{path.stem}.corrupt.{int(time.time())}{path.suffix}")
    path.replace(quarantine)
    return quarantine


def read_checkpoint(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        _quarantine_corrupt_checkpoint(path)
        raise RuntimeError(
            "Checkpoint file was corrupted and quarantined; review .corrupt file then retry."
        )
    if not isinstance(payload, dict):
        _quarantine_corrupt_checkpoint(path)
        raise RuntimeError("Checkpoint file was invalid and quarantined.")
    if payload.get("version") not in (None, CHECKPOINT_VERSION):
        raise RuntimeError("Unsupported checkpoint version.")
    return payload


def _validate_checkpoint_scope(
    state: dict[str, Any],
    *,
    provider_hash: str,
    workflow_id: str,
    idempotency_key: str,
) -> None:
    if not state:
        return
    expected = {
        "provider_account_hash": provider_hash,
        "workflow_id": workflow_id,
        "idempotency_key": idempotency_key,
    }
    for key, value in expected.items():
        stored = state.get(key)
        if stored is not None and stored != value:
            raise RuntimeError(
                f"Checkpoint {key} mismatch; switch API keys or workflow carefully before retry."
            )


def write_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{uuid.uuid4().hex}.tmp")
    body = json.dumps({**payload, "version": CHECKPOINT_VERSION}, ensure_ascii=False, indent=2) + "\n"
    temp_path.write_text(body, encoding="utf-8")
    temp_path.replace(path)
    path.chmod(0o600)


def write_output(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return
    destination = path.expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
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
    provider_hash: str,
    timeout_seconds: float,
) -> dict[str, Any]:
    checkpoint = checkpoint_path(provider_hash, request["workflow_id"], idempotency_key)
    masked_phone = mask_phone(request["phone"])
    workflow_id = request["workflow_id"]

    with _checkpoint_lock(checkpoint):
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        state = read_checkpoint(checkpoint)
        _validate_checkpoint_scope(
            state,
            provider_hash=provider_hash,
            workflow_id=workflow_id,
            idempotency_key=idempotency_key,
        )

        call_id = state.get("call_id")
        if not isinstance(call_id, str) or not call_id:
            write_checkpoint(
                checkpoint,
                {
                    "phase": "reserved",
                    "provider_account_hash": provider_hash,
                    "idempotency_key": idempotency_key,
                    "workflow_id": workflow_id,
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
                        "phase": "create_failed",
                        "provider_account_hash": provider_hash,
                        "idempotency_key": idempotency_key,
                        "workflow_id": workflow_id,
                        "masked_phone": masked_phone,
                        "updated_at": datetime.now(timezone.utc)
                        .replace(microsecond=0)
                        .isoformat(),
                    },
                )
                raise RuntimeError("CALL-E create response did not contain a call id")
            write_checkpoint(
                checkpoint,
                {
                    "phase": "accepted",
                    "provider_account_hash": provider_hash,
                    "idempotency_key": idempotency_key,
                    "workflow_id": workflow_id,
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
                    "phase": "wait_failed",
                    "provider_account_hash": provider_hash,
                    "idempotency_key": idempotency_key,
                    "workflow_id": workflow_id,
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
            "workflow_id": workflow_id,
            "idempotency_key": idempotency_key,
            "call_id": call_id,
            "status": completed_dict.get("status"),
            "task_completed": completed_dict.get("task_completed"),
            "structured_result": export_result,
            "structured_result_released": export_result is not None,
        }
        write_checkpoint(
            checkpoint,
            {
                "phase": "finished",
                "provider_account_hash": provider_hash,
                "idempotency_key": idempotency_key,
                "workflow_id": workflow_id,
                "masked_phone": masked_phone,
                "call_id": call_id,
                "status": completed_dict.get("status"),
                "task_completed": completed_dict.get("task_completed"),
                "structured_result_released": export_result is not None,
                "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            },
        )
        return export_execute_payload(payload)
