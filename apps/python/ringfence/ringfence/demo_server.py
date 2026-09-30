"""Two-sided demo simulator: a customer-facing "send money" page and a bank
fraud-ops dashboard, both served by this one small stdlib server.

**Simulation only. This server has no live-call path at all.** It never
imports a CALL-E client, never reads ``CALLE_API_KEY``, and holds no code
that could place a real outbound call -- deliberately, because this is the
surface that gets deployed to a public URL, and a publicly reachable page
that can dial a phone number typed by an anonymous visitor is not a
defensible thing to operate. Real calls live only behind the operator-run
surfaces that require explicit doubled confirmation per call
(``cli.py --live --confirm-live``, ``webhook.py``, ``mcp_server.py``); see
the README's "Side effects" table.

For the same reason this server collects **no phone number** of any kind:
there is no field for one, nothing stores one, and the simulated audit
trail uses a fixed fictional number.

The customer never decides whether a verification call happens -- that
mirrors the real product (``webhook.py``: an institution's own fraud system
decides what's flagged, RingFence never does). The bank side decides
automatically, on submission, using one simple policy: any transaction at
or above ``AUTO_APPROVE_BELOW_AMOUNT`` requires verification; anything below
is approved with no call at all. When verification is required, a recorded
scenario is picked automatically from ``fixtures/`` and run through the
real ``resolve.classify()`` and ``decide()`` -- the decision logic is real,
the call is not.

**Every recommendation this server displays is advisory** and carries
``requires_human_review`` (see ``decide.py``): a heuristic reading of one
phone conversation must never be wired straight into approving or holding
someone's money, so both pages present results as a recommendation awaiting
a fraud analyst, never as a completed action.

**Authentication**: when ``RINGFENCE_DEMO_TOKEN`` is set, every page and
every API route requires that token (``Authorization: Bearer``, a
``?token=`` query parameter, or the cookie the pages set from one). The one
exception is ``GET /healthz``, which returns only ``{"status": "ok"}`` so a
platform health check can run without credentials.
``main()`` *refuses to start* on a non-loopback bind without it, so a
deployment reachable from the internet cannot be unauthenticated by
omission -- the failure mode is a startup error, not a quietly open URL.

See ``tests/test_demo_server.py`` for the tests that prove all of this.
"""

from __future__ import annotations

import hmac
import json
import os
import random
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Mapping

from . import decide as decide_mod
from . import resolve
from .audit import build_audit_report
from .safety import redact_value

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
DEMO_DIR = Path(__file__).resolve().parent.parent / "demo"

SIMULATED_CALL_SECONDS = 4  # dramatized delay before the simulated "call" resolves
AUTO_APPROVE_BELOW_AMOUNT = 1000.00  # bank policy: below this, no verification call at all

#: Not a recommendation about a call, because no call happened: the amount
#: was below the institution's own verification threshold. Kept distinct
#: from decide.py's recommendations so nothing reads a deterministic policy
#: outcome as a heuristic call interpretation.
NO_VERIFICATION_REQUIRED = "NO_VERIFICATION_REQUIRED"

#: The fictional number shown in every simulated audit trail. This server
#: never collects or stores a real one.
SIMULATED_DEMO_PHONE = "+15555550100"

DEMO_TOKEN_ENV = "RINGFENCE_DEMO_TOKEN"
DEMO_TOKEN_COOKIE = "ringfence_demo_token"
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})


def is_loopback_host(host: str) -> bool:
    return host.strip().lower() in _LOOPBACK_HOSTS


def token_is_valid(expected: str | None, supplied: str | None) -> bool:
    """Constant-time token check. No configured token means no gate."""
    if not expected:
        return True
    if not supplied:
        return False
    return hmac.compare_digest(expected, supplied)


def _pretty_label(key: str) -> str:
    # Strip a leading "NN_" fixture-ordering prefix, turn underscores into
    # spaces, title-case it -- generic and data-driven rather than a
    # hand-maintained label per fixture. Plain text only: category (for
    # icon selection) is exposed as its own field, not baked into the
    # label string -- the frontend renders an icon from `category`, not
    # by parsing an emoji out of this text.
    stem = key.split("_", 1)[1] if key[:2].isdigit() and "_" in key else key
    words = stem.replace("_", " ").split()
    return " ".join(w.upper() if w in ("ceo",) else w.capitalize() for w in words)


def load_scenarios(fixtures_dir: Path = FIXTURES_DIR) -> dict[str, dict]:
    scenarios: dict[str, dict] = {}
    for path in sorted(fixtures_dir.glob("*.json")):
        scenarios[path.stem] = json.loads(path.read_text(encoding="utf-8"))
    return scenarios


class DemoStore:
    """In-memory, thread-safe store for demo cases. Not durable -- this is
    a demo simulator, not the real case ledger (see webhook.CaseStore for
    that)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cases: dict[str, dict] = {}

    def create(self, record: dict) -> None:
        with self._lock:
            self._cases[record["id"]] = record

    def update(self, case_id: str, **fields: object) -> None:
        with self._lock:
            if case_id in self._cases:
                self._cases[case_id].update(fields)

    def get(self, case_id: str) -> dict | None:
        with self._lock:
            record = self._cases.get(case_id)
            return dict(record) if record is not None else None

    def list_all(self) -> list[dict]:
        with self._lock:
            records = list(self._cases.values())
        return sorted((dict(r) for r in records), key=lambda r: r["submitted_at"], reverse=True)


def _resolve_after_delay(
    store: DemoStore, case_id: str, scenario_record: dict, display_case: dict, delay_seconds: float
) -> None:
    time.sleep(delay_seconds)
    resolution = resolve.classify(
        scenario_record["call"], scenario_record.get("attempts", []), scenario_record.get("events", [])
    )
    disposition = decide_mod.decide(resolution, scenario_record.get("signals", {}))
    # The decision itself always runs against the scenario fixture's
    # recorded call/attempts/events/signals -- that's the actual thing being
    # demonstrated. But the audit report is customer-facing, so its case
    # fields (name/amount/recipient/method) are swapped for what was
    # actually typed into the demo form, not the fixture author's
    # placeholder names -- otherwise the drill-down view visibly
    # contradicts what the "customer" just submitted.
    display_record = dict(scenario_record, case=display_case)
    audit_report = build_audit_report(display_record)
    store.update(
        case_id,
        status="resolved",
        outcome=resolution.outcome,
        disposition=disposition.disposition,
        disposition_reasons=disposition.reasons,
        advisory=True,
        requires_human_review=True,
        audit=audit_report,
    )


def handle_list_scenarios(scenarios: Mapping[str, dict]) -> tuple[int, dict]:
    items = [
        {"key": key, "category": record.get("category"), "label": _pretty_label(key)}
        for key, record in scenarios.items()
    ]
    return 200, {"scenarios": items}


def handle_submit(
    store: DemoStore,
    scenarios: Mapping[str, dict],
    data: dict,
    *,
    delay_seconds: float = SIMULATED_CALL_SECONDS,
) -> tuple[int, dict]:
    """The bank's own logic: decides, automatically, whether this
    transaction requires a verification call at all, and if so runs one
    simulated verification. The customer never chooses either."""
    account_holder_name = (data.get("account_holder_name") or "Demo Customer").strip()[:80]
    claimed_transaction_amount = (data.get("claimed_transaction_amount") or "0.00").strip()[:20]
    claimed_recipient = (data.get("claimed_recipient") or "Unknown recipient").strip()[:80]
    claimed_payment_method = (data.get("claimed_payment_method") or "wire").strip()[:40]

    try:
        amount = float(claimed_transaction_amount)
    except (TypeError, ValueError):
        amount = None  # unparseable -- fail closed, treat as requiring verification

    requires_verification = amount is None or amount >= AUTO_APPROVE_BELOW_AMOUNT

    if not requires_verification:
        case_id = f"demo_{uuid.uuid4().hex[:8]}"
        record = {
            "id": case_id,
            "account_holder_name": account_holder_name,
            "claimed_transaction_amount": claimed_transaction_amount,
            "claimed_recipient": claimed_recipient,
            "claimed_payment_method": claimed_payment_method,
            "scenario_key": None,
            "scenario_label": "No verification required (below threshold)",
            "category": "no_verification_required",
            "status": "resolved",
            "submitted_at": time.time(),
            "dialed_phone_masked": None,
            "outcome": "no_verification_required",
            "disposition": NO_VERIFICATION_REQUIRED,
            "disposition_reasons": [f"amount below ${AUTO_APPROVE_BELOW_AMOUNT:,.2f} verification threshold"],
            # No call was placed, so there is no call interpretation to
            # review -- this is the institution's own deterministic
            # threshold policy, not a recommendation from this tool.
            "advisory": True,
            "requires_human_review": False,
            "audit": None,
        }
        store.create(record)
        return 201, redact_value(record)

    scenario_key = random.choice(sorted(scenarios))
    return _handle_submit_simulated(
        store,
        scenarios,
        {
            "account_holder_name": account_holder_name,
            "claimed_transaction_amount": claimed_transaction_amount,
            "claimed_recipient": claimed_recipient,
            "claimed_payment_method": claimed_payment_method,
            "scenario_key": scenario_key,
        },
        delay_seconds=delay_seconds,
    )


def _handle_submit_simulated(
    store: DemoStore,
    scenarios: Mapping[str, dict],
    data: dict,
    *,
    delay_seconds: float,
) -> tuple[int, dict]:
    scenario_key = data.get("scenario_key")
    scenario_record = scenarios.get(scenario_key)
    if not scenario_key or scenario_record is None:
        return 400, {"error": "unknown_scenario", "known_scenarios": sorted(scenarios)}

    case_id = f"demo_{uuid.uuid4().hex[:8]}"
    account_holder_name = (data.get("account_holder_name") or "Demo Customer").strip()[:80]
    claimed_transaction_amount = (data.get("claimed_transaction_amount") or "0.00").strip()[:20]
    claimed_recipient = (data.get("claimed_recipient") or "Unknown recipient").strip()[:80]
    claimed_payment_method = (data.get("claimed_payment_method") or "wire").strip()[:40]

    record = {
        "id": case_id,
        "account_holder_name": account_holder_name,
        "claimed_transaction_amount": claimed_transaction_amount,
        "claimed_recipient": claimed_recipient,
        "claimed_payment_method": claimed_payment_method,
        "scenario_key": scenario_key,
        "scenario_label": _pretty_label(scenario_key),
        "category": scenario_record.get("category"),
        "status": "pending_verification_call",
        "submitted_at": time.time(),
        "dialed_phone_masked": None,
        "outcome": None,
        "disposition": None,
        "disposition_reasons": [],
        "advisory": True,
        "requires_human_review": True,
        "audit": None,
    }
    store.create(record)

    # A fictional demo phone, never a real number -- this server has no
    # field that collects one and no code that could dial one.
    display_case = {
        "case_id": case_id,
        "account_holder_name": account_holder_name,
        "on_file_phone": SIMULATED_DEMO_PHONE,
        "claimed_transaction_amount": claimed_transaction_amount,
        "claimed_recipient": claimed_recipient,
        "claimed_payment_method": claimed_payment_method,
    }
    threading.Thread(
        target=_resolve_after_delay,
        args=(store, case_id, scenario_record, display_case, delay_seconds),
        daemon=True,
    ).start()
    return 201, redact_value(record)


def handle_list(store: DemoStore) -> tuple[int, dict]:
    return 200, {"cases": [redact_value(c) for c in store.list_all()]}


def handle_get(store: DemoStore, case_id: str) -> tuple[int, dict]:
    record = store.get(case_id)
    if record is None:
        return 404, {"error": "not_found"}
    return 200, redact_value(record)


class DemoHandler(BaseHTTPRequestHandler):
    store: DemoStore
    scenarios: dict[str, dict]
    delay_seconds: float
    demo_token: str | None

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _send_json(self, status: int, payload: Mapping[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, path: Path, *, set_token_cookie: str | None = None) -> None:
        if not path.exists():
            self._send_json(404, {"error": "not_found"})
            return
        body = path.read_text(encoding="utf-8").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if set_token_cookie:
            # So the page's own same-origin fetches carry the token
            # without it living in every link. HttpOnly: the pages never
            # need to read it from JS.
            self.send_header(
                "Set-Cookie",
                f"{DEMO_TOKEN_COOKIE}={set_token_cookie}; Path=/; HttpOnly; SameSite=Strict",
            )
        self.end_headers()
        self.wfile.write(body)

    def _supplied_token(self, query: str) -> tuple[str | None, bool]:
        """Returns (token, came_from_query)."""
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            return auth[len("Bearer "):].strip() or None, False
        cookie_header = self.headers.get("Cookie") or ""
        for part in cookie_header.split(";"):
            name, _, value = part.strip().partition("=")
            if name == DEMO_TOKEN_COOKIE and value:
                return value, False
        from_query = urllib.parse.parse_qs(query).get("token")
        if from_query and from_query[0]:
            return from_query[0], True
        return None, False

    def _authorize(self, query: str) -> tuple[bool, str | None]:
        """Returns (authorized, token_to_set_as_cookie)."""
        supplied, from_query = self._supplied_token(query)
        if not token_is_valid(self.demo_token, supplied):
            self._send_json(401, {"error": "unauthorized", "detail": f"A valid {DEMO_TOKEN_ENV} is required."})
            return False, None
        return True, (supplied if from_query else None)

    def do_GET(self) -> None:  # noqa: N802
        split = urllib.parse.urlsplit(self.path)
        route, query = split.path, split.query
        if route == "/healthz":
            # Unauthenticated on purpose, and the only such route: a PaaS
            # health check runs without credentials. It reveals nothing
            # beyond "the process is up".
            self._send_json(200, {"status": "ok"})
            return
        authorized, cookie_token = self._authorize(query)
        if not authorized:
            return
        if route == "/":
            self._send_html(DEMO_DIR / "customer.html", set_token_cookie=cookie_token)
        elif route == "/bank":
            self._send_html(DEMO_DIR / "bank.html", set_token_cookie=cookie_token)
        elif route == "/api/demo/scenarios":
            status, payload = handle_list_scenarios(self.scenarios)
            self._send_json(status, payload)
        elif route == "/api/demo/cases":
            status, payload = handle_list(self.store)
            self._send_json(status, payload)
        elif route.startswith("/api/demo/cases/"):
            case_id = route[len("/api/demo/cases/"):]
            status, payload = handle_get(self.store, case_id)
            self._send_json(status, payload)
        else:
            self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        split = urllib.parse.urlsplit(self.path)
        authorized, _ = self._authorize(split.query)
        if not authorized:
            return
        if split.path != "/api/demo/cases":
            self._send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"error": "invalid_content_length"})
            return
        if length <= 0 or length > 65_536:
            self._send_json(400, {"error": "invalid_content_length"})
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            self._send_json(400, {"error": "invalid_json"})
            return
        if not isinstance(data, dict):
            self._send_json(400, {"error": "invalid_request"})
            return
        status, payload = handle_submit(
            self.store, self.scenarios, data, delay_seconds=self.delay_seconds
        )
        self._send_json(status, payload)


def create_server(
    host: str = "127.0.0.1",
    port: int = 8090,
    *,
    delay_seconds: float = SIMULATED_CALL_SECONDS,
    demo_token: str | None = None,
    store: DemoStore | None = None,
    scenarios: dict[str, dict] | None = None,
) -> ThreadingHTTPServer:
    handler = type(
        "ConfiguredDemoHandler",
        (DemoHandler,),
        {
            "store": store if store is not None else DemoStore(),
            "scenarios": scenarios if scenarios is not None else load_scenarios(),
            "delay_seconds": delay_seconds,
            "demo_token": demo_token,
        },
    )
    return ThreadingHTTPServer((host, port), handler)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8090)))
    parser.add_argument("--delay-seconds", type=float, default=SIMULATED_CALL_SECONDS)
    args = parser.parse_args(argv)

    demo_token = os.environ.get(DEMO_TOKEN_ENV) or None

    # A bind reachable from outside this machine must be authenticated.
    # Refusing to start is the point: an unauthenticated public URL should
    # never be reachable by forgetting an environment variable.
    if not is_loopback_host(args.host) and not demo_token:
        print(
            f"refusing to start: --host {args.host} is reachable from outside this machine, "
            f"so {DEMO_TOKEN_ENV} must be set to a secret value.\n"
            f"  set it, then open the demo with ?token=<that value> once per browser."
        )
        return 2

    server = create_server(
        host=args.host, port=args.port, delay_seconds=args.delay_seconds, demo_token=demo_token
    )
    print("RingFence demo -- SIMULATION ONLY: this server has no live-call path and collects no phone number")
    print(
        "  every recommendation shown is advisory and marked as requiring human review"
    )
    if demo_token:
        print(f"  authentication: ON ({DEMO_TOKEN_ENV} set) -- open with ?token=<value> once per browser")
    else:
        print(f"  authentication: off (loopback only; set {DEMO_TOKEN_ENV} to require a token)")
    print(f"  customer side: http://{args.host}:{args.port}/")
    print(f"  bank side:     http://{args.host}:{args.port}/bank")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
