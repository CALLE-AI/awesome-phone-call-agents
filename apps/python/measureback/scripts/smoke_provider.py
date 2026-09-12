"""Exercise the CALL E transport seam against a real loopback HTTP server.

This uses authored fixtures, an obviously fake credential and a reserved
fictional phone number. It does not contact CALL E or place a phone call.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading

# Keep the documented direct command runnable without installing a package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from measureback.calle import CalleError, execute, get_result, preview
from measureback.examples import example
from measureback.recipe import scale_recipe


MOCK_KEY = "mock_local_only_not_a_credential"
MOCK_CALL_ID = "call_mock_measureback"
MAX_BODY = 1_000_000


def fixture_result(*, tamper_transcript: bool = False) -> dict:
    recipe = example("corrected")
    raw_turns = [
        {
            "offset_seconds": index * 10,
            "speaker": "user" if turn["speaker"] == "cook" else "bot",
            "text": turn["text"],
        }
        for index, turn in enumerate(recipe["transcript"])
    ]
    if tamper_transcript:
        raw_turns[1]["text"] = "This source text deliberately disagrees with the extracted recipe."
    return {
        "id": MOCK_CALL_ID,
        "status": "completed",
        "structured_result": {"interview_completed": True},
        "recipients": [{
            "structured_result": {
                "consent_to_capture": True,
                "consent_to_share": True,
                "consent_to_capture_evidence": {"turn_id": "t2", "quote": "Yes, you can write it down and share it."},
                "consent_to_share_evidence": {"turn_id": "t9", "quote": "Yes, share that corrected recipe."},
                "consent_withdrawn": False,
                "withdrawal_evidence": None,
                "recipe": recipe,
            },
            "attempts": [{"transcript_turns": raw_turns}],
        }],
    }


@contextmanager
def fake_provider(*, tamper_transcript: bool = False):
    """Expose only two CALL E shaped paths on an ephemeral loopback port."""
    counts = {"post": 0, "get": 0}
    response = fixture_result(tamper_transcript=tamper_transcript)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def send_json(self, payload, status=200):
            encoded = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(encoded)

        def authorized(self):
            if self.headers.get("Authorization") != "Bearer " + MOCK_KEY:
                self.send_json({"error": "Mock authorization mismatch"}, 401)
                return False
            return True

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != "/v1/calls":
                self.send_json({"error": "Unknown mock path"}, 404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_BODY:
                    raise ValueError
                body = json.loads(self.rfile.read(size))
                recipients = body["recipients"]
                assert len(recipients) == 1 and len(recipients[0]["phones"]) == 1
                assert "recipient_result_schema" in body and "result_schema" in body
                assert self.headers.get("Idempotency-Key", "").startswith("measureback_")
            except (ValueError, KeyError, TypeError, AssertionError):
                self.send_json({"error": "Invalid mock request"}, 400)
                return
            counts["post"] += 1
            self.send_json({"id": MOCK_CALL_ID, "status": "queued"}, 201)

        def do_GET(self):
            if not self.authorized():
                return
            if self.path != "/v1/calls/" + MOCK_CALL_ID:
                self.send_json({"error": "Unknown mock path"}, 404)
                return
            counts["get"] += 1
            self.send_json(response)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def transport(method, path, payload, headers):
        if (method, path) not in {
            ("POST", "/v1/calls"),
            ("GET", "/v1/calls/" + MOCK_CALL_ID),
        }:
            raise CalleError("The fake transport refuses this path.")
        body = None if payload is None else json.dumps(payload).encode()
        # This connection is fixed to loopback and never follows redirects.
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            reply = connection.getresponse()
            raw = reply.read(MAX_BODY + 1)
            if reply.status not in (200, 201) or len(raw) > MAX_BODY:
                raise CalleError("The fake provider returned an unexpected response.")
            return json.loads(raw)
        finally:
            connection.close()

    try:
        yield transport, counts
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def run_smoke(*, tamper_transcript: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    request = {
        "request_id": "mock-recipe-interview",
        "phone": "+12025550123",
        "requester": "Example family member",
        "cook_name": "Example cook",
        "recipe_title": "Cumin rice",
        "region": "US",
        "locale": "en-US",
        "consent": True,
        "sharing_consent": True,
        "window_start": (now - timedelta(minutes=1)).isoformat(),
        "window_end": (now + timedelta(minutes=5)).isoformat(),
    }
    approval_token = preview(request, now)["approval_token"]
    with tempfile.TemporaryDirectory(prefix="measureback-fake-provider-") as directory:
        ledger = Path(directory) / "calls.sqlite3"
        with fake_provider(tamper_transcript=tamper_transcript) as (transport, counts):
            first = execute(request, approval_token, store_path=ledger, api_key=MOCK_KEY, now=now, transport=transport)
            duplicate = execute(request, approval_token, store_path=ledger, api_key=MOCK_KEY, now=now, transport=transport)
            result = get_result(first["call_id"], store_path=ledger, api_key=MOCK_KEY, transport=transport)
            recipe = result["recipe"]
            scaled = scale_recipe(recipe, 6)
            water = next(item for item in recipe["ingredients"] if item["id"] == "water")
            scaled_water = next(item for item in scaled["ingredients"] if item["id"] == "water")
            if counts != {"post": 1, "get": 1} or not duplicate["duplicate_prevented"]:
                raise AssertionError("The actual HTTP counts did not match the once-only workflow.")
            return {
                "mode": "local_fake_http",
                "provider_host": "127.0.0.1",
                "real_call_placed": False,
                "post_count": counts["post"],
                "get_count": counts["get"],
                "duplicate_prevented": duplicate["duplicate_prevented"],
                "source_validation": "passed",
                "consent_review_required": result["consent_review_required"],
                "recipe_title": recipe["title"],
                "corrected_water_ml": water["quantity"],
                "scaled_water_ml": scaled_water["scaled"]["quantity"],
                "test_scope": "Actual loopback HTTP through the injected client transport, not a live CALL E endpoint.",
            }


if __name__ == "__main__":
    print(json.dumps(run_smoke(), indent=2))
