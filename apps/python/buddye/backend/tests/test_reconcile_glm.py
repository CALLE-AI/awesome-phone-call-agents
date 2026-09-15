"""The understanding layer.

Two things are being tested here and they are not the same thing. The fake-client tests prove the
plumbing: json mode, the one retry that is allowed, the fields that may be patched, the quotes that
may not. The prompt tests prove the judgment, because the judgment lives in the SYSTEM text and
nothing offline can exercise it — asserting that the rule about under-reporting is actually in the
prompt is the honest test, and it is the rule this product turns on.
"""
from __future__ import annotations

from typing import Any

import pytest

from app.orchestrator.reconcile import failing_fields_for, merge_reconciled, quote_is_grounded
from app.orchestrator.reconcile_glm import GlmReconciler, extract_json_object, unwrap

# A cut-down welfare contract: enough shape (a nested check, a tri-state, a quote, help lists) to
# exercise the machinery without pinning this file to every field compile_contract emits.
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["is_safe_now", "needs_help_now", "checks", "help_accepted", "help_declined", "alarming_quote"],
    "properties": {
        "reached_intended_person": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "is_safe_now": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "needs_help_now": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "sounded_distressed": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "alarming_quote": {"type": "string"},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "help_accepted": {"type": "array", "items": {"type": "string"}},
        "help_declined": {"type": "array", "items": {"type": "string"}},
        "checks": {
            "type": "object", "additionalProperties": False, "required": ["too_hot", "has_water"],
            "properties": {
                "too_hot": {"type": "string", "enum": ["yes", "no", "unknown"]},
                "has_water": {"type": "string", "enum": ["yes", "no", "unknown"]},
                "equipment_working": {"type": "string", "enum": ["yes", "no", "unknown"]},
            },
        },
    },
}

TRANSCRIPT = [
    {"speaker": "bot", "text": "There's a cooling centre open at the Maryvale library until 8pm. Would you like a ride there?"},
    {"speaker": "user", "text": "Oh no, I don't want to be any trouble. I've got water."},
]

# The call this whole layer exists for: she says she is fine, and then says the thing that matters.
UNDER_REPORTING = [
    {"speaker": "bot", "text": "Hello Rosa, this is an automated call from the neighbourhood check-in. How are you doing in this heat?"},
    {"speaker": "user", "text": "Oh, I'm fine, love. Don't make a fuss."},
    {"speaker": "bot", "text": "That's good to hear. How warm is it in the house today?"},
    {"speaker": "user", "text": "Well, the cooler quit yesterday, but I'm alright, I just sit still."},
    {"speaker": "bot", "text": "Have you been able to get up and about today?"},
    {"speaker": "user", "text": "Not really. I've been in the chair since yesterday. I'm fine though, honestly."},
]


class FakeCompletions:
    """Records what was sent and replays scripted responses."""

    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeClient:
    def __init__(self, script: list[Any]) -> None:
        self.chat = type("Chat", (), {"completions": FakeCompletions(script)})()


def reply(text: str, *, prompt: int = 100, completion: int = 20) -> Any:
    usage = type("U", (), {"prompt_tokens": prompt, "completion_tokens": completion})()
    message = type("M", (), {"content": text})()
    choice = type("C", (), {"message": message})()
    return type("R", (), {"choices": [choice], "usage": usage})()


def make(script: list[Any]) -> GlmReconciler:
    return GlmReconciler(api_key="unused-in-tests", client=FakeClient(script))


def sent_prompt(r: GlmReconciler, index: int = 0) -> str:
    return r.client.chat.completions.calls[index]["messages"][1]["content"]


async def test_json_mode_is_tried_first_and_nested_paths_come_back() -> None:
    r = make([reply('{"checks.has_water": "yes"}')])
    out = await r.reconcile(schema=SCHEMA, partial_result={"is_safe_now": "yes"},
                            failing_fields=["checks.has_water"], transcript=TRANSCRIPT, summary=None)
    assert out == {"checks.has_water": "yes"}
    sent = r.client.chat.completions.calls[0]
    assert sent["response_format"] == {"type": "json_object"}
    assert sent["model"] == "z-ai/glm-5.3-free" and sent["temperature"] == 0
    assert r.last_meta["json_mode"] is True and r.last_meta["usage"]["completion_tokens"] == 20
    # the patch lands at the nested path
    merged = merge_reconciled({"checks": {"has_water": "unknown"}}, out, TRANSCRIPT, ["checks.has_water"])
    assert merged == {"checks": {"has_water": "yes"}}


async def test_falls_back_when_the_gateway_rejects_response_format() -> None:
    """Not every OpenAI-compatible gateway supports json_object; one retry without it."""
    r = make([RuntimeError("400 response_format not supported"), reply('```json\n{"is_safe_now": "no"}\n```')])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now"],
                            transcript=TRANSCRIPT, summary="ok")
    assert out == {"is_safe_now": "no"}
    calls = r.client.chat.completions.calls
    assert "response_format" in calls[0] and "response_format" not in calls[1]
    assert r.last_meta["json_mode"] is False


async def test_unrequested_fields_are_dropped() -> None:
    r = make([reply('{"is_safe_now": "yes", "checks.equipment_working": "no"}')])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now"],
                            transcript=TRANSCRIPT, summary=None)
    assert out == {"is_safe_now": "yes"}  # the model volunteered a field nobody asked about


async def test_a_dead_endpoint_degrades_to_unknown_instead_of_failing_the_sweep() -> None:
    """A flaky free-tier model may cost a resolved field. It may never cost a neighbour."""
    r = make([RuntimeError("connection reset"), RuntimeError("connection reset")])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now"],
                            transcript=TRANSCRIPT, summary=None)
    assert out is None
    assert "error" in r.last_meta and r.last_meta["latency_ms"] >= 0
    # merge_reconciled treats None as "change nothing": is_safe_now stays unknown, which the
    # escalation layer acts on. Unknown is a finding, not a hole.
    assert merge_reconciled({"is_safe_now": "unknown"}, out, TRANSCRIPT, ["is_safe_now"]) == {"is_safe_now": "unknown"}


async def test_garbage_response_is_not_a_patch() -> None:
    r = make([reply("I'm sorry, I can't help with that.")])
    assert await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now"],
                             transcript=TRANSCRIPT, summary=None) is None
    assert r.last_meta["error"] == "unparseable response"


# --------------------------------------------------------------- under-reporting: the point
async def test_a_reassurance_followed_by_a_detail_is_read_as_the_detail() -> None:
    """The call this layer exists for. Rosa says she is fine three times; her cooler is dead and she
    has not been out of the chair since yesterday. CALL-E left is_safe_now unknown, and the
    understanding pass resolves it to "no" with the words that decided it, which is what the block
    captain sees before she decides whose door to knock on first."""
    r = make([reply(
        '{"is_safe_now": {"value": "no", "evidence": "the cooler quit yesterday, but I\'m alright, I just sit still"},'
        ' "needs_help_now": {"value": "yes", "evidence": "I\'ve been in the chair since yesterday"}}'
    )])
    out = await r.reconcile(schema=SCHEMA, partial_result={"is_safe_now": "unknown", "needs_help_now": "unknown"},
                            failing_fields=["is_safe_now", "needs_help_now"], transcript=UNDER_REPORTING, summary=None)
    assert out == {"is_safe_now": "no", "needs_help_now": "yes"}
    merged = merge_reconciled({"is_safe_now": "unknown", "needs_help_now": "unknown"}, out,
                              UNDER_REPORTING, ["is_safe_now", "needs_help_now"])
    assert merged == {"is_safe_now": "no", "needs_help_now": "yes"}
    # both quotes are hers, and both survive into the trace the captain reads
    assert set(r.last_meta["evidence"]) == {"is_safe_now", "needs_help_now"}
    assert all(quote_is_grounded(q, UNDER_REPORTING) for q in r.last_meta["evidence"].values())


async def test_it_cannot_invent_a_symptom_nobody_described() -> None:
    """The mirror image of under-reporting, and the reason grounding is absolute: alarming_quote is
    copied verbatim into a HandoffPacket that a responder may be read out."""
    r = make([reply('{"alarming_quote": "I think I\'m going to pass out, I can\'t breathe."}')])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["alarming_quote"],
                            transcript=UNDER_REPORTING, summary=None)
    assert out == {"alarming_quote": "I think I'm going to pass out, I can't breathe."}
    merged = merge_reconciled({"alarming_quote": ""}, out, UNDER_REPORTING, ["alarming_quote"])
    assert merged == {"alarming_quote": ""}  # she never said it, so nobody will be told she did


async def test_nobody_answering_reaches_the_layer_as_a_finding_not_a_skip() -> None:
    """An unanswered call is where a hiring cascade moves on and this one leans in. The
    empty transcript is sent, it is labelled as such, and every field the model cannot establish
    stays unknown — which is what the escalation ladder is fed."""
    r = make([reply('{"is_safe_now": {"value": "unknown", "evidence": ""}, "checks.too_hot": {"value": "unknown", "evidence": ""}}')])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now", "checks.too_hot"],
                            transcript=[], summary="No answer after 6 rings.")
    assert out == {"is_safe_now": "unknown", "checks.too_hot": "unknown"}
    assert "nobody spoke on this call" in sent_prompt(r)
    merged = merge_reconciled({}, out, [], ["is_safe_now", "checks.too_hot"])
    assert merged == {"is_safe_now": "unknown", "checks": {"too_hot": "unknown"}}


# --------------------------------------------------------------- grounding
@pytest.mark.parametrize("said,quote,grounded", [
    ("The cooler quit yesterday.", "the cooler quit yesterday", True),                   # punctuation and case
    ("I've been in the chair since yesterday.", "in the chair since yesterday", True),   # a fragment
    ("Well, um, I ran out of my pills on Friday, I think.", "I ran out of my pills on Friday", True),  # filler
    ("Oh, I'm fine, love.", "I can't breathe and I feel faint", False),                  # invented
    ("I'm fine.", "There's a cooling centre open at the library", False),                # the caller's words
])
def test_a_quote_must_be_something_a_human_on_the_call_actually_said(said: str, quote: str, grounded: bool) -> None:
    turns = [{"speaker": "bot", "text": "There's a cooling centre open at the library"}, {"speaker": "user", "text": said}]
    assert quote_is_grounded(quote, turns) is grounded


@pytest.mark.parametrize("speaker,grounded", [
    ("user", True),
    ("neighbour", True),   # a provider that labels the human side differently
    ("unknown", True),     # the MCP path passes labels through and may have none
    ("bot", False),
    ("assistant", False),
])
def test_who_counts_as_a_human_turn(speaker: str, grounded: bool) -> None:
    """Grounding filters the machine out, not the human in. A daughter or a carer who picks up may
    not be labelled "user", and blanking every quote on those calls would lose exactly the calls
    where somebody is reporting on a person who could not come to the phone."""
    turns = [{"speaker": speaker, "text": "Mum's air conditioning has been out since Tuesday."}]
    assert quote_is_grounded("Mum's air conditioning has been out since Tuesday", turns) is grounded


async def test_it_may_resolve_an_unknown_but_never_overrule_the_provider() -> None:
    """CALL-E heard the audio; this layer is reading a transcript of it. Filling in an unknown is
    its job; contradicting a definite answer is not — in either direction."""
    r = make([reply('{"is_safe_now": {"value": "yes", "evidence": "I\'m fine, love"}}')])
    out = await r.reconcile(schema=SCHEMA, partial_result={"is_safe_now": "no"},
                            failing_fields=["is_safe_now"], transcript=UNDER_REPORTING, summary=None)
    assert out == {"is_safe_now": "yes"}  # the model said its piece
    merged = merge_reconciled({"is_safe_now": "no"}, out, UNDER_REPORTING, ["is_safe_now"])
    assert merged == {"is_safe_now": "no"}  # and the merge declined to talk anybody out of a concern


# --------------------------------------------------------------- help that was actually offered
async def test_the_help_the_caller_could_offer_reaches_the_prompt() -> None:
    """Without this the layer cannot tell "she turned down the cooling centre" from "the cooling
    centre was never mentioned". The first is a fact about Rosa; the second is a fact about the call."""
    r = make([reply('{"help_declined": {"value": ["cooling_center"], "evidence": "I don\'t want to be any trouble"}}')])
    await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["help_declined"],
                      transcript=TRANSCRIPT, summary=None,
                      help_offered=[{"key": "cooling_center", "label": "Cooling centre",
                                     "text": "There's a cooling centre at the Maryvale library until 8pm."}])
    body = sent_prompt(r)
    assert "cooling_center (Cooling centre)" in body
    assert "There's a cooling centre at the Maryvale library until 8pm." in body
    assert "actually said out loud" in body
    assert "belongs in neither the accepted nor the declined list" in body


async def test_with_nothing_to_offer_the_prompt_says_so() -> None:
    r = make([reply('{"help_declined": []}')])
    await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["help_declined"],
                      transcript=TRANSCRIPT, summary=None, help_offered=[])
    assert "no help to offer on this call" in sent_prompt(r)


async def test_help_that_was_never_available_is_dropped_by_the_merge() -> None:
    """The prompt forbids inventing an offer; the merge does not take its word for it. Only the
    identifiers this call could actually say out loud may be recorded as accepted or declined."""
    r = make([reply('{"help_accepted": ["cooling_center", "helicopter_evacuation"]}')])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["help_accepted"],
                            transcript=TRANSCRIPT, summary=None,
                            help_offered=[{"key": "cooling_center", "label": "Cooling centre", "text": "..."}])
    merged = merge_reconciled({"help_accepted": []}, out, TRANSCRIPT, ["help_accepted"], ["cooling_center"])
    assert merged == {"help_accepted": ["cooling_center"]}
    # and with no offer_keys given the merge stays out of it, as it did before this rule existed
    assert merge_reconciled({"help_accepted": []}, out, TRANSCRIPT, ["help_accepted"]) == {
        "help_accepted": ["cooling_center", "helicopter_evacuation"]}


async def test_a_wiring_mistake_on_the_offers_kwarg_cannot_take_the_sweep_down() -> None:
    """`help_offered` is canonical, but the ported runner said `disclosures` and the contract field
    is `help_offers`. A TypeError here would land outside the fail-open path and kill the sweep."""
    for kwargs in ({"disclosures": [{"field": "cooling_center", "label": "Cooling centre", "text": "Library until 8pm."}]},
                   {"help_offers": [{"key": "cooling_center", "label": "Cooling centre", "text": "Library until 8pm."}]},
                   {"something_a_future_caller_invents": ["ride"]}):
        r = make([reply('{"help_declined": []}')])
        out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["help_declined"],
                                transcript=TRANSCRIPT, summary=None, **kwargs)
        assert out == {"help_declined": []}


async def test_the_alias_offers_still_reach_the_prompt() -> None:
    r = make([reply('{"help_declined": []}')])
    await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["help_declined"],
                      transcript=TRANSCRIPT, summary=None,
                      disclosures=[{"field": "cooling_center", "label": "Cooling centre", "text": "Library until 8pm."}])
    assert "cooling_center (Cooling centre)" in sent_prompt(r)


def test_a_bare_value_is_still_usable_when_the_model_skips_the_wrapper() -> None:
    patch, evidence = unwrap({"is_safe_now": "no", "checks.too_hot": {"value": "yes", "evidence": "it's close in here"},
                              "notes": "not asked about"}, {"is_safe_now", "checks.too_hot"})
    assert patch == {"is_safe_now": "no", "checks.too_hot": "yes"}
    assert evidence == {"checks.too_hot": "it's close in here"}


# --------------------------------------------------------------- the judgment, which lives in the prompt
def test_the_prompt_weighs_what_they_describe_over_how_they_rate_themselves() -> None:
    """No offline test can exercise a model's judgment. What can be pinned is that the rule the
    product depends on is actually in the text sent to it, in the words people actually use."""
    from app.orchestrator.reconcile_glm import SYSTEM

    assert "WHAT THEY DESCRIBE OUTWEIGHS HOW THEY RATE THEMSELVES" in SYSTEM
    for phrase in ("I'm fine", "I don't want to be any trouble", "don't make a fuss"):
        assert phrase in SYSTEM
    assert "the concrete detail decides the field" in SYSTEM
    assert "out of the chair since yesterday" in SYSTEM  # the case in the fixture above


def test_the_prompt_forbids_manufacturing_alarm_just_as_firmly() -> None:
    from app.orchestrator.reconcile_glm import SYSTEM

    assert "DO NOT MANUFACTURE ALARM" in SYSTEM
    assert "Never write down a symptom" in SYSTEM
    for not_a_finding in ("Politeness", "quiet voice", "living alone"):
        assert not_a_finding in SYSTEM


def test_the_prompt_forbids_the_one_thing_it_may_not_infer() -> None:
    """Assent is read generously; whether the caller ever said the offer out loud is not inferred."""
    from app.orchestrator.reconcile_glm import SYSTEM

    assert "may never infer" in SYSTEM
    assert "an option that never came up goes in neither list" in SYSTEM.lower()


@pytest.mark.parametrize("rule,phrase", [
    ("silence", "SILENCE IS A FINDING, NOT AN ERROR"),
    ("silence stays unknown", "Never answer \"yes, safe\" because an empty transcript"),
    ("confusion", "CONFUSION IS A FINDING IN ITS OWN RIGHT"),
    ("heat illness", "confusion can be heat illness"),
    ("cannot hear", "you'll have to speak up"),
    ("cannot hear is unknown", "never \"no\""),
    ("third party", "SOMEONE ELSE ANSWERED"),
    ("third party reassurance", "secondhand reassurance is the weakest evidence"),
    ("background sounds", "[alarm sounding]"),
    ("background is not a quote", "Never put a bracketed note"),
    ("empty is fine", "EMPTY IS USUALLY THE RIGHT ANSWER"),
])
def test_the_prompt_covers_the_cases_a_welfare_call_actually_produces(rule: str, phrase: str) -> None:
    from app.orchestrator.reconcile_glm import SYSTEM

    assert phrase in SYSTEM, rule


def test_the_anthropic_fallback_states_the_same_rules() -> None:
    from app.orchestrator.reconcile_anthropic import SYSTEM

    assert "not by how they rate themselves" in SYSTEM
    assert "Confusion or disorientation is a finding" in SYSTEM
    assert "Nobody answering is not an error" in SYSTEM


@pytest.mark.parametrize("text,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 1}\n```', {"a": 1}),
    ('Here you go:\n{"a": 1}\nHope that helps', {"a": 1}),
    ("[1, 2]", None),
    ("", None),
])
def test_json_extraction_tolerates_free_tier_formatting(text: str, expected: dict | None) -> None:
    assert extract_json_object(text) == expected


def test_selection_prefers_tokenrouter_and_reports_its_name() -> None:
    from app.config import Settings
    from app.orchestrator.reconcile import get_reconciler, reconciler_name

    s = Settings(TOKENROUTER_API_KEY="k", ANTHROPIC_API_KEY="a", _env_file=None)
    assert reconciler_name(s) == "glm" and get_reconciler(s).name == "glm"
    assert reconciler_name(Settings(TOKENROUTER_API_KEY="k", RECONCILER="none", _env_file=None)) == "null"
    assert reconciler_name(Settings(_env_file=None)) == "null"


async def test_a_timeout_does_not_trigger_the_no_json_retry() -> None:
    """An earlier live run spent 105 s because a timeout was treated as "this gateway lacks
    response_format" and retried without it. Retrying doubles the wall clock on a call that was
    already too slow, and here there are forty neighbours waiting behind it."""
    import httpx

    r = make([httpx.TimeoutException("timed out"), reply('{"is_safe_now": "yes"}')])
    out = await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now"],
                            transcript=TRANSCRIPT, summary=None)
    assert out is None                                   # degraded, as a dead endpoint should
    assert len(r.client.chat.completions.calls) == 1     # and did not spend the timeout twice
    assert "Timeout" in r.last_meta["error"]


def test_only_a_gateway_rejection_earns_the_retry() -> None:
    import httpx

    from app.orchestrator.reconcile_glm import is_response_format_rejection as rejected

    assert rejected(RuntimeError("400 response_format is not supported")) is True
    assert rejected(httpx.TimeoutException("timed out")) is False
    assert rejected(httpx.ConnectError("refused")) is False


def test_grounding_compares_like_with_like_after_redaction() -> None:
    """The model only ever sees the redacted transcript, so a quote it copies back carries the mask.
    Grounding it against the raw text would compare "****0142" with "+15550142" and throw away a
    sentence she really said — on a call where she is telling us who has her door key."""
    raw = [{"speaker": "user", "text": "Ring +15550142, that's my daughter, she has a key."}]
    assert quote_is_grounded("Ring ********0142, that's my daughter, she has a key.", raw) is True


async def test_the_transcript_leaves_the_process_redacted() -> None:
    """Everything that leaves this process goes through obs.redact, and the prompt is the one
    payload that carries a named person's own words to a third-party endpoint. Her health is the
    point of the call and cannot be stripped; her phone number is not, so it is not sent."""
    r = make([reply('{"is_safe_now": "unknown"}')])
    await r.reconcile(schema=SCHEMA, partial_result=None, failing_fields=["is_safe_now"], summary=None,
                      transcript=[{"speaker": "user", "text": "Call my daughter on +15550142, she has a key."}])
    body = sent_prompt(r)
    assert "+15550142" not in body and "0142" in body
    assert "she has a key" in body


# --------------------------------------------------------------- against the real contract
def _contract():  # noqa: ANN202
    from app.calls.contract import HazardView, NeighbourView, compile_contract

    hazard = HazardView(kind="heat", headline="Excessive Heat Warning — 114F", area="Maryvale, Phoenix",
                        captain_name="Alma", help_offered=[{"key": "cooling_center", "label": "Cooling centre",
                                                            "text": "There's a cooling centre at the Maryvale library until 8pm."}])
    neighbour = NeighbourView(name="Rosa Delgado", lives_alone=True, cooling="swamp_cooler")
    return compile_contract(hazard, neighbour)


def _safe_result(contract) -> dict[str, Any]:  # noqa: ANN001
    """What a call to a neighbour who is genuinely fine comes home with: every required tri-state
    answered, the lists empty or honest, and nothing alarming said."""
    result: dict[str, Any] = {
        "reached_intended_person": "yes", "is_safe_now": "yes", "needs_help_now": "no",
        "checks": {k: "yes" for k in contract.result_schema["properties"]["checks"]["required"]},
        "help_offers_stated": "yes" if contract.offer_keys else "no", "help_accepted": [],
        "help_declined": list(contract.offer_keys), "concerns": [], "alarming_quote": "",
        "call_back_requested": "no",
    }
    if "equipment_hours_remaining" in contract.result_schema["required"]:
        result["equipment_hours_remaining"] = ""  # they use equipment, and the number never came up
    assert contract.validate_result(result) == []
    return result


def test_a_blank_alarming_quote_is_sent_to_the_understanding_layer() -> None:
    """`alarming_quote: ""` is schema-valid, so it raises no validation error and would never reach a
    second reader — and "" is also what an extractor returns when it heard something bad and could
    not pin the sentence. The rule that catches that has a cost worth stating out loud: on a calm
    call the quote is legitimately empty, so the reconciler runs for every neighbour who is fine.
    Hence the SYSTEM prompt's EMPTY IS USUALLY THE RIGHT ANSWER clause, and hence the grounding rule
    — asking the question forty times a night is exactly how a system starts inventing answers.
    The integrator can trade this off (skip reconcile when only `alarming_quote` is failing) but it
    should be a decision, not a surprise on the phone bill."""
    contract = _contract()
    result = _safe_result(contract)
    assert failing_fields_for(contract.result_schema, result, []) == ["alarming_quote"]
    assert failing_fields_for(contract.result_schema, {**result, "alarming_quote": "The cooler's been off two days."}, []) == []


def test_the_power_dependent_neighbour_brings_a_second_always_blank_required_field() -> None:
    """Walter runs an oxygen concentrator off wall power, so `equipment_hours_remaining` is required
    on his calls — and it is legitimately "" whenever the number never came up, which means the
    reconciler is asked "how many hours has Walter got?" on every clean call to him. That number is
    the escalation layer's urgency input and nothing downstream can ground it: it is not a quote, so
    the merge cannot check it. The only defence is the prompt, hence the clause pinned below."""
    from app.calls.contract import HazardView, NeighbourView, compile_contract
    from app.orchestrator.reconcile_glm import SYSTEM

    contract = compile_contract(
        HazardView(kind="power_outage", headline="Outage — 6,000 customers", area="Maryvale, Phoenix"),
        NeighbourView(name="Walter Pryce", power_dependent=True, power_backup_hours=4.0, lives_alone=True),
    )
    result = _safe_result(contract)
    assert failing_fields_for(contract.result_schema, result, []) == ["alarming_quote", "equipment_hours_remaining"]
    assert failing_fields_for(contract.result_schema, {**result, "equipment_hours_remaining": "about four hours"}, []) == ["alarming_quote"]

    assert "THE SAME GOES FOR A NUMBER" in SYSTEM
    assert "Never work one out from the fact that they own the equipment" in SYSTEM


def test_an_unknown_on_a_hazard_critical_check_is_what_reaches_the_layer() -> None:
    """The fields a heat warning makes non-negotiable come back as failing when the call left them
    open — that is the path from "she never answered the question about water" to a second reader,
    and failing that, to an escalation."""
    contract = _contract()
    result = _safe_result(contract)
    result["checks"]["has_water"] = "unknown"
    result["is_safe_now"] = "unknown"
    assert failing_fields_for(contract.result_schema, result, []) == ["alarming_quote", "checks.has_water", "is_safe_now"]


async def test_the_real_schema_flows_end_to_end_through_the_layer() -> None:
    """A whole trip with the contract the calls actually use: unresolved fields in, dotted paths out,
    merged back into the nested result, quotes grounded."""
    contract = _contract()
    result = _safe_result(contract)
    result["is_safe_now"] = "unknown"
    result["checks"]["too_hot"] = "unknown"
    failing = failing_fields_for(contract.result_schema, result, [])
    r = make([reply(
        '{"is_safe_now": {"value": "no", "evidence": "the cooler quit yesterday"},'
        ' "checks.too_hot": {"value": "yes", "evidence": "I just sit still"},'
        ' "alarming_quote": {"value": "I\'ve been in the chair since yesterday", "evidence": "I\'ve been in the chair since yesterday"}}'
    )])
    patch = await r.reconcile(schema=contract.result_schema, partial_result=result, failing_fields=failing,
                              transcript=UNDER_REPORTING, summary="Spoke with Rosa; she said she was fine.",
                              help_offered=[o.model_dump() for o in contract.help_offers])
    merged = merge_reconciled(result, patch, UNDER_REPORTING, failing, contract.offer_keys)
    assert merged["is_safe_now"] == "no"
    assert merged["checks"]["too_hot"] == "yes"
    assert merged["alarming_quote"] == "I've been in the chair since yesterday"
    assert merged["help_declined"] == ["cooling_center"]  # untouched: it was never a failing field
    assert contract.validate_result(merged) == []
