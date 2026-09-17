"""A local review console with an isolated synthetic public demo mode.

The console is where a biller reads what the plan said, sees the words that
support it, and signs off. It has no authentication, so it refuses to be
anything other than local: it will not bind a non-loopback address, it rejects a
request whose ``Host`` is not loopback, and it requires a header on writes that a
cross-site form post cannot set.

The page itself is a shell. Everything a reader sees is fetched from the JSON
endpoints below and written into the document as text rather than as markup, so
a value that came off a phone call cannot become part of the page. Approving a
claim, adding a claim, and placing a *fixture* call are the only things it can
do locally. Public demo mode starts with a fresh temporary copy of the committed
synthetic records and disables claim intake. It cannot place a live call — that
still requires the CLI and a written,
expiring, budgeted authorization record, on purpose: an unauthenticated local
server is not where a real outbound phone call and a real charge should
originate.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from . import audit, client as calle_client, demo, engine, hold, policy, redact, ui, vault, workqueue
from .models import ANSWERED, NEEDS_HUMAN, QUEUED, UNKNOWN, Claim, load_ledger, new_id, save_ledger

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
WRITE_HEADER = "X-Trunkline"

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
FIXTURES_DIR = os.path.join(os.path.dirname(PACKAGE_DIR), "fixtures")

# 'self' is needed for the fetch calls that carry the data; nothing else is
# allowed, so the page can neither load nor reach anything off this origin.
CSP = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
       "connect-src 'self'; form-action 'none'; base-uri 'none'")


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def _grounded(fields: Dict[str, Any]) -> bool:
    return bool(fields.get("_grounded"))


def _claim_row(ledger, claim) -> Dict[str, Any]:
    return {
        "id": claim.id,
        "claim_number": claim.claim_number,
        "payer": ledger.payer(claim.payer_id).name,
        "payer_id": claim.payer_id,
        "workflow": claim.workflow,
        "billed_amount": claim.billed_amount,
        "filing_deadline": claim.filing_deadline,
        "state": claim.state,
        "has_result": bool(claim.result),
        "grounded": _grounded(claim.result),
    }


def _claim_detail(ledger, claim) -> Dict[str, Any]:
    row = _claim_row(ledger, claim)
    payer = ledger.payer(claim.payer_id)
    phone_patterns = redact.build_phone_patterns([payer.phone])
    row["result"] = redact.scrub_value(
        {k: v for k, v in claim.result.items() if not k.startswith("_")},
        [], phone_patterns,
    )
    row["call_id"] = ""
    for record in reversed(ledger.calls):
        if claim.id in record.claim_ids:
            row["call_id"] = record.id
            break
    return row


def _call_row(ledger, record) -> Dict[str, Any]:
    payer = ledger.payer(record.payer_id)
    phone_patterns = redact.build_phone_patterns([payer.phone])
    return {
        "id": record.id,
        "payer": payer.name,
        "phone": policy.mask_phone(payer.phone),
        "workflow": record.workflow,
        "outcome": record.outcome or record.status,
        "reached": record.outcome in ui.REACHED_OUTCOMES,
        "mode": record.mode,
        "created_at": record.created_at,
        "reference_number": redact.mask_phone_text(record.reference_number, phone_patterns),
        "rep_name": redact.mask_phone_text(record.rep_name, phone_patterns),
        "hold_human": hold.format_duration(record.hold_seconds),
        "talk_human": hold.format_duration(record.talk_seconds),
        "total_human": hold.format_duration(record.total_seconds),
        "cost_estimate_usd": record.cost_estimate_usd,
        "claims": len(record.claim_ids),
    }


def _call_detail(ledger, record) -> Dict[str, Any]:
    row = _call_row(ledger, record)
    payer = ledger.payer(record.payer_id)
    phone_patterns = redact.build_phone_patterns([payer.phone])
    row["reference_number"] = redact.mask_phone_text(
        str(row["reference_number"]), phone_patterns,
    )
    row["rep_name"] = redact.mask_phone_text(str(row["rep_name"]), phone_patterns)
    row["findings"] = redact.scrub_value(list(record.findings), [], phone_patterns)
    row["claims"] = []
    for claim_id in record.claim_ids:
        claim = ledger.claim(claim_id)
        fields = record.per_claim.get(claim_id, {}) or {}
        row["claims"].append({
            "claim_number": claim.claim_number,
            "state": claim.state,
            "grounded": _grounded(fields),
            "fields": redact.scrub_value(
                {k: v for k, v in fields.items() if not k.startswith("_")},
                [], phone_patterns,
            ),
        })

    # The hold gaps are recomputed here rather than stored, for the same reason
    # they are derived in the first place: the transcript offsets are the record.
    turns: List[Dict[str, Any]] = []
    previous: Optional[int] = None
    for turn in record.transcript:
        offset = int(turn.get("offset_seconds", 0))
        gap = ""
        if previous is not None and offset - previous >= hold.HOLD_GAP_THRESHOLD_SECONDS:
            gap = hold.format_duration(offset - previous)
        turns.append({
            "at": hold.format_duration(offset),
            "speaker": str(turn.get("speaker", "")),
            "text": redact.mask_phone_text(str(turn.get("text", "")), phone_patterns),
            "hold_before": gap,
        })
        previous = offset
    row["transcript"] = turns
    return row


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

def _synthetic_public_data() -> tempfile.TemporaryDirectory:
    """Create the only ledger the unauthenticated public console may expose."""
    directory = tempfile.TemporaryDirectory(prefix="trunkline-public-demo-")
    ledger, records = demo.build()
    workqueue.rescore(ledger)
    save_ledger(directory.name, ledger)
    for patient_ref, values in records.items():
        vault.put(directory.name, patient_ref, values)
    return directory


def _public_write_allowed(path: str) -> bool:
    """Public visitors may operate fixtures, but may not submit arbitrary data."""
    return path in ("/approve", "/call")

def serve(data_dir: str, host: str = "127.0.0.1", port: int = 8770) -> int:
    public_demo = os.environ.get("TRUNKLINE_PUBLIC_DEMO", "").strip() == "1"
    if host not in LOOPBACK_HOSTS and not public_demo:
        print("The console has no authentication and refuses to bind %s. Use 127.0.0.1," % host)
        print("or set TRUNKLINE_PUBLIC_DEMO=1 to serve the isolated synthetic demo.")
        return 2
    public_directory = None
    if public_demo:
        public_directory = _synthetic_public_data()
        data_dir = public_directory.name
    elif not os.path.exists(os.path.join(data_dir, "ledger.json")):
        print("No ledger at %s. Run `trunkline --data %s init-demo` first." % (data_dir, data_dir))
        return 1

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:
            pass

        def _host_ok(self) -> bool:
            if public_demo:
                return True
            hostname = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            return hostname in LOOPBACK_HOSTS

        def _send(self, code: int, body: bytes,
                  content_type: str = "text/html; charset=utf-8") -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, payload: Any, code: int = 200) -> None:
            self._send(code, json.dumps(payload).encode("utf-8"),
                       "application/json; charset=utf-8")

        def _text(self, code: int, message: str) -> None:
            self._send(code, message.encode("utf-8"), "text/plain; charset=utf-8")

        # -- reads ------------------------------------------------------
        def do_GET(self) -> None:
            if not self._host_ok():
                return self._text(403, "forbidden")
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            path = parsed.path

            if path == "/":
                return self._send(200, ui.shell())

            if not path.startswith("/api/"):
                return self._text(404, "not found")

            ledger = load_ledger(data_dir)

            if path == "/api/graph":
                payload = ui.graph(ledger)
                payload["practice"] = ledger.practices[0].name if ledger.practices else ""
                payload["public_demo"] = public_demo
                return self._json(payload)

            if path == "/api/claims":
                claims = ledger.claims
                if query.get("review"):
                    claims = [c for c in claims if c.state in (ANSWERED, NEEDS_HUMAN)]
                    claims = sorted(claims, key=lambda c: (c.state != NEEDS_HUMAN, c.claim_number))
                    return self._json([_claim_detail(ledger, c) for c in claims])
                claims = sorted(claims, key=lambda c: (-c.priority_score, c.claim_number))
                return self._json([_claim_row(ledger, c) for c in claims])

            if path == "/api/calls":
                calls = sorted(ledger.calls, key=lambda c: c.created_at, reverse=True)
                return self._json([_call_row(ledger, c) for c in calls])

            if path == "/api/call":
                try:
                    record = ledger.call((query.get("id") or [""])[0])
                except KeyError:
                    return self._text(404, "not found")
                return self._json(_call_detail(ledger, record))

            if path == "/api/claim":
                try:
                    claim = ledger.claim((query.get("id") or [""])[0])
                except KeyError:
                    return self._text(404, "not found")
                return self._json(_claim_detail(ledger, claim))

            if path == "/api/new-claim-form":
                return self._json({
                    "payers": [{"id": p.id, "name": p.name} for p in ledger.payers],
                    "envelopes": {k: list(v) for k, v in policy.DISCLOSURE_ENVELOPES.items()},
                })

            self._text(404, "not found")

        # -- writes -------------------------------------------------------
        # Three, all local-state only: approve a claim, add a claim, and place
        # a *fixture* call. None of them can cause a real phone call.
        def do_POST(self) -> None:
            if not self._host_ok():
                return self._text(403, "forbidden")
            if self.headers.get(WRITE_HEADER) is None:
                return self._text(403, "missing write header")
            path = urlparse(self.path).path
            if public_demo and not _public_write_allowed(path):
                return self._text(403, "public demo accepts synthetic records only")
            length = int(self.headers.get("Content-Length", "0"))
            form = parse_qs(self.rfile.read(length).decode("utf-8"))

            if path == "/approve":
                return self._do_approve(form)
            if path == "/add-claim":
                return self._do_add_claim(form)
            if path == "/call":
                return self._do_call(form)
            self._text(404, "not found")

        def _do_approve(self, form: Dict[str, List[str]]) -> None:
            claim_id = (form.get("claim_id") or [""])[0]
            ledger = load_ledger(data_dir)
            ctx = engine.Context(data_dir=data_dir, ledger=ledger, actor="console")
            try:
                engine.approve(ctx, ledger.claim(claim_id), note="approved in console")
            except (KeyError, engine.EngineError) as error:
                return self._text(400, str(error))
            self._text(200, "approved")

        def _do_add_claim(self, form: Dict[str, List[str]]) -> None:
            def field(name: str) -> str:
                return (form.get(name) or [""])[0].strip()

            payer_id = field("payer_id")
            workflow = field("workflow")
            claim_number = field("claim_number")
            date_of_service = field("date_of_service")
            filing_deadline = field("filing_deadline")

            ledger = load_ledger(data_dir)
            try:
                payer = ledger.payer(payer_id)
            except KeyError:
                return self._text(400, "unknown payer")
            if workflow not in policy.DISCLOSURE_ENVELOPES:
                return self._text(400, "unknown workflow")
            if not claim_number or not date_of_service:
                return self._text(400, "claim_number and date_of_service are required")
            if not ledger.practices:
                return self._text(400, "no practice on file")
            try:
                billed_amount = float(field("billed_amount") or "0")
            except ValueError:
                return self._text(400, "billed_amount must be a number")
            if not filing_deadline:
                filing_deadline = (date.today() + timedelta(days=180)).isoformat()

            # Only the fields this workflow's envelope allows are accepted, so
            # the form cannot be used to smuggle an unnecessary identifier into
            # the vault. Never-disclose fields are not offered here at all.
            envelope = policy.DISCLOSURE_ENVELOPES[workflow]
            vault_values = {}
            field_map = {
                "member_id": "member_id",
                "date_of_birth": "date_of_birth",
                "patient_last_name": "patient_last_name",
            }
            for envelope_field in envelope:
                form_field = field_map.get(envelope_field)
                if form_field:
                    value = field(form_field)
                    if value:
                        vault_values[envelope_field] = value
            if not vault_values:
                return self._text(400, "at least one patient identifier is required")

            claim_id = new_id("clm")
            patient_ref = new_id("pt")
            vault.put(data_dir, patient_ref, vault_values)

            claim = Claim(
                id=claim_id,
                practice_id=ledger.practices[0].id,
                payer_id=payer.id,
                patient_ref=patient_ref,
                workflow=workflow,
                claim_number=claim_number,
                date_of_service=date_of_service,
                billed_amount=billed_amount,
                filing_deadline=filing_deadline,
                state=QUEUED,
            )
            ledger.claims.append(claim)
            workqueue.rescore(ledger)
            save_ledger(data_dir, ledger)
            audit.record(
                data_dir, actor="console", action="claim.added", subject=claim_id,
                detail={"payer_id": payer.id, "workflow": workflow, "claim_number": claim_number},
            )
            self._json({"ok": True, "claim_id": claim_id})

        def _do_call(self, form: Dict[str, List[str]]) -> None:
            payer_id = (form.get("payer_id") or [""])[0]
            workflow = (form.get("workflow") or [""])[0]
            ledger = load_ledger(data_dir)
            try:
                ledger.payer(payer_id)
            except KeyError:
                return self._text(400, "unknown payer")
            if workflow not in policy.DISCLOSURE_ENVELOPES:
                return self._text(400, "unknown workflow")

            # ignore_window: safe here because mode is hard-coded to fixture a few
            # lines down. The calling window matters for a real phone call; it is
            # meaningless for a local recording replayed against a fake transport.
            config = engine.Config(ignore_window=True)
            ctx = engine.Context(data_dir=data_dir, ledger=ledger, config=config,
                                  fixtures_dir=FIXTURES_DIR, actor="console")
            workqueue.rescore(ctx.ledger)
            bundles = workqueue.build_bundles(ctx.ledger, workflow=workflow, payer_id=payer_id, max_bundles=1)
            if not bundles:
                return self._text(400, "nothing queued for that payer and workflow")
            bundle = bundles[0]
            scenario = demo.scenario_for(
                FIXTURES_DIR, bundle.workflow, [c.claim_number for c in bundle.claims],
            )
            server = calle_client.FakeCalleServer(FIXTURES_DIR).start()
            try:
                outcome = engine.run_bundle(
                    ctx, bundle, mode=engine.MODE_FIXTURE, api_key="fixture-local-key",
                    base_url=server.base_url, fixture_scenario=scenario, first_poll_delay=0.0,
                )
            except Exception:  # noqa: BLE001 - failure is returned without provider details
                return self._text(500, "fixture call failed")
            finally:
                server.stop()

            if outcome.suppressed:
                return self._json({"ok": False, "suppressed": outcome.suppressed,
                                    "reasons": [policy.describe_suppression(r) for r in outcome.suppressed]})
            record = outcome.call
            self._json({
                "ok": True,
                "call_id": record.id if record else "",
                "outcome": record.outcome if record else "",
            })

    httpd = ThreadingHTTPServer((host, port), Handler)
    audit.record(data_dir, actor="console", action="console.started",
                 subject="%s:%d" % (host, port), detail={})
    scope = "synthetic public demo" if public_demo else "loopback only"
    print("Trunkline console on http://%s:%d  (%s, Ctrl-C to stop)" % (host, port, scope))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("")
    finally:
        httpd.server_close()
        if public_directory is not None:
            public_directory.cleanup()
    return 0
