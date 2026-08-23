import json
from html.parser import HTMLParser
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
DEMO_PATH = APP_ROOT / "demo" / "index.html"


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external_assets: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        for name in ("src", "href"):
            value = attributes.get(name, "")
            if value.startswith(("http://", "https://", "//")):
                self.external_assets.append(value)


def test_demo_is_self_contained_and_cannot_place_calls():
    html = DEMO_PATH.read_text(encoding="utf-8")
    parser = AssetParser()
    parser.feed(html)

    assert parser.external_assets == []
    assert "fetch(" not in html
    assert "XMLHttpRequest" not in html
    assert "WebSocket" not in html
    assert "CALLE_API_KEY" not in html
    assert "No real calls" in html
    assert "This page cannot place a phone call" in html


def test_demo_has_both_judge_scenarios_and_only_masked_fictional_numbers():
    html = DEMO_PATH.read_text(encoding="utf-8")

    assert 'id="golden"' in html
    assert 'id="ambiguous"' in html
    assert "Candidate found · human confirmation required" in html
    assert "Queue halted · human review required" in html
    assert "+120255501" not in html
    assert html.count("+12******") == 3


def test_demo_metrics_match_committed_evaluation_after_display_rounding():
    html = DEMO_PATH.read_text(encoding="utf-8")
    result = json.loads(
        (APP_ROOT / "evaluation_results.json").read_text(encoding="utf-8")
    )["results"]

    reduction = round(result["modeled_operator_time_reduction_percent"])
    manual_operator = result["manual_mean_operator_minutes"]
    automated_operator = result["automated_mean_operator_minutes"]
    automated_wall = result["automated_mean_wall_minutes"]
    manual_wall = result["manual_mean_wall_minutes"]

    assert f"−{reduction}%" in html
    assert f"{manual_operator:.2f} → {automated_operator:.2f}" in html
    assert f"{automated_wall:.2f}m" in html
    assert f"{manual_wall:.2f}m" in html


def test_demo_exposes_a_privacy_safe_downloadable_decision_trace():
    html = DEMO_PATH.read_text(encoding="utf-8")

    assert 'id="audit-events"' in html
    assert 'id="download-audit"' in html
    assert "candidate.dispatch-authorized" in html
    assert "workflow.handoff" in html
    assert "workflow.halted" in html
    assert "safety_invariants" in html
    assert "booking_created: false" in html
    assert "automatic_redial_is_disabled: true" in html
    assert "new Blob" in html
