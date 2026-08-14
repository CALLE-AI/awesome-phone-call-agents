"""Durably receive terminal CALL-E webhook notifications."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
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
WEBHOOK_PATH = "/calle/webhook"
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

    def digest_for(self, event_id: str) -> str | None:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT payload_digest FROM events WHERE event_id = ?", (event_id,)
            ).fetchone()
            return None if row is None else str(row["payload_digest"])
        finally:
            connection.close()

    def insert(self, record: Mapping[str, Any]) -> bool:
        connection = self._connect()
        try:
            try:
                with connection:
                    connection.execute(
                        """
                        INSERT INTO events (
                          event_id, payload_digest, event_type, call_id,
                          call_status, workflow_id, wants_human_callback,
                          verification_mode, received_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            except sqlite3.IntegrityError:
                return False
            return True
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
        existing = store.digest_for(event["id"])
    except Exception:  # noqa: BLE001
        return 500, {"error": "internal_error"}
    if existing is not None:
        if existing == digest:
            return 200, {"received": True, "duplicate": True}
        return 409, {"error": "event_id_conflict"}

    try:
        if verification_mode == "fixture":
            snapshot = event["data"]
        else:
            if call_fetcher is None:
                raise RuntimeError("live receiver has no call fetcher")
            snapshot = call_fetcher(event["data"]["id"])
        record = authoritative_record(event, snapshot, digest, verification_mode)
    except CalleAuthenticationError:
        return 500, {"error": "internal_error"}
    except (CalleConnectionError, CalleTimeoutError, CalleRateLimitError):
        return 503, {"error": "upstream_unavailable"}
    except CalleAPIError as error:
        if error.status_code >= 500:
            return 503, {"error": "upstream_unavailable"}
        return 409, {"error": "authoritative_rejected"}
    except InvalidEvent as error:
        return 409, {"error": error.code}
    except Exception:  # noqa: BLE001
        return 500, {"error": "internal_error"}

    try:
        inserted = store.insert(record)
        if inserted:
            return 200, {"received": True, "duplicate": False}
        winner = store.digest_for(event["id"])
    except Exception:  # noqa: BLE001
        return 500, {"error": "internal_error"}
    if winner == digest:
        return 200, {"received": True, "duplicate": True}
    return 409, {"error": "event_id_conflict"}


class WebhookHTTPServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

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
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

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

    def do_POST(self) -> None:
        if self.path != WEBHOOK_PATH:
            self.send_json(404, {"error": "not_found"})
            return
        content_type = self.headers.get("Content-Type")
        if (
            not isinstance(content_type, str)
            or content_type.split(";", 1)[0].strip().lower() != "application/json"
        ):
            self.send_json(400, {"error": "invalid_content_type"})
            return
        length = parse_content_length(self.headers.get_all("Content-Length"))
        if length is None or self.headers.get_all("Transfer-Encoding"):
            self.send_json(400, {"error": "invalid_content_length"})
            return
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            self.send_json(413, {"error": "payload_too_large"})
            return
        try:
            raw = self.rfile.read(length)
        except OSError:
            self.close_connection = True
            self.send_json(400, {"error": "invalid_body"})
            return
        if len(raw) != length:
            self.close_connection = True
            self.send_json(400, {"error": "invalid_body"})
            return
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
            self.send_json(400, {"error": "invalid_json"})
            return
        status, payload = process_event(
            self.store,
            value,
            self.headers.get("CALL-E-Event-Id"),
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

    return CalleClient(api_key=api_key)


def _print_response(payload: Mapping[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")


def main(
    argv: list[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    client_factory: Callable[..., object] | None = None,
) -> int:
    args = parse_args(argv)
    if args.replay is not None:
        try:
            raw = args.replay.read_bytes()
            if len(raw) > MAX_BODY_BYTES:
                raise ValueError("fixture is too large")
            value = json.loads(raw.decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            _print_response({"error": "invalid_fixture"})
            return 1
        event_header = value.get("id") if isinstance(value, dict) else None
        store = EventStore(args.database)
        status, payload = process_event(
            store,
            value,
            event_header,
            call_fetcher=None,
            verification_mode="fixture",
        )
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
