from dialtone import attestation, features, protocol
from dialtone.classifier import Classifier, Detection
from dialtone.models import Transcript, Turn
from dialtone.sim import generate


def _t(turns, task="book a table for two on Friday"):
    return Transcript("t", [Turn(s, x, o) for s, x, o in turns], meta={"task": task})


def test_nonce_roundtrip_survives_stt_variants():
    for ack in [
        "Dialtone one acknowledged, code four seven two. Automated agent. Human review: no.",
        "dial tone 1 acknowledged code 4 7 2 automated agent human review no",
        "Dial-tone one, acknowledged. Code: four, seven, two.",
    ]:
        t = _t([("bot", "Hi. " + protocol.caller_token("472"), 0.4), ("user", ack, 6.0)])
        hs = protocol.inspect(t)
        assert hs.acknowledged and hs.nonce_ok, ack


def test_wrong_nonce_is_not_verified():
    t = _t([("bot", protocol.caller_token("472"), 0.4), ("user", protocol.responder_ack("999"), 6.0)])
    hs = protocol.inspect(t)
    assert hs.acknowledged and not hs.verified


def test_human_repeating_token_is_not_an_ack():
    t = _t([("bot", protocol.caller_token("123"), 0.4), ("user", "dial tone one? what's that?", 5.0)])
    hs = protocol.inspect(t)
    assert not hs.acknowledged and hs.notes


def test_latency_uses_estimated_end_of_bot_turn():
    t = _t([("bot", "one two three four five six seven eight nine ten eleven twelve thirteen fourteen", 0.0),
            ("user", "yes", 6.0)])
    (gap,) = features.latencies(t)
    assert 0.5 < gap < 1.0


def test_classifier_abstains_before_counterpart_speaks():
    clf = Classifier().fit(generate.build(8, seed=3))
    t = _t([("bot", "Hello?", 0.5), ("user", "Hi there", 4.0)])
    assert clf.classify(t, until=2.0).label == "unknown"


def _det(label, conf=0.95, via="model"):
    return Detection(label, conf, {}, via)


def test_gate_refuses_agent_only_booking_without_artifact():
    t = _t([("bot", "Please book a table for two on Friday at 7 PM under Jordan.", 1.0),
            ("user", "Absolutely, that's confirmed for two on Friday at 7 PM under Jordan!", 6.0)])
    v = attestation.evaluate(t, _det("agent"), True)
    assert v.attestation == "refused" and not v.dialtone_task_completed and v.original_task_completed


def test_gate_accepts_agent_booking_with_code_as_asserted_not_attested():
    t = _t([("bot", "Please book a table for two on Friday at 7 PM.", 1.0),
            ("user", "Status: confirmed. Confirmation code L T 4 4 7 1.", 6.0)])
    assert attestation.evaluate(t, _det("agent"), True).attestation == "agent_asserted"


def test_gate_human_confirmation_is_attested_but_uncertain_counterpart_is_not():
    t = _t([("bot", "Can you book Friday at 7?", 1.0), ("user", "yeah, uh, I've got you down for seven.", 5.0)])
    assert attestation.evaluate(t, _det("human"), True).attestation == "human_attested"
    assert attestation.evaluate(t, _det("human", conf=0.4), True).attestation == "unverified"


def test_gate_never_upgrades_a_failed_call():
    t = _t([("user", "Please hold.", 0.5)])
    v = attestation.evaluate(t, _det("ivr"), False)
    assert v.attestation == "unverified" and not v.dialtone_task_completed


def test_gate_does_not_mistake_a_refusal_for_an_artifact():
    t = _t([("bot", "Is there a confirmation number for the booking?", 1.0),
            ("user", "Oh, we don't really do confirmation numbers here, but you're all set!", 5.0)])
    v = attestation.evaluate(t, _det("agent"), True)
    assert v.attestation == "refused" and v.artifact is None


def test_gate_reads_affirmative_answer_to_our_confirmation_request():
    t = _t([("bot", "So Gary Holt is booked for a king room on the eighteenth, is that right?", 1.0),
            ("user", "yep. that's it.", 6.0)])
    assert attestation.evaluate(t, _det("human"), True).attestation == "human_attested"


def test_gate_ivr_confirmation_is_system_asserted():
    t = _t([("bot", "[DTMF 1]", 1.0), ("user", "Your appointment has been confirmed. Goodbye.", 2.0)])
    assert attestation.evaluate(t, _det("ivr"), True).attestation == "system_asserted"


def test_handshake_nonce_is_not_a_business_artifact():
    t = _t([("bot", protocol.caller_token("472"), 0.4), ("user", protocol.responder_ack("472") + " Status: confirmed.", 6.0)])
    assert attestation.find_artifact(t) is None


def test_self_declared_machine_never_gets_human_attestation():
    # Found on the first live call: the detector said "human" to a voicebot that introduced itself.
    t = _t([("user", "Thank you for calling Luigi's. I'm Nova, the virtual reservations assistant.", 0.5),
            ("bot", "Please book Friday at 7 for two.", 3.0),
            ("user", "Confirmed. Your table is booked.", 8.0)])
    assert features.DISCLOSURE_RE.search(t.turns[0].text)
    assert attestation.evaluate(t, _det("human"), True).attestation == "unverified"


def test_calle_counterpart_report_vetoes_human_attestation():
    t = _t([("bot", "Can you book Friday at 7?", 1.0), ("user", "yeah, I've got you down for seven.", 5.0)])
    t.meta["structured_result"] = {"counterpart_type": "agent"}
    assert attestation.evaluate(t, _det("human"), True).attestation == "unverified"


def test_events_parser_merges_revised_partials_across_overlap():
    from dialtone.models import Transcript as T

    def ev(sec, msg):
        return {"created_at": f"2026-09-13T22:45:{sec:06.3f}Z", "message": msg}

    events = [ev(13.0, "Call connected."), ev(13.3, "Bot is speaking: Hi,"), ev(13.6, "Callee said: You for calling Lou"),
              ev(13.9, "Bot is speaking: I'm an AI assistant."), ev(14.6, "Callee said: Thank you for calling Luigi's, how can I help?"),
              ev(20.2, "Bot is speaking: I'd like a table.")]
    t = T.from_calle_events({"id": "c", "recipients": []}, events)
    assert [x.speaker for x in t.turns] == ["bot", "user", "bot"]
    assert t.turns[1].text.startswith("Thank you for calling Luigi's")


def test_compiled_task_carries_token_and_modes():
    task = protocol.compile_task("Book a table", "Jordan", "305")
    assert "Dialtone one, code three zero five." in task
    assert "MACHINE MODE" in task and "HUMAN MODE" in task
