"""Static-resource, security, and behavior contracts for the local Web UI."""

from __future__ import annotations

from html.parser import HTMLParser
import importlib
import importlib.util
import socket
import tempfile
import tomllib
import unittest
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
    from shift_safety_call_agent.adapters.web import static_files
    from shift_safety_call_agent.adapters.web.static_files import (
        StaticAssetUnavailableError,
    )


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
STATIC_ROOT = (
    REPOSITORY_ROOT
    / "src"
    / "shift_safety_call_agent"
    / "adapters"
    / "web"
    / "static"
)


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


class _HtmlAuditParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[str] = []
        self.attributes: list[tuple[str, dict[str, str | None]]] = []
        self.title_parts: list[str] = []
        self.in_title = False

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        values = dict(attrs)
        self.tags.append(tag)
        self.attributes.append((tag, values))
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


@unittest.skipUnless(WEB_AVAILABLE, "optional web dependencies are not installed")
class LocalUiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.database_path = Path(self.temporary_directory.name) / "ui.db"
        self.app = create_app(
            repository=SqliteInterviewRepository(self.database_path),
            app_version="0.9.0-dev",
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

    def test_fixed_static_routes_have_correct_types_and_do_not_touch_database(self) -> None:
        responses = {
            "/app": "text/html",
            "/assets/app.css": "text/css",
            "/assets/app.js": "application/javascript",
        }
        self.assertFalse(self.database_path.exists())
        for path, media_type in responses.items():
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.headers["content-type"].startswith(media_type))
        self.assertFalse(self.database_path.exists())

    def test_unknown_and_traversal_asset_paths_are_rejected(self) -> None:
        for path in (
            "/assets/missing.css",
            "/assets/%2e%2e/app.html",
            "/assets/..%2fapp.html",
            "/assets/app.css%2f..%2fapp.js",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_static_responses_have_strict_security_headers(self) -> None:
        for path in ("/app", "/assets/app.css", "/assets/app.js"):
            with self.subTest(path=path):
                response = self.client.get(path)
                policy = response.headers["content-security-policy"]
                for directive in (
                    "default-src 'self'",
                    "script-src 'self'",
                    "style-src 'self'",
                    "connect-src 'self'",
                    "object-src 'none'",
                    "base-uri 'none'",
                    "frame-ancestors 'none'",
                    "form-action 'self'",
                ):
                    self.assertIn(directive, policy)
                self.assertNotIn("unsafe-inline", policy)
                self.assertNotIn("unsafe-eval", policy)
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")
                self.assertEqual(response.headers["referrer-policy"], "no-referrer")
                self.assertEqual(response.headers["x-frame-options"], "DENY")
                self.assertEqual(response.headers["cache-control"], "no-store")

    def test_html_structure_accessibility_and_local_assets(self) -> None:
        html = (STATIC_ROOT / "app.html").read_text(encoding="utf-8")
        parser = _HtmlAuditParser()
        parser.feed(html)
        root = next(attrs for tag, attrs in parser.attributes if tag == "html")
        self.assertEqual(root.get("lang"), "en")
        self.assertTrue("".join(parser.title_parts).strip())
        for required_tag in ("header", "main", "form", "label", "button", "h1", "h2"):
            self.assertIn(required_tag, parser.tags)
        for phrase in (
            "Shift Safety Call Agent",
            "DEMO MODE",
            "Fake provider only. No phone call will be placed.",
            "Local only",
            "Run simulated interview",
            "Incident level",
            "Follow-up required",
            "Review disposition",
            "Action required",
            "Needs clarification",
            "No immediate action",
            "Not assessed",
            "Interview records",
            "Interview detail",
            "Facts",
            "Assessment",
            "Provenance",
            "Structured result confidence",
            "Not a safety severity score.",
        ):
            self.assertIn(phrase, html)
        ids = {
            attrs["id"]
            for _tag, attrs in parser.attributes
            if attrs.get("id") is not None
        }
        for required_id in (
            "scenario",
            "recipient-alias",
            "run-interview",
            "filter-form",
            "interview-list-region",
            "detail-panel",
            "app-status",
            "run-status",
            "detail-status",
            "detail-summary-strip",
            "detail-record-id",
            "detail-summary-incident",
            "detail-summary-follow-up",
            "detail-summary-equipment",
            "detail-summary-status",
            "detail-summary-review",
            "review-filter",
            "review-count-action",
            "review-count-clarification",
            "review-count-clear",
            "review-count-unassessed",
            "detail-review-basis",
            "human-action-panel",
            "detail-human-actions",
        ):
            self.assertIn(required_id, ids)
        live_regions = [
            attrs
            for _tag, attrs in parser.attributes
            if attrs.get("aria-live") == "polite"
        ]
        self.assertGreaterEqual(len(live_regions), 3)
        for tag, attrs in parser.attributes:
            self.assertNotIn("style", attrs)
            self.assertFalse(any(name.startswith("on") for name in attrs))
            if tag in {"script", "link"}:
                resource = attrs.get("src") or attrs.get("href") or ""
                self.assertTrue(resource.startswith("/assets/"))
                self.assertNotIn("://", resource)
            if tag == "input":
                self.assertNotIn(attrs.get("type"), {"tel", "email", "password"})
                self.assertNotIn(attrs.get("name"), {"phone", "api_key"})
        self.assertNotIn("<style", html.lower())
        self.assertNotRegex(html.lower(), r"<script(?![^>]+\bsrc=)")

    def test_compact_header_keeps_one_clear_safety_message(self) -> None:
        html = (STATIC_ROOT / "app.html").read_text(encoding="utf-8")
        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        self.assertEqual(html.count("DEMO MODE"), 1)
        self.assertEqual(html.count("Fake provider only"), 1)
        self.assertEqual(html.count("No phone call will be placed"), 1)
        self.assertEqual(html.count("Local only"), 1)
        self.assertIn('class="safety-strip"', html)
        self.assertIn('setGlobalStatus("Ready for a local simulated interview.")', javascript)
        self.assertNotIn(
            "Local demo ready. Fake Provider only; real calls remain disabled.",
            javascript,
        )

    def test_javascript_uses_only_relative_existing_api_contracts(self) -> None:
        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        for path in (
            '"/api/v1/health"',
            '"/api/v1/scenarios"',
            '"/api/v1/interviews"',
            '"/api/v1/interviews/fake"',
        ):
            self.assertIn(path, javascript)
        self.assertIn("encodeURIComponent(interviewId)", javascript)
        self.assertNotRegex(javascript, r"https?://|(?<!:)//")
        self.assertNotIn("localhost", javascript.lower())
        self.assertIn('method: "POST"', javascript)
        for forbidden_method in ('method: "DELETE"', 'method: "PUT"', 'method: "PATCH"'):
            self.assertNotIn(forbidden_method, javascript)
        self.assertIn(
            "JSON.stringify({ scenario, recipient_alias: recipientAlias })",
            javascript,
        )

    def test_javascript_has_safe_dom_and_ui_state_contracts(self) -> None:
        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        for function_name in (
            "loadHealth",
            "loadScenarios",
            "runSimulatedInterview",
            "loadInterviews",
            "buildFilterQuery",
            "loadInterviewDetail",
            "formatTriState",
            "formatDate",
            "readSafeError",
            "getBadgePresentation",
            "createStatusBadge",
            "scrollDetailIntoView",
        ):
            self.assertRegex(javascript, rf"function {function_name}\(")
        self.assertIn("value === true", javascript)
        self.assertIn("value === false", javascript)
        self.assertIn('return "Not available"', javascript)
        self.assertIn('return "Unknown"', javascript)
        self.assertIn("if (state.isCreating)", javascript)
        self.assertIn("elements.runInterview.disabled = true", javascript)
        self.assertIn("The local API could not be reached.", javascript)
        self.assertIn("The local API returned an unreadable response.", javascript)
        self.assertIn("textContent", javascript)
        self.assertIn("document.createElement", javascript)
        for forbidden in (
            ".innerHTML",
            ".outerHTML",
            "insertAdjacentHTML",
            "document.write",
            "eval(",
            "new Function",
            "localStorage",
            "sessionStorage",
            "serviceWorker",
            "WebSocket",
            "EventSource",
            "Authorization",
            "api_key",
            "CalleClient",
            "CalleSdkAdapter",
            "location.href",
            "window.open",
        ):
            self.assertNotIn(forbidden, javascript)
        self.assertNotRegex(javascript, r"setTimeout\s*\(\s*['\"]")

    def test_list_badges_use_fixed_mapping_and_safe_scenario_width(self) -> None:
        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        css = (STATIC_ROOT / "app.css").read_text(encoding="utf-8")
        for required in (
            "const BADGE_PRESENTATIONS = Object.freeze",
            'createBadgeField("Status", "status", interview.status)',
            'createBadgeField("Incident", "incident", interview.incident_level)',
            'createBadgeField("Follow-up", "followUp", interview.requires_follow_up)',
            'createBadgeField("Review", "review", interview.review_disposition)',
            'className: "status-badge status-badge--unknown"',
            'className: "status-badge status-badge--unavailable"',
            'className: "status-badge status-badge--attention"',
            'className: "status-badge status-badge--critical"',
        ):
            self.assertIn(required, javascript)
        self.assertIn("record-field--scenario", javascript)
        self.assertIn(".record-field--scenario", css)
        self.assertIn(".record-field > span:not(.status-badge)", css)
        self.assertIn("minmax(10.5rem", css)
        self.assertNotRegex(
            javascript,
            r"className\s*=\s*(?:interview\.|value\b|`[^`]*\$\{(?:value|interview))",
        )

    def test_detail_summary_confidence_ids_and_safe_scroll_contract(self) -> None:
        html = (STATIC_ROOT / "app.html").read_text(encoding="utf-8")
        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        css = (STATIC_ROOT / "app.css").read_text(encoding="utf-8")
        for required in (
            "Incident",
            "Follow-up",
            "Equipment issue",
            "Status",
            "Review disposition",
            "CALL STATUS",
            "It is not safety clearance.",
            "Review basis",
            "Suggested human action",
            "Not an automated safety decision.",
            "Structured result confidence",
            "Not a safety severity score.",
            "Record ID",
            "Provider run ID",
        ):
            self.assertIn(required, html)
        for required in (
            "detailSummaryIncident",
            "detailSummaryFollowUp",
            "detailSummaryEquipment",
            "detailSummaryStatus",
            "detailSummaryReview",
            "renderTextList(elements.detailReviewBasis, interview.review_basis)",
            "renderTextList(elements.detailHumanActions, interview.suggested_human_actions)",
            "elements.detailPanel.getBoundingClientRect()",
            "bounds.top >= 0 && bounds.top < window.innerHeight",
            'window.matchMedia("(prefers-reduced-motion: reduce)")',
            "elements.detailPanel.scrollIntoView",
            'behavior: reduceMotion ? "auto" : "smooth"',
            "renderInterviewDetail(interview);\n    scrollDetailIntoView();",
        ):
            self.assertIn(required, javascript)
        initialize_body = javascript.split("async function initializeApplication()", 1)[1]
        initialize_body = initialize_body.split("elements.interviewForm", 1)[0]
        self.assertNotIn("scrollDetailIntoView", initialize_body)
        self.assertIn(".technical-meta", css)
        self.assertIn(".decision-summary", css)

    def test_incomplete_values_remain_distinct_in_api_and_ui_contract(self) -> None:
        response = self.client.post(
            "/api/v1/interviews/fake",
            json={
                "scenario": "incomplete-answers",
                "recipient_alias": "demo-incomplete",
            },
        )
        self.assertEqual(response.status_code, 201)
        detail_response = self.client.get(
            f"/api/v1/interviews/{response.json()['interview_id']}"
        )
        self.assertEqual(detail_response.status_code, 200)
        payload = detail_response.json()
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["provider"], "fake")
        self.assertEqual(payload["review_disposition"], "needs_clarification")
        self.assertEqual(
            payload["suggested_human_actions"],
            [
                "Contact the worker for the missing required answers.",
                "Do not treat this record as safety clearance.",
                "Complete human review after clarification.",
            ],
        )
        self.assertEqual(payload["incident_level"], "unknown")
        self.assertIsNone(payload["requires_follow_up"])
        self.assertIsNone(payload["near_miss_occurred"])
        self.assertIsNone(payload["equipment_issue_occurred"])
        self.assertIsNone(payload["injury_or_health_issue"])
        self.assertIsNone(payload["work_summary"])
        self.assertIsNone(payload["handover_notes"])
        self.assertEqual(payload["confidence"], 0.0)
        self.assertEqual(payload["evidence_count"], 1)

        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        html = (STATIC_ROOT / "app.html").read_text(encoding="utf-8")
        action_panel = html.split('<section id="human-action-panel"', 1)[1].split(
            "</section>", 1
        )[0]
        self.assertIn("Suggested human action", action_panel)
        self.assertIn("Not an automated safety decision.", action_panel)
        self.assertIn('id="detail-human-actions"', action_panel)
        self.assertIn(
            "renderTextList(elements.detailHumanActions, interview.suggested_human_actions);",
            javascript,
        )
        self.assertIn(
            "elements.humanActionPanel.hidden = interview.suggested_human_actions.length === 0;",
            javascript,
        )
        self.assertGreater(len(payload["suggested_human_actions"]), 0)
        self.assertRegex(
            javascript,
            r'if \(value === true\) \{\s+return "Yes";',
        )
        self.assertRegex(
            javascript,
            r'if \(value === false\) \{\s+return "No";',
        )
        self.assertRegex(
            javascript,
            r'if \(value === null \|\| value === undefined\) \{\s+return "Not available";',
        )
        self.assertRegex(
            javascript,
            r'toLowerCase\(\) === "unknown"\) \{\s+return "Unknown";',
        )
        self.assertIn('none: { label: "None"', javascript)
        self.assertIn('unknown: { label: "Unknown"', javascript)
        self.assertIn('unavailable: { label: "Not available"', javascript)
        confidence_body = javascript.split("function formatConfidence(value)", 1)[1]
        confidence_body = confidence_body.split("function padNumber", 1)[0]
        summary_body = javascript.split("function formatText(value)", 1)[1]
        summary_body = summary_body.split("function formatConfidence", 1)[0]
        for function_body in (confidence_body, summary_body):
            self.assertIn("value === null || value === undefined", function_body)
            self.assertIn('return "Not available"', function_body)
        self.assertIn("Number.isInteger(interview.evidence_count)", javascript)
        self.assertNotIn("interview.evidence_count === 0", javascript)

    def test_empty_state_success_message_and_details_name_are_explicit(self) -> None:
        html = (STATIC_ROOT / "app.html").read_text(encoding="utf-8")
        javascript = (STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("No interview records yet.", html)
        self.assertIn("Fake Provider simulated safety check", html)
        self.assertNotIn("Place a call", html)
        self.assertIn(
            "Simulated interview saved. Review the structured result in the record list.",
            javascript,
        )
        self.assertIn("button.setAttribute(\"aria-label\"", javascript)
        self.assertIn("View details for", javascript)

    def test_css_has_responsive_accessible_ledger_contract(self) -> None:
        css = (STATIC_ROOT / "app.css").read_text(encoding="utf-8")
        for required in (
            "box-sizing: border-box",
            "max-width: 100%",
            "overflow-wrap: anywhere",
            "@media (max-width: 22.5rem)",
            "@media (max-width: 48rem)",
            "@media (min-width: 48.0625rem) and (max-width: 64rem)",
            "grid-template-columns: 1fr",
            "min-height: 2.75rem",
            ":focus-visible",
            "prefers-reduced-motion",
            "flex-wrap: wrap",
        ):
            self.assertIn(required, css)
        self.assertNotIn("100vw", css)
        self.assertNotRegex(css, r"min-width:\s*[1-9]\d*px")

    def test_package_data_and_import_are_non_mutating(self) -> None:
        with (REPOSITORY_ROOT / "pyproject.toml").open("rb") as file:
            project = tomllib.load(file)
        package_data = project["tool"]["setuptools"]["package-data"]
        self.assertEqual(
            package_data["shift_safety_call_agent.adapters.web"],
            ["static/*.html", "static/*.css", "static/*.js"],
        )
        before = {
            path.name: (path.stat().st_size, path.stat().st_mtime_ns)
            for path in STATIC_ROOT.iterdir()
            if path.is_file()
        }
        importlib.reload(static_files)
        after = {
            path.name: (path.stat().st_size, path.stat().st_mtime_ns)
            for path in STATIC_ROOT.iterdir()
            if path.is_file()
        }
        self.assertEqual(before, after)
        self.assertEqual(set(before), {"app.html", "app.css", "app.js"})

    def test_missing_package_asset_fails_without_path_disclosure(self) -> None:
        with patch.object(
            static_files,
            "_read_static_asset",
            side_effect=StaticAssetUnavailableError(
                "Required local Web UI assets are unavailable."
            ),
        ):
            with self.assertRaisesRegex(
                StaticAssetUnavailableError,
                "Required local Web UI assets are unavailable",
            ) as raised:
                static_files.validate_static_assets()
        self.assertNotIn(str(STATIC_ROOT), str(raised.exception))

    def test_ui_routes_stay_out_of_openapi_and_cors_stays_absent(self) -> None:
        schema = self.app.openapi()
        self.assertNotIn("/app", schema["paths"])
        self.assertNotIn("/assets/app.css", schema["paths"])
        self.assertNotIn("/assets/app.js", schema["paths"])
        self.assertEqual(self.app.user_middleware, [])


if __name__ == "__main__":
    unittest.main()
