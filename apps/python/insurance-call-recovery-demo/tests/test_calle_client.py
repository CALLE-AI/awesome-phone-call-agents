import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from insurance_call_recovery.calle_client import CalleHTTPClient

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length))
        if self.path == "/plan_call":
            payload = {"recovery_id": "irc_test123"}
        else:
            payload = {"ok": True}
        raw = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        raw = json.dumps({
            "status": "completed",
            "transcript": "The claims department confirmed the claim is under review and the next action is adjuster review."
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass

def test_http_adapter_against_fake_server():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = CalleHTTPClient(
            base_url=f"http://127.0.0.1:{server.server_port}",
            token="synthetic-token"
        )
        rid = client.plan_call("synthetic task", "+15555010199", {"status": "..."})
        assert rid == "irc_test123"
        client.run_call(rid)
        result = client.get_call_run(rid)
        assert result.status == "completed"
        assert "under review" in result.transcript
    finally:
        server.shutdown()
        thread.join(timeout=2)
