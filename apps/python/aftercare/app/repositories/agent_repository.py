from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from app.core.embeddings import embed_text
from app.core.redact import mask_phone, redact_clinical, redact_text
from app.models.orm import (
    Call,
    CallEmbedding,
    FollowUp,
    Patient,
    PatientEmbedding,
)
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _phone_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _looks_like_phone(raw: str) -> bool:
    digits = _phone_digits(raw)
    if len(digits) < 8:
        return False
    if raw.strip().startswith("+"):
        return True
    compact = re.sub(r"[\s\-().]", "", raw)
    return compact.isdigit() or compact.startswith("+")


def _looks_like_id(name_or_id: str | int, raw: str) -> bool:
    if isinstance(name_or_id, bool):
        return False
    if isinstance(name_or_id, int):
        return True
    return raw.isdigit() and 1 <= len(raw) <= 7


class AgentRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_clinic_overview(self) -> dict:
        now = _utcnow()

        total_patients = self.db.query(func.count(Patient.id)).scalar() or 0 
        needing_followup = (
            self.db.query(func.count(Patient.id))
            .filter(Patient.needs_followup.is_(True))
            .scalar()
            or 0
        )
        overdue_followups = (
            self.db.query(func.count(FollowUp.id))
            .filter(
                FollowUp.status == "pending",
                FollowUp.scheduled_time < now,
            )
            .scalar()
            or 0
        )
        pending_calls = (
            self.db.query(func.count(Call.id))
            .filter(Call.status.in_(("queued", "ringing", "in_progress")))
            .scalar()
            or 0
        )
        emergency_calls = (
            self.db.query(func.count(Call.id))
            .filter(Call.is_emergency.is_(True))
            .scalar()
            or 0
        )

        risk_rows = (
            self.db.query(Patient.current_risk_level, func.count(Patient.id))
            .group_by(Patient.current_risk_level)
            .all()
        )
        patients_by_risk = {
            str(level or "low"): int(count) for level, count in risk_rows
        }

        return {
            "total_patients": int(total_patients),
            "patients_needing_followup": int(needing_followup),
            "patients_by_risk": patients_by_risk,
            "overdue_followups": int(overdue_followups),
            "pending_calls": int(pending_calls),
            "emergency_calls": int(emergency_calls),
        }

    def get_discharge_stats(self, days: int = 7) -> dict:
        days = max(1, min(int(days), 365))
        since = date.today() - timedelta(days=days)

        patients = (
            self.db.query(Patient)
            .options(joinedload(Patient.protocol))
            .filter(
                Patient.discharge_date.isnot(None), 
                Patient.discharge_date >= since, 
            )
            .order_by(Patient.discharge_date.desc())
            .all()
        )

        return {
            "days": days, 
            "since": since.isoformat(),
            "count": len(patients),
            "patients": [
                {
                    "id": patient.id,
                    "name": patient.name,
                    "discharge_date": patient.discharge_date.isoformat() if patient.discharge_date else None,
                    "diagnosis": redact_clinical(patient.discharge_diagnosis),
                    "risk_level": patient.current_risk_level,
                    "protocol": patient.protocol.name if patient.protocol else None,
                } for patient in patients
            ], 
        }

    def get_patients_by_risk(self, level: str, *, limit: int = 25) -> dict:
        level_norm = (level or "low").strip().lower()
        patients = (
            self.db.query(Patient)
            .options(joinedload(Patient.protocol))
            .filter(Patient.current_risk_level == level_norm)
            .order_by(Patient.id.desc())
            .limit(limit)
            .all()
        )

        return {
            "risk_level": level_norm,
            "count": len(patients),
            "patients": [
                {
                    "id": p.id,
                    "name": p.name,
                    "risk_level": p.current_risk_level,
                    "needs_followup": p.needs_followup,
                    "diagnosis": redact_clinical(p.discharge_diagnosis),
                    "protocol": p.protocol.name if p.protocol else None,
                    "doctor_name": p.doctor_name,
                }
                for p in patients
            ],
        }

    def _patient_list_row(self, patient: Patient) -> dict:
        return {
            "id": patient.id,
            "name": patient.name,
            "risk_level": patient.current_risk_level,
            "needs_followup": patient.needs_followup,
            "diagnosis": redact_clinical(patient.discharge_diagnosis),
            "protocol": patient.protocol.name if patient.protocol else None,
            "doctor_name": patient.doctor_name,
            "discharge_date": (
                patient.discharge_date.isoformat() if patient.discharge_date else None
            ),
        }

    def list_patients(self, *, limit: int = 25) -> dict:
        limit = max(1, min(int(limit), 25))
        patients = (
            self.db.query(Patient)
            .options(joinedload(Patient.protocol))
            .order_by(Patient.id.desc())
            .limit(limit)
            .all()
        )
        return {
            "count": len(patients),
            "patients": [self._patient_list_row(patient) for patient in patients],
        }

    def get_patient_detail(self, name_or_id: str | int) -> dict:
        query = self.db.query(Patient).options(
            joinedload(Patient.protocol),
            joinedload(Patient.calls).joinedload(Call.symptoms),
        )

        raw = str(name_or_id).strip()
        if not raw:
            return {"found": False, "query": str(name_or_id)}

        if _looks_like_phone(raw):
            matches = self._match_by_phone(query, raw)
            return self._resolve_matches(matches, query=raw, kind="phone")

        if _looks_like_id(name_or_id, raw):
            patient = query.filter(Patient.id == int(raw)).one_or_none()
            if patient is None:
                return {"found": False, "query": raw}
            return self._patient_detail_payload(patient, query=raw)

        exact = (
            query.filter(Patient.name.ilike(raw))
            .order_by(Patient.id.asc())
            .all()
        )
        matches = exact or (
            query.filter(Patient.name.ilike(f"%{raw}%"))
            .order_by(Patient.id.asc())
            .all()
        )
        return self._resolve_matches(matches, query=raw, kind="name")

    def _match_by_phone(self, query, raw: str) -> list[Patient]:
        digits = _phone_digits(raw)
        last10 = digits[-10:]
        filters = [
            Patient.phone == raw,
            Patient.phone == digits,
            Patient.phone == f"+{digits}",
        ]
        if last10:
            filters.append(Patient.phone.endswith(last10))
        return (
            query.filter(or_(*filters))
            .order_by(Patient.id.asc())
            .all()
        )

    def _resolve_matches(
        self, matches: list[Patient], *, query: str, kind: str
    ) -> dict:
        if not matches:
            return {"found": False, "query": redact_text(query)}

        unique: list[Patient] = []
        seen: set[int] = set()
        for patient in matches:
            if patient.id in seen:
                continue
            seen.add(patient.id)
            unique.append(patient)

        if len(unique) > 1:
            label = "phone number" if kind == "phone" else "name"
            return {
                "found": False,
                "ambiguous": True,
                "query": redact_text(query),
                "match_count": len(unique),
                "message": (
                    f"Multiple patients match this {label}. "
                    "Call get_patient_detail again with a specific patient id."
                ),
                "candidates": [self._patient_list_row(patient) for patient in unique],
            }

        return self._patient_detail_payload(unique[0], query=query)

    def _patient_detail_payload(self, patient: Patient, *, query: str) -> dict:
        calls_sorted = sorted(
            patient.calls or [],
            key=lambda c: c.id,
            reverse=True,
        )

        return {
            "found": True,
            "ambiguous": False,
            "query": redact_text(query),
            "patient": {
                "id": patient.id,
                "name": patient.name,
                "phone_masked": mask_phone(patient.phone),
                "age": patient.age,
                "gender": patient.gender,
                "doctor_name": patient.doctor_name,
                "discharge_date": (
                    patient.discharge_date.isoformat()
                    if patient.discharge_date
                    else None
                ),
                "diagnosis": redact_clinical(patient.discharge_diagnosis),
                "risk_level": patient.current_risk_level,
                "needs_followup": patient.needs_followup,
                "consent_on_file": patient.consent_on_file,
                "protocol": patient.protocol.name if patient.protocol else None,
            },
            "recent_calls": [
                {
                    "id": c.id,
                    "status": c.status,
                    "risk_level": c.risk_level,
                    "is_emergency": c.is_emergency,
                    "summary": redact_clinical(c.summary),
                    "call_start": c.call_start.isoformat() if c.call_start else None,
                    "symptoms": [
                        {
                            "name": s.name,
                            "severity": s.severity,
                            "note": redact_clinical(s.note),
                        }
                        for s in (c.symptoms or [])
                    ],
                }
                for c in calls_sorted[:5]
            ],
        }

    def get_emergency_patients(self, *, limit: int = 25) -> dict:
        calls = (
            self.db.query(Call)
            .options(joinedload(Call.patient), joinedload(Call.symptoms))
            .filter(Call.is_emergency.is_(True))
            .order_by(Call.id.desc())
            .limit(limit)
            .all()
        )

        return {
            "count": len(calls),
            "emergencies": [
                {
                    "call_id": c.id,
                    "patient_id": c.patient_id,
                    "patient_name": c.patient.name if c.patient else None,
                    "risk_level": c.risk_level,
                    "summary": redact_clinical(c.summary),
                    "call_start": c.call_start.isoformat() if c.call_start else None,
                    "symptoms": [s.name for s in (c.symptoms or [])],
                }
                for c in calls
            ],
        }
    
    def get_overdue_followups(self, *, limit: int = 25) -> dict:
        now = _utcnow()
        rows = (
            self.db.query(FollowUp)
            .options(joinedload(FollowUp.patient).joinedload(Patient.protocol))
            .filter(
                FollowUp.status == "pending",
                FollowUp.scheduled_time < now,
            )
            .order_by(FollowUp.scheduled_time.asc())
            .limit(limit)
            .all()
        )

        patients = [
            {
                "id": fu.patient.id,
                "name": fu.patient.name,
                "risk_level": fu.patient.current_risk_level,
                "diagnosis": redact_clinical(fu.patient.discharge_diagnosis),
                "protocol": fu.patient.protocol.name if fu.patient.protocol else None,
                "needs_followup": True,
                "scheduled_time": (
                    fu.scheduled_time.isoformat() if fu.scheduled_time else None
                ),
                "attempt_count": fu.attempt_count,
            }
            for fu in rows
            if fu.patient is not None
        ]

        return {
            "count": len(patients),
            "patients": patients,
        }

    def search_patients_semantic(self,query: str, limit: int = 5) -> dict:
        vector = embed_text(query)
        if not vector:
            return {
                "unavailable": True,
                "reason": "Not available right now", 
                "results": [],
            }

        rows = (
            self.db.query(
                PatientEmbedding, 
                PatientEmbedding.embedding.cosine_distance(vector).label("distance"), 
            )
            .options(joinedload(PatientEmbedding.patient).joinedload(Patient.protocol))
            .order_by("distance")
            .limit(limit)
            .all()
        )

        return {
            "unavailable": False,
            "query": redact_text(query),
            "results": [
                {
                    "patient_id": row.PatientEmbedding.patient_id,
                    "name": (
                        row.PatientEmbedding.patient.name
                        if row.PatientEmbedding.patient
                        else None
                    ),
                    "risk_level": (
                        row.PatientEmbedding.patient.current_risk_level
                        if row.PatientEmbedding.patient
                        else None
                    ),
                    "diagnosis": redact_clinical(
                        row.PatientEmbedding.patient.discharge_diagnosis
                        if row.PatientEmbedding.patient
                        else None
                    ),
                    "protocol": (
                        row.PatientEmbedding.patient.protocol.name
                        if row.PatientEmbedding.patient
                        and row.PatientEmbedding.patient.protocol
                        else None
                    ),
                    "context_text": redact_text(row.PatientEmbedding.context_text),
                    "distance": float(row.distance),
                }
                for row in rows
            ],
        }

    def search_call_transcripts(self, query: str, limit: int = 5) -> dict:
        vector = embed_text(query)
        if not vector:
            return {
                "unavailable": True,
                "reason": "Not available right now", 
                "results": [],
            }

        rows = (
            self.db.query(
                CallEmbedding, 
                CallEmbedding.embedding.cosine_distance(vector).label("distance"), 
            )
            .options(
                joinedload(CallEmbedding.call).joinedload(Call.patient), 
                joinedload(CallEmbedding.call).joinedload(Call.symptoms), 
            )
            .order_by("distance")
            .limit(limit)
            .all()
        )

        return {
            "unavailable": False,
            "query": redact_text(query),
            "results": [
                {
                    "call_id": row.CallEmbedding.call_id,
                    "patient_name": (
                        row.CallEmbedding.call.patient.name
                        if row.CallEmbedding.call and row.CallEmbedding.call.patient
                        else None
                    ),
                    "status": (
                        row.CallEmbedding.call.status
                        if row.CallEmbedding.call
                        else None
                    ),
                    "is_emergency": (
                        row.CallEmbedding.call.is_emergency
                        if row.CallEmbedding.call
                        else None
                    ),
                    "summary": redact_clinical(
                        row.CallEmbedding.call.summary
                        if row.CallEmbedding.call
                        else None
                    ),
                    "context_text": redact_text(row.CallEmbedding.context_text),
                    "distance": float(row.distance),
                }
                for row in rows
            ],
        }