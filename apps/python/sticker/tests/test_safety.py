"""The refusals. Every test here asserts that something does NOT happen."""

from __future__ import annotations

import pytest

from sticker.call_design import RECIPIENT_SCHEMA, DrugRequest, build_task
from sticker.safety import (
    SafetyError,
    assert_approved_origin,
    authorize_destinations,
    is_fictional,
    mask,
    mask_deep,
    validate_e164,
)

FICTIONAL = "+12025550142"
SECOND = "+12025550188"


# -- phone numbers ---------------------------------------------------------------


@pytest.mark.parametrize("number", [FICTIONAL, "+14155550188", "+442079460123"])
def test_accepts_strict_ascii_e164(number: str) -> None:
    assert validate_e164(number) == number


@pytest.mark.parametrize(
    "number",
    [
        "2025550142",  # no plus
        "+02025550142",  # leading zero country code
        "+1 202 555 0142",  # spaces
        "+1-202-555-0142",  # hyphens
        "+1202555014",  # too short for NANP, still must be rejected on shape
        "",
        "+",
    ],
)
def test_rejects_malformed_numbers(number: str) -> None:
    with pytest.raises(SafetyError):
        validate_e164(number)


def test_rejects_non_ascii_digits() -> None:
    """Python's `\\d` matches these. A number built from them would dial something else.

    This is the single most repeated defect in this repository's review history, so it
    gets its own test rather than a parametrize row. The digits are written as escapes so
    the repository itself stays ASCII.
    """
    digits = FICTIONAL.lstrip("+")
    arabic_indic = "+" + "".join(chr(0x0660 + int(d)) for d in digits)
    fullwidth = "+" + "".join(chr(0xFF10 + int(d)) for d in digits)
    for number in (arabic_indic, fullwidth):
        assert not number.isascii()
        with pytest.raises(SafetyError):
            validate_e164(number)


def test_fixture_numbers_are_reserved_for_fiction() -> None:
    """Only NANP 555-0100 through 555-0199 count as fictional here.

    The negative case is Ofcom's drama range, which is reserved for fiction in the UK but
    is not the NANP block this check is about. Using it keeps every number in this
    repository a reserved one, so no scan of the history can ever surface a dialable line.
    """
    assert is_fictional(FICTIONAL)
    assert not is_fictional("+442079460123")


# -- masking ---------------------------------------------------------------------


def test_mask_keeps_only_the_last_four() -> None:
    masked = mask(FICTIONAL)
    assert masked.endswith("0142")
    assert "2025550142" not in masked
    assert masked.count("*") > 0


def test_mask_deep_reaches_into_nested_provider_payloads() -> None:
    payload = {
        "summary": f"Called {FICTIONAL} and got a price.",
        "recipients": [{"phones": [FICTIONAL], "attempts": [{"phone": FICTIONAL}]}],
    }
    cleaned = mask_deep(payload)
    assert FICTIONAL not in repr(cleaned)


def test_mask_handles_short_and_empty_input() -> None:
    assert mask("") == ""
    assert "1" not in mask("12")


# -- origin pinning --------------------------------------------------------------


def test_approves_the_real_api_host() -> None:
    assert assert_approved_origin("https://api.heycall-e.com") == "https://api.heycall-e.com"
    assert assert_approved_origin("https://api.heycall-e.com/") == "https://api.heycall-e.com"


@pytest.mark.parametrize(
    "url",
    [
        "http://api.heycall-e.com",  # not https
        "https://api.heycall-e.com.evil.example",  # the prefix-match attack
        "https://evil.example",
        "https://user:pass@api.heycall-e.com",  # credentials in the url
        "https://api.heycall-e.com:8443",  # alternate port
        "https://api.heycall-e.com/v1",  # not an origin
        "https://api.heycall-e.com?x=1",
        "https://127.0.0.1",
        "",
    ],
)
def test_refuses_every_other_origin(url: str) -> None:
    with pytest.raises(SafetyError):
        assert_approved_origin(url)


def test_lookalike_host_is_rejected_by_parsing_not_prefix() -> None:
    """`startswith` would accept this. Parsing is why it does not."""
    hostile = "https://api.heycall-e.com.attacker.example"
    assert hostile.startswith("https://api.heycall-e.com")
    with pytest.raises(SafetyError):
        assert_approved_origin(hostile)


# -- destination authorization ---------------------------------------------------


def test_empty_allowlist_authorizes_nothing() -> None:
    """Fail closed. An unset allowlist must not mean 'anything goes'."""
    for empty in (None, frozenset(), set()):
        with pytest.raises(SafetyError):
            authorize_destinations([FICTIONAL], empty)


def test_only_explicitly_listed_numbers_are_authorized() -> None:
    allowed = frozenset({FICTIONAL})
    assert authorize_destinations([FICTIONAL], allowed) == [FICTIONAL]
    with pytest.raises(SafetyError):
        authorize_destinations([FICTIONAL, SECOND], allowed)


def test_rejection_message_does_not_leak_the_number() -> None:
    with pytest.raises(SafetyError) as caught:
        authorize_destinations([SECOND], frozenset({FICTIONAL}))
    assert SECOND not in str(caught.value)


# -- what the agent is told ------------------------------------------------------


def _task() -> str:
    return build_task(
        DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30),
        caller_org="an independent price comparison",
    )


def test_the_call_discloses_that_it_is_an_ai_before_anything_else() -> None:
    """CALL-E does not announce itself and exposes no setting for it.

    The platform's terms put the duty on the caller, so the disclosure exists only in
    this prose. That makes this assertion the only enforcement point there is.
    """
    task = _task()
    assert "I'm an AI assistant" in task
    assert "Say you are an AI before you ask for anything" in task
    assert "recorded" in task
    # The disclosure is inside the same spoken sentence as the question, and it comes
    # first within it, so the pharmacist knows what they are talking to before they are
    # asked for anything.
    assert task.index("I'm an AI assistant") < task.index("What's your cash price")


def test_the_call_never_asks_for_personal_or_clinical_information() -> None:
    task = _task()
    assert "no patient and no prescription" in task
    assert "never invent one" in task
    assert "never describe symptoms" in task
    assert "start, stop, or change a medication" in task


def test_the_first_utterance_is_one_word_that_survives_a_collision() -> None:
    """The line opens before anyone has spoken, and the agent speaks into that gap.

    A pharmacy answers with its own name, a hold message or a menu, so whatever the agent
    says first lands on top of that greeting and is lost. The design gives up trying to
    stay silent and instead spends only a single word there, keeping the disclosure and
    the question for the moment a person is actually listening.
    """
    task = _task()
    assert 'YOUR FIRST WORD IS ONLY THIS: "Hello?"' in task
    assert "ONLY once a live person has finished speaking and the line is quiet" in task
    # Hearing them start is not the cue. An agent that opens its turn mid-greeting talks
    # across the person who answered, so the wait is written in terms of them finishing.
    assert "WAIT FOR THEM TO FINISH, NOT MERELY TO START" in task
    # The question must come after the wait, or the collision costs us the whole call.
    assert task.index('"Hello?"') < task.index("What's your cash price")


def test_the_call_repeats_itself_once_if_it_was_not_heard() -> None:
    """People miss the first seconds of a call, and a silent caller gets hung up on."""
    task = _task()
    assert "say that same sentence again, once" in task


def test_the_drug_is_said_the_way_a_person_says_it() -> None:
    """The federal price file spells the salt form. A pharmacist on the phone does not.

    Spoken aloud, "metformin hcl 500 mg" becomes "metformin H C L five hundred M G", which
    is several seconds of noise before the question even lands. The lookup key keeps the
    spelling CMS uses; only the sentence spoken down the line is changed.
    """
    drug = DrugRequest(name="metformin hcl", strength="500 mg", form="tablet", quantity=30)
    assert drug.spoken() == "metformin 500 milligram tablets"
    assert drug.nadac_prefix() == "METFORMIN HCL 500 MG"
    assert "hcl" not in build_task(drug, caller_org="a test").lower()


def test_the_call_does_not_hang_up_on_someone_who_is_still_looking() -> None:
    """Checking a price means walking to a terminal, and silence is not a refusal."""
    task = _task()
    assert "NEVER HANG UP ON A PERSON" in task
    assert "none of them is a person thinking" in task


def test_a_refusal_is_accepted_without_pushing() -> None:
    task = _task()
    assert "A refusal is a useful answer" in task
    assert "do not ask twice" in task


def test_the_call_stops_rather_than_holding_a_line_it_cannot_use() -> None:
    """An agent with no stop conditions will hold an open line to a machine.

    Nobody asked us to leave a pharmacy a message, and an automated system demanding a
    prescription number will never yield a shelf price however long we wait. Both waste a
    working pharmacy's line and both are billed, so the task names them as endings.
    """
    task = _task()
    assert "END THE CALL IMMEDIATELY" in task
    assert "do not leave a message" in task.lower()
    assert "do not call back" in task
    assert "requires a prescription number" in task
    assert "repeats a second time" in task


def test_schema_stays_inside_the_subset_calle_accepts() -> None:
    """`$ref`, `oneOf`, `anyOf`, `allOf` and union types come back result_schema_invalid."""
    text = repr(RECIPIENT_SCHEMA)
    for unsupported in ("$ref", "oneOf", "anyOf", "allOf"):
        assert unsupported not in text
    assert RECIPIENT_SCHEMA["additionalProperties"] is False
    for prop in RECIPIENT_SCHEMA["properties"].values():
        assert isinstance(prop["type"], str), "union types are rejected by the API"


def test_schema_avoids_names_the_platform_reserves() -> None:
    reserved = {"summary", "status", "transcript", "call_id"}
    assert not (set(RECIPIENT_SCHEMA["properties"]) & reserved)


def test_every_uncertain_field_can_answer_unknown() -> None:
    """A schema with no way to say 'I did not find out' invites a fabricated answer."""
    for name, prop in RECIPIENT_SCHEMA["properties"].items():
        if "enum" in prop:
            assert "unknown" in prop["enum"], f"{name} cannot report uncertainty"
