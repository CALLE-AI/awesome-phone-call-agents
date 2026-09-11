from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from holdfor import db
from holdfor.app import create_app
from holdfor.models import CallRequest, CallState, SubmissionUnknown
from holdfor.providers import (
    CALLE_ENV,
    AuthUnavailable,
    FakeProvider,
    LiveProvider,
    default_provider,
)

WITHHOLDING = 6
CONSENTING = 1

TOKEN = "sk-live-not-a-real-token-9f3a1c"

AUTH_OK = {"usable": True}
STARTED = {"run_id": "run-7ac31f", "status_result": {"structuredContent": {}}}
FINISHED = {
    "result": {
        "structuredContent": {
            "status": "COMPLETED",
            "transcript": [
                {"index": 0, "speaker": "assistant", "text": "Hello, is that Margaret?"},
                {
                    "index": 1,
                    "speaker": "user",
                    "text": "I've been having trouble with the stairs, if I'm honest.",
                },
            ],
        }
    }
}


class Cli:
    """A calle CLI that answers from a script instead of dialling anyone.

    Records every argv it was handed, so a test can assert what was and was not
    passed to a real call.
    """

    def __init__(self, *replies, code: int = 0):
        self.replies = list(replies)
        self.code = code
        self.argvs: list[list[str]] = []

    def __call__(self, argv, timeout):
        self.argvs.append(list(argv))
        reply = self.replies.pop(0) if self.replies else {}
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, str):
            return self.code, reply
        return self.code, json.dumps(reply)

    @property
    def commands(self) -> list[str]:
        return [" ".join(argv[1:3]) for argv in self.argvs]


def live(*replies, **kwargs) -> LiveProvider:
    return LiveProvider(runner=Cli(*replies), sleep=lambda _: None, **kwargs)


def a_request(task_text: str = "Ask her how she has been.") -> CallRequest:
    return CallRequest(
        to_e164="+447700900001",
        task_text=task_text,
        result_schema={"type": "object"},
        idempotency_key="checkin:1",
    )


# The interface


def test_it_satisfies_the_same_interface_the_board_already_calls():
    provider = live(AUTH_OK, STARTED, FINISHED)
    run_id = provider.place(a_request())
    result = provider.poll(run_id)

    assert run_id == "run-7ac31f"
    assert result.state is CallState.TERMINAL_VERIFIED
    assert result.outcome == "COMPLETED"
    assert [turn.speaker for turn in result.transcript] == ["agent", "other"]


@pytest.mark.parametrize("status", ["COMPLETED", "DECLINED", "NO_ANSWER", "EXPIRED"])
def test_the_platforms_status_is_reported_verbatim_and_not_interpreted(status):
    """The mapping into a board status lives in `outcomes.py` alone (ADR 0006)."""
    provider = live(
        AUTH_OK, STARTED, {"result": {"structuredContent": {"status": status}}}
    )
    provider.place(a_request())
    assert provider.poll("run-7ac31f").outcome == status


def test_a_status_outside_the_documented_vocabulary_reaches_a_person():
    """We would rather wait out the poll than file a word we do not know."""
    unknown = {"result": {"structuredContent": {"status": "SOMETHING_ADDED_LATER"}}}
    provider = live(AUTH_OK, STARTED, unknown, attempts=1)
    provider.place(a_request())
    result = provider.poll("run-7ac31f")
    assert result.state is not CallState.TERMINAL_VERIFIED
    assert result.outcome is None


def test_a_status_read_that_fails_is_retried_rather_than_raising():
    """A failed read is a read to try again. It must never place a second call."""
    provider = live(
        AUTH_OK,
        STARTED,
        "not json at all",
        FINISHED,
        attempts=3,
    )
    provider.place(a_request())
    result = provider.poll("run-7ac31f")
    assert result.state is CallState.TERMINAL_VERIFIED
    assert result.outcome == "COMPLETED"


def test_a_connected_call_with_no_transcript_is_an_empty_transcript():
    """Observed on the first live call: status terminal, transcript null."""
    finished = {"result": {"structuredContent": {"status": "COMPLETED", "transcript": None}}}
    provider = live(AUTH_OK, STARTED, finished)
    provider.place(a_request())
    result = provider.poll("run-7ac31f")
    assert result.transcript == []
    assert result.outcome == "COMPLETED"


def test_an_unreadable_speaker_discards_the_transcript_rather_than_guessing():
    """Mis-attributing a turn could put a quote in her mouth she never said."""
    finished = {
        "result": {
            "structuredContent": {
                "status": "COMPLETED",
                "transcript": [
                    {"index": 0, "speaker": "agent", "text": "Hello."},
                    {"index": 1, "speaker": "participant_2", "text": "It's my chest."},
                ],
            }
        }
    }
    provider = live(AUTH_OK, STARTED, finished)
    provider.place(a_request())
    assert provider.poll("run-7ac31f").transcript == []


def test_no_structured_result_is_ever_invented():
    """`call start` has no way to transmit a result schema, so none comes back."""
    provider = live(AUTH_OK, STARTED, FINISHED)
    provider.place(a_request())
    assert provider.poll("run-7ac31f").structured is None


def test_a_call_still_ringing_when_we_stop_waiting_is_not_a_result():
    ringing = {"result": {"structuredContent": {"status": "IN_PROGRESS"}}}
    provider = live(AUTH_OK, STARTED, ringing, ringing, attempts=2)
    provider.place(a_request())
    result = provider.poll("run-7ac31f")
    assert result.state is CallState.ACCEPTED
    assert result.state is not CallState.TERMINAL_VERIFIED


# Ambiguity


@pytest.mark.parametrize(
    "reply",
    [
        subprocess.TimeoutExpired(cmd="calle", timeout=60),
        "not json at all",
        {"status_result": {}},  # valid JSON, no run id
    ],
)
def test_a_submission_we_cannot_account_for_raises_submission_unknown(reply):
    provider = live(AUTH_OK, reply)
    with pytest.raises(SubmissionUnknown):
        provider.place(a_request())


def test_a_missing_authorisation_is_a_confirmed_no_not_an_unknown():
    """Nothing was dialled, so there is nothing ambiguous to reconcile."""
    provider = live({"usable": False})
    with pytest.raises(AuthUnavailable):
        provider.place(a_request())

    provider = live({"error": "auth_required"})
    with pytest.raises(AuthUnavailable):
        provider.place(a_request())


# Credentials


def test_no_credential_is_read_until_a_call_is_actually_placed():
    """Preflight must be able to refuse before the token cache is touched."""
    cli = Cli(AUTH_OK, STARTED, FINISHED)
    provider = LiveProvider(runner=cli, sleep=lambda _: None)
    assert cli.argvs == [], "constructing the provider ran no command"

    provider.place(a_request())
    assert cli.commands[0] == "auth status"


def test_a_refused_call_never_reaches_the_cli(db_path, now):
    cli = Cli(AUTH_OK, STARTED, FINISHED)
    client = TestClient(
        create_app(
            db_path=db_path,
            provider=LiveProvider(runner=cli, sleep=lambda _: None),
            clock=lambda: now,
        )
    )
    assert client.post(f"/checkins/{WITHHOLDING}").status_code == 409
    assert cli.argvs == []


def test_authorisation_is_read_once_not_once_per_call():
    cli = Cli(AUTH_OK, STARTED, STARTED)
    provider = LiveProvider(runner=cli, sleep=lambda _: None)
    provider.place(a_request())
    provider.place(a_request())
    assert cli.commands == ["auth status", "call start", "call start"]


def test_nothing_secret_is_passed_on_the_command_line(monkeypatch):
    monkeypatch.setenv("CALLE_TOKEN", TOKEN)
    cli = Cli(AUTH_OK, STARTED, FINISHED)
    provider = LiveProvider(runner=cli, sleep=lambda _: None)
    provider.place(a_request())
    provider.poll("run-7ac31f")
    flat = " ".join(" ".join(argv) for argv in cli.argvs)
    assert TOKEN not in flat
    assert "--to-phone" in flat and "--goal" in flat


def test_the_attribution_environment_is_the_documented_one_and_holds_no_secret():
    assert CALLE_ENV == {
        "CALLE_SOURCE": "skills_sh",
        "CALLE_INTEGRATION": "skills_sh_skill",
        "CALLE_INTEGRATION_VERSION": "0.1.0",
    }


def test_no_provider_error_repeats_what_the_cli_said(monkeypatch):
    """CLI output is untrusted and a truncated error can carry a token."""
    leaky = json.dumps({"error": "boom", "detail": f"Authorization: Bearer {TOKEN}"})
    provider = live(AUTH_OK, leaky)
    with pytest.raises(SubmissionUnknown) as raised:
        provider.place(a_request())
    assert TOKEN not in str(raised.value)


def test_the_platforms_retry_offer_is_never_passed_or_read():
    """ADR 0006. The Check-in Call promises aloud that a hang-up ends the calls."""
    declined = {
        "result": {
            "structuredContent": {
                "status": "DECLINED",
                "repair_type": "no_answer",
                "next_step": {"action": "ask_user_for_retry_confirmation"},
            }
        }
    }
    cli = Cli(AUTH_OK, STARTED, declined)
    provider = LiveProvider(runner=cli, sleep=lambda _: None)
    provider.place(a_request())
    result = provider.poll("run-7ac31f")

    assert result.outcome == "DECLINED"
    flat = " ".join(" ".join(argv) for argv in cli.argvs)
    assert "retry" not in flat and "repair" not in flat


# The gate


def test_the_default_provider_is_fake_when_the_flag_is_absent(monkeypatch):
    monkeypatch.delenv("CALLE_LIVE", raising=False)
    assert isinstance(default_provider(), FakeProvider)


@pytest.mark.parametrize("value", ["", "0", "true", "yes", "TRUE", "2"])
def test_only_the_exact_flag_turns_live_on(monkeypatch, value):
    monkeypatch.setenv("CALLE_LIVE", value)
    assert isinstance(default_provider(), FakeProvider)


def test_the_explicit_flag_turns_live_on(monkeypatch):
    monkeypatch.setenv("CALLE_LIVE", "1")
    assert isinstance(default_provider(), LiveProvider)


def test_the_board_defaults_to_fake(monkeypatch):
    monkeypatch.delenv("CALLE_LIVE", raising=False)
    assert isinstance(create_app(db_path=":memory:").state.provider, FakeProvider)


# The budget


def test_a_live_placement_is_counted_and_a_fake_one_is_not(db_path, fixtures_dir, now):
    cli = Cli(AUTH_OK, STARTED, FINISHED)
    client = TestClient(
        create_app(
            db_path=db_path,
            provider=LiveProvider(runner=cli, sleep=lambda _: None),
            clock=lambda: now,
        )
    )
    client.post(f"/checkins/{CONSENTING}")
    assert client.get("/board").json()["live_calls"] == 1

    fake = TestClient(
        create_app(
            db_path=db_path,
            provider=FakeProvider(fixtures_dir=fixtures_dir),
            clock=lambda: now,
        )
    )
    fake.post("/checkins/2")
    assert fake.get("/board").json()["live_calls"] == 1, "the fake spent nothing"


def test_an_ambiguous_live_submission_still_spends_a_call(db_path, now):
    """It may have rung her. Twenty is the whole budget; over-count on purpose."""
    cli = Cli(AUTH_OK, "not json at all")
    client = TestClient(
        create_app(
            db_path=db_path,
            provider=LiveProvider(runner=cli, sleep=lambda _: None),
            clock=lambda: now,
        )
    )
    assert client.post(f"/checkins/{CONSENTING}").status_code == 409
    payload = client.get("/board").json()
    assert payload["live_calls"] == 1
    assert payload["awaiting_reconciliation"] == 1


def test_a_finished_call_is_not_awaiting_reconciliation(db_path, fixtures_dir, now):
    client = TestClient(
        create_app(
            db_path=db_path,
            provider=FakeProvider(fixtures_dir=fixtures_dir),
            clock=lambda: now,
        )
    )
    client.post(f"/checkins/{CONSENTING}")
    assert client.get("/board").json()["awaiting_reconciliation"] == 0


# Substitutability


def test_the_two_providers_are_interchangeable_below_the_interface(
    db_path, fixtures_dir, now
):
    """The board calls one function either way; nothing above the interface moves."""
    from holdfor import checkin

    conn = db.connect(db_path)
    try:
        fake = checkin.run(
            conn, FakeProvider(fixtures_dir=fixtures_dir), 2, now=now
        )
        real = checkin.run(
            conn,
            LiveProvider(runner=Cli(AUTH_OK, STARTED, FINISHED), sleep=lambda _: None),
            CONSENTING,
            now=now,
        )
        assert isinstance(fake, int) and isinstance(real, int)
        rows = conn.execute(
            "SELECT state FROM call_attempt ORDER BY id"
        ).fetchall()
        assert [row["state"] for row in rows] == [
            CallState.TERMINAL_VERIFIED,
            CallState.TERMINAL_VERIFIED,
        ]
    finally:
        conn.close()


def test_a_captured_live_call_is_written_in_the_shape_the_fake_reads(tmp_path):
    provider = LiveProvider(
        runner=Cli(AUTH_OK, STARTED, FINISHED),
        sleep=lambda _: None,
        capture_dir=tmp_path / "transcripts",
    )
    run_id = provider.place(a_request())
    provider.poll(run_id)

    (saved,) = list((tmp_path / "transcripts").glob("*.json"))
    payload = json.loads(saved.read_text(encoding="utf-8"))
    assert set(payload) == {"state", "turns", "structured", "outcome"}
    assert payload["outcome"] == "COMPLETED"
    assert payload["turns"][1]["speaker"] == "other"
    assert provider.transcript_path(run_id).endswith(saved.name)


# --- the transcript the platform actually returns ---------------------------------
#
# Two real live calls landed on the board saying "no transcript stored" after speaking
# for 52 and 121 seconds. Three separate reasons, and every one of them was ours: the
# transcript sits a level deeper than we looked, it is one string rather than a list of
# turns, and nothing had given the provider anywhere to write it. The shapes below are
# the platform's, with fictional words in them.

SPOKEN = (
    "[00:00:00] BOT: Hello, is that Margaret?\n"
    "[00:00:06] USER: yes, speaking.\n"
    "[00:00:11] BOT: Since Friday, are you feeling better, about the same, or worse?\n"
    "[00:00:14] USER: worse, if i'm honest. it's the mornings mostly.\n"
)


def finished(transcript, *, nested: bool = True) -> dict:
    """A `call status` reply, with the transcript where the platform puts it."""
    call = {"status": "COMPLETED"}
    if nested:
        call["result"] = {"transcript": transcript}
    else:
        call["transcript"] = transcript
    return {"result": {"structuredContent": call}}


def turns_from(reply: dict) -> list:
    provider = LiveProvider(
        runner=Cli(AUTH_OK, STARTED, reply), sleep=lambda _: None
    )
    return provider.poll(provider.place(a_request())).transcript


def test_the_transcript_is_read_from_under_the_nested_result():
    """The bug that cost two live calls. At the depth we read the status from, the
    transcript is simply absent, and absent read as "the call left no words"."""
    turns = turns_from(finished(SPOKEN))

    assert [turn.text for turn in turns][:2] == [
        "Hello, is that Margaret?",
        "yes, speaking.",
    ]


def test_one_string_of_timestamped_lines_becomes_turns():
    turns = turns_from(finished(SPOKEN))

    assert [turn.index for turn in turns] == [0, 1, 2, 3]
    assert [turn.speaker for turn in turns] == ["agent", "other", "agent", "other"]
    assert turns[3].text == "worse, if i'm honest. it's the mornings mostly."


def test_a_line_without_a_timestamp_continues_the_turn_above_it():
    """A sentence broken across two lines is one sentence. Starting a new turn at the
    break would let a quote be sliced out of half of what she said."""
    turns = turns_from(
        finished(
            "[00:00:14] USER: i can't get up the stairs the way i could\n"
            "a fortnight ago, and i'm having to stop halfway.\n"
        )
    )

    assert len(turns) == 1
    assert turns[0].text.endswith("having to stop halfway.")


def test_a_transcript_that_starts_mid_sentence_is_thrown_away():
    """There is nothing for the first line to continue, and inventing a speaker for it
    is the one mistake this module must not make."""
    assert turns_from(finished("she said she was alright\n[00:00:06] USER: yes.\n")) == []


def test_an_unknown_speaker_label_discards_the_whole_transcript():
    """Same rule as the list form: attributing the agent's sentence to the Patient
    could put a Carried Words quote in her mouth she never said."""
    assert turns_from(finished("[00:00:00] SUPERVISOR: are you recording this?\n")) == []


def test_the_list_form_is_still_read_where_it_used_to_be():
    """Every stored fixture and every captured call is in this shape. The new depth is
    checked second, not instead."""
    turns = turns_from(FINISHED)

    assert [turn.speaker for turn in turns] == ["agent", "other"]


def test_a_live_provider_is_given_somewhere_to_write_the_transcript(monkeypatch):
    """`LiveProvider()` took no capture directory, so `_capture` returned at its first
    line and every live call was unreadable afterwards however well it had gone."""
    monkeypatch.setenv("CALLE_LIVE", "1")
    monkeypatch.setenv("HOLDFOR_TRANSCRIPTS", "somewhere/else")

    provider = default_provider()

    assert provider.live is True
    assert provider._capture_dir == Path("somewhere/else")


def test_a_captured_transcript_keeps_its_whole_path(tmp_path):
    """`.name` alone lost the directory, so a capture written anywhere but beside the
    database could not be found again."""
    provider = LiveProvider(
        runner=Cli(AUTH_OK, STARTED, FINISHED),
        sleep=lambda _: None,
        capture_dir=tmp_path / "nested" / "transcripts",
    )
    run_id = provider.place(a_request())
    provider.poll(run_id)

    stored = Path(provider.transcript_path(run_id))
    assert stored.is_file()
    assert stored.parent.name == "transcripts"
