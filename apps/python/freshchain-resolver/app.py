"""FreshChain Resolver web MVP using only the Python standard library."""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import client as resolver
from store import Store


logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("freshchain")
APP_DIR = Path(__file__).parent
DATABASE_PATH = Path(
    os.environ.get("FRESHCHAIN_DB_PATH", APP_DIR / "data" / "freshchain.sqlite3")
)
CASE_ACTION = re.compile(r"^/api/cases/(\d+)/(simulate|execute)$")
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def live_calls_enabled() -> bool:
    return os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").lower() == "true"


def validate_server_security(host: str) -> None:
    if not live_calls_enabled():
        return
    if host not in LOOPBACK_HOSTS:
        raise ValueError(
            "Live mode requires FRESHCHAIN_HOST to be an exact loopback host"
        )
    token = os.environ.get("FRESHCHAIN_LIVE_TOKEN", "")
    if len(token) < 32 or any(character.isspace() for character in token):
        raise ValueError(
            "Live mode requires a whitespace-free FRESHCHAIN_LIVE_TOKEN "
            "containing at least 32 characters"
        )


def body_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > 64_000:
        raise ValueError("request body must contain 1-64000 bytes")
    value = json.loads(handler.rfile.read(length))
    if not isinstance(value, dict):
        raise ValueError("request body must be a JSON object")
    return value


class FreshChainHandler(BaseHTTPRequestHandler):
    store: Store

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("http %s", format % args)

    def send_json(self, status: int, payload: Any) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorize_mutation(self) -> bool:
        if not live_calls_enabled():
            return True
        token = os.environ.get("FRESHCHAIN_LIVE_TOKEN", "")
        supplied = self.headers.get("Authorization", "")
        if token and secrets.compare_digest(supplied, f"Bearer {token}"):
            return True
        data = json.dumps({"detail": "Bearer authentication required"}).encode()
        self.send_response(401)
        self.send_header("WWW-Authenticate", "Bearer")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return False

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            data = (APP_DIR / "static" / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif path == "/health":
            self.send_json(200, {"status": "ok"})
        elif path == "/api/cases":
            self.send_json(
                200,
                {
                    "cases": self.store.list_cases(),
                    "attempts": self.store.list_attempts(),
                },
            )
        else:
            self.send_json(404, {"detail": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if not self.authorize_mutation():
                return
            if path == "/api/cases":
                self.create_case(body_json(self))
                return
            match = CASE_ACTION.fullmatch(path)
            if not match:
                self.send_json(404, {"detail": "not found"})
                return
            case_id, action = int(match.group(1)), match.group(2)
            if action == "simulate":
                self.simulate(case_id, body_json(self))
            else:
                self.execute_live(case_id)
        except KeyError:
            self.send_json(404, {"detail": "case not found"})
        except (json.JSONDecodeError, ValueError) as exc:
            self.send_json(422, {"detail": str(exc)})
        except Exception:
            logger.exception("request_failed path=%s", path)
            self.send_json(500, {"detail": "internal server error"})

    def create_case(self, raw: dict[str, Any]) -> None:
        try:
            request = resolver.parse_request(raw)
            case = self.store.create_case(asdict(request))
        except Exception as exc:
            if "UNIQUE constraint failed" in str(exc):
                self.send_json(409, {"detail": "workflow_id already exists"})
                return
            raise
        logger.info("case_created workflow_id=%s", request.workflow_id)
        self.send_json(201, case)

    def simulate(self, case_id: int, raw: dict[str, Any]) -> None:
        scenario = raw.get("scenario")
        if scenario not in {"accept", "rebook", "no-consent"}:
            raise ValueError("scenario must be accept, rebook, or no-consent")
        case = self.store.get_case_private(case_id)
        request = resolver.parse_request(case["request"])
        result = resolver.simulated_result(request, scenario)
        attempt = self.store.record_simulation_attempt(case_id, result)
        logger.info(
            "simulation_completed case_id=%s decision=%s",
            case_id,
            result["decision"]["route"],
        )
        self.send_json(200, attempt)

    def execute_live(self, case_id: int) -> None:
        if not live_calls_enabled():
            self.send_json(
                503,
                {"detail": "Set CALLE_LIVE_CALLS_ENABLED=true to unlock live calls."},
            )
            return
        if (
            self.headers.get("X-Confirm-Live-Call")
            != "I understand this places a real phone call"
        ):
            self.send_json(
                400,
                {"detail": "Missing exact X-Confirm-Live-Call confirmation."},
            )
            return
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            self.send_json(503, {"detail": "CALLE_API_KEY is not configured."})
            return
        case = self.store.get_case_private(case_id)
        request = resolver.parse_request(case["request"])
        from calle import CalleClient

        base_url = resolver.validate_base_url(
            os.environ.get("CALLE_BASE_URL", resolver.DEFAULT_BASE_URL)
        )
        timeout = int(os.environ.get("CALLE_TIMEOUT_SECONDS", "600"))
        if timeout <= 0:
            raise ValueError("CALLE_TIMEOUT_SECONDS must be positive")
        if not self.store.claim_live_execution(case_id):
            self.send_json(
                409,
                {"detail": "A live execution is already in progress for this case."},
            )
            return
        logger.info(
            "calle_sdk_create_start case_id=%s workflow_id=%s base_url=%s",
            case_id,
            request.workflow_id,
            base_url,
        )
        attempt_id: int | None = None
        accepted_call_id: str | None = None

        def persist_accepted(call_id: str) -> None:
            nonlocal attempt_id, accepted_call_id
            accepted_call_id = call_id
            attempt_id = self.store.record_call_accepted(case_id, call_id)
            logger.info(
                "calle_sdk_call_accepted case_id=%s call_id=%s",
                case_id,
                call_id,
            )

        try:
            sdk = CalleClient(api_key=api_key, base_url=base_url)
            result = resolver.execute(
                request, sdk.calls, timeout, on_created=persist_accepted
            )
        except Exception as exc:
            logger.exception(
                "calle_sdk_outcome_unknown case_id=%s call_id=%s",
                case_id,
                accepted_call_id,
            )
            self.store.record_live_ambiguity(
                case_id,
                attempt_id,
                accepted_call_id,
                type(exc).__name__,
            )
            self.send_json(
                502,
                {
                    "detail": (
                        "CALL-E outcome is unknown. Review the audit record "
                        "before retrying."
                    )
                },
            )
            return
        logger.info(
            "calle_sdk_terminal case_id=%s call_id=%s status=%s decision=%s",
            case_id,
            result["call_id"],
            result["status"],
            result["decision"]["route"],
        )
        if attempt_id is None:
            raise RuntimeError("CALL-E result arrived without an accepted call audit")
        self.send_json(
            200, self.store.complete_live_attempt(case_id, attempt_id, result)
        )


def create_server(
    host: str = "127.0.0.1", port: int = 8080, database_path: Path | None = None
) -> ThreadingHTTPServer:
    validate_server_security(host)
    database = database_path or DATABASE_PATH
    handler = type(
        "ConfiguredFreshChainHandler",
        (FreshChainHandler,),
        {"store": Store(database)},
    )
    return ThreadingHTTPServer((host, port), handler)


def main() -> None:
    host = os.environ.get("FRESHCHAIN_HOST", "127.0.0.1")
    port = int(os.environ.get("FRESHCHAIN_PORT", "8080"))
    server = create_server(host, port)
    logger.info("dashboard_ready url=http://%s:%s", host, server.server_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("dashboard_stopped")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
