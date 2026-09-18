"""Loopback-only fixture demo. This server has no route capable of placing calls."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from rescue import ROOT, fixture, inspect_catalog, preview, reconcile


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, content_type="application/json"):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        route = urlparse(self.path)
        if route.path == "/":
            return self.reply(200, (ROOT / "index.html").read_text(), "text/html; charset=utf-8")
        if route.path == "/api/demo":
            try:
                scenario = parse_qs(route.query).get("scenario", ["confirmed"])[0]
                raw = (ROOT / "fixtures/catalog.csv").read_text()
                catalog = inspect_catalog(raw)
                call = fixture(catalog, scenario)
                return self.reply(200, json.dumps({"csv": raw, "catalog": catalog, "plan": preview(catalog),
                                                   "call": call, "review": reconcile(catalog, call)}))
            except ValueError as exc:
                return self.reply(400, json.dumps({"error": str(exc)}))
        return self.reply(404, json.dumps({"error": "Not found"}))

    def do_POST(self):
        return self.reply(405, json.dumps({"error": "No live calls or data writes are available from the demo server."}))


def serve(port):
    print(f"Import Rescue fixture demo: http://127.0.0.1:{port}. No real calls.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
