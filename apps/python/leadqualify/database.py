from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from config import DATABASE_URL

engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False}  # Needed for SQLite in multithreaded environments like FastAPI
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(50), nullable=False)
    company = Column(String(100), nullable=True)
    product_interest = Column(String(100), nullable=True)
    
    # CALL-E related fields
    call_id = Column(String(100), nullable=True, unique=True, index=True)
    status = Column(String(50), default="pending")  # pending, calling, completed, failed, no_answer, declined
    
    # BANT & Qualification scorecards
    pain_point = Column(Text, nullable=True)
    timeline_window = Column(String(50), nullable=True)  # immediate, 1_3_months, 3_6_months, longer_or_unknown
    budget_status = Column(String(50), nullable=True)     # approved, pricing_out, no_budget, unknown
    interest_level = Column(String(50), nullable=True)    # high, medium, low, not_interested
    handoff_recommended = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)
    
    # Metadata & transcript logs
    transcript = Column(Text, nullable=True)  # JSON-string of transcript turns
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
