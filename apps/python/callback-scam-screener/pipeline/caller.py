import datetime
import json
import shutil
import subprocess
import time
from dataclasses import dataclass

from .models import CallMetadata

TERMINAL_STATUSES = {
    "COMPLETED", "FAILED", "NO_ANSWER", "DECLINED",
    "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED",
}


@dataclass
class CallResult:
    transcript: str
    metadata: CallMetadata
    structured_result: dict | None = None
    completion_confidence: float | None = None


class CallEClient:
    """Interface for placing the screening call. `task` is the agent's aim
    (see AGENT_PROMPTS.md), not a branching script — CALL-E is goal-driven
    and adapts the conversation itself. Note: CALL-E does NOT reliably honor
    requests for custom structured fields embedded in the task text — a real
    test call confirmed `extracted` only contains platform-internal
    bookkeeping, not fields we ask for — so `structured_result` should be
    treated as unavailable and signal detection done on the transcript
    (see signal_catalog.tag_transcript_llm)."""

    def place_screening_call(self, phone_number: str, task: str, result_schema: dict | None = None) -> CallResult:
        raise NotImplementedError


class RealCallEClient(CallEClient):
    """Live integration via the authenticated `calle` CLI, using the
    verified plan_call -> run_call -> poll get_call_run flow (confirmed
    working end-to-end against a real call on 2026-08-09).

    Two things learned from that real test that shape this implementation:
    - CALL-E's platform-level guardrails reject any goal asking the agent to
      impersonate the recipient or conceal that it's an AI. The task text
      must be transparent ("You are an AI assistant calling on behalf of...").
    - `--to-phone` is required on every `call plan` invocation, even when
      continuing an existing plan_id.
    """

    def __init__(self, poll_interval_seconds: float = 3.0, poll_timeout_seconds: float = 300.0):
        self.poll_interval_seconds = poll_interval_seconds
        self.poll_timeout_seconds = poll_timeout_seconds

    def place_screening_call(self, phone_number: str, task: str, result_schema: dict | None = None) -> CallResult:
        plan = self._structured(self._run_cli(["call", "plan", "--to-phone", phone_number, "--goal", task]))
        if not plan.get("ready_to_run"):
            questions = "; ".join(plan.get("clarifying_questions") or []) or plan.get("confirm_summary")
            raise RuntimeError(f"CALL-E would not plan this call: {questions}")

        run = self._structured(
            self._run_cli(["call", "run", "--plan-id", plan["plan_id"], "--confirm-token", plan["confirm_token"]])
        )
        run_id = run["run_id"]

        deadline = time.monotonic() + self.poll_timeout_seconds
        status = run
        while status.get("status") not in TERMINAL_STATUSES:
            if time.monotonic() > deadline:
                raise TimeoutError(f"Call run {run_id} did not reach a terminal status within {self.poll_timeout_seconds}s")
            time.sleep(self.poll_interval_seconds)
            status = self._structured(self._run_cli(["call", "status", "--run-id", run_id]))

        result = status.get("result") or {}
        calling_meta = ((result.get("extracted") or {}).get("calling")) or {}
        confidence = ((result.get("outcome") or {}).get("completion_confidence")) or {}

        return CallResult(
            transcript=result.get("transcript") or "",
            metadata=CallMetadata(
                number_dialed=phone_number,
                duration_seconds=calling_meta.get("duration_seconds", 0),
                timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            ),
            structured_result=None,  # see class docstring — extraction-by-goal-text doesn't work
            completion_confidence=confidence.get("score"),
        )

    @staticmethod
    def _run_cli(args: list[str]) -> dict:
        # subprocess.run(["calle", ...]) fails on Windows with FileNotFoundError:
        # npm installs global CLIs as calle.cmd, not a raw .exe, and CreateProcess
        # won't resolve that the way a shell does. shutil.which() finds it correctly
        # on every platform (checks PATHEXT on Windows), so resolve the real path first.
        calle_path = shutil.which("calle")
        if calle_path is None:
            raise RuntimeError(
                "The 'calle' CLI was not found on PATH. Install it with `npm install -g @call-e/cli` "
                "and run `calle auth login` before placing a live call."
            )
        proc = subprocess.run([calle_path, *args, "--json"], capture_output=True, text=True, check=True)
        return json.loads(proc.stdout)

    @staticmethod
    def _structured(response: dict) -> dict:
        return (response.get("result") or {}).get("structuredContent", response)


class MockCallEClient(CallEClient):
    """Returns a canned transcript with no structured_result — used for the
    sample scenarios in samples/ without a live CALL-E call or API key."""

    def __init__(self, canned_transcript: str, duration_seconds: int = 90):
        self._transcript = canned_transcript
        self._duration = duration_seconds

    def place_screening_call(self, phone_number: str, task: str, result_schema: dict | None = None) -> CallResult:
        return CallResult(
            transcript=self._transcript,
            metadata=CallMetadata(
                number_dialed=phone_number,
                duration_seconds=self._duration,
                timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            ),
        )
