"""SQLAlchemy models and session management (SQLite)."""
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from .config import settings

Base = declarative_base()


def _utcnow():
    return datetime.now(timezone.utc)


class Ticket(Base):
    """A repair/support ticket created from a call."""

    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticket_number = Column(String, unique=True, index=True)
    device_type = Column(String, nullable=True)
    issue_description = Column(Text, nullable=True)
    priority = Column(String, default="normal")
    status = Column(String, default="open")
    customer_name = Column(String, nullable=True)
    scheduled_date = Column(String, nullable=True)   # e.g. 2026-08-03
    scheduled_time = Column(String, nullable=True)   # e.g. 10:30
    created_at = Column(DateTime, default=_utcnow)

    calls = relationship("CallSession", back_populates="ticket")


class CallSession(Base):
    """One outbound CALL-E phone call and its outcome."""

    __tablename__ = "call_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, unique=True, index=True, nullable=True)
    plan_id = Column(String, nullable=True)
    confirm_token = Column(String, nullable=True)
    phone = Column(String)
    goal = Column(Text)
    # created -> planned -> running -> completed | failed | plan_not_ready
    status = Column(String, default="created")
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    structured_result = Column(Text, nullable=True)  # JSON from CALL-E
    error = Column(Text, nullable=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    ticket = relationship("Ticket", back_populates="calls")


engine = create_engine(
    settings.database_url, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
