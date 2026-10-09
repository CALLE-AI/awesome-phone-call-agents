"""Templated TRAINING corpus generator.

This is intentionally a *different author* from the evaluation set: the 40
eval transcripts in data/sim/eval were written independently, blind to these
templates and to the feature code. Training on templates and testing on
independently-authored text (plus real calls) is how we keep the published
numbers honest.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from ..models import Transcript, Turn, speech_seconds

BUSINESSES = ["Luigi's Trattoria", "Northside Dental", "Parkview Auto Repair", "Bloom Florists", "Harbor Hotel",
              "City Pharmacy", "Summit Fitness", "Maple Vet Clinic", "Brightline Internet", "Cedar Hair Studio"]
NAMES = ["Sam", "Maria", "Dev", "Chloe", "Marcus", "Priya", "Tom", "Ana", "Kenji", "Leah"]
AGENT_NAMES = ["Ava", "Max", "Aria", "Nova", "Riley", "Sophie"]
PRINCIPALS = ["Jordan Lee", "Alex Martin", "Casey Brown", "Taylor Kim"]

TASKS = [
    ("book a table for two on Friday at 7 PM", "booking",
     "I'd like to book a table for two people this Friday at 7 PM, under the name {p}.",
     ["Is Friday at 7 available?", "Could you confirm the booking under {p}?"]),
    ("check whether the store is open on Sunday", "information",
     "Could you tell me your opening hours this Sunday?",
     ["Do you close earlier on holidays?", "Thanks, and is parking available?"]),
    ("reschedule an appointment from Tuesday to Thursday morning", "reschedule",
     "I'm calling to move {p}'s appointment from Tuesday to Thursday morning.",
     ["Is 10 AM on Thursday possible?", "Can you confirm the new time?"]),
    ("cancel a subscription", "cancellation",
     "I'd like to cancel the subscription for the account under {p}.",
     ["Can you confirm the cancellation is effective today?", "Will there be a final charge?"]),
    ("ask for a quote for a brake replacement", "information",
     "Could you give me a rough quote for replacing the front brake pads on a 2018 sedan?",
     ["Does that include labour?", "How soon could you do it?"]),
    ("request a refund for a double charge", "refund",
     "{p} was charged twice for the same order last week, and I'm calling to request a refund for the duplicate.",
     ["How long will the refund take?", "Can you confirm the refund has been issued?"]),
]


def _jitter(rng, lo, hi):
    return rng.uniform(lo, hi)


def _disfluent(rng, text, rate):
    if rng.random() > rate:
        return text
    fillers = ["um, ", "uh, ", "so, ", "yeah, um, ", "let me see, ", "hmm, "]
    w = text.split()
    i = rng.randrange(0, max(1, min(len(w), 4)))
    if rng.random() < 0.3 and len(w) > 2:
        w.insert(i, w[i])  # false start: "the the"
    else:
        w.insert(i, rng.choice(fillers).strip())
    return " ".join(w)


class _Clock:
    def __init__(self):
        self.turns: list[Turn] = []
        self.t = 0.0

    def say(self, speaker, text, gap):
        start = max(0.0, self.t + gap)
        if self.turns:
            start = max(start, self.turns[-1].offset_seconds + 0.2)
        self.turns.append(Turn(speaker, text, round(start, 2)))
        self.t = max(self.t, start + speech_seconds(text))


def human(rng: random.Random, i: int) -> Transcript:
    biz, name, p = rng.choice(BUSINESSES), rng.choice(NAMES), rng.choice(PRINCIPALS)
    task, kind, ask, follow = rng.choice(TASKS)
    terse = rng.random() < 0.25
    scripted = rng.random() < 0.2  # polished receptionist: the hard human
    disfl = 0.1 if scripted else rng.uniform(0.25, 0.6)
    gap = lambda: rng.choice([rng.gauss(0.45, 0.35), rng.gauss(0.3, 0.2), rng.uniform(1.5, 3.5) if rng.random() < 0.12 else rng.gauss(0.6, 0.4)])
    c = _Clock()
    greet = rng.choice(["Hello?", "Yeah, hello.", f"{biz}, this is {name}.", f"{biz}, {name} speaking.", "Hi, who's calling?"])
    if scripted:
        greet = f"Thank you for calling {biz}, this is {name}, how can I help you?"
    c.say("user", greet, rng.uniform(0.3, 2.2))
    c.say("bot", f"Hi, I'm an AI assistant calling on behalf of {p}. {ask.format(p=p)}", gap())
    replies = {
        "booking": ["Friday at seven, let me look. Yeah we have that.", "For two? Okay, I've got you down for Friday at seven.", "Hmm, seven is full, we could do seven thirty?"],
        "information": ["Sunday we're open ten to four.", "Oh, uh, Sundays we close at five I think.", "Yeah, it'd be around three hundred with parts, roughly."],
        "reschedule": ["Tuesday to Thursday, hang on. Thursday at ten works.", "Let me check the book. Okay, Thursday ten a.m., done."],
        "cancellation": ["Okay, I can cancel that for you. It's cancelled as of today.", "Right, let me pull up the account. Okay, that's cancelled."],
        "refund": ["Oh I see it, yeah, charged twice. I'll put the refund through now.", "Let me look. Yep, I've refunded the second charge."],
    }[kind]
    for k in range(rng.randint(2, 4)):
        text = rng.choice(replies) if k == 0 else rng.choice(["Yeah.", "Sure.", "Mm-hmm.", "Okay, yeah that's fine.", "No, that's everything.", "Uh, five to seven business days usually.", "Sure, yeah, confirmed.", "Yep, you're all set."])
        if terse:
            text = " ".join(text.split()[:3])
        c.say("user", _disfluent(rng, text, disfl), -rng.uniform(0.2, 0.9) if rng.random() < 0.15 else gap())
        if rng.random() < 0.3:
            c.say("user", rng.choice(["mm-hmm", "yeah", "okay", "right"]), rng.uniform(0.05, 0.4))
        c.say("bot", rng.choice(follow).format(p=p) if k < 2 else "Thank you so much, that's all I needed.", rng.gauss(0.9, 0.2))
    c.say("user", _disfluent(rng, rng.choice(["Okay, bye.", "No problem, bye now.", "You too, bye.", "Alright, take care."]), disfl), gap())
    return Transcript(f"train-human-{i:03d}", c.turns, "human", "sim-train", {"task": task, "hard": scripted or terse})


def agent(rng: random.Random, i: int) -> Transcript:
    biz, aname, p = rng.choice(BUSINESSES), rng.choice(AGENT_NAMES), rng.choice(PRINCIPALS)
    task, kind, ask, follow = rng.choice(TASKS)
    discloses = rng.random() < 0.7
    fillers = rng.random() < 0.3  # agents that fake disfluency: the hard agent
    base = rng.uniform(0.6, 1.8)
    gap = lambda: max(0.3, rng.gauss(base, rng.uniform(0.08, 0.3)))
    c = _Clock()
    who = f"I'm {aname}, the virtual assistant for {biz}" if discloses else f"this is {aname} at {biz}"
    c.say("user", rng.choice([f"Thank you for calling {biz}! {who[0].upper() + who[1:]}. How can I help you today?",
                              f"Hi there, {who}. How may I assist you today?",
                              f"Hello and thanks for calling {biz}. {who[0].upper() + who[1:]}, and I can help with bookings, hours, and more. What can I do for you?"]),
          rng.uniform(0.4, 1.2))
    c.say("bot", f"Hi, I'm an AI assistant calling on behalf of {p}. {ask.format(p=p)}", 0.6)
    for k in range(rng.randint(2, 4)):
        restate = {
            "booking": f"Certainly! Just to confirm, you'd like a table for two this Friday at 7 PM under the name {p}. I've gone ahead and booked that for you.",
            "information": f"Of course! {biz} is open on Sunday from 10 AM to 4 PM. Is there anything else I can help you with?",
            "reschedule": f"Absolutely, I'd be happy to help. I've moved {p}'s appointment from Tuesday to Thursday at 10 AM. Is there anything else?",
            "cancellation": f"I understand. I've processed the cancellation for the account under {p}, effective today. Is there anything else I can help with?",
            "refund": f"I'm sorry about the double charge. I've submitted a refund request for the duplicate payment. It should be processed within five to seven business days.",
        }[kind] if k == 0 else rng.choice([
            "Great question! Let me check that for you. Yes, that's correct.",
            "Absolutely, that's confirmed. Is there anything else I can help you with today?",
            "I'd be happy to help with that. Everything is all set on our end.",
            "Certainly. You're all set. Thank you for calling, and have a wonderful day!",
            "I understand. Someone from our team will follow up to confirm the details.",
            "Of course. One moment please. Yes, that works.",
        ])
        if fillers and rng.random() < 0.6:
            text = _disfluent(rng, restate, 1.0)
        else:
            text = restate
        c.say("user", text, gap())
        c.say("bot", rng.choice(follow).format(p=p) if k < 2 else "Thank you, that's everything.", rng.gauss(0.9, 0.2))
    c.say("user", "You're welcome! Have a wonderful day. Goodbye!", gap())
    return Transcript(f"train-agent-{i:03d}", c.turns, "agent", "sim-train", {"task": task, "hard": fillers or not discloses})


def ivr(rng: random.Random, i: int) -> Transcript:
    biz, p = rng.choice(BUSINESSES), rng.choice(PRINCIPALS)
    task, kind, ask, _ = rng.choice(TASKS)
    speech_ivr = rng.random() < 0.35
    tick = lambda: rng.gauss(0.5, 0.05)
    c = _Clock()
    menu = (f"Thank you for calling {biz}. Your call is important to us. Please listen carefully, as our menu options have changed. "
            "For hours and directions, press 1. For appointments, press 2. For billing, press 3. To repeat these options, press 9.")
    if speech_ivr:
        menu = f"Welcome to {biz}. In a few words, tell me what you're calling about. You can say things like appointments, billing, or hours."
    c.say("user", menu, rng.uniform(0.2, 0.8))
    for k in range(rng.randint(2, 4)):
        if speech_ivr:
            c.say("bot", rng.choice(["Appointments.", ask.format(p=p), "Representative.", "Billing, please."]), 0.7)
            c.say("user", rng.choice(["Sorry, I didn't get that. You can say appointments, billing, or hours.",
                                      "Okay, billing. Please hold while I transfer you. The current wait time is more than ten minutes.",
                                      "I think you said appointments. Is that right? Say yes or no."]), tick())
        else:
            c.say("bot", f"[DTMF {rng.randint(1, 3)}]" if rng.random() < 0.7 else ask.format(p=p), rng.uniform(0.8, 1.6))
            c.say("user", rng.choice(["Sorry, I didn't get that. " + menu,
                                      "Please hold while we connect you to the next available representative. Your call may be recorded for quality purposes.",
                                      "Please enter your account number, followed by the pound key.",
                                      "Our hours are Monday through Friday, 9 AM to 6 PM. To return to the main menu, press star."]), tick())
    return Transcript(f"train-ivr-{i:03d}", c.turns, "ivr", "sim-train", {"task": task, "hard": speech_ivr})


def build(n_per_class: int = 60, seed: int = 11) -> list[Transcript]:
    rng = random.Random(seed)
    return [gen(rng, i) for gen in (human, agent, ivr) for i in range(n_per_class)]


def write(out: Path, n_per_class: int = 60, seed: int = 11) -> int:
    out.mkdir(parents=True, exist_ok=True)
    ts = build(n_per_class, seed)
    for t in ts:
        (out / f"{t.id}.json").write_text(json.dumps(t.to_dict(), indent=1))
    return len(ts)
