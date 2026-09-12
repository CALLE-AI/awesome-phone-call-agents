from __future__ import annotations

import re
from typing import Any, Mapping

from ringdown.canonical import digest
from ringdown.incident import Incident, Rung

RUNBOOK_LINE = "- If they ask where the runbook is, read out: {runbook_url}"

QUOTE = re.compile(r"[\"\u201c\u201d]")


def as_quoted_data(text: str) -> str:
    return QUOTE.sub("'", text)


def call_task(incident: Incident, rung: Rung) -> str:
    runbook = RUNBOOK_LINE.format(runbook_url=incident.runbook_url) if incident.runbook_url else ""
    return incident.script.format(
        name=rung.contact.name,
        severity=incident.severity,
        service=as_quoted_data(incident.service),
        title=as_quoted_data(incident.title),
        summary=as_quoted_data(incident.summary),
        runbook=runbook,
    )


def attempt_id(incident: Incident, rung: Rung) -> str:
    return f"{incident.id}/{rung.scope}/1"


def call_metadata(incident: Incident, rung: Rung) -> dict[str, str]:
    return {
        "ringdown_attempt_id": attempt_id(incident, rung),
        "ringdown_incident_id": incident.id,
        "ringdown_contact_id": rung.contact.id,
    }


def call_payload(incident: Incident, rung: Rung) -> dict[str, Any]:
    return {
        "task": call_task(incident, rung),
        "recipients": [{"phones": [rung.contact.phone]}],
        "metadata": call_metadata(incident, rung),
    }


def idempotency_key(payload: Mapping[str, Any]) -> str:
    attempt = payload["metadata"]["ringdown_attempt_id"]
    slug = re.sub(r"[^a-z0-9]+", "-", attempt.lower()).strip("-")
    return f"rd-{slug}-{digest(payload)[7:19]}"
