import json
from unittest.mock import patch

import pytest

from pipeline.caller import AmbiguousCallOutcome, RealCallEClient

PLAN_READY = json.dumps({"ready_to_run": True, "plan_id": "plan-1", "confirm_token": "token-1"})


def _completed_proc(stdout: str):
    class _Proc:
        returncode = 0

        def __init__(self):
            self.stdout = stdout
            self.stderr = ""

    return _Proc()


def _timed_out_proc():
    class _Proc:
        returncode = 1

        def __init__(self):
            self.stdout = ""
            self.stderr = "Error: MCP request timed out for tools/call"

    return _Proc()


@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_call_run_timeout_raises_without_retrying(mock_run, mock_which):
    # First subprocess call is `call plan`, which succeeds; second is
    # `call run`, which times out. call run must not be retried — a retry
    # here risks a real duplicate dial, since there's no idempotency key.
    mock_run.side_effect = [_completed_proc(PLAN_READY), _timed_out_proc()]

    client = RealCallEClient(max_request_retries=2)
    with pytest.raises(AmbiguousCallOutcome, match="Not retrying automatically") as exc_info:
        client.place_screening_call("+18005550187", "task text")

    assert mock_run.call_count == 2  # plan (1) + run (1, no retries) — not 1 + 3
    assert "8005550187" not in str(exc_info.value)  # the dialed number must not leak into the error text


@patch("pipeline.caller.time.sleep")
@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_exhausted_retry_error_does_not_leak_the_phone_number(mock_run, mock_which, mock_sleep):
    # call plan times out on every attempt (1 + max_request_retries), so the
    # generic RuntimeError fires — it echoes back the CLI args and CALL-E's
    # own stderr/stdout, both of which can contain the dialed number.
    mock_run.side_effect = [_timed_out_proc(), _timed_out_proc(), _timed_out_proc()]

    client = RealCallEClient(max_request_retries=2)
    with pytest.raises(RuntimeError) as exc_info:
        client.place_screening_call("+18005550187", "task text mentioning +18005550187")

    assert "8005550187" not in str(exc_info.value)


@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_call_plan_timeout_is_retried_since_it_has_no_side_effect(mock_run, mock_which):
    # call plan is a dry-run with no side effect, so retrying it on a
    # transient timeout is safe and should still happen — unlike call run.
    run_completed = json.dumps({"run_id": "run-1", "status": "COMPLETED", "result": {"transcript": "hi"}})
    mock_run.side_effect = [_timed_out_proc(), _completed_proc(PLAN_READY), _completed_proc(run_completed)]

    client = RealCallEClient(max_request_retries=2, poll_interval_seconds=0)
    result = client.place_screening_call("+18005550187", "task text")

    assert result.transcript == "hi"
    assert result.metadata.status == "COMPLETED"
    assert result.metadata.call_id == "run-1"
    assert mock_run.call_count == 3  # plan (timeout, then retry succeeds) + run (succeeds first try)
