from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = get_settings().DATABASE_URL
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, connect_args=connect_args)
        if url.startswith("sqlite"):

            @event.listens_for(_engine, "connect")
            def _sqlite_pragmas(dbapi_conn, _):  # noqa: ANN001
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA busy_timeout=5000")
                cur.close()

    return _engine


def reset_engine() -> None:
    """Test hook: drop the cached engine so a new DATABASE_URL takes effect."""
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


def init_db() -> None:
    from app import models  # noqa: F401  (register tables)

    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    with engine.begin() as conn:
        # One active sweep per hazard. Enforced in SQL so a double-click on "Start sweep" cannot
        # race past the app and dial the whole roster twice.
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_active_sweep_per_hazard "
                "ON sweep(hazard_id) WHERE is_active = 1"
            )
        )


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(get_engine()) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
