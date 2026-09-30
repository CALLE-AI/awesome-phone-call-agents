"""Webhook receiver for ringfence.

``POST /cases`` accepts a flagged transaction case from an institution's own
fraud system and places (or, by default, previews) the independent
verification call. ``GET /cases/{id}`` returns that case's current status
and advisory recommendation (``null`` until a live call has completed and
been resolved).

Every record this module returns carries ``advisory: true`` and
``requires_human_review: true``: the ``disposition`` field is a
recommendation derived from a heuristic reading of one phone call, never an
instruction to release or hold money. See ``decide.py`` for why, and do not
wire the field into an automated approve/hold action.

Kept dependency-light (stdlib ``http.server``), matching this repo's own
apps/python/webhook-result-receiver precedent of not pulling in a web
framework for a couple of endpoints. That receiver ingests CALL-E's own
outbound webhook notifications (the opposite direction); this one is an
inbound API an institution calls into.

This module never re-implements the dial-target invariant — every request
goes through ``verify_call.place_verification_call`` (which itself always
calls ``verify_call.resolve_dial_target``), so the same guarantee proven in
tests/test_invariant_never_calls_request_supplied_number.py holds here too.
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Mapping

from .case import Case
from .decide import ESCALATE_TO_HUMAN, decide as decide_case
from .ledger import CaseLedger
from .resolve import classify as classify_call
from .safety import redact_value
from .verify_call import DIALED, ERROR, SecurityEventLog, place_verification_call

MAX_BODY_BYTES = 65_536
DEFAULT_SECURITY_LOG_PATH = Path("results/security_events.jsonl")
DEFAULT_LEDGER_PATH = Path("results/case_ledger.jsonl")


class CaseNotFound(KeyError):
    pass


class CaseStore:
    """Thread-safe case ledger, optionally backed by a durable ``CaseLedger``.

    One verification attempt per ``case_id``: a case_id already present is
    never re-dialed on a repeat POST — the existing record is returned as-is.
    This is the "no harassment" rule from the build spec: no automatic
    re-dial loop; a blocked/declined case requires the institution to submit
    a **new** case deliberately, never a resubmit of the same id.

    Without a ``ledger``, state is in-memory only (fine for tests and the
    dry-run CLI path). With one, every create/update is durably appended
    *before* the in-memory dict changes, and the constructor replays the
    ledger — so a process restart reconstructs exactly which cases were
    already dialed, and never re-dials one just because memory was wiped.
    """

    def __init__(self, ledger: CaseLedger | None = None) -> None:
        self._lock = threading.Lock()
        self._ledger = ledger
        self._cases: dict[str, dict] = ledger.replay() if ledger is not None else {}

    def get(self, case_id: str) -> dict | None:
        with self._lock:
            record = self._cases.get(case_id)
            return dict(record) if record is not None else None

    def create_if_absent(self, case_id: str, record: dict) -> tuple[dict, bool]:
        with self._lock:
            existing = self._cases.get(case_id)
            if existing is not None:
                return dict(existing), False
            if self._ledger is not None:
                self._ledger.append("create", case_id, record)
            self._cases[case_id] = record
            return dict(record), True

    def update(self, case_id: str, **fields: object) -> None:
        with self._lock:
            if case_id not in self._cases:
                raise CaseNotFound(case_id)
            if self._ledger is not None:
                self._ledger.append("update", case_id, fields)
            self._cases[case_id].update(fields)


def _resolve_and_store_disposition(
    store: CaseStore, case_id: str, client: object, call_id: str
) -> None:
    """Fetch the completed call's full detail and store its recommendation.

    Only reached in ``--live`` mode, after ``create_and_wait`` has already
    returned a terminal call — this is a read of that same call's detail and
    events, never a second call placed.
    """
    call = client.calls.get(call_id)
    events_page = client.calls.list_events(call_id)
    events = events_page.get("data", []) if isinstance(events_page, dict) else list(events_page)
    attempts: list[dict] = []
    for recipient in call.get("recipients") or []:
        attempts.extend(recipient.get("attempts") or [])

    resolution = classify_call(call, attempts, events)
    disposition = decide_case(resolution, call.get("structured_result") or {})
    store.update(
        case_id,
        outcome=resolution.outcome,
        disposition=disposition.disposition,
        disposition_reasons=disposition.reasons,
        advisory=True,
        requires_human_review=True,
    )


def handle_submit(
    store: CaseStore,
    data: dict,
    *,
    live: bool,
    security_log: SecurityEventLog,
    client_factory: Callable[[], object] | None,
) -> tuple[int, dict]:
    """Pure request-handling logic, exercised directly by tests and by the
    HTTP handler below."""
    try:
        case = Case.from_dict(data)
    except ValueError as exc:
        return 400, {"error": "invalid_case", "detail": str(exc)}

    # Reserve the record atomically *before* placing any call. Two
    # concurrent requests for the same never-before-seen case_id (e.g. a
    # retried webhook delivery) both racing store.get() -> dial -> store
    # would risk two real outbound dials for one case; reserving first means
    # only the request that actually wins create_if_absent's lock ever
    # reaches place_verification_call.
    placeholder = {
        "case_id": case.case_id,
        "status": "reserved",
        "dialed_phone_masked": None,
        "call_id": None,
        "detail": "",
        "outcome": None,
        "disposition": None,
        "disposition_reasons": [],
        # Structural, not configurable: no code path in this module
        # produces a disposition that is safe to act on without a human.
        "advisory": True,
        "requires_human_review": True,
    }
    reserved, created = store.create_if_absent(case.case_id, placeholder)
    if not created:
        return 200, redact_value(reserved)

    client_holder: dict[str, object] = {}
    wrapped_factory = None
    if client_factory is not None:
        def wrapped_factory():  # noqa: ANN202
            client = client_factory()
            client_holder["client"] = client
            return client

    outcome = place_verification_call(
        case, live=live, security_log=security_log, client_factory=wrapped_factory
    )
    store.update(
        case.case_id,
        status=outcome.status,
        dialed_phone_masked=outcome.dialed_phone_masked,
        call_id=outcome.call_id,
        detail=outcome.detail,
    )

    if outcome.status == DIALED and "client" in client_holder:
        if outcome.call_id:
            _resolve_and_store_disposition(store, case.case_id, client_holder["client"], outcome.call_id)
        else:
            # CALL-E's own docs don't guarantee every field is populated on
            # every response — a DIALED outcome with no call_id can't be
            # resolved, so escalate rather than crash trying to fetch it.
            store.update(
                case.case_id,
                outcome="missing_call_id",
                disposition=ESCALATE_TO_HUMAN,
                disposition_reasons=["dialed_but_no_call_id_returned"],
            )
    elif outcome.status == ERROR:
        # A failed live call must not leave the recommendation null forever — this
        # case_id can never be re-dialed (single-attempt-per-case), so the
        # institution needs an explicit signal to follow up, not silence.
        store.update(
            case.case_id,
            outcome="call_error",
            disposition=ESCALATE_TO_HUMAN,
            disposition_reasons=[f"live_call_error: {outcome.detail}"],
        )

    record = store.get(case.case_id) or reserved
    return 201, redact_value(record)


def handle_get(store: CaseStore, case_id: str) -> tuple[int, dict]:
    record = store.get(case_id)
    if record is None:
        return 404, {"error": "not_found"}
    return 200, redact_value(record)


class RingfenceHandler(BaseHTTPRequestHandler):
    store: CaseStore
    live: bool
    client_factory: Callable[[], object] | None
    security_log: SecurityEventLog

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _send_json(self, status: int, payload: Mapping[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/cases":
            self._send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"error": "invalid_content_length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json(400, {"error": "invalid_content_length"})
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            self._send_json(400, {"error": "invalid_json"})
            return
        if not isinstance(data, dict):
            self._send_json(400, {"error": "invalid_case"})
            return
        status, payload = handle_submit(
            self.store,
            data,
            live=self.live,
            security_log=self.security_log,
            client_factory=self.client_factory,
        )
        self._send_json(status, payload)

    def do_GET(self) -> None:  # noqa: N802
        if not self.path.startswith("/cases/"):
            self._send_json(404, {"error": "not_found"})
            return
        case_id = self.path[len("/cases/"):]
        status, payload = handle_get(self.store, case_id)
        self._send_json(status, payload)


def create_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    *,
    live: bool = False,
    client_factory: Callable[[], object] | None = None,
    security_log_path: Path = DEFAULT_SECURITY_LOG_PATH,
    store: CaseStore | None = None,
    ledger_path: Path | None = None,
) -> ThreadingHTTPServer:
    """``ledger_path`` is ignored if an explicit ``store`` is passed in.

    Left ``None`` (the default, and what every existing test uses), the
    store stays in-memory only. Pass a path to make it durable: cases
    survive a server restart, and one already dialed is never re-dialed.
    """
    if live and host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Live webhook is loopback-only; do not expose it through a public bind or proxy.")
    if store is None:
        ledger = CaseLedger(ledger_path) if ledger_path is not None else None
        store = CaseStore(ledger)
    handler = type(
        "ConfiguredRingfenceHandler",
        (RingfenceHandler,),
        {
            "store": store,
            "live": live,
            "client_factory": client_factory,
            "security_log": SecurityEventLog(security_log_path),
        },
    )
    return ThreadingHTTPServer((host, port), handler)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--live", action="store_true", help="Place real calls. Requires --confirm-live.")
    parser.add_argument("--confirm-live", action="store_true", help="Explicit second confirmation required alongside --live.")
    parser.add_argument("--ledger-path", default=str(DEFAULT_LEDGER_PATH), help="Durable case ledger (JSONL). Cases survive a restart and are never re-dialed.")
    parser.add_argument("--no-persist", action="store_true", help="Keep the case store in-memory only (state lost on restart).")
    args = parser.parse_args(argv)

    if args.live and not args.confirm_live:
        raise SystemExit("--live requires --confirm-live (explicit, separate confirmation)")

    client_factory = None
    if args.live:
        def client_factory():  # noqa: ANN202
            from calle import CalleClient

            api_key = os.environ.get("CALLE_API_KEY")
            if not api_key:
                raise SystemExit("CALLE_API_KEY is required for --live")
            return CalleClient(api_key=api_key)

    server = create_server(
        host=args.host, port=args.port, live=args.live, client_factory=client_factory,
        ledger_path=None if args.no_persist else Path(args.ledger_path),
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
