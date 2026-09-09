"""A small read-mostly HTTP API for the console.

Standard library only, so the app has no runtime dependencies and deploys as a
single process. The API never places a live call: the console drives the
scripted demo path, and dialling stays behind the CLI's explicit authorisation
flag. Phone numbers leave this process masked.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import calle, demo, extract, registry
from .safety import redact, redact_all
from .models import CaptureResult, Conflict, Institution, Pack, Requirement
from .runner import Plan, plan_call, run_institution

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def _requirement_payload(requirement: Requirement | None) -> dict | None:
    if requirement is None:
        return None
    return {
        "department": redact(requirement.department),
        "documents_needed": list(redact_all(requirement.documents_needed)),
        "certified_copy_accepted": requirement.certified_copy_accepted.value,
        "direct_debits_action": requirement.direct_debits_action.value,
        "reference_opened": redact(requirement.reference_opened),
        "missing": list(requirement.missing),
    }


def _conflict_payload(conflict: Conflict) -> dict:
    """Both sides, no winner. The console renders them side by side."""
    return {
        "field": conflict.field_name,
        "stated": redact(conflict.stated),
        "stated_source": redact(conflict.stated_source),
        "counter": redact(conflict.counter),
        "counter_source": redact(conflict.counter_source),
        "quote": redact(conflict.quote),
    }


def _result_payload(
    institution: Institution, plan: Plan, result: CaptureResult, scenario: str
) -> dict:
    return {
        "institution_id": institution.institution_id,
        "institution": institution.name,
        "kind": institution.kind.value,
        "masked_phone": institution.masked_phone(),
        "scenario": scenario,
        "captured_at": result.captured_at.isoformat(),
        "call_id": result.call_id,
        "grade": result.grade.value,
        "reasons": list(redact_all(result.reasons)),
        "requirement": _requirement_payload(result.requirement),
        "conflicts": [_conflict_payload(c) for c in result.conflicts],
        "evidence_quotes": list(redact_all(result.evidence_quotes)),
        "goes_in_pack": result.goes_in_pack,
        "needs_executor": result.needs_executor,
        "closes_account": result.closes_account,
        "accepts_terms": result.accepts_terms,
        "task_text": redact(plan.task_text),
    }


def estate_payload() -> dict:
    estate = registry.ESTATE
    return {
        "estate_id": estate.estate_id,
        "deceased_name": estate.deceased_name,
        "executor_name": estate.executor_name,
        "reference": estate.reference,
        "disclosure_budget": list(estate.disclosable),
        "withheld_count": len(estate.withheld),
        "institutions": [
            {
                "institution_id": i.institution_id,
                "institution": i.name,
                "kind": i.kind.value,
                "masked_phone": i.masked_phone(),
                "has_recorded_policy": i.recorded_policy is not None,
                "policy_source": i.recorded_policy.source if i.recorded_policy else "",
                "prior_calls": len(registry.priors(i.institution_id)),
                "scenario": demo.INSTITUTION_SCENARIOS.get(i.institution_id, "captured"),
            }
            for i in registry.INSTITUTIONS
        ],
        "scenarios": demo.SCENARIOS,
    }


def _capture_once(
    institution: Institution, scenario: str | None
) -> tuple[Plan, CaptureResult, dict, str]:
    """Run one scripted call through the real path, exactly once."""
    chosen = scenario or demo.INSTITUTION_SCENARIOS.get(
        institution.institution_id, "captured"
    )
    estate = registry.ESTATE
    plan = plan_call(estate, institution)
    scripted = demo.scripted_call(plan, chosen)
    _, result = run_institution(
        estate,
        institution,
        priors=registry.priors(institution.institution_id),
        client=calle.DryRunClient(scripted_result=scripted),
        plan=plan,
    )
    return plan, result, scripted, chosen


def capture_payload(institution_id: str, scenario: str | None) -> dict:
    institution = registry.get(institution_id)
    plan, result, scripted, chosen = _capture_once(institution, scenario)
    payload = _result_payload(institution, plan, result, chosen)
    payload["transcript"] = [
        {"offset_seconds": t.offset_seconds, "speaker": t.speaker, "text": redact(t.text)}
        for t in extract.transcript_turns(scripted)
    ]
    return payload


def pack_payload() -> dict:
    """Every institution, captured once, grouped the way a family reads it.

    The pack counts and groups. It resolves nothing: a disputed requirement is
    still two answers when it reaches the console.
    """
    results: list[CaptureResult] = []
    entries: list[dict] = []
    for institution in registry.INSTITUTIONS:
        plan, result, _scripted, chosen = _capture_once(institution, None)
        results.append(result)
        entries.append(_result_payload(institution, plan, result, chosen))
    pack = Pack(estate=registry.ESTATE, results=tuple(results))
    return {
        "estate_id": registry.ESTATE.estate_id,
        "deceased_name": registry.ESTATE.deceased_name,
        "counts": {grade.value: len(items) for grade, items in pack.by_grade.items()},
        "disputes": [_conflict_payload(c) for c in pack.disputes],
        "outstanding": [
            {
                "institution_id": result.institution_id,
                "institution": registry.get(result.institution_id).name,
                "grade": result.grade.value,
                "captured_at": result.captured_at.isoformat(),
            }
            for result in pack.outstanding
        ],
        "outstanding_count": len(pack.outstanding),
        "entries": entries,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "afterword"

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

        if route == "/api/estate":
            self._json(200, estate_payload())
            return
        if route == "/api/capture":
            institution_id = (query.get("institution") or [""])[0]
            scenario = (query.get("scenario") or [None])[0]
            try:
                self._json(200, capture_payload(institution_id, scenario))
            except KeyError as error:
                self._json(404, {"error": str(error)})
            return
        if route == "/api/pack":
            self._json(200, pack_payload())
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
