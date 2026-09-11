from __future__ import annotations

import json
from pathlib import Path

import pytest

from demo.run_local import tamper
from fake import scenarios
from ringdown.__main__ import CONFIRMATION, main
from ringdown.exits import (
    EXIT_ACKNOWLEDGED,
    EXIT_DECLINED,
    EXIT_UNKNOWN,
    EXIT_UNRESOLVED,
    EXIT_UNVERIFIED,
    EXIT_USAGE,
)
from ringdown.audit import append_record
from ringdown.calle import LIVE_BASE_URL, LIVE_MCP_URL, RestClient
from tests.data import ALICE, BEN, CARLA, EXAMPLES, example_body, write_json

ROTATION = str(EXAMPLES / "rotation.example.json")
PAYLOAD = str(EXAMPLES / "alertmanager.example.json")


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("RINGDOWN_FAKE_API_KEY", "rd_test_key")
    monkeypatch.setenv("RINGDOWN_FAKE_MCP_TOKEN", "rd_test_token")


@pytest.fixture
def incident_file(tmp_path: Path) -> Path:
    body = example_body("incident")
    body["policy"] = {**body["policy"], "poll_interval_seconds": 0.005}
    return write_json(tmp_path, "incident.json", body)


def _run(base_url: str, incident_file: Path, ledger: Path, *extra: str, mcp_url: str = "") -> int:
    return main(
        [
            "run",
            "--incident", str(incident_file),
            "--rotation", ROTATION,
            "--ledger", str(ledger),
            "--base-url", base_url,
            "--mcp-url", mcp_url or f"{base_url}/mcp",
            *extra,
        ]
    )


def _adapt(tmp_path: Path, mapping: dict, *extra: str) -> int:
    return main(
        [
            "adapt",
            "--payload", PAYLOAD,
            "--mapping", str(write_json(tmp_path, "mapping.json", mapping)),
            *extra,
        ]
    )


def test_preview_never_touches_the_network(incident_file, capsys):
    code = main(["--incident", str(incident_file), "--rotation", ROTATION])
    assert code == EXIT_ACKNOWLEDGED
    assert "idempotency key rd-inc-2026-08-09-0113-primary-1-" in capsys.readouterr().out


def test_the_bare_command_prints_help_instead_of_guessing(capsys):
    assert main([]) == EXIT_USAGE
    assert "{preview,run,verify,adapt}" in capsys.readouterr().out


def test_run_without_the_confirmation_phrase_places_no_call(serving, incident_file, tmp_path):
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    assert _run(server.base_url, incident_file, tmp_path / "l.jsonl") == EXIT_USAGE
    assert server.created == []


def test_run_without_an_api_key_in_the_environment_places_no_call(
    serving, incident_file, tmp_path, monkeypatch
):
    monkeypatch.delenv("RINGDOWN_FAKE_API_KEY")
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    code = _run(server.base_url, incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION)
    assert code == EXIT_USAGE
    assert server.created == []


def test_a_host_outside_the_allowlist_is_refused(incident_file, tmp_path):
    code = _run(
        "https://calls.example.com", incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION
    )
    assert code == EXIT_USAGE


def test_the_live_api_key_is_never_read_for_a_run_against_the_local_fake(
    serving, incident_file, tmp_path, capsys, monkeypatch
):
    monkeypatch.delenv("RINGDOWN_FAKE_API_KEY")
    monkeypatch.setenv("CALLE_API_KEY", "rd_live_key")
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"

    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    assert code == EXIT_USAGE
    assert "RINGDOWN_FAKE_API_KEY is not set" in capsys.readouterr().out
    assert server.created == []
    assert not ledger.exists()


def test_swapping_the_two_flags_never_sends_a_credential_to_the_other_channel(
    incident_file, tmp_path, capsys
):
    ledger = tmp_path / "l.jsonl"
    code = _run(
        LIVE_MCP_URL,
        incident_file,
        ledger,
        "--confirm",
        CONFIRMATION,
        mcp_url=LIVE_BASE_URL,
    )
    assert code == EXIT_USAGE
    assert "refusing to send a credential" in capsys.readouterr().out
    assert not ledger.exists()


def test_two_channels_on_one_loopback_host_are_announced_not_refused(
    serving, incident_file, tmp_path, capsys
):
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    code = _run(server.base_url, incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION)
    assert code == EXIT_ACKNOWLEDGED
    assert "note: both channels are loopback" in capsys.readouterr().out


def test_the_ledger_names_the_channels_it_ran_against(serving, incident_file, tmp_path):
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    assert _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION) == 0
    written = ledger.read_text()
    verification = json.loads(written.splitlines()[-1])
    assert verification["rest_host"] == "127.0.0.1" and verification["mcp_host"] == "127.0.0.1"
    assert "rd_test_token" not in written and "rd_test_key" not in written


def test_an_acknowledged_and_verified_call_exits_zero(serving, incident_file, tmp_path):
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)
    assert code == EXIT_ACKNOWLEDGED
    kinds = [json.loads(line)["type"] for line in ledger.read_text().splitlines()]
    assert kinds == ["intent", "attempt", "verdict", "verification"]


def test_a_truncated_ledger_refuses_to_run_and_places_no_call(serving, incident_file, tmp_path):
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    append_record(ledger, {"type": "note"})
    ledger.write_text(ledger.read_text()[:-2])
    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)
    assert code == EXIT_USAGE
    assert len(server.created) == 0


def test_a_channel_mismatch_exits_forty(serving, incident_file, tmp_path, capsys):
    server = serving({ALICE.phone: scenarios.channel_mismatch("Alice Okafor", "alice")})
    code = _run(server.base_url, incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION)
    assert code == EXIT_UNVERIFIED
    assert "verified 6/10" in capsys.readouterr().out


def test_the_second_channel_is_read_from_the_url_it_was_given(
    serving, incident_file, tmp_path, capsys
):
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    code = _run(
        server.base_url,
        incident_file,
        tmp_path / "l.jsonl",
        "--confirm",
        CONFIRMATION,
        mcp_url=f"{server.base_url}/somewhere-else",
    )
    assert code == EXIT_UNRESOLVED
    assert "[?] second channel returned a run" in capsys.readouterr().out


def test_a_second_channel_that_cannot_be_reached_is_unresolved_not_a_mismatch(
    serving, incident_file, tmp_path, capsys, monkeypatch
):
    monkeypatch.setattr("ringdown.calle.MCP_RETRY_DELAY", 0)
    server = serving(
        {ALICE.phone: scenarios.unreachable_second_channel("Alice Okafor", "alice")}
    )
    ledger = tmp_path / "l.jsonl"

    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    assert code == EXIT_UNRESOLVED
    out = capsys.readouterr().out
    assert "[?] second channel returned a run" in out
    assert "1 unresolved" in out
    assert "Treat this incident as unowned." not in out
    verification = json.loads(ledger.read_text().splitlines()[-1])
    assert verification["unresolved"] == 1


def test_a_second_channel_that_refuses_our_credentials_is_unresolved_not_a_mismatch(
    serving, incident_file, tmp_path, capsys, monkeypatch
):
    monkeypatch.setenv("RINGDOWN_FAKE_MCP_TOKEN", "expired")
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"

    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    assert code == EXIT_UNRESOLVED
    out = capsys.readouterr().out
    assert "[?] second channel returned a run" in out
    assert "invalid_token" in out
    assert "Treat this incident as unowned." not in out
    verification = json.loads(ledger.read_text().splitlines()[-1])
    assert verification["unresolved"] == 1 and verification["verified"] is False
    unanswered = "second channel returned a run for call call_fake1 (invalid_token)"
    assert verification["unanswered"] == [unanswered]
    assert verification["contradicted"] == []


def test_a_person_who_declines_is_an_answer_and_exits_ten(serving, incident_file, tmp_path):
    server = serving({ALICE.phone: scenarios.declined("Alice Okafor", "alice")})
    code = _run(server.base_url, incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION)
    assert code == EXIT_DECLINED
    assert len(server.created) == 1


def test_the_ledger_records_which_checks_did_not_pass(serving, incident_file, tmp_path):
    server = serving({ALICE.phone: scenarios.channel_mismatch("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    assert _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION) == EXIT_UNVERIFIED
    written = ledger.read_text()
    verification = json.loads(written.splitlines()[-1])
    assert verification["contradicted"] == [
        "re-extracting the second channel transcript gives disposition acknowledged",
        "the recorded disposition span is spoken by the recipient",
        "the recorded owner Alice Okafor is spoken by the recipient",
        "the recorded ETA of 15 minutes is spoken by the recipient",
    ]
    assert verification["unanswered"] == []
    assert ALICE.phone not in written


def test_a_crash_mid_ladder_leaves_the_placed_attempt_and_the_pending_key_on_the_ledger(
    serving, incident_file, tmp_path, monkeypatch, capsys
):
    server = serving(
        {
            ALICE.phone: scenarios.no_answer(),
            BEN.phone: scenarios.answer_ack("Ben Mensah", "ben"),
        }
    )
    ledger = tmp_path / "l.jsonl"
    placing = RestClient.create_call
    keys: list[str] = []

    def crash(self, payload, key):
        keys.append(key)
        if len(keys) == 2:
            raise KeyboardInterrupt
        return placing(self, payload, key)

    monkeypatch.setattr(RestClient, "create_call", crash)
    with pytest.raises(KeyboardInterrupt):
        _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    records = [json.loads(line) for line in ledger.read_text().splitlines()]
    assert [record["type"] for record in records] == ["intent", "attempt", "intent"]
    assert records[2]["key"] == keys[1]
    assert records[1]["call_id"] is not None

    capsys.readouterr()
    assert main(["verify", "--ledger", str(ledger)]) == EXIT_UNRESOLVED
    out = capsys.readouterr().out
    assert f"[?] record 3 announced {keys[1]} and has no attempt" in out


def test_an_unknown_call_state_is_not_verified(serving, incident_file, tmp_path, capsys):
    server = serving({ALICE.phone: scenarios.error_before_create("Alice Okafor", "alice")})
    code = _run(server.base_url, incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION)
    assert code == EXIT_UNKNOWN
    out = capsys.readouterr().out
    assert "verdict unknown" in out
    assert "on the second channel" not in out


def test_a_ladder_that_placed_no_call_is_not_reported_as_a_failed_verification(
    serving, incident_file, tmp_path, capsys
):
    server = serving({contact.phone: scenarios.refused() for contact in (ALICE, BEN, CARLA)})
    ledger = tmp_path / "l.jsonl"
    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    assert code == EXIT_USAGE
    assert server.created == []
    out = capsys.readouterr().out
    assert "No phone rang." in out
    assert "verified" not in out
    kinds = [json.loads(line)["type"] for line in ledger.read_text().splitlines()]
    assert "verification" not in kinds


def test_an_instruction_addressed_to_the_agent_is_recorded_in_the_ledger(
    serving, incident_file, tmp_path
):
    server = serving(
        {
            ALICE.phone: scenarios.injected_voicemail("Alice Okafor"),
            BEN.phone: scenarios.answer_ack("Ben Mensah", "ben"),
        }
    )
    ledger = tmp_path / "l.jsonl"
    _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    records = [json.loads(line) for line in ledger.read_text().splitlines()]
    attempts = [record for record in records if record["type"] == "attempt"]
    assert [attempt["instructed"] for attempt in attempts] == [True, False]


def test_adapt_omits_a_key_whose_path_does_not_resolve(tmp_path, capsys):
    mapping = example_body("field-mapping")
    mapping["runbook_url"] = "$.alerts[7].annotations.runbook_url"
    assert _adapt(tmp_path, mapping) == EXIT_ACKNOWLEDGED
    assert "runbook_url" not in json.loads(capsys.readouterr().out)


def test_adapt_writes_nothing_when_the_mapped_incident_is_invalid(tmp_path):
    mapping = example_body("field-mapping")
    mapping["severity"] = "sev9"
    out = tmp_path / "incident.json"
    assert _adapt(tmp_path, mapping, "--out", str(out)) == EXIT_USAGE
    assert not out.exists()


def test_a_second_channel_answering_in_a_shape_we_cannot_read_is_unresolved_not_a_mismatch(
    serving, incident_file, tmp_path, capsys, monkeypatch
):
    monkeypatch.setattr("ringdown.calle.MCP_RETRY_DELAY", 0)
    server = serving(
        {ALICE.phone: scenarios.second_channel_speaks_another_dialect("Alice Okafor", "alice")}
    )

    code = _run(server.base_url, incident_file, tmp_path / "l.jsonl", "--confirm", CONFIRMATION)

    assert code == EXIT_UNRESOLVED
    out = capsys.readouterr().out
    assert "[?] second channel returned a run" in out
    assert "unreadable_run" in out
    assert "Treat this incident as unowned." not in out


def test_a_ledger_the_second_channel_contradicted_does_not_pass_verify_ledger(
    serving, incident_file, tmp_path, capsys
):
    server = serving({ALICE.phone: scenarios.channel_mismatch("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    assert _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION) == EXIT_UNVERIFIED

    capsys.readouterr()
    assert main(["verify", "--ledger", str(ledger)]) == EXIT_UNVERIFIED
    assert "contradicted on the second channel" in capsys.readouterr().out


def test_a_ledger_the_second_channel_never_answered_is_unresolved_not_unverified(
    serving, incident_file, tmp_path, capsys, monkeypatch
):
    monkeypatch.setenv("RINGDOWN_FAKE_MCP_TOKEN", "expired")
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    assert _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION) == EXIT_UNRESOLVED

    capsys.readouterr()
    assert main(["verify", "--ledger", str(ledger)]) == EXIT_UNRESOLVED
    assert "never confirmed on the second channel" in capsys.readouterr().out


def test_a_missing_mcp_token_stops_the_run_before_any_call_is_placed(
    serving, incident_file, tmp_path, capsys, monkeypatch
):
    monkeypatch.delenv("RINGDOWN_FAKE_MCP_TOKEN")
    server = serving({ALICE.phone: scenarios.answer_ack("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"

    code = _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)

    assert code == EXIT_USAGE
    assert "RINGDOWN_FAKE_MCP_TOKEN is not set" in capsys.readouterr().out
    assert len(server.created) == 0
    assert not ledger.exists()


def test_a_rewritten_verdict_with_a_relinked_chain_still_fails_verify_ledger(
    serving, incident_file, tmp_path, capsys
):
    server = serving({ALICE.phone: scenarios.declined("Alice Okafor", "alice")})
    ledger = tmp_path / "l.jsonl"
    _run(server.base_url, incident_file, ledger, "--confirm", CONFIRMATION)
    assert main(["verify", "--ledger", str(ledger)]) == EXIT_ACKNOWLEDGED

    tampered = tmp_path / "tampered.jsonl"
    tamper(ledger, tampered)

    capsys.readouterr()
    assert main(["verify", "--ledger", str(tampered)]) == EXIT_UNVERIFIED
    out = capsys.readouterr().out
    assert "hash matches its content" in out
    assert "does not follow from the recorded attempts (declined)" in out
