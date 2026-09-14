"""End-to-end API tests. Fixture mode throughout: no key, no network, no calls."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.caller import ConfigurationError  # noqa: E402
from app.main import DEV_TOKEN, create_app  # noqa: E402

AUTH = {"Authorization": f"Bearer {DEV_TOKEN}"}
RESERVED = "+15550100142"

THREAD = {
    "thread_id": "thread-1",
    "subject": "Kickoff — Monday or Tuesday?",
    "messages": [
        {"sender": "Charles Miller", "from_me": True,
         "body": "Does Monday or Tuesday work for the kickoff? Stephen can only join Tuesday."},
        {"sender": "Alex Doe", "from_me": False,
         "body": f"Yeah, I'll be there.\n\n--\nAlex Doe\nOperations\n{RESERVED}"},
    ],
}


def client(fixture: str = "resolved") -> TestClient:
    return TestClient(create_app({
        "CONVERSATION_CLARIFY_MODE": "fixture",
        "CONVERSATION_CLARIFY_FIXTURE": fixture,
        "CONVERSATION_CLARIFY_USER": "Charles Miller",
    }))


def analyze(c: TestClient) -> dict:
    response = c.post("/v1/analyze", json=THREAD, headers=AUTH)
    assert response.status_code == 200
    return response.json()


def propose(c: TestClient, **overrides) -> dict:
    body = {"thread": THREAD, "finding_index": 0, "recipient_name": "Alex Doe"}
    body.update(overrides)
    response = c.post("/v1/proposals", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


# --- defaults and auth -------------------------------------------------------

def test_default_mode_cannot_dial():
    assert client().get("/health").json() == {
        "app": "conversation-clarify", "mode": "fixture", "dials_real_phones": False,
        "model_pass": "off",
    }


def test_endpoints_require_the_token():
    c = client()
    assert c.post("/v1/analyze", json=THREAD).status_code == 401
    assert c.post("/v1/analyze", json=THREAD,
                  headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_live_mode_refuses_to_start_without_a_secret():
    with pytest.raises(ConfigurationError, match="unauthenticated live caller"):
        create_app({"CONVERSATION_CLARIFY_MODE": "live", "CALLE_API_KEY": "x"})


def test_live_mode_refuses_an_unofficial_origin():
    with pytest.raises(ConfigurationError, match="only permitted origin"):
        create_app({
            "CONVERSATION_CLARIFY_MODE": "live",
            "CONVERSATION_CLARIFY_TOKEN": "s3cret",
            "CALLE_API_KEY": "x",
            "CALLE_BASE_URL": "http://127.0.0.1:8080",
        })


# --- analyze -----------------------------------------------------------------

def test_analyze_finds_the_ambiguity_and_the_number():
    data = analyze(client())
    assert data["findings"][0]["kind"] == "unclear_choice"
    assert data["findings"][0]["options"] == ["Monday", "Tuesday"]
    assert data["counterparty"] == "Alex Doe"
    assert data["phone_candidates"][0]["dialable"] is True


def test_analyze_never_returns_a_full_number():
    body = client().post("/v1/analyze", json=THREAD, headers=AUTH).text
    assert RESERVED not in body


# --- propose -----------------------------------------------------------------

def test_proposal_masks_the_destination_and_issues_a_token():
    c = client()
    token = analyze(c)["phone_candidates"][0]["masked"]   # the token as the client sees it
    data = propose(c, phone_token=token)
    assert RESERVED not in str(data)
    assert data["confirm_token"]
    assert data["will_dial_a_real_phone"] is False
    assert "AI assistant" in data["task_preview"]


def test_proposal_rejects_a_number_not_in_the_thread():
    c = client()
    response = c.post("/v1/proposals", json={
        "thread": THREAD, "finding_index": 0, "phone_token": "+99*******99",
    }, headers=AUTH)
    assert response.status_code == 400
    assert "not one of the dialable numbers" in response.json()["detail"]


def test_proposal_rejects_a_typed_number_without_a_country_code():
    c = client()
    response = c.post("/v1/proposals", json={
        "thread": THREAD, "finding_index": 0, "phone_typed": "5550100142",
    }, headers=AUTH)
    assert response.status_code == 400


def test_proposal_requires_some_destination():
    c = client()
    response = c.post("/v1/proposals", json={"thread": THREAD, "finding_index": 0}, headers=AUTH)
    assert response.status_code == 400


def test_idempotency_key_is_stable_for_the_same_question():
    c = client()
    assert propose(c, phone_typed=RESERVED)["idempotency_key"] == \
           propose(c, phone_typed=RESERVED)["idempotency_key"]


# --- confirmation gate -------------------------------------------------------

def test_the_dial_endpoint_cannot_be_driven_blind():
    """The token is handed out only with the proposal, so a caller must first
    fetch what the call would be before it can be placed."""
    c = client()
    proposal = propose(c, phone_typed=RESERVED)
    assert len(proposal["confirm_token"]) >= 16
    bad = c.post(f"/v1/proposals/{proposal['proposal_id']}/call",
                 json={"confirm": "yes"}, headers=AUTH)
    assert bad.status_code == 400
    assert "does not match" in bad.json()["detail"]


def test_a_token_from_one_proposal_does_not_work_on_another():
    c = client()
    first = propose(c, phone_typed=RESERVED)
    second = propose(c, phone_typed="+15550100199")
    assert first["confirm_token"] != second["confirm_token"]
    response = c.post(f"/v1/proposals/{second['proposal_id']}/call",
                      json={"confirm": first["confirm_token"]}, headers=AUTH)
    assert response.status_code == 400


def test_the_same_proposal_cannot_be_dialled_twice():
    c = client()
    proposal = propose(c, phone_typed=RESERVED)
    phrase = {"confirm": proposal["confirm_token"]}
    first = c.post(f"/v1/proposals/{proposal['proposal_id']}/call", json=phrase, headers=AUTH)
    assert first.status_code == 200
    second = c.post(f"/v1/proposals/{proposal['proposal_id']}/call", json=phrase, headers=AUTH)
    assert second.status_code == 409


# --- outcomes ----------------------------------------------------------------

def run_to_result(fixture: str) -> dict:
    c = client(fixture)
    proposal = propose(c, phone_typed=RESERVED)
    c.post(f"/v1/proposals/{proposal['proposal_id']}/call",
           json={"confirm": proposal["confirm_token"]}, headers=AUTH)
    response = c.get(f"/v1/proposals/{proposal['proposal_id']}", headers=AUTH)
    assert response.status_code == 200
    return response.json()


def test_resolved_call_produces_a_draft_quoting_the_recipient():
    data = run_to_result("resolved")
    assert data["state"] == "resolved"
    assert data["verdict"]["passed"] is True
    assert data["verdict"]["answer"] == "Tuesday"
    assert data["draft"]["drafted"] is True
    assert "Tuesday" in data["draft"]["body"]
    # The quote is evidence for the user, shown in the panel -- not something to
    # mail back to the person who said it, especially as it inherits ASR quality.
    assert data["verdict"]["quote"] == "I meant Tuesday."
    assert "I meant Tuesday" not in data["draft"]["body"]
    assert "what you said was" not in data["draft"]["body"]


def test_voicemail_drafts_nothing():
    data = run_to_result("voicemail")
    assert data["state"] == "unresolved"
    assert data["draft"]["drafted"] is False
    assert any("person did not answer" in r for r in data["verdict"]["reasons"])


def test_no_answer_drafts_nothing():
    data = run_to_result("no_answer")
    assert data["state"] == "unresolved"
    assert data["draft"]["drafted"] is False
    assert any("did not complete" in r for r in data["verdict"]["reasons"])


def test_human_who_did_not_settle_it_drafts_nothing():
    data = run_to_result("unresolved")
    assert data["state"] == "unresolved"
    assert data["draft"]["drafted"] is False
    assert any("not settled" in r for r in data["verdict"]["reasons"])


def test_an_answer_that_was_never_offered_is_refused():
    data = run_to_result("off_menu")
    assert data["state"] == "unresolved"
    assert any("not one of the options" in r for r in data["verdict"]["reasons"])


def test_transcript_is_returned_and_masked():
    data = run_to_result("resolved")
    assert data["transcript"][0]["speaker"] == "bot"
    assert RESERVED not in str(data)


def test_result_payload_never_leaks_the_destination():
    for fixture in ("resolved", "voicemail", "no_answer", "unresolved", "off_menu"):
        assert RESERVED not in str(run_to_result(fixture)), fixture


# --- retry safety ------------------------------------------------------------

def test_retry_after_a_failed_call_gets_a_new_idempotency_key():
    """A call that never connected must be retryable.

    CALL-E returns the ORIGINAL call for a reused idempotency key, so a genuine
    retry needs a new one -- but only after the previous attempt is finished.
    """
    c = client("no_answer")
    first = propose(c, phone_typed=RESERVED)
    c.post(f"/v1/proposals/{first['proposal_id']}/call",
           json={"confirm": first["confirm_token"]}, headers=AUTH)
    assert c.get(f"/v1/proposals/{first['proposal_id']}", headers=AUTH).json()["state"] == "unresolved"

    second = propose(c, phone_typed=RESERVED)
    assert second["attempt"] == 2
    assert second["idempotency_key"] != first["idempotency_key"]


def test_a_second_proposal_while_one_is_in_flight_reuses_the_key():
    """Two tabs, same question: the key must not move, or the person is dialled twice."""
    c = client()
    first = propose(c, phone_typed=RESERVED)
    second = propose(c, phone_typed=RESERVED)
    assert second["attempt"] == 1
    assert second["idempotency_key"] == first["idempotency_key"]


# --- task text coherence -----------------------------------------------------

def test_identity_check_is_dropped_when_recipient_matches_the_caller():
    """"end the call if this is not Charles Miller", spoken on Charles Miller's behalf, is a
    contradiction that would hang up on exactly the right person."""
    c = client()
    data = propose(c, phone_typed=RESERVED, recipient_name="Charles Miller", caller_name="Charles Miller")
    task = data["task_preview"]
    assert "someone who is not" not in task
    assert "Ask whether you are speaking to" not in task   # no identity step either
    assert "voicemail, an automated system end the call politely" in task


def test_identity_check_is_present_for_a_real_counterparty():
    c = client()
    task = propose(c, phone_typed=RESERVED, recipient_name="Alex Doe",
                   caller_name="Charles Miller")["task_preview"]
    assert "someone who is not Alex Doe" in task
    assert "ask whether you are speaking to Alex Doe" in task


def test_the_read_back_is_a_numbered_step_that_cannot_be_skipped():
    """Observed live: given prose, the caller dropped the read-back entirely.

    It is the recipient's only chance to correct a mishearing before it is
    written into their thread.
    """
    task = propose(client(), phone_typed=RESERVED, recipient_name="Alex Doe")["task_preview"]
    assert "Repeat their answer back" in task
    assert "Do not skip this step" in task
    assert "do not end the call before they have confirmed" in task


def test_details_are_withheld_until_the_right_person_confirms():
    """CALL-E always discloses in its opening turn, so the opening must not
    carry the subject line: a stranger who picks up should learn only that an
    assistant called, not what about."""
    task = propose(client(), phone_typed=RESERVED, recipient_name="Alex Doe",
                   caller_name="Charles Miller")["task_preview"]
    opening = task[:task.index("Step 2")]
    assert "ask whether you are speaking to Alex Doe" in opening
    assert "Do not mention the subject" in opening
    assert "Kickoff" not in opening          # the subject stays out of the opening
    assert "Once Alex Doe has confirmed" in task

    order = [task.index(marker) for marker in (
        "ask whether you are speaking to",
        "Once Alex Doe has confirmed",
        "Ask exactly this and nothing more",
        "Repeat their answer back",
        "Thank them and end the call",
    )]
    assert order == sorted(order), "task steps are out of order"


def test_changing_the_call_changes_the_key():
    """A different request is a different operation.

    Reusing a key with a changed body is refused by CALL-E as
    idempotency_conflict -- observed after a restart reset the attempt counter
    while the task text had changed underneath it.
    """
    c = client()   # one app: the run nonce is constant, so the digest is what differs
    a = propose(c, phone_typed=RESERVED, recipient_name="Alex Doe",
                caller_name="Charles Miller")["idempotency_key"]
    b = propose(c, phone_typed=RESERVED, recipient_name="Sam Patel",
                caller_name="Charles Miller")["idempotency_key"]
    assert a != b, "task text differs, so the key must differ"


def test_an_identical_request_keeps_the_same_key():
    c = client()
    first = propose(c, phone_typed=RESERVED, recipient_name="Alex Doe")["idempotency_key"]
    second = propose(c, phone_typed=RESERVED, recipient_name="Alex Doe")["idempotency_key"]
    assert first == second, "same operation, so a double-click must not dial twice"


# --- the finding must survive the trip to /v1/proposals -----------------------
#
# /v1/analyze can merge rule findings with model findings. /v1/proposals has no
# model pass. Selecting by position therefore meant the same index named a
# different question on the second call -- or no question at all -- so a model
# finding could never be called, and a mixed list dialled the wrong one.

CHOICE_ASK = "Either the short deck or the full deck would suit us, whichever you prefer."
MIXED_THREAD = {
    "thread_id": "thread-2",
    "subject": "Board pack",
    "messages": [
        {"sender": "Charles Miller", "from_me": True,
         "body": "Can you send the signed copy before the board meeting?"},
        {"sender": "Alex Doe", "from_me": False, "body": f"Will do.\n\n--\nAlex Doe\n{RESERVED}"},
        {"sender": "Charles Miller", "from_me": True, "body": CHOICE_ASK},
        {"sender": "Alex Doe", "from_me": False, "body": "Perfect, that suits us."},
    ],
}

MODEL_FINDING = {
    "kind": "unclear_choice",
    "asked_index": 2,
    "replied_index": 3,
    "question": CHOICE_ASK,
    "reply": "Perfect, that suits us.",
    "options": ["the short deck", "the full deck"],
    "call_question": "Which did you mean, the short deck or the full deck?",
    "source": "model",
    "confidence": "medium",
}


def propose_finding(c: TestClient, finding: dict, **overrides):
    body = {"thread": MIXED_THREAD, "finding": finding,
            "recipient_name": "Alex Doe", "phone_typed": RESERVED}
    body.update(overrides)
    return c.post("/v1/proposals", json=body, headers=AUTH)


def test_a_model_finding_can_actually_be_called():
    """The regression. The rules see only the earlier reply; the model's finding
    is about the later one, and it must be the one the call asks about."""
    response = propose_finding(client(), MODEL_FINDING)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["finding"]["replied_index"] == 3
    assert data["finding"]["source"] == "model"
    assert "the short deck or the full deck" in data["task_preview"]
    assert "What date should we expect it by" not in data["task_preview"]


def test_an_invented_finding_is_refused():
    bad = {**MODEL_FINDING, "reply": "Tuesday is perfect for us."}   # never said
    assert propose_finding(client(), bad).status_code == 400


def test_a_paraphrased_question_is_refused():
    bad = {**MODEL_FINDING, "question": "Would the short deck or the full deck suit you?"}
    assert propose_finding(client(), bad).status_code == 400


def test_a_finding_that_swaps_the_speakers_is_refused():
    """The ask must be ours and the non-answer theirs. A misread of who said
    what proposes a call to the wrong person about the wrong sentence."""
    bad = {**MODEL_FINDING, "asked_index": 3, "replied_index": 2}
    assert propose_finding(client(), bad).status_code == 400


def test_options_that_are_not_in_the_question_are_refused():
    """The options become the menu the gate measures the answer against, so they
    have to be the ones actually offered."""
    bad = {**MODEL_FINDING, "options": ["the short deck", "a video walkthrough"]}
    assert propose_finding(client(), bad).status_code == 400


def test_a_rules_finding_round_trips_through_verification():
    """Whatever /analyze hands out must be acceptable back at /v1/proposals."""
    c = client()
    for finding in analyze(c)["findings"]:
        response = c.post("/v1/proposals", json={
            "thread": THREAD, "finding": finding,
            "recipient_name": "Alex Doe", "phone_typed": RESERVED,
        }, headers=AUTH)
        assert response.status_code == 200, response.text
        assert response.json()["finding"]["call_question"] == finding["call_question"]


def test_the_legacy_index_path_still_works():
    """The curl walkthrough and the live-flow harness both select by index."""
    assert propose(client(), phone_typed=RESERVED)["finding"]["kind"] == "unclear_choice"


# --- provider text is masked wherever it leaves the server -------------------

def test_the_answer_is_masked_like_the_quote():
    """A vague_commitment has no menu to check the answer against, so
    `committed_date` is free provider text that lands in a draft. Both fields
    are masked; a real date is untouched because only phone-shaped runs are."""
    from app.gate import evaluate

    call = {
        "status": "completed", "task_completed": True,
        "structured_result": {
            "resolved": "yes", "answered_by": "human",
            "committed_date": "Thursday, or call +1 555 010 0142",
            "evidence_quote": "I will send it Thursday.",
        },
    }
    verdict = evaluate(call, answer_field="committed_date", expected_options=None)
    assert verdict.passed
    assert "0142" not in verdict.answer
    assert "Thursday" in verdict.answer          # a real date survives masking
