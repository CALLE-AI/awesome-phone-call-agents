"""Unit tests for local SQLite interview persistence."""

import sqlite3
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from shift_safety_call_agent.adapters.memory_repository import MemoryInterviewRepository
from shift_safety_call_agent.adapters.sqlite_repository import (
    CURRENT_SCHEMA_VERSION,
    SqliteInterviewRepository,
)
from shift_safety_call_agent.application.repository_errors import (
    DatabaseInitializationError,
    DuplicateInterviewError,
    RepositoryDataError,
    RepositoryOperationError,
    UnsupportedSchemaVersionError,
)
from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import SafetyInterview, SafetyInterviewResult


@contextmanager
def _database(path: Path) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _result(*, nullable: bool = False) -> SafetyInterviewResult:
    return SafetyInterviewResult(
        work_summary=None if nullable else "Fictional work was completed.",
        incident_level=None if nullable else IncidentLevel.UNKNOWN,
        near_miss_occurred=None if nullable else False,
        equipment_issue_occurred=False,
        injury_or_health_issue=None,
        handover_notes=None if nullable else "Fictional handover notes.",
        requires_follow_up=None if nullable else False,
        confidence=None if nullable else 0.75,
        evidence=("Confirmed in fictional answers.",),
        summary="Safety-check result from fictional data.",
    )


def _interview(
    identifier: str,
    *,
    created_at: datetime | None = None,
    result: SafetyInterviewResult | None = None,
) -> SafetyInterview:
    moment = created_at or datetime(2026, 8, 4, 9, 30, tzinfo=timezone(timedelta(hours=9)))
    return SafetyInterview(
        interview_id=identifier,
        created_at=moment,
        scenario_name="incomplete-answers" if result and result.incident_level is None else "no-incident",
        recipient_alias="fictional-worker",
        status=InterviewStatus.COMPLETED if result else InterviewStatus.DRAFT,
        call_provider="fake",
        call_provider_run_id="fake-run" if result else None,
        started_at=moment if result else None,
        completed_at=moment + timedelta(minutes=1) if result else None,
        result=result,
    )


class SqliteMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.path = Path(self.temporary_directory.name) / "interviews.db"

    def test_empty_database_initializes_idempotently_with_schema_and_indexes(self) -> None:
        repository = SqliteInterviewRepository(self.path)
        self.assertEqual(repository.initialize(), CURRENT_SCHEMA_VERSION)
        self.assertEqual(repository.initialize(), CURRENT_SCHEMA_VERSION)
        with _database(self.path) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            indexes = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index'"
                )
            }
            foreign_key = connection.execute(
                "PRAGMA foreign_key_list(safety_interview_results)"
            ).fetchone()
            interview_columns = tuple(
                row[1] for row in connection.execute("PRAGMA table_info(safety_interviews)")
            )
            result_columns = tuple(
                row[1]
                for row in connection.execute("PRAGMA table_info(safety_interview_results)")
            )
        self.assertTrue({"safety_interviews", "safety_interview_results"} <= tables)
        self.assertTrue(
            {
                "idx_safety_interviews_created_at",
                "idx_safety_interviews_status",
                "idx_safety_results_follow_up",
                "idx_safety_results_incident_level",
            }
            <= indexes
        )
        self.assertIsNotNone(foreign_key)
        assert foreign_key is not None
        self.assertEqual(foreign_key[2], "safety_interviews")
        self.assertEqual(foreign_key[6], "CASCADE")
        self.assertEqual(
            interview_columns,
            (
                "interview_id",
                "created_at",
                "scenario_name",
                "recipient_alias",
                "status",
                "call_provider",
                "call_provider_run_id",
                "started_at",
                "completed_at",
                "failure_reason",
            ),
        )
        self.assertEqual(
            result_columns,
            (
                "interview_id",
                "work_summary",
                "incident_level",
                "near_miss_occurred",
                "equipment_issue_occurred",
                "injury_or_health_issue",
                "handover_notes",
                "requires_follow_up",
                "confidence",
                "evidence_json",
                "summary",
            ),
        )
        with repository._connection() as connection:
            self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def test_future_schema_version_is_rejected(self) -> None:
        with _database(self.path) as connection:
            connection.execute("PRAGMA user_version = 2")
        with self.assertRaises(UnsupportedSchemaVersionError):
            SqliteInterviewRepository(self.path).initialize()

    def test_failed_migration_rolls_back_schema_and_version(self) -> None:
        def failing_migration(connection: sqlite3.Connection) -> None:
            connection.execute("CREATE TABLE partial_table (value TEXT)")
            raise sqlite3.OperationalError("synthetic migration failure")

        repository = SqliteInterviewRepository(self.path)
        with patch(
            "shift_safety_call_agent.adapters.sqlite_repository._create_schema_version_1",
            side_effect=failing_migration,
        ):
            with self.assertRaises(DatabaseInitializationError):
                repository.initialize()
        with _database(self.path) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 0)
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                    ("partial_table",),
                ).fetchone()
            )


class SqliteRepositoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.path = Path(self.temporary_directory.name) / "interviews.db"
        self.repository = SqliteInterviewRepository(self.path)

    def test_round_trip_preserves_result_unknowns_unicode_and_aware_datetimes(self) -> None:
        source = _interview("interview-a", result=_result(nullable=True))
        self.repository.save(source)
        loaded = self.repository.get("interview-a")
        self.assertIsNotNone(loaded)
        assert loaded is not None and loaded.result is not None
        self.assertEqual(loaded.created_at, source.created_at)
        self.assertIsNotNone(loaded.created_at.tzinfo)
        self.assertEqual(loaded.call_provider_run_id, "fake-run")
        self.assertIsNone(loaded.result.incident_level)
        self.assertIsNone(loaded.result.near_miss_occurred)
        self.assertIs(loaded.result.equipment_issue_occurred, False)
        self.assertIsNone(loaded.result.requires_follow_up)
        self.assertIsNone(loaded.result.confidence)
        self.assertEqual(loaded.result.evidence, ("Confirmed in fictional answers.",))

    def test_round_trip_without_result_and_missing_identifier(self) -> None:
        source = _interview("interview-a")
        self.repository.save(source)
        self.assertEqual(self.repository.get("interview-a"), source)
        self.assertIsNone(self.repository.get("missing"))

    def test_duplicate_identifier_does_not_overwrite(self) -> None:
        self.repository.save(_interview("interview-a"))
        with self.assertRaises(DuplicateInterviewError):
            self.repository.save(_interview("interview-a", result=_result()))
        self.assertIsNone(self.repository.get("interview-a").result)  # type: ignore[union-attr]

    def test_phone_like_identifier_is_rejected_but_uuid_is_allowed(self) -> None:
        phone_like = _interview("8190" + "1234" + "5678")
        with self.assertRaises(RepositoryOperationError):
            self.repository.save(phone_like)
        uuid_record = _interview(
            "-".join(("1234" + "5678", "1234", "1234", "1234", "1234" + "5678" + "9012"))
        )
        self.repository.save(uuid_record)
        self.assertIsNotNone(self.repository.get(uuid_record.interview_id))

    def test_result_insert_failure_rolls_back_parent(self) -> None:
        self.repository.initialize()
        with _database(self.path) as connection:
            connection.execute(
                """
                CREATE TRIGGER reject_result BEFORE INSERT ON safety_interview_results
                BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END
                """
            )
        with self.assertRaises(RepositoryOperationError):
            self.repository.save(_interview("interview-a", result=_result()))
        self.assertIsNone(self.repository.get("interview-a"))

    def test_corrupt_stored_values_are_rejected_not_repaired(self) -> None:
        corruptions = (
            ("status", "not-a-status", RepositoryDataError),
            ("created_at", "not-a-date", RepositoryDataError),
        )
        for field_name, value, expected in corruptions:
            with self.subTest(field_name=field_name):
                path = Path(self.temporary_directory.name) / f"{field_name}.db"
                repository = SqliteInterviewRepository(path)
                repository.save(_interview("interview-a"))
                with _database(path) as connection:
                    connection.execute("PRAGMA ignore_check_constraints = ON")
                    connection.execute(
                        f"UPDATE safety_interviews SET {field_name} = ? WHERE interview_id = ?",
                        (value, "interview-a"),
                    )
                with self.assertRaises(expected):
                    repository.get("interview-a")

    def test_corrupt_boolean_and_evidence_are_rejected(self) -> None:
        for field_name, value in (
            ("near_miss_occurred", 9),
            ("evidence_json", "not-json"),
        ):
            with self.subTest(field_name=field_name):
                path = Path(self.temporary_directory.name) / f"result-{field_name}.db"
                repository = SqliteInterviewRepository(path)
                repository.save(_interview("interview-a", result=_result()))
                with _database(path) as connection:
                    connection.execute("PRAGMA ignore_check_constraints = ON")
                    connection.execute(
                        f"UPDATE safety_interview_results SET {field_name} = ? WHERE interview_id = ?",
                        (value, "interview-a"),
                    )
                with self.assertRaises(RepositoryDataError):
                    repository.get("interview-a")

    def test_memory_and_sqlite_use_the_same_deterministic_order(self) -> None:
        memory = MemoryInterviewRepository()
        newer = datetime(2026, 8, 4, 12, tzinfo=timezone.utc)
        records = (
            _interview("z-last", created_at=newer - timedelta(hours=1)),
            _interview("b-tie", created_at=newer),
            _interview("a-tie", created_at=newer),
        )
        for record in records:
            memory.save(record)
            self.repository.save(record)
        expected = ("a-tie", "b-tie", "z-last")
        self.assertEqual(tuple(item.interview_id for item in memory.list()), expected)
        self.assertEqual(tuple(item.interview_id for item in self.repository.list()), expected)


if __name__ == "__main__":
    unittest.main()
