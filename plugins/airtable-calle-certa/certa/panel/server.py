"""The operator's control panel.

Two PRs in this repository were blocked because a deployable surface could
start live calls without an authorization boundary and with caller-controlled
destinations. So this server is built the other way round:

  * It binds to loopback only, and refuses to start otherwise.
  * Every request needs a token printed to the console at startup.
  * **The run endpoint accepts no destination.** It takes a view name. The
    numbers come from consented rows the server reads itself, so there is no
    request shape that can introduce a phone number.

The last point is a security property expressed as an absence: you cannot ask
this server to call someone. You can only ask it to run a view that a person
already consented to.

The panel also starts *useful with no configuration at all*. With no
credentials it runs on bundled fixtures, so the first thing anyone sees is the
product working. Credentials are entered in the panel and the clients are
rebuilt in place -- an operator on a verification desk never has to export an
environment variable.
"""

from __future__ import annotations

import json
import secrets
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .. import config as cfg
from ..airtable import (
    AirtableError,
    FieldMap,
    FixtureAirtable,
    LiveAirtable,
    create_base,
    to_row,
)
from ..grant import GrantError, grant_consent, revoke_consent
from ..audit import AuditLog
from ..checkup import check_table
from ..types import redact
from ..runner import RunError, execute, plan
from ..mcp import McpTransport
from ..transport import FixtureTransport, LiveTransport, TransportError

LOOPBACK = {"127.0.0.1", "::1", "localhost"}

# Recorded against every consent, so a change of wording is visible in the
# audit chain and invalidates tokens gathered under the previous text.
DISCLOSURE_VERSION = "voe-disclosure-2026-01"
PANEL_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = PANEL_DIR.parent.parent
CONSOLE = PANEL_DIR / "index.html"
LANDING = PLUGIN_DIR / "site" / "index.html"
FIXTURES = PLUGIN_DIR / "examples" / "fixtures"

# Modes, in order of how much they can do to the world.
FIXTURES_MODE = "fixtures"
PREVIEW_MODE = "preview"
LIVE_MODE = "live"

# REST is the primary transport and the only one that returns typed answers.
# If its host does not resolve on this network, fall through to MCP rather
# than presenting a Run button that always fails, and say which is in use.
REST_HOST = "api.heycall-e.com"


def _rest_reachable(host: str = REST_HOST) -> bool:
    import socket

    try:
        socket.getaddrinfo(host, 443)
        return True
    except OSError:
        return False


class PanelError(Exception):
    """The panel cannot be started or reconfigured safely."""


@dataclass
class RunState:
    """What a run is doing right now, for the live view."""

    running: bool = False
    view: str = ""
    finished: bool = False
    error: str = ""
    rows: dict[str, dict[str, Any]] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    elapsed: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "running": self.running,
                "finished": self.finished,
                "view": self.view,
                "error": self.error,
                "rows": list(self.rows.values()),
                "counts": dict(self.counts),
                "elapsed": round(self.elapsed, 1),
            }


def _plan_json(current) -> dict[str, Any]:
    return {
        "view": current.scope.view,
        "in_view": current.scope.in_view,
        "in_table": current.scope.in_table,
        "hidden": current.scope.hidden,
        "call_count": current.call_count,
        "estimated_cost_usd": current.estimated_cost_usd,
        "planned": [
            {
                "request_id": item.contact.request_id,
                "employer": item.contact.employer_name,
                "masked_number": item.contact.masked_number(),
                "source": item.contact.number.source.value,
                "task": item.task,
            }
            for item in current.planned
        ],
        "skipped": [
            {
                "request_id": item.row.request.request_id or item.row.record_id,
                "record_id": item.row.record_id,
                "employer": item.row.request.employer_name,
                "reason": item.reason,
                # Only a row whose sole gap is consent can be granted from here.
                "grantable": (
                    item.row.request.sourced is not None
                    and not item.row.request.cancelled
                    and bool(item.row.request.applicant_name.strip())
                    and bool(item.row.request.employer_name.strip())
                    and not item.row.presented_token
                ),
            }
            for item in current.skipped
        ],
    }


def _fixture_clients():
    base = json.loads((FIXTURES / "base.json").read_text(encoding="utf-8"))
    scenario = json.loads((FIXTURES / "happy-path.json").read_text(encoding="utf-8"))
    return (
        FixtureAirtable(base["schema"], base["records"], view_records=base.get("view_records")),
        FixtureTransport(scenario),
    )


class Panel:
    """Holds the clients, the config, and the current run state."""

    def __init__(
        self,
        audit: AuditLog,
        *,
        table: str,
        default_view: str,
        max_calls: int,
        token: str,
        env_path: Path | str = cfg.DEFAULT_ENV_PATH,
        force_fixtures: bool = False,
    ) -> None:
        self.audit = audit
        self.table = table
        self.default_view = default_view
        self.max_calls = max_calls
        self.token = token
        self.env_path = Path(env_path)
        self.force_fixtures = force_fixtures
        self.state = RunState()
        self.reconfigure()

    # -- configuration -------------------------------------------------

    def reconfigure(self) -> None:
        """(Re)build clients from the current config. Never raises upward."""
        self.config = cfg.load(self.env_path)
        self.transport_name = ""
        if self.force_fixtures or not self.config.can_read_table:
            self.client, self.transport = _fixture_clients()
            self.mode = FIXTURES_MODE
            self.transport_name = "fixtures"
            return
        try:
            self.client = LiveAirtable(
                self.config.airtable_token, self.config.airtable_base_id
            )
            self.transport = None
            self.transport_name = ""
            if self.config.can_place_calls:
                if _rest_reachable():
                    self.transport = LiveTransport(self.config.calle_api_key)
                    self.transport_name = "rest"
                else:
                    # The REST host is unresolvable, so use MCP. It places real
                    # calls but cannot return typed answers, which the
                    # interpreter already handles by routing to human review.
                    try:
                        self.transport = McpTransport()
                        self.transport_name = "mcp"
                    except TransportError:
                        self.transport = None
        except (AirtableError, TransportError) as exc:
            self.client, self.transport = _fixture_clients()
            self.mode = FIXTURES_MODE
            self.transport_name = "fixtures"
            raise PanelError(str(exc)) from exc
        self.mode = LIVE_MODE if self.transport else PREVIEW_MODE

    def apply_setup(self, values: dict[str, Any]) -> dict[str, Any]:
        """Save credentials and rebuild. Returns the redacted config only."""
        current = self.config
        merged = cfg.Config(
            airtable_token=str(values.get("airtable_token") or current.airtable_token).strip(),
            airtable_base_id=str(values.get("airtable_base_id") or current.airtable_base_id).strip(),
            calle_api_key=str(values.get("calle_api_key") or current.calle_api_key).strip(),
            requester_name=str(values.get("requester_name") or current.requester_name).strip(),
        )
        if not any(
            (merged.airtable_token, merged.airtable_base_id,
             merged.calle_api_key, merged.requester_name)
        ):
            raise PanelError("nothing to save")
        # A token with no base is a legitimate half-configured state: the base
        # is created from that token, so requiring both here would deadlock.
        try:
            cfg.save(merged, self.env_path)
        except cfg.ConfigError as exc:
            raise PanelError(str(exc)) from exc
        self.reconfigure()
        return self.config_json()

    def config_json(self) -> dict[str, Any]:
        payload = self.config.redacted()
        payload.update(
            {
                "mode": self.mode,
                "view": self.default_view,
                "table": self.table,
                "forced_fixtures": self.force_fixtures,
                "permission_warning": cfg.permission_warning(self.env_path),
                "transport": getattr(self, "transport_name", ""),
                "typed_results": getattr(self, "transport_name", "") != "mcp",
            }
        )
        return payload

    # -- work ----------------------------------------------------------

    def plan(self, view: str) -> dict[str, Any]:
        return _plan_json(
            plan(
                self.client,
                table=self.table,
                view=view,
                requester_name=self.config.requester_name or "Example Lending",
            )
        )

    def start_run(self, view: str) -> dict[str, Any]:
        if self.transport is None:
            raise PanelError(
                "this panel is preview-only: add a CALL-E API key in Setup "
                "before it can place calls"
            )
        with self.state.lock:
            if self.state.running:
                raise PanelError("a run is already in flight")
            self.state = RunState(running=True, view=view)
        state = self.state
        simulated = self.mode == FIXTURES_MODE

        def work() -> None:
            try:
                report = execute(
                    self.client,
                    self.transport,
                    self.audit,
                    table=self.table,
                    view=view,
                    requester_name=self.config.requester_name or "Example Lending",
                    max_calls=self.max_calls,
                    **(
                        {"first_delay": 0, "interval": 0, "sleep": lambda _: None}
                        if simulated
                        else {}
                    ),
                )
                with state.lock:
                    for outcome in report.outcomes:
                        state.rows[outcome.request_id] = {
                            "request_id": outcome.request_id,
                            "disposition": outcome.interpretation.disposition.value,
                            "reason": outcome.interpretation.reason,
                            "confidence": outcome.interpretation.confidence,
                            "evidence": list(outcome.interpretation.evidence),
                        }
                    for item in report.plan.skipped:
                        rid = item.row.request.request_id or item.row.record_id
                        state.rows[rid] = {
                            "request_id": rid,
                            "disposition": "skipped",
                            "reason": item.reason,
                            "confidence": None,
                            "evidence": [],
                        }
                    state.counts = report.by_disposition()
                    state.elapsed = report.elapsed_seconds
            except (RunError, Exception) as exc:  # noqa: BLE001 - surfaced to the operator
                with state.lock:
                    # May carry a provider failure body.
                    state.error = redact(str(exc))
            finally:
                with state.lock:
                    state.running = False
                    state.finished = True

        threading.Thread(target=work, daemon=True).start()
        return {"started": True, "view": view}

    def create_base(self, workspace_id: str) -> dict[str, Any]:
        """Build the Airtable base from the saved token, and record its id."""
        if not self.config.airtable_token:
            raise PanelError("save an Airtable token first")
        try:
            created = create_base(self.config.airtable_token, str(workspace_id).strip())
        except AirtableError as exc:
            raise PanelError(str(exc)) from exc
        base_id = str(created.get("id") or "")
        if not base_id:
            raise PanelError("Airtable created the base but returned no id")
        cfg.save(
            cfg.Config(
                airtable_token=self.config.airtable_token,
                airtable_base_id=base_id,
                calle_api_key=self.config.calle_api_key,
                requester_name=self.config.requester_name,
            ),
            self.env_path,
        )
        self.reconfigure()
        return dict(self.config_json(), created_base_id=base_id)

    def views(self) -> list[dict[str, str]]:
        try:
            return self.client.views(self.table)
        except Exception:  # noqa: BLE001 - a missing view list must not break the panel
            return []

    def _row(self, record_id: str):
        fields = FieldMap()
        for record in self.client.list_view(self.table, ""):
            if record.get("id") == record_id:
                return to_row(record, fields)
        raise PanelError(f"no row {record_id!r} in {self.table}")

    def grant(self, record_id: str) -> dict[str, Any]:
        """Record that the applicant consented to this employer being called."""
        try:
            g = grant_consent(
                self.client, self.audit, table=self.table,
                row=self._row(record_id), disclosure_version=DISCLOSURE_VERSION,
            )
        except (GrantError, AirtableError) as exc:
            raise PanelError(str(exc)) from exc
        return {"granted": g.request_id, "receipt_id": g.receipt_id}

    def revoke(self, record_id: str) -> dict[str, Any]:
        try:
            revoke_consent(self.client, self.audit, table=self.table,
                           row=self._row(record_id))
        except (GrantError, AirtableError) as exc:
            raise PanelError(str(exc)) from exc
        return {"revoked": record_id}

    def disconnect(self) -> dict[str, Any]:
        """Forget every stored credential and fall back to sample data."""
        cfg.clear(self.env_path)
        self.reconfigure()
        return self.config_json()

    def checkup(self) -> dict[str, Any]:
        """Whether the connected table can run, and what to change if not.

        Reads schema only. Places no calls and writes nothing, so it is safe
        to run before anything is configured.
        """
        if not self.client:
            return {"connected": False, "runnable": False, "findings": []}
        try:
            result = check_table(self.client.table_schema(self.table))
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator
            return {"connected": True, "runnable": False, "error": str(exc), "findings": []}
        return {
            "connected": True,
            "runnable": result.runnable,
            "table": self.table,
            "findings": [
                {"column": f.column, "state": f.state, "detail": f.detail, "fix": f.fix}
                for f in result.findings
            ],
        }

    def audit_status(self) -> dict[str, Any]:
        status = self.audit.verify_chain()
        return {
            "ok": status.ok,
            "records": status.records,
            "head": status.head[:16],
            "reason": status.reason,
            "broken_at": status.broken_at,
        }


def make_handler(panel: Panel):
    class Handler(BaseHTTPRequestHandler):
        server_version = "certa-panel"

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter console
            return

        def _send(self, code: int, payload: Any, content_type="application/json") -> None:
            body = (
                payload.encode("utf-8")
                if isinstance(payload, str)
                else json.dumps(payload).encode("utf-8")
            )
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self, query: dict[str, list[str]]) -> bool:
            presented = (
                self.headers.get("X-Certa-Token") or (query.get("token") or [""])[0]
            )
            return secrets.compare_digest(presented or "", panel.token)

        def do_GET(self) -> None:  # noqa: N802 - stdlib naming
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)

            # `/` is the landing page. It needs no token to read, because it
            # explains the product and contains nothing operable.
            #
            # The console link is injected ONLY when the request already
            # carried the token, so a request that does not have it is never
            # handed one. The startup line prints /?token=... , which is why
            # opening that link gives a working button while a bare GET /
            # does not.
            if parts.path == "/" and LANDING.exists():
                html = LANDING.read_text(encoding="utf-8")
                if self._authorized(query):
                    injected = (
                        "<script>window.__CERTA__="
                        + json.dumps({"console": f"/app?token={panel.token}"})
                        + ";</script></head>"
                    )
                    html = html.replace("</head>", injected, 1)
                return self._send(200, html, "text/html; charset=utf-8")
            if parts.path in ("/", "/app"):
                return self._send(
                    200, CONSOLE.read_text(encoding="utf-8"), "text/html; charset=utf-8"
                )
            if not self._authorized(query):
                return self._send(401, {"error": "token required"})
            view = (query.get("view") or [panel.default_view])[0]
            try:
                if parts.path == "/api/plan":
                    return self._send(200, panel.plan(view))
                if parts.path == "/api/status":
                    return self._send(200, panel.state.snapshot())
                if parts.path == "/api/checkup":
                    return self._send(200, panel.checkup())

                if parts.path == "/api/audit":
                    return self._send(200, panel.audit_status())
                if parts.path == "/api/config":
                    return self._send(200, dict(panel.config_json(), views=panel.views()))
            except Exception as exc:  # noqa: BLE001 - reported to the operator
                return self._send(400, {"error": str(exc)})
            return self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802 - stdlib naming
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)
            if not self._authorized(query):
                return self._send(401, {"error": "token required"})

            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, {"error": "body must be JSON"})
            if not isinstance(body, dict):
                return self._send(400, {"error": "body must be a JSON object"})

            if parts.path == "/api/setup":
                allowed = {
                    "airtable_token",
                    "airtable_base_id",
                    "calle_api_key",
                    "requester_name",
                }
                unexpected = set(body) - allowed
                if unexpected:
                    return self._send(
                        400, {"error": f"unknown fields: {sorted(unexpected)}"}
                    )
                try:
                    return self._send(200, panel.apply_setup(body))
                except PanelError as exc:
                    return self._send(400, {"error": str(exc)})

            if parts.path in ("/api/consent/grant", "/api/consent/revoke"):
                unexpected = set(body) - {"record_id"}
                if unexpected:
                    return self._send(400, {"error": f"unknown fields: {sorted(unexpected)}"})
                record_id = str(body.get("record_id") or "")
                if not record_id:
                    return self._send(400, {"error": "record_id is required"})
                try:
                    action = (
                        panel.grant if parts.path.endswith("grant") else panel.revoke
                    )
                    return self._send(200, action(record_id))
                except PanelError as exc:
                    return self._send(400, {"error": str(exc)})

            if parts.path == "/api/disconnect":
                if body:
                    return self._send(400, {"error": "this endpoint takes no fields"})
                return self._send(200, panel.disconnect())

            if parts.path == "/api/create-base":
                unexpected = set(body) - {"workspace_id"}
                if unexpected:
                    return self._send(400, {"error": f"unknown fields: {sorted(unexpected)}"})
                try:
                    return self._send(200, panel.create_base(body.get("workspace_id", "")))
                except PanelError as exc:
                    return self._send(400, {"error": str(exc)})

            if parts.path != "/api/run":
                return self._send(404, {"error": "not found"})

            # A destination cannot be introduced through this endpoint. Only a
            # view name is accepted; numbers come from consented rows.
            unexpected = set(body) - {"view", "confirm"}
            if unexpected:
                return self._send(
                    400,
                    {
                        "error": (
                            "this endpoint accepts only a view name and a "
                            f"confirmation; rejected: {sorted(unexpected)}"
                        )
                    },
                )
            if body.get("confirm") is not True:
                return self._send(400, {"error": "confirm must be true"})

            try:
                return self._send(
                    202, panel.start_run(str(body.get("view") or panel.default_view))
                )
            except PanelError as exc:
                return self._send(409, {"error": str(exc)})

    return Handler


def serve(
    panel: Panel | None = None,
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
    open_browser: bool = False,
    **panel_kwargs: Any,
) -> None:
    """Start the panel. Refuses any bind address that is not loopback."""
    if host not in LOOPBACK:
        raise PanelError(
            f"refusing to bind {host!r}. This panel can start real phone calls "
            "and is loopback-only by design; put it behind your own "
            "authenticated proxy if it must be reachable."
        )
    if panel is None:
        panel = Panel(**panel_kwargs)

    server = ThreadingHTTPServer((host, port), make_handler(panel))
    url = f"http://{host}:{port}/?token={panel.token}"
    console = f"http://{host}:{port}/app?token={panel.token}"
    mode_line = {
        FIXTURES_MODE: "sample data — places no calls",
        PREVIEW_MODE: "your table, preview only — no CALL-E key yet",
        LIVE_MODE: "LIVE — this can place real calls",
    }[panel.mode]
    # flush: the operator cannot reach the panel without this line, and stdout
    # is block-buffered whenever it is redirected or piped.
    print(f"\n  Certa is running.\n\n  {url}\n", flush=True)
    print(f"  console  {console}\n", flush=True)
    print(f"  mode: {mode_line}\n", flush=True)
    warning = cfg.permission_warning(panel.env_path)
    if warning:
        print(f"  warning: {warning}\n", flush=True)

    if open_browser:
        import webbrowser

        threading.Thread(target=lambda: webbrowser.open(url), daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("  stopped.", flush=True)
    finally:
        server.shutdown()
        server.server_close()
