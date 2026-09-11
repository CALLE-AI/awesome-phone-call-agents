from __future__ import annotations

from datetime import datetime

from ringdown.calle import CalleError, McpClient
from ringdown.calls import STATUS_MAP
from ringdown.checks import Block, Check
from ringdown.dispositions import ground
from ringdown.escalate import Attempt, LadderResult
from ringdown.extract import extract, minutes_in, normalise
from ringdown.incident import first_name, mask_phone


def inside(completed_at: str | None, window: tuple[datetime, datetime]) -> bool:
    if not completed_at:
        return False
    try:
        moment = datetime.fromisoformat(completed_at)
    except ValueError:
        return False
    if moment.tzinfo is None:
        return False
    return window[0] <= moment <= window[1]


SAME_RUN = "the second channel serves the same run"
ACK_HOLDS = "the acknowledgement holds"
NO_ACK = "the run reports no acknowledgement"


def ack_checks(
    mcp: McpClient, attempt: Attempt, window: tuple[datetime, datetime], prefix: str
) -> list[Block]:
    contact = attempt.rung.contact
    returned = f"second channel returned a run for call {attempt.call_id}"
    try:
        run = mcp.get_call_run(attempt.call_id)
    except CalleError as error:
        return [(f"{prefix}: {SAME_RUN}", [(None, f"{returned} ({error.code})")])]
    extraction = attempt.extraction
    grounded = ground(extraction, run.turns)
    same_run: list[Check] = [
        (True, returned),
        (run.call_id == attempt.call_id, f"run reports call id {attempt.call_id}"),
        (
            run.metadata.get("ringdown_attempt_id") == attempt.attempt_id,
            f"run echoes the attempt id {attempt.attempt_id} we sent",
        ),
        (
            run.recipient_phone == contact.phone,
            f"run reached {contact.name} at {mask_phone(contact.phone)}",
        ),
        (
            STATUS_MAP.get(run.status) == attempt.snapshot.status,
            f"run status {run.status} maps to the recorded {attempt.snapshot.status}",
        ),
        (inside(run.completed_at, window), "the run finished inside the escalation window"),
    ]
    ack_holds: list[Check] = [
        (
            extract(run.turns).disposition == "acknowledged",
            "re-extracting the second channel transcript gives disposition acknowledged",
        ),
        (grounded.disposition, "the recorded disposition span is spoken by the recipient"),
        (
            grounded.owner and first_name(contact) in normalise(extraction.owner_span),
            f"the recorded owner {contact.name} is spoken by the recipient",
        ),
        (
            grounded.eta and minutes_in(extraction.eta_span) == extraction.eta_minutes,
            f"the recorded ETA of {extraction.eta_minutes} minutes is spoken by the recipient",
        ),
    ]
    return [(f"{prefix}: {SAME_RUN}", same_run), (f"{prefix}: {ACK_HOLDS}", ack_holds)]


def no_ack_checks(mcp: McpClient, attempt: Attempt, prefix: str) -> list[Block]:
    title = f"{prefix}: {NO_ACK}"
    label = f"run for {attempt.rung.contact.name} reports no acknowledgement"
    try:
        run = mcp.get_call_run(attempt.call_id)
    except CalleError as error:
        return [(title, [(None, f"{label} ({error.code})")])]
    re_extracted = extract(run.turns)
    committed = re_extracted.disposition == "acknowledged" and re_extracted.eta_minutes is not None
    return [(title, [(not committed, label)])]


def verify_ladder(
    mcp: McpClient,
    incident_id: str,
    result: LadderResult,
    window: tuple[datetime, datetime],
) -> list[Block]:
    blocks: list[Block] = []
    for position, attempt in enumerate(result.attempts, 1):
        if attempt.verdict == "unknown" or attempt.call_id is None:
            continue
        prefix = (
            f"Verification of {incident_id} attempt {position} "
            f"({attempt.rung.contact.id}) on the second channel"
        )
        blocks.extend(
            ack_checks(mcp, attempt, window, prefix)
            if attempt.verdict == "acknowledged"
            else no_ack_checks(mcp, attempt, prefix)
        )
    return blocks


