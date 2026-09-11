"""The public artifact is fixture-only, useful and read-only."""

import json

import pytest
from fastapi.testclient import TestClient

from positive_contact.deploy import build_demo_app
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
    status = json.loads((site / "api/v1/status/index.html").read_text())
    assert status["status"] == "ok"
    assert status["mode"] == "fixture"


def test_static_export_refuses_to_overwrite_a_nonempty_directory(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "keep.txt").write_text("keep", encoding="utf-8")
    with pytest.raises(RuntimeError, match="not empty"):
        export_static_demo(site, db_path=tmp_path / "static.db")
