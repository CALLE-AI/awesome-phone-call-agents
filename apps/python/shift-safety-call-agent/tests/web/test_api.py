"""Socket-free TestClient coverage for the local Fake Provider API."""

from __future__ import annotations

import importlib.util
import json
import socket
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


WEB_AVAILABLE = all(
    importlib.util.find_spec(package) is not None
    for package in ("fastapi", "httpx", "pydantic", "starlette")
)

if WEB_AVAILABLE:
    import httpx
    from fastapi.testclient import TestClient

    from shift_safety_call_agent.adapters.sqlite_repository import (
        SqliteInterviewRepository,
    )
    from shift_safety_call_agent.adapters.web.app import create_app
    from shift_safety_call_agent.application.repository_errors import (
        RepositoryDataError,
        RepositoryOperationError,
    )
    from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
    from shift_safety_call_agent.domain.models import (
        SafetyInterview,
        SafetyInterviewResult,
    )


FIXED_TIME = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)
API_PREFIX = "/api/v1"


def _blocked(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("external network attempted")


_ORIGINAL_SOCKET_CONNECT = socket.socket.connect


def _block_external_socket_connect(
    target_socket: socket.socket, address: object
) -> object:
    if isinstance(address, tuple) and address and address[0] in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        return _ORIGINAL_SOCKET_CONNECT(target_socket, address)
    raise AssertionError("external socket connect attempted")


@unittest.skipUnless(WEB_AVAILABLE, "optional web dependencies are not installed")
class LocalApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.database_path = Path(self.temporary_directory.name) / "api.db"
        self.repository = SqliteInterviewRepository(self.database_path)
        self.next_identifier = 0
        self.app = create_app(
            repository=self.repository,
            app_version="0.9.0-dev",
            clock=lambda: FIXED_TIME,
            id_generator=self._new_identifier,
        )
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)
        blockers = (
            patch.object(socket, "create_connection", side_effect=_blocked),
            patch.object(socket.socket, "connect", new=_block_external_socket_connect),
            patch.object(httpx.HTTPTransport, "handle_request", side_effect=_blocked),
        )
        for blocker in blockers:
            blocker.start()
            self.addCleanup(blocker.stop)

    def _new_identifier(self) -> str:
        self.next_identifier += 1
        return f"interview-web-{self.next_identifier:03d}"

    def _post(self, scenario: str, alias: str = "demo-worker"):
        return self.client.post(
            f"{API_PREFIX}/interviews/fake",
            json={"scenario": scenario, "recipient_alias": alias},
        )

    def assert_public_payload(self, payload: object) -> None:
        forbidden_keys = {
            "evidence",
            "task",
            "transcript",
            "phone",
            "phone_number",
            "api_key",
            "authorization",
            "raw_response",
            "database_path",
        }

        def walk(value: object) -> None:
            if isinstance(value, dict):
                self.assertTrue(forbidden_keys.isdisjoint(key.lower() for key in value))
                for item in value.values():
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)

        walk(payload)

    def test_factory_does_not_create_database_until_a_request(self) -> None:
        separate_path = Path(self.temporary_directory.name) / "not-created.db"
        create_app(
            repository=SqliteInterviewRepository(separate_path),
            app_version="0.9.0-dev",
        )
        self.assertFalse(separate_path.exists())

    def test_health_reports_only_local_safe_state(self) -> None:
        response = self.client.get(f"{API_PREFIX}/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "version": "0.9.0-dev",
                "storage": "sqlite",
                "provider": "fake",
                "real_calls_enabled": False,
            },
        )
        self.assert_public_payload(response.json())

    def test_scenarios_are_four_fictional_phone_free_options(self) -> None:
        response = self.client.get(f"{API_PREFIX}/scenarios")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            [item["id"] for item in payload],
            [
                "no-incident",
                "minor-near-miss",
                "equipment-follow-up",
                "incomplete-answers",
            ],
        )
        rendered = json.dumps(payload)
        self.assertNotRegex(rendered, r"(?<!\d)\+?[1-9]\d{7,14}(?!\d)")
        self.assert_public_payload(payload)

    def test_all_fake_scenarios_return_201_and_persist(self) -> None:
        for scenario in (
            "no-incident",
            "minor-near-miss",
            "equipment-follow-up",
            "incomplete-answers",
        ):
            with self.subTest(scenario=scenario):
                response = self._post(scenario)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(
                    response.headers["location"],
                    f"{API_PREFIX}/interviews/{response.json()['interview_id']}",
                )
                self.assert_public_payload(response.json())
        self.assertEqual(len(self.repository.list()), 4)

    def test_fake_create_rejects_unknown_extra_provider_and_unsafe_aliases(self) -> None:
        unsafe_requests = (
            {"scenario": "unknown"},
            {"scenario": "no-incident", "extra": "value"},
            {"scenario": "no-incident", "provider": "fake"},
            {
                "scenario": "no-incident",
                "recipient_alias": "demo-" + "8190" + "1234" + "5678",
            },
            {
                "scenario": "no-incident",
                "recipient_alias": "demo-090-1234-5678",
            },
            {
                "scenario": "no-incident",
                "recipient_alias": "demo-person" + "@" + "example.invalid",
            },
            {"scenario": "no-incident", "recipient_alias": "demo-line\nbreak"},
            {"scenario": "no-incident", "recipient_alias": "demo-" + "x" * 60},
        )
        for request_body in unsafe_requests:
            with self.subTest(keys=tuple(request_body)):
                response = self.client.post(
                    f"{API_PREFIX}/interviews/fake", json=request_body
                )
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["error"]["code"], "validation_error")
                rendered = response.text
                for value in request_body.values():
                    if isinstance(value, str) and value not in {
                        "no-incident",
                        "unknown",
                        "fake",
                        "value",
                    }:
                        self.assertNotIn(value, rendered)
        self.assertEqual(self.repository.list(), ())

    def test_duplicate_identifier_is_safe_409(self) -> None:
        app = create_app(
            repository=self.repository,
            app_version="0.9.0-dev",
            clock=lambda: FIXED_TIME,
            id_generator=lambda: "interview-duplicate",
        )
        with TestClient(app, raise_server_exceptions=False) as client:
            self.assertEqual(
                client.post(
                    f"{API_PREFIX}/interviews/fake", json={"scenario": "no-incident"}
                ).status_code,
                201,
            )
            duplicate = client.post(
                f"{API_PREFIX}/interviews/fake", json={"scenario": "no-incident"}
            )
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["error"]["code"], "duplicate_interview")

    def test_list_supports_order_pagination_and_filters(self) -> None:
        result_false = SafetyInterviewResult(
            work_summary="A fictional shift was completed.",
            incident_level=IncidentLevel.NONE,
            near_miss_occurred=False,
            equipment_issue_occurred=False,
            injury_or_health_issue=False,
            handover_notes=None,
            requires_follow_up=False,
            confidence=0.8,
            evidence=("A fictional statement was recorded.",),
            summary="No fictional concern was reported.",
        )
        result_null = SafetyInterviewResult(
            work_summary=None,
            incident_level=IncidentLevel.UNKNOWN,
            near_miss_occurred=None,
            equipment_issue_occurred=None,
            injury_or_health_issue=None,
            handover_notes=None,
            requires_follow_up=None,
            confidence=None,
            evidence=(),
            summary="The fictional answers remain unknown.",
        )
        records = (
            SafetyInterview(
                interview_id="interview-old",
                created_at=FIXED_TIME - timedelta(hours=1),
                scenario_name="no-incident",
                recipient_alias="demo-worker",
                status=InterviewStatus.COMPLETED,
                result=result_false,
            ),
            SafetyInterview(
                interview_id="interview-new-b",
                created_at=FIXED_TIME,
                scenario_name="incomplete-answers",
                recipient_alias="demo-worker",
                status=InterviewStatus.COMPLETED,
                result=result_null,
            ),
            SafetyInterview(
                interview_id="interview-new-a",
                created_at=FIXED_TIME,
                scenario_name="no-incident",
                recipient_alias="demo-worker",
                status=InterviewStatus.COMPLETED,
                result=result_false,
            ),
        )
        for record in records:
            self.repository.save(record)

        response = self.client.get(f"{API_PREFIX}/interviews")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            [item["interview_id"] for item in payload["items"]],
            ["interview-new-a", "interview-new-b", "interview-old"],
        )
        self.assertIs(payload["items"][0]["requires_follow_up"], False)
        self.assertIsNone(payload["items"][1]["requires_follow_up"])
        self.assertEqual(payload["items"][1]["review_disposition"], "needs_clarification")
        page = self.client.get(f"{API_PREFIX}/interviews?limit=1&offset=1").json()
        self.assertEqual(page["count"], 3)
        self.assertEqual([item["interview_id"] for item in page["items"]], ["interview-new-b"])
        self.assertEqual(
            self.client.get(f"{API_PREFIX}/interviews?status=completed").json()["count"],
            3,
        )
        self.assertEqual(
            self.client.get(f"{API_PREFIX}/interviews?incident_level=unknown").json()["count"],
            1,
        )
        self.assertEqual(
            self.client.get(f"{API_PREFIX}/interviews?requires_follow_up=false").json()["count"],
            2,
        )
        self.assertEqual(
            self.client.get(
                f"{API_PREFIX}/interviews?review_disposition=needs_clarification"
            ).json()["count"],
            3,
        )
        self.assert_public_payload(payload)

    def test_list_rejects_invalid_filters_without_echoing_values(self) -> None:
        for query in (
            "limit=0",
            "limit=101",
            "offset=-1",
            "status=not-valid",
            "incident_level=not-valid",
            "requires_follow_up=not-valid",
            "review_disposition=not-valid",
        ):
            response = self.client.get(f"{API_PREFIX}/interviews?{query}")
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["error"]["code"], "validation_error")
            self.assertNotIn("not-valid", response.text)

    def test_detail_preserves_result_absence_unknown_and_confidence(self) -> None:
        draft = SafetyInterview(
            interview_id="interview-draft",
            created_at=FIXED_TIME,
            scenario_name="no-incident",
            recipient_alias="demo-worker",
        )
        self.repository.save(draft)
        response = self.client.get(f"{API_PREFIX}/interviews/interview-draft")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsNone(payload["incident_level"])
        self.assertIsNone(payload["near_miss_occurred"])
        self.assertIsNone(payload["confidence"])
        self.assertEqual(payload["evidence_count"], 0)
        self.assertEqual(payload["review_disposition"], "not_assessed")
        self.assertEqual(payload["suggested_human_actions"], [])
        self.assert_public_payload(payload)

        created = self._post("incomplete-answers")
        detail = self.client.get(created.headers["location"]).json()
        self.assertEqual(detail["incident_level"], "unknown")
        self.assertIsNone(detail["near_miss_occurred"])
        self.assertEqual(detail["confidence"], 0.0)
        self.assertEqual(detail["evidence_count"], 1)
        self.assertEqual(detail["review_disposition"], "needs_clarification")
        self.assertEqual(
            detail["review_basis"],
            [
                "Safety assessment could not be completed.",
                "Required answers are unavailable.",
            ],
        )
        self.assert_public_payload(detail)

    def test_fake_review_queue_counts_filter_and_human_actions_are_additive(self) -> None:
        for scenario in (
            "no-incident",
            "minor-near-miss",
            "equipment-follow-up",
            "incomplete-answers",
        ):
            self._post(scenario)
        payload = self.client.get(f"{API_PREFIX}/interviews").json()
        self.assertEqual(
            payload["review_counts"],
            {
                "action_required": 2,
                "needs_clarification": 1,
                "no_immediate_action": 1,
                "not_assessed": 0,
            },
        )
        action_page = self.client.get(
            f"{API_PREFIX}/interviews?review_disposition=action_required"
        ).json()
        self.assertEqual(action_page["count"], 2)
        equipment = next(
            item for item in action_page["items"]
            if item["scenario_name"] == "equipment-follow-up"
        )
        detail = self.client.get(
            f"{API_PREFIX}/interviews/{equipment['interview_id']}"
        ).json()
        self.assertEqual(
            detail["suggested_human_actions"],
            [
                "Human review required.",
                "Keep the fictional tool out of service.",
                "Arrange human inspection before reuse.",
            ],
        )
        self.assert_public_payload(payload)
        self.assert_public_payload(detail)

    def test_missing_detail_is_safe_404(self) -> None:
        response = self.client.get(f"{API_PREFIX}/interviews/missing")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.json(),
            {
                "error": {
                    "code": "interview_not_found",
                    "message": "The requested interview was not found.",
                }
            },
        )

    def test_repository_and_internal_errors_are_redacted(self) -> None:
        sensitive_fragments = (
            "SELECT * FROM safety_interviews",
            str(self.database_path),
            "api" + "_key=synthetic-secret-value",
            "8190" + "1234" + "5678",
        )

        class FailingRepository:
            def __init__(self, error: Exception) -> None:
                self.error = error

            def list(self):
                raise self.error

            def get(self, _identifier: str):
                raise self.error

            def save(self, _interview: object) -> None:
                raise self.error

        for error, expected_status, expected_code in (
            (
                RepositoryOperationError(" ".join(sensitive_fragments)),
                503,
                "repository_unavailable",
            ),
            (
                RepositoryDataError(" ".join(sensitive_fragments)),
                500,
                "repository_data_error",
            ),
            (ValueError(" ".join(sensitive_fragments)), 500, "internal_error"),
        ):
            with self.subTest(expected_code=expected_code):
                app = create_app(
                    repository=FailingRepository(error),  # type: ignore[arg-type]
                    app_version="0.9.0-dev",
                )
                with TestClient(app, raise_server_exceptions=False) as client:
                    response = client.get(f"{API_PREFIX}/health")
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.json()["error"]["code"], expected_code)
                for fragment in sensitive_fragments:
                    self.assertNotIn(fragment, response.text)
                self.assertNotIn("Traceback", response.text)

    def test_openapi_exposes_only_safe_gets_and_fake_post(self) -> None:
        schema = self.app.openapi()
        self.assertEqual(schema["info"]["title"], "Shift Safety Call Agent Local API")
        self.assertEqual(schema["info"]["version"], "0.9.0-dev")
        self.assertEqual(
            set(schema["paths"]),
            {
                "/",
                f"{API_PREFIX}/health",
                f"{API_PREFIX}/scenarios",
                f"{API_PREFIX}/interviews/fake",
                f"{API_PREFIX}/interviews",
                f"{API_PREFIX}/interviews/{{interview_id}}",
            },
        )
        for path, operations in schema["paths"].items():
            self.assertTrue(set(operations) <= {"get", "post"}, path)
        self.assertEqual(set(schema["paths"][f"{API_PREFIX}/interviews/fake"]), {"post"})
        components = schema.get("components", {})
        self.assertNotIn("securitySchemes", components)
        rendered = json.dumps(schema).lower()
        for forbidden in (
            '"phone_number"',
            '"api_key"',
            '"authorization"',
            '"transcript"',
            '"task"',
            '"evidence"',
            "run-calle",
        ):
            self.assertNotIn(forbidden, rendered)
        request_schema = components["schemas"]["FakeInterviewRequest"]
        self.assertEqual(request_schema["additionalProperties"], False)
        self.assertIn("scenario", request_schema["required"])
        self.assertIn("ErrorResponse", components["schemas"])

    def test_cors_is_absent(self) -> None:
        self.assertEqual(self.app.user_middleware, [])
        response = self.client.options(
            f"{API_PREFIX}/health",
            headers={"Origin": "http://example.invalid"},
        )
        self.assertNotIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
