"""Runtime evidence recovery and receipt persistence, mocked clients only.

Recovery re-reads a call that already happened: one ``calls.get`` against the
id the durable ledger stored, zero creations, the reservation untouched, and
a sanitized receipt rebuilt atomically. Nothing here touches a network, a
credential or the real artifact directory.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest
from test_calle_adapter import FakeCalleCalls
from test_runtime_proof import (
    API_KEY_PLACEHOLDER,
    CALL_ID,
    ENV,
    NOW,
    ON,
    PY311,
    RECIPIENT,
    TERMINAL_PAYLOAD,
    TRANSCRIPT_TURNS,
    CountingFactory,
    execute,
)

from warrantyops import runtime_proof
from warrantyops.contract import CONTRACT_VERSION
from warrantyops.idempotency import derive_idempotency_key
from warrantyops.ledger import SqliteAttemptLedger
from warrantyops.runtime_proof import (
    RECEIPT_FILENAME,
    dedupe_requirements,
    recover_runtime_result,
)


def safe_env(tmp_path) -> dict:
    env = dict(ENV)
    env["WARRANTYOPS_ARTIFACT_DIR"] = str(tmp_path / "artifacts")
    return env


def recovery_client(events=None) -> FakeCalleCalls:
    """A fake SDK namespace whose get() replays the stored terminal record."""

    return FakeCalleCalls(
        created={"id": "must-never-be-created"},
        statuses=[TERMINAL_PAYLOAD],
        events=events if events is not None else [],
    )


def recover(tmp_path, calls=None, ledger_db=None, env=None):
    events: list[tuple] = []
    fake = calls if calls is not None else recovery_client(events)
    return (
        recover_runtime_result(
            env=env or safe_env(tmp_path),
            ledger_db=ledger_db or (tmp_path / "attempts.sqlite"),
            client_factory=CountingFactory(fake),
            python_version_info=PY311,
            sdk_imports=True,
            now=NOW,
            on=ON,
        ),
        fake,
        events,
    )


def canonical_key() -> str:
    return derive_idempotency_key(
        namespace="warrantyops",
        authorization_record_reference="synthetic://runtime-proof/consent/W-1042",
        source_platform="SYNTHETIC-NORTHSTAR",
        source_claim_id="W-1042",
        source_version="runtime-proof-v1",
        contract_version=CONTRACT_VERSION,
    )


# --- receipt persistence ------------------------------------------------------


def test_successful_live_execution_writes_exactly_one_receipt_file(tmp_path):
    report, _ = execute(tmp_path)
    assert report["evidence_persistence"] == "SAVED"
    artifacts = tmp_path / "artifacts"
    assert [path.name for path in artifacts.iterdir()] == [RECEIPT_FILENAME]


def test_the_receipt_filename_and_body_carry_no_secrets(tmp_path):
    report, _ = execute(tmp_path)
    assert RECEIPT_FILENAME == "runtime-proof-receipt.json"
    assert RECIPIENT not in RECEIPT_FILENAME
    assert CALL_ID not in RECEIPT_FILENAME
    body = (tmp_path / "artifacts" / RECEIPT_FILENAME).read_text(encoding="utf-8")
    for forbidden in (API_KEY_PLACEHOLDER, RECIPIENT, CALL_ID):
        assert forbidden not in body, forbidden
    for speaker, text in TRANSCRIPT_TURNS:
        if speaker == "bot":
            assert text not in body  # agent turns never appear


@pytest.mark.skipif(os.name == "nt", reason="Windows does not expose POSIX mode bits")
def test_the_receipt_file_mode_is_0600(tmp_path):
    execute(tmp_path)
    mode = (tmp_path / "artifacts" / RECEIPT_FILENAME).stat().st_mode
    assert stat.S_IMODE(mode) == 0o600


def test_receipt_writing_replaces_atomically_and_leaves_no_temporary(tmp_path, monkeypatch):
    replaced: list[tuple] = []
    real_replace = os.replace

    def watched_replace(source, target):
        replaced.append((Path(source).name, Path(target).name))
        return real_replace(source, target)

    monkeypatch.setattr(runtime_proof.os, "replace", watched_replace)
    execute(tmp_path)
    assert replaced == [
        (f".{RECEIPT_FILENAME}.tmp", RECEIPT_FILENAME)
    ]
    artifacts = tmp_path / "artifacts"
    assert [path.name for path in artifacts.iterdir()] == [RECEIPT_FILENAME]


def test_a_receipt_write_failure_is_an_explicit_persistence_failure(tmp_path, monkeypatch):
    def broken_replace(source, target):
        raise OSError("disk unavailable")

    monkeypatch.setattr(runtime_proof.os, "replace", broken_replace)
    report, _ = execute(tmp_path)
    assert report["evidence_persistence"] == "FAILED"
    assert report["receipt_error"]
    assert report["calls_placed"] == 1  # the call itself already happened
    artifacts = tmp_path / "artifacts"
    assert [path.name for path in artifacts.iterdir()] == []  # no partial file
    # API keys, phone and call id stay out of the failure surface too.
    dumped = json.dumps(report)
    assert API_KEY_PLACEHOLDER not in dumped
    assert RECIPIENT not in dumped


# --- recovery -------------------------------------------------------------------


def test_recovery_reads_the_stored_call_exactly_once_and_never_creates(tmp_path):
    execute(tmp_path)  # places the (mocked) call and stores the id durably
    report, fake, events = recover(tmp_path)
    assert report["refused"] is False
    assert report["calls_created"] == 0
    assert fake.create_count == 0
    gets = [event for event in events if event[0] == "get"]
    assert len(gets) == 1


def test_recovery_uses_the_call_id_from_the_ledger_and_leaves_it_intact(tmp_path):
    execute(tmp_path)
    report, fake, events = recover(tmp_path)
    assert events[0] == ("get", CALL_ID)
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    row = ledger.rows()[0]
    assert row["call_id"] == CALL_ID
    assert row["state"] == "COMPLETED"  # reservation untouched
    assert report["ledger_reservation_untouched"] is True
    assert report["ledger_state"] == "COMPLETED"
    assert report["evidence_persistence"] == "SAVED"


def test_recovery_without_a_stored_call_id_refuses_safely(tmp_path):
    ledger_db = tmp_path / "attempts.sqlite"
    ledger = SqliteAttemptLedger(ledger_db)
    ledger.reserve(canonical_key(), "f" * 64)  # reserved, never attached
    report, fake, _ = recover(tmp_path, ledger_db=ledger_db)
    assert report["refused"] is True
    assert report["reasons"] == ["NO_CALL_ID_TO_RECOVER"]
    assert fake.create_count == 0
    assert fake.events == []  # not even a read was attempted


def test_recovery_refuses_when_no_reservation_exists(tmp_path):
    report, _, _ = recover(tmp_path)
    assert report["refused"] is True
    assert report["reasons"] == ["NO_CALL_ID_TO_RECOVER"]


def test_recovery_requires_an_explicit_ledger_outside_the_repository(tmp_path):
    from warrantyops.config import find_repository_root

    repo_root = find_repository_root()
    report, fake, _ = recover(
        tmp_path,
        ledger_db=repo_root / "apps" / "python" / "warrantyops" / "a.sqlite",
    )
    assert report["refused"] is True
    assert "LEDGER_PATH_INSIDE_REPOSITORY" in report["reasons"]
    assert fake.events == []


def test_recovery_receipt_is_sanitized_and_withholds_write_back(tmp_path):
    execute(tmp_path)
    report, _, _ = recover(tmp_path)
    assert report["write_back"] == "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW"
    assert report["mode"] == "recover-runtime-result"
    assert report["schema"] == "warrantyops-runtime-receipt/1"
    assert report["source_version"] == "runtime-proof-v1"
    assert report["contract_version"] == CONTRACT_VERSION
    dumped = json.dumps(report)
    for forbidden in (API_KEY_PLACEHOLDER, RECIPIENT, CALL_ID):
        assert forbidden not in dumped, forbidden


# --- missing-requirement deduplication -------------------------------------------


def test_equivalent_missing_requirements_are_deduplicated_in_the_receipt(tmp_path):
    report, _ = execute(tmp_path)
    # The correction was "Requires an installation photograph" and the
    # document list held "installation photograph": one displayed entry.
    assert report["missing_requirement"] == ["installation photograph"]
    fields = [item["field"] for item in report["evidence"]]
    assert "required_correction" in fields  # supporting evidence kept
    assert "required_documents" in fields


def test_dedu_requirements_do_not_merge_unrelated_entries():
    entries = [
        "Requires an installation photograph",
        "installation photograph",
        "An installation photograph is required",
        "photograph of the data plate",
        "proof of purchase",
    ]
    assert dedupe_requirements(entries) == [
        "installation photograph",
        "photograph of the data plate",
        "proof of purchase",
    ]


# --- refused recovery paths -------------------------------------------------------


def test_recovery_without_a_ledger_refuses_at_the_requirements_gate(tmp_path):
    report = recover_runtime_result(
        env=safe_env(tmp_path),
        ledger_db=None,
        client_factory=CountingFactory(recovery_client()),
        python_version_info=PY311,
        sdk_imports=True,
        now=NOW,
        on=ON,
    )
    assert report["refused"] is True
    assert "MISSING_LEDGER_DB" in report["reasons"]


def test_an_unopenable_ledger_refuses_recovery_before_any_read(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("a regular file where a directory was expected")
    report = recover_runtime_result(
        env=safe_env(tmp_path),
        ledger_db=blocker / "attempts.sqlite",
        client_factory=CountingFactory(recovery_client()),
        python_version_info=PY311,
        sdk_imports=True,
        now=NOW,
        on=ON,
    )
    assert report["refused"] is True
    assert report["stage"] == "LEDGER"
    assert report["calls_created"] == 0


def test_a_failed_read_of_the_existing_call_refuses_without_a_retry(tmp_path):
    execute(tmp_path)  # seed the durable reservation and its call id
    failing = FakeCalleCalls(created={"id": "never"}, get_error=RuntimeError("read failed"))
    report, _fake, events = recover(tmp_path, calls=failing)
    assert report["refused"] is True
    assert report["stage"] == "RETRIEVAL"
    assert report["reasons"] == ["EXISTING_CALL_READ_FAILED"]
    # One read of the stored id, zero creations, no second dial.
    assert [event[0] for event in failing.events] == ["get"]


def test_recovery_constructs_the_sdk_client_when_no_factory_is_given(
    tmp_path, monkeypatch
):
    import sys
    import types

    constructed: list[dict] = []

    class FakeSdkClient:
        def __init__(self, *, api_key: str, base_url: str, timeout: float) -> None:
            constructed.append({"has_key": bool(api_key), "base_url": base_url})
            self.calls = recovery_client()

        def __enter__(self) -> FakeSdkClient:
            return self

        def __exit__(self, *exc) -> bool:
            return False

    module = types.ModuleType("calle")
    module.CalleClient = FakeSdkClient  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calle", module)

    execute(tmp_path)  # seed the durable reservation and its call id
    report = recover_runtime_result(
        env=safe_env(tmp_path),
        ledger_db=tmp_path / "attempts.sqlite",
        client_factory=None,
        python_version_info=PY311,
        sdk_imports=True,
        now=NOW,
        on=ON,
    )
    assert report["refused"] is False
    assert report["calls_created"] == 0
    assert constructed == [{"has_key": True, "base_url": ENV["CALLE_BASE_URL"]}]


# --- private-artifact purge (P8) ---------------------------------------------


def backdate(path, days: float) -> None:
    """Move a file's mtime into the past without touching its bytes."""

    import time

    old = time.time() - days * 86400
    os.utime(path, (old, old))


def test_purge_deletes_only_expired_owned_files_and_never_the_ledger(tmp_path):
    from warrantyops.runtime_proof import purge_artifacts

    execute(tmp_path)  # one fresh receipt + one COMPLETED ledger row
    artifacts = tmp_path / "artifacts"
    stranger = artifacts / "operators-other-private-note.txt"
    stranger.write_text("not ours to delete", encoding="utf-8")
    backdate(artifacts / RECEIPT_FILENAME, days=91)

    report = purge_artifacts(safe_env(tmp_path))
    assert report["refused"] is False
    assert report["purged"] == [RECEIPT_FILENAME]
    assert not (artifacts / RECEIPT_FILENAME).exists()
    assert stranger.exists()  # only files this package writes are considered
    # The ledger is untouched: history is never rewritten by deletion.
    ledger = SqliteAttemptLedger(tmp_path / "attempts.sqlite")
    assert ledger.rows()[0]["state"] == "COMPLETED"


def test_purge_retains_receipts_inside_the_window(tmp_path):
    from warrantyops.runtime_proof import purge_artifacts

    execute(tmp_path)
    backdate(tmp_path / "artifacts" / RECEIPT_FILENAME, days=30)
    stale_tmp = tmp_path / "artifacts" / f".{RECEIPT_FILENAME}.tmp"
    stale_tmp.write_text("orphaned mid-write temporary", encoding="utf-8")
    backdate(stale_tmp, days=400)

    report = purge_artifacts(safe_env(tmp_path))
    # The receipt (30 days old) sits inside the 90-day window; the orphaned
    # temporary (400 days) is far past it.
    assert report == {
        "refused": False,
        "retention_days": 90,
        "purged": [f".{RECEIPT_FILENAME}.tmp"],
        "retained": 1,
    }
    assert (tmp_path / "artifacts" / RECEIPT_FILENAME).exists()
    assert not stale_tmp.exists()


def test_purge_refuses_a_missing_or_in_repository_artifact_dir(tmp_path):
    from warrantyops.config import find_repository_root
    from warrantyops.runtime_proof import purge_artifacts

    missing = purge_artifacts({})
    assert missing["refused"] is True
    assert missing["reasons"] == ["ARTIFACT_DIR_MISSING"]
    assert missing["purged"] == []

    repo_root = find_repository_root()
    assert repo_root is not None
    inside = purge_artifacts(
        {
            "WARRANTYOPS_ARTIFACT_DIR": str(
                repo_root / "apps" / "python" / "warrantyops" / "artifacts"
            )
        }
    )
    assert inside["refused"] is True
    assert inside["reasons"] == ["ARTIFACT_DIR_INSIDE_REPOSITORY"]

    negative = purge_artifacts(safe_env(tmp_path), retention_days=-1)
    assert negative["reasons"] == ["NEGATIVE_RETENTION_WINDOW"]


def test_purge_reports_a_file_it_cannot_delete(tmp_path, monkeypatch):
    from warrantyops.runtime_proof import purge_artifacts

    execute(tmp_path)
    target = tmp_path / "artifacts" / RECEIPT_FILENAME
    backdate(target, days=200)

    def refusing_unlink(path):
        raise OSError("permission denied by the test")

    monkeypatch.setattr(Path, "unlink", refusing_unlink)
    report = purge_artifacts(safe_env(tmp_path))
    assert report["refused"] is False
    assert report["purged"] == []
    assert report["undeletable"] == [RECEIPT_FILENAME]


def test_the_purge_cli_mode_reports_and_exits_by_refusal(
    tmp_path, capsys, monkeypatch
):
    from warrantyops.cli import main

    monkeypatch.delenv("WARRANTYOPS_ARTIFACT_DIR", raising=False)
    refused = main(["--purge-artifacts"])  # no artifact directory configured
    assert refused == 1
    body = json.loads(capsys.readouterr().out)
    assert body["refused"] is True
    assert body["reasons"] == ["ARTIFACT_DIR_MISSING"]

    execute(tmp_path)
    backdate(tmp_path / "artifacts" / RECEIPT_FILENAME, days=100)
    monkeypatch.setenv("WARRANTYOPS_ARTIFACT_DIR", str(tmp_path / "artifacts"))
    assert main(["--purge-artifacts", "--retention-days", "90"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["purged"] == [RECEIPT_FILENAME]
    # A one-shot mode refuses to share the invocation with another mode; the
    # retention option without its mode is refused too.
    assert main(["--purge-artifacts", "--verify-docs"]) == 2
    assert main(["--retention-days", "5"]) == 2
