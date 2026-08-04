import argparse
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from client import DEFAULT_BASE_URL, execute, parse_request, preview


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = ROOT / "static"
MAX_BODY_BYTES = 32_000
ALLOWED_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}


def preview_payload(payload: Any) -> dict[str, Any]:
    return preview(parse_request(payload))


def execute_payload(payload: Any, client: Any, *, timeout_seconds: int = 600) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    confirmations = payload.get("confirmations")
    if not isinstance(confirmations, dict) or not all(
        confirmations.get(key) is True
        for key in ("authority", "public_number", "live_call")
    ):
        raise ValueError("live mode requires all three explicit confirmations")
    return execute(
        parse_request(payload.get("request")), client, timeout_seconds=timeout_seconds
    )


class PermitStatusHandler(BaseHTTPRequestHandler):
    server_version = "PermitStatusClarifier/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Avoid logging request bodies, phone numbers, or permit references.
        return

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("request body must contain 1-32000 bytes")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "live_ready": bool(os.environ.get("CALLE_API_KEY"))})
            return
        asset = ALLOWED_FILES.get(path)
        if not asset:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        file_name, content_type = asset
        body = (STATIC_ROOT / file_name).read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            if path == "/api/preview":
                self.send_json(HTTPStatus.OK, preview_payload(payload))
                return
            if path == "/api/call":
                api_key = os.environ.get("CALLE_API_KEY")
                if not api_key:
                    raise ValueError("CALLE_API_KEY is required for a live call")
                from calle import CalleClient

                result = execute_payload(
                    payload,
                    CalleClient(
                        api_key=api_key,
                        base_url=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL),
                    ),
                )
                self.send_json(HTTPStatus.OK, result)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except (json.JSONDecodeError, OSError, RuntimeError, ValueError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Permit Status Clarifier demo.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.port <= 0 or args.port > 65535:
        raise SystemExit("port must be between 1 and 65535")
    server = ThreadingHTTPServer((args.host, args.port), PermitStatusHandler)
    print(f"Permit Status Clarifier listening on http://{args.host}:{args.port}")
    if not os.environ.get("CALLE_API_KEY"):
        print("Preview mode only: CALLE_API_KEY is not set")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
