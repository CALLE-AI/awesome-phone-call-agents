"""What happens the moment a call has been understood, without anyone having to click.

A finished call already opens its deployment case and — through the incident sync loop, every two
seconds — gets a unit proposed. What it did not get was the paperwork and the read-out: the
situation brief sat unwritten until somebody opened the case page, and the ICS-214 activity log
waited for a button in a panel the new console no longer shows. During an incident nobody has a
free hand to press those, so this runs them straight after the call:

1. the situation brief for the call, so the case page has it the instant it is opened;
2. an ICS-214 activity log for the case, so the record exists while the evening is still going.

Dispatch is deliberately not here. The sync loop already proposes a unit within seconds of the
incident opening, and running it from two places would race and propose twice.

Every step is independent and fail-open: a model timeout costs that one artefact, never the call,
the case, or the next step. Each artefact announces itself on the event bus when it lands, so the
console updates live rather than on the next refresh.
"""
from __future__ import annotations

import logging
from typing import Any

from app.events.bus import bus

log = logging.getLogger("buddye.aftercall")


async def run(hazard_id: str, neighbour_id: str, call_id: str | None, incident_id: str | None) -> dict[str, Any]:
    from app.api import cases
    from app.api import incidents as incidents_api
    from app.config import get_settings

    settings = get_settings()
    done: dict[str, Any] = {"brief": False, "activity_log": None}
    bus.publish(hazard_id=hazard_id, neighbour_id=neighbour_id, type="aftercall.started",
                payload={"neighbour_id": neighbour_id, "call_id": call_id, "incident_id": incident_id})

    if call_id:
        try:
            await cases._write_brief(hazard_id, neighbour_id, call_id)  # noqa: SLF001 — publishes case.brief
            done["brief"] = True
        except Exception:  # noqa: BLE001
            log.exception("after-call brief failed for %s", call_id)

    if incident_id:
        try:
            doc = await incidents_api.generate_document_record(
                incidents_api.DocumentIn(form="ICS-214", incident_id=incident_id,
                                         prepared_by=settings.OVERSEER_NAME or settings.BLOCK_CAPTAIN_NAME),
                settings,
            )
            done["activity_log"] = doc.get("id")
        except Exception:  # noqa: BLE001
            log.exception("after-call ICS-214 failed for %s", incident_id)

    bus.publish(hazard_id=hazard_id, neighbour_id=neighbour_id, type="aftercall.finished",
                payload={"neighbour_id": neighbour_id, "call_id": call_id, "incident_id": incident_id, **done})
    return done
