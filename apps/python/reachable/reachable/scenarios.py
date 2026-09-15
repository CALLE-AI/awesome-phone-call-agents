"""Replayable end-to-end scenarios.

A scenario scripts the CALL-E outcomes and the steps to take. Everything else --
the guards, the machines, the binding, the cascade, the exports -- is the real
code path. The only substitution is the transport.

This is the app's no-network deliverable and the backup demo: if live UK routing
is unavailable, the video is recorded against this with the mode banner visible.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from fake_calle.server import FakeCalleClient, FakeCalleState

from .config import Config
from .orchestrator import Orchestrator
from .store import Store


@dataclass
class StepResult:
    action: str
    target: str
    detail: str
    state: str = ""


@dataclass
class ReplayResult:
    name: str
    description: str
    steps: list[StepResult] = field(default_factory=list)
    calls_placed: int = 0
    refusals: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


def load(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def available(root: Path) -> list[Path]:
    return sorted((root / "scenarios").glob("*.json"))


def replay(
    scenario: dict[str, Any],
    *,
    app_root: Path,
    store: Store | None = None,
    orchestrator: Orchestrator | None = None,
) -> ReplayResult:
    """Run one scenario end to end. No network, no credentials."""
    result = ReplayResult(
        name=scenario.get("name", "scenario"),
        description=scenario.get("description", ""),
    )

    if orchestrator is None:
        env = {
            "REACHABLE_DATA_DIR": str(app_root / "sample_data"),
            "REACHABLE_CALLE_BASE_URL": "http://127.0.0.1:8787",
            "REACHABLE_LIVE_CALLS": "1",
            "REACHABLE_TERM_ID": "2026-autumn",
            **(scenario.get("config") or {}),
        }
        moment = datetime.fromisoformat(
            scenario.get("clock", "2026-09-11T10:30:00+01:00")
        )
        state = FakeCalleState()
        orchestrator = Orchestrator(
            store=store or Store.open(":memory:"),
            config=Config.from_env(env),
            client=FakeCalleClient(state),
            clock=lambda: moment,
        )
    else:
        state = orchestrator.client.state  # type: ignore[attr-defined]

    orc = orchestrator

    for step in scenario.get("steps", []):
        action = step.get("action", "")
        target = str(step.get("case", step.get("term", "")))
        detail = ""

        if action == "import":
            report = orc.import_data()
            detail = report.summary()

        elif action == "contact_check":
            created = orc.start_contact_check()
            detail = f"{len(created)} contact-check case(s) opened"

        elif action == "scan":
            created = orc.scan_register()
            detail = f"{len(created)} trigger(s) detected"

        elif action == "call":
            case_id = step["case"]
            script = step.get("script", "clean_identity")
            try:
                request, *_ = orc.build_request(case_id)
            except Exception as exc:  # noqa: BLE001 - reported, not raised
                result.steps.append(StepResult(action, case_id, f"could not render: {exc}"))
                continue
            state.queue(request.idempotency_key, script)
            outcome = orc.place_call(case_id, confirmed=True, actor="replay")
            if outcome.placed:
                result.calls_placed += 1
                classification = orc.reconcile(outcome.attempt_id)
                detail = (
                    f"{script} -> {classification.disposition.value}"
                    if classification
                    else script
                )
            else:
                reason = outcome.reason.value if outcome.reason else "refused"
                result.refusals.append(reason)
                detail = f"not placed: {reason}"

        elif action == "approve_reason":
            orc.approve_suggested_reason(step["case"], actor="replay")
            detail = "suggestion approved by staff"

        elif action == "resolve":
            orc.staff_resolve(step["case"], step["target"], actor="replay")
            detail = f"staff moved case to {step['target']}"

        else:
            detail = f"unknown action {action!r}"

        state_now = ""
        if target:
            row = orc.store.case(target)
            state_now = row["state"] if row else ""
        result.steps.append(StepResult(action, target, detail, state_now))

    _check(scenario, orc, result)
    return result


def _check(scenario: dict[str, Any], orc: Orchestrator, result: ReplayResult) -> None:
    """Assert the scenario's documented expectations."""
    expect = scenario.get("expect") or {}

    for case_id, want in (expect.get("cases") or {}).items():
        row = orc.store.case(case_id)
        got = row["state"] if row else "(missing)"
        if got != want:
            result.failures.append(f"case {case_id}: expected {want}, got {got}")

    for contact_id, want in (expect.get("contact_health") or {}).items():
        row = orc.store.health_for(contact_id)
        got = row["status"] if row else "(missing)"
        if got != want:
            result.failures.append(f"contact {contact_id}: expected {want}, got {got}")

    for reason in expect.get("decisions") or []:
        if reason not in {d["reason"] for d in orc.store.decisions()}:
            result.failures.append(f"expected a decision not to call: {reason}")

    for kind in expect.get("tasks") or []:
        if kind not in {t["kind"] for t in orc.store.tasks()}:
            result.failures.append(f"expected a staff task of kind {kind}")

    if "calls_placed" in expect and result.calls_placed != expect["calls_placed"]:
        result.failures.append(
            f"expected {expect['calls_placed']} call(s), placed {result.calls_placed}"
        )

    for contact_id in expect.get("never_called") or []:
        rows = orc.store.rows(
            "SELECT 1 FROM call_attempts WHERE contact_id = ?", (contact_id,)
        )
        if rows:
            result.failures.append(f"contact {contact_id} was called and must not be")
