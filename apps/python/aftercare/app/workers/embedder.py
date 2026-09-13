from datetime import datetime, timezone

from app.core.embeddings import (
    build_call_content,
    build_patient_content,
    embed_text,
)
from app.db import SessionLocal
from app.models.orm import Call, CallEmbedding, Patient, PatientEmbedding
from sqlalchemy.orm import Session, joinedload


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def upsert_patient_embedding(db: Session, patient: Patient) -> None:
    text = build_patient_content(patient)
    vector = embed_text(text)
    if not vector:
        return

    row = (
        db.query(PatientEmbedding)
        .filter(PatientEmbedding.patient_id == patient.id)
        .one_or_none()
    )
    if row is None:
        row = PatientEmbedding(patient_id=patient.id)
        db.add(row)

    row.context_text = text
    row.embedding = vector
    row.updated_at = _utcnow()
    db.commit()


def upsert_call_embedding(db: Session, call: Call) -> None:
    text = build_call_content(call)
    vector = embed_text(text)
    if not vector:
        return

    row = (
        db.query(CallEmbedding)
        .filter(CallEmbedding.call_id == call.id)
        .one_or_none()
    )
    if row is None:
        row = CallEmbedding(call_id=call.id)
        db.add(row)

    row.context_text = text
    row.embedding = vector
    row.updated_at = _utcnow()
    db.commit()


def embed_all_missing(*, batch_size: int = 20) -> None:
    """Backfill embeddings for records that have none yet."""
    db = SessionLocal()
    try:
        # Patients missing an embedding
        patients = (
            db.query(Patient)
            .outerjoin(PatientEmbedding)
            .filter(PatientEmbedding.id.is_(None))
            .options(joinedload(Patient.protocol))
            .limit(batch_size)
            .all()
        )
        for p in patients:
            upsert_patient_embedding(db, p)

        # Calls missing an embedding (eager-load patient + symptoms)
        calls = (
            db.query(Call)
            .outerjoin(CallEmbedding)
            .filter(CallEmbedding.id.is_(None))
            .options(joinedload(Call.patient), joinedload(Call.symptoms))
            .limit(batch_size)
            .all()
        )
        for c in calls:
            upsert_call_embedding(db, c)
    finally:
        db.close()