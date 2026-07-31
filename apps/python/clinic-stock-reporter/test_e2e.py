import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = Path(__file__).resolve().parent
FAKE_SERVER = ROOT / "shared" / "fake-mcp-broker-server.mjs"


def start_fake_server():
    process = subprocess.Popen(
        ["node", str(FAKE_SERVER)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    line = process.stdout.readline()
    payload = json.loads(line)
    return process, payload


def stop_fake_server(process):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def read_state(state_url):
    with urlopen(state_url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def cache_dir(cache_root, server_url):
    digest = hashlib.md5(server_url.encode("utf-8")).hexdigest()
    return Path(cache_root) / digest


def token_cache_path(cache_root, server_url):
    return cache_dir(cache_root, server_url) / "token.json"


def write_token(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "token": {
                    "access_token": "fake-access-token",
                    "refresh_token": "fake-refresh-token",
                },
                "expires_at": "2030-01-01T00:00:00Z",
            },
            indent=2,
        )
        + "\n"
    )


def write_executable(path, content):
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def write_fake_calle(path, token_path, server_url):
    write_executable(
        path,
        f"""#!{sys.executable}
import json
import sys
from pathlib import Path

cache_path = Path({str(token_path)!r})
server_url = {server_url!r}

if sys.argv[1:3] == ["auth", "status"]:
    usable = cache_path.exists()
    print(json.dumps({{
        "server_url": server_url,
        "cache_path": str(cache_path),
        "pending_cache_path": str(cache_path.with_name("pending_login.json")),
        "cache_exists": usable,
        "pending_exists": False,
        "usable": usable,
        "expires_at": "2030-01-01T00:00:00Z" if usable else None,
        "pending_status": None,
        "pending_login_url": None,
    }}))
    raise SystemExit(0)

raise SystemExit(f"unexpected fake calle args: {{sys.argv[1:]}}")
""",
    )


def write_jsonl(path, records):
    path.write_text("\n".join(json.dumps(record, separators=(",", ":")) for record in records) + "\n", encoding="utf-8")


def run_client(args, env=None, stdin=""):
    return subprocess.run(
        [sys.executable, "client.py", *args],
        cwd=APP_ROOT,
        env={**os.environ, **(env or {}), "FORCE_COLOR": "0"},
        input=stdin,
        text=True,
        capture_output=True,
        timeout=30,
    )


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def assert_no_secrets(output):
    assert "fake-access-token" not in output
    assert "fake-refresh-token" not in output
    assert "fake-confirm-token" not in output


def test_parse_report_happy_path():
    from questionnaire import parse_report

    sample = (
        "REPORT fridge_temp_c=4.5 arv_stockout=no antimalarial_stockout=yes "
        "malaria_cases=12 anc_visits=3 stockout_items=ACT"
    )
    report = parse_report(sample, clinic_id="hcii-kapeeka")
    assert report.fields["fridge_temp_c"] == 4.5
    assert report.fields["arv_stockout"] is False
    assert report.fields["antimalarial_stockout"] is True
    assert report.fields["malaria_cases"] == 12
    assert report.fields["anc_visits"] == 3
    assert report.fields["stockout_items"] == "ACT"
    assert report.missing == []
    assert report.severity == "red"
    assert "antimalarial_stockout" in report.red_flags
    assert "stockout_items:ACT" in report.red_flags


def test_parse_report_cold_chain_break():
    from questionnaire import parse_report

    report = parse_report(
        "REPORT fridge_temp_c=10.0 arv_stockout=no antimalarial_stockout=no "
        "malaria_cases=5 anc_visits=1 stockout_items=none",
        clinic_id="hcii-x",
    )
    assert report.severity == "red"
    assert any(flag.startswith("cold_chain_break") for flag in report.red_flags)


def test_parse_report_no_report_line_is_recorded_not_dropped():
    from questionnaire import parse_report

    report = parse_report("Call went to voicemail, no answer.", clinic_id="hcii-y")
    assert report.fields == {}
    assert report.missing and len(report.missing) == 6
    assert report.severity == "green"
    assert report.red_flags == []


def test_store_ingest_creates_red_escalation():
    import sqlite3
    from ingest import Store
    from questionnaire import parse_report

    with tempfile.TemporaryDirectory() as tmp:
        store = Store(Path(tmp) / "clinic_reports.db")
        report = parse_report(
            "REPORT fridge_temp_c=10.0 arv_stockout=no antimalarial_stockout=yes "
            "malaria_cases=7 anc_visits=2 stockout_items=ACT",
            clinic_id="hcii-test",
        )
        store.ingest(
            {"clinic_id": "hcii-test", "clinic_name": "Test HC II", "district": "Demo"},
            report,
            {"final_status": "COMPLETED", "run_id": "run-1", "duration_seconds": 42.0, "post_summary": "REPORT ..."},
        )
        rows = store.latest_reports()
        assert rows and rows[0]["clinic_id"] == "hcii-test"
        assert rows[0]["severity"] == "red"
        esc = store.pending_escalations()
        assert esc and esc[0]["clinic_id"] == "hcii-test"
        store.mark_escalations_sent([esc[0]["id"]])
        assert store.pending_escalations() == []


def test_dry_run_plans_each_clinic_and_moves_metadata_to_mcp_meta():
    process, fake = start_fake_server()
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="calle-clinic-stock-reporter-"))
        cache_root = temp_dir / "cache"
        token_path = token_cache_path(cache_root, fake["server_url"])
        write_token(token_path)
        fake_calle = temp_dir / "calle"
        write_fake_calle(fake_calle, token_path, fake["server_url"])
        input_path = temp_dir / "input.jsonl"
        results_dir = temp_dir / "results"
        write_jsonl(
            input_path,
            [
                {
                    "clinic_id": "hcii-kapeeka",
                    "clinic_name": "Kapeeka HC II",
                    "nurse_name": "Jane",
                    "to_phones": ["+256700000001"],
                    "region": "UG",
                    "language": "English",
                    "metadata": {"district": "Nakaseke"},
                },
            ],
        )

        result = run_client(
            [
                "--input", str(input_path),
                "--results-dir", str(results_dir),
                "--dry-run",
                "--calle-command", str(fake_calle),
                "--cache-root", str(cache_root),
                "--base-url", fake["base_url"],
                "--server-url", fake["server_url"],
            ]
        )

        assert result.returncode == 0, result.stderr
        assert "dry_run ok" in result.stdout
        output_path = results_dir / "clinic_call_results.jsonl"
        assert output_path.exists()
        assert_no_secrets(result.stdout + result.stderr + output_path.read_text())

        records = read_jsonl(output_path)
        assert records[0]["ok"] is True
        assert records[0]["mode"] == "dry_run"
        assert records[0]["clinic_id"] == "hcii-kapeeka"

        state = read_state(fake["state_url"])
        assert state["tool_calls"][0]["name"] == "plan_call"
        assert "metadata" not in state["tool_calls"][0]["arguments"]
        sent_meta = state["tool_calls"][0]["request_meta"]["call-e/customerMetadata"]
        assert sent_meta["clinic_id"] == "hcii-kapeeka"
        assert sent_meta["district"] == "Nakaseke"
        assert "REPORT fridge_temp_c=" in state["tool_calls"][0]["arguments"]["goal"]
    finally:
        stop_fake_server(process)


def test_execute_runs_call_and_ingests_row():
    process, fake = start_fake_server()
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="calle-clinic-stock-reporter-"))
        cache_root = temp_dir / "cache"
        token_path = token_cache_path(cache_root, fake["server_url"])
        write_token(token_path)
        fake_calle = temp_dir / "calle"
        write_fake_calle(fake_calle, token_path, fake["server_url"])
        input_path = temp_dir / "input.jsonl"
        results_dir = temp_dir / "results"
        write_jsonl(
            input_path,
            [
                {
                    "clinic_id": "hcii-kapeeka",
                    "clinic_name": "Kapeeka HC II",
                    "nurse_name": "Jane",
                    "to_phones": ["+256700000001"],
                    "region": "UG",
                    "language": "English",
                    "metadata": {"district": "Nakaseke"},
                    "user_input": "ready_to_run",
                },
            ],
        )

        result = run_client(
            [
                "--input", str(input_path),
                "--results-dir", str(results_dir),
                "--execute",
                "--poll-interval-seconds", "0.01",
                "--poll-timeout-seconds", "5",
                "--calle-command", str(fake_calle),
                "--cache-root", str(cache_root),
                "--base-url", fake["base_url"],
                "--server-url", fake["server_url"],
            ]
        )

        assert result.returncode == 0, result.stderr
        assert "Done." in result.stdout
        assert "hcii-kapeeka" in result.stdout
        output_path = results_dir / "clinic_call_results.jsonl"
        records = read_jsonl(output_path)
        assert records[0]["ok"] is True
        assert records[0]["mode"] == "execute"
        assert records[0]["run_id"] == "fake-run-1"
        assert records[0]["final_status"] == "COMPLETED"
        assert records[0]["post_summary"] == "Fake call completed successfully."
        # The fake server's post_summary has no REPORT line, so the parser
        # records missing fields but the row is still ingested, not dropped.
        assert records[0]["report"]["missing"]
        assert records[0]["report"]["severity"] == "green"
        assert_no_secrets(result.stdout + result.stderr + output_path.read_text())

        state = read_state(fake["state_url"])
        assert [call["name"] for call in state["tool_calls"]] == ["plan_call", "run_call", "get_call_run", "get_call_run"]

        # The store should have the ingested row.
        import sqlite3
        db_path = results_dir / "clinic_reports.db"
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = [dict(r) for r in conn.execute("SELECT clinic_id, final_status, severity FROM reports")]
        assert rows and rows[0]["clinic_id"] == "hcii-kapeeka"
        assert rows[0]["final_status"] == "COMPLETED"
    finally:
        stop_fake_server(process)


def test_missing_login_fails_fast():
    process, fake = start_fake_server()
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="calle-clinic-stock-reporter-"))
        cache_root = temp_dir / "cache"
        fake_calle = temp_dir / "calle"
        write_fake_calle(fake_calle, token_cache_path(cache_root, fake["server_url"]), fake["server_url"])
        input_path = temp_dir / "input.jsonl"
        write_jsonl(input_path, [{"clinic_id": "hcii-x", "to_phones": ["+256700000001"]}])

        result = run_client(
            [
                "--input", str(input_path),
                "--results-dir", str(temp_dir / "results"),
                "--calle-command", str(fake_calle),
                "--cache-root", str(cache_root),
                "--base-url", fake["base_url"],
                "--server-url", fake["server_url"],
                "--no-login-wait",
            ]
        )

        assert result.returncode == 2
        assert "Auth required" in result.stderr
    finally:
        stop_fake_server(process)
