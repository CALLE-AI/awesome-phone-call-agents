"""No-call tests: dependency-injected provider, no credentials or network."""

from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from callops import InputError
from dispatch import dispatch, read_status


REQUEST = {"task_id": "synthetic-dispatch-test", "service": "Fictional bicycle tune-up", "requested_window": "Tuesday"}
PHONE = "+12025550123"  # Reserved fictional 555-01xx range; injected fake only.


class FakeCalls:
    def __init__(self, *, fail=False):
        self.create_count = 0
        self.get_count = 0
        self.fail = fail
        self.arguments = None

    def create(self, **kwargs):
        self.create_count += 1
        self.arguments = kwargs
        if self.fail:
            raise TimeoutError("Synthetic lost response containing private text")
        return {"id": "call_synthetic_001", "status": "queued"}

    def get(self, call_id):
        self.get_count += 1
        return {"id": call_id, "status": "completed", "transcript": "Synthetic private test transcript"}


class FakeClient:
    def __init__(self, calls):
        self.calls = calls


def factory_for(calls):
    @contextmanager
    def factory(api_key):
        yield FakeClient(calls)
    return factory


class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.receipt = Path(self.temp.name) / "private-receipt.json"
        self.key_patch = patch.dict(os.environ, {"CALLE_API_KEY": "synthetic-not-a-real-key"})
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)

    def test_default_preview_cannot_construct_client_or_create_receipt(self):
        def forbidden(_key):
            self.fail("Preview constructed a provider client")
        result = dispatch(REQUEST, phone=PHONE, receipt_path=self.receipt, client_factory=forbidden)
        self.assertEqual(result["mode"], "PREVIEW_NO_NETWORK")
        self.assertNotIn(PHONE, json.dumps(result))
        self.assertFalse(self.receipt.exists())

    def test_live_missing_consent_is_blocked_before_provider(self):
        calls = FakeCalls()
        with self.assertRaises(InputError):
            dispatch(REQUEST, phone=PHONE, region="US", locale="en-US", live=True, receipt_path=self.receipt, client_factory=factory_for(calls))
        self.assertEqual(calls.create_count, 0)
        self.assertFalse(self.receipt.exists())

    def test_live_once_persists_id_and_blocks_repeat(self):
        calls = FakeCalls()
        kwargs = dict(phone=PHONE, region="US", locale="en-US", live=True, recipient_consent=True, receipt_path=self.receipt, client_factory=factory_for(calls))
        result = dispatch(REQUEST, **kwargs)
        self.assertEqual(calls.create_count, 1)
        self.assertEqual(calls.arguments["recipients"][0]["phones"], [PHONE])
        self.assertTrue(calls.arguments["idempotency_key"].startswith("znak-callops-"))
        self.assertEqual(result["call_id"], "call_synthetic_001")
        self.assertNotIn(PHONE, json.dumps(result))
        self.assertEqual(json.loads(self.receipt.read_text())["call_id"], "call_synthetic_001")
        with self.assertRaises(InputError):
            dispatch(REQUEST, **kwargs)
        self.assertEqual(calls.create_count, 1)

    def test_lost_response_never_retries_and_preserves_ambiguity(self):
        calls = FakeCalls(fail=True)
        kwargs = dict(phone=PHONE, region="US", locale="en-US", live=True, recipient_consent=True, receipt_path=self.receipt, client_factory=factory_for(calls))
        result = dispatch(REQUEST, **kwargs)
        self.assertEqual(result["state"], "AMBIGUOUS_STOP_NO_RETRY")
        self.assertEqual(calls.create_count, 1)
        self.assertIsNone(json.loads(self.receipt.read_text())["call_id"])
        self.assertNotIn("private text", self.receipt.read_text())
        with self.assertRaises(InputError):
            dispatch(REQUEST, **kwargs)
        self.assertEqual(calls.create_count, 1)

    def test_status_reads_saved_id_without_redial_or_transcript_logging(self):
        calls = FakeCalls()
        factory = factory_for(calls)
        dispatch(REQUEST, phone=PHONE, region="US", locale="en-US", live=True, recipient_consent=True, receipt_path=self.receipt, client_factory=factory)
        result = read_status(self.receipt, client_factory=factory)
        self.assertEqual(calls.create_count, 1)
        self.assertEqual(calls.get_count, 1)
        self.assertEqual(result["provider_status"], "completed")
        self.assertNotIn("private test transcript", json.dumps(result))
        self.assertIn("private test transcript", self.receipt.read_text())

    @unittest.skipUnless(importlib.util.find_spec("calle") and importlib.util.find_spec("httpx"), "optional calle-ai SDK not installed")
    def test_real_sdk_with_in_memory_transport_sends_exactly_one_official_request(self):
        import httpx
        requests = []

        def responder(request):
            requests.append(request)
            return httpx.Response(201, json={"id": "call_sdk_synthetic_002", "status": "queued"})

        # Import and execute the actual SDK, while replacing its HTTP transport
        # with an in-memory responder. No socket or real API credential is used.
        with patch("httpx.HTTPTransport", return_value=httpx.MockTransport(responder)) as transport:
            result = dispatch(REQUEST, phone=PHONE, region="US", locale="en-US", live=True, recipient_consent=True, receipt_path=self.receipt)
        self.assertEqual(result["call_id"], "call_sdk_synthetic_002")
        self.assertEqual(len(requests), 1)
        self.assertEqual(str(requests[0].url), "https://api.heycall-e.com/v1/calls")
        self.assertEqual(requests[0].method, "POST")
        self.assertEqual(json.loads(requests[0].content)["recipients"][0]["phones"], [PHONE])
        transport.assert_called_once_with(retries=0)


if __name__ == "__main__":
    unittest.main()
