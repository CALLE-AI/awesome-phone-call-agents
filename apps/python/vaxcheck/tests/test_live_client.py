"""Live-path integration tests.

These exercise the real CALL-E SDK end to end. Instead of stubbing our own code,
they install an httpx transport under the genuine `CalleClient`, so the SDK does
its real work - signature validation, payload assembly, header handling, polling -
and the test inspects the exact HTTP request CALL-E's API would have received.

That covers everything about the live path except CALL-E's servers actually
dialling a phone.

Skipped when the optional SDK is not installed: `pip install 'calle-ai>=0.7.0'`.
"""

import sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    import httpx
    from calle import CalleClient

    HAVE_SDK = True
except ImportError:  # pragma: no cover
    HAVE_SDK = False

from vaxcheck.classify import records_from_calls
from vaxcheck.roster import load
from vaxcheck.triage import CLEARED, NURSE_REVIEW

if HAVE_SDK:
    from vaxcheck.live_client import LiveClientError, call_student, run_session

ROSTER = ROOT / "fixtures" / "sample_roster.json"

COMPLETED_RESULT = {
    "reached_guardian": "yes", "identity_confirmed": "yes", "consent": "granted",
    "route": "school_session", "prior_dose_reported": "no", "allergy_reported": "none",
    "unwell_today": "no", "callback_requested": "no", "guardian_questions": "",
}


def call_body(call_id="call_live_1", status="completed", result=None):
    """A CALL-E `call_task` response shaped like the real API returns."""
    return {
        "id": call_id, "object": "call_task", "status": status,
        "task": "...", "task_completed": True,
        "completion_confidence": {"score": 0.93, "label": "high"},
        "evidence": ["Guardian consented to the school session."],
        "structured_result": result if result is not None else COMPLETED_RESULT,
        "metadata": {}, "failure_code": None, "failure_message": None,
        "created_at": "2026-09-13T10:00:00Z", "completed_at": "2026-09-13T10:04:00Z",
        "summary": "Guardian consented.",
        "recipients": [{
            "id": "rcp_1", "phones": ["+14155550101"], "locale": None, "region": "US",
            "status": "completed",
            "structured_result": result if result is not None else COMPLETED_RESULT,
            "summary": "Guardian consented.", "attempts": [],
        }],
    }


@unittest.skipUnless(HAVE_SDK, "calle-ai SDK not installed")
class TestLivePath(unittest.TestCase):
    def setUp(self):
        self.session, self.students = load(ROSTER)
        self.requests = []

    def _client(self, handler):
        def record(request: "httpx.Request") -> "httpx.Response":
            self.requests.append(request)
            return handler(request)

        http = httpx.Client(
            base_url="https://api.heycall-e.com",
            headers={"Authorization": "Bearer iams_live_test"},
            transport=httpx.MockTransport(record),
        )
        return CalleClient(api_key="iams_live_test", http_client=http)

    def _ok(self, request):
        if request.method == "POST":
            return httpx.Response(200, json=call_body())
        return httpx.Response(200, json=call_body())

    # ---- request shape ----------------------------------------------------
    def test_create_sends_a_well_formed_payload(self):
        import json

        client = self._client(self._ok)
        call_student(
            self.session, self.students[0],
            api_key="iams_live_test", client=client, timeout_seconds=5,
        )
        post = next(r for r in self.requests if r.method == "POST")
        self.assertEqual(post.url.path, "/v1/calls")
        body = json.loads(post.content)

        self.assertIn("task", body)
        self.assertEqual(body["recipients"][0]["phones"], ["+14155550101"])
        self.assertEqual(body["recipients"][0]["region"], "US")
        self.assertIn("result_schema", body)
        self.assertIn("recipient_result_schema", body)
        self.assertEqual(body["metadata"]["student_id"], "S-041")
        self.assertEqual(body["metadata"]["app"], "vaxcheck")

    def test_idempotency_key_header_is_sent_and_deterministic(self):
        client = self._client(self._ok)
        call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)
        first = self.requests[0].headers.get("Idempotency-Key")
        self.assertEqual(first, "vaxcheck-riverside-primary-school-2026-10-02-S-041")

        self.requests.clear()
        client2 = self._client(self._ok)
        call_student(self.session, self.students[0], api_key="k", client=client2, timeout_seconds=5)
        self.assertEqual(self.requests[0].headers.get("Idempotency-Key"), first)

    def test_schema_sent_matches_the_schema_we_triage_against(self):
        import json

        from vaxcheck.schema import RECIPIENT_RESULT_SCHEMA

        client = self._client(self._ok)
        call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)
        body = json.loads(self.requests[0].content)
        self.assertEqual(body["recipient_result_schema"], RECIPIENT_RESULT_SCHEMA)

    def test_raw_number_goes_only_in_recipients_never_in_the_script(self):
        import json

        client = self._client(self._ok)
        call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)
        body = json.loads(self.requests[0].content)
        self.assertNotIn("+14155550101", body["task"])

    # ---- response handling ------------------------------------------------
    def test_real_response_shape_triages_correctly(self):
        client = self._client(self._ok)
        call = call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)
        records = records_from_calls([(self.students[0], call)])
        self.assertEqual(records[0].triage.disposition, CLEARED)
        self.assertEqual(records[0].confidence, 0.93)
        self.assertTrue(records[0].task_completed)

    def test_severe_allergy_in_a_real_response_never_clears(self):
        flagged = {**COMPLETED_RESULT, "allergy_reported": "severe"}
        client = self._client(lambda r: httpx.Response(200, json=call_body(result=flagged)))
        call = call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)
        records = records_from_calls([(self.students[0], call)])
        self.assertEqual(records[0].triage.disposition, NURSE_REVIEW)

    def test_polls_until_terminal(self):
        seen = {"n": 0}

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json=call_body(status="queued"))
            seen["n"] += 1
            status = "completed" if seen["n"] >= 2 else "in_progress"
            return httpx.Response(200, json=call_body(status=status))

        client = self._client(handler)
        call = call_student(
            self.session, self.students[0], api_key="k", client=client, timeout_seconds=30
        )
        self.assertEqual(call["status"], "completed")
        self.assertGreaterEqual(seen["n"], 2)

    # ---- failure handling -------------------------------------------------
    def test_api_error_becomes_live_client_error(self):
        client = self._client(
            lambda r: httpx.Response(
                401, json={"error": {"code": "unauthorized", "message": "bad key", "details": {}}}
            )
        )
        with self.assertRaises(LiveClientError):
            call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)

    def test_missing_call_id_is_rejected(self):
        client = self._client(lambda r: httpx.Response(200, json={"object": "call_task"}))
        with self.assertRaises(LiveClientError):
            call_student(self.session, self.students[0], api_key="k", client=client, timeout_seconds=5)

    # ---- roster-level ------------------------------------------------------
    def test_run_session_places_one_task_per_student(self):
        client = self._client(self._ok)
        pairs = run_session(
            self.session, self.students[:3], api_key="k", client=client, timeout_seconds=5
        )
        posts = [r for r in self.requests if r.method == "POST"]
        self.assertEqual(len(posts), 3)
        self.assertEqual(len(pairs), 3)
        keys = {r.headers.get("Idempotency-Key") for r in posts}
        self.assertEqual(len(keys), 3, "each student must get a distinct idempotency key")

    def test_empty_roster_is_rejected(self):
        with self.assertRaises(LiveClientError):
            run_session(self.session, [], api_key="k")


if __name__ == "__main__":
    unittest.main()
