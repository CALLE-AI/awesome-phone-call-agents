"""Incident brief generation — the artifact a human responder receives."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .schemas import TripPlan, mask_phone

Call = dict[str, Any]


@dataclass
class CallRecord:
    at: str  # HH:MM display label
    kind: str  # "checkin" | "escalation"
    party: str  # who was called
    phone: str
    call: Call


def build_incident_brief(
    plan: TripPlan,
    timeline: list[tuple[str, str, str]],  # (at, label, level)
    records: list[CallRecord],
    status_line: str,
    demo: bool,
) -> str:
    lines: list[str] = []
    add = lines.append
    add(f"# FieldLine incident brief — {plan.label}")
    add("")
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    mode = "DEMO (simulated calls)" if demo else "LIVE"
    add(f"Generated {stamp} · mode: {mode}")
    add("")
    add(f"**Status:** {status_line}")
    add("")
    add("## Situation")
    add("")
    add(f"- Worker: **{plan.worker.name}** ({plan.worker.role}), {mask_phone(plan.worker.phone)}")
    add(f"- Trip: {plan.label} — {plan.site}")
    add(f"- Window: {plan.date} {plan.start}–{plan.end}; check-ins at {', '.join(plan.checkins)}")
    if plan.vehicle:
        add(f"- Vehicle: {plan.vehicle}")
    add(
        "- Escalation ladder: "
        + " → ".join(f"{c.name} ({c.relation}, {mask_phone(c.phone)})" for c in plan.escalation)
    )
    add("")
    add("## Timeline")
    add("")
    add("| Time | Event |")
    add("|---|---|")
    for at, label, _level in timeline:
        add(f"| {at} | {label} |")
    add("")
    add("## Calls")
    for rec in records:
        add("")
        add(f"### {rec.at} — {rec.kind}: {rec.party} ({mask_phone(rec.phone)})")
        add("")
        call = rec.call
        if call.get("summary"):
            add(f"*{call['summary']}*")
            add("")
        turns = [
            turn
            for recipient in call.get("recipients") or []
            for attempt in recipient.get("attempts") or []
            for turn in attempt.get("transcript_turns") or []
        ]
        if turns:
            for turn in turns:
                who = "agent" if turn.get("speaker") == "bot" else rec.party.lower()
                add(f"> **{who}:** {turn.get('text', '')}")
            add("")
        sr = call.get("structured_result")
        if isinstance(sr, dict):
            add("Structured result:")
            add("")
            for key, value in sr.items():
                if value not in (None, ""):
                    add(f"- `{key}`: {value}")
            add("")
        for ev in call.get("evidence") or []:
            add(f"- evidence: {ev}")
    add("")
    add("## Recommended actions")
    add("")
    if plan.emergency_note:
        add(f"- {plan.emergency_note}")
    add("- If the worker makes contact, have them call the FieldLine check-in line to stand the incident down.")
    add("- FieldLine never dials emergency services; a human must make that call.")
    add("")
    return "\n".join(lines)


def write_incident_brief(text: str, home: Path) -> Path:
    reports_dir = home / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"incident-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    path.write_text(text, encoding="utf-8")
    return path
