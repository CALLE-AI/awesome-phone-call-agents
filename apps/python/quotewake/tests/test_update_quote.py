import json
import os
import stat
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update-quote.sh"
QUOTE_ID = "0Q0123456789ABC"


FAKE_SF = """#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

args = sys.argv[1:]
Path(os.environ["FAKE_SF_LOG"]).open("a", encoding="utf-8").write(
    json.dumps(args) + "\\n"
)
if args[:2] == ["data", "query"]:
    print(Path(os.environ["FAKE_SF_RESPONSE"]).read_text(encoding="utf-8"), end="")
    raise SystemExit(0)
if args[:3] == ["data", "update", "record"]:
    print(json.dumps({"result": {"id": os.environ.get("FAKE_SF_UPDATED_ID", "0Q0123456789ABC")}}))
    raise SystemExit(0)
raise SystemExit(1)
"""


def quote_response(*records: dict) -> dict:
    return {"result": {"totalSize": len(records), "records": list(records)}}


def run_update(tmp_path: Path, response: dict, *args: str) -> tuple[subprocess.CompletedProcess[str], list[list[str]]]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_sf = fake_bin / "sf"
    fake_sf.write_text(FAKE_SF, encoding="utf-8")
    fake_sf.chmod(fake_sf.stat().st_mode | stat.S_IXUSR)

    response_path = tmp_path / "response.json"
    response_path.write_text(json.dumps(response), encoding="utf-8")
    log_path = tmp_path / "sf-args.jsonl"
    environment = os.environ.copy()
    environment.update(
        {
            "PATH": f"{fake_bin}{os.pathsep}{environment['PATH']}",
            "FAKE_SF_LOG": str(log_path),
            "FAKE_SF_RESPONSE": str(response_path),
        }
    )

    result = subprocess.run(
        [str(SCRIPT), *args],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    if log_path.exists():
        calls = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    else:
        calls = []
    return result, calls


def record() -> dict:
    return {
        "Id": QUOTE_ID,
        "Name": "Demo\nQuote",
        "QuoteWake_Enabled__c": False,
        "Follow_Up_Status__c": None,
        "Next_Follow_Up_At__c": None,
        "Attempt_Count__c": 0,
    }


def update_values(calls: list[list[str]]) -> str:
    update = next(call for call in calls if call[:3] == ["data", "update", "record"])
    return update[update.index("--values") + 1]


def test_updates_only_requested_fields_and_queries_before_after(tmp_path: Path):
    result, calls = run_update(
        tmp_path,
        quote_response(record()),
        QUOTE_ID,
        "--enabled",
        "true",
        "--follow-up-status",
        "Completed",
        "--attempt-count",
        "1",
        "--target-org",
        "quotewake-dev",
    )

    assert result.returncode == 0, result.stderr
    assert [call[:2] for call in calls] == [["data", "query"], ["data", "update"], ["data", "query"]]
    assert update_values(calls) == (
        "QuoteWake_Enabled__c=true Follow_Up_Status__c='Completed' Attempt_Count__c=1"
    )
    assert all(call[call.index("--target-org") + 1] == "quotewake-dev" for call in calls)
    assert "[Before update]" in result.stdout
    assert "[After update]" in result.stdout
    assert 'Name: "Demo\\nQuote"' in result.stdout


def test_retry_at_is_normalized_and_sets_retry_status(tmp_path: Path):
    result, calls = run_update(
        tmp_path,
        quote_response(record()),
        QUOTE_ID,
        "--retry-at",
        "2026-08-13T10:30:00+00:00",
    )

    assert result.returncode == 0, result.stderr
    assert update_values(calls) == (
        "Follow_Up_Status__c='Retry' Next_Follow_Up_At__c=2026-08-13T10:30:00Z"
    )


def test_retry_in_uses_one_utc_now_and_strict_duration(tmp_path: Path):
    before = datetime.now(timezone.utc)
    result, calls = run_update(tmp_path, quote_response(record()), QUOTE_ID, "--retry-in", "2s")
    after = datetime.now(timezone.utc)

    assert result.returncode == 0, result.stderr
    value = update_values(calls).split("Next_Follow_Up_At__c=", 1)[1]
    retry_at = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    assert before + timedelta(seconds=1) <= retry_at <= after + timedelta(seconds=3)
    assert update_values(calls).startswith("Follow_Up_Status__c='Retry'")


def test_missing_quote_does_not_update(tmp_path: Path):
    result, calls = run_update(tmp_path, quote_response(), QUOTE_ID, "--enabled", "true")

    assert result.returncode == 0
    assert len(calls) == 1
    assert calls[0][:2] == ["data", "query"]
    assert calls[0][-1] == "--json"
    assert "was not found; no update was made" in result.stdout


@pytest.mark.parametrize(
    "args",
    [
        ("not-a-quote", "--enabled", "true"),
        (QUOTE_ID,),
        (QUOTE_ID, "--enabled", "true", "--enabled", "false"),
        (QUOTE_ID, "--retry-in", "1h2d"),
        (QUOTE_ID, "--retry-in", "0s"),
        (QUOTE_ID, "--retry-at", "2026-08-13T10:30:00+01:00"),
        (QUOTE_ID, "--retry-at", "2026-02-30T10:30:00Z"),
        (QUOTE_ID, "--retry-in", "1h", "--follow-up-status", "Completed"),
        (QUOTE_ID, "--follow-up-status", "Completed", "--clear-follow-up-status"),
    ],
)
def test_invalid_input_is_rejected_before_sf_is_checked(tmp_path: Path, args: tuple[str, ...]):
    result, calls = run_update(tmp_path, quote_response(record()), *args)

    assert result.returncode != 0
    assert calls == []


def test_clear_status_and_retry_only_send_the_requested_nulls(tmp_path: Path):
    result, calls = run_update(
        tmp_path,
        quote_response(record()),
        QUOTE_ID,
        "--clear-follow-up-status",
        "--clear-retry",
    )

    assert result.returncode == 0, result.stderr
    assert update_values(calls) == "Follow_Up_Status__c= Next_Follow_Up_At__c="
