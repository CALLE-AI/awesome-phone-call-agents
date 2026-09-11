"""The four answers, read back out of the transcript.

`calle call start` cannot carry a result schema, so a live call arrives with a
conversation and no answers, and `extract` refuses it at its first line. Two real calls
landed on the board showing "not answered" three times over on transcripts where all
four questions had plainly been asked and answered.

The second pass closes that. What these tests are about is that it closes it without
becoming a way for this app to say something nobody said: the output goes through
`extract` unchanged, a fabricated quote is still caught, and every failure lands on the
board a Reviewer already has rather than on a guess.

Nothing here reaches the network. The transcript below is the shape of the live call
that prompted all of it, with fictional words in it.
"""

from __future__ import annotations

import json

import pytest

from holdfor import checkin, db, reextract
from holdfor.extract import EXTRACTION_FAILED, NOT_VERBATIM, extract
from holdfor.models import CallResult, CallState, Feeling, Turn, WantsSeen
from holdfor.providers import FakeProvider

CONSENTING = 1
CHANGED_MEDICATION = 2

WORRY = "i can't get up the stairs the way i could a fortnight ago"

SPOKEN = [
    Turn(index=0, speaker="agent", text="Hello, is that Alan?"),
    Turn(index=1, speaker="other", text="yeah, this is."),
    Turn(index=2, speaker="agent", text="are you feeling better, the same, or worse?"),
    Turn(index=3, speaker="other", text="worse, if i'm honest. it's the mornings."),
    Turn(index=4, speaker="agent", text="are you getting on alright with them?"),
    Turn(index=5, speaker="other", text="yeah, i guess."),
    Turn(index=6, speaker="agent", text="is there anything worrying you?"),
    Turn(index=7, speaker="other", text=f"{WORRY}, and i stop halfway."),
    Turn(index=8, speaker="agent", text="would you like the surgery to see you again?"),
    Turn(index=9, speaker="other", text="yes i would."),
]

ANSWERS = {
    "feeling": "worse",
    "medication_ok": "yes",
    "wants_seen": "yes",
    "carried_words_text": WORRY,
    "carried_words_turn": 7,
    "stop_condition": False,
    "stop_reason": None,
}


def live_call(transcript=None, structured=None) -> CallResult:
    """What a live call actually hands back: words, a status, and no answers."""
    return CallResult(
        state=CallState.TERMINAL_VERIFIED,
        transcript=SPOKEN if transcript is None else transcript,
        structured=structured,
        outcome="COMPLETED",
    )


class Block:
    def __init__(self, answers, kind: str = "tool_use"):
        self.type = kind
        self.input = answers


class Reply:
    def __init__(self, *blocks):
        self.content = list(blocks)


@pytest.fixture
def answered(monkeypatch):
    """An extractor that answers from a script instead of over the network.

    Patches `structured_from`, so everything above it is exercised for real and nothing
    below it is: the key, the client, the request. Tests that care about the request
    itself patch further down.
    """

    def answer(reply):
        monkeypatch.setattr(
            reextract, "structured_from", lambda transcript, changed: reply
        )

    return answer


# --- the gate ---------------------------------------------------------------------


def test_no_key_means_no_second_pass(monkeypatch):
    """The board behaves exactly as it did before this module existed."""
    monkeypatch.delenv(reextract.KEY, raising=False)

    assert reextract.available() is False
    assert reextract.structured_from(SPOKEN, True) is None


def test_a_key_is_enough_to_switch_it_on(monkeypatch):
    monkeypatch.setenv(reextract.KEY, "sk-ant-not-a-real-key")

    assert reextract.available() is True


def test_it_can_be_switched_off_with_the_key_still_in_place(monkeypatch):
    """A live demo may want the board to behave as it did, without unsetting a key
    that other things on the machine are using."""
    monkeypatch.setenv(reextract.KEY, "sk-ant-not-a-real-key")
    monkeypatch.setenv(reextract.ENABLED, "0")

    assert reextract.available() is False


def test_a_call_that_never_spoke_is_never_sent_anywhere(monkeypatch):
    """Nothing to extract from, and no reason to spend a request finding that out."""
    monkeypatch.setenv(reextract.KEY, "sk-ant-not-a-real-key")

    assert reextract.structured_from([], True) is None


# --- what is asked ----------------------------------------------------------------


def test_the_prompt_carries_the_turn_indexes():
    """`carried_words_turn` is checked against the turn it claims to come from, so the
    index has to travel with the words rather than be counted from the layout."""
    asked = reextract.prompt(SPOKEN, medication_changed=True)

    assert "turn 7 patient: " + WORRY in asked
    assert "turn 0 agent: Hello, is that Alan?" in asked


def test_the_prompt_says_which_answer_the_medication_question_may_have():
    """`not_asked` is not a gap. The question is never put when the appointment did
    not change anything, and an answer to it would be one nobody gave."""
    changed = reextract.prompt(SPOKEN, medication_changed=True)
    unchanged = reextract.prompt(SPOKEN, medication_changed=False)

    assert reextract.MEDICATION_NOT_ASKED in unchanged
    assert reextract.MEDICATION_ASKED in changed
    assert reextract.MEDICATION_ASKED not in unchanged


def test_the_tool_schema_is_the_published_one():
    """One shape, now three consumers. A schema restated here would drift from the one
    the skill documents and the drift would show up as a field the board cannot read."""
    published = checkin.result_schema()
    schema = reextract.tool_schema()

    assert schema["properties"] == published["properties"]
    assert schema["additionalProperties"] is False
    assert "allOf" not in schema


# --- what comes back --------------------------------------------------------------


def test_answers_read_from_the_transcript_reach_the_board(answered):
    answered(ANSWERS)

    result, source = reextract.fill(live_call(), medication_changed=True)
    extraction = extract(result, medication_changed=True)

    assert source == reextract.FROM_TRANSCRIPT
    assert extraction.feeling is Feeling.WORSE
    assert extraction.wants_seen is WantsSeen.YES
    assert extraction.carried_words_text == WORRY
    assert extraction.stop_reason is None


def test_the_agents_own_answers_are_left_alone(answered):
    """The agent heard them and this app did not. A block from the provider is not
    second-guessed, and no request is spent on one."""
    answered({"feeling": "better", "wants_seen": "no", "stop_condition": False})
    theirs = {
        "feeling": "same",
        "medication_ok": "yes",
        "wants_seen": "no",
        "stop_condition": False,
    }

    result, source = reextract.fill(live_call(structured=theirs), True)

    assert result.structured is theirs
    assert source == reextract.FROM_AGENT


def test_a_fabricated_quote_is_still_refused(answered):
    """The whole reason the second pass runs through `extract` rather than around it.

    A model in this app is trusted no further than the agent on the phone was, and
    `is_verbatim` does not care which of them wrote the string.
    """
    answered({**ANSWERS, "carried_words_text": "he said he was frightened"})

    result, _ = reextract.fill(live_call(), medication_changed=True)

    assert extract(result, medication_changed=True).stop_reason == NOT_VERBATIM


def test_a_quote_attributed_to_the_wrong_turn_is_still_refused(answered):
    answered({**ANSWERS, "carried_words_turn": 3})

    result, _ = reextract.fill(live_call(), medication_changed=True)

    assert extract(result, medication_changed=True).stop_reason == NOT_VERBATIM


def test_an_answer_outside_the_enum_is_still_refused(answered):
    """`_enum` will not coerce, so a bounded field can only ever hold one of its own
    values however confidently something proposed another."""
    answered({**ANSWERS, "feeling": "quite poorly"})

    result, _ = reextract.fill(live_call(), medication_changed=True)

    assert extract(result, medication_changed=True).stop_reason == EXTRACTION_FAILED


# --- when it does not work --------------------------------------------------------


def test_nothing_back_is_the_board_a_reviewer_already_has(answered):
    answered(None)

    result, source = reextract.fill(live_call(), medication_changed=True)

    assert result.structured is None
    assert source is None
    assert extract(result, medication_changed=True).stop_reason == EXTRACTION_FAILED


def test_an_error_of_any_kind_is_the_same_as_no_answer(monkeypatch):
    """One optional read on the way to a Review Item. There is no failure it could
    raise that is worth losing the call over, and the Item is written either way."""
    monkeypatch.setenv(reextract.KEY, "sk-ant-not-a-real-key")

    class Exploding:
        def __init__(self):
            raise RuntimeError("no network, no credit, no idea")

    # Skipped rather than failed when the extra is not installed: the library is
    # optional and a suite that demanded it would make it load-bearing.
    anthropic = pytest.importorskip("anthropic")
    monkeypatch.setattr(anthropic, "Anthropic", Exploding)

    assert reextract.structured_from(SPOKEN, True) is None


def test_a_reply_with_no_tool_call_in_it_is_no_answer():
    """It argued instead of answering. Not an outcome this app has to interpret."""
    assert reextract.answers_in(Reply(Block("I would rather not", kind="text"))) is None


def test_answers_that_arrive_as_a_string_are_still_read():
    """Belt and braces on the shape of a tool call. A JSON string is the same answer
    as a dict, and refusing to parse it would throw away a good call."""
    assert reextract.answers_in(Reply(Block(json.dumps(ANSWERS)))) == ANSWERS


def test_answers_that_arrive_as_broken_json_are_no_answer():
    assert reextract.answers_in(Reply(Block("{feeling: worse"))) is None


# --- end to end, through a real Review Item ---------------------------------------


def test_a_live_call_lands_with_answers_and_says_where_they_came_from(
    conn, fixtures_dir, now, monkeypatch
):
    """The board a Reviewer opens. Three chips instead of three "not answered", and a
    row that says the app read them rather than the call reporting them."""
    monkeypatch.setattr(
        reextract, "structured_from", lambda transcript, changed: ANSWERS
    )

    class Silent(FakeProvider):
        """A provider that connects and returns no answers, which is every live call."""

        def poll(self, run_id):
            settled = super().poll(run_id)
            from dataclasses import replace

            return replace(settled, structured=None, transcript=SPOKEN)

    item_id = checkin.run(
        conn, Silent(fixtures_dir=fixtures_dir), CHANGED_MEDICATION, now=now
    )
    row = conn.execute(
        "SELECT * FROM review_item WHERE id = ?", (item_id,)
    ).fetchone()

    assert row["feeling"] == Feeling.WORSE.value
    assert row["wants_seen"] == WantsSeen.YES.value
    assert row["carried_words_text"] == WORRY
    assert row["answers_from"] == reextract.FROM_TRANSCRIPT


def test_a_live_call_with_no_extractor_names_no_source(conn, fixtures_dir, now):
    """No key, so no second pass. Three empty fields, `extraction_failed`, and nothing
    claiming to be the source of answers that do not exist."""

    class Silent(FakeProvider):
        def poll(self, run_id):
            settled = super().poll(run_id)
            from dataclasses import replace

            return replace(settled, structured=None, transcript=SPOKEN)

    item_id = checkin.run(
        conn, Silent(fixtures_dir=fixtures_dir), CHANGED_MEDICATION, now=now
    )
    row = conn.execute(
        "SELECT * FROM review_item WHERE id = ?", (item_id,)
    ).fetchone()

    assert row["feeling"] is None
    assert row["stop_reason"] == EXTRACTION_FAILED
    assert row["answers_from"] is None


def test_a_fixture_call_still_says_the_agent_answered(conn, provider, now):
    """Every stored fixture returns its own structured block, which is the case the
    second pass must not touch."""
    item_id = checkin.run(conn, provider, CONSENTING, now=now)
    row = conn.execute(
        "SELECT answers_from FROM review_item WHERE id = ?", (item_id,)
    ).fetchone()

    assert row["answers_from"] == reextract.FROM_AGENT


def test_the_column_is_added_to_a_ledger_that_already_exists(tmp_path):
    """`init` runs on every start, over databases holding real calls. A new column has
    to be added by name, and adding it has to be safe to attempt twice."""
    path = str(tmp_path / "old.db")
    conn = db.connect(path)
    conn.executescript(
        """
        CREATE TABLE call_attempt (id INTEGER PRIMARY KEY);
        CREATE TABLE review_item (
            id              INTEGER PRIMARY KEY,
            call_attempt_id INTEGER NOT NULL REFERENCES call_attempt(id),
            feeling         TEXT,
            stop_condition  INTEGER NOT NULL,
            status          TEXT    NOT NULL,
            created_at      TEXT    NOT NULL
        );
        """
    )
    conn.commit()
    assert "answers_from" not in db.columns(conn, "review_item")

    db.init(conn)
    assert "answers_from" in db.columns(conn, "review_item")

    db.init(conn)
    assert "answers_from" in db.columns(conn, "review_item")
    conn.close()


# --- the other half: what reception offered ---------------------------------------
#
# The same hole, in the other half of the app. `rebooking.place` read `offers` off a
# structured block a live call never carries, so a real call where reception offered
# Saturday morning and the agent correctly refused it was recorded as `unreadable` with
# no offer rows at all, and the item went back to a person with nothing on it. The
# transcript below is the shape of that call, garbled turns included.

RECEPTION = [
    Turn(index=0, speaker="agent", text="Hi, is this the appointments line?"),
    Turn(index=1, speaker="other", text="hello phil, get surgery on my."),
    Turn(index=2, speaker="agent", text="Can you book her between the 25th and 27th?"),
    Turn(index=3, speaker="other", text="is there with you? and was the nurse a doctor?"),
    Turn(index=4, speaker="agent", text="I'm only able to pass on what she said."),
    Turn(index=5, speaker="other", text="i could do saturday morning."),
    Turn(index=6, speaker="agent", text="That won't work for us."),
]

OFFERED = {
    "offers": [{"turn": 5, "time": None, "accepted": False}],
    "reception_outcome": "slot_offered",
    "reception_outcome_turn": 5,
}


def test_offers_are_read_back_out_of_the_transcript(monkeypatch):
    monkeypatch.setattr(reextract, "ask", lambda *args: OFFERED)

    read = reextract.offers_from(RECEPTION)

    assert read["offers"][0]["turn"] == 5
    assert read["reception_outcome"] == "slot_offered"


def test_the_offers_prompt_says_which_end_of_the_line_each_turn_is(monkeypatch):
    """`patient` would not do here. The model has to tell an offer from the caller
    repeating itself, and both are turns in the same transcript."""
    asked = reextract.offers_prompt(RECEPTION)

    assert "turn 5 reception: i could do saturday morning." in asked
    assert "turn 0 caller: Hi, is this the appointments line?" in asked


def test_the_offers_schema_is_the_one_rebooking_declares():
    from holdfor.rebooking import RESULT_SCHEMA

    schema = reextract.offers_schema()

    assert schema["properties"] == RESULT_SCHEMA["properties"]
    assert schema["additionalProperties"] is False


def test_a_call_with_no_transcript_asks_nobody_about_it(monkeypatch):
    monkeypatch.setattr(
        reextract, "ask", lambda *args: pytest.fail("asked about an empty call")
    )

    assert reextract.offers_from([]) is None


def test_nothing_back_leaves_the_rebooking_call_exactly_as_it_was(monkeypatch):
    """Which is no offers, `unreadable`, and a person looking at the call."""
    monkeypatch.setattr(reextract, "ask", lambda *args: None)

    assert reextract.offers_from(RECEPTION) is None
