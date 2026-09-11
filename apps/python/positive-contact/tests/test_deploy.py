"""The public artifact is fixture-only, useful and read-only."""

import json

import pytest
from fastapi.testclient import TestClient

from positive_contact.deploy import PUBLIC_LIVE_VERIFICATIONS, build_demo_app
from positive_contact.redact import find_raw_e164
from positive_contact.static_demo import export_static_demo


def test_public_demo_has_health_status_and_completed_support_result(tmp_path):
    client = TestClient(
        build_demo_app(tmp_path / "public-demo.db"),
        base_url="https://positive-contact.example",
    )
    assert client.get("/healthz").json()["status"] == "ok"
    page = client.get("/support")
    assert page.status_code == 200
    assert "Provider result" in page.text
    assert "Within two hours" in page.text
    assert "Authorize provider call" not in page.text
    review = client.get("/review")
    assert "Read-only public demo" in review.text
    assert "Confirm contact" not in review.text
    reports = client.get("/reports")
    assert "Approve this field visit" not in reports.text


def test_public_demo_shows_redacted_live_verification_outside_fixture_counts(tmp_path):
    client = TestClient(
        build_demo_app(tmp_path / "public-demo.db"),
        base_url="https://positive-contact.example",
    )
    page = client.get("/board")
    assert page.status_code == 200
    assert "Redacted live CALL-E verification" in page.text
    assert page.text.count("data-verification-id=") == 2
    assert "Verification call 1" in page.text
    assert "Verification call 2" in page.text
    assert "Powered equipment" in page.text
    assert "Before outage" in page.text
    assert "No provider call has been placed" in page.text
    assert "excluded from every metric below" in page.text
    assert find_raw_e164(page.text) == []
    assert client.get("/api/v1/status").json()["summary"]["contacts"] == 12
    private_fields = {"name", "phone", "email", "transcript", "call_id"}
    for verification in PUBLIC_LIVE_VERIFICATIONS:
        assert private_fields.isdisjoint(verification)


def test_public_demo_rejects_mutations_without_an_operator_token(tmp_path):
    client = TestClient(
        build_demo_app(tmp_path / "public-demo.db"),
        base_url="https://positive-contact.example",
    )
    response = client.post(
        "/review/not-an-intent/confirm",
        data={"actor": "x", "evidence": "x"},
        follow_redirects=False,
    )
    assert response.status_code == 503


def test_static_export_contains_every_read_view_and_no_actions(tmp_path):
    site = tmp_path / "site"
    written = export_static_demo(site, db_path=tmp_path / "static.db")
    assert len(written) == 12
    assert (site / "board/index.html").is_file()
    assert (site / "review/rows/index.html").is_file()
    assert (site / "support/rows/index.html").is_file()
    assert (site / "reports/table/index.html").is_file()
    support = (site / "support/index.html").read_text(encoding="utf-8")
    assert "Provider result" in support
    assert "Authorize provider call" not in support
    assert "Read-only public demo" in support
    board = (site / "board/index.html").read_text(encoding="utf-8")
    assert "Redacted live CALL-E verification" in board
    assert "Verification call 2" in board
    assert "excluded from every metric below" in board
    assert find_raw_e164(board) == []
    status = json.loads((site / "api/v1/status/index.html").read_text())
    assert status["status"] == "ok"
    assert status["mode"] == "fixture"


def test_static_export_refuses_to_overwrite_a_nonempty_directory(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "keep.txt").write_text("keep", encoding="utf-8")
    with pytest.raises(RuntimeError, match="not empty"):
        export_static_demo(site, db_path=tmp_path / "static.db")
