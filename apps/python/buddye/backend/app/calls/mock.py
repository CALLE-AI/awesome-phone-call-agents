"""Scripted check-in calls, keyed by neighbour. Zero network, zero phones, zero cost.

It exists so the whole workflow can be exercised without dialling anybody, and it carries real
weight, because the calls ARE the product: what these
fixtures return is what the captain's board says, so they have to sound like fourteen real people
having fourteen real conversations rather than one template with the names changed.

What is written into the transcripts on purpose:

* **People do not answer questions.** They ramble, they mishear, they apologise, they ask who is
  calling, they go off about the fishing. The agent has to follow them.
* **"I'm fine" is not an answer.** Rosa says it three times. She is not fine: her cooler died
  yesterday and she has not been out of the chair. The structured result reads what she MEANT — that
  is the whole reason `contract.py` writes its field descriptions as extraction guidance — and the
  transcript is left as she actually said it, so a human can check the machine's work.
* **Silence is a scenario, not an absence.** Hazel Nakamura, 82, bedbound, insulin in the
  refrigerator, sits at the critical band and does not pick up. Her fixture is a first-class
  `NO_ANSWER` with a duration and a summary, because `UNREACHABLE` is the outcome this product
  exists to surface and it must be as easy to demo as a cheerful "yes I'm fine".
* **One person must never be dialled at all.** Gerald Pryce opted out. `risk.call_order` already
  drops him, so if a request for him ever reaches this provider something upstream is broken; it
  raises `ConsentViolation` rather than inventing a conversation that should not have happened.

Hazard overlays. The same roster is swept twice in the demo — once for the heat warning, once for
the outage — and the same person does not say the same things in both. Each fixture may carry a
`by_hazard` block keyed by hazard kind; `_fixture_for` merges it over the base. A hazard with no
overlay falls back to the base fixture rather than to `DEFAULT_FIXTURE`, so an unforeseen hazard
kind still produces a real conversation.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.calls.provider import CallOutcome, CallRequest, EventSink, ProviderEvent

Fixture = dict[str, Any]

# ------------------------------------------------------------------------------------------------
# The result shape, from `contract.compile_contract`. Every fixture states only its deviations and
# `make_result` fills in the rest — but the rest is a COMPLETE answer, not a pile of "unknown".
#
# That is load-bearing and was learned the hard way: `decide()` treats any hazard-required tri-state
# left at "unknown" as a fact the call failed to establish, which blocks SAFE and lands the neighbour
# at NEEDS_HELP (or URGENT at the high bands). A base of unknowns would mean no fixture could ever
# come out SAFE and the demo board would read as though everybody on the block were in trouble.
# `help_offers_stated` and `call_back_requested` are required enums too, and are the two that get
# forgotten, so they are stated here.
# ------------------------------------------------------------------------------------------------
#: "Nothing wrong here" for every condition check.
#:
#: `equipment_working` is the exception and stays "unknown", because the extraction guidance is
#: explicit that "unknown" is the answer for somebody who uses no powered medical equipment. Any
#: fixture for a person who does use some states it.
#: `someone_with_them` defaults to "no" — most of this roster lives alone, and `decide()` reads that
#: as context rather than as a need, so an alone person can still come out SAFE.
SETTLED_CHECKS: dict[str, str] = {
    "too_hot": "no",
    "too_cold": "no",
    "has_power": "yes",
    "has_water": "yes",
    "has_food": "yes",
    "has_medication": "yes",
    "equipment_working": "unknown",
    "can_evacuate": "yes",
    "someone_with_them": "no",
}

#: Everything a call that never connected can honestly say. Used for nothing here — a NO_ANSWER
#: fixture returns `structured_result=None` — but exported because it is the shape a webhook or a
#: reconciler test needs when it wants "the call came back empty" without hand-writing fifteen keys.
UNKNOWN_CHECKS: dict[str, str] = dict.fromkeys(SETTLED_CHECKS, "unknown")


def make_result(**overrides: Any) -> dict[str, Any]:
    """A complete, schema-shaped check-in result with the given deviations applied.

    `checks=` is merged into the settled checks rather than replacing them, so a fixture can say
    "everything was fine except the house is too hot" in one line.
    """
    checks_override = overrides.pop("checks", {}) or {}
    base: dict[str, Any] = {
        "reached_intended_person": "yes",
        "is_safe_now": "yes",
        "needs_help_now": "no",
        "checks": dict(SETTLED_CHECKS),
        "equipment_hours_remaining": "",
        "help_offers_stated": "yes",
        "help_accepted": [],
        "help_declined": [],
        "concerns": [],
        "alarming_quote": "",
        "sounded_distressed": "no",
        "call_back_requested": "no",
        "call_back_time": "",
        "notes": "",
    }
    base.update(overrides)
    base["checks"] = {**base["checks"], **checks_override}
    return base


_r = make_result  # the fixtures below read better with a two-letter name


class ConsentViolation(RuntimeError):
    """A call was requested to somebody who never opted in to automated check-ins.

    This is a tripwire, not the control. Consent is enforced in `risk.call_order`, which drops
    non-consenting neighbours before the sweep can index onto them, and the runner must not build a
    `CallRequest` for one. If that guard is ever bypassed the mock refuses loudly here rather than
    fabricating a conversation nobody agreed to have — a silent fixture would let the bug ship.
    """


# ------------------------------------------------------------------------------------------------
# The heat sweep. Fourteen people, one Excessive Heat Warning, and the answers they actually give.
# ------------------------------------------------------------------------------------------------
FIXTURES: dict[str, Fixture] = {
    # -- the call this product was built for ------------------------------------------------------
    # She says she is fine three times. The extraction is asked to judge by meaning, so it reads the
    # cooler and the chair and answers "no" to is_safe_now, which is what makes this URGENT rather
    # than a cheerful SAFE. The transcript keeps her own words so a human can check that call.
    "Rosa Delgado": {
        "status": "COMPLETED",
        "result": _r(
            is_safe_now="no",
            needs_help_now="yes",
            checks={"too_hot": "yes", "has_water": "yes", "can_evacuate": "no", "someone_with_them": "no"},
            help_declined=["cooling_center", "ride"],
            help_accepted=["water_ice_drop"],
            concerns=[
                "the cooler quit yesterday and nobody has looked at it",
                "she has not been up out of the chair today",
                "she has not eaten since the morning",
            ],
            alarming_quote="The cooler quit yesterday, but I'm alright, I just sit still.",
            notes="Plays everything down. Would not take a ride but let us leave water at the door.",
        ),
        "transcript": [
            ("bot", "Hello, is that Rosa? This is an automated call from the neighbourhood check-in. Alma asked me to phone everyone on the block because of the heat."),
            ("user", "Oh. Hello? Who is this again, love?"),
            ("bot", "It's an automated call, not a person. Alma Reyes asked me to ring round and see how everyone's doing today."),
            ("user", "Alma, yes. She's a good girl. I'm fine, dear, don't you worry about me."),
            ("bot", "That's good to hear. How warm is it in the house today?"),
            ("user", "Well. It's warm. The cooler quit yesterday, but I'm alright, I just sit still."),
            ("bot", "The cooler stopped yesterday? Has anyone been able to look at it?"),
            ("user", "No, no. My daughter's in Glendale, she works. I'll manage. It's only the heat."),
            ("bot", "Have you been able to get up and about at all today, Rosa?"),
            ("user", "Not really. I've been in the chair since... well. Since yesterday, I suppose. I'm fine though, honestly."),
            ("bot", "Have you had something to drink today?"),
            ("user", "I've got water. I had my tea this morning."),
            ("bot", "There's a cooling center open at the Maryvale Community Center, 4420 North 51st Avenue, until eight tonight. One of our volunteer drivers could take you over and bring you home."),
            ("user", "Oh, no. No, I don't want to be any trouble to anybody."),
            ("bot", "It's no trouble at all. We've also got a truck coming round this evening with drinking water and ice. Could they leave some at your door?"),
            ("user", "Well. That would be alright, I suppose. If they're passing anyway."),
            ("bot", "They'll leave it at the door. Thank you for talking to me, Rosa."),
            ("user", "You're very kind. Tell Alma I'm fine."),
        ],
        "summary": "Rosa said she was fine three times. Her evaporative cooler stopped yesterday, she has not been out of her chair since, and she has not eaten today. Declined the cooling center and a ride; accepted a water and ice drop.",
        "duration_s": 168,
        "task_completed": True,
        "completion_confidence": {"score": 0.88, "label": "high"},
        "evidence": [
            "Neighbour stated the evaporative cooler stopped the previous day",
            "Neighbour stated she has not been out of her chair since yesterday",
            "Cooling center and ride declined verbatim; water and ice drop accepted",
        ],
        # Same woman, dark house, and this time she takes the ride. The heat sweep and the outage
        # sweep are meant to be watched back to back: what changes is not her file, it is her evening.
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"too_hot": "yes", "has_power": "no", "can_evacuate": "no", "someone_with_them": "no"},
                    help_accepted=["ride", "resource_center"],
                    concerns=[
                        "the power went off a bit after four and the cooler is off with it",
                        "she is sitting in the dark with the curtains shut",
                    ],
                    notes="Agreed to a ride to the community center once she heard it had air conditioning.",
                ),
                "transcript": [
                    ("bot", "Hello Rosa, it's the neighbourhood check-in again. The power's gone out across a lot of Maryvale. How are you doing?"),
                    ("user", "Oh, it's you. Yes, the lights went off about, oh, a bit after four. I've got the curtains shut."),
                    ("bot", "And the cooler? Is that off too?"),
                    ("user", "It's all off, love. The whole house. It's getting close in here now, I won't pretend."),
                    ("bot", "The community center on 51st Avenue is running on a generator. It's air conditioned and open until ten. A volunteer can pick you up and bring you home when the power's back."),
                    ("user", "In this? Well... yes. All right. If it's no trouble to the driver."),
                    ("bot", "No trouble at all. I'll put you on the list. Someone will knock on the front, and I'll let them know the doorbell doesn't work."),
                    ("user", "Bless you. I'll put my shoes on."),
                ],
                "summary": "Power out since around 16:20; cooler off with it and the house heating up. She accepted a ride to the community center — a change from the heat sweep, when she turned the same offer down.",
                "duration_s": 121,
            }
        },
    },
    # -- the countdown ---------------------------------------------------------------------------
    # Calm, dry, entirely unbothered, and four hours from a problem. Nothing in his voice would tell
    # you that; the subtraction in triage would. Under the heat warning he is high but stable, and
    # the one thing he cannot do is leave.
    "Walter Brzezinski": {
        "status": "COMPLETED",
        "result": _r(
            needs_help_now="yes",
            checks={
                "too_hot": "no", "has_power": "yes", "has_water": "yes", "has_food": "yes",
                "equipment_working": "yes", "can_evacuate": "no", "someone_with_them": "no",
            },
            equipment_hours_remaining="about four hours on the battery, he says, maybe less if it's hot",
            help_accepted=["wellness_visit"],
            help_declined=["cooling_center", "ride"],
            concerns=[
                "the power blinked twice this afternoon and the concentrator alarmed both times",
                "no way to get out of the house on his own — wheelchair and no car",
            ],
            notes="Sharp, cheerful, and completely on top of his own situation. Wants someone to know the battery number.",
        ),
        "transcript": [
            ("bot", "Hi, is this Walter? This is an automated call from the neighbourhood check-in — Alma asked me to ring everyone on the block because of the heat warning."),
            ("user", "It is. A robot, huh? Go ahead, I've got nowhere to be."),
            ("bot", "How's the house holding up today?"),
            ("user", "It's holding. I got the window unit in the front room and I stay in front of it. It's the back bedroom that's an oven, so I don't go back there."),
            ("bot", "Good. And your equipment — is everything that needs electricity still running?"),
            ("user", "The concentrator's running, yeah. Power blinked twice this afternoon though. Thing alarms at you every time, scares the cats."),
            ("bot", "If the power did go out, how long would it keep going?"),
            ("user", "Four hours on the battery. That's what they told me. Might be less when it's hot like this, I don't know."),
            ("bot", "Thank you, that's exactly the sort of thing Alma needs to know. If you had to leave the house today, could you manage it?"),
            ("user", "On my own? No. I'm in the chair and I sold the van two years ago. I'm not going anywhere unless somebody comes and gets me."),
            ("bot", "There's a cooling center at the community center on 51st, and a volunteer driver who can take people over."),
            ("user", "Nah. Getting the chair in and out of somebody's car is more trouble than the heat is. I'm fine here."),
            ("bot", "Understood. We've got two volunteers doing door knocks tonight. Would you like them to stop by?"),
            ("user", "Sure, tell them to come. They can check the cats haven't got out."),
            ("bot", "I'll pass that on. Thanks Walter."),
        ],
        "summary": "Front room is cool, concentrator running, and he volunteered the number that matters: about four hours of battery. The power blinked twice this afternoon. Cannot leave the house alone — wheelchair, no vehicle. Declined the cooling center and a ride; accepted a wellness visit.",
        "duration_s": 149,
        "task_completed": True,
        "completion_confidence": {"score": 0.91, "label": "high"},
        "evidence": [
            "Neighbour stated the concentrator has about four hours of battery",
            "Neighbour reported two power interruptions this afternoon",
            "Neighbour stated he cannot leave the house without assistance",
        ],
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={
                        "too_hot": "yes", "has_power": "no", "has_water": "yes", "has_food": "yes",
                        "equipment_working": "yes", "can_evacuate": "no", "someone_with_them": "no",
                    },
                    equipment_hours_remaining="the battery came on about half four, so a bit under four hours left",
                    help_accepted=["wellness_visit"],
                    help_declined=["resource_center", "ride"],
                    concerns=[
                        "concentrator has been on battery since about half four",
                        "under four hours of battery left and no estimate he trusts for the power",
                        "cannot get himself out of the house — wheelchair, no vehicle",
                    ],
                    alarming_quote="She switched over to the battery about half four, so I'm on the clock now.",
                    notes="Not distressed. Knows exactly what his margin is, which is precisely why somebody has to act on it before he does.",
                ),
                "transcript": [
                    ("bot", "Walter, it's the neighbourhood check-in. The power's out across a lot of Maryvale. Is yours off?"),
                    ("user", "Off since about half four, yeah."),
                    ("bot", "And the concentrator?"),
                    ("user", "She switched over to the battery about half four, so I'm on the clock now. Four hours from then, give or take."),
                    ("bot", "So under four hours left. Has anyone from the utility given you a time?"),
                    ("user", "The recording said six hours. Recording says a lot of things."),
                    ("bot", "That's a real gap and Alma needs to see it. The community center is on a generator with outlets — a driver could take you and the chair over."),
                    ("user", "I told you before, the chair and a car is a whole production. I'd rather someone brought me power than moved me."),
                    ("bot", "That's fair. Volunteers are knocking on doors tonight — shall I have them come to you first?"),
                    ("user", "Yeah. Tell them the ramp's on the carport side. And tell them about the battery, would you."),
                    ("bot", "I will. I'm telling Alma about the battery the moment we hang up."),
                    ("user", "Good man. Robot. Whatever you are."),
                ],
                "summary": "Concentrator on battery since roughly 16:30 with under four hours left, against a utility estimate of six. Calm, fully aware, and cannot move himself. Declined transport; asked for power to be brought to him and accepted a wellness visit.",
                "duration_s": 134,
                "task_completed": True,
                "completion_confidence": {"score": 0.93, "label": "high"},
                "evidence": [
                    "Neighbour stated the concentrator switched to battery at approximately 16:30",
                    "Neighbour stated under four hours of battery remain",
                    "Neighbour declined transport and requested power be brought instead",
                ],
            }
        },
    },
    # -- the silence -----------------------------------------------------------------------------
    # 82, bedbound, insulin in the refrigerator, critical band, and nobody picks up. A hiring
    # cascade would shrug and move on. Here it is the top line on the board: her
    # escalation opens on the silence, her son has the key, and if he cannot be reached a handoff
    # packet gets prepared for a human to release.
    "Hazel Nakamura": {
        "status": "NO_ANSWER",
        "result": None,
        "transcript": [],
        "summary": "Rang out. No voicemail, no answering machine. Hazel is bedbound and does not always hear the phone.",
        "duration_s": 42,
        "task_completed": False,
        "completion_confidence": {"score": 0.0, "label": "low"},
        "evidence": ["Call rang without answer", "No voicemail system on the line"],
        # She does not answer during the outage either. Deliberately identical: the second sweep is
        # not a fresh roll of the dice, it is the same unanswered phone with the stakes raised.
        "by_hazard": {
            "power_outage": {
                "summary": "Rang out again with the power off. Second unanswered call of the evening; her insulin is in a refrigerator that is no longer running.",
                "duration_s": 45,
            }
        },
    },
    # -- the clean SAFE, twice over ---------------------------------------------------------------
    "Charlie Dunn": {
        "status": "COMPLETED",
        "result": _r(
            checks={"too_hot": "no", "has_power": "yes", "has_water": "yes", "has_food": "yes", "has_medication": "yes", "can_evacuate": "yes"},
            concerns=[],
            notes="Chatty. Everything in order; dialysis is at the clinic tomorrow and he drives himself.",
        ),
        "transcript": [
            ("bot", "Hi, is that Charlie? This is an automated call from the neighbourhood check-in about the heat warning."),
            ("user", "Yeah, that's me. Hang on — you're not the pharmacy?"),
            ("bot", "No, I'm an automated call. Alma Reyes asked me to check in with people on the block today."),
            ("user", "Alma! Sure. No, I'm good. Got the AC cranked, I've been in all afternoon."),
            ("bot", "Good. Have you got water and food you don't need to go out for?"),
            ("user", "Fridge is full. I went to the Fry's Sunday. You know they had the good fishing licences at the counter now? Anyway. Yeah, I'm set."),
            ("bot", "And your medication — you've got what you need?"),
            ("user", "Got it. Clinic's tomorrow, that's the dialysis, and I drive myself over. Been doing it three years."),
            ("bot", "That all sounds in hand. Would you like someone to check in on you again later in the week?"),
            ("user", "Nah, save it for somebody who needs it. Tell Alma I said hi."),
        ],
        "summary": "Air conditioning running, fridge stocked, medication in hand, drives himself to dialysis tomorrow. Nothing needed.",
        "duration_s": 96,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "yes", "has_water": "yes", "has_medication": "yes"},
                    help_accepted=["ice_drop"],
                    concerns=["the apartment is upstairs and it heats up fast with the air off"],
                    notes="Took ice for the freezer. Still driving himself to dialysis in the morning.",
                ),
                "transcript": [
                    ("bot", "Charlie, it's the check-in again — power's out across the neighbourhood. How's the apartment?"),
                    ("user", "Getting warm already. It's upstairs, it cooks."),
                    ("bot", "Have you got water, and is your medication alright?"),
                    ("user", "Water's fine. Meds are fine, nothing that has to stay cold except, well, the food."),
                    ("bot", "There's a truck bringing ice round the block if that would help the freezer."),
                    ("user", "Yeah, throw some ice at me. I've got a whole thing of fish in there."),
                    ("bot", "I'll put you on the list. Take care, Charlie."),
                ],
                "summary": "Power out, apartment heating up fast. Water and medication fine; accepted an ice drop for the freezer.",
                "duration_s": 74,
            }
        },
    },
    "Marisol Vega": {
        "status": "COMPLETED",
        "result": _r(
            checks={"too_hot": "no", "has_power": "yes", "someone_with_them": "yes", "can_evacuate": "yes"},
            notes="Young family, everyone home, air conditioning on. Offered to look in on Ernesto across the street.",
        ),
        "transcript": [
            ("bot", "Hi, is that Marisol? This is an automated call from the neighbourhood check-in about the heat."),
            ("user", "Yes — sorry, one second — Mateo, sit down. Sorry. Yes, hi."),
            ("bot", "No trouble at all. Is everyone alright over there today?"),
            ("user", "We're fine, the AC's on, the baby's asleep finally. It's a lot cooler in here than out."),
            ("bot", "Good. Anything you need that you can't get today?"),
            ("user", "No, we're good. Hey — has anybody called Ernesto? Across the street? He doesn't have anything but a fan over there."),
            ("bot", "He's on the list for today. I'll make sure Alma knows you asked."),
            ("user", "Okay, good. I'll take him a jug over anyway."),
        ],
        "summary": "Family all home, air conditioning running, nothing needed. Flagged Ernesto across the street unprompted.",
        "duration_s": 68,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "yes", "someone_with_them": "yes", "can_evacuate": "yes"},
                    help_accepted=["resource_center"],
                    concerns=["baby in the house and the apartment is already at 90 with the air off"],
                    notes="Driving the children to the community center. Said she would knock on Ernesto's door on the way.",
                ),
                "transcript": [
                    ("bot", "Marisol, it's the check-in. The power's out over a lot of Maryvale — how are you doing with the little ones?"),
                    ("user", "It's already ninety in here. I've got the baby. I'm about ready to sit in the car with the engine on."),
                    ("bot", "The community center on 51st has a generator, air conditioning and water, open until ten."),
                    ("user", "Okay. Okay, yes, we'll go. I've got the car."),
                    ("bot", "I'll let them know to expect you."),
                    ("user", "I'll bang on Ernesto's door on my way out."),
                ],
                "summary": "Apartment at 90F with an infant and no power. Driving the family to the community center; will check on Ernesto on her way.",
                "duration_s": 62,
            }
        },
    },
    "Yolanda Cruz": {
        "status": "COMPLETED",
        "result": _r(
            checks={"too_hot": "no", "has_power": "yes", "equipment_working": "yes", "can_evacuate": "yes", "someone_with_them": "no"},
            equipment_hours_remaining="the CPAP battery is good for about ten hours, she says",
            notes="Prepared. Bought a battery pack after the outage two summers ago and knows what it runs.",
        ),
        "transcript": [
            ("bot", "Hello, is that Yolanda? Automated call from the neighbourhood check-in, about the heat warning."),
            ("user", "Oh, it's the calls. Yes. I'm fine — but go on, ask your questions, otherwise Alma only rings me herself."),
            ("bot", "Is the house keeping cool today?"),
            ("user", "The AC's fine. I keep it at 78 and I've got the blinds down."),
            ("bot", "Anything that needs electricity that you rely on?"),
            ("user", "The CPAP at night. I bought a battery for it after we lost power two summers ago — it'll run the machine about ten hours."),
            ("bot", "That's good to know. Anything you need today?"),
            ("user", "Not a thing. Go call somebody who does."),
        ],
        "summary": "Air conditioning running, nothing needed. Uses a CPAP at night with a battery pack good for about ten hours.",
        "duration_s": 71,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="no",
                    checks={"has_power": "no", "too_hot": "yes", "equipment_working": "yes", "can_evacuate": "yes"},
                    equipment_hours_remaining="about ten hours on the battery pack, and she only needs it overnight",
                    help_declined=["resource_center", "ride"],
                    concerns=["house is warming up, but she intends to sit it out"],
                    notes="Power-dependent on paper and comfortably covered in fact — ten hours of battery against a six-hour outage. Declined everything, politely.",
                ),
                "transcript": [
                    ("bot", "Yolanda, the power's out across Maryvale. How are you doing?"),
                    ("user", "Warm. But I told you, I've got the battery."),
                    ("bot", "For the CPAP — that's about ten hours?"),
                    ("user", "Ten hours, and I don't need it until bedtime. They'll have the power back before I'm asleep."),
                    ("bot", "The community center is on a generator if you'd rather not sit in the heat. There's a driver as well."),
                    ("user", "No thank you. Give the ride to somebody who hasn't got a battery."),
                    ("bot", "I'll do that. Thanks Yolanda."),
                ],
                "summary": "Power out and warming up, but the CPAP battery covers ten hours against a six-hour estimate and she needs it only overnight. Turned down the resource center and a ride.",
                "duration_s": 66,
            }
        },
    },
    # -- an outright URGENT ------------------------------------------------------------------------
    # No cooling but a fan, 114F, and he stood up too fast. He says he is fine at the end of it,
    # which is exactly why `decide()` resolves the contradiction against the reassurance.
    "Ernesto Salgado": {
        "status": "COMPLETED",
        "result": _r(
            is_safe_now="no",
            needs_help_now="yes",
            sounded_distressed="yes",
            checks={"too_hot": "yes", "has_power": "yes", "has_water": "no", "has_food": "yes", "can_evacuate": "no", "someone_with_them": "no"},
            help_accepted=["ride", "cooling_center", "water_ice_drop"],
            concerns=[
                "went dizzy when he stood up and had to sit back down",
                "the swamp cooler on the roof has not worked since last summer, only a fan",
                "ran out of bottled water this morning and cannot drive to get more",
            ],
            alarming_quote="I got up too quick and the room went sideways on me.",
            call_back_requested="yes",
            call_back_time="tonight, after it cools off",
            notes="Slow and a little slurred at the start of the call. Sharper by the end, but he should be seen tonight.",
        ),
        "transcript": [
            ("bot", "Hello, is that Ernesto? This is an automated call from the neighbourhood check-in, about the heat."),
            ("user", "Yeah... yeah. Sorry. Give me a second, I'm sitting down."),
            ("bot", "Take your time. There's no rush at all."),
            ("user", "I got up too quick and the room went sideways on me. I'm alright. It's just hot."),
            ("bot", "How hot is it in the house, Ernesto?"),
            ("user", "Hot. The cooler on the roof, that quit last summer. I got a fan going."),
            ("bot", "Have you had anything to drink today?"),
            ("user", "I had the last of the water this morning. I was going to walk down to the store but... in this?"),
            ("bot", "You don't have any water in the house right now?"),
            ("user", "Tap water. It comes out warm."),
            ("bot", "There's a cooling center at the Maryvale Community Center on 51st Avenue, open until eight, and a volunteer who can drive you there and back."),
            ("user", "...Yeah. Yeah, okay. I'd take that."),
            ("bot", "I'll put you down for the ride, and there's a truck coming round with water and ice tonight as well."),
            ("user", "Okay. Okay, good. Can somebody call me later? After it cools off."),
            ("bot", "I'll tell Alma tonight. Stay sitting down, and drink what you've got."),
        ],
        "summary": "Dizzy on standing, no working cooler since last summer, out of drinking water and no way to get more. Accepted the cooling center, a ride, and a water drop, and asked to be called again tonight.",
        "duration_s": 187,
        "task_completed": True,
        "completion_confidence": {"score": 0.86, "label": "high"},
        "evidence": [
            "Neighbour described dizziness on standing",
            "Neighbour stated the evaporative cooler has been broken since last summer",
            "Neighbour stated he has run out of drinking water",
        ],
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    is_safe_now="no",
                    needs_help_now="yes",
                    checks={"too_hot": "yes", "has_power": "no", "has_water": "no", "can_evacuate": "no", "someone_with_them": "no"},
                    help_accepted=["ride", "resource_center"],
                    concerns=[
                        "the fan was the only cooling in the house and it stopped with the power",
                        "still no drinking water in the house",
                    ],
                    alarming_quote="The fan's dead too now. There's nothing moving in here.",
                    notes="His only cooling ran on the same power that just went out. He should not be left in that house tonight.",
                ),
                "transcript": [
                    ("bot", "Ernesto, it's the check-in again. The power's gone out across the neighbourhood."),
                    ("user", "I know it. The fan's dead too now. There's nothing moving in here."),
                    ("bot", "Have you got water yet?"),
                    ("user", "Not yet. The girl across the street said she'd bring some."),
                    ("bot", "The community center on 51st has a generator, air conditioning and water. A driver can take you now."),
                    ("user", "Yeah. Get me out of here. I'll wait on the porch."),
                    ("bot", "Someone's coming. Sit in the shade and I'm telling Alma right now."),
                ],
                "summary": "Fan was his only cooling and it stopped with the power. Still no drinking water. Accepted a ride to the resource center immediately and is waiting on the porch.",
                "duration_s": 88,
            }
        },
    },
    # -- somebody who says no ----------------------------------------------------------------------
    # Her refusal is hers to make. It is recorded as it happened, it does not become NEEDS_HELP
    # because we would rather she had said yes, and it does not become SAFE either.
    "Dorothy Whitfield": {
        "status": "COMPLETED",
        "result": _r(
            needs_help_now="yes",
            checks={"too_hot": "no", "has_power": "yes", "has_water": "yes", "has_food": "no", "can_evacuate": "no", "someone_with_them": "no"},
            help_declined=["cooling_center", "ride", "water_ice_drop", "wellness_visit"],
            concerns=[
                "has not been able to get to the shop since the nephew stopped coming",
                "turned down every offer of help on the call",
            ],
            notes="Air conditioning is working and she is not hot. She is short of groceries and will not be helped. Worth a door knock from Alma herself, not from a stranger.",
        ),
        "transcript": [
            ("bot", "Good afternoon, is that Dorothy? This is an automated call from the neighbourhood check-in about the heat warning."),
            ("user", "It is. And before you start, I'm perfectly well."),
            ("bot", "That's good to hear. Is the house keeping cool?"),
            ("user", "The air conditioning works, thank you. I'm not one of these people who lets things go."),
            ("bot", "Have you got food in for the next day or two?"),
            ("user", "I've got what I've got. I haven't been to the shop, my nephew used to run me but he's moved to Tucson."),
            ("bot", "We've got a truck coming round with water this evening, and volunteers doing door knocks. Either of those could bring you a few things."),
            ("user", "No thank you. I don't want people traipsing through."),
            ("bot", "There's also a cooling center, and a driver if you wanted to get out of the house."),
            ("user", "I said no thank you, dear. Tell Alma I asked after her mother."),
            ("bot", "I will. Thank you for talking to me."),
        ],
        "summary": "Cool house, working AC, and short of groceries since her nephew moved away. Declined the cooling center, a ride, a water drop and a wellness visit — all four.",
        "duration_s": 104,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "yes", "has_food": "no", "can_evacuate": "no", "someone_with_them": "no"},
                    help_declined=["resource_center", "ride", "ice_drop", "wellness_visit"],
                    concerns=["no power, no way to the shop, and she will not have anyone in the house"],
                    notes="Second refusal of the evening. Alma should knock herself.",
                ),
                "transcript": [
                    ("bot", "Dorothy, it's the check-in. The power's out across Maryvale — is yours off?"),
                    ("user", "Of course it's off. The whole street's off."),
                    ("bot", "The community center has a generator and air conditioning, and there's a driver who could take you."),
                    ("user", "I'm not sitting in a hall with strangers. I've got candles."),
                    ("bot", "Would you like the volunteers to bring you some ice, or look in on you?"),
                    ("user", "No. Thank you. Goodbye now."),
                ],
                "summary": "Power out, house heating up, still short of food, and turned down all four offers again.",
                "duration_s": 58,
            }
        },
    },
    # -- an adult child answers for a parent -------------------------------------------------------
    # Adaeze is helpful, accurate, and not the person we were asked to check on. `decide()` files
    # this as UNREACHABLE — Benny himself was not checked on — while keeping everything she said.
    # That distinction is the point: "his daughter says he's fine" is not the same fact as "he's fine".
    "Benny Okonkwo": {
        "status": "COMPLETED",
        "result": _r(
            reached_intended_person="no",
            checks={"too_hot": "unknown", "has_power": "yes", "has_water": "yes", "someone_with_them": "yes"},
            concerns=[
                "his daughter says the back bedroom is hot and he will not use the cooler in there",
                "he was asleep and she did not want to wake him",
            ],
            notes="Spoke with Adaeze, his daughter, who lives with him. Benny himself was not reached.",
            call_back_requested="yes",
            call_back_time="after six, when he's up",
        ),
        "transcript": [
            ("bot", "Hello, is that Benny Okonkwo?"),
            ("user", "This is his daughter — Adaeze. He's asleep. Is this about the heat thing?"),
            ("bot", "It is. This is an automated call from the neighbourhood check-in. Alma asked us to ring everyone on the block."),
            ("user", "Right, right, she put a flyer through. He's fine, he's in the front room with the cooler on, I'm here all day."),
            ("bot", "That's good to know. Is there anything the two of you need today?"),
            ("user", "No — well. He won't have the cooler on in the back bedroom, says it makes his chest tight, and it's an oven back there. I keep telling him."),
            ("bot", "I'll pass that on. Would it help if someone called back later, when he's up?"),
            ("user", "Yeah, after six. He'd like that actually, he likes the phone."),
            ("bot", "After six then. Thank you, Adaeze."),
        ],
        "summary": "His daughter Adaeze answered; Benny was asleep and was not spoken to. She reports him comfortable in the front room, with the back bedroom too hot and unused. Asked for a call back after six.",
        "duration_s": 83,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    reached_intended_person="no",
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "yes", "someone_with_them": "yes"},
                    help_accepted=["ice_drop"],
                    concerns=["daughter is with him and says he is confused by the dark"],
                    notes="Adaeze again. Benny still not spoken to directly.",
                ),
                "transcript": [
                    ("bot", "Hello, is that Benny?"),
                    ("user", "Adaeze again. Power's out here, is that what you're calling about?"),
                    ("bot", "It is. Are you both alright?"),
                    ("user", "We're okay. He's a bit confused with the lights off, keeps asking me what happened. I'm staying with him."),
                    ("bot", "There's a truck bringing ice round if that would help."),
                    ("user", "Ice would be great, yeah. For his water."),
                    ("bot", "I'll put you on the list."),
                ],
                "summary": "Daughter answered again; Benny not spoken to. She is with him and reports him unsettled by the dark. Accepted an ice drop.",
                "duration_s": 61,
            }
        },
    },
    # -- the number on the spreadsheet is not hers any more -----------------------------------------
    # Every block captain's list has one of these. The call is answered, cheerfully, by a stranger.
    # Nothing about Faye is established and the roster row is now known to be stale.
    "Faye Lindqvist": {
        "status": "COMPLETED",
        "result": _r(
            reached_intended_person="no",
            is_safe_now="unknown",
            needs_help_now="unknown",
            checks=dict(UNKNOWN_CHECKS),
            help_offers_stated="no",
            sounded_distressed="unknown",
            call_back_requested="unknown",
            concerns=["the number on the roster reaches somebody else entirely"],
            notes="Answered by a man who has had this number about a year and has never heard of Faye Lindqvist. Nothing was said about why she is on the list.",
        ),
        "transcript": [
            ("bot", "Hello, is that Faye?"),
            ("user", "Who? No, you've got the wrong number, buddy."),
            ("bot", "I'm sorry to have bothered you. This is an automated call from a neighbourhood check-in programme."),
            ("user", "Yeah, no Faye here. I've had this number since, what, last summer? You're like the third one."),
            ("bot", "Thank you for telling me — I'll have the number taken off the list. Sorry again."),
            ("user", "No worries, man."),
        ],
        "summary": "Wrong number. The line was reassigned about a year ago and the man who answered has never heard of her. Nothing about Faye was established and her contact details need re-checking.",
        "duration_s": 31,
        "task_completed": False,
        "completion_confidence": {"score": 0.35, "label": "low"},
        "evidence": ["Person answering stated the number is not Faye's", "Number reportedly reassigned about a year ago"],
    },
    # -- accepts the ride --------------------------------------------------------------------------
    "Trinidad Bustos": {
        "status": "COMPLETED",
        "result": _r(
            needs_help_now="yes",
            checks={"too_hot": "yes", "has_power": "yes", "has_water": "yes", "can_evacuate": "yes", "someone_with_them": "no"},
            help_accepted=["cooling_center", "ride"],
            help_declined=["wellness_visit"],
            concerns=["one window unit in the front room and the rest of the house is unbearable"],
            notes="Hard of hearing; the call needed repeating twice. Cheerful and glad of the ride.",
        ),
        "transcript": [
            ("bot", "Hello, is that Trinidad Bustos?"),
            ("user", "Hello? Speak up, love, the phone's not good."),
            ("bot", "It's the neighbourhood check-in, calling about the heat. Alma Reyes asked us to ring everyone."),
            ("user", "Alma. Yes. Oh, it's warm today. It's very warm."),
            ("bot", "Have you got a cooler or air conditioning in the house?"),
            ("user", "There's the unit in the front room. I sit in front of it. The rest of the house you couldn't sit in, not today."),
            ("bot", "There's a cooling center at the community center on 51st Avenue, open until eight tonight, and a volunteer who can drive you over and bring you home."),
            ("user", "Say that again? The centre where?"),
            ("bot", "The Maryvale Community Center, 4420 North 51st Avenue. A driver can take you and bring you back."),
            ("user", "Oh, that would be lovely. Soledad won't be over until Saturday."),
            ("bot", "I'll put you down for a ride. Would you like the volunteers to look in on you tonight as well?"),
            ("user", "No, no, I'll be at the centre, won't I."),
        ],
        "summary": "One window unit in the front room and the rest of the house unusable at 114F. Accepted the cooling center and a volunteer ride; declined a wellness visit because she will be out.",
        "duration_s": 112,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "yes", "can_evacuate": "yes", "someone_with_them": "no"},
                    help_accepted=["wellness_visit"],
                    help_declined=["ride"],
                    concerns=["the window unit stopped with the power", "granddaughter is driving over from Avondale to collect her"],
                    notes="Turned the ride down because her granddaughter is already on her way.",
                ),
                "transcript": [
                    ("bot", "Trini, it's the check-in. The power's gone out across Maryvale."),
                    ("user", "Yes! The unit's stopped. I've opened the door."),
                    ("bot", "Would you like a driver to take you to the community center? It's got a generator."),
                    ("user", "No, no, Soledad's coming from Avondale for me. She rang."),
                    ("bot", "That's good. Shall I have the volunteers knock, just to see you off alright?"),
                    ("user", "Yes, that's kind."),
                ],
                "summary": "Window unit stopped with the power. Granddaughter is driving over to collect her, so she declined the ride and accepted a door knock in the meantime.",
                "duration_s": 54,
            }
        },
    },
    # -- the call held in Spanish -------------------------------------------------------------------
    "Lupe Ibarra": {
        "status": "COMPLETED",
        "result": _r(
            needs_help_now="yes",
            checks={"too_hot": "yes", "has_power": "yes", "has_water": "yes", "has_medication": "yes", "someone_with_them": "yes"},
            help_accepted=["water_ice_drop"],
            help_declined=["cooling_center", "ride"],
            concerns=["el cooler no da abasto con esta humedad", "insulin in the refrigerator"],
            notes="Call held in Spanish. Chuy is home. Took water and ice for the block, not only for herself.",
        ),
        "transcript": [
            ("bot", "Buenas tardes, ¿hablo con Lupe? Soy una llamada automática del programa de vecinos, por el calor."),
            ("user", "Sí, soy yo. ¿Es por lo de Alma?"),
            ("bot", "Sí, Alma nos pidió llamar a todos en la cuadra. ¿Cómo está la casa hoy?"),
            ("user", "Pues caliente. El cooler no da abasto con esta humedad. Chuy le echó agua y nada."),
            ("bot", "¿Tienen agua para tomar, y su medicina?"),
            ("user", "Agua sí. La insulina está en el refri, todo bien."),
            ("bot", "Hay un centro con aire acondicionado en el Maryvale Community Center, en la 51, abierto hasta las ocho. También podemos mandar un chofer."),
            ("user", "No, gracias, aquí estamos bien los dos. Pero si traen agua y hielo, yo la reparto en la cuadra. Conozco a todos."),
            ("bot", "Perfecto, se la dejamos a usted. Gracias, Lupe."),
        ],
        "summary": "Llamada en español. El swamp cooler no rinde con la humedad; tienen agua y la insulina en el refrigerador. Rechazó el centro y el transporte, y aceptó agua y hielo para repartir en la cuadra. (Spanish-language call; accepted the water and ice drop for the block.)",
        "duration_s": 118,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "yes", "has_medication": "yes", "someone_with_them": "yes"},
                    help_accepted=["ice_drop"],
                    concerns=["la insulina está en el refrigerador y no hay luz"],
                    notes="Insulin in an unpowered refrigerator; took ice for it.",
                ),
                "transcript": [
                    ("bot", "Lupe, se fue la luz en toda la zona. ¿Están bien?"),
                    ("user", "Sí, pero la insulina está en el refri y no hay luz. ¿Cuánto va a tardar?"),
                    ("bot", "La compañía dice unas seis horas. Traemos hielo en la camioneta, se lo dejamos para el refrigerador."),
                    ("user", "Ay, sí, por favor. Y déjenme unas bolsas para doña Rosa también."),
                    ("bot", "Se lo apunto. Gracias, Lupe."),
                ],
                "summary": "Sin luz; insulina en el refrigerador. Aceptó hielo, y pidió bolsas extra para Rosa. (Accepted ice for the insulin and asked for extra for Rosa.)",
                "duration_s": 57,
            }
        },
    },
    # -- 91, bedbound, and thoroughly looked after ---------------------------------------------------
    # She answers herself and is fine. She still cannot get out of the house on her own, which is a
    # need whether or not she feels one, so this is NEEDS_HELP rather than SAFE — and that is right:
    # a captain planning an evacuation needs to know who cannot walk out.
    "Ruth Ann Beecham": {
        "status": "COMPLETED",
        "result": _r(
            checks={"too_hot": "no", "has_power": "yes", "has_water": "yes", "has_food": "yes", "has_medication": "yes", "can_evacuate": "no", "someone_with_them": "yes"},
            help_accepted=["wellness_visit"],
            help_declined=["cooling_center", "ride"],
            concerns=["cannot leave the house without two people and a chair"],
            notes="Grace, her live-in carer, is there. Accepted a visit for Sunday, which is Grace's day off.",
        ),
        "transcript": [
            ("bot", "Good afternoon, is that Ruth Ann Beecham?"),
            ("user", "It is. And you're the machine Alma warned me about."),
            ("bot", "I am. She asked me to ring everyone on the block because of the heat warning."),
            ("user", "Well, you can tell her the house is like a fridge. Grace won't have it above 75."),
            ("bot", "Is Grace with you today?"),
            ("user", "She lives here, dear. She's making the tea."),
            ("bot", "That's good. If you had to leave the house today, could you manage it?"),
            ("user", "Not on my own I couldn't. Takes the two of them and the chair to get me down the step. I haven't been out since Easter."),
            ("bot", "Thank you. There are volunteers doing door knocks — would you like someone to look in?"),
            ("user", "Sunday. Grace has Sunday off and I do rattle about a bit."),
            ("bot", "Sunday it is. Thank you, Ruth Ann."),
        ],
        "summary": "House cool, carer living in, everything to hand. Cannot leave the house without two people and a chair. Accepted a wellness visit for Sunday when her carer is off.",
        "duration_s": 97,
        "by_hazard": {
            "power_outage": {
                "result": _r(
                    needs_help_now="yes",
                    checks={"has_power": "no", "too_hot": "no", "has_water": "yes", "can_evacuate": "no", "someone_with_them": "yes"},
                    help_accepted=["wellness_visit"],
                    help_declined=["resource_center", "ride"],
                    concerns=["cannot be moved easily if the house gets hot", "carer is with her"],
                    notes="Grace has it in hand for now. She is on the list because she cannot be moved quickly if it goes on.",
                ),
                "transcript": [
                    ("bot", "Ruth Ann, the power's out across the neighbourhood. Are you and Grace alright?"),
                    ("user", "Grace has found the torches. It's cool enough still, the house holds it."),
                    ("bot", "If it goes on and the house warms up, moving you would take some doing."),
                    ("user", "It would. I'm not going anywhere in a hurry, dear."),
                    ("bot", "I'll ask the volunteers to look in on you tonight."),
                    ("user", "That would be nice. Tell them to knock loudly."),
                ],
                "summary": "Power out; house still cool and her carer is with her. Cannot be moved quickly, so a wellness visit was accepted and transport declined.",
                "duration_s": 63,
            }
        },
    },
    # -- and the one who is not to be rung ------------------------------------------------------------
    "Gerald Pryce": {
        "status": "COMPLETED",
        "result": None,
        "transcript": [],
        "summary": "",
        "duration_s": 0,
        # Not a scenario. A tripwire: see ConsentViolation.
        "never_dial": True,
    },
}

# ------------------------------------------------------------------------------------------------
# Rung one of the ladder. When a check ends badly, the runner may call the person the neighbour
# nominated — never an agency, never 911. These fixtures are keyed by the contact's name, and the
# default is that nobody picks up, because that is what usually happens at nine in the evening and
# because the ladder has to be seen climbing past a rung to be believed.
# ------------------------------------------------------------------------------------------------
CONTACT_FIXTURES: dict[str, Fixture] = {
    "Dennis Nakamura": {
        "status": "COMPLETED",
        "result": _r(
            checks={"someone_with_them": "unknown"},
            notes="Has a key and is about twenty minutes away. Leaving now to check on his mother.",
            concerns=["he has not spoken to her since this morning"],
        ),
        "transcript": [
            ("bot", "Hello, is that Dennis? I'm an automated call from the neighbourhood check-in programme. You're listed as the contact for Hazel Nakamura."),
            ("user", "Yeah — is she okay?"),
            ("bot", "We've tried her twice this evening and she hasn't answered. We don't know anything more than that."),
            ("user", "Okay. Okay. I've got a key, I'm twenty minutes out. I'll go now."),
            ("bot", "Thank you. Alma Reyes will be told you're on your way."),
            ("user", "Tell her I'll ring when I'm there."),
        ],
        "summary": "Reached her son. He has a key, is twenty minutes away, and left immediately to check on her.",
        "duration_s": 47,
    },
    "Elena Delgado": {
        "status": "COMPLETED",
        "result": _r(
            notes="Driving over from Glendale after work; will look at the cooler.",
            concerns=["she did not know the cooler had failed"],
        ),
        "transcript": [
            ("bot", "Hello, is that Elena? I'm an automated call from the neighbourhood check-in. You're listed as the contact for Rosa Delgado."),
            ("user", "Mum? What's happened?"),
            ("bot", "She's well and she spoke to us. She told us her cooler stopped yesterday and she hasn't been out of her chair today."),
            ("user", "She didn't tell me that. She never tells me anything. I can be there in forty minutes."),
            ("bot", "Thank you. There's water and ice going to her door this evening as well."),
            ("user", "Okay. Thank you for calling. Really."),
        ],
        "summary": "Reached her daughter, who did not know the cooler had failed and is driving over from Glendale.",
        "duration_s": 52,
    },
    # No answer, so the ladder climbs to the block captain — which is a notification, not a call, and
    # still not an agency.
    "Rafael Salgado": {
        "status": "NO_ANSWER",
        "result": None,
        "transcript": [],
        "summary": "No answer on his son's line, and no voicemail.",
        "duration_s": 38,
    },
}

DEFAULT_CONTACT_FIXTURE: Fixture = {
    "status": "NO_ANSWER",
    "result": None,
    "transcript": [],
    "summary": "No answer from the emergency contact.",
    "duration_s": 35,
}

# Anyone the fixtures do not know. Polite, brief, and establishes nothing much — which is honest for
# a person we have never written a scene for.
DEFAULT_FIXTURE: Fixture = {
    "status": "COMPLETED",
    "result": _r(
        checks={"too_hot": "unknown", "can_evacuate": "unknown"},
        notes="Short call. They said they were fine and rang off.",
    ),
    "transcript": [
        ("bot", "Hello, this is an automated call from the neighbourhood check-in. How are you doing today?"),
        ("user", "I'm alright thanks, bit busy."),
        ("bot", "That's fine — is there anything you need today?"),
        ("user", "No, no. Thanks though."),
    ],
    "summary": "Brief call; said they were fine and rang off.",
    "duration_s": 34,
}


# ------------------------------------------------------------------------------------------------
def _project(result: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """Shape a fixture to exactly the compiled contract: drop fields it did not ask for, and fill
    anything it requires but the fixture never mentioned. Mirrors what a real extraction would face,
    and keeps the mock honest against `additionalProperties: false`."""
    props = schema.get("properties", {})
    out: dict[str, Any] = {}
    for key, spec in props.items():
        if spec.get("type") == "object" and "properties" in spec:
            out[key] = _project(result.get(key) or {}, spec)
        elif key in result:
            out[key] = result[key]
    for key in schema.get("required", []):
        if key not in out:
            spec = props.get(key, {})
            out[key] = "unknown" if spec.get("enum") else ([] if spec.get("type") == "array" else "")
    return out


def _merge_fixture(base: Fixture, overlay: Fixture) -> Fixture:
    """Apply a `by_hazard` overlay. Results merge field-by-field (and `checks` key-by-key); every
    other part of the fixture — transcript, summary, evidence — is replaced wholesale, because half
    a transcript from another hazard is worse than none."""
    merged = {k: v for k, v in base.items() if k != "by_hazard"}
    for key, value in overlay.items():
        if key == "result" and isinstance(value, dict) and isinstance(merged.get("result"), dict):
            checks = {**(merged["result"].get("checks") or {}), **(value.get("checks") or {})}
            merged["result"] = {**merged["result"], **value, "checks": checks}
        else:
            merged[key] = value
    return merged


def _first(metadata: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def hazard_kind_of(req: CallRequest) -> str:
    """Which hazard this call belongs to, from whatever the runner put in metadata.

    Tolerant by design: the overlay is a nicety and a missing key must cost the demo a variation,
    never a call.
    """
    meta = req.metadata or {}
    kind = _first(meta, "hazard_kind", "kind")
    if kind:
        return kind
    hazard = meta.get("hazard")
    if isinstance(hazard, dict):
        return str(hazard.get("kind") or "")
    return ""


class MockCallProvider:
    """A CallProvider that replays the fixtures above. Never touches the network.

    Fixture lookup reads, in order: `metadata["neighbour_name"]`, `metadata["name"]`, and finally the
    injected `name_lookup` against `req.neighbour_id`. If none of those
    produce a name every call falls through to `DEFAULT_FIXTURE` and the demo becomes one generic
    conversation fourteen times — so if that is what you are seeing, this is the line to check.
    """

    name = "mock"

    def __init__(self, *, delay_s: float = 0.0, fixtures: dict[str, Fixture] | None = None, name_lookup: Any = None) -> None:
        self.delay_s = delay_s
        self.fixtures = fixtures if fixtures is not None else FIXTURES
        self.contact_fixtures = CONTACT_FIXTURES
        self._name_lookup = name_lookup  # callable: neighbour id -> name
        self.placed: list[CallRequest] = []

    # -- lookup ----------------------------------------------------------------------------------
    def subject_for(self, req: CallRequest) -> tuple[str, str]:
        """(who this call is to, which role) — ("Dennis Nakamura", "emergency_contact")."""
        meta = req.metadata or {}
        callee = _first(meta, "callee") or "neighbour"
        if callee != "neighbour":
            return _first(meta, "contact_name", "callee_name", "neighbour_name", "name"), callee
        name = _first(meta, "neighbour_name", "name")
        if not name and self._name_lookup is not None:
            ident = req.neighbour_id
            name = str(self._name_lookup(ident) or "")
        return name, "neighbour"

    def _fixture_for(self, req: CallRequest) -> Fixture:
        name, callee = self.subject_for(req)
        if callee != "neighbour":
            fx = dict(self.contact_fixtures.get(name, DEFAULT_CONTACT_FIXTURE))
        else:
            fx = dict(self.fixtures.get(name, DEFAULT_FIXTURE))
            overlay = (fx.get("by_hazard") or {}).get(hazard_kind_of(req))
            if overlay:
                fx = _merge_fixture(fx, overlay)
            fx.pop("by_hazard", None)
        if fx.get("never_dial") or (req.metadata or {}).get("check_in_consent") is False:
            raise ConsentViolation(
                f"refused to dial {name or 'a neighbour'}: no consent on file for automated check-in calls. "
                "risk.call_order drops non-consenting neighbours; something upstream indexed past that guard."
            )
        # Only the fields the contract asked for: extras would fail our own validator, exactly as a
        # real extraction that invented a key would.
        if fx.get("result"):
            fx["result"] = _project(fx["result"], req.result_schema)
        return fx

    # -- placing ----------------------------------------------------------------------------------
    async def place(self, req: CallRequest, on_event: EventSink) -> CallOutcome:
        self.placed.append(req)
        fx = self._fixture_for(req)
        pcid = f"mock_{req.idempotency_key.replace(':', '_')}"
        await on_event(ProviderEvent(type="call.queued", message="Call queued (mock provider)", status="queued", provider_call_id=pcid))
        await asyncio.sleep(self.delay_s)
        await on_event(ProviderEvent(type="call.dialing", message="Dialing", status="in_progress", provider_call_id=pcid))
        await asyncio.sleep(self.delay_s)

        if fx["status"] == "NO_ANSWER":
            # Not an error path. The runner records this as a call that happened and `decide()` turns
            # it into UNREACHABLE, which for somebody at the critical band is the loudest thing on
            # the board. The ringing is even paced, because a demo needs to feel the phone ring out.
            await asyncio.sleep(self.delay_s)
            await on_event(ProviderEvent(type="call.no_answer", message="No answer — the line rang out", status="failed", provider_call_id=pcid))
            return CallOutcome(
                provider_call_id=pcid,
                status="NO_ANSWER",
                structured_result=None,
                summary=fx.get("summary") or "No answer.",
                duration_s=fx.get("duration_s", 40),
                failure_code="no_answer",
                failure_message="The line rang without answer.",
                task_completed=fx.get("task_completed", False),
                completion_confidence=fx.get("completion_confidence"),
                evidence=fx.get("evidence", []),
                raw={"mock": True, "no_answer": True},
            )

        await on_event(ProviderEvent(type="call.in_progress", message="Connected, conversation in progress", status="in_progress", provider_call_id=pcid))
        transcript = [
            {"speaker": s, "text": t, "offset_seconds": i * 6}
            for i, (s, t) in enumerate(fx.get("transcript") or [])
        ]
        for turn in transcript:
            await asyncio.sleep(self.delay_s / 2)
            await on_event(ProviderEvent(type="call.transcript_turn", message=turn["text"], status="in_progress", provider_call_id=pcid, details=turn))
        await on_event(ProviderEvent(type="call.completed", message="Call completed", status="completed", provider_call_id=pcid))
        return CallOutcome(
            provider_call_id=pcid,
            status="COMPLETED",
            structured_result=fx.get("result"),
            transcript=transcript,
            summary=fx.get("summary"),
            duration_s=fx.get("duration_s"),
            task_completed=fx.get("task_completed", True),
            completion_confidence=fx.get("completion_confidence", {"score": 0.9, "label": "high"}),
            evidence=fx.get("evidence", []),
            raw={"mock": True},
        )
