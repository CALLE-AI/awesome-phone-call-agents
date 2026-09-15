from __future__ import annotations

from app.config import settings
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

engine = create_engine(
    settings.database_url, 
    pool_size=settings.db_pool_size, 
    max_overflow=settings.db_max_overflow, 
    pool_timeout=settings.db_pool_timeout, 
    pool_recycle=settings.db_pool_recycle, 
    pool_pre_ping=True, 
    )

@event.listens_for(engine, "connect")
def _set_utc_timezone(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor() 
    cursor.execute("SET TIME ZONE 'UTC'")
    cursor.close()

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try: 
        yield db
    finally:
        db.close()

def check_db(session: Session | None = None) -> bool:
    if session is not None: 
        session.execute(text("SELECT 1")) 
        return True

    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True
