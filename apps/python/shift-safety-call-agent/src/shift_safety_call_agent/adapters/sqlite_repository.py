"""SQLite interview persistence using only the Python standard library."""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from math import isfinite
from os import PathLike
from pathlib import Path

from shift_safety_call_agent.application.repository_errors import (
    DatabaseInitializationError,
    DuplicateInterviewError,
    RepositoryDataError,
    RepositoryError,
    RepositoryOperationError,
    UnsupportedSchemaVersionError,
)
from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import SafetyInterview, SafetyInterviewResult

CURRENT_SCHEMA_VERSION = 1
BUSY_TIMEOUT_MILLISECONDS = 5_000

_PHONE_LIKE_PATTERN = re.compile(r"(?<!\d)\+?[1-9]\d{7,14}(?!\d)")
_SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]{8,}|api[_ -]?key\s*[:=])"
)
_UUID_PATTERN = re.compile(
    r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

_SELECT_INTERVIEW = """
SELECT
    i.interview_id,
    i.created_at,
    i.scenario_name,
    i.recipient_alias,
    i.status,
    i.call_provider,
    i.call_provider_run_id,
    i.started_at,
    i.completed_at,
    i.failure_reason,
    r.interview_id AS result_interview_id,
    r.work_summary AS result_work_summary,
    r.incident_level AS result_incident_level,
    r.near_miss_occurred AS result_near_miss_occurred,
    r.equipment_issue_occurred AS result_equipment_issue_occurred,
    r.injury_or_health_issue AS result_injury_or_health_issue,
    r.handover_notes AS result_handover_notes,
    r.requires_follow_up AS result_requires_follow_up,
    r.confidence AS result_confidence,
    r.evidence_json AS result_evidence_json,
    r.summary AS result_summary
FROM safety_interviews AS i
LEFT JOIN safety_interview_results AS r ON r.interview_id = i.interview_id
"""


def _create_schema_version_1(connection: sqlite3.Connection) -> None:
    """Create only the fixed initial schema; callers cannot supply SQL."""

    connection.execute(
        """
        CREATE TABLE safety_interviews (
            interview_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            scenario_name TEXT NOT NULL,
            recipient_alias TEXT NOT NULL,
            status TEXT NOT NULL CHECK (
                status IN ('draft', 'planned', 'awaiting_confirmation', 'calling',
                           'completed', 'failed', 'cancelled')
            ),
            call_provider TEXT NOT NULL,
            call_provider_run_id TEXT NULL,
            started_at TEXT NULL,
            completed_at TEXT NULL,
            failure_reason TEXT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE safety_interview_results (
            interview_id TEXT PRIMARY KEY,
            work_summary TEXT NULL,
            incident_level TEXT NULL CHECK (
                incident_level IS NULL OR
                incident_level IN ('none', 'minor', 'moderate', 'critical', 'unknown')
            ),
            near_miss_occurred INTEGER NULL CHECK (
                near_miss_occurred IS NULL OR near_miss_occurred IN (0, 1)
            ),
            equipment_issue_occurred INTEGER NULL CHECK (
                equipment_issue_occurred IS NULL OR equipment_issue_occurred IN (0, 1)
            ),
            injury_or_health_issue INTEGER NULL CHECK (
                injury_or_health_issue IS NULL OR injury_or_health_issue IN (0, 1)
            ),
            handover_notes TEXT NULL,
            requires_follow_up INTEGER NULL CHECK (
                requires_follow_up IS NULL OR requires_follow_up IN (0, 1)
            ),
            confidence REAL NULL CHECK (
                confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)
            ),
            evidence_json TEXT NOT NULL,
            summary TEXT NOT NULL,
            FOREIGN KEY (interview_id) REFERENCES safety_interviews(interview_id)
                ON DELETE CASCADE
        )
        """
    )
    connection.execute(
        "CREATE INDEX idx_safety_interviews_created_at "
        "ON safety_interviews(created_at DESC, interview_id ASC)"
    )
    connection.execute(
        "CREATE INDEX idx_safety_interviews_status ON safety_interviews(status)"
    )
    connection.execute(
        "CREATE INDEX idx_safety_results_follow_up "
        "ON safety_interview_results(requires_follow_up)"
    )
    connection.execute(
        "CREATE INDEX idx_safety_results_incident_level "
        "ON safety_interview_results(incident_level)"
    )


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise RepositoryOperationError("Interview timestamps must be datetimes")
    if value.tzinfo is None or value.utcoffset() is None:
        raise RepositoryOperationError("Interview timestamps must include a timezone")
    utc_value = value.astimezone(timezone.utc)
    return utc_value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _parse_datetime(value: object, *, nullable: bool) -> datetime | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str):
        raise RepositoryDataError("Stored interview timestamp is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise RepositoryDataError("Stored interview timestamp is invalid") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise RepositoryDataError("Stored interview timestamp has no timezone")
    return parsed


def _serialize_boolean(value: bool | None) -> int | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise RepositoryOperationError("Interview result contains an invalid boolean")
    return int(value)


def _parse_boolean(value: object) -> bool | None:
    if value is None:
        return None
    if type(value) is not int or value not in (0, 1):
        raise RepositoryDataError("Stored interview result contains an invalid boolean")
    return bool(value)


def _parse_nullable_string(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise RepositoryDataError(f"Stored {field_name} is invalid")
    return value


def _parse_required_string(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise RepositoryDataError(f"Stored {field_name} is invalid")
    return value


def _parse_evidence(value: object) -> tuple[str, ...]:
    if not isinstance(value, str):
        raise RepositoryDataError("Stored evidence is invalid")
    try:
        decoded = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        raise RepositoryDataError("Stored evidence is invalid") from None
    if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
        raise RepositoryDataError("Stored evidence is invalid")
    return tuple(decoded)


def _validate_safe_text(interview: SafetyInterview) -> None:
    if not isinstance(interview.interview_id, str):
        raise RepositoryOperationError("Interview identifiers must be strings")
    if not isinstance(interview.recipient_alias, str) or not isinstance(
        interview.call_provider, str
    ):
        raise RepositoryOperationError("Interview identity fields must be strings")
    if not isinstance(interview.status, InterviewStatus):
        raise RepositoryOperationError("Interview status is invalid")
    if not interview.recipient_alias.startswith(("fictional-", "demo-")):
        raise RepositoryOperationError("Only fictional recipient aliases may be stored")
    if interview.call_provider not in {"fake", "calle"}:
        raise RepositoryOperationError("Only approved call providers may be stored")
    result = interview.result
    if result is not None and not isinstance(result, SafetyInterviewResult):
        raise RepositoryOperationError("Interview result is invalid")
    values: list[str] = [
        interview.scenario_name,
        interview.recipient_alias,
        interview.call_provider,
        interview.failure_reason or "",
    ]
    if result is not None:
        values.extend(
            (
                result.work_summary or "",
                result.handover_notes or "",
                result.summary,
                *result.evidence,
            )
        )
    if not all(isinstance(value, str) for value in values):
        raise RepositoryOperationError("Interview text fields must be strings")
    if any(_PHONE_LIKE_PATTERN.search(value) for value in values):
        raise RepositoryOperationError("Phone-like values cannot be stored")
    if any(_SECRET_LIKE_PATTERN.search(value) for value in values):
        raise RepositoryOperationError("Credential-like values cannot be stored")
    for identifier in (interview.interview_id, interview.call_provider_run_id):
        if identifier is None:
            continue
        if not isinstance(identifier, str):
            raise RepositoryOperationError("Interview identifiers must be strings")
        if not _UUID_PATTERN.fullmatch(identifier) and _PHONE_LIKE_PATTERN.search(identifier):
            raise RepositoryOperationError("Phone-like identifiers cannot be stored")


class SqliteInterviewRepository:
    """Persist provider-neutral interview aggregates in a local SQLite file."""

    def __init__(self, database_path: str | PathLike[str]) -> None:
        self._database_path = Path(database_path)

    @property
    def database_path(self) -> Path:
        """Return the configured path without opening the database."""

        return self._database_path

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(
            self._database_path,
            timeout=BUSY_TIMEOUT_MILLISECONDS / 1_000,
            isolation_level=None,
        )
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MILLISECONDS}")
            yield connection
        finally:
            connection.close()

    def initialize(self) -> int:
        """Create schema version 1 transactionally and reject future versions."""

        try:
            self._database_path.parent.mkdir(parents=True, exist_ok=True)
            with self._connection() as connection:
                version = int(connection.execute("PRAGMA user_version").fetchone()[0])
                if version > CURRENT_SCHEMA_VERSION:
                    raise UnsupportedSchemaVersionError(
                        "Database schema is newer than this application supports"
                    )
                if version == 0:
                    connection.execute("BEGIN IMMEDIATE")
                    try:
                        _create_schema_version_1(connection)
                        connection.execute("PRAGMA user_version = 1")
                        connection.commit()
                    except Exception:
                        connection.rollback()
                        raise
                return CURRENT_SCHEMA_VERSION
        except UnsupportedSchemaVersionError:
            raise
        except (sqlite3.Error, OSError, ValueError):
            raise DatabaseInitializationError("Unable to initialize the local database") from None

    def save(self, interview: SafetyInterview) -> None:
        """Save one aggregate atomically without overwriting an identifier."""

        _validate_safe_text(interview)
        self.initialize()
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    exists = connection.execute(
                        "SELECT 1 FROM safety_interviews WHERE interview_id = ?",
                        (interview.interview_id,),
                    ).fetchone()
                    if exists is not None:
                        raise DuplicateInterviewError(
                            "An interview with this identifier already exists"
                        )
                    connection.execute(
                        """
                        INSERT INTO safety_interviews (
                            interview_id, created_at, scenario_name, recipient_alias,
                            status, call_provider, call_provider_run_id, started_at,
                            completed_at, failure_reason
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            interview.interview_id,
                            _serialize_datetime(interview.created_at),
                            interview.scenario_name,
                            interview.recipient_alias,
                            interview.status.value,
                            interview.call_provider,
                            (
                                interview.call_provider_run_id
                                if interview.call_provider == "fake" else None
                            ),
                            _serialize_datetime(interview.started_at),
                            _serialize_datetime(interview.completed_at),
                            interview.failure_reason,
                        ),
                    )
                    if interview.result is not None:
                        result = interview.result
                        connection.execute(
                            """
                            INSERT INTO safety_interview_results (
                                interview_id, work_summary, incident_level,
                                near_miss_occurred, equipment_issue_occurred,
                                injury_or_health_issue, handover_notes,
                                requires_follow_up, confidence, evidence_json, summary
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                interview.interview_id,
                                result.work_summary,
                                result.incident_level.value
                                if result.incident_level is not None
                                else None,
                                _serialize_boolean(result.near_miss_occurred),
                                _serialize_boolean(result.equipment_issue_occurred),
                                _serialize_boolean(result.injury_or_health_issue),
                                result.handover_notes,
                                _serialize_boolean(result.requires_follow_up),
                                result.confidence,
                                json.dumps(
                                    list(result.evidence),
                                    ensure_ascii=False,
                                    separators=(",", ":"),
                                ),
                                result.summary,
                            ),
                        )
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
        except DuplicateInterviewError:
            raise
        except RepositoryError:
            raise
        except (sqlite3.Error, OSError, TypeError, ValueError):
            raise RepositoryOperationError("Unable to save the interview") from None

    def get(self, interview_id: str) -> SafetyInterview | None:
        """Return one reconstructed aggregate or None when it does not exist."""

        self.initialize()
        try:
            with self._connection() as connection:
                row = connection.execute(
                    _SELECT_INTERVIEW + " WHERE i.interview_id = ?",
                    (interview_id,),
                ).fetchone()
            return None if row is None else self._restore(row)
        except RepositoryError:
            raise
        except (sqlite3.Error, OSError):
            raise RepositoryOperationError("Unable to read the interview") from None

    def list(self) -> tuple[SafetyInterview, ...]:
        """Return newest interviews first, then identifier ascending for ties."""

        self.initialize()
        try:
            with self._connection() as connection:
                rows = connection.execute(
                    _SELECT_INTERVIEW
                    + " ORDER BY i.created_at DESC, i.interview_id ASC"
                ).fetchall()
            return tuple(self._restore(row) for row in rows)
        except RepositoryError:
            raise
        except (sqlite3.Error, OSError):
            raise RepositoryOperationError("Unable to list interviews") from None

    @staticmethod
    def _restore(row: sqlite3.Row) -> SafetyInterview:
        try:
            result = None
            if row["result_interview_id"] is not None:
                incident_value = row["result_incident_level"]
                incident_level = (
                    None
                    if incident_value is None
                    else IncidentLevel(_parse_required_string(incident_value, "incident level"))
                )
                confidence = row["result_confidence"]
                if confidence is not None:
                    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
                        raise RepositoryDataError("Stored confidence is invalid")
                    if not isfinite(float(confidence)) or not 0.0 <= float(confidence) <= 1.0:
                        raise RepositoryDataError("Stored confidence is invalid")
                    confidence = float(confidence)
                result = SafetyInterviewResult(
                    work_summary=_parse_nullable_string(
                        row["result_work_summary"], "work summary"
                    ),
                    incident_level=incident_level,
                    near_miss_occurred=_parse_boolean(row["result_near_miss_occurred"]),
                    equipment_issue_occurred=_parse_boolean(
                        row["result_equipment_issue_occurred"]
                    ),
                    injury_or_health_issue=_parse_boolean(
                        row["result_injury_or_health_issue"]
                    ),
                    handover_notes=_parse_nullable_string(
                        row["result_handover_notes"], "handover notes"
                    ),
                    requires_follow_up=_parse_boolean(row["result_requires_follow_up"]),
                    confidence=confidence,
                    evidence=_parse_evidence(row["result_evidence_json"]),
                    summary=_parse_required_string(row["result_summary"], "summary"),
                )
            return SafetyInterview(
                interview_id=_parse_required_string(row["interview_id"], "interview id"),
                created_at=_parse_datetime(row["created_at"], nullable=False),
                scenario_name=_parse_required_string(row["scenario_name"], "scenario name"),
                recipient_alias=_parse_required_string(
                    row["recipient_alias"], "recipient alias"
                ),
                status=InterviewStatus(_parse_required_string(row["status"], "status")),
                call_provider=_parse_required_string(row["call_provider"], "provider"),
                call_provider_run_id=_parse_nullable_string(
                    row["call_provider_run_id"], "provider run id"
                ),
                started_at=_parse_datetime(row["started_at"], nullable=True),
                completed_at=_parse_datetime(row["completed_at"], nullable=True),
                result=result,
                failure_reason=_parse_nullable_string(
                    row["failure_reason"], "failure reason"
                ),
            )
        except RepositoryDataError:
            raise
        except (KeyError, TypeError, ValueError):
            raise RepositoryDataError("Stored interview data is invalid") from None
