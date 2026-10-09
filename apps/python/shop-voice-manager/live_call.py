#!/usr/bin/env python3
"""Live CALL-E execution for the shop check-in.

This module supplies the *input* that `demo_ledger.py` supplies from fixtures.
Everything downstream is unchanged: the result goes through
`ingest.ingest_call`, which applies the confidence gate and writes through
`store.py`. The demo path and the live path therefore cannot drift apart.

    demo_ledger.py ─┐
                    ├─→ ingest.ingest_call() ─→ store.py ─→ summarize.py
    live_call.py ───┘

Nothing here places a call on import. `execute_live` needs a client object,
and `client.py` only builds one under `--execute --confirm-recipient-opt-in`.

Refs #15 (R5).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

APP_ROOT = Path(__file__).resolve().parent
STATE_DIR = APP_ROOT / ".call-state"

DEFAULT_BASE_URL = "https://api.heycall-e.com"
TRUSTED_BASE_URLS = frozenset({DEFAULT_BASE_URL})

CHECKPOINT_VERSION = 1
POLL_INTERVAL_SECONDS = 5.0
PROGRESS_HEARTBEAT_SECONDS = 30.0
DEFAULT_TIMEOUT_SECONDS = 600.0

# E.164: ASCII only — leading +, country code non-zero, 8–15 digits (ITU-T).
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$", re.ASCII)
# Spoken or printed numbers that may appear in transcripts / error text.
PHONE_IN_TEXT_RE = re.compile(
    r"(?<!\w)(?:\+|00)?(?:\d[\s\-().]*){8,15}\d(?!\w)",
    re.ASCII,
)

# Statuses CALL-E can end on. Mirrors ingest.TERMINAL_WITHOUT_DATA plus success.
TERMINAL_STATUSES = {
    "completed", "no_answer", "voicemail", "busy", "declined",
    "canceled", "cancelled", "expired", "failed",
}


class LiveCallError(RuntimeError):
    """Raised when the live path cannot proceed safely."""


# --------------------------------------------------------------------------
# Base URL — refuse anything that is not the real CALL-E host
# --------------------------------------------------------------------------

def normalize_trusted_base_url(value: str | None) -> str:
    raw = str(value or DEFAULT_BASE_URL).strip().rstrip("/")
    if raw.endswith("/v1"):
        raw = raw[:-3].rstrip("/")
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise LiveCallError("CALLE_BASE_URL must use https.")
    if parsed.username or parsed.password:
        raise LiveCallError("CALLE_BASE_URL must not include credentials.")
    if parsed.params or parsed.query or parsed.fragment:
        raise LiveCallError("CALLE_BASE_URL must not include a query string or fragment.")
    if parsed.path not in {"", "/"}:
        raise LiveCallError("CALLE_BASE_URL must be a host URL only.")
    normalized = f"https://{parsed.netloc.lower()}"
    if normalized not in TRUSTED_BASE_URLS:
        raise LiveCallError(
            f"CALLE_BASE_URL must be a trusted CALL-E host. Use {DEFAULT_BASE_URL}"
        )
    return normalized


def resolve_base_url() -> str:
    return normalize_trusted_base_url(os.environ.get("CALLE_BASE_URL"))


def provider_account_hash(api_key: str) -> str:
    """Scope checkpoints to an account without ever storing the key."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:24]


# --------------------------------------------------------------------------
# Request shaping
# --------------------------------------------------------------------------

# vendor_order and order_status key on the restock request/order they belong
# to, not the calendar date — a shop can restock more than once a day, and
# keying those two on the date would collide two unrelated orders together.
# Matches client.py's REQUEST_KEYED_CALL_TYPES and safety.md's idempotency
# table.
REQUEST_KEYED_CALL_TYPES = {"vendor_order", "order_status"}


def idempotency_key(shop_id: str, call_type: str, call_date: str,
                    attempt: int = 1, request_id: str | None = None) -> str:
    """One key per shop per call type per day, as specified in PROJECT_PLAN.md.

    The demo path emits `…-DEMO`. The live path must use the real date so a
    retry after a crash cannot place a second call.

    `attempt` exists because "one call per day" is the safety default, not a
    hard limit: an operator may legitimately need a second check-in after a
    voicemail or a bad line. It must stay *derived*, never random. A random key
    would give a crash-retry a fresh checkpoint path, find no `call_id`, and
    dial a second time, which is the exact thing the checkpoint prevents.
    Attempt 1 is byte-identical to the original key, so existing checkpoints
    and ledgers keep resolving.

    `request_id` is required for `vendor_order` and `order_status` — see
    REQUEST_KEYED_CALL_TYPES above — and ignored otherwise.
    """
    if call_type in REQUEST_KEYED_CALL_TYPES:
        if not request_id:
            raise LiveCallError(
                f"{call_type} calls key on the restock request, not the "
                "date — pass request_id (the order_id)."
            )
        base = f"shopvoice-{shop_id}-{call_type}-{request_id}"
    else:
        base = f"shopvoice-{shop_id}-{call_type}-{call_date}"
    return base if attempt <= 1 else f"{base}-r{attempt}"


def next_attempt(provider_hash: str, shop_id: str, call_type: str,
                 call_date: str) -> int:
    """The next unused attempt for this shop, type and day.

    Counts checkpoints on disk rather than querying the ledger, so it still
    answers when the database is unreachable, is a different file, or does not
    exist yet. Checkpoints already record their own `idempotency_key`, which is
    what makes this possible without renaming the files.
    """
    base = f"shopvoice-{shop_id}-{call_type}-{call_date}"
    folder = STATE_DIR / provider_hash
    if not folder.is_dir():
        return 1
    highest = 0
    for path in folder.glob("*.json"):
        try:
            key = json.loads(path.read_text(encoding="utf-8")).get("idempotency_key")
        except (json.JSONDecodeError, OSError):
            continue          # a counting helper must never block a call
        if key == base:
            highest = max(highest, 1)
        elif isinstance(key, str) and key.startswith(base + "-r"):
            suffix = key[len(base) + 2:]
            if suffix.isdigit():
                highest = max(highest, int(suffix))
    return highest + 1


def request_idempotency_key(ledger_key: str, *, now: float | None = None) -> str:
    """The key sent to CALL-E. Unique per attempt, by timestamp.

    Two identifiers do two different jobs here, and conflating them is what
    caused the "Idempotency key was reused with a different request" failure:

    * `ledger_key` names a *slot* (shop, call type, day, attempt). It is
      deterministic and it is what the checkpoint filename is derived from, so
      a rerun lands on the same checkpoint and can see whether we already
      dialled. It must never contain a timestamp.
    * This key names one *attempt at CALL-E*. Nothing downstream reads it, so
      a millisecond timestamp is free to make it unique.

    A timestamp alone would be unsafe if it were minted on every run: a crash
    between `create` and the checkpoint write would produce a new key on the
    next run and place a second call. It is safe here because the minted key is
    written into the checkpoint before `create` and reused by any rerun that
    finds the call outcome unknown. See `execute_live`.

    The suffix is not decoration. A millisecond stamp is not unique on its own:
    two retries in the same millisecond produce the same key, which is the
    collision this key exists to avoid. Entropy is safe here precisely because
    the key is persisted and reused rather than recomputed.
    """
    stamp = int((time.time() if now is None else now) * 1000)
    return f"{ledger_key}-{stamp}-{secrets.token_hex(3)}"


def require_true(value: Any, field: str) -> None:
    """Bound approval: only the boolean True counts. Truthy strings do not."""
    if value is not True:
        raise LiveCallError(
            f"{field} must be the boolean true (not a string or other truthy value)."
        )


def validate_e164(phone: str | None) -> str:
    """Require a strict ASCII E.164 recipient. Never invent or coerce a number."""
    raw = str(phone or "").strip()
    if not E164_RE.fullmatch(raw):
        raise LiveCallError(
            "recipient phone must be E.164 (e.g. +2348000000000); "
            "got a value that is missing, local-only, non-ASCII, or malformed."
        )
    return raw


def build_recipients(request: dict) -> list[dict]:
    for field in ("phone", "region", "locale"):
        if not request.get(field):
            raise LiveCallError(
                f"request is missing {field!r} — never guess phone, region, or locale"
            )
    phone = validate_e164(request["phone"])
    return [{
        "phones": [phone],
        "region": request["region"],
        "locale": request["locale"],
    }]


def mask_phone(phone: str | None) -> str:
    """Mask an E.164 number for logs and API output. Never invent digits."""
    if not phone:
        return ""
    digits = "".join(c for c in str(phone) if c.isdigit())
    if len(digits) < 4:
        return "***"
    return f"+{'*' * (len(digits) - 4)}{digits[-4:]}"


def redact_phones(text: str | None) -> str:
    """Strip phone-shaped substrings from transcripts and error strings."""
    if not text:
        return ""
    return PHONE_IN_TEXT_RE.sub("[phone]", str(text))


def mask_recipients(recipients: Any) -> Any:
    """Return a copy of CALL-E recipients with phones masked."""
    if not isinstance(recipients, list):
        return recipients
    out = []
    for entry in recipients:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        item = dict(entry)
        phones = item.get("phones")
        if isinstance(phones, list):
            item["phones"] = [mask_phone(p) for p in phones]
        out.append(item)
    return out


_PHONE_KEYS = frozenset({
    "phone", "phones", "phone_e164", "masked_phone", "to", "from",
})


def deep_redact(obj: Any) -> Any:
    """Recursively mask phones in nested provider payloads, notes, and traces."""
    if isinstance(obj, str):
        return redact_phones(obj)
    if isinstance(obj, list):
        return [deep_redact(item) for item in obj]
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for key, value in obj.items():
            lower = str(key).lower()
            if lower in _PHONE_KEYS or lower.endswith("_phone") or lower.endswith("phone"):
                if isinstance(value, str):
                    out[key] = mask_phone(value)
                elif isinstance(value, list):
                    out[key] = [
                        mask_phone(v) if isinstance(v, str) else deep_redact(v)
                        for v in value
                    ]
                else:
                    out[key] = deep_redact(value)
            else:
                out[key] = deep_redact(value)
        return out
    return obj


def public_result(result: dict) -> dict:
    """CLI/API-safe copy of an ingest-shaped result (nested phones masked)."""
    return deep_redact(dict(result))


def _http_status(exc: BaseException) -> int | None:
    for attr in ("status_code", "status", "http_status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        for attr in ("status_code", "status"):
            value = getattr(response, attr, None)
            if isinstance(value, int):
                return value
    return None


def is_definitive_create_rejection(exc: BaseException) -> bool:
    """True only when the provider returned an observed HTTP 4xx refusal.

    Exception message words such as "invalid" or "rejected" alone must not
    authorize a fresh idempotency key — the create may still have landed.
    Timeouts, 5xx, and transport failures are always ambiguous.
    """
    status = _http_status(exc)
    if status is None:
        return False
    return 400 <= status < 500


# --------------------------------------------------------------------------
# Checkpoints — a crash must never cause a second call
# --------------------------------------------------------------------------

def checkpoint_path(provider_hash: str, key: str) -> Path:
    slug = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return STATE_DIR / provider_hash / f"{slug}.json"


def read_checkpoint(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LiveCallError(
            f"Checkpoint {path.name} is corrupt. Inspect it before retrying — "
            "deleting it may cause a duplicate call."
        ) from exc
    if not isinstance(payload, dict):
        raise LiveCallError(f"Checkpoint {path.name} is not an object.")
    if payload.get("version") not in (None, CHECKPOINT_VERSION):
        raise LiveCallError(f"Checkpoint {path.name} has an unsupported version.")
    return payload


def write_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = dict(payload, version=CHECKPOINT_VERSION)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(body, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)  # atomic — a half-written checkpoint is worse than none


# --------------------------------------------------------------------------
# Response normalisation — the SDK may hand back objects or dicts
# --------------------------------------------------------------------------

def _field(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _as_dict(obj: Any) -> dict:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    for attr in ("model_dump", "to_dict", "dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                out = fn()
                if isinstance(out, dict):
                    return out
            except TypeError:
                pass
    return {k: v for k, v in vars(obj).items() if not k.startswith("_")}


def to_ingest_shape(call: Any, request: dict, *, call_date: str, key: str) -> dict:
    """Normalise a CALL-E response into the shape `ingest.ingest_call` accepts.

    The fixtures under `fixtures/calls/` are the specification for this shape;
    keep them and this function in step.
    """
    raw = _as_dict(call)
    call_id = _field(call, "id") or _field(call, "call_id")
    if not isinstance(call_id, str) or not call_id:
        raise LiveCallError("CALL-E response carried no call id.")

    confidence = _as_dict(_field(call, "completion_confidence"))
    structured = _field(call, "structured_result")
    if structured is not None and not isinstance(structured, dict):
        structured = _as_dict(structured)

    metadata = {
        "shop_id": request["shop_id"],
        "call_type": request["call_type"],
        "call_date": call_date,
    }
    # vendor_order and order_status ingest by metadata.order_id (see
    # ingest.py) — the vendor has no reason to know our internal order id,
    # and the owner callback schema requires the model to echo it back, which
    # is not reliable enough to depend on alone. request_id carries the
    # order_id for both, set by whoever built the request (see server.py).
    if request["call_type"] in REQUEST_KEYED_CALL_TYPES and request.get("request_id"):
        metadata["order_id"] = request["request_id"]

    shaped = {
        "call_id": call_id,
        "idempotency_key": key,
        "status": _field(call, "status", "unknown"),
        "task_completed": bool(_field(call, "task_completed", False)),
        "completion_confidence": confidence,
        "structured_result": structured,
        "metadata": metadata,
    }
    recipients = raw.get("recipients")
    if recipients:
        shaped["recipients"] = mask_recipients(recipients)
    return shaped


# --------------------------------------------------------------------------
# The call
# --------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def format_progress(elapsed: float, status: str) -> str:
    whole = int(elapsed)
    return f"  {whole // 60}:{whole % 60:02d}  {status}"


def stderr_progress(elapsed: float, status: str) -> None:
    """Default progress sink. stderr, never stdout — stdout carries the JSON
    result, and a caller piping it must not receive progress lines."""
    print(format_progress(elapsed, status), file=sys.stderr, flush=True)


def _poll_until_terminal(client: Any, call_id: str, *, timeout_seconds: float,
                         sleep=time.sleep, monotonic=time.monotonic,
                         progress=None) -> Any:
    started = monotonic()
    deadline = started + timeout_seconds
    latest = None
    last_status: str | None = None
    last_emit = -PROGRESS_HEARTBEAT_SECONDS
    while monotonic() < deadline:
        latest = client.calls.get(call_id)
        status = _field(latest, "status", "unknown")
        if progress is not None and (
                status != last_status
                or (monotonic() - started) - last_emit >= PROGRESS_HEARTBEAT_SECONDS):
            elapsed = monotonic() - started
            progress(elapsed, status)
            last_status, last_emit = status, elapsed
        if status in TERMINAL_STATUSES:
            return latest
        sleep(POLL_INTERVAL_SECONDS)
    raise LiveCallError(
        f"Call {call_id} did not reach a terminal status within "
        f"{timeout_seconds:.0f}s. It may still be running — check the CALL-E "
        f"dashboard before retrying, or the retry may duplicate it."
    )


def execute_live(request: dict, client: Any, *, task: str, schema: dict,
                 provider_hash: str, call_date: str | None = None,
                 attempt: int = 1, request_id: str | None = None,
                 timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
                 sleep=time.sleep, monotonic=time.monotonic,
                 progress=None) -> dict:
    """Place one call and return a result in `ingest.ingest_call` shape.

    Crash-safe: the checkpoint records the call id the moment CALL-E returns
    one, so a rerun polls the existing call instead of placing a second.

    `request_id` (the order_id) is required for `vendor_order` and
    `order_status` — see REQUEST_KEYED_CALL_TYPES.
    """
    if request.get("recipient_consented") is not True:
        raise LiveCallError(
            "request.recipient_consented must be the boolean true — the "
            "recipient must opt in before any live call."
        )

    call_date = call_date or date.today().isoformat()
    key = idempotency_key(request["shop_id"], request["call_type"], call_date,
                          attempt, request_id=request_id)
    checkpoint = checkpoint_path(provider_hash, key)
    state = read_checkpoint(checkpoint)

    call_id = state.get("call_id")
    if isinstance(call_id, str) and call_id:
        # A previous run already created this call. Never create it again.
        latest = client.calls.get(call_id)
        if _field(latest, "status") not in TERMINAL_STATUSES:
            latest = _poll_until_terminal(
                client, call_id, timeout_seconds=timeout_seconds,
                sleep=sleep, monotonic=monotonic, progress=progress)
    else:
        recipients = build_recipients(request)
        # Reuse the key from an interrupted or ambiguous attempt: we cannot
        # tell whether `create` landed, and letting CALL-E dedupe is the safe
        # side of that doubt. Mint a fresh one only when CALL-E explicitly
        # refused (create_rejected), because then no call exists and the old
        # key is already burned.
        previous = state.get("request_idempotency_key")
        phase = state.get("phase")
        if (isinstance(previous, str) and previous
                and phase != "create_rejected"):
            request_key = previous
        else:
            request_key = request_idempotency_key(key)
        write_checkpoint(checkpoint, {
            "phase": "reserved",
            "provider_account_hash": provider_hash,
            "idempotency_key": key,
            "request_idempotency_key": request_key,
            "masked_phone": mask_phone(request["phone"]),
            "updated_at": _now(),
        })
        try:
            created = client.calls.create(
                task=task,
                recipients=recipients,
                result_schema=schema,
                idempotency_key=request_key,
            )
        except Exception as exc:
            safe_error = redact_phones(str(exc))[:300]
            if is_definitive_create_rejection(exc):
                # CALL-E refused: no call was placed; a corrected retry may
                # mint a new key instead of colliding.
                write_checkpoint(checkpoint, {
                    "phase": "create_rejected",
                    "provider_account_hash": provider_hash,
                    "idempotency_key": key,
                    "request_idempotency_key": request_key,
                    "error": safe_error,
                    "updated_at": _now(),
                })
            else:
                # Timeout / 5xx / transport: keep the reserved key so a rerun
                # presents the same idempotency key to CALL-E.
                write_checkpoint(checkpoint, {
                    "phase": "reserved",
                    "provider_account_hash": provider_hash,
                    "idempotency_key": key,
                    "request_idempotency_key": request_key,
                    "masked_phone": mask_phone(request["phone"]),
                    "error": safe_error,
                    "updated_at": _now(),
                })
            raise
        call_id = _field(created, "id") or _field(created, "call_id")
        if not isinstance(call_id, str) or not call_id:
            # Ambiguous: create may have succeeded server-side. Preserve the
            # reserved key — never relabel as rejected.
            write_checkpoint(checkpoint, {
                "phase": "create_unknown",
                "provider_account_hash": provider_hash,
                "idempotency_key": key,
                "request_idempotency_key": request_key,
                "masked_phone": mask_phone(request["phone"]),
                "error": "create response carried no call id",
                "updated_at": _now(),
            })
            raise LiveCallError("CALL-E create response carried no call id.")
        write_checkpoint(checkpoint, {
            "phase": "created",
            "call_id": call_id,
            "provider_account_hash": provider_hash,
            "idempotency_key": key,
            "request_idempotency_key": request_key,
            "masked_phone": mask_phone(request["phone"]),
            "updated_at": _now(),
        })
        latest = created if _field(created, "status") in TERMINAL_STATUSES else \
            _poll_until_terminal(client, call_id, timeout_seconds=timeout_seconds,
                                 sleep=sleep, monotonic=monotonic,
                                 progress=progress)

    write_checkpoint(checkpoint, {
        "phase": "finished",
        "call_id": call_id,
        "provider_account_hash": provider_hash,
        "idempotency_key": key,
        "masked_phone": mask_phone(request["phone"]),
        "status": _field(latest, "status", "unknown"),
        "updated_at": _now(),
    })
    return to_ingest_shape(latest, request, call_date=call_date, key=key)


def build_client(api_key: str, base_url: str) -> Any:
    """Import and construct the SDK client. Imported lazily so the demo path,
    the tests, and `--help` never need `calle-ai` installed."""
    try:
        from calle import CalleClient
    except ImportError as exc:
        raise LiveCallError(
            "The CALL-E SDK is not installed. Run: pip install 'calle-ai>=0.1.0'"
        ) from exc
    return CalleClient(api_key=api_key, base_url=base_url)
