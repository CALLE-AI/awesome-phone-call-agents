from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

from .models import (
    CallRequest,
    CallResult,
    CallState,
    SubmissionUnknown,
    Turn,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "transcripts"


class FakeProvider:
    live = False

    def __init__(
        self,
        fixtures_dir: Path | None = None,
        route: dict[str, str] | None = None,
    ) -> None:
        self.fixtures_dir = fixtures_dir or FIXTURES
        self.route = route or {}
        self._runs: dict[str, str] = {}

    def place(self, req: CallRequest) -> str:
        run_id = "fake-" + hashlib.sha1(req.idempotency_key.encode()).hexdigest()[:12]
        self._runs[run_id] = self._fixture_for(req.idempotency_key)
        return run_id

    def poll(self, run_id: str) -> CallResult:
        name = self._runs.get(run_id)
        if name is None:
            return CallResult(
                state=CallState.SUBMISSION_UNKNOWN,
                transcript=[],
                structured=None,
                outcome=None,
            )
        payload = json.loads((self.fixtures_dir / name).read_text(encoding="utf-8"))
        return CallResult(
            state=CallState(payload["state"]),
            transcript=[Turn(**turn) for turn in payload["turns"]],
            structured=payload.get("structured"),
            outcome=payload.get("outcome"),
        )

    def transcript_path(self, run_id: str) -> str:
        return f"fixtures/transcripts/{self._runs[run_id]}"

    def _fixture_for(self, idempotency_key: str) -> str:
        if idempotency_key in self.route:
            return self.route[idempotency_key]
        names = self._names()
        suffix = idempotency_key.rsplit(":", 1)[-1]
        seed = (
            int(suffix)
            if suffix.isdigit()
            else int(hashlib.sha1(suffix.encode()).hexdigest(), 16)
        )
        return names[seed % len(names)]

    def _names(self) -> list[str]:
        names = sorted(p.name for p in self.fixtures_dir.glob("*.json"))
        if not names:
            raise FileNotFoundError(f"No transcript fixtures in {self.fixtures_dir}")
        return names


LIVE_FLAG = "CALLE_LIVE"

# A transcript pinned to an idempotency key, so a recording does not vary between
# takes. Absent by default: an unrouted run picks by key exactly as it always did.
ROUTE_FILE = "HOLDFOR_ROUTE"

# Named, never inferred. A country code is not a region and not a language, and the
# number that connects from one region does not connect from another. Every skill in
# this repository refuses to guess these from a phone number, and so does this.
REGION = "HOLDFOR_REGION"
LANGUAGE = "HOLDFOR_LANGUAGE"

# The attribution environment the calle skill requires on every invocation.
CALLE_ENV = {
    "CALLE_SOURCE": "skills_sh",
    "CALLE_INTEGRATION": "skills_sh_skill",
    "CALLE_INTEGRATION_VERSION": "0.1.0",
}

# Exactly the strings the CLI documents as terminal. Matched verbatim: a status we
# do not recognise leaves the call unfinished and reaches a person, which is the
# designed failure mode rather than a bug (ADR 0006).
TERMINAL_STATUSES = frozenset(
    {
        "COMPLETED",
        "FAILED",
        "NO_ANSWER",
        "DECLINED",
        "CANCELED",
        "CANCELLED",
        "VOICEMAIL",
        "BUSY",
        "EXPIRED",
    }
)

# Who said it, in the two words the rest of the app uses. A label outside this
# table throws the whole transcript away rather than guessing: attributing the
# agent's sentence to the Patient could put a Carried Words quote in her mouth
# that she never said, and that is the one mistake this app must not make.
SPEAKERS = {
    "agent": "agent",
    "assistant": "agent",
    "ai": "agent",
    "bot": "agent",
    "caller": "agent",
    "system": "agent",
    "other": "other",
    "user": "other",
    "human": "other",
    "callee": "other",
    "customer": "other",
    "patient": "other",
}

COMMAND_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 10
POLL_ATTEMPTS = 30  # five minutes, then a person looks


class AuthUnavailable(Exception):
    """CALL-E cannot be used from this machine, and nothing was dialled.

    Distinct from `SubmissionUnknown` on purpose. This is a confirmed negative:
    no call went out. Carries no CLI output, because a message from the CLI is
    untrusted and a truncated error can have a token in it.
    """


class _Ambiguous(Exception):
    """Internal. A command whose effect we cannot determine."""


def cli_runner(argv: list[str], timeout: float) -> tuple[int, str]:
    """Run one calle command and hand back its exit code and stdout.

    No credential passes through here. The CLI reads its own local token cache,
    which is why nothing in this module ever holds a secret that could be logged,
    printed, or written to the database.
    """
    completed = subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ, **CALLE_ENV},
        check=False,
    )
    return completed.returncode, completed.stdout


def speaker_of(item: dict) -> str | None:
    raw = item.get("speaker") or item.get("role")
    if not isinstance(raw, str):
        return None
    return SPEAKERS.get(raw.strip().lower())


def turns_of(content: dict) -> list[Turn]:
    """Build the transcript, or return none at all.

    A connected call can leave no transcript: the first live call on this project
    came back with `transcript` null and `duration_seconds` zero on a call where
    the agent audibly spoke. An empty list is the honest answer to that, and
    `extract.py` already treats it as a Stop Condition, so it reaches a Reviewer.

    Nothing here invents a turn, renumbers one, or guesses who was speaking. One
    unreadable entry discards the whole transcript rather than leaving a gap in
    the middle that a quote could be sliced across.
    """
    raw = content.get("transcript")
    if not isinstance(raw, list):
        return []

    turns = []
    for position, item in enumerate(raw):
        if not isinstance(item, dict):
            return []
        text = item.get("text")
        speaker = speaker_of(item)
        if not isinstance(text, str) or speaker is None:
            return []
        index = item.get("index")
        turns.append(
            Turn(
                index=index if isinstance(index, int) else position,
                speaker=speaker,
                text=text,
            )
        )
    return turns


class LiveProvider:
    """CALL-E behind the same two methods `FakeProvider` offers.

    Nothing above `CallProvider` changes when this is swapped in. `checkin.run`
    cannot tell which implementation it holds, and this class forms no opinion
    about what a status means: it reports the platform's own string in
    `CallResult.outcome` and `outcomes.py` alone decides what that is worth
    (ADR 0006).

    The platform's repair logic is deliberately unused. `call start` is never
    given a retry confirmation, and `repair_type` and
    `next_step.action` in a response are never read. The Check-in Call promises
    aloud that hanging up ends the calls for good, and the platform's answer to a
    hang-up is to offer to ring again in forty-five minutes.

    No structured result is returned, ever. `call start` accepts `--to-phone`,
    `--goal`, `--language` and `--region` and has no way to transmit a result
    schema, so a live call comes back as a transcript and a status. `extract.py`
    refuses an absent structured block, `recover_carried_words` recovers her quote
    from her own turn, and the call reaches a Reviewer. That is the correct
    outcome for a live call rather than a shortfall: nobody promised the platform
    would fill in our four fields.
    """

    live = True

    def __init__(
        self,
        runner=None,
        sleep=None,
        executable: str = "calle",
        interval: float = POLL_INTERVAL_SECONDS,
        attempts: int = POLL_ATTEMPTS,
        timeout: float = COMMAND_TIMEOUT_SECONDS,
        capture_dir: Path | None = None,
    ) -> None:
        self._run = runner or cli_runner
        self._sleep = sleep or time.sleep
        self._executable = executable
        self._interval = interval
        self._attempts = attempts
        self._timeout = timeout
        self._capture_dir = capture_dir
        self._authorised = False
        self._captured: dict[str, str] = {}

    def dial_options(self) -> list[str]:
        """Region and language, only when somebody named them."""
        options = []
        region = os.environ.get(REGION)
        if region:
            options += ["--region", region]
        language = os.environ.get(LANGUAGE)
        if language:
            options += ["--language", language]
        return options

    def place(self, req: CallRequest) -> str:
        self._authorise()
        try:
            payload = self._command(
                "call",
                "start",
                "--to-phone",
                req.to_e164,
                "--goal",
                req.task_text,
                *self.dial_options(),
            )
        except _Ambiguous as ambiguous:
            # The submission left us and we did not learn what became of it. Not
            # the same as learning that no call went out.
            raise SubmissionUnknown(str(ambiguous)) from None

        run_id = payload.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise SubmissionUnknown("call start returned no run id")
        return run_id

    def poll(self, run_id: str) -> CallResult:
        for remaining in range(self._attempts, 0, -1):
            try:
                content = self._status(run_id)
            except _Ambiguous:
                # A status read that failed is a read to try again, never a call to
                # place again: the run is already named and bound. Costs one poll
                # interval, and running out of them ends with a person looking.
                content = {}
            status = content.get("status")
            if isinstance(status, str) and status in TERMINAL_STATUSES:
                result = CallResult(
                    state=CallState.TERMINAL_VERIFIED,
                    transcript=turns_of(content),
                    structured=None,
                    outcome=status,
                )
                self._capture(run_id, result)
                return result
            if remaining > 1:
                self._sleep(self._interval)

        # Still going when we ran out of patience. The run exists and is named, so
        # this is neither a result nor a submission we failed to make. `checkin.run`
        # files anything short of a verified terminal read as needing a person.
        return CallResult(
            state=CallState.ACCEPTED, transcript=[], structured=None, outcome=None
        )

    def transcript_path(self, run_id: str) -> str | None:
        return self._captured.get(run_id)

    def _authorise(self) -> None:
        """Read auth on the first placement, never at construction.

        Preflight has to be able to refuse a call before any credential is read,
        and it could not if building the provider already touched the token cache.
        The board holds one instance for its lifetime, so this runs once.

        An auth check we cannot complete is treated as a confirmed no: we have not
        dialled anything, so there is nothing ambiguous to reconcile.
        """
        if self._authorised:
            return
        try:
            payload = self._command("auth", "status")
        except _Ambiguous:
            raise AuthUnavailable("the calle CLI did not report its auth status")
        if payload.get("usable") is not True:
            raise AuthUnavailable("CALL-E is not authorised on this machine")
        self._authorised = True

    def _status(self, run_id: str) -> dict:
        payload = self._command("call", "status", "--run-id", run_id)
        result = payload.get("result")
        if not isinstance(result, dict):
            return {}
        structured = result.get("structuredContent")
        return structured if isinstance(structured, dict) else result

    def _command(self, *args: str) -> dict:
        """Run one command and return its JSON object.

        `_Ambiguous` is raised whenever the command's effect cannot be determined:
        a timeout, output that will not parse, a non-zero exit with nothing
        readable behind it. Anything the CLI says plainly about authorisation is a
        confirmed failure instead, because a submission refused outright placed no
        call and must not be recorded as one that might have.

        Every message raised from here is our own sentence. CLI output is untrusted
        and can carry a token, so none of it travels into an exception, a log line,
        or the database.
        """
        argv = [self._executable, *args]
        try:
            code, stdout = self._run(argv, self._timeout)
        except subprocess.TimeoutExpired:
            raise _Ambiguous("the calle CLI did not answer in time") from None
        except FileNotFoundError:
            raise AuthUnavailable("the calle CLI is not installed") from None

        try:
            payload = json.loads(stdout)
        except (TypeError, ValueError):
            raise _Ambiguous("the calle CLI returned output that was not JSON") from None

        if not isinstance(payload, dict):
            raise _Ambiguous("the calle CLI returned JSON that was not an object")
        if "auth_required" in {payload.get("error"), payload.get("code")}:
            raise AuthUnavailable("CALL-E authorisation is required")
        if code != 0:
            raise _Ambiguous(f"the calle CLI exited with status {code}")
        return payload

    def _capture(self, run_id: str, result: CallResult) -> None:
        """Save a real call in the shape `FakeProvider` reads, when asked to.

        Written in the fixture shape rather than as raw CLI output, so a captured
        call carries a transcript, a status and nothing else. The platform's
        summaries, timings and identifiers are dropped on the floor.
        """
        if self._capture_dir is None:
            return
        self._capture_dir.mkdir(parents=True, exist_ok=True)
        name = f"live-{run_id}.json"
        (self._capture_dir / name).write_text(
            json.dumps(
                {
                    "state": result.state.value,
                    "turns": [
                        {"index": t.index, "speaker": t.speaker, "text": t.text}
                        for t in result.transcript
                    ],
                    "structured": result.structured,
                    "outcome": result.outcome,
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        self._captured[run_id] = f"{self._capture_dir.name}/{name}"


def route_from_env() -> dict[str, str]:
    """The pinned transcripts, or none at all.

    A malformed route raises rather than falling back to picking by key: a recording
    that silently ignored its own route would show the wrong patient's transcript,
    which is the thing the route exists to prevent.
    """
    path = os.environ.get(ROUTE_FILE)
    if not path:
        return {}
    loaded = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(loaded, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in loaded.items()
    ):
        raise ValueError(f"{ROUTE_FILE}: expected an object of key to filename")
    return loaded


def default_provider():
    """`FakeProvider` unless live is switched on explicitly, by name, as `1`.

    One place in the codebase where a real phone call becomes possible. The flag
    is absent by default, so every test and every default run is fake.
    """
    if os.environ.get(LIVE_FLAG) == "1":
        return LiveProvider()
    return FakeProvider(route=route_from_env())
