import datetime
import json
import re
import shutil
import subprocess
import time
from dataclasses import dataclass

from .guardrails import mask_phone_number
from .models import CallMetadata

TERMINAL_STATUSES = {
    "COMPLETED", "FAILED", "NO_ANSWER", "DECLINED",
    "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED",
}

# One canned answer to CALL-E's planner clarifying question, used for exactly
# one automatic refinement round in place_screening_call. This is the same
# answer that got the very first real call (2026-08-09) from ready_to_run=false
# to true when supplied manually - not a general chat loop, just closing the
# one gap CALL-E's planner has repeatedly asked about: an explicit statement
# of purpose, restated in its own terms rather than assumed from the goal text.
PLAN_CLARIFICATION_RESPONSE = (
    "The safe purpose is to verify, transparently as an AI assistant, whether this phone number and the "
    "claim behind it are legitimate — by asking who is on the line, what company and department they "
    "represent, and whether the claim can be confirmed through the company's official published channels — "
    "without sharing, collecting, or acting on any password, verification code, payment detail, or financial "
    "account information at any point. Success is a completed conversation and an honest report of what was "
    "said; no other purpose is needed. Please proceed with planning on this basis."
)


class AmbiguousCallOutcome(RuntimeError):
    """Raised when a request that may have already dialed the phone (call
    run) times out client-side. We cannot tell whether CALL-E's backend
    placed the call or not, so this is never auto-retried — retrying would
    risk a real duplicate dial with no idempotency key to dedupe it (the
    calle CLI has no such flag, confirmed against its own --help). Surfaced
    to a human to check `calle call status` before deciding what to do."""


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

    Learned from real test calls, not assumed:
    - CALL-E's platform-level guardrails reject any goal asking the agent to
      impersonate the recipient or conceal that it's an AI. The task text
      must be transparent ("You are an AI assistant calling on behalf of...").
    - `--to-phone` and `--goal` are both required on every `call plan`
      invocation, even a continuation that only means to answer a
      clarifying question via `--plan-id`/`--user-input`.
    - A first plan_call is not guaranteed to come back `ready_to_run` even
      with a goal that already states its purpose — CALL-E's planner has
      asked for an explicit restatement of purpose more than once in
      practice. place_screening_call does exactly one automatic refinement
      round for this (see PLAN_CLARIFICATION_RESPONSE) before giving up.
    """

    def __init__(
        self,
        poll_interval_seconds: float = 3.0,
        poll_timeout_seconds: float = 300.0,
        request_timeout_seconds: float = 60.0,
        max_request_retries: int = 2,
    ):
        self.poll_interval_seconds = poll_interval_seconds
        self.poll_timeout_seconds = poll_timeout_seconds
        # The calle CLI's own default --timeout-seconds is 15 (see @call-e/core's
        # constants.js) — too short for plan_call, which does real backend work
        # (goal validation, possibly its own LLM call). Confirmed against a real
        # user hitting "MCP request timed out for tools/call" at the 15s default
        # twice in a row; 60s is a more realistic budget for a single request.
        self.request_timeout_seconds = request_timeout_seconds
        # Manual diagnosis (real number, real goal text, direct CLI invocation)
        # showed CALL-E's service healthy and the same request succeeding
        # outside our Python subprocess call, so this looks transient rather
        # than a config problem — retry a couple of times before giving up.
        self.max_request_retries = max_request_retries

    def place_screening_call(self, phone_number: str, task: str, result_schema: dict | None = None) -> CallResult:
        plan = self._structured(
            self._run_cli(["call", "plan", "--to-phone", phone_number, "--goal", task], mask=phone_number)
        )
        if not plan.get("ready_to_run"):
            # One automatic refinement round with a fixed, pre-written answer —
            # not a general chat loop. See PLAN_CLARIFICATION_RESPONSE.
            plan = self._structured(
                self._run_cli(
                    [
                        "call", "plan",
                        "--plan-id", plan["plan_id"],
                        "--to-phone", phone_number,  # required on every plan call, even continuations
                        "--goal", task,  # also required on every plan call — confirmed via a real "Missing required --goal"
                        "--user-input", PLAN_CLARIFICATION_RESPONSE,
                    ],
                    mask=phone_number,
                )
            )
        if not plan.get("ready_to_run"):
            questions = "; ".join(plan.get("clarifying_questions") or []) or plan.get("confirm_summary") or ""
            raise RuntimeError(mask_phone_number(questions, phone_number))

        # Not retryable: a timeout here means we don't know whether CALL-E's
        # backend actually placed the call before our client gave up waiting.
        # There is no idempotency key to make a safe retry (the calle CLI
        # has no such flag — checked its --help directly), so a blind retry
        # risks a real duplicate dial. Fail loudly instead of guessing.
        run = self._structured(
            self._run_cli(
                ["call", "run", "--plan-id", plan["plan_id"], "--confirm-token", plan["confirm_token"]],
                retryable=False,
                mask=phone_number,
            )
        )
        run_id = run["run_id"]

        deadline = time.monotonic() + self.poll_timeout_seconds
        status = run
        while status.get("status") not in TERMINAL_STATUSES:
            if time.monotonic() > deadline:
                # Same class of problem as the call-run timeout above: we do
                # not know whether the call is still ringing, finished after
                # we stopped watching, or something else entirely. Raising
                # the same AmbiguousCallOutcome (rather than a plain
                # TimeoutError, which screen.py's except clauses don't catch)
                # keeps this on the documented exit-53 path instead of
                # producing a raw traceback for a call that may still be live.
                raise AmbiguousCallOutcome(
                    f"Call run {run_id} did not reach a terminal status within {self.poll_timeout_seconds}s. "
                    "The call may still be in progress. Check `calle call status --run-id <id>` or the CALL-E "
                    "dashboard before trying again by hand."
                )
            time.sleep(self.poll_interval_seconds)
            status = self._structured(self._run_cli(["call", "status", "--run-id", run_id], mask=phone_number))

        result = status.get("result") or {}
        extracted = result.get("extracted") or {}
        calling_meta = extracted.get("calling") or {}
        outcome = result.get("outcome") or {}
        confidence = (outcome.get("completion_confidence")) or {}

        # CALL-E's own status is COMPLETED even when an answering machine
        # picked up, not a person — confirmed against a real call where
        # outcome.evidence included "The call was answered by an automatic
        # voicemail system." while status stayed COMPLETED. There is no
        # dedicated boolean field for this, so this reads CALL-E's own
        # plain-English evidence list rather than guessing from the
        # transcript, which risks false positives on a live caller who
        # merely mentions the word "voicemail".
        evidence = outcome.get("evidence") or []
        answered_by_machine = any(
            "voicemail" in e.lower() or "answering machine" in e.lower() for e in evidence if isinstance(e, str)
        )

        # Recipient binding only means something if we read back an
        # independent record of who was actually dialed, rather than just
        # re-stating the number we asked for — otherwise the check downstream
        # (run_pipeline's mismatch guard) compares a value against itself.
        # CALL-E's own skill reference documents this exact field for
        # rendering "Callee Number": result.extracted.to_phones[0], falling
        # back to result.extracted.calling.callee. Fall back to the
        # requested number only if CALL-E reports neither — this keeps
        # existing behavior for whatever fraction of responses omit it,
        # rather than fabricating a value that was never in CALL-E's output.
        to_phones = extracted.get("to_phones") or []
        reported_number = to_phones[0] if to_phones else calling_meta.get("callee")

        return CallResult(
            transcript=result.get("transcript") or "",
            metadata=CallMetadata(
                number_dialed=reported_number or phone_number,
                duration_seconds=calling_meta.get("duration_seconds") or 0,
                timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                status=status.get("status", "UNKNOWN"),
                call_id=run_id,
                answered_by_machine=answered_by_machine,
            ),
            structured_result=None,  # see class docstring — extraction-by-goal-text doesn't work
            completion_confidence=confidence.get("score"),
        )

    def _run_cli(self, args: list[str], retryable: bool = True, mask: str | None = None) -> dict:
        # mask is best-effort, applied only to what we constructed ourselves
        # (the joined args) and to CALL-E's own stderr/stdout — it catches
        # the common digit-sequence renderings the same way redact_phone_number
        # does, not a guarantee CALL-E's own error text never phrases the
        # number some other way.
        def _masked(s: str) -> str:
            if mask:
                s = mask_phone_number(s, mask)
            # --confirm-token authorizes actually placing this specific call
            # and --plan-id identifies it — both are live credential-like
            # values, not just PII. An ambiguous-timeout message is exactly
            # the kind of text someone pastes into a bug report, so these
            # need redacting here the same way the phone number is, not just
            # the number.
            # [\s=]+ rather than \s+: covers both "--confirm-token XYZ" (how
            # we invoke the CLI) and a "--confirm-token=XYZ" rendering CALL-E
            # itself might use when echoing the command back in its own
            # stderr/stdout, which this function also masks.
            s = re.sub(r"(--confirm-token)[\s=]+\S+", r"\1 [redacted]", s)
            s = re.sub(r"(--plan-id)[\s=]+\S+", r"\1 [redacted]", s)
            return s

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
        full_args = [calle_path, *args, "--timeout-seconds", str(self.request_timeout_seconds), "--json"]

        attempt = 0
        while True:
            attempt += 1
            # encoding/errors must be explicit: text=True alone decodes with
            # locale.getpreferredencoding(), which on Windows is often a legacy
            # codepage (e.g. cp1252) rather than UTF-8. CALL-E's JSON output can
            # contain real Unicode (curly quotes, em dashes, etc.), so the wrong
            # codec crashes the subprocess reader thread outright — confirmed
            # against a real UnicodeDecodeError on byte 0x9d (the tail byte of
            # U+201D "'" in UTF-8) from a real run.
            proc = subprocess.run(full_args, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if proc.returncode == 0:
                return json.loads(proc.stdout)

            transient = "timed out" in proc.stderr.lower() or "timed out" in proc.stdout.lower()

            if transient and not retryable:
                # This request may have side effects (it can place a real
                # call) and there's no idempotency key to make a retry safe,
                # so don't guess — surface it and let a human check
                # `calle call status` before deciding what to do next.
                raise AmbiguousCallOutcome(
                    f"calle {_masked(' '.join(args))} timed out waiting for a response — CALL-E's backend may "
                    "or may not have processed this request. Not retrying automatically, since this request "
                    "can have a real side effect and there is no idempotency key to make a retry safe. Check "
                    "`calle call status --run-id <id>` (if you have a run ID) or the CALL-E dashboard before "
                    "trying again by hand."
                )

            if transient and attempt <= self.max_request_retries:
                time.sleep(2 * attempt)  # short backoff: 2s, then 4s
                continue

            raise RuntimeError(
                f"calle {_masked(' '.join(args))} exited {proc.returncode} after {attempt} attempt(s).\n"
                f"stderr: {_masked(proc.stderr.strip())}\nstdout: {_masked(proc.stdout.strip())}"
            )

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
                status="COMPLETED",
                call_id=None,
            ),
        )
