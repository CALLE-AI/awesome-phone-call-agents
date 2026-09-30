from __future__ import annotations

from datetime import datetime

from app.models.orm import Call, DiseaseProtocol, FollowUp, Patient
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, joinedload


class DashboardRepository:
    def __init__(self, db: Session):
        self.db = db

    def count_patients(self) -> int:
        return self.db.query(func.count(Patient.id)).scalar() or 0

    def count_patients_needing_followup(self) -> int:
        return (
            self.db.query(func.count(Patient.id))
            .filter(Patient.needs_followup.is_(True))
            .scalar()
            or 0
        )

    def count_patients_missing_consent(self) -> int:
        return (
            self.db.query(func.count(Patient.id))
            .filter(Patient.consent_on_file.is_(False))
            .scalar()
            or 0
        )

    def patients_by_risk_rows(self) -> list[tuple[str, int]]:
        rows = (
            self.db.query(Patient.current_risk_level, func.count(Patient.id))
            .group_by(Patient.current_risk_level)
            .all()
        )
        return [(str(level or "low"), int(count)) for level, count in rows]

    def patients_by_protocol_rows(self, *, limit: int = 10) -> list[tuple[str, str, int]]:
        rows = (
            self.db.query(
                DiseaseProtocol.code,
                DiseaseProtocol.name,
                func.count(Patient.id),
            )
            .join(Patient, Patient.protocol_id == DiseaseProtocol.id)
            .group_by(DiseaseProtocol.id, DiseaseProtocol.code, DiseaseProtocol.name)
            .order_by(func.count(Patient.id).desc())
            .limit(limit)
            .all()
        )
        return [(str(code), str(name), int(count)) for code, name, count in rows]

    def count_protocols(self, *, active_only: bool = False) -> int:
        q = self.db.query(func.count(DiseaseProtocol.id))
        if active_only:
            q = q.filter(DiseaseProtocol.is_active.is_(True))
        return q.scalar() or 0

    def count_followups_pending(self) -> int:
        return (
            self.db.query(func.count(FollowUp.id))
            .filter(FollowUp.status == "pending")
            .scalar()
            or 0
        )

    def count_followups_overdue(self, *, now: datetime) -> int:
        return (
            self.db.query(func.count(FollowUp.id))
            .filter(
                FollowUp.status == "pending",
                FollowUp.scheduled_time < now,
            )
            .scalar()
            or 0
        )

    def followups_by_status_rows(self) -> list[tuple[str, int]]:
        rows = (
            self.db.query(FollowUp.status, func.count(FollowUp.id))
            .group_by(FollowUp.status)
            .all()
        )
        return [(str(status), int(count)) for status, count in rows]

    def count_calls_in_range(self, *, range_start: datetime) -> int:
        """Calls with call_start in range. Null call_start excluded from range KPIs/series."""
        return (
            self.db.query(func.count(Call.id))
            .filter(Call.call_start.isnot(None), Call.call_start >= range_start)
            .scalar()
            or 0
        )

    def count_emergencies_in_range(self, *, range_start: datetime) -> int:
        return (
            self.db.query(func.count(Call.id))
            .filter(
                Call.is_emergency.is_(True),
                Call.call_start.isnot(None),
                Call.call_start >= range_start,
            )
            .scalar()
            or 0
        )

    def count_live_calls_in_range(self, *, range_start: datetime) -> int:
        return (
            self.db.query(func.count(Call.id))
            .filter(
                Call.dry_run.is_(False),
                Call.call_start.isnot(None),
                Call.call_start >= range_start,
            )
            .scalar()
            or 0
        )

    def count_dry_run_calls_in_range(self, *, range_start: datetime) -> int:
        return (
            self.db.query(func.count(Call.id))
            .filter(
                Call.dry_run.is_(True),
                Call.call_start.isnot(None),
                Call.call_start >= range_start,
            )
            .scalar()
            or 0
        )

    def calls_per_day_rows(self, *, range_start: datetime) -> list[tuple[str, int]]:
        day = func.date(Call.call_start)
        rows = (
            self.db.query(day, func.count(Call.id))
            .filter(Call.call_start.isnot(None), Call.call_start >= range_start)
            .group_by(day)
            .order_by(day)
            .all()
        )
        return [(str(d), int(count)) for d, count in rows if d is not None]

    def emergencies_per_day_rows(self, *, range_start: datetime) -> list[tuple[str, int]]:
        day = func.date(Call.call_start)
        rows = (
            self.db.query(day, func.count(Call.id))
            .filter(
                Call.is_emergency.is_(True),
                Call.call_start.isnot(None),
                Call.call_start >= range_start,
            )
            .group_by(day)
            .order_by(day)
            .all()
        )
        return [(str(d), int(count)) for d, count in rows if d is not None]

    def calls_by_status_rows(self) -> list[tuple[str, int]]:
        rows = (
            self.db.query(Call.status, func.count(Call.id))
            .group_by(Call.status)
            .all()
        )
        return [(str(status), int(count)) for status, count in rows]

    def calls_by_risk_rows(self) -> list[tuple[str, int]]:
        risk_key = func.coalesce(Call.risk_level, "unknown")
        rows = (
            self.db.query(risk_key, func.count(Call.id))
            .group_by(risk_key)
            .all()
        )
        return [(str(level), int(count)) for level, count in rows]

    def high_risk_patients(self, *, limit: int = 10) -> list[Patient]:
        return (
            self.db.query(Patient)
            .options(joinedload(Patient.protocol))
            .filter(Patient.current_risk_level.in_(("high", "critical")))
            .order_by(
                case(
                    (Patient.current_risk_level == "critical", 0),
                    (Patient.current_risk_level == "high", 1),
                    else_=2,
                ),
                Patient.id.desc(),
            )
            .limit(limit)
            .all()
        )

    def overdue_followups(self, *, now: datetime, limit: int = 10) -> list[FollowUp]:
        return (
            self.db.query(FollowUp)
            .options(joinedload(FollowUp.patient))
            .filter(
                FollowUp.status == "pending",
                FollowUp.scheduled_time < now,
            )
            .order_by(FollowUp.scheduled_time.asc())
            .limit(limit)
            .all()
        )

    def recent_emergencies(
        self, *, range_start: datetime, limit: int = 10
    ) -> list[Call]:
        return (
            self.db.query(Call)
            .options(joinedload(Call.patient))
            .filter(
                Call.is_emergency.is_(True),
                or_(
                    Call.call_start >= range_start,
                    Call.call_start.is_(None),
                ),
            )
            .order_by(Call.id.desc())
            .limit(limit)
            .all()
        )

    def recent_calls(self, *, limit: int = 30) -> list[Call]:
        return (
            self.db.query(Call)
            .options(joinedload(Call.patient))
            .order_by(Call.id.desc())
            .limit(limit)
            .all()
        )

    def pending_followups_for_activity(self, *, limit: int = 20) -> list[FollowUp]:
        return (
            self.db.query(FollowUp)
            .options(joinedload(FollowUp.patient))
            .filter(FollowUp.status == "pending")
            .order_by(FollowUp.scheduled_time.asc())
            .limit(limit)
            .all()
        )
