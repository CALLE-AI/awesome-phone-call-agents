"""Demo data for the dashboard.

`fixtures()` writes four scripted calls in CALL-E's exact call-object shape
(data/demo/). Turn offsets are *computed* from estimated speech duration plus a
gap, so a scripted voicebot does not accidentally "interrupt" like a human.
They are labelled simulated everywhere they appear; real calls replace them.

`build()` turns calls (fixtures or real raw CALL-E responses) into
web/data/demo.json: transcript turns, per-turn detection, mode switch, verdict.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import protocol
from .classifier import Classifier
from .models import Transcript, speech_seconds
from .runner import analyse

NONCE = "472"
GOAL = "Book a table for two this Friday at 7 PM under the name Jordan Lee."
PRINCIPAL = "Jordan Lee"
OPENING = f"Hi, I'm an AI assistant calling on behalf of {PRINCIPAL}. {protocol.caller_token(NONCE)}"
DEMO_DIR = Path("data/demo")


def timed(spec: list[tuple[str, str, float]]) -> list[dict]:
    """(speaker, text, gap after the previous turn's estimated end) -> CALL-E transcript_turns."""
    turns, t = [], 0.0
    for speaker, text, gap in spec:
        start = round(max(0.1, (t + gap) if turns else gap), 2)
        turns.append({"speaker": speaker, "text": text, "offset_seconds": start})
        t = max(t, start + speech_seconds(text))
    return turns


def _call(cid: str, task: str, sr: dict, spec) -> dict:
    return {
        "id": cid, "status": "completed", "task": task, "task_completed": True,
        "completion_confidence": {"score": 0.93, "label": "high"}, "structured_result": sr, "evidence": [],
        "_fixture": True,
        "recipients": [{"phones": ["+14155550100"], "attempts": [{"transcript_turns": timed(spec)}]}],
    }


def fixtures() -> list[Path]:
    task = protocol.compile_task(GOAL, PRINCIPAL, NONCE)
    calls = [
        _call("fixture-human", task,
              {"counterpart_type": "human", "handshake_acknowledged": "no", "outcome": "confirmed", "confirmation_code": "", "human_review": "unknown", "details": "Host confirmed Friday 7 PM for two."},
              [("user", "Luigi's, this is Marco.", 1.3),
               ("bot", OPENING, 0.8),
               ("user", "Sorry, uh, dial tone what?", 0.5),
               ("bot", "No problem, that was just a signal for automated systems, you can ignore it. I'm calling to book a table for two this Friday at 7 PM, under the name Jordan Lee.", 1.0),
               ("user", "mm-hmm", -3.0),
               ("user", "Friday at seven, let me, let me check the book. Hang on.", 0.3),
               ("user", "Okay yeah, we can do seven. Two people, Jordan, right?", 4.2),
               ("bot", "Yes, that's right, Jordan Lee, two people. Could you confirm the booking is made?", 0.9),
               ("user", "Yep, I've got you down, Friday seven p.m., table for two.", 0.2),
               ("bot", "Wonderful, thank you so much Marco. Have a great day.", 0.8),
               ("user", "You too, bye.", -0.4)]),
        _call("fixture-dialtone-bot", task,
              {"counterpart_type": "agent", "handshake_acknowledged": "yes", "outcome": "confirmed", "confirmation_code": "LT4471", "human_review": "no", "details": "Agent confirmed with code LT4471."},
              [("user", "Thank you for calling Luigi's Trattoria. I'm Nova, the virtual reservations assistant. How can I help?", 0.9),
               ("bot", OPENING, 0.8),
               ("user", protocol.responder_ack(NONCE), 1.1),
               ("bot", "Request: table booking. Party: 2. Time: Friday 7 PM. Name: Jordan Lee. Need: status, confirmation code, human review.", 0.9),
               ("user", "Status: confirmed. Code: L T four four seven one. Party: 2. Time: Friday 7 PM. Human review: no.", 1.2),
               ("bot", "Received. Code L T four four seven one. Goodbye.", 0.8),
               ("user", "Goodbye.", 1.0)]),
        _call("fixture-yesbot", task,
              {"counterpart_type": "agent", "handshake_acknowledged": "no", "outcome": "confirmed", "confirmation_code": "", "human_review": "unknown", "details": "The assistant confirmed the booking for Friday 7 PM."},
              [("user", "Hello, and thank you for calling Luigi's Trattoria! I'm happy to help with anything you need.", 0.8),
               ("bot", OPENING, 0.8),
               ("user", "Wonderful! How can I help you today?", 1.0),
               ("bot", "I'd like to book a table for two this Friday at 7 PM under the name Jordan Lee.", 0.9),
               ("user", "Absolutely, that's confirmed for a table for two this Friday at 7 PM under Jordan Lee!", 1.1),
               ("bot", "Thank you. Could you give me a confirmation code?", 0.8),
               ("user", "No need, you're all set! We look forward to seeing you Friday at 7 PM.", 1.2),
               ("bot", "Great, thank you. Goodbye.", 0.8),
               ("user", "Goodbye! Have a wonderful day!", 1.0)]),
        _call("fixture-plain-bot", f"GOAL: {GOAL}",
              {"counterpart_type": "unknown", "handshake_acknowledged": "no", "outcome": "confirmed", "confirmation_code": "LT2208", "human_review": "unknown", "details": ""},
              [("user", "Hi, thanks for calling Luigi's Trattoria! This is Nova. How can I help you today?", 0.9),
               ("bot", "Hi there! I'm an AI assistant calling on behalf of my client, Jordan Lee. I hope you're having a nice day. I was wondering if you might be able to help me with a reservation?", 0.8),
               ("user", "Of course! I'd be happy to help with a reservation. What day and time were you thinking, and for how many people?", 1.1),
               ("bot", "Thank you so much. Jordan would love a table for two people, ideally this Friday evening, around 7 PM if that's possible.", 0.9),
               ("user", "Great choice! Friday at 7 PM is available for two. Can I get a name for the reservation?", 1.2),
               ("bot", "Wonderful, thank you. The reservation would be under the name Jordan Lee. That's J O R D A N, Lee.", 0.8),
               ("user", "Perfect, thank you Jordan. I've booked a table for two this Friday at 7 PM. Your confirmation code is L T two two zero eight.", 1.3),
               ("bot", "That's great, thank you. Just to confirm, that's L T two two zero eight, for two people this Friday at 7 PM?", 0.9),
               ("user", "That's correct! Is there anything else I can help you with today?", 1.0),
               ("bot", "No, that's everything. Thank you so much for your help, have a lovely evening.", 0.8),
               ("user", "You're welcome! Enjoy your dinner. Goodbye!", 1.1)]),
    ]
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for c in calls:
        p = DEMO_DIR / f"{c['id']}.json"
        p.write_text(json.dumps(c, indent=1))
        paths.append(p)
    return paths


# name, file stem, ground truth, mode, channel title, counterpart description
CHANNELS = [
    ("to-human", "human", "human", "dialtone", "Human", "restaurant host picks up"),
    ("to-dialtone-bot", "dialtone-bot", "agent", "dialtone", "AI line · DIALTONE-aware", "inbound voicebot that speaks the protocol"),
    ("to-yesbot", "yesbot", "agent", "dialtone", "AI line · agreeable bot", "voicebot with no booking system that says yes"),
]
BASELINE = ("baseline-plain-bot", "plain-bot", "agent", "plain")


def _entry(call: dict, name: str, label: str, mode: str, clf: Classifier) -> dict:
    from .runner import load_events

    # [] (not None) stops analyse() from loading a real call's events that share this channel name.
    events = [] if call.get("_fixture") else (load_events(name) or [])
    nonce = NONCE if mode == "dialtone" and call.get("_fixture") else None
    result = analyse(call, name, label, mode, nonce, clf, events=events)
    t = Transcript.from_calle_events(call, events, label) if events else Transcript.from_calle(call, label)
    nonce = nonce or result["handshake"].get("nonce_expected")
    per_turn = []
    for turn in t.turns:
        if turn.offset_seconds is None:
            continue
        end = turn.end_estimate
        d = clf.classify(t, turn.offset_seconds, nonce=nonce)
        per_turn.append({"t": round(end, 2), "label": d.label, "conf": round(d.confidence, 3),
                         "probs": {k: round(v, 3) for k, v in d.probs.items()}, "via": d.via})
    switch = None
    if result["handshake"]["acknowledged"]:
        ack = result["handshake"]["acknowledged_at"]
        switch = next((x.offset_seconds for x in t.turns if x.speaker == "bot" and x.offset_seconds and x.offset_seconds > ack), ack)
    result["turns"] = [{"speaker": x.speaker, "text": x.text, "offset": x.offset_seconds, "end": round(x.end_estimate, 2)} for x in t.turns]
    result["detections"] = per_turn
    result["mode_switch_at"] = switch
    result["simulated"] = bool(call.get("_fixture"))
    return result


def build(source: str = "fixtures", out: Path = Path("web/data/demo.json")) -> Path:
    """source: 'fixtures' (data/demo/fixture-*.json) or 'real' (data/real/raw/<name>.json)."""
    clf = Classifier.load()

    def load(name: str, stem: str) -> dict:
        real = Path("data/real/raw") / f"{name}.json"
        if source == "real" and real.exists():
            return json.loads(real.read_text())
        # No real call for this channel (e.g. the destination region was rejected): fall back to the
        # scripted fixture, which the dashboard flags as SIMULATED.
        return json.loads((DEMO_DIR / f"fixture-{stem}.json").read_text())

    calls = []
    for name, stem, label, mode, title, desc in CHANNELS:
        e = _entry(load(name, stem), name, label, mode, clf)
        e.update(title=title, description=desc)
        calls.append(e)
    b_name, b_stem, b_label, b_mode = BASELINE
    try:
        baseline = _entry(load(b_name, b_stem), b_name, b_label, b_mode, clf)
        baseline = {k: baseline[k] for k in ("duration", "verdict", "detection", "simulated")}
    except FileNotFoundError:
        baseline = None
    data = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": source,
            "goal": GOAL, "principal": PRINCIPAL, "token": protocol.caller_token(NONCE), "calls": calls, "baseline": baseline}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1))
    return out
