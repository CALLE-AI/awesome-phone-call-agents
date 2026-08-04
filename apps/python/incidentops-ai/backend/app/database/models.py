from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from app.database.db import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    incident = Column(
        Text,
        nullable=False,
    )

    severity = Column(
        String(50),
        nullable=False,
    )

    priority = Column(
        String(20),
        nullable=False,
    )

    summary = Column(
        Text,
        nullable=False,
    )

    call_status = Column(
        String(50),
        nullable=False,
        default="NOT_REQUIRED",
    )

    call_success = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    call_message = Column(
        Text,
        nullable=True,
    )

    call_attempts = Column(
        Integer,
        nullable=False,
        default=0,
    )

    retry_available = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
