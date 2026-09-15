from datetime import datetime

from app.models.orm import (
    DiseaseProtocol,
    ProtocolEmergencyKeyword,
    ProtocolQuestion,
    ProtocolResultField,
    ProtocolResultFieldEnum,
)
from app.models.schemas import DiseaseProtocolCreate, DiseaseProtocolUpdate
from sqlalchemy.orm import Session, selectinload


class ProtocolRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_active(self) -> list[DiseaseProtocol]:
        return (
            self.db.query(DiseaseProtocol)
            .filter(DiseaseProtocol.is_active.is_(True))
            .order_by(DiseaseProtocol.name.asc())
            .all()
        )

    def get_by_id(self, protocol_id: int) -> DiseaseProtocol | None:
        return (
            self.db.query(DiseaseProtocol)
            .options(
                selectinload(DiseaseProtocol.questions),
                selectinload(DiseaseProtocol.emergency_keywords),
                selectinload(DiseaseProtocol.result_fields).selectinload(
                    ProtocolResultField.enums
                ),
            )
            .filter(DiseaseProtocol.id == protocol_id)
            .first()
        )

    def get_by_code(self, code: str) -> DiseaseProtocol | None:
        return (
            self.db.query(DiseaseProtocol)
            .filter(DiseaseProtocol.code == code)
            .first()
        )

    def get_active_by_id(self, protocol_id: int) -> DiseaseProtocol | None:
        protocol = self.get_by_id(protocol_id)
        if protocol is None or not protocol.is_active:
            return None
        return protocol

    def create(self, payload: DiseaseProtocolCreate) -> DiseaseProtocol:
        protocol = DiseaseProtocol(
            code=payload.code.strip(),
            name=payload.name.strip(),
            description=(payload.description.strip() if payload.description else None),
            needs_followup_default=payload.needs_followup_default,
            is_active=payload.is_active,
        )
        self._replace_nested(protocol, payload)
        self.db.add(protocol)
        self.db.commit()
        self.db.refresh(protocol)
        return self.get_by_id(protocol.id) or protocol

    def update(
        self, protocol_id: int, payload: DiseaseProtocolUpdate
    ) -> DiseaseProtocol | None:
        protocol = self.get_by_id(protocol_id)
        if protocol is None:
            return None

        protocol.name = payload.name.strip()
        protocol.description = (
            payload.description.strip() if payload.description else None
        )
        protocol.needs_followup_default = payload.needs_followup_default
        protocol.is_active = payload.is_active
        protocol.updated_at = datetime.utcnow()

        protocol.questions.clear()
        protocol.emergency_keywords.clear()
        protocol.result_fields.clear()
        self.db.flush()
        self._replace_nested(protocol, payload)

        self.db.commit()
        return self.get_by_id(protocol.id)

    def _replace_nested(
        self,
        protocol: DiseaseProtocol,
        payload: DiseaseProtocolCreate | DiseaseProtocolUpdate,
    ) -> None:
        for i, question in enumerate(payload.questions):
            protocol.questions.append(
                ProtocolQuestion(
                    question_text=question.question_text.strip(),
                    sort_order=question.sort_order if question.sort_order else i,
                    is_required=question.is_required,
                    is_active=True,
                )
            )

        for keyword in payload.emergency_keywords:
            text = keyword.keyword.strip()
            if not text:
                continue
            protocol.emergency_keywords.append(
                ProtocolEmergencyKeyword(keyword=text, is_active=True)
            )

        for i, field in enumerate(payload.result_fields):
            result_field = ProtocolResultField(
                field_key=field.field_key.strip(),
                field_type=field.field_type.strip(),
                description=(
                    field.description.strip() if field.description else None
                ),
                is_required=field.is_required,
                sort_order=field.sort_order if field.sort_order else i,
                minimum=field.minimum,
                maximum=field.maximum,
                is_active=True,
            )
            for j, enum_item in enumerate(field.enums):
                value = enum_item.value.strip()
                if not value:
                    continue
                result_field.enums.append(
                    ProtocolResultFieldEnum(
                        value=value,
                        sort_order=enum_item.sort_order if enum_item.sort_order else j,
                    )
                )
            protocol.result_fields.append(result_field)
