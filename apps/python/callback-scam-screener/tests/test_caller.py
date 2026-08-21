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


@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_recipient_binding_reads_back_to_phones_not_just_the_request(mock_run, mock_which):
    # Recipient binding only means something if number_dialed comes from an
    # independent record of who was actually called, not a restatement of
    # what we asked for. CALL-E's own skill reference documents
    # result.extracted.to_phones[0] as the callee-number field.
    run_completed = json.dumps(
        {
            "run_id": "run-1",
            "status": "COMPLETED",
            "result": {"transcript": "hi", "extracted": {"to_phones": ["+447700900999"]}},
        }
    )
    mock_run.side_effect = [_completed_proc(PLAN_READY), _completed_proc(run_completed)]

    client = RealCallEClient()
    # Request a different (but still fictional) number than what the fake
    # response reports back, to prove the value actually comes from the
    # response and isn't just echoing the request.
    result = client.place_screening_call("+18005550187", "task text")

    assert result.metadata.number_dialed == "+447700900999"


@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_recipient_binding_falls_back_to_calling_callee(mock_run, mock_which):
    run_completed = json.dumps(
        {
            "run_id": "run-1",
            "status": "COMPLETED",
            "result": {"transcript": "hi", "extracted": {"calling": {"callee": "+447700900999"}}},
        }
    )
    mock_run.side_effect = [_completed_proc(PLAN_READY), _completed_proc(run_completed)]

    client = RealCallEClient()
    result = client.place_screening_call("+18005550187", "task text")

    assert result.metadata.number_dialed == "+447700900999"


@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_recipient_binding_falls_back_to_requested_number_when_calle_reports_neither(mock_run, mock_which):
    run_completed = json.dumps({"run_id": "run-1", "status": "COMPLETED", "result": {"transcript": "hi"}})
    mock_run.side_effect = [_completed_proc(PLAN_READY), _completed_proc(run_completed)]

    client = RealCallEClient()
    result = client.place_screening_call("+18005550187", "task text")

    assert result.metadata.number_dialed == "+18005550187"


@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_call_run_timeout_error_does_not_leak_confirm_token(mock_run, mock_which):
    # --confirm-token authorizes actually placing this specific call — a
    # live credential, not just PII. It must not leak into an error message
    # someone might paste into a bug report, the same way the phone number
    # doesn't.
    mock_run.side_effect = [_completed_proc(PLAN_READY), _timed_out_proc()]

    client = RealCallEClient(max_request_retries=2)
    with pytest.raises(AmbiguousCallOutcome) as exc_info:
        client.place_screening_call("+18005550187", "task text")

    assert "token-1" not in str(exc_info.value)
    assert "[redacted]" in str(exc_info.value)


@patch("pipeline.caller.time.sleep")
@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_exhausted_retry_error_does_not_leak_plan_id_or_confirm_token(mock_run, mock_which, mock_sleep):
    plan_ready = json.dumps({"ready_to_run": True, "plan_id": "plan-secret-id", "confirm_token": "token-secret"})
    mock_run.side_effect = [_completed_proc(plan_ready), _timed_out_proc(), _timed_out_proc(), _timed_out_proc()]

    client = RealCallEClient(max_request_retries=2)
    with pytest.raises(RuntimeError) as exc_info:
        client.place_screening_call("+18005550187", "task text")

    assert "plan-secret-id" not in str(exc_info.value)
    assert "token-secret" not in str(exc_info.value)


@patch("pipeline.caller.time.sleep")
@patch("pipeline.caller.shutil.which", return_value="C:/fake/calle.cmd")
@patch("pipeline.caller.subprocess.run")
def test_poll_timeout_raises_ambiguous_call_outcome(mock_run, mock_which, mock_sleep):
    # A plain TimeoutError isn't caught by screen.py's except clauses (it
    # subclasses OSError, not RuntimeError) and would surface as a raw
    # traceback for a call that may still be in progress. This must raise
    # the same AmbiguousCallOutcome the call-run timeout does.
    run_in_progress = json.dumps({"run_id": "run-1", "status": "IN_PROGRESS"})
    mock_run.side_effect = [_completed_proc(PLAN_READY), _completed_proc(run_in_progress), _completed_proc(run_in_progress)]

    client = RealCallEClient(poll_timeout_seconds=0, poll_interval_seconds=0)
    with pytest.raises(AmbiguousCallOutcome, match="did not reach a terminal status"):
        client.place_screening_call("+18005550187", "task text")
