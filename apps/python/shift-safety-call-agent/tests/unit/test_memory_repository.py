"""Unit tests for in-memory persistence behavior."""

import unittest
from datetime import datetime, timezone

from shift_safety_call_agent.adapters.memory_repository import DuplicateInterviewError, MemoryInterviewRepository
from shift_safety_call_agent.domain.enums import InterviewStatus
from shift_safety_call_agent.domain.models import SafetyInterview


def _interview(identifier: str) -> SafetyInterview:
    return SafetyInterview(
        interview_id=identifier,
        created_at=datetime(2026, 8, 2, tzinfo=timezone.utc),
        scenario_name="no-incident",
        recipient_alias="fictional-worker",
    )


class MemoryRepositoryTests(unittest.TestCase):
    """Verify storage isolation and overwrite prevention."""

    def test_save_get_and_list_return_defensive_copies(self) -> None:
        repository = MemoryInterviewRepository()
        source = _interview("interview-1")
        repository.save(source)
        source.status = InterviewStatus.FAILED
        loaded = repository.get("interview-1")
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertIs(loaded.status, InterviewStatus.DRAFT)
        self.assertEqual(repository.list(), (loaded,))

    def test_duplicate_identifier_never_overwrites_existing_record(self) -> None:
        repository = MemoryInterviewRepository()
        repository.save(_interview("interview-1"))
        duplicate = _interview("interview-1")
        duplicate.status = InterviewStatus.CANCELLED
        with self.assertRaises(DuplicateInterviewError):
            repository.save(duplicate)
        stored = repository.get("interview-1")
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertIs(stored.status, InterviewStatus.DRAFT)


if __name__ == "__main__":
    unittest.main()
