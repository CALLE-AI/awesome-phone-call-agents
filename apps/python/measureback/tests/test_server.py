"""Local HTTP boundaries and export tests. No provider calls are made."""

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import http.client
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from measureback import calle
from measureback.__main__ import main
from measureback.examples import STAGES, example
from measureback.recipe import validate_recipe
from measureback.server import MAX_BODY_BYTES, STATIC_ASSETS, create_server, example_report, export_site


def request_fixture():
    now = datetime.now(timezone.utc)
    return {"request_id": "approved_recipe", "phone": "+12025550123", "requester": "Alex", "cook_name": "Sam", "recipe_title": "Rice", "region": "US", "locale": "en-US", "consent": True, "sharing_consent": True, "window_start": (now - timedelta(minutes=1)).isoformat(), "window_end": (now + timedelta(minutes=10)).isoformat()}


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.web = cls.root / "web"
        cls.web.mkdir()
        for name in STATIC_ASSETS:
            (cls.web / name).write_text("<!doctype html><p>Workbench</p>" if name == "index.html" else "asset", encoding="utf-8")
        (cls.web / "secret.env").write_text("PRIVATE_VALUE", encoding="utf-8")
        cls.server = create_server(0, web_root=cls.web, store_path=cls.root / "calls.sqlite3")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        cls.temp.cleanup()

    def request(self, method="GET", path="/api/config", body=None, headers=None, *, server=None, raw=False):
        server = server or self.server
        host = f"127.0.0.1:{server.server_port}"
        request_headers = {"Host": host}
        if method == "POST":
            request_headers.update({"Origin": "http://" + host, "Content-Type": "application/json"})
        request_headers.update(headers or {})
        request_headers = {key: value for key, value in request_headers.items() if value is not None}
        payload = body if raw else (json.dumps(body) if body is not None else None)
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        connection.request(method, path, body=payload, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        result = (response.status, dict(response.getheaders()), data)
        connection.close()
        return result

    def test_binds_only_loopback(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_config_aliases_and_default_mode(self):
        for path in ("/api/config", "/config.json"):
            status, headers, data = self.request(path=path)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(data), {"local": True, "live_enabled": False})
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_security_headers(self):
        status, headers, _ = self.request(path="/")
        self.assertEqual(status, 200)
        self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_foreign_host_and_wrong_port_rejected(self):
        for host in ("evil.example", "localhost", "127.0.0.1:1", "localhost.evil.example:8793"):
            with self.subTest(host=host):
                self.assertEqual(self.request(headers={"Host": host})[0], 403)

    def test_localhost_configured_port_is_allowed(self):
        self.assertEqual(self.request(headers={"Host": f"localhost:{self.server.server_port}"})[0], 200)

    def test_post_requires_same_origin(self):
        for origin in (None, "null", "https://evil.example", f"http://localhost:{self.server.server_port}"):
            with self.subTest(origin=origin):
                self.assertEqual(self.request("POST", "/api/scale", {}, {"Origin": origin})[0], 403)

    def test_post_json_required(self):
        for content_type in (None, "text/plain", "application/x-www-form-urlencoded"):
            with self.subTest(content_type=content_type):
                self.assertEqual(self.request("POST", "/api/scale", {}, {"Content-Type": content_type})[0], 415)

    def test_json_charset_accepted(self):
        self.assertEqual(self.request("POST", "/api/scale", {"recipe": example(), "servings": 6}, {"Content-Type": "application/json; charset=utf-8"})[0], 200)

    def test_payload_cap(self):
        self.assertEqual(self.request("POST", "/api/scale", "x" * (MAX_BODY_BYTES + 1), raw=True)[0], 413)

    def test_malformed_json_rejected(self):
        for body in ("", "{", "[]", "null", "true", "{\"recipe\":NaN}", "{\"recipe\":1,\"recipe\":2}"):
            with self.subTest(body=body):
                self.assertEqual(self.request("POST", "/api/scale", body, raw=True)[0], 400)

    def test_transfer_encoding_rejected(self):
        self.assertEqual(self.request("POST", "/api/scale", {}, {"Transfer-Encoding": "chunked"})[0], 400)

    def test_post_unknown_fields_rejected(self):
        self.assertEqual(self.request("POST", "/api/scale", {"recipe": example(), "servings": 6, "trusted": True})[0], 400)

    def test_scale_returns_validated_recipe_and_report(self):
        status, _, data = self.request("POST", "/api/scale", {"recipe": example(), "servings": 6})
        self.assertEqual(status, 200)
        result = json.loads(data)
        self.assertFalse(result["illustrative"])
        self.assertEqual(result["report"]["ingredients"][0]["scaled"]["quantity"], "750")

    def test_scale_rejects_invalid_recipe_without_echoing_payload(self):
        source = example()
        source["title"] = "PRIVATE_SECRET" * 100
        status, _, data = self.request("POST", "/api/scale", {"recipe": source, "servings": 6})
        self.assertEqual(status, 400)
        self.assertNotIn(b"PRIVATE_SECRET", data)

    def test_serving_input_is_bounded(self):
        for servings in (0, 13, True, "6", None):
            with self.subTest(servings=servings):
                self.assertEqual(self.request("POST", "/api/scale", {"recipe": example(), "servings": servings})[0], 400)

    def test_all_authored_examples_validate(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                validate_recipe(example(stage))
                self.assertTrue(example_report(stage, 6)["illustrative"])

    def test_corrected_six_servings_has_known_quantities(self):
        status, _, data = self.request(path="/api/example?stage=corrected&servings=6")
        self.assertEqual(status, 200)
        result = json.loads(data)
        ingredients = {item["id"]: item for item in result["report"]["ingredients"]}
        self.assertEqual(ingredients["rice"]["scaled"]["quantity"], "750")
        self.assertEqual(ingredients["rice"]["scaled"]["unit"], "ml")
        self.assertEqual(ingredients["water"]["scaled"]["quantity"], "1350")
        self.assertTrue(result["illustrative"])

    def test_unresolved_example_does_not_scale_bowl(self):
        _, _, data = self.request(path="/api/example?stage=unresolved&servings=6")
        self.assertIsNone(json.loads(data)["report"]["ingredients"][0]["scaled"])

    def test_invalid_example_queries_rejected(self):
        for query in ("stage=missing", "servings=13", "servings=true", "servings=6&servings=7", "extra=1", "stage=corrected&servings=6&extra=1"):
            with self.subTest(query=query):
                self.assertEqual(self.request(path="/api/example?" + query)[0], 400)

    def test_static_allowlist_and_traversal(self):
        for path in ("/.env", "/secret.env", "/../measureback/calle.py", "/%2e%2e/secret.env", "/web/index.html", "/data.json"):
            with self.subTest(path=path):
                status, _, data = self.request(path=path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"PRIVATE_VALUE", data)

    def test_static_symlink_is_not_served(self):
        root = self.root / "linked-web"
        root.mkdir(exist_ok=True)
        (root / "index.html").symlink_to(self.web / "secret.env")
        server = create_server(0, web_root=root)
        self.assertNotIn("/index.html", server.assets)
        server.server_close()

    def test_head_has_no_body(self):
        status, headers, data = self.request("HEAD", "/")
        self.assertEqual(status, 200)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(data, b"")

    def test_no_cors_preflight(self):
        status, headers, _ = self.request("OPTIONS", "/api/scale")
        self.assertEqual(status, 405)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_absolute_request_target_rejected(self):
        self.assertEqual(self.request(path="http://evil.example/api/config")[0], 400)

    def test_query_on_post_rejected(self):
        self.assertEqual(self.request("POST", "/api/scale?x=1", {})[0], 400)

    def test_live_execute_and_result_disabled_by_default(self):
        with patch("measureback.server.calle.execute") as execute, patch("measureback.server.calle.get_result") as get_result:
            self.assertEqual(self.request("POST", "/api/call/execute", {})[0], 403)
            self.assertEqual(self.request("POST", "/api/call/result", {})[0], 403)
            execute.assert_not_called()
            get_result.assert_not_called()

    def test_preview_is_keyless_and_masked(self):
        request = request_fixture()
        with patch("measureback.server.calle._http") as network:
            status, _, data = self.request("POST", "/api/call/preview", {"request": request})
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(data)["creates_call"])
        self.assertNotIn(request["phone"].encode(), data)
        network.assert_not_called()

    def test_invalid_preview_error_does_not_echo_inputs(self):
        status, _, data = self.request("POST", "/api/call/preview", {"request": {"secret": "PRIVATE_VALUE"}})
        self.assertEqual(status, 400)
        self.assertNotIn(b"PRIVATE_VALUE", data)

    def test_live_startup_requires_key(self):
        with patch.dict(os.environ, {"CALLE_API_KEY": ""}), self.assertRaises(ValueError):
            create_server(0, live=True)

    def test_environment_key_does_not_enable_live_implicitly(self):
        with patch.dict(os.environ, {"CALLE_API_KEY": "PRIVATE_KEY"}):
            server = create_server(0)
        self.assertFalse(server.live_enabled)
        self.assertEqual(server._api_key, "")
        server.server_close()

    def test_provider_error_body_is_not_exposed(self):
        server = create_server(0, live=True, api_key="PRIVATE_KEY", web_root=self.web)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch("measureback.server.calle.execute", side_effect=calle.CalleError("PRIVATE_KEY full-phone provider-body")):
                status, _, data = self.request("POST", "/api/call/execute", {"request": request_fixture(), "approval_token": "x"}, server=server)
            self.assertEqual(status, 400)
            self.assertNotIn(b"PRIVATE_KEY", data)
            self.assertNotIn(b"provider-body", data)
            _, _, config = self.request(server=server)
            self.assertEqual(json.loads(config), {"local": True, "live_enabled": True})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_result_route_preserves_full_consent_review_contract(self):
        source = example("corrected")
        transcript = [{"speaker": turn["speaker"], "text": turn["text"]} for turn in source["transcript"]]
        consent = {
            "capture": {"turn_id": "t2", "quote": "Yes, you can write it down and share it.", "source_text": source["transcript"][1]["text"]},
            "sharing": {"turn_id": "t9", "quote": "Yes, share that corrected recipe.", "source_text": source["transcript"][-1]["text"]},
            "withdrawal": None,
            "review_note": "Read the source transcript and confirm affirmative capture and sharing consent before importing this recipe.",
            "source_transcript": transcript,
        }
        client_result = {"request_id": "approved_recipe", "call_id": "call_recipe", "state": "completed", "creates_call": False, "recipe": source, "consent_review_required": True, "consent_evidence": consent, "provider_debug": "PRIVATE_PROVIDER_BODY"}
        server = create_server(0, live=True, api_key="PRIVATE_KEY", web_root=self.web, store_path=self.root / "review-calls.sqlite3")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch("measureback.server.calle.get_result", return_value=client_result) as get_result, patch("measureback.server.calle._http") as network:
                status, _, data = self.request("POST", "/api/call/result", {"call_id": "call_recipe"}, server=server)
            self.assertEqual(status, 200)
            result = json.loads(data)
            self.assertIs(result["consent_review_required"], True)
            self.assertEqual(result["consent_evidence"], consent)
            self.assertEqual(result["consent_evidence"]["source_transcript"], transcript)
            self.assertEqual(result["recipe"], source)
            self.assertEqual(result["request_id"], "approved_recipe")
            self.assertIsNone(result["consent_evidence"]["withdrawal"])
            self.assertNotIn("provider_debug", result)
            self.assertNotIn(b"PRIVATE_PROVIDER_BODY", data)
            self.assertNotIn(b"PRIVATE_KEY", data)
            get_result.assert_called_once_with("call_recipe", store_path=self.root / "review-calls.sqlite3", api_key="PRIVATE_KEY")
            network.assert_not_called()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_export_contains_authored_data_only(self):
        output = self.root / "export"
        with patch.dict(os.environ, {"CALLE_API_KEY": "PRIVATE_KEY"}):
            exported = export_site(output, web_root=self.web)
        self.assertEqual(exported, output.resolve())
        self.assertEqual(json.loads((output / "config.json").read_text()), {"local": False, "live_enabled": False})
        data = json.loads((output / "data.json").read_text())
        self.assertEqual(set(data["stages"]), set(STAGES))
        self.assertEqual(set(data["stages"]["corrected"]["reports"]), {str(value) for value in range(1, 13)})
        self.assertNotIn("PRIVATE_KEY", (output / "data.json").read_text())
        self.assertFalse((output / "secret.env").exists())
        self.assertEqual(set(path.name for path in output.iterdir()), {*STATIC_ASSETS, "data.json", "config.json"})

    def test_export_refuses_source_destination(self):
        with self.assertRaises(ValueError):
            export_site(self.web, web_root=self.web)

    def test_export_refuses_symlink_destination(self):
        link = self.root / "export-link"
        link.symlink_to(self.web, target_is_directory=True)
        with self.assertRaises(ValueError):
            export_site(link, web_root=self.web)

    def test_export_refuses_existing_private_files(self):
        output = self.root / "private-export"
        output.mkdir()
        private = output / ".env"
        private.write_text("PRIVATE_VALUE", encoding="utf-8")
        with self.assertRaises(ValueError):
            export_site(output, web_root=self.web)
        self.assertEqual(private.read_text(), "PRIVATE_VALUE")
        self.assertFalse((output / "data.json").exists())

    def test_font_and_license_allowlist(self):
        web = self.root / "font-web"
        web.mkdir()
        for name in STATIC_ASSETS:
            (web / name).write_text("asset", encoding="utf-8")
        (web / "fonts").mkdir()
        (web / "fonts" / "AtkinsonHyperlegibleNext.ttf").write_bytes(b"fixture font")
        (web / "fonts" / "OFL.txt").write_text("fixture license", encoding="utf-8")
        (web / "fonts" / "private.txt").write_text("PRIVATE_VALUE", encoding="utf-8")
        server = create_server(0, web_root=web)
        self.assertIn("/fonts/AtkinsonHyperlegibleNext.ttf", server.assets)
        self.assertIn("/fonts/OFL.txt", server.assets)
        self.assertNotIn("/fonts/private.txt", server.assets)
        server.server_close()
        output = self.root / "font-export"
        export_site(output, web_root=web)
        self.assertEqual((output / "fonts" / "AtkinsonHyperlegibleNext.ttf").read_bytes(), b"fixture font")
        self.assertTrue((output / "fonts" / "OFL.txt").is_file())
        self.assertFalse((output / "fonts" / "private.txt").exists())

    def test_cli_example_outputs_valid_json(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main(["example", "--stage", "corrected", "--servings", "6"]), 0)
        self.assertEqual(json.loads(output.getvalue())["report"]["target_servings"], 6)

    def test_cli_rejects_invalid_port(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            main(["serve", "--port", "0"])


if __name__ == "__main__":
    unittest.main()
