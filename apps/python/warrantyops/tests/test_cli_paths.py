"""The CLI surface: every mode dispatches and refuses by the same rules.

The scenario runner's behaviour is covered elsewhere; these tests pin the
``main()`` dispatch itself — one mode at a time, offline refusals for the
runtime-proof commands (no environment, so nothing can dial), the static
artifacts (proof screen, generated docs), and the exit codes a script sees.
Every runtime-proof invocation here runs against a cleared environment, so
the gates refuse before any client could exist.
"""

from __future__ import annotations

import json
import runpy
import sys
from pathlib import Path

import pytest

from warrantyops.cli import main

LIVE_ENV_VARS = (
    "CALLE_API_KEY",
    "WARRANTYOPS_TEST_RECIPIENT_E164",
    "CALLE_LIVE_CALLS_ENABLED",
    "CALLE_BASE_URL",
    "WARRANTYOPS_ARTIFACT_DIR",
)


@pytest.fixture(autouse=True)
def no_live_environment(monkeypatch):
    """The runtime-proof commands must refuse here, not read a live setup."""

    for name in LIVE_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_listing_scenarios_is_the_default(capsys):
    assert main([]) == 0
    assert main(["--list"]) == 0
    listed = capsys.readouterr().out.split()
    assert "case_a_useful_resolution" in listed


def test_two_modes_at_once_is_refused(capsys):
    assert main(["--list", "--generate-docs"]) == 2
    assert "refused" in capsys.readouterr().err


def test_verify_proof_screen_passes_only_when_byte_identical(capsys):
    assert main(["--verify-proof-screen"]) == 0
    assert "byte-identical" in capsys.readouterr().out


def test_proof_screen_writes_to_an_explicit_path(tmp_path, capsys):
    target = tmp_path / "proof.html"
    assert main(["--proof-screen", str(target)]) == 0
    assert target.exists()
    assert str(target) in capsys.readouterr().out


def test_generate_docs_rewrites_both_files_byte_identically(capsys):
    from warrantyops.cli import DOCS_DIR
    from warrantyops.refusals_catalog import render_refusals_markdown
    from warrantyops.statemachine import render_markdown as render_state_machine

    before = {
        name: (
            (DOCS_DIR / name)
            .read_text(encoding="utf-8")
            .replace("\r\n", "\n")
            .encode("utf-8")
        )
        for name in ("refusals.md", "state-machine.md")
    }
    assert main(["--generate-docs"]) == 0
    assert str(DOCS_DIR) in capsys.readouterr().out
    # Regeneration is byte-identical: the checked-in files are the render.
    assert (DOCS_DIR / "refusals.md").read_bytes() == before["refusals.md"]
    assert (DOCS_DIR / "state-machine.md").read_bytes() == before["state-machine.md"]
    assert render_refusals_markdown().encode("utf-8") == before["refusals.md"]
    assert render_state_machine().encode("utf-8") == before["state-machine.md"]


def test_verify_docs_passes_only_when_both_files_match_the_enums(capsys):
    assert main(["--verify-docs"]) == 0
    assert "byte-identical" in capsys.readouterr().out


def test_verify_docs_refuses_a_drifted_file_by_name(tmp_path, capsys, monkeypatch):
    from warrantyops import cli as cli_module

    (tmp_path / "refusals.md").write_text("# stale\n", encoding="utf-8")
    (tmp_path / "state-machine.md").write_text("# stale\n", encoding="utf-8")
    monkeypatch.setattr(cli_module, "DOCS_DIR", tmp_path)
    assert main(["--verify-docs"]) == 1
    error = capsys.readouterr().err
    assert "drifted" in error
    assert "refusals.md" in error
    assert "state-machine.md" in error
    assert "--generate-docs" in error


def test_verify_docs_names_a_missing_file_as_drift(tmp_path, capsys, monkeypatch):
    from warrantyops import cli as cli_module
    from warrantyops.statemachine import render_markdown

    (tmp_path / "state-machine.md").write_text(render_markdown(), encoding="utf-8")
    monkeypatch.setattr(cli_module, "DOCS_DIR", tmp_path)  # refusals.md absent
    assert main(["--verify-docs"]) == 1
    assert "refusals.md" in capsys.readouterr().err


def test_verify_docs_conflicts_with_generate_docs(capsys):
    assert main(["--verify-docs", "--generate-docs"]) == 2
    assert "refused" in capsys.readouterr().err


def test_a_scenario_run_reports_json_and_exits_zero(capsys):
    assert main(["--scenario", "case_a_useful_resolution"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert "refused" not in report  # the run was not refused at any gate
    assert report["terminal_state"] == "INFORMATION_OBTAINED"
    assert "*" in report["recipient"]  # the number is printed masked only


def test_a_metrics_run_attaches_the_counters_and_pane(capsys):
    assert main(["--scenario", "case_a_useful_resolution", "--metrics"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["metrics"]["events_total"] > 0
    assert report["audit_pane"]
    assert report["metrics"]["terminal_states"]


def test_a_no_result_scenario_reports_the_finding(capsys):
    # case_e never reaches a business result: the terminal state is the
    # finding and the write-back is refused. Scenario runs exit 0 either
    # way — the report is the answer, not a crash.
    assert main(["--scenario", "case_e_no_result", "--approve"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["terminal_state"] == "TRANSPORT_FAILED"
    assert report["write_back"] == "NO_BUSINESS_RESULT"


def test_a_ledger_inside_the_repository_refuses_the_scenario_run(tmp_path, capsys):
    inside_repo = Path(__file__).resolve().parents[1] / "in-repo-ledger.sqlite"
    assert main(
        ["--scenario", "case_a_useful_resolution", "--ledger-db", str(inside_repo)]
    ) == 2
    assert "refused" in capsys.readouterr().err


def test_a_durable_ledger_suppresses_the_second_run(tmp_path, capsys):
    ledger_db = tmp_path / "user-state.sqlite"
    args = [
        "--scenario",
        "case_a_useful_resolution",
        "--ledger-db",
        str(ledger_db),
    ]
    assert main(args) == 0
    capsys.readouterr()
    assert main(args) == 0  # suppression is a normal outcome, not an error
    second = json.loads(capsys.readouterr().out)
    assert second["refused"] is True
    assert second["reasons"] == ["DUPLICATE_CALL_SUPPRESSED"]


def test_preflight_without_the_environment_refuses(capsys):
    assert main(["--preflight"]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] is False
    assert report["network_requests"] == 0


def test_probe_auth_without_the_environment_refuses(capsys):
    assert main(["--probe-auth"]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["refused"] is True
    assert report["calls_created"] == 0


def test_execute_live_call_without_confirmations_refuses(capsys):
    assert main(["--execute-live-call"]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["refused"] is True
    assert report["stage"] == "REQUIREMENTS"
    assert "MISSING_CONFIRM_CONSENTING_RECIPIENT_FLAG" in report["reasons"]


def test_recover_without_a_ledger_refuses(capsys):
    assert main(["--recover-runtime-result"]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["refused"] is True
    assert "MISSING_LEDGER_DB" in report["reasons"]


def test_python_dash_m_entrypoint_lists_scenarios(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["warrantyops", "--list"])
    with pytest.raises(SystemExit) as caught:
        runpy.run_module("warrantyops", run_name="__main__")
    assert caught.value.code == 0
    assert "case_a_useful_resolution" in capsys.readouterr().out.split()


# --- drift, moved sources and malformed runs -------------------------------------


def test_a_drifted_proof_screen_is_reported_and_exits_one(tmp_path, monkeypatch, capsys):
    import warrantyops.cli as cli_module

    drifted = tmp_path / "drifted.html"
    drifted.write_text("not the rendered screen\n", encoding="utf-8")
    monkeypatch.setattr(cli_module, "DEFAULT_OUTPUT", drifted)
    assert main(["--verify-proof-screen"]) == 1
    assert "drifted" in capsys.readouterr().err


def test_the_cli_module_entrypoint_raises_systemexit(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["warrantyops.cli", "--list"])
    with pytest.raises(SystemExit) as caught:
        runpy.run_module("warrantyops.cli", run_name="__main__")
    assert caught.value.code == 0


def test_a_source_that_moved_before_the_write_back_is_refused(capsys):
    assert main(["--scenario", "case_f_source_changed", "--approve"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["write_back"] == "SOURCE_CHANGED"


def test_a_malformed_run_never_renders_a_report(monkeypatch):
    import warrantyops.cli as cli_module

    class NeitherRun:
        """A run reporting neither a refusal nor an outcome — malformed."""

        idempotency_key = None
        refusal = None
        outcome = None

        def to_dict(self):
            return {"idempotency_key": None}

    monkeypatch.setattr(cli_module, "run_exception", lambda *a, **k: NeitherRun())
    with pytest.raises(ValueError, match="neither a refusal nor an outcome"):
        main(["--scenario", "case_a_useful_resolution"])
