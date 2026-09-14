"""Text rendering. Phone numbers are masked everywhere, without exception."""

from __future__ import annotations

import json
from pathlib import Path

from .decide import CALLING_ACTIONS
from .workflow import Row

FIXTURE_BANNER = (
    "FIXTURE RUN -- SIMULATED, NO CALL PLACED\n"
    "No network, no telephone, no credentials. Responses come from the fixture file."
)

PREVIEW_BANNER = "PREVIEW -- NO CALL PLACED\nThis is the plan only. Nothing was dialled."

LIVE_BANNER = "LIVE RUN -- REAL PHONE CALLS WERE PLACED"


def render(rows: list[Row], *, banner: str, course_id: str, today: str) -> str:
    lines = [banner, "", f"Course: {course_id}    as of: {today}", ""]

    for index, row in enumerate(rows, start=1):
        head = f"{index}. {row.patient_id}  {row.masked_phone}  ->  {row.trajectory} / {row.action}"
        lines.append(head)
        lines.append(f"     why: {row.reason}")

        signals = row.signals or {}
        lines.append(
            "     signals: attended={attended} missed={missed} consecutive={consecutive_missed} "
            "last4_missed={missed_in_last_four} days_since_attended={days_since_last_attended} "
            "calls={calls_made}".format(**signals)
        )

        if row.evidence_summary:
            for i, line in enumerate(_wrap(row.evidence_summary, 62)):
                lines.append(f"     {'said:' if i == 0 else '     '} {line}")
        if row.concession_spent:
            lines.append(f"     offered: {row.concession_spent}")
        if row.recommendation and row.recommendation != "no action needed":
            lines.append(f"     NEXT: {row.recommendation}")
        if row.blockers:
            lines.append(f"     BLOCKED: {', '.join(row.blockers)} -- no call placed")
        if row.called:
            if row.replayed:
                lines.append(
                    "     *** NO CALL PLACED — this is a replay of an earlier call with the"
                )
                lines.append(
                    "         same idempotency key. Log the previous attempt in contact_log,"
                )
                lines.append(
                    "         or change the plan, to place a genuinely new call. ***"
                )
            lines.append(f"     result: status={row.status} outcome={row.outcome}")
            if row.promised_date:
                lines.append(f"     booked: {row.promised_date}")
            if row.note:
                lines.append(f"     note: {row.note}")
            if row.outcome == "unknown_possibly_placed":
                lines.append("     *** OUTCOME UNKNOWN — A CALL MAY HAVE BEEN PLACED ***")
                lines.append("         The run stopped here. Reconcile by hand; an interruption")
                lines.append("         cannot recall a call the provider already accepted.")
            elif row.outcome == "identity_unconfirmed":
                lines.append("     >>> SLOT TAKEN BUT IDENTITY UNCONFIRMED -- a clinician must verify")
            elif row.escalate_to_clinician:
                lines.append("     >>> ESCALATED TO CLINICIAN -- not rebooked by this application")
        elif row.outcome == "call_failed":
            lines.append(f"     call failed: {row.note}")
        lines.append("")

    called = sum(1 for row in rows if row.called)
    eligible = sum(1 for row in rows if row.action in CALLING_ACTIONS and not row.blockers)
    blocked = sum(1 for row in rows if row.blockers)
    # Escalation happens two ways: the trajectory decided it before any call, or a
    # call result forced it. Both are escalations and both must be counted.
    escalated = sum(
        1 for row in rows if row.escalate_to_clinician or row.action == "escalate_to_clinician"
    )
    no_action = sum(1 for row in rows if row.action in {"no_action", "skip"})
    stopped = sum(1 for row in rows if row.action == "stop_contact")

    verb = f"{called} called" if called else f"{eligible} would be called"
    lines.append(
        f"{len(rows)} patients: {verb}, {blocked} blocked by the gate, "
        f"{escalated} escalated to a clinician, {stopped} contact stopped, {no_action} needed nothing."
    )
    return "\n".join(lines)


def render_transcript(row: Row, *, width: int = 72) -> str:
    """Render one call as turns.

    CALL-E returns the conversation speaker-tagged, so the whole exchange can be
    shown as text. Nothing here needs audio, and nothing here needs the call to
    still be running.
    """
    turns = row.transcript or []
    if not turns:
        return f"{row.patient_id}: no transcript returned (status={row.status})"

    lines = [
        f"CALL  {row.patient_id}  {row.masked_phone}  [{row.trajectory} / {row.action}]",
        "-" * width,
    ]
    for turn in turns:
        who = {"BOT": "agent  ", "USER": "patient", "OTHER": "other  "}.get(turn["speaker"], "other  ")
        stamp = f"{turn['ts']:>8}  " if turn.get("ts") else ""
        body = _wrap(turn["text"], width - len(stamp) - 9)
        lines.append(f"{stamp}{who}  {body[0]}")
        pad = " " * (len(stamp) + 9)
        lines.extend(f"{pad}{line}" for line in body[1:])
    lines.append("-" * width)
    lines.append(f"outcome: {row.outcome}    status: {row.status}")
    if row.escalate_to_clinician:
        lines.append(">>> ESCALATED TO CLINICIAN -- not rebooked by this application")
    return "\n".join(lines)


def _wrap(text: str, width: int) -> list[str]:
    if width < 20:
        width = 20
    words, lines, current = text.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines or [""]


def write_jsonl(path: Path, rows: list[Row]) -> None:
    """Durable output, one JSON object per patient. Never contains a full phone
    number, because `Row` only ever carries the masked form."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row.to_dict(), sort_keys=True) + "\n")
