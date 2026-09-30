"""A small read-mostly HTTP API for the console.

Standard library only, so the app has no runtime dependencies and deploys as a
single process. The API never places a live call: the console drives the
scripted demo path, and dialling stays behind the CLI's explicit
authorisation flag.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import adversary, backtest, cadence, demo, ladder, register, roster
from .ledger import Ledger
from .safety import redact, redact_all
from .runner import plan_call, run_cycle
from . import calle

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
SCHEME = "the Northern Counties Pension Scheme"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def current_cycle() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def roster_payload() -> dict:
    return {
        "cycle": current_cycle(),
        "scheme": SCHEME,
        "subjects": [
            {
                "subject_id": s.subject_id,
                "display_name": s.display_name,
                "reference": s.reference,
                "country_code": s.country_code,
                "language": s.language,
                "needs_human_path": s.accessibility.requires_human_path,
                "prompt_count": len(s.prompts),
                "scenario": demo.SUBJECT_SCENARIOS.get(s.subject_id, "clean"),
            }
            for s in roster.ROSTER
        ],
        "scenarios": demo.SCENARIOS,
    }


def attest_payload(subject_id: str, scenario: str | None) -> dict:
    subject = roster.get(subject_id)
    cycle = current_cycle()
    chosen = scenario or demo.SUBJECT_SCENARIOS.get(subject_id, "clean")
    plan = plan_call(subject, cycle, SCHEME)
    client = calle.DryRunClient(scripted_result=demo.scripted_call(plan, chosen))
    _, attestation = run_cycle(subject, cycle, SCHEME, client=client, plan=plan)
    reconciled = register.reconcile(attestation, roster.register_entry(subject_id))
    due = cadence.next_due(attestation)
    step = ladder.next_step(None, attestation.grade)
    return {
        "subject_id": subject.subject_id,
        "display_name": subject.display_name,
        "masked_phone": plan.masked_phone(),
        "scenario": chosen,
        "challenge": {
            "words": list(plan.issued_nonce.words),
            "weekday": plan.issued_nonce.weekday,
        },
        "prompts": [
            {"prompt_id": p.prompt_id, "question": p.question,
             "co_resident_safe": p.co_resident_safe}
            for p in plan.prompts
        ],
        "task_text": redact(plan.task_text),
        "grade": attestation.grade.value,
        "reasons": list(attestation.reasons),
        "nonce_ok": attestation.nonce_ok,
        "reverse_ok": attestation.reverse_ok,
        "challenges_passed": attestation.challenges_passed,
        "challenges_asked": attestation.challenges_asked,
        "coaching_suspected": attestation.coaching_suspected,
        "auto_closes": attestation.auto_closes,
        "stops_payment": attestation.stops_payment,
        "evidence_quotes": list(redact_all(attestation.evidence_quotes)),
        "reconciliation": {
            "outcome": reconciled.outcome.value,
            "reasons": list(reconciled.reasons),
            "opens_correction_case": reconciled.opens_correction_case,
            "stops_payment": reconciled.stops_payment,
            "register": (
                {
                    "status": e.status.value,
                    "recorded_on": e.recorded_on.isoformat() if e.recorded_on else None,
                    "source": e.source,
                }
                if (e := roster.register_entry(subject_id)) else None
            ),
        },
        "next_due": due.isoformat() if due else None,
        "interval_days": cadence.interval_days(attestation.grade),
        "next_step": step.value if step else None,
        "next_step_purpose": ladder.RUNGS[step].purpose if step else None,
        "next_step_may_attest": ladder.may_attest(step) if step else None,
        "transcript": [
            {"offset_seconds": t.offset_seconds, "speaker": t.speaker, "text": redact(t.text)}
            for t in _turns_for(plan, chosen)
        ],
    }


def _turns_for(plan, scenario: str):
    from .extract import transcript_turns
    return transcript_turns(demo.scripted_call(plan, scenario))


def exposure_payload() -> dict:
    return {
        "assumption": (
            "Models the schedule only. It assumes no call can return "
            "CONFIRMED_LIVE after a death, because a challenge minted seconds "
            "ago cannot be answered on somebody's behalf and a relative "
            "vouching is never a pass."
        ),
        "interval_days": cadence.INTERVAL_DAYS[__import__("muster.models", fromlist=["Grade"]).Grade.CONFIRMED_LIVE],
        "ladder_days": ladder.days_to_human(),
        "cases": [
            {
                "key": m.case.key,
                "title": m.case.title,
                "citation": m.case.citation,
                "died": m.case.died,
                "detected": m.case.detected,
                "note": m.case.note,
                "actual_days": m.actual_days,
                "modelled_days": m.modelled_days,
                "reduction_factor": round(m.reduction_factor, 1),
            }
            for m in backtest.model_all()
        ],
    }


def adversary_payload() -> dict:
    outcomes = adversary.run_all()
    return {
        "caught": sum(1 for o in outcomes if o.caught),
        "total": len(outcomes),
        "attacks": [
            {
                "key": o.attack.key,
                "name": o.attack.name,
                "description": o.attack.description,
                "grade": o.grade.value,
                "caught": o.caught,
                "expected_caught": o.attack.expected_caught,
                "as_documented": o.as_expected,
            }
            for o in outcomes
        ],
    }


def ladder_payload() -> dict:
    return {
        "days_to_human": ladder.days_to_human(),
        "rungs": [
            {
                "step": s.value,
                "dials": ladder.RUNGS[s].dials,
                "may_attest": ladder.RUNGS[s].may_attest,
                "purpose": ladder.RUNGS[s].purpose,
                "days": ladder.RUNG_DAYS[s],
            }
            for s in ladder.ORDER
        ],
        "intervals": {g.value: cadence.INTERVAL_DAYS[g] for g in cadence.INTERVAL_DAYS},
    }


def ledger_payload(subject_id: str) -> dict:
    """Build a short chain for the subject so the integrity check is visible."""
    subject = roster.get(subject_id)
    cycle = current_cycle()
    chain = Ledger()
    for scenario in ("clean", "clean", demo.SUBJECT_SCENARIOS.get(subject_id, "clean")):
        plan = plan_call(subject, cycle, SCHEME)
        client = calle.DryRunClient(scripted_result=demo.scripted_call(plan, scenario))
        _, attestation = run_cycle(subject, cycle, SCHEME, client=client, plan=plan)
        chain.append(attestation)
    intact, broken = chain.verify()
    return {
        "subject_id": subject_id,
        "intact": intact,
        "broken_at": broken,
        "entries": [
            {
                "grade": e.attestation.grade.value,
                "graded_at": e.attestation.graded_at.isoformat(),
                "previous": e.previous[:16],
                "this": e.this[:16],
            }
            for e in chain.entries
        ],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "muster"

    def log_message(self, fmt: str, *args) -> None:  # keep test output quiet
        pass

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)

        if route == "/api/roster":
            self._json(200, roster_payload())
            return
        if route == "/api/attest":
            subject_id = (query.get("subject") or [""])[0]
            scenario = (query.get("scenario") or [None])[0]
            try:
                self._json(200, attest_payload(subject_id, scenario))
            except KeyError as error:
                self._json(404, {"error": str(error)})
            return
        if route == "/api/exposure":
            self._json(200, exposure_payload())
            return
        if route == "/api/adversary":
            self._json(200, adversary_payload())
            return
        if route == "/api/ladder":
            self._json(200, ladder_payload())
            return
        if route == "/api/ledger":
            subject_id = (query.get("subject") or [""])[0]
            try:
                self._json(200, ledger_payload(subject_id))
            except KeyError as error:
                self._json(404, {"error": str(error)})
            return
        if route == "/api/health":
            self._json(200, {"ok": True, "places_calls": False})
            return

        self._serve_static("index.html" if route == "/" else route.lstrip("/"))

    def _serve_static(self, relative: str) -> None:
        candidate = (WEB_ROOT / relative).resolve()
        if not str(candidate).startswith(str(WEB_ROOT.resolve())) or not candidate.is_file():
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        content_type = CONTENT_TYPES.get(candidate.suffix, "application/octet-stream")
        self._send(200, candidate.read_bytes(), content_type)


def serve(host: str = "0.0.0.0", port: int = 8080) -> None:
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    import os
    serve(port=int(os.environ.get("PORT", "8080")))
