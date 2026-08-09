"""Integration proof: the published CALL-E SDK performs real HTTP at runtime."""

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from calle import CalleClient

import client


EXAMPLE = json.loads(
    (Path(__file__).parents[1] / "example_request.json").read_text(encoding="utf-8")
)


class CaptureHandler(BaseHTTPRequestHandler):
    requests = []
    structured = {
        "right_desk": "yes",
        "continued_after_ai_disclosure": "yes",
        "can_receive_at_eta": "yes",
        "dock_plan": "alternate",
        "manual_check_in_required": "yes",
        "next_window_local": "unknown",
        "human_escalation_required": "no",
        "evidence_summary": "Receiving confirmed the ETA and alternate dock.",
    }

    def log_message(self, format, *args):
        return

    def send_payload(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers["Content-Length"])
        payload = json.loads(self.rfile.read(length))
        type(self).requests.append(
            {
                "method": "POST",
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "idempotency_key": self.headers.get("Idempotency-Key"),
                "payload": payload,
            }
        )
        self.send_payload(201, {"id": "call_sdk_capture_001", "status": "queued"})

    def do_GET(self):
        type(self).requests.append({"method": "GET", "path": self.path})
        self.send_payload(
            200,
            {
                "id": "call_sdk_capture_001",
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {"score": 0.96, "label": "high"},
                "structured_result": self.structured,
            },
        )


def test_published_calle_sdk_posts_and_polls_real_http(caplog):
    CaptureHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    request = client.parse_request(EXAMPLE)

    try:
        with caplog.at_level(logging.INFO):
            logging.getLogger("freshchain.sdk-proof").info(
                "calle_sdk_runtime_start base_url=%s", base_url
            )
            with CalleClient(api_key="calle_test_capture", base_url=base_url) as sdk:
                result = client.execute(request, sdk.calls, timeout_seconds=5)
            logging.getLogger("freshchain.sdk-proof").info(
                "calle_sdk_runtime_verified call_id=%s decision=%s",
                result["call_id"],
                result["decision"]["route"],
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert [item["method"] for item in CaptureHandler.requests] == ["POST", "GET"]
    create = CaptureHandler.requests[0]
    assert create["path"] == "/v1/calls"
    assert create["authorization"] == "Bearer calle_test_capture"
    assert create["idempotency_key"] == client.idempotency_key(request)
    assert create["payload"]["result_schema"]["additionalProperties"] is False
    assert CaptureHandler.requests[1]["path"] == "/v1/calls/call_sdk_capture_001"
    assert result["decision"]["route"] == "proceed"
    assert "calle_sdk_runtime_verified" in caplog.text
