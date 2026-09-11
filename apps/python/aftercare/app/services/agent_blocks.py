from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.schemas import (
    AgentAmbiguousPatientsBlock,
    AgentBlock,
    AgentCallItem,
    AgentCallSearchBlock,
    AgentCallSearchItem,
    AgentEmergencyListBlock,
    AgentKpiGridBlock,
    AgentKpiItem,
    AgentNoticeBlock,
    AgentPatientDetailBlock,
    AgentPatientDetailItem,
    AgentPatientListItem,
    AgentPatientSearchBlock,
    AgentPatientSearchItem,
    AgentPatientTableBlock,
    AgentSymptomItem,
)

MAX_BLOCK_ITEMS = 25

BLOCK_ORDER = {
    "kpi_grid": 0,
    "patient_table": 1,
    "emergency_list": 2,
    "patient_search_results": 3,
    "call_search_results": 4,
    "ambiguous_patients": 5,
    "patient_detail": 6,
    "notice": 7,
}


@dataclass(frozen=True)
class AgentToolEvent:
    name: str
    result: dict[str, Any]


def _patient_list_item(raw: dict[str, Any]) -> AgentPatientListItem:
    patient_id = raw.get("patient_id", raw.get("id"))
    return AgentPatientListItem(
        patient_id=int(patient_id),
        name=raw.get("name") or raw.get("patient_name"),
        risk_level=raw.get("risk_level"),
        protocol=raw.get("protocol"),
        doctor_name=raw.get("doctor_name"),
        discharge_date=raw.get("discharge_date"),
        needs_followup=raw.get("needs_followup"),
    )


def _symptom_items(raw: Any) -> list[AgentSymptomItem]:
    if not isinstance(raw, list):
        return []

    symptoms: list[AgentSymptomItem] = []
    for item in raw:
        if isinstance(item, str):
            symptoms.append(AgentSymptomItem(name=item))
        elif isinstance(item, dict) and item.get("name"):
            symptoms.append(
                AgentSymptomItem(
                    name=str(item["name"]),
                    severity=item.get("severity"),
                )
            )
    return symptoms


def _call_item(raw: dict[str, Any]) -> AgentCallItem:
    call_id = raw.get("call_id", raw.get("id"))
    return AgentCallItem(
        call_id=int(call_id),
        patient_id=raw.get("patient_id"),
        patient_name=raw.get("patient_name"),
        status=raw.get("status"),
        risk_level=raw.get("risk_level"),
        is_emergency=raw.get("is_emergency"),
        call_start=raw.get("call_start"),
        symptoms=_symptom_items(raw.get("symptoms")),
    )


def _overview_block(result: dict[str, Any]) -> AgentKpiGridBlock:
    items = [
        AgentKpiItem(
            key="total_patients",
            label="Total patients",
            value=int(result.get("total_patients") or 0),
        ),
        AgentKpiItem(
            key="patients_needing_followup",
            label="Need follow-up",
            value=int(result.get("patients_needing_followup") or 0),
        ),
        AgentKpiItem(
            key="emergency_calls",
            label="Emergency calls",
            value=int(result.get("emergency_calls") or 0),
        ),
        AgentKpiItem(
            key="overdue_followups",
            label="Overdue follow-ups",
            value=int(result.get("overdue_followups") or 0),
        ),
        AgentKpiItem(
            key="pending_calls",
            label="Pending calls",
            value=int(result.get("pending_calls") or 0),
        ),
    ]
    risk_counts = result.get("patients_by_risk")
    if isinstance(risk_counts, dict):
        for level, count in sorted(risk_counts.items()):
            items.append(
                AgentKpiItem(
                    key=f"risk_{level}",
                    label=f"{str(level).title()} risk",
                    value=int(count or 0),
                )
            )
    return AgentKpiGridBlock(title="Clinic overview", items=items)


def _discharge_block(result: dict[str, Any]) -> AgentPatientTableBlock:
    rows = result.get("patients")
    patients = rows if isinstance(rows, list) else []
    days = int(result.get("days") or 0)
    count = int(result.get("count") or len(patients))
    if count == 0:
        description = f"No patients discharged in the last {days} days"
    else:
        description = f"Discharged in the last {days} days"
        if count > MAX_BLOCK_ITEMS:
            description += f" · Showing {MAX_BLOCK_ITEMS} of {count}"
    return AgentPatientTableBlock(
        title="Recent discharges",
        description=description,
        count=count,
        items=[
            _patient_list_item(item)
            for item in patients[:MAX_BLOCK_ITEMS]
            if isinstance(item, dict) and item.get("id") is not None
        ],
    )


def _risk_block(result: dict[str, Any]) -> AgentPatientTableBlock:
    rows = result.get("patients")
    patients = rows if isinstance(rows, list) else []
    level = str(result.get("risk_level") or "unknown")
    count = int(result.get("count") or len(patients))
    description = (
        f"No patients currently classified as {level} risk"
        if count == 0
        else f"Patients currently classified as {level} risk"
    )
    return AgentPatientTableBlock(
        title=f"{level.title()} risk patients",
        description=description,
        count=count,
        items=[
            _patient_list_item(item)
            for item in patients[:MAX_BLOCK_ITEMS]
            if isinstance(item, dict) and item.get("id") is not None
        ],
    )


def _list_patients_block(result: dict[str, Any]) -> AgentPatientTableBlock:
    rows = result.get("patients")
    patients = rows if isinstance(rows, list) else []
    count = int(result.get("count") or len(patients))
    description = (
        "No patients on file"
        if count == 0
        else f"{count} patient{'s' if count != 1 else ''} on file"
    )
    if count > MAX_BLOCK_ITEMS:
        description += f" · Showing {MAX_BLOCK_ITEMS} of {count}"
    return AgentPatientTableBlock(
        title="Patients",
        description=description,
        count=count,
        items=[
            _patient_list_item(item)
            for item in patients[:MAX_BLOCK_ITEMS]
            if isinstance(item, dict) and item.get("id") is not None
        ],
    )


def _overdue_block(result: dict[str, Any]) -> AgentPatientTableBlock:
    rows = result.get("patients")
    patients = rows if isinstance(rows, list) else []
    count = int(result.get("count") or len(patients))
    if count == 0:
        description = "No overdue follow-ups"
    else:
        description = (
            f"{count} follow-up{'s' if count != 1 else ''} past scheduled time"
        )
        if count > MAX_BLOCK_ITEMS:
            description += f" · Showing {MAX_BLOCK_ITEMS} of {count}"
    return AgentPatientTableBlock(
        title="Overdue follow-ups",
        description=description,
        count=count,
        items=[
            _patient_list_item(item)
            for item in patients[:MAX_BLOCK_ITEMS]
            if isinstance(item, dict) and item.get("id") is not None
        ],
    )


def _patient_detail_blocks(result: dict[str, Any]) -> list[AgentBlock]:
    query = str(result.get("query") or "")
    if result.get("ambiguous") is True:
        raw_candidates = result.get("candidates")
        candidates = raw_candidates if isinstance(raw_candidates, list) else []
        return [
            AgentAmbiguousPatientsBlock(
                title="Choose a patient",
                query=query,
                count=int(result.get("match_count") or len(candidates)),
                message=str(
                    result.get("message")
                    or "Multiple patients match this name. Choose a patient ID."
                ),
                candidates=[
                    _patient_list_item(item)
                    for item in candidates[:MAX_BLOCK_ITEMS]
                    if isinstance(item, dict) and item.get("id") is not None
                ],
            )
        ]

    if result.get("found") is not True:
        return [
            AgentNoticeBlock(
                title="Patient not found",
                message=f'No patient matched "{query}".',
                tone="warning",
            )
        ]

    raw_patient = result.get("patient")
    if not isinstance(raw_patient, dict) or raw_patient.get("id") is None:
        return [
            AgentNoticeBlock(
                title="Patient record unavailable",
                message="The patient result did not include a valid record.",
                tone="warning",
            )
        ]

    raw_calls = result.get("recent_calls")
    calls = raw_calls if isinstance(raw_calls, list) else []
    patient = AgentPatientDetailItem(
        patient_id=int(raw_patient["id"]),
        name=str(raw_patient.get("name") or "Unknown patient"),
        phone_masked=raw_patient.get("phone_masked"),
        age=raw_patient.get("age"),
        gender=raw_patient.get("gender"),
        doctor_name=raw_patient.get("doctor_name"),
        discharge_date=raw_patient.get("discharge_date"),
        risk_level=raw_patient.get("risk_level"),
        needs_followup=raw_patient.get("needs_followup"),
        consent_on_file=raw_patient.get("consent_on_file"),
        protocol=raw_patient.get("protocol"),
    )
    return [
        AgentPatientDetailBlock(
            title=patient.name,
            patient=patient,
            recent_calls=[
                _call_item(item)
                for item in calls[:5]
                if isinstance(item, dict)
                and item.get("id", item.get("call_id")) is not None
            ],
        )
    ]


def _emergency_block(result: dict[str, Any]) -> AgentEmergencyListBlock:
    raw_items = result.get("emergencies")
    emergencies = raw_items if isinstance(raw_items, list) else []
    return AgentEmergencyListBlock(
        title="Emergency patients",
        count=int(result.get("count") or len(emergencies)),
        items=[
            _call_item(item)
            for item in emergencies[:MAX_BLOCK_ITEMS]
            if isinstance(item, dict)
            and item.get("call_id", item.get("id")) is not None
        ],
    )


def _patient_search_blocks(result: dict[str, Any]) -> list[AgentBlock]:
    query = str(result.get("query") or "")
    if result.get("unavailable") is True:
        return [
            AgentNoticeBlock(
                title="Patient search unavailable",
                message=str(result.get("reason") or "Patient search is not available right now."),
                tone="warning",
            )
        ]

    raw_items = result.get("results")
    rows = raw_items if isinstance(raw_items, list) else []
    return [
        AgentPatientSearchBlock(
            title="Patient search results",
            query=query,
            unavailable=False,
            reason=None,
            items=[
                AgentPatientSearchItem(
                    **_patient_list_item(item).model_dump(),
                    context_text=str(item.get("context_text") or ""),
                    distance=float(item.get("distance") or 0),
                )
                for item in rows[:MAX_BLOCK_ITEMS]
                if isinstance(item, dict) and item.get("patient_id") is not None
            ],
        )
    ]


def _call_search_blocks(result: dict[str, Any]) -> list[AgentBlock]:
    query = str(result.get("query") or "")
    if result.get("unavailable") is True:
        return [
            AgentNoticeBlock(
                title="Call search unavailable",
                message=str(result.get("reason") or "Call transcript search is not available right now."),
                tone="warning",
            )
        ]

    raw_items = result.get("results")
    rows = raw_items if isinstance(raw_items, list) else []
    return [
        AgentCallSearchBlock(
            title="Call search results",
            query=query,
            unavailable=False,
            reason=None,
            items=[
                AgentCallSearchItem(
                    **_call_item(item).model_dump(),
                    context_text=str(item.get("context_text") or ""),
                    distance=float(item.get("distance") or 0),
                )
                for item in rows[:MAX_BLOCK_ITEMS]
                if isinstance(item, dict) and item.get("call_id") is not None
            ],
        )
    ]


def build_agent_blocks(events: list[AgentToolEvent]) -> list[AgentBlock]:
    """Convert trusted repository results into stable, typed UI blocks."""
    blocks: list[AgentBlock] = []
    for event in events:
        if event.name == "get_clinic_overview":
            blocks.append(_overview_block(event.result))
        elif event.name == "get_discharge_stats":
            blocks.append(_discharge_block(event.result))
        elif event.name == "get_patients_by_risk":
            blocks.append(_risk_block(event.result))
        elif event.name == "list_patients":
            blocks.append(_list_patients_block(event.result))
        elif event.name == "get_patient_detail":
            blocks.extend(_patient_detail_blocks(event.result))
        elif event.name == "get_emergency_patients":
            blocks.append(_emergency_block(event.result))
        elif event.name == "get_overdue_followups":
            blocks.append(_overdue_block(event.result))
        elif event.name == "search_patients_semantic":
            blocks.extend(_patient_search_blocks(event.result))
        elif event.name == "search_call_transcripts":
            blocks.extend(_call_search_blocks(event.result))

    return sorted(
        blocks,
        key=lambda block: BLOCK_ORDER.get(block.type, 99),
    )
