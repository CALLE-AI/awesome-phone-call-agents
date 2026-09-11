from __future__ import annotations

import json
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from typing import Any

from .core import SourcingRequest, build_plan, rank_results


STATIC_PACKAGE = "partline.web_static"
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _load_json(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _attach_supplier_names(result: dict[str, Any], request: SourcingRequest) -> None:
    for index, recipient in enumerate(result.get("recipients", [])):
        if index < len(request.suppliers):
            recipient.setdefault("name", request.suppliers[index].name)


@dataclass(frozen=True)
class WebSnapshot:
    request: SourcingRequest
    plan: dict[str, Any]
    result: dict[str, Any]

    @classmethod
    def load(cls, request_path: str | Path, result_path: str | Path) -> "WebSnapshot":
        request = SourcingRequest.load(str(request_path))
        result = _load_json(result_path)
        _attach_supplier_names(result, request)
        return cls(request=request, plan=build_plan(request), result=result)

    def as_dict(self) -> dict[str, Any]:
        return {
            "request": {
                "request_id": self.request.request_id,
                "requester": self.request.requester,
                "facility": self.request.facility,
                "part_number": self.request.part_number,
                "manufacturer": self.request.manufacturer,
                "description": self.request.description,
                "quantity": self.request.quantity,
                "required_specs": list(self.request.required_specs),
                "need_by": self.request.need_by,
                "acceptable_alternatives": self.request.acceptable_alternatives,
            },
            "plan": self.plan,
            "evidence": {
                "call_id": self.result.get("id") or self.result.get("call_id"),
                "status": self.result.get("status", "unknown"),
                "candidates": rank_results(self.result, self.request),
            },
        }


class PartLineRequestHandler(BaseHTTPRequestHandler):
    server_version = "PartLine/0.2"
    snapshot: WebSnapshot

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _security_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")

    def _send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self._send_bytes(body, "application/json; charset=utf-8", status)

    def _static(self, name: str, content_type: str) -> None:
        try:
            body = resources.files(STATIC_PACKAGE).joinpath(name).read_bytes()
        except (FileNotFoundError, ModuleNotFoundError):
            self._send_json({"error": "PartLine web assets are unavailable."}, HTTPStatus.NOT_FOUND)
            return
        self._send_bytes(body, content_type)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._static("index.html", "text/html; charset=utf-8")
        elif path == "/assets/styles.css":
            self._static("styles.css", "text/css; charset=utf-8")
        elif path == "/assets/app.js":
            self._static("app.js", "text/javascript; charset=utf-8")
        elif path == "/api/bootstrap":
            self._send_json(self.snapshot.as_dict())
        elif path == "/healthz":
            self._send_json({"status": "ok", "service": "partline"})
        else:
            self._send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)


def _handler(snapshot: WebSnapshot) -> type[PartLineRequestHandler]:
    class BoundPartLineHandler(PartLineRequestHandler):
        pass

    BoundPartLineHandler.snapshot = snapshot
    return BoundPartLineHandler


def serve_web(
    request_path: str | Path,
    result_path: str | Path,
    host: str = "127.0.0.1",
    port: int = 8787,
) -> None:
    if host not in ALLOWED_HOSTS:
        raise ValueError("PartLine web binds to localhost only.")
    snapshot = WebSnapshot.load(request_path, result_path)
    server = ThreadingHTTPServer((host, port), _handler(snapshot))
    display_host = "127.0.0.1" if host in {"localhost", "::1"} else host
    print(f"PartLine evidence console: http://{display_host}:{server.server_port}")
    print("No call can be placed from the browser. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPartLine evidence console stopped.")
    finally:
        server.server_close()
