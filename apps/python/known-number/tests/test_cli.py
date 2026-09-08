import json
import subprocess
import sys

from tests.conftest import ROOT


def run(*args):
    return subprocess.run([sys.executable, "-m", "known_number.cli", *args], cwd=ROOT, capture_output=True, text=True)


def test_preview_is_secret_free_and_offline():
    r = run("preview", "--request", "examples/change_request.json", "--vendors", "examples/vendors.json")
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["payment_free_task"] is True
    assert len(out["verification_code_for_written_notice"]) == 6
    assert out["recipient"]["phones"] == ["+12*******47"]


def test_verify_defaults_to_dry_run(tmp_path):
    r = run("verify", "--request", "examples/change_request.json", "--vendors", "examples/vendors.json", "--state-dir", str(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads(r.stdout)["mode"] == "dry-run"


def test_live_without_approver_is_blocked(tmp_path):
    r = run("verify", "--live", "--request", "examples/change_request.json", "--vendors", "examples/vendors.json", "--state-dir", str(tmp_path))
    assert r.returncode == 1
    assert "approver" in r.stdout


def test_reconcile_writes_memo(tmp_path):
    r = run("reconcile", "--request", "examples/change_request.json", "--vendors", "examples/vendors.json",
            "--call-json", "fixtures/confirmed.json", "--state-dir", str(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["verdict"] == "CONFIRMED"
    memo = (tmp_path / "AP-2026-1183.memo.md").read_text()
    assert "Verdict: CONFIRMED" in memo and "+12*******47" in memo


def test_demo_runs_all_fixtures():
    r = run("demo")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "denied_by_vendor" in r.stdout and "DENIED_BY_VENDOR" in r.stdout
