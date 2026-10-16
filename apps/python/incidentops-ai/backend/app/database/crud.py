from typing import Any

from app.database.db import SessionLocal
from app.database.models import Incident


def save_incident(data: dict[str, Any]) -> dict[str, Any]:
    db = SessionLocal()

    try:
        incident = Incident(
            incident=data["incident"],
            severity=data["severity"],
            priority=data["priority"],
            summary=data["summary"],
            call_status=data.get(
                "call_status",
                "NOT_REQUIRED",
            ),
            call_success=bool(
                data.get("call_success", False)
            ),
            call_message=data.get("call_message"),
            call_attempts=int(
                data.get("call_attempts", 0)
            ),
            retry_available=bool(
                data.get("retry_available", False)
            ),
        )

        db.add(incident)
        db.commit()
        db.refresh(incident)

        return {
            "id": incident.id,
            "incident": incident.incident,
            "severity": incident.severity,
            "priority": incident.priority,
            "summary": incident.summary,
            "call_status": incident.call_status,
            "call_success": incident.call_success,
            "call_message": incident.call_message,
            "call_attempts": incident.call_attempts,
            "retry_available": incident.retry_available,
            "created_at": (
                incident.created_at.isoformat()
                if incident.created_at
                else None
            ),
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


def get_history() -> list[dict[str, Any]]:
    db = SessionLocal()

    try:
        rows = (
            db.query(Incident)
            .order_by(Incident.id.desc())
            .all()
        )

        result: list[dict[str, Any]] = []

        for row in rows:
            result.append(
                {
                    "id": row.id,
                    "incident": row.incident,
                    "severity": row.severity,
                    "priority": row.priority,
                    "summary": row.summary,
                    "call_status": row.call_status,
                    "call_success": row.call_success,
                    "call_message": row.call_message,
                    "call_attempts": row.call_attempts,
                    "retry_available": row.retry_available,
                    "created_at": (
                        row.created_at.isoformat()
                        if row.created_at
                        else None
                    ),
                }
            )

        return result

    finally:
        db.close()
