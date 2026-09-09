from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

DEFAULT_CALLE_BASE_URL = "https://api.heycall-e.com"
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
TERMINAL_STATUSES = {"completed", "failed", "canceled", "cancelled"}
MAX_SLACK_AGE_SECONDS = 300
MAX_BODY_BYTES = 64_000


def mask_phone(phone: str) -> str:
    if len(phone) < 6:
        return "***"
    return f"{phone[:2]}{'*' * (len(phone) - 4)}{phone[-2:]}"


def parse_command(text: str) -> dict[str, str]:
    raw = text.strip()
    mode = "preview"
    if raw.lower().startswith("run "):
        mode = "run"
        raw = raw[4:].strip()
    elif raw.lower().startswith("preview "):
        raw = raw[8:].strip()

    if "|" not in raw:
        raise ValueError("Use: [preview|run] +E164_PHONE | call goal")
    phone, goal = (part.strip() for part in raw.split("|", 1))
    if not E164_RE.fullmatch(phone):
        raise ValueError("Phone must be E.164, for example +15551234567")
    if not goal or len(goal) > 400:
        raise ValueError("Goal must contain 1-400 characters")
    return {"mode": mode, "phone": phone, "goal": goal}


def verify_slack_signature(
    raw_body: bytes, timestamp: str, signature: str, secret: str, now: int | None = None
) -> bool:
    try:
        sent_at = int(timestamp)
    except (TypeError, ValueError):
        return False
    current = int(time.time()) if now is None else now
    if abs(current - sent_at) > MAX_SLACK_AGE_SECONDS:
        return False
    base = b"v0:" + str(sent_at).encode() + b":" + raw_body
    expected = "v0=" + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def validate_response_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != "hooks.slack.com":
        raise ValueError("Slack response_url must use https://hooks.slack.com")
    return value


def idempotency_key(form: dict[str, str], phone: str, goal: str) -> str:
    parts = [
        form.get("team_id", ""),
        form.get("channel_id", ""),
        form.get("user_id", ""),
        form.get("trigger_id", ""),
        phone,
        goal,
    ]
    digest = hashlib.sha256("\0".join(parts).encode()).hexdigest()[:32]
    return f"slack-calle-{digest}"


def build_call_payload(phone: str, goal: str) -> dict[str, Any]:
    task = (
        "Make one disclosed phone call for an authorized Slack operator. "
        "State that you are an AI calling on their behalf. "
        f"Goal: {goal} "
        "Do not buy anything, accept legal or financial terms, request secrets, "
        "or make commitments. Do not provide medical, legal, financial, or emergency advice; "
        "collect facts only and route judgment to a human. If the recipient declines, stop politely."
    )
    return {
        "task": task,
        "recipients": [{"phones": [phone]}],
        "recipient_result_schema": {
            "type": "object",
            "required": ["outcome", "summary"],
            "properties": {
                "outcome": {
                    "type": "string",
                    "enum": ["resolved", "needs_human", "declined", "unreached"],
                },
                "summary": {"type": "string"},
            },
        },
        "metadata": {"source": "slack-calle-bridge"},
    }


def calle_base_url(value: str | None) -> str:
    base = (value or DEFAULT_CALLE_BASE_URL).rstrip("/")
    parsed = urlparse(base)
    local = parsed.hostname in {"127.0.0.1", "localhost"}
    if parsed.scheme == "https":
        return base
    if local and parsed.scheme == "http" and os.getenv("CALLE_ALLOW_INSECURE_LOCALHOST") == "1":
        return base
    raise ValueError("CALLE_BASE_URL must be HTTPS (localhost HTTP is test-only)")


def request_json(
    method: str, url: str, headers: dict[str, str], body: dict[str, Any] | None = None
) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode()
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=15) as response:
        payload = response.read()
    if not payload:
        return {}
    text = payload.decode()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def safe_result(call: dict[str, Any], phone: str) -> dict[str, Any]:
    structured = call.get("structured_result")
    if not isinstance(structured, dict):
        recipients = call.get("recipients")
        if isinstance(recipients, list) and recipients and isinstance(recipients[0], dict):
            structured = recipients[0].get("structured_result")
    if not isinstance(structured, dict):
        structured = {}
    return {
        "call_id": str(call.get("id") or call.get("call_id") or "unknown"),
        "status": str(call.get("status") or "unknown"),
        "phone": mask_phone(phone),
        "outcome": structured.get("outcome", "unknown"),
        "summary": structured.get("summary", "No structured summary returned."),
    }


def run_calle(
    form: dict[str, str],
    command: dict[str, str],
    api_key: str,
    base_url: str,
    transport: Callable[..., dict[str, Any]] = request_json,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    phone, goal = command["phone"], command["goal"]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key(form, phone, goal),
    }
    created = transport("POST", f"{base_url}/v1/calls", headers, build_call_payload(phone, goal))
    call_id = str(created.get("id") or created.get("call_id") or "")
    if not call_id:
        raise RuntimeError("CALL-E did not return a call id")
    call = created
    for _ in range(24):
        status = str(call.get("status") or "").lower()
        if status in TERMINAL_STATUSES:
            return safe_result(call, phone)
        sleep(5)
        call = transport("GET", f"{base_url}/v1/calls/{call_id}", headers)
    return safe_result({**call, "status": "poll_timeout", "id": call_id}, phone)


def slack_safe_text(value: Any) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def slack_message(text: str) -> bytes:
    return json.dumps({"response_type": "ephemeral", "text": text}).encode()


def post_slack_result(response_url: str, result: dict[str, Any]) -> None:
    url = validate_response_url(response_url)
    text = (
        f"CALL-E {slack_safe_text(result['status'])} for {result['phone']}: "
        f"{slack_safe_text(result['outcome'])} — {slack_safe_text(result['summary'])}"
    )
    request_json(
        "POST",
        url,
        {"Content-Type": "application/json"},
        {"response_type": "ephemeral", "replace_original": False, "text": text},
    )


def execute_and_respond(form: dict[str, str], command: dict[str, str]) -> None:
    try:
        result = run_calle(
            form,
            command,
            os.environ["CALLE_API_KEY"],
            calle_base_url(os.getenv("CALLE_BASE_URL")),
        )
        post_slack_result(form["response_url"], result)
    except Exception as exc:  # result channel must fail closed, not disappear
        try:
            post_slack_result(
                form["response_url"],
                {
                    "status": "failed",
                    "phone": mask_phone(command["phone"]),
                    "outcome": "needs_human",
                    "summary": f"Bridge error: {type(exc).__name__}",
                },
            )
        except Exception:
            pass


class SlackBridgeHandler(BaseHTTPRequestHandler):
    server_version = "SlackCalleBridge/1.0"

    def _write(self, status: int, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._write(200, json.dumps({"ok": True}).encode())
            return
        self._write(404, json.dumps({"error": "not_found"}).encode())

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/slack/commands":
            self._write(404, json.dumps({"error": "not_found"}).encode())
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._write(400, slack_message("Invalid request body."))
            return
        raw = self.rfile.read(length)
        secret = os.getenv("SLACK_SIGNING_SECRET", "")
        verified = secret and verify_slack_signature(
            raw,
            self.headers.get("X-Slack-Request-Timestamp", ""),
            self.headers.get("X-Slack-Signature", ""),
            secret,
        )
        if not verified:
            self._write(401, slack_message("Slack signature rejected."))
            return
        parsed = parse_qs(raw.decode(), keep_blank_values=True)
        form = {key: values[0] for key, values in parsed.items()}
        try:
            command = parse_command(form.get("text", ""))
        except (UnicodeDecodeError, ValueError) as exc:
            self._write(200, slack_message(f"Preview rejected: {exc}"))
            return

        masked = mask_phone(command["phone"])
        if command["mode"] == "preview":
            message = (
                f"Preview only — no call placed. Target {masked}. Goal: {slack_safe_text(command['goal'])}\n"
                "To place exactly one call, repeat with `run` before the phone number."
            )
            self._write(200, slack_message(message))
            return

        if not os.getenv("CALLE_API_KEY"):
            self._write(200, slack_message("Live run blocked: CALLE_API_KEY is not configured."))
            return
        try:
            validate_response_url(form.get("response_url", ""))
            calle_base_url(os.getenv("CALLE_BASE_URL"))
        except ValueError as exc:
            self._write(200, slack_message(f"Live run blocked: {exc}"))
            return

        threading.Thread(
            target=execute_and_respond,
            args=(form, command),
            daemon=True,
        ).start()
        self._write(
            200,
            slack_message(f"CALL-E run accepted for {masked}. Structured result will follow here."),
        )

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep request bodies, phone numbers, response URLs, and secrets out of logs.
        print(f"slack-calle-bridge: {fmt % args}")


def main() -> int:
    if not os.getenv("SLACK_SIGNING_SECRET"):
        raise SystemExit("SLACK_SIGNING_SECRET is required")
    port = int(os.getenv("PORT", "8787"))
    host = os.getenv("HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "localhost", "0.0.0.0"}:
        raise SystemExit("HOST must be localhost, 127.0.0.1, or 0.0.0.0")
    server = ThreadingHTTPServer((host, port), SlackBridgeHandler)
    print(f"slack-calle-bridge listening on {host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
