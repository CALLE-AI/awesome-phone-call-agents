"""Public English reference and no-call reviewer-path regression coverage."""

from contextlib import ExitStack
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from scripts.prepare_demo import prepare_demo
from shift_safety_call_agent.adapters.sqlite_repository import SqliteInterviewRepository
from shift_safety_call_agent.adapters.web.app import API_PREFIX, create_app
from shift_safety_call_agent.application.calle_planning import (
    ENGLISH_SAFETY_TASK_VERSION,
    build_english_safety_task,
    create_calle_preview_plan,
)
from shift_safety_call_agent.cli import main


APP_ROOT = Path(__file__).resolve().parents[2]


class PublicCandidateTests(unittest.TestCase):
    def test_reference_and_readme_make_only_publicly_verifiable_validation_claims(self) -> None:
        self.assertEqual(ENGLISH_SAFETY_TASK_VERSION, "en-safety-v2")
        self.assertTrue(build_english_safety_task().isascii())
        self.assertEqual(create_calle_preview_plan("no-incident").language, "English")

        readme = (APP_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn(
            "The public `en-safety-v2` task is an English reference task",
            readme,
        )
        self.assertIn("It has NOT been live-call validated", readme)
        self.assertIn("deterministic Fake Provider scenarios", readme)

        self.assertNotIn(
            "The hackathon project was live-validated with a Japanese-localized task",
            readme,
        )
        self.assertNotIn("Private `ja-safety-v2`", readme)
        self.assertNotIn(
            "a normalized structured result, and `action_required`",
            readme,
        )

        self.assertIn("does not provide automated safety clearance", readme)

    def test_candidate_has_no_cjk_content_or_shipped_runtime_artifacts(self) -> None:
        excluded = {".venv", "venv", "__pycache__", ".pytest_cache", "runtime", "build", "dist"}
        paths = [
            path for path in APP_ROOT.rglob("*")
            if path.is_file()
            and not any(part in excluded or part.endswith(".egg-info") for part in path.relative_to(APP_ROOT).parts)
        ]
        self.assertGreater(len(paths), 50)
        for path in paths:
            relative = path.relative_to(APP_ROOT)
            with self.subTest(path=relative.as_posix()):
                self.assertNotIn(".git", relative.parts)
                self.assertNotEqual(path.name, ".env")
                self.assertFalse(path.name.startswith(".env."))
                self.assertNotIn(path.suffix.lower(), {".db", ".sqlite", ".pyc", ".log", ".png", ".jpg", ".gif", ".wav", ".mp3", ".mp4"})
                content = path.read_text(encoding="utf-8")
                self.assertFalse(any(
                    0x2E80 <= ord(char) <= 0x9FFF
                    or 0xAC00 <= ord(char) <= 0xD7AF
                    or 0xF900 <= ord(char) <= 0xFAFF
                    or 0xFF66 <= ord(char) <= 0xFF9F
                    or 0x20000 <= ord(char) <= 0x323AF
                    for char in content
                ), "Repository-facing CJK content is forbidden")

    def test_judge_path_is_fake_without_credentials_or_live_factory(self) -> None:
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {"CALL_PROVIDER": "fake", "ALLOW_REAL_CALLS": "false"}, clear=True))
            for target in (
                "shift_safety_call_agent.adapters.calle_live.ProductionCalleClientFactory.create",
                "socket.create_connection",
                "httpx.HTTPTransport.handle_request",
            ):
                stack.enter_context(patch(target, side_effect=AssertionError("No-call demo crossed a live boundary")))
            runtime = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            first = prepare_demo(runtime)
            before = first.read_bytes()
            second = prepare_demo(runtime)
            self.assertNotEqual(first, second)
            self.assertEqual(first.read_bytes(), before)
            self.assertEqual(len(SqliteInterviewRepository(second).list()), 4)
            repository = SqliteInterviewRepository(first)
            self.assertEqual(len(repository.list()), 4)
            client = stack.enter_context(TestClient(create_app(repository=repository, app_version="0.9.0-dev")))
            self.assertEqual(client.get("/app").status_code, 200)
            health = client.get(f"{API_PREFIX}/health").json()
            self.assertEqual(health["provider"], "fake")
            self.assertFalse(health["real_calls_enabled"])
            items = client.get(f"{API_PREFIX}/interviews").json()["items"]
            self.assertEqual(len(items), 4)
            expected = {
                "no-incident": "no_immediate_action",
                "minor-near-miss": "action_required",
                "equipment-follow-up": "action_required",
                "incomplete-answers": "needs_clarification",
            }
            for item in items:
                self.assertEqual(item["status"], "completed")
                self.assertEqual(item["review_disposition"], expected[item["scenario_name"]])
                detail = client.get(f"{API_PREFIX}/interviews/{item['interview_id']}").json()
                self.assertNotIn("evidence", detail)
                self.assertNotIn("transcript", detail)
                if item["scenario_name"] == "incomplete-answers":
                    self.assertEqual(detail["incident_level"], "unknown")
                    self.assertIsNone(detail["requires_follow_up"])
                    self.assertIsNone(detail["equipment_issue_occurred"])
                    self.assertIn("Contact the worker for the missing required answers.", detail["suggested_human_actions"])
                if item["scenario_name"] == "equipment-follow-up":
                    self.assertEqual(detail["suggested_human_actions"], [
                        "Human review required.",
                        "Keep the fictional tool out of service.",
                        "Arrange human inspection before reuse.",
                    ])
            output = io.StringIO()
            self.assertEqual(main(["preview-calle", "--scenario", "no-incident", "--show-task"], output=output), 0)
            self.assertIn("Language: English", output.getvalue())
            self.assertIn("No phone call will be placed", output.getvalue())
            self.assertNotIn("CALLE_API_KEY", os.environ)
            self.assertNotIn("CALLE_RECIPIENT_E164", os.environ)


if __name__ == "__main__":
    unittest.main()
