import json
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from calle import CalleClient
from rich.console import Console

import client
import questionnaire
from ingest import Store


def write_jsonl(path: Path, records):
    path.write_text("\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n", encoding="utf-8")


def read_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def make_config(input_path: Path, results_dir: Path, mode: str = "dry_run", **overrides) -> client.Config:
    argv = ["--input", str(input_path), "--results-dir", str(results_dir)]
    if mode == "execute":
        argv.append("--execute")
    for key, value in overrides.items():
        argv.extend([f"--{key.replace('_', '-')}", str(value)])
    with patch.dict("os.environ", {"CALLE_API_KEY": "fake-key"}):
        return client.read_config(argv)


def make_mock_client(handler) -> tuple[CalleClient, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    http = httpx.Client(
        base_url="https://api.heycall-e.com",
        headers={"Authorization": "Bearer fake-key"},
        transport=httpx.MockTransport(recording_handler),
    )
    return CalleClient(api_key="fake-key", http_client=http), requests


COMPLETED_RESULT = {
    "fridge_temp_c": 4.5,
    "arv_stockout": "no",
    "antimalarial_stockout": "yes",
    "malaria_cases": 12,
    "anc_visits": 3,
    "stockout_items": "ACT",
}


def completed_call(call_id="call_1", structured=COMPLETED_RESULT, status="completed"):
    return {
        "id": call_id,
        "object": "call_task",
        "status": status,
        "task": "Call Kapeeka HC II ...",
        "structured_result": structured,
        "recipients": [{"id": "rcp_1", "structured_result": structured, "status": status}],
        "summary": "Stockout of ACT reported; fridge in range.",
        "task_completed": True,
    }


def test_build_task_contains_questions():
    task = questionnaire.build_task("hcii-kapeeka", "Kapeeka HC II", "Jane")
    assert "Kapeeka HC II" in task and "hcii-kapeeka" in task
    assert "fridge temperature" in task.lower()
    assert "ARV" in task and "antimalarial" in task
    assert "ANC1" in task
    assert "medical advice" in task  # safety boundary present


def test_classify_happy_path_red():
    report = questionnaire.classify(COMPLETED_RESULT, clinic_id="hcii-kapeeka")
    assert report.fields["fridge_temp_c"] == 4.5
    assert report.fields["arv_stockout"] == "no"
    assert report.fields["antimalarial_stockout"] == "yes"
    assert report.fields["malaria_cases"] == 12
    assert report.missing == []
    assert report.severity == "red"
    assert "antimalarial_stockout" in report.red_flags
    assert "stockout_items:ACT" in report.red_flags


def test_classify_cold_chain_break():
    report = questionnaire.classify(
        {"fridge_temp_c": 10.0, "arv_stockout": "no", "antimalarial_stockout": "no",
         "malaria_cases": 5, "anc_visits": 1, "stockout_items": "none"},
        clinic_id="x",
    )
    assert report.severity == "red"
    assert any(flag.startswith("cold_chain_break") for flag in report.red_flags)


def test_classify_amber_other_stockout():
    report = questionnaire.classify(
        {"fridge_temp_c": 4.0, "arv_stockout": "no", "antimalarial_stockout": "no",
         "malaria_cases": 5, "anc_visits": 1, "stockout_items": "Amoxicillin"},
        clinic_id="x",
    )
    assert report.severity == "amber"


def test_classify_null_structured_result_recorded_not_dropped():
    report = questionnaire.classify(None, clinic_id="y")
    assert report.fields == {}
    assert report.missing and len(report.missing) == 6
    assert report.severity == "green"
    assert report.red_flags == []


def test_store_ingest_creates_red_escalation():
    with tempfile.TemporaryDirectory() as tmp:
        store = Store(Path(tmp) / "clinic_reports.db")
        report = questionnaire.classify(COMPLETED_RESULT, clinic_id="hcii-test")
        store.ingest(
            {"clinic_id": "hcii-test", "clinic_name": "Test HC II", "district": "Demo"},
            report,
            {"final_status": "completed", "call_id": "call_1", "duration_seconds": 42.0, "post_summary": "Stockout reported."},
        )
        rows = store.latest_reports()
        assert rows and rows[0]["clinic_id"] == "hcii-test"
        assert rows[0]["severity"] == "red"
        assert rows[0]["antimalarial_stockout"] == "yes"
        esc = store.pending_escalations()
        assert esc and esc[0]["clinic_id"] == "hcii-test"
        store.mark_escalations_sent([esc[0]["id"]])
        assert store.pending_escalations() == []


def test_dry_run_previews_payload_without_posting():
    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "input.jsonl"
        results_dir = Path(tmp) / "results"
        write_jsonl(input_path, [{
            "clinic_id": "hcii-kapeeka", "clinic_name": "Kapeeka HC II", "nurse_name": "Jane",
            "to_phones": ["+256700000001"], "region": "UG", "locale": "en-UG",
            "metadata": {"district": "Nakaseke"},
        }])
        config = make_config(input_path, results_dir, mode="dry_run")
        items = client.load_jsonl(config.input_path)
        rc = client.process_batch(config, items, Console(quiet=True))
        assert rc == 0
        records = read_jsonl(results_dir / "clinic_call_results.jsonl")
        assert records[0]["ok"] is True
        assert records[0]["mode"] == "dry_run"
        assert records[0]["clinic_id"] == "hcii-kapeeka"
        assert "payload_preview" in records[0]
        assert records[0]["payload_preview"]["recipient"]["region"] == "UG"
        assert records[0]["payload_preview"]["result_schema"]["required"] == list(questionnaire.REQUIRED_FIELDS)


def test_execute_creates_waits_and_ingests_red_row():
    created = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/calls":
            created.append(json.loads(request.content))
            return httpx.Response(201, json={"id": "call_1", "object": "call_task", "status": "queued"})
        if request.method == "GET" and request.url.path == "/v1/calls/call_1":
            return httpx.Response(200, json=completed_call())
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "unexpected"}})

    mock_client, requests = make_mock_client(handler)
    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "input.jsonl"
        results_dir = Path(tmp) / "results"
        write_jsonl(input_path, [{
            "clinic_id": "hcii-kapeeka", "clinic_name": "Kapeeka HC II", "nurse_name": "Jane",
            "to_phones": ["+15555550100"], "region": "US", "locale": "en-US",
            "metadata": {"district": "Demo"},
        }])
        config = make_config(input_path, results_dir, mode="execute", poll_interval_seconds=0.01, poll_timeout_seconds=5)
        items = client.load_jsonl(config.input_path)
        rc = client.process_batch(config, items, Console(quiet=True), calle_client=mock_client)
        assert rc == 0
        assert len(requests) >= 2
        assert requests[0].method == "POST" and requests[0].url.path == "/v1/calls"
        assert requests[1].method == "GET"
        # Authorization header carried the API key.
        assert requests[0].headers["authorization"] == "Bearer fake-key"
        assert created[0]["result_schema"]["required"] == list(questionnaire.REQUIRED_FIELDS)
        assert created[0]["recipients"][0]["region"] == "US"

        records = read_jsonl(results_dir / "clinic_call_results.jsonl")
        assert records[0]["ok"] is True
        assert records[0]["call_id"] == "call_1"
        assert records[0]["status"] == "completed"
        assert records[0]["structured_result"]["antimalarial_stockout"] == "yes"
        assert records[0]["report"]["severity"] == "red"
        assert "antimalarial_stockout" in records[0]["report"]["red_flags"]

        with sqlite3.connect(results_dir / "clinic_reports.db") as conn:
            conn.row_factory = sqlite3.Row
            rows = [dict(r) for r in conn.execute("SELECT clinic_id, severity, antimalarial_stockout FROM reports")]
        assert rows and rows[0]["clinic_id"] == "hcii-kapeeka" and rows[0]["severity"] == "red"


def test_execute_null_structured_result_is_recorded_not_dropped():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/calls":
            return httpx.Response(201, json={"id": "call_2", "object": "call_task", "status": "queued"})
        if request.method == "GET" and request.url.path == "/v1/calls/call_2":
            return httpx.Response(200, json=completed_call(call_id="call_2", structured=None))
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})

    mock_client, _ = make_mock_client(handler)
    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "input.jsonl"
        results_dir = Path(tmp) / "results"
        write_jsonl(input_path, [{"clinic_id": "hcii-x", "clinic_name": "X HC", "to_phones": ["+15555550100"], "region": "US"}])
        config = make_config(input_path, results_dir, mode="execute", poll_interval_seconds=0.01, poll_timeout_seconds=5)
        items = client.load_jsonl(config.input_path)
        rc = client.process_batch(config, items, Console(quiet=True), calle_client=mock_client)
        assert rc == 0
        records = read_jsonl(results_dir / "clinic_call_results.jsonl")
        assert records[0]["structured_result"] is None
        assert records[0]["report"]["missing"] and records[0]["report"]["severity"] == "green"


def test_execute_unsupported_region_is_recorded_as_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"error": {"code": "unsupported_region", "message": "Region UG is not supported.", "details": {}}})

    mock_client, _ = make_mock_client(handler)
    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "input.jsonl"
        results_dir = Path(tmp) / "results"
        write_jsonl(input_path, [{"clinic_id": "hcii-ug", "clinic_name": "UG HC", "to_phones": ["+256700000001"], "region": "UG"}])
        config = make_config(input_path, results_dir, mode="execute")
        items = client.load_jsonl(config.input_path)
        rc = client.process_batch(config, items, Console(quiet=True), calle_client=mock_client)
        assert rc == 1
        records = read_jsonl(results_dir / "clinic_call_results.jsonl")
        assert records[0]["error"]["code"] == "unsupported_region"
