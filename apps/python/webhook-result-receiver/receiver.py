"""Durably receive terminal CALL-E webhook notifications."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import threading
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from calle import (
        CalleAPIError,
        CalleAuthenticationError,
        CalleConnectionError,
        CalleRateLimitError,
        CalleTimeoutError,
    )
except ModuleNotFoundError:  # Replay remains usable before dependencies are installed.

    class CalleAPIError(Exception):
        def __init__(
            self,
            *,
            code: str,
            message: str,
            status_code: int,
            details: dict[str, Any] | None = None,
        ) -> None:
            super().__init__(message)
            self.code = code
            self.status_code = status_code
            self.details = details or {}

    class CalleAuthenticationError(CalleAPIError):
        pass

    class CalleRateLimitError(CalleAPIError):
        pass

    class CalleTimeoutError(Exception):
        pass

    class CalleConnectionError(Exception):
        pass


MAX_BODY_BYTES = 1_048_576
BODY_READ_TIMEOUT_SECONDS = 2.0
BODY_READ_DEADLINE_SECONDS = 10.0
BODY_READ_CHUNK_BYTES = 64 * 1024
API_TIMEOUT_SECONDS = 10.0
MAX_ACTIVE_REQUESTS = 8
SATURATED_DRAIN_DEADLINE_SECONDS = 0.1
SATURATED_DRAIN_LIMIT_BYTES = MAX_BODY_BYTES + 64 * 1024
WEBHOOK_PATH = "/calle/webhook"
SAFE_PROVIDER_TOKEN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
TERMINAL_STATUSES = {
    "call.completed": {"completed"},
    "call.failed": {"failed", "canceled"},
    "call.result_validation_failed": {"completed"},
}
WORKFLOW = "webhook-result-receiver"
SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  payload_digest TEXT NOT NULL,
  event_type TEXT NOT NULL,
  call_id TEXT NOT NULL,
  call_status TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  wants_human_callback TEXT,
  verification_mode TEXT NOT NULL,
  received_at TEXT NOT NULL
)
"""


class InvalidEvent(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class InvalidBody(OSError):
    pass


def _reject_json_constant(_value: str) -> object:
    raise ValueError("non-finite JSON number")


def _strict_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def strict_json_loads(raw: str) -> object:
    return json.loads(
        raw,
        parse_constant=_reject_json_constant,
        object_pairs_hook=_strict_json_object,
    )


class EventStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = self._connect()
        try:
            connection.execute(SCHEMA)
            connection.commit()
        finally:
            connection.close()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def receipt_for(self, event_id: str) -> tuple[str, str] | None:
        connection = self._connect()
        try:
            row = connection.execute(
                """
                SELECT payload_digest, verification_mode
                FROM events
                WHERE event_id = ?
                """,
                (event_id,),
            ).fetchone()
            if row is None:
                return None
            return str(row["payload_digest"]), str(row["verification_mode"])
        finally:
            connection.close()

    def persist(self, record: Mapping[str, Any]) -> str:
        connection = self._connect()
        try:
            with connection:
                cursor = connection.execute(
                    """
                    INSERT INTO events (
                      event_id, payload_digest, event_type, call_id,
                      call_status, workflow_id, wants_human_callback,
                      verification_mode, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(event_id) DO UPDATE SET
                      payload_digest = excluded.payload_digest,
                      event_type = excluded.event_type,
                      call_id = excluded.call_id,
                      call_status = excluded.call_status,
                      workflow_id = excluded.workflow_id,
                      wants_human_callback = excluded.wants_human_callback,
                      verification_mode = excluded.verification_mode,
                      received_at = excluded.received_at
                    WHERE events.payload_digest = excluded.payload_digest
                      AND events.verification_mode = 'fixture'
                      AND excluded.verification_mode = 'api'
                    """,
                    (
                        record["event_id"],
                        record["payload_digest"],
                        record["event_type"],
                        record["call_id"],
                        record["call_status"],
                        record["workflow_id"],
                        record["wants_human_callback"],
                        record["verification_mode"],
                        record["received_at"],
                    ),
                )
                if cursor.rowcount == 1:
                    return "accepted"
                winner = connection.execute(
                    """
                    SELECT payload_digest, verification_mode
                    FROM events
                    WHERE event_id = ?
                    """,
                    (record["event_id"],),
                ).fetchone()
                if winner is None:
                    raise sqlite3.IntegrityError("event persistence lost its row")
                if str(winner["payload_digest"]) == record["payload_digest"]:
                    return "duplicate"
                return "conflict"
        finally:
            connection.close()


def _nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_event(value: object, event_header: str | None) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvalidEvent("invalid_event")
    event_id = value.get("id")
    event_type = value.get("type")
    created_at = value.get("created_at")
    data = value.get("data")
    if (
        not _nonempty_string(event_id)
        or not _nonempty_string(event_type)
        or not _nonempty_string(created_at)
        or not isinstance(data, dict)
        or not _nonempty_string(data.get("id"))
    ):
        raise InvalidEvent("invalid_event")
    if (
        SAFE_PROVIDER_TOKEN.fullmatch(event_id) is None
        or SAFE_PROVIDER_TOKEN.fullmatch(data["id"]) is None
    ):
        raise InvalidEvent("invalid_event")
    if event_header != event_id:
        raise InvalidEvent("event_id_mismatch")
    if event_type not in TERMINAL_STATUSES:
        raise InvalidEvent("unsupported_event_type")
    return value


def canonical_digest(event: Mapping[str, Any]) -> str:
    payload = json.dumps(
        event,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def parse_content_length(values: list[str] | None) -> int | None:
    if (
        values is None
        or len(values) != 1
        or not isinstance(values[0], str)
        or re.fullmatch(r"[0-9]+", values[0]) is None
    ):
        return None
    try:
        return int(values[0])
    except ValueError:
        return None


def authoritative_record(
    event: Mapping[str, Any], snapshot: object, digest: str, mode: str
) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise InvalidEvent("authoritative_mismatch")
    notification = event["data"]
    call_id = snapshot.get("id")
    call_status = snapshot.get("status")
    metadata = snapshot.get("metadata")
    notification_metadata = notification.get("metadata")
    if (
        not _nonempty_string(call_id)
        or call_id != notification.get("id")
        or call_status not in TERMINAL_STATUSES[event["type"]]
        or not isinstance(metadata, dict)
        or metadata.get("workflow") != WORKFLOW
        or not _nonempty_string(metadata.get("workflow_id"))
        or not isinstance(notification_metadata, dict)
        or notification_metadata.get("workflow") != metadata.get("workflow")
        or notification_metadata.get("workflow_id") != metadata.get("workflow_id")
    ):
        raise InvalidEvent("authoritative_mismatch")

    result = snapshot.get("structured_result")
    wants_callback = (
        result.get("wants_human_callback") if isinstance(result, dict) else None
    )
    if wants_callback not in {"yes", "no", "unknown"}:
        wants_callback = None
    return {
        "event_id": event["id"],
        "payload_digest": digest,
        "event_type": event["type"],
        "call_id": call_id,
        "call_status": call_status,
        "workflow_id": metadata["workflow_id"],
        "wants_human_callback": wants_callback,
        "verification_mode": mode,
        "received_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def process_event(
    store: EventStore,
    value: object,
    event_header: str | None,
    *,
    call_fetcher: Callable[[str], object] | None,
    verification_mode: str = "api",
) -> tuple[int, dict[str, object]]:
    try:
        event = validate_event(value, event_header)
        digest = canonical_digest(event)
    except InvalidEvent as error:
        return 400, {"error": error.code}
    except (RecursionError, TypeError, UnicodeError, ValueError):
        return 400, {"error": "invalid_json"}
    try:
        existing = store.receipt_for(event["id"])
    except Exception:  # noqa: BLE001
        return 500, {"error": "internal_error"}
    if existing is not None:
        existing_digest, existing_mode = existing
        if existing_digest != digest:
            return 409, {"error": "event_id_conflict"}
        if existing_mode == "api" or verification_mode == "fixture":
            return 200, {"received": True, "duplicate": True}
        if existing_mode != "fixture" or verification_mode != "api":
            return 500, {"error": "internal_error"}

    if verification_mode == "fixture":
        snapshot = event["data"]
    else:
        try:
            if call_fetcher is None:
                raise RuntimeError("live receiver has no call fetcher")
            snapshot = call_fetcher(event["data"]["id"])
        except CalleAuthenticationError:
            return 500, {"error": "internal_error"}
        except (CalleConnectionError, CalleTimeoutError, CalleRateLimitError):
            return 503, {"error": "upstream_unavailable"}
        except CalleAPIError as error:
            if error.status_code >= 500:
                return 503, {"error": "upstream_unavailable"}
            return 409, {"error": "authoritative_rejected"}
        except (json.JSONDecodeError, UnicodeError, RecursionError, EOFError):
            return 503, {"error": "upstream_unavailable"}
        except Exception:  # noqa: BLE001
            return 500, {"error": "internal_error"}

    try:
        record = authoritative_record(event, snapshot, digest, verification_mode)
    except InvalidEvent as error:
        return 409, {"error": error.code}
    except Exception:  # noqa: BLE001
        return 500, {"error": "internal_error"}

    try:
        outcome = store.persist(record)
        if outcome == "accepted":
            return 200, {"received": True, "duplicate": False}
    except Exception:  # noqa: BLE001
        return 500, {"error": "internal_error"}
    if outcome == "duplicate":
        return 200, {"received": True, "duplicate": True}
    if outcome == "conflict":
        return 409, {"error": "event_id_conflict"}
    return 500, {"error": "internal_error"}


class WebhookHTTPServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._request_slots = threading.BoundedSemaphore(MAX_ACTIVE_REQUESTS)
        super().__init__(*args, **kwargs)

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self._request_slots.acquire(blocking=False):
            body = b'{"error":"receiver_busy"}'
            response = (
                b"HTTP/1.1 503 Service Unavailable\r\n"
                b"Content-Type: application/json\r\n"
                + f"Content-Length: {len(body)}\r\n".encode("ascii")
                + b"Connection: close\r\n\r\n"
                + body
            )
            try:
                request.settimeout(BODY_READ_TIMEOUT_SECONDS)
                request.sendall(response)
            except OSError:
                pass
            finally:
                drain_deadline = time.monotonic() + SATURATED_DRAIN_DEADLINE_SECONDS
                drained = 0
                while drained < SATURATED_DRAIN_LIMIT_BYTES:
                    remaining = drain_deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    try:
                        request.settimeout(remaining)
                        chunk = request.recv(
                            min(
                                BODY_READ_CHUNK_BYTES,
                                SATURATED_DRAIN_LIMIT_BYTES - drained,
                            )
                        )
                    except OSError:
                        break
                    if not chunk:
                        break
                    drained += len(chunk)
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._request_slots.release()
            self.shutdown_request(request)
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()

    def handle_error(self, request: object, client_address: object) -> None:
        return


class WebhookHandler(BaseHTTPRequestHandler):
    store: EventStore
    call_fetcher: Callable[[str], object]

    def log_message(self, format: str, *args: object) -> None:
        return

    def setup(self) -> None:
        self.request.settimeout(BODY_READ_TIMEOUT_SECONDS)
        super().setup()

    def __getattr__(self, name: str) -> Any:
        if name.startswith("do_"):
            return self._method_response
        raise AttributeError(name)

    def send_json(
        self, status: int, payload: Mapping[str, object], *, include_body: bool = True
    ) -> None:
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _discard_small_declared_body(self) -> None:
        length = parse_content_length(self.headers.get_all("Content-Length"))
        if (
            length is None
            or length > MAX_BODY_BYTES
            or self.headers.get_all("Transfer-Encoding")
        ):
            return
        deadline = time.monotonic() + SATURATED_DRAIN_DEADLINE_SECONDS
        remaining = length
        read_chunk = getattr(self.rfile, "read1", self.rfile.read)
        try:
            while remaining:
                deadline_remaining = deadline - time.monotonic()
                if deadline_remaining <= 0:
                    return
                self.request.settimeout(deadline_remaining)
                chunk = read_chunk(min(BODY_READ_CHUNK_BYTES, remaining))
                if not chunk:
                    return
                remaining -= len(chunk)
        except OSError:
            return

    def send_early_json(self, status: int, payload: Mapping[str, object]) -> None:
        self.close_connection = True
        self.send_json(status, payload)
        self._discard_small_declared_body()

    def _method_response(self, *, include_body: bool = True) -> None:
        if self.path == WEBHOOK_PATH:
            self.send_response(405)
            body = b'{"error":"method_not_allowed"}'
            self.send_header("Allow", "POST")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if include_body:
                self.wfile.write(body)
            return
        self.send_json(404, {"error": "not_found"}, include_body=include_body)

    def do_GET(self) -> None:
        self._method_response()

    def do_PUT(self) -> None:
        self._method_response()

    def do_PATCH(self) -> None:
        self._method_response()

    def do_DELETE(self) -> None:
        self._method_response()

    def do_OPTIONS(self) -> None:
        self._method_response()

    def do_HEAD(self) -> None:
        self._method_response(include_body=False)

    def _read_body(self, length: int) -> bytes:
        deadline = time.monotonic() + BODY_READ_DEADLINE_SECONDS
        remaining = length
        chunks: list[bytes] = []
        read_chunk = getattr(self.rfile, "read1", self.rfile.read)
        try:
            while remaining:
                deadline_remaining = deadline - time.monotonic()
                if deadline_remaining <= 0:
                    raise InvalidBody
                self.request.settimeout(
                    min(BODY_READ_TIMEOUT_SECONDS, deadline_remaining)
                )
                chunk = read_chunk(min(BODY_READ_CHUNK_BYTES, remaining))
                if not chunk:
                    raise InvalidBody
                chunks.append(chunk)
                remaining -= len(chunk)
                if time.monotonic() >= deadline:
                    raise InvalidBody
        except (OSError, TimeoutError) as error:
            raise InvalidBody from error
        finally:
            try:
                self.request.settimeout(BODY_READ_TIMEOUT_SECONDS)
            except OSError:
                pass
        return b"".join(chunks)

    def do_POST(self) -> None:
        if self.path != WEBHOOK_PATH:
            self.send_early_json(404, {"error": "not_found"})
            return
        content_types = self.headers.get_all("Content-Type")
        if (
            content_types is None
            or len(content_types) != 1
            or not isinstance(content_types[0], str)
        ):
            self.send_early_json(400, {"error": "invalid_content_type"})
            return
        content_type = content_types[0]
        if content_type.split(";", 1)[0].strip().lower() != "application/json":
            self.send_early_json(400, {"error": "invalid_content_type"})
            return
        length = parse_content_length(self.headers.get_all("Content-Length"))
        if length is None or self.headers.get_all("Transfer-Encoding"):
            self.send_json(400, {"error": "invalid_content_length"})
            return
        event_headers = self.headers.get_all("CALL-E-Event-Id")
        if (
            event_headers is None
            or len(event_headers) != 1
            or not isinstance(event_headers[0], str)
        ):
            self.send_early_json(400, {"error": "invalid_event_header"})
            return
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            self.send_json(413, {"error": "payload_too_large"})
            return
        try:
            raw = self._read_body(length)
        except InvalidBody:
            self.close_connection = True
            self.send_json(400, {"error": "invalid_body"})
            return
        try:
            value = strict_json_loads(raw.decode("utf-8"))
        except (UnicodeError, ValueError, RecursionError):
            self.send_json(400, {"error": "invalid_json"})
            return
        status, payload = process_event(
            self.store,
            value,
            event_headers[0],
            call_fetcher=self.call_fetcher,
        )
        self.send_json(status, payload)


def create_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    database_path: Path = Path("data/events.sqlite3"),
    *,
    call_fetcher: Callable[[str], object],
) -> ThreadingHTTPServer:
    handler = type(
        "ConfiguredWebhookHandler",
        (WebhookHandler,),
        {
            "store": EventStore(database_path),
            "call_fetcher": staticmethod(call_fetcher),
        },
    )
    return WebhookHTTPServer((host, port), handler)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--database", type=Path, default=Path("data/events.sqlite3"))
    parser.add_argument("--replay", type=Path)
    return parser.parse_args(argv)


def default_client_factory(*, api_key: str) -> object:
    from calle import CalleClient

    return CalleClient(api_key=api_key, timeout=API_TIMEOUT_SECONDS)


def _print_response(payload: Mapping[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")


def main(
    argv: list[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    client_factory: Callable[..., object] | None = None,
) -> int:
    args = parse_args(argv)
    if args.replay is not None:
        try:
            with args.replay.open("rb") as fixture_file:
                raw = fixture_file.read(MAX_BODY_BYTES + 1)
            if len(raw) > MAX_BODY_BYTES:
                raise ValueError("fixture is too large")
            value = strict_json_loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001 - fixture failures use one private code.
            _print_response({"error": "invalid_fixture"})
            return 1
        event_header = value.get("id") if isinstance(value, dict) else None
        try:
            store = EventStore(args.database)
            status, payload = process_event(
                store,
                value,
                event_header,
                call_fetcher=None,
                verification_mode="fixture",
            )
        except Exception:  # noqa: BLE001 - replay never emits traceback details.
            _print_response({"error": "internal_error"})
            return 1
        _print_response(payload)
        return 0 if 200 <= status < 300 else 1

    environment = os.environ if environ is None else environ
    api_key = environment.get("CALLE_API_KEY")
    if not isinstance(api_key, str) or not api_key.strip():
        sys.stderr.write("error: CALLE_API_KEY is required to serve webhooks\n")
        return 2
    factory = default_client_factory if client_factory is None else client_factory
    client = factory(api_key=api_key)
    server = None
    try:
        server = create_server(
            host=args.host,
            port=args.port,
            database_path=args.database,
            call_fetcher=client.calls.get,
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    finally:
        try:
            if server is not None:
                server.server_close()
        finally:
            client.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
