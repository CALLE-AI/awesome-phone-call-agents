"""Loopback-only workbench and a credential-free static export.

The public export has authored example data only. Live calls require an explicit
server flag and a server-side key; browsers never receive provider credentials.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import calle
from .examples import STAGES, example
from .recipe import RecipeValidationError, scale_recipe, validate_recipe


APP_ROOT = Path(__file__).resolve().parent.parent
MAX_BODY_BYTES = 256 * 1024
STATIC_ASSETS = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8", "icon.svg": "image/svg+xml"}
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"


class RequestError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _asset_map(web_root: Path) -> dict[str, tuple[Path, str]]:
    root = web_root.resolve()
    result = {}
    for name, mime in STATIC_ASSETS.items():
        candidate = root / name
        if candidate.is_file() and not candidate.is_symlink() and candidate.resolve().parent == root:
            result["/" + name] = (candidate, mime)
    fonts = root / "fonts"
    if fonts.is_dir() and not fonts.is_symlink():
        for candidate in fonts.iterdir():
            if (re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:woff2?|ttf)", candidate.name) or candidate.name == "OFL.txt") and candidate.is_file() and not candidate.is_symlink():
                mime = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8"}[candidate.suffix]
                result["/fonts/" + candidate.name] = (candidate, mime)
    if "/index.html" in result:
        result["/"] = result["/index.html"]
    return result


def _servings(value: Any) -> int:
    if type(value) is not int or not 1 <= value <= 12:
        raise RequestError(400, "Servings must be an integer from 1 to 12.")
    return value


def example_report(stage: str = "corrected", servings: int = 6) -> dict:
    if not isinstance(stage, str) or stage not in STAGES:
        raise RequestError(400, "Choose unresolved, clarified or corrected.")
    _servings(servings)
    recipe = validate_recipe(example(stage))
    return {"recipe": recipe, "report": scale_recipe(recipe, servings), "stage": stage, "illustrative": True}


def _json_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("Nonfinite JSON constant")


class MeasureBackServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port: int = 8793, *, live: bool = False, web_root: Path | None = None, store_path: Path | None = None, api_key: str | None = None):
        if type(port) is not int or not 0 <= port <= 65535:
            raise ValueError("Port must be an integer between 0 and 65535.")
        if type(live) is not bool:
            raise ValueError("Live mode must be explicit.")
        key = (api_key if api_key is not None else os.environ.get("CALLE_API_KEY", "")) if live else ""
        if live and (not isinstance(key, str) or not key.strip() or len(key) > 4096 or any(ord(char) < 33 for char in key)):
            raise ValueError("Live mode requires a valid server-side CALLE_API_KEY.")
        self.live_enabled = live
        self._api_key = key
        self.store_path = Path(store_path) if store_path is not None else APP_ROOT / ".state" / "calls.sqlite3"
        self.assets = _asset_map(Path(web_root) if web_root is not None else APP_ROOT / "web")
        super().__init__(("127.0.0.1", port), MeasureBackHandler)


class MeasureBackHandler(BaseHTTPRequestHandler):
    server_version = "MeasureBack"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format, *args):
        # Request URLs and payloads can contain private recipe or contact data.
        pass

    def _reply(self, status: int, data: bytes, mime: str = "application/json; charset=utf-8", *, head: bool = False):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if not head:
            self.wfile.write(data)

    def _json(self, status: int, value: dict, *, head: bool = False):
        data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self._reply(status, data, head=head)

    def send_error(self, code, message=None, explain=None):
        # Never echo request lines, provider bodies or arbitrary exception text.
        self._json(code, {"error": "The request could not be processed."}, head=getattr(self, "command", "") == "HEAD")

    def _boundary(self, *, post: bool = False):
        hosts = self.headers.get_all("Host", [])
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if len(hosts) != 1 or hosts[0] not in allowed:
            raise RequestError(403, "This server accepts its loopback origin only.")
        if post:
            origins = self.headers.get_all("Origin", [])
            if len(origins) != 1 or origins[0] != "http://" + hosts[0]:
                raise RequestError(403, "A matching local browser origin is required.")
        parts = urlsplit(self.path)
        if parts.scheme or parts.netloc or parts.fragment or not self.path.startswith("/"):
            raise RequestError(400, "Use a local relative request path.")
        return parts

    def _read_json(self) -> dict:
        if self.headers.get_all("Transfer-Encoding"):
            raise RequestError(400, "Transfer encoding is not supported.")
        content_types = self.headers.get_all("Content-Type", [])
        if len(content_types) != 1 or content_types[0].split(";", 1)[0].strip().lower() != "application/json":
            raise RequestError(415, "Send application/json.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,9}", lengths[0]):
            raise RequestError(411, "A valid Content-Length is required.")
        length = int(lengths[0])
        if length > MAX_BODY_BYTES:
            raise RequestError(413, "Recipe imports are limited to 256 KiB.")
        if length == 0:
            raise RequestError(400, "A JSON object is required.")
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("Incomplete body")
            value = json.loads(raw.decode("utf-8"), object_pairs_hook=_json_object, parse_constant=_reject_constant)
        except (ValueError, UnicodeError, RecursionError, TimeoutError, OSError):
            raise RequestError(400, "The body must be a complete UTF-8 JSON object.") from None
        if not isinstance(value, dict):
            raise RequestError(400, "A JSON object is required.")
        return value

    @staticmethod
    def _fields(body: dict, fields: set[str]):
        if set(body) != fields:
            raise RequestError(400, "The request has missing or unsupported fields.")

    def _get(self, *, head: bool = False):
        try:
            parts = self._boundary()
            if parts.path in ("/api/config", "/config.json"):
                if parts.query:
                    raise RequestError(400, "This endpoint accepts no query parameters.")
                return self._json(200, {"local": True, "live_enabled": self.server.live_enabled}, head=head)
            if parts.path == "/api/example":
                try:
                    query = parse_qs(parts.query, keep_blank_values=True, strict_parsing=True, max_num_fields=2)
                    if set(query) - {"stage", "servings"} or any(len(values) != 1 for values in query.values()):
                        raise ValueError("Invalid fields")
                    raw_servings = query.get("servings", ["6"])[0]
                    if not re.fullmatch(r"[0-9]{1,2}", raw_servings):
                        raise ValueError("Invalid servings")
                    servings = int(raw_servings)
                except ValueError:
                    raise RequestError(400, "Invalid example parameters.") from None
                return self._json(200, example_report(query.get("stage", ["corrected"])[0], servings), head=head)
            if parts.path in self.server.assets:
                if parts.query:
                    raise RequestError(400, "Static assets accept no query parameters.")
                path, mime = self.server.assets[parts.path]
                # Recheck after startup to avoid following a subsequently replaced link.
                if path.is_symlink() or not path.is_file() or path.resolve() != path:
                    raise RequestError(404, "Asset not found.")
                return self._reply(200, path.read_bytes(), mime, head=head)
            raise RequestError(404, "Not found.")
        except RequestError as exc:
            self._json(exc.status, {"error": str(exc)}, head=head)
        except Exception:
            self._json(500, {"error": "The local workbench could not process this request."}, head=head)

    def do_GET(self):
        self._get()

    def do_HEAD(self):
        self._get(head=True)

    def do_POST(self):
        try:
            parts = self._boundary(post=True)
            if parts.query:
                raise RequestError(400, "POST endpoints accept no query parameters.")
            if parts.path not in {"/api/scale", "/api/call/preview", "/api/call/execute", "/api/call/result"}:
                raise RequestError(404, "Not found.")
            body = self._read_json()
            if parts.path == "/api/scale":
                self._fields(body, {"recipe", "servings"})
                servings = _servings(body["servings"])
                recipe = validate_recipe(body["recipe"])
                return self._json(200, {"recipe": recipe, "report": scale_recipe(recipe, servings), "illustrative": False})
            if parts.path == "/api/call/preview":
                self._fields(body, {"request"})
                return self._json(200, calle.preview(body["request"]))
            if not self.server.live_enabled:
                raise RequestError(403, "Live calls are disabled. Start explicitly with --live and a server-side CALLE_API_KEY.")
            if parts.path == "/api/call/execute":
                self._fields(body, {"request", "approval_token"})
                result = calle.execute(body["request"], body["approval_token"], store_path=self.server.store_path, api_key=self.server._api_key)
            else:
                self._fields(body, {"call_id"})
                result = calle.get_result(body["call_id"], store_path=self.server.store_path, api_key=self.server._api_key)
                if "recipe" in result:
                    result["recipe"] = validate_recipe(result["recipe"])
            # The client has already validated and redacted these consent fields.
            # Keep the full review evidence so the UI cannot skip human consent
            # review merely because the recipe itself passed validation.
            allowed = {"request_id", "state", "call_id", "phone", "creates_call", "duplicate_prevented", "recipe", "consent_review_required", "consent_evidence"}
            return self._json(200, {key: value for key, value in result.items() if key in allowed})
        except RequestError as exc:
            self._json(exc.status, {"error": str(exc)})
        except RecipeValidationError:
            self._json(400, {"error": "Recipe validation failed. Review its quantities, exact source quotes and step dependencies."})
        except calle.CalleError:
            self._json(400, {"error": "The call request or result could not be confirmed. Review consent, the call window and any existing call before taking further action. No automatic retry was attempted."})
        except Exception:
            self._json(500, {"error": "The local workbench could not process this request. No automatic retry was attempted."})

    def do_OPTIONS(self):
        try:
            self._boundary()
            raise RequestError(405, "Cross-origin requests are not supported.")
        except RequestError as exc:
            self._json(exc.status, {"error": str(exc)})


def create_server(port: int = 8793, **kwargs) -> MeasureBackServer:
    return MeasureBackServer(port, **kwargs)


def export_site(output: str | Path, *, web_root: Path | None = None) -> Path:
    """Generate only authored fixtures and allowlisted assets, never live state."""
    destination = Path(output)
    source = (Path(web_root) if web_root is not None else APP_ROOT / "web").resolve()
    resolved = destination.resolve()
    if destination.is_symlink() or resolved == APP_ROOT.resolve() or resolved == source or resolved == Path(resolved.anchor) or resolved in source.parents:
        raise ValueError("Choose a dedicated export directory, not a source or workspace root.")
    assets = _asset_map(source)
    if any("/" + name not in assets for name in STATIC_ASSETS):
        raise ValueError("The web assets are incomplete.")
    generated = {
        "config.json": {"local": False, "live_enabled": False},
        "data.json": {"stages": {stage: {"recipe": validate_recipe(example(stage)), "reports": {str(servings): scale_recipe(example(stage), servings) for servings in range(1, 13)}} for stage in STAGES}},
    }
    allowed_names = {*generated, *(path.lstrip("/") for path in assets if path != "/")}
    if destination.is_dir():
        for existing in destination.rglob("*"):
            name = existing.relative_to(destination).as_posix()
            if existing.is_symlink() or (existing.is_file() and name not in allowed_names):
                raise ValueError("The export directory contains unrelated files. Choose a fresh dedicated directory.")
            if existing.is_dir() and not any(allowed.startswith(name + "/") for allowed in allowed_names):
                raise ValueError("The export directory contains an unrelated directory. Choose a fresh dedicated directory.")
    destination.mkdir(parents=True, exist_ok=True)
    for name in allowed_names:
        target = destination / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError("Export targets must be ordinary files.")
        if not target.resolve().is_relative_to(resolved):
            raise ValueError("Export targets must stay inside the export directory.")
    for name, value in generated.items():
        (destination / name).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    for name, (path, _) in assets.items():
        if name == "/":
            continue
        target = destination / name.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    return resolved
