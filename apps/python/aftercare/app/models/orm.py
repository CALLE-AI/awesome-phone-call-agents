from datetime import date, datetime

from app.db import Base
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    age: Mapped[int] = mapped_column(Integer, nullable=True)
    gender: Mapped[str] = mapped_column(String(50), nullable=True)
    doctor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    doctor_contact: Mapped[str | None] = mapped_column(String(32), nullable=True)
    discharge_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    discharge_diagnosis: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_risk_level: Mapped[str | None] = mapped_column(
        String(50), nullable=False, default="low"
    )
    consent_on_file: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    needs_followup: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    protocol_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("disease_protocols.id"), nullable=True
    )
    protocol: Mapped["DiseaseProtocol"] = relationship(back_populates="patients")

    followups: Mapped[list["FollowUp"]] = relationship(
        "FollowUp",
        back_populates="patient",
        cascade="all, delete-orphan",
    )

    calls: Mapped[list["Call"]] = relationship(
        "Call",
        back_populates="patient",
        cascade="all, delete-orphan",
    )
    notifications: Mapped[list["EmergencyNotification"]] = relationship(
        "EmergencyNotification",
        back_populates="patient",
        cascade="all, delete-orphan",
    )
    embedding: Mapped["PatientEmbedding | None"] = relationship(
        "PatientEmbedding",
        back_populates="patient",
        uselist=False,
        cascade="all, delete-orphan",
    )


class FollowUp(Base):
    __tablename__ = "followups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )
    scheduled_time: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    patient: Mapped["Patient"] = relationship("Patient", back_populates="followups")
    calls: Mapped[list["Call"]] = relationship("Call", back_populates="followup")


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )
    followup_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("followups.id"), nullable=True, index=True
    )
    calle_call_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    call_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    call_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="queued")
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_emergency: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    patient: Mapped["Patient"] = relationship("Patient", back_populates="calls")
    followup: Mapped["FollowUp"] = relationship("FollowUp", back_populates="calls")
    symptoms: Mapped[list["Symptom"]] = relationship(
        "Symptom", back_populates="call", cascade="all, delete-orphan"
    )
    embedding: Mapped["CallEmbedding | None"] = relationship(
        "CallEmbedding",
        back_populates="call",
        uselist=False,
        cascade="all, delete-orphan",
    )
    notifications: Mapped[list["EmergencyNotification"]] = relationship(
        "EmergencyNotification",
        back_populates="call",
        cascade="all, delete-orphan",
    )
    webhook_events: Mapped[list["WebhookEvent"]] = relationship(
        "WebhookEvent",
        back_populates="call",
    )


class Symptom(Base):
    __tablename__ = "symptoms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    call_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("calls.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    severity: Mapped[str] = mapped_column(String(50), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    call: Mapped["Call"] = relationship("Call", back_populates="symptoms")


class EmergencyNotification(Base):
    """Outbox for emergency staff alerts (SMS first, then CALL-E warning call).

    Doctor/care-team warning calls are stored here — not in ``calls``, which is
    reserved for patient follow-up conversations.
    """

    __tablename__ = "emergency_notifications"
    __table_args__ = (
        UniqueConstraint("call_id", "channel", name="uq_emergency_notifications_call_channel"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    call_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("calls.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    patient_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    to_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending", index=True
    )
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    message_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    call: Mapped["Call"] = relationship("Call", back_populates="notifications")
    patient: Mapped["Patient"] = relationship("Patient", back_populates="notifications")


class WebhookEvent(Base):
    """Durable idempotency log for inbound CALL-E webhook deliveries."""

    __tablename__ = "webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_id: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    call_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("calls.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending", index=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    call: Mapped["Call | None"] = relationship("Call", back_populates="webhook_events")


class DiseaseProtocol(Base):
    __tablename__ = "disease_protocols"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    needs_followup_default: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    questions: Mapped[list["ProtocolQuestion"]] = relationship(
        back_populates="protocol",
        cascade="all, delete-orphan",
        order_by="ProtocolQuestion.sort_order",
    )
    emergency_keywords: Mapped[list["ProtocolEmergencyKeyword"]] = relationship(
        back_populates="protocol",
        cascade="all, delete-orphan",
    )
    result_fields: Mapped[list["ProtocolResultField"]] = relationship(
        back_populates="protocol",
        cascade="all, delete-orphan",
        order_by="ProtocolResultField.sort_order",
    )
    patients: Mapped[list["Patient"]] = relationship(back_populates="protocol")


class ProtocolQuestion(Base):
    __tablename__ = "protocol_questions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    protocol_id: Mapped[int] = mapped_column(
        ForeignKey("disease_protocols.id", ondelete="CASCADE"), index=True,
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    protocol: Mapped["DiseaseProtocol"] = relationship(back_populates="questions")


class ProtocolEmergencyKeyword(Base):
    __tablename__ = "protocol_emergency_keywords"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    protocol_id: Mapped[int] = mapped_column(
        ForeignKey("disease_protocols.id", ondelete="CASCADE"), index=True
    )
    keyword: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    protocol: Mapped["DiseaseProtocol"] = relationship(
        back_populates="emergency_keywords"
    )


class ProtocolResultField(Base):
    __tablename__ = "protocol_result_fields"
    __table_args__ = (UniqueConstraint("protocol_id", "field_key"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    protocol_id: Mapped[int] = mapped_column(
        ForeignKey("disease_protocols.id", ondelete="CASCADE"), index=True
    )
    field_key: Mapped[str] = mapped_column(String(128), nullable=False)
    field_type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # string|integer|boolean|number
    description: Mapped[str | None] = mapped_column(Text)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    minimum: Mapped[int | None] = mapped_column(Integer, nullable=True)
    maximum: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    protocol: Mapped["DiseaseProtocol"] = relationship(back_populates="result_fields")
    enums: Mapped[list["ProtocolResultFieldEnum"]] = relationship(
        back_populates="field",
        cascade="all, delete-orphan",
        order_by="ProtocolResultFieldEnum.sort_order",
    )


class ProtocolResultFieldEnum(Base):
    __tablename__ = "protocol_result_field_enums"
    __table_args__ = (UniqueConstraint("field_id", "value"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    field_id: Mapped[int] = mapped_column(
        ForeignKey("protocol_result_fields.id"), index=True
    )
    value: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    field: Mapped["ProtocolResultField"] = relationship(back_populates="enums")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )

    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")


class PatientEmbedding(Base):
    __tablename__ = "patient_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    context_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float]] = mapped_column(Vector(384), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    patient: Mapped["Patient"] = relationship("Patient", back_populates="embedding")


class CallEmbedding(Base):
    __tablename__ = "call_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    call_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("calls.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    context_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float]] = mapped_column(Vector(384), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    call: Mapped["Call"] = relationship("Call", back_populates="embedding")
