from __future__ import annotations

from typing import Any

from app.models.orm import DiseaseProtocol, Patient
from app.models.schemas import (
    DiseaseProtocolCreate,
    DiseaseProtocolDetail,
    DiseaseProtocolUpdate,
)
from app.repositories.protocol_repository import ProtocolRepository

ALLOWED_FIELD_TYPES = {"string", "integer", "boolean", "number"}


class ProtocolServiceError(Exception):
    """Domain error for protocol questions"""


class ProtocolService:
    def __init__(self, protocols: ProtocolRepository):
        self.protocols = protocols

    def list_active(self) -> list[DiseaseProtocol]:
        return self.protocols.list_active()

    def get_detail(self, protocol_id: int) -> DiseaseProtocol:
        protocol = self.protocols.get_by_id(protocol_id)
        if not protocol:
            raise ProtocolServiceError("Protocol not found")
        return protocol

    def create(self, payload: DiseaseProtocolCreate) -> DiseaseProtocolDetail:
        code = payload.code.strip()
        if self.protocols.get_by_code(code):
            raise ProtocolServiceError(f"Protocol code already exists: {code}")

        self._validate_nested_payload(payload)
        protocol = self.protocols.create(payload.model_copy(update={"code": code}))
        return DiseaseProtocolDetail.model_validate(protocol).model_copy(
            update={"result_schema_preview": self.build_result_schema(protocol)}
        )

    def update(
        self, protocol_id: int, payload: DiseaseProtocolUpdate
    ) -> DiseaseProtocolDetail:
        if not self.protocols.get_by_id(protocol_id):
            raise ProtocolServiceError("Protocol not found")

        self._validate_nested_payload(payload)
        protocol = self.protocols.update(protocol_id, payload)
        if protocol is None:
            raise ProtocolServiceError("Protocol not found")
        return DiseaseProtocolDetail.model_validate(protocol).model_copy(
            update={"result_schema_preview": self.build_result_schema(protocol)}
        )

    def get_for_patient(self, patient: Patient) -> DiseaseProtocol:
        if not patient.protocol_id:
            raise ProtocolServiceError("Patient has no disease protocol")

        protocol = self.protocols.get_active_by_id(patient.protocol_id)
        if not protocol:
            raise ProtocolServiceError("Patient protocol is missing or inactive")

        self._validate_protocol_ready(protocol)
        return protocol

    def get_emergency_keywords_for_patient(self, patient: Patient) -> list[str]:
        if not patient.protocol_id:
            return []
        protocol = self.protocols.get_active_by_id(patient.protocol_id)
        if not protocol:
            return []
        return self.get_emergency_keywords(protocol)

    def build_result_schema(self, protocol: DiseaseProtocol) -> dict[str, Any]:
        """Build CALL-E result schema JSON from normalized field rows"""
        properties: dict[str, Any] = {}
        required: list[str] = []

        for field in protocol.result_fields:
            if not field.is_active:
                continue

            prop: dict[str, Any] = {"type": field.field_type}

            if field.description:
                prop["description"] = field.description
            if field.minimum is not None:
                prop["minimum"] = field.minimum
            if field.maximum is not None:
                prop["maximum"] = field.maximum

            enum_values = [e.value for e in field.enums]
            if enum_values:
                prop["enum"] = enum_values

            properties[field.field_key] = prop
            if field.is_required:
                required.append(field.field_key)

        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }

    def build_task(self, patient: Patient, protocol: DiseaseProtocol) -> str:
        """Build CALL-E task/prompt for protocol questions"""
        questions = "; ".join(
            q.question_text for q in protocol.questions if q.is_active
        )
        warnings = ", ".join(
            k.keyword for k in protocol.emergency_keywords if k.is_active
        )

        doctor = patient.doctor_name or "their care team"
        discharge = (
            patient.discharge_date.isoformat() if patient.discharge_date else "recently"
        )
        note = (patient.discharge_diagnosis or "").strip()

        return (
            f"Call {patient.phone}. You are a hospital post-discharge follow-up assistant "
            f"calling on behalf of {doctor}. "
            f"Patient name: {patient.name}. Discharged on {discharge} after {protocol.name}. "
            f"{f'Extra clinical note: {note}. ' if note else ''}"
            f"Ask about: {questions}. "
            f"Watch for warning signs such as: {warnings}. "
            "If warning signs are reported, advise urgent care / emergency services and end politely. "
            "Do not diagnose or prescribe. Keep under 3 minutes."
        )

    def get_emergency_keywords(self, protocol: DiseaseProtocol) -> list[str]:
        return [k.keyword for k in protocol.emergency_keywords if k.is_active]

    def get_detail_response(self, protocol_id: int) -> DiseaseProtocolDetail:
        protocol = self.get_detail(protocol_id)
        return DiseaseProtocolDetail.model_validate(protocol).model_copy(
            update={"result_schema_preview": self.build_result_schema(protocol)}
        )

    def _validate_nested_payload(
        self, payload: DiseaseProtocolCreate | DiseaseProtocolUpdate
    ) -> None:
        if not any(q.question_text.strip() for q in payload.questions):
            raise ProtocolServiceError("At least one question is required")

        if not any(f.field_key.strip() for f in payload.result_fields):
            raise ProtocolServiceError("At least one result field is required")

        seen_keys: set[str] = set()
        for field in payload.result_fields:
            key = field.field_key.strip()
            if key in seen_keys:
                raise ProtocolServiceError(f"Duplicate result field key: {key}")
            seen_keys.add(key)

            if field.field_type not in ALLOWED_FIELD_TYPES:
                raise ProtocolServiceError(
                    f"Invalid field_type '{field.field_type}' for {key}. "
                    f"Allowed: {', '.join(sorted(ALLOWED_FIELD_TYPES))}"
                )

    def _validate_protocol_ready(self, protocol: DiseaseProtocol) -> None:
        active_questions = [q for q in protocol.questions if q.is_active]
        active_fields = [f for f in protocol.result_fields if f.is_active]

        if not active_questions:
            raise ProtocolServiceError(
                f"Protocol {protocol.code} has no active questions"
            )

        if not active_fields:
            raise ProtocolServiceError(
                f"Protocol {protocol.code} has no active result fields"
            )
