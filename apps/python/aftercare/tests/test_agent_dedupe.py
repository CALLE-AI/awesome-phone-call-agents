from __future__ import annotations

from app.services.agent_blocks import AgentToolEvent
from app.services.agent_service import _dedupe_tool_events


def test_dedupe_collapses_identical_list_patients_results() -> None:
    duplicate = AgentToolEvent(
        "list_patients",
        {"count": 1, "patients": [{"id": 1}]},
    )
    collapsed = _dedupe_tool_events([duplicate, duplicate])
    assert len(collapsed) == 1
    assert collapsed[0].name == "list_patients"


def test_dedupe_keeps_different_tools() -> None:
    listed = AgentToolEvent("list_patients", {"count": 1, "patients": [{"id": 1}]})
    detail = AgentToolEvent("get_patient_detail", {"found": True, "query": "1"})
    mixed = _dedupe_tool_events([listed, detail, listed])
    assert [event.name for event in mixed] == ["list_patients", "get_patient_detail"]
