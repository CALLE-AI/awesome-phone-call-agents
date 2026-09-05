"""Minimal single-page web facade for compliance-gated-callback.

Reuses client.py and compliance/ as-is - this file adds no new business
logic, only an HTTP form/response layer over the same functions
client.py's main() already calls.

Safety, mirroring the CLI's two-gate design at server-startup
granularity instead of per-invocation:
  - No --allow-live control and no API-key field in the browser.
    --allow-live is a server startup flag (see parse_server_args);
    CALLE_API_KEY is read from the server process's own environment,
    exactly like the CLI. A form submission can never cause a real call
    unless the person who started this server explicitly opted in when
    launching it.
  - No authentication, no accounts, no database: a local, single-operator
    tool. Binds to 127.0.0.1 by default. Never expose this beyond
    localhost - anyone who can reach it can submit the form.
  - Every response HTML-escapes user-supplied values (html.escape) before
    embedding them - phone, task, timezone, and anything echoed back are
    never inserted raw into the page.
"""

from __future__ import annotations

import argparse
import html
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs

from client import (
    FAKE_DEV_API_KEY,
    REAL_API_BASE_URL,
    CallEAPIError,
    CallEClient,
    build_hardened_task,
    build_recipient,
    default_intent_result_schema,
    derive_idempotency_key,
    load_dotenv,
    mask_secret,
    parse_utc_timestamp,
    redacted_call_for_display,
    redacted_recipient_for_display,
    render_disclosure_script,
    resolve_api_key,
    validate_business_context,
)
from compliance.dispatcher import resolve_locale_and_region, run_precall_checks
from compliance.models import PreCallContext, compute_consent_retention_expiry

load_dotenv()

FORM_PAGE = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>compliance-gated-callback</title></head>
<body>
<h1>compliance-gated-callback</h1>
<p>Minimal facade. Every submission runs the same compliance gate as the CLI before anything is sent.</p>
<form method="post" action="/">
  <p><label>Phone number (E.164)<br><input type="text" name="phone" placeholder="+33639980456" required></label></p>
  <p><label>Call objective<br><textarea name="task" rows="3" cols="60" required></textarea></label></p>
  <p><label>Business context (optional, pasted directly - services, pricing, hours, FAQs)<br>
     <textarea name="business_context" rows="4" cols="60"></textarea></label></p>
  <p><label>Entity name for the required AI-disclosure script (optional - a generic, honest
     fallback phrase is used if left blank)<br>
     <input type="text" name="entity_name" placeholder="Bright Smile Dental"></label></p>
  <p><label>Agent first name for the required AI-disclosure script (optional - a neutral,
     honest fallback is used if left blank, never an invented name)<br>
     <input type="text" name="agent_name" placeholder="Alex"></label></p>
  <p><label><input type="checkbox" name="consent_obtained" value="1"> Consent obtained</label><br>
     <label>Consent timestamp (ISO 8601 UTC, optional - defaults to now)<br>
       <input type="text" name="consent_timestamp" placeholder="2026-08-20T12:00:00Z"></label></p>
  <p><label><input type="checkbox" name="dnc_checked" value="1"> DNC / opposition list checked</label></p>
  <p><label><input type="checkbox" name="gdpr_basis_documented" value="1"> GDPR lawful basis documented (EU numbers)</label></p>
  <p><label>Recipient timezone (IANA name)<br><input type="text" name="recipient_timezone" placeholder="Europe/Paris"></label></p>
  <p><label><input type="checkbox" name="intends_to_record" value="1"> Intends to record</label></p>
  <p><label>Solicitations to this recipient in the last 24h, calls+texts (required for Oregon numbers)<br>
     <input type="text" name="solicitations_in_last_24h" placeholder="0"></label></p>
  <p>Mode:
     <label><input type="radio" name="mode" value="dry_run" checked> Dry-run</label>
     <label><input type="radio" name="mode" value="execute"> Execute</label></p>
  <p><label>now_utc override (testing only, ISO 8601 UTC, leave blank normally)<br>
     <input type="text" name="now_utc"></label></p>
  <p><button type="submit">Send</button></p>
</form>
</body>
</html>
"""

PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>compliance-gated-callback - result</title></head>
<body>
<h1>compliance-gated-callback</h1>
{body}
<p><a href="/">Back to form</a></p>
</body>
</html>
"""


def _first(form: dict[str, list[str]], key: str) -> str:
    return (form.get(key) or [""])[0].strip()


def _checked(form: dict[str, list[str]], key: str) -> bool:
    return _first(form, key) == "1"


def _escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def render_compliance_section(decision) -> str:
    chain = " -> ".join(decision.jurisdiction_chain) if decision.jurisdiction_chain else "(none resolved)"
    lines = ["<h2>Compliance gate</h2>", f"<p>Jurisdiction chain: {_escape(chain)}</p>", "<ul>"]
    for result in decision.results:
        status = "PASS" if result.passed else "FAIL"
        lines.append(f"<li>[{status}] {_escape(result.check_name)}: {_escape(result.reason)}</li>")
    lines.append("</ul>")
    lines.append(f"<p><strong>Allowed: {decision.allowed}</strong></p>")
    return "\n".join(lines)


def render_consent_retention_section(context: PreCallContext) -> str | None:
    """Informational only - does not gate the compliance decision. See
    compute_consent_retention_expiry's docstring for FTC TSR / UWG Sec.
    7a sourcing.
    """
    if context.consent_timestamp is None:
        return None
    reference_time = context.now_utc or datetime.now(timezone.utc)
    expiry = compute_consent_retention_expiry(context.consent_timestamp, reference_time)
    return (
        f"<p>Consent record retention: keep this consent record until "
        f"{_escape(expiry.isoformat())} (FTC TSR 16 CFR 310.5 / Germany UWG Sec. 7a - "
        "informational, not sent to CALL-E)</p>"
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def server_base_url(self) -> str:
        return self.server.web_base_url  # type: ignore[attr-defined]

    @property
    def server_allow_live(self) -> bool:
        return self.server.web_allow_live  # type: ignore[attr-defined]

    def log_message(self, *args) -> None:
        return

    def _send_html(self, status: int, body: str) -> None:
        raw = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path != "/":
            self._send_html(404, PAGE_TEMPLATE.format(body="<p>Not found.</p>"))
            return
        self._send_html(200, FORM_PAGE)

    def do_POST(self) -> None:
        if self.path != "/":
            self._send_html(404, PAGE_TEMPLATE.format(body="<p>Not found.</p>"))
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        form = parse_qs(raw.decode("utf-8"))

        phone = _first(form, "phone")
        task = _first(form, "task")
        consent_obtained = _checked(form, "consent_obtained")
        consent_timestamp_raw = _first(form, "consent_timestamp")
        now_utc_raw = _first(form, "now_utc")
        solicitations_raw = _first(form, "solicitations_in_last_24h")
        business_context_raw = _first(form, "business_context") or None
        entity_name = _first(form, "entity_name") or None
        agent_name = _first(form, "agent_name") or None

        try:
            consent_timestamp = (
                parse_utc_timestamp(consent_timestamp_raw)
                if consent_timestamp_raw
                else (datetime.now(timezone.utc) if consent_obtained else None)
            )
            now_utc = parse_utc_timestamp(now_utc_raw) if now_utc_raw else None
            solicitations_in_last_24h = int(solicitations_raw) if solicitations_raw else None
            business_context = validate_business_context(business_context_raw)
        except (argparse.ArgumentTypeError, ValueError) as exc:
            self._send_html(400, PAGE_TEMPLATE.format(body=f"<p>Invalid input: {_escape(exc)}</p>"))
            return

        context = PreCallContext(
            phone_e164=phone,
            intends_to_record=_checked(form, "intends_to_record"),
            consent_obtained=consent_obtained,
            consent_timestamp=consent_timestamp,
            dnc_checked=_checked(form, "dnc_checked"),
            gdpr_basis_documented=_checked(form, "gdpr_basis_documented"),
            recipient_timezone=_first(form, "recipient_timezone") or None,
            now_utc=now_utc,
            solicitations_in_last_24h=solicitations_in_last_24h,
        )
        decision = run_precall_checks(context)
        locale, region, disclosure_script_template = resolve_locale_and_region(decision.jurisdiction_chain)
        disclosure_script = (
            render_disclosure_script(disclosure_script_template, entity_name, agent_name)
            if disclosure_script_template
            else None
        )

        try:
            recipient = build_recipient(phone, locale, region)
        except ValueError as exc:
            self._send_html(400, PAGE_TEMPLATE.format(body=f"<p>{_escape(exc)}</p>"))
            return

        hardened_task = build_hardened_task(task, business_context, disclosure_script)
        body_preview = {
            "task": hardened_task,
            "recipients": [redacted_recipient_for_display(recipient)],
            "result_schema": default_intent_result_schema(),
        }
        mode = _first(form, "mode") or "dry_run"

        sections = [
            f"<p>Mode: {_escape(mode.upper())}</p>",
            render_compliance_section(decision),
        ]
        retention_section = render_consent_retention_section(context)
        if retention_section is not None:
            sections.append(retention_section)
        sections.append(f"<h2>Request body</h2><pre>{_escape(json.dumps(body_preview, indent=2))}</pre>")

        if mode != "execute":
            sections.append("<p>Dry-run: nothing was sent.</p>")
            self._send_html(200, PAGE_TEMPLATE.format(body="\n".join(sections)))
            return

        if not decision.allowed:
            sections.append(
                "<p><strong>STOP:</strong> compliance gate blocks this call. "
                f"Reasons: {_escape(decision.blocking_reasons)}</p>"
            )
            self._send_html(200, PAGE_TEMPLATE.format(body="\n".join(sections)))
            return

        fake_args = SimpleNamespace(base_url=self.server_base_url, execute=True, allow_live=self.server_allow_live)
        api_key = resolve_api_key(fake_args)
        if api_key == FAKE_DEV_API_KEY:
            sections.append("<p>Using API key: fake dev key, not a real credential (non-live target)</p>")
        else:
            sections.append(f"<p>Using API key: {_escape(mask_secret(api_key))}</p>")

        client = CallEClient(base_url=self.server_base_url, api_key=api_key, allow_live=self.server_allow_live)
        idempotency_key = derive_idempotency_key(phone, task, datetime.now(timezone.utc))

        try:
            created = client.create_call(
                task=hardened_task,
                recipients=[recipient],
                result_schema=default_intent_result_schema(),
                idempotency_key=idempotency_key,
            )
            call_id = created["id"]
            sections.append(f"<p>Created call {_escape(call_id)} with status {_escape(created['status'])}</p>")
            sections.append(
                "<p>Note: calle.openapi.yaml has no cancel endpoint for an in-flight call; "
                f"call {_escape(call_id)} cannot be canceled once placed (known limitation, C31).</p>"
            )
            final_call = client.poll_until_terminal(call_id, interval_seconds=2.0, timeout_seconds=120.0)
        except (CallEAPIError, RuntimeError, TimeoutError) as exc:
            sections.append(f"<p><strong>Error:</strong> {_escape(exc)}</p>")
            self._send_html(200, PAGE_TEMPLATE.format(body="\n".join(sections)))
            return

        sections.append("<h2>Result</h2>")
        sections.append(f"<pre>{_escape(json.dumps(redacted_call_for_display(final_call), indent=2))}</pre>")
        self._send_html(200, PAGE_TEMPLATE.format(body="\n".join(sections)))


def parse_server_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Minimal web facade for compliance-gated-callback.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address. Never expose beyond localhost.")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", 8000)),
        help="Defaults to the PORT environment variable (Render/Heroku convention) or 8000.",
    )
    parser.add_argument("--base-url", default=os.environ.get("CALLE_API_BASE_URL", REAL_API_BASE_URL))
    parser.add_argument(
        "--allow-live",
        action="store_true",
        help="Required, in addition to --base-url being the real API, before any request through "
        "this server can place a real call. Cannot be set from the browser.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_server_args(argv)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.web_base_url = args.base_url  # type: ignore[attr-defined]
    server.web_allow_live = args.allow_live  # type: ignore[attr-defined]
    print(f"Serving on http://{args.host}:{args.port} (base_url={args.base_url}, allow_live={args.allow_live})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
