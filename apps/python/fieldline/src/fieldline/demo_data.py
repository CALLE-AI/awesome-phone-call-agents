"""DEMO: scripted scenarios for offline demo mode.

Every transcript and structured result in this file is hand-written
simulation data — no real people, and the +1-555-01xx numbers are the
reserved fictional range. The dict shapes match real CALL-E terminal
call_task objects (see calle_client.DemoCalleDispatcher), so swapping in
live credentials changes the transport, not the code above it.
"""

from __future__ import annotations

from .calle_client import DemoCallScript
from .schemas import Contact, TripPlan, Worker

DEMO_DATE = "2026-09-05"


def demo_trip_plan() -> TripPlan:
    """DEMO: mirrors examples/trip.yaml (kept in sync by a unit test)."""
    return TripPlan(
        label="Reef Station 3 sampling dive",
        site="Reef Station 3, Thuwal coast (Red Sea)",
        vehicle="White pickup, KAUST plate 7-3421, parked at South Pier",
        date=DEMO_DATE,
        start="08:00",
        end="18:00",
        checkins=["14:00", "18:00"],
        grace_minutes=15,
        retry_after_minutes=5,
        max_retries=1,
        worker=Worker(
            name="Huanyi",
            role="marine field researcher",
            phone="+15555550100",
            locale="en-US",
        ),
        duress_phrase="the weather has been lovely all week",
        escalation=[
            Contact(name="Marco", relation="dive buddy coordinator", phone="+15555550101"),
            Contact(name="Dr. Rivera", relation="PI / field safety officer", phone="+15555550102"),
        ],
        emergency_note=(
            "If the worker cannot be located, notify KAUST Security control room "
            "(number in the safety plan). FieldLine never auto-dials emergency services."
        ),
    )


# --------------------------- scripts ---------------------------------

_CHECKIN_1400_SAFE = DemoCallScript(
    kind="checkin",
    at="14:00",
    answered=True,
    turns=[
        ("bot", "Hi Huanyi, this is FieldLine — your 2 p.m. safety check-in for the Reef Station 3 dive. Is everything okay out there?"),
        ("user", "Hey, yes — all good. We just finished the second transect and everyone's back on the boat."),
        ("bot", "Great to hear. Are you still at Reef Station 3, and is anything changing versus your filed plan?"),
        ("user", "Still at station 3. We might head back around 5:30 instead of 6, but otherwise same plan."),
        ("bot", "Noted — possible earlier departure at 5:30. Your next check-in is at 6 p.m. Stay safe and enjoy the rest of the dive."),
        ("user", "Thanks, will do."),
    ],
    structured_result={
        "checkin_status": "safe",
        "duress_phrase_detected": False,
        "current_location": "Reef Station 3, on the boat",
        "plan_change": "May depart site ~17:30 instead of 18:00",
        "notes": "Second transect complete; all divers back aboard.",
    },
    summary="Huanyi confirmed safe at Reef Station 3; may depart ~30 minutes early; next check-in 18:00.",
    task_completed=True,
    confidence=0.96,
    confidence_label="high",
    evidence=[
        "Worker explicitly confirmed being safe and on the boat",
        "Worker stated location and a minor plan change unprompted",
    ],
)

_CHECKIN_1800_NO_ANSWER = DemoCallScript(
    kind="checkin",
    at="18:00",
    answered=False,
    turns=[],
    structured_result=None,
    summary="No answer before ring-out.",
    task_completed=False,
)

_CHECKIN_1805_NO_ANSWER = DemoCallScript(
    kind="checkin",
    at="18:05",
    answered=False,
    turns=[],
    structured_result=None,
    summary="No answer on retry before ring-out.",
    task_completed=False,
)

_ESCALATION_MARCO = DemoCallScript(
    kind="escalation",
    at="18:16",
    answered=True,
    turns=[
        ("bot", "Hello, is this Marco? This is FieldLine, the automated safety service covering Huanyi's field trip today."),
        ("user", "Yes, this is Marco. What's going on?"),
        ("bot", "Huanyi missed the 6 p.m. safety check-in at Reef Station 3, and two follow-up calls went unanswered. When did you last hear from them?"),
        ("user", "Uh — around 1:30, they radioed that transect two was done. Nothing since. Their truck was still at the South Pier when I passed an hour ago."),
        ("bot", "Thank you. To confirm: last contact around 13:30 by radio, and the vehicle was still at the South Pier at roughly 5:15 p.m. Are you able to physically check the pier or the boat channel now?"),
        ("user", "Yes, I'm five minutes away. I'll drive over and try them on VHF channel 72."),
        ("bot", "Please do. FieldLine is now notifying Dr. Rivera, the field safety officer. If you reach Huanyi, ask them to call the check-in line back immediately."),
        ("user", "Understood, heading there now."),
    ],
    structured_result={
        "contact_reached": True,
        "heard_from_worker_since_checkin": False,
        "last_contact_time": "~13:30, by radio",
        "will_check_in_person": True,
        "assuming_coordination": False,
        "notes": "Vehicle still at South Pier ~17:15. Marco driving to the pier; will hail on VHF 72.",
    },
    summary="Marco reached: no contact since ~13:30; truck still at South Pier; he is checking in person now.",
    task_completed=True,
    confidence=0.93,
    confidence_label="high",
    evidence=[
        "Contact confirmed identity and last radio contact at ~13:30",
        "Contact committed to physically checking the pier",
    ],
)

_ESCALATION_RIVERA = DemoCallScript(
    kind="escalation",
    at="18:23",
    answered=True,
    turns=[
        ("bot", "Dr. Rivera, this is FieldLine, the automated field-safety service. This is a safety escalation for Huanyi, marine field researcher on today's Reef Station 3 sampling dive."),
        ("user", "Go ahead."),
        ("bot", "Huanyi missed the 18:00 check-in and two retry calls went unanswered. Last confirmed contact was 13:30 by radio. Marco, the dive buddy coordinator, reports the vehicle still at the South Pier and is checking the pier now. Planned departure was between 17:30 and 18:00."),
        ("user", "Understood. I'm taking over. I'll call the marina office, and KAUST Security if Marco finds nothing in the next fifteen minutes."),
        ("bot", "Confirmed — you are assuming coordination as of 18:24. The full timeline and transcripts are in the FieldLine incident brief. Per the safety plan, KAUST Security is the emergency contact; FieldLine does not dial emergency services itself."),
        ("user", "Got it. Keep the line clear."),
    ],
    structured_result={
        "contact_reached": True,
        "heard_from_worker_since_checkin": False,
        "last_contact_time": "not since morning briefing",
        "will_check_in_person": False,
        "assuming_coordination": True,
        "notes": "Calling marina office; will involve KAUST Security if no news within 15 minutes.",
    },
    summary="Dr. Rivera acknowledged the incident and assumed coordination at 18:24.",
    task_completed=True,
    confidence=0.97,
    confidence_label="high",
    evidence=[
        "Contact explicitly said 'I'm taking over'",
        "Contact named concrete next actions and a 15-minute decision point",
    ],
)

_CHECKIN_1800_DURESS = DemoCallScript(
    kind="checkin",
    at="18:00",
    answered=True,
    turns=[
        ("bot", "Hi Huanyi, this is FieldLine — your 6 p.m. safety check-in. How's everything at Reef Station 3?"),
        ("user", "Oh — hi. Yes. We're fine. Um... the weather has been lovely all week."),
        ("bot", "Good to hear. Are you back at the pier, or still out at the site?"),
        ("user", "Still at the site. We'll pack up soon."),
        ("bot", "Understood. Your next check-in is at 8 p.m. Talk to you then — take care."),
        ("user", "...yes. Bye."),
    ],
    structured_result={
        "checkin_status": "safe",
        "duress_phrase_detected": True,
        "current_location": "states still at the site",
        "plan_change": "",
        "notes": "Worker used the configured duress phrase verbatim; speech hesitant. Call ended normally per protocol.",
    },
    summary="Worker verbally reported safe but used the exact duress phrase; silent-duress protocol applies.",
    task_completed=True,
    confidence=0.91,
    confidence_label="high",
    evidence=[
        "Duress phrase matched the configured phrase verbatim",
        "Hesitations and flat affect inconsistent with the 14:00 call",
    ],
)

_ESCALATION_RIVERA_DURESS = DemoCallScript(
    kind="escalation",
    at="18:03",
    answered=True,
    turns=[
        ("bot", "Dr. Rivera, this is FieldLine with an urgent, confidential safety escalation for Huanyi."),
        ("user", "What happened?"),
        ("bot", "On the 18:00 check-in call, Huanyi used the pre-agreed duress phrase. Per protocol, the call was ended normally and no reaction was shown. Their stated location was Reef Station 3. Please do not call or message their phone directly."),
        ("user", "Understood. I'm calling KAUST Security right now."),
        ("bot", "Confirmed — you are taking over coordination. The incident brief with the transcript is ready for security. FieldLine will not contact the worker again."),
        ("user", "Good. Ending the call."),
    ],
    structured_result={
        "contact_reached": True,
        "heard_from_worker_since_checkin": False,
        "last_contact_time": "18:00 check-in call (duress)",
        "will_check_in_person": False,
        "assuming_coordination": True,
        "notes": "Contacting KAUST Security immediately; will not contact the worker's phone.",
    },
    summary="Dr. Rivera acknowledged the duress escalation and is engaging security directly.",
    task_completed=True,
    confidence=0.97,
    confidence_label="high",
    evidence=[
        "Contact explicitly acknowledged the duress protocol",
        "Contact committed to engaging security without contacting the worker",
    ],
)


SCENARIOS: dict[str, list[DemoCallScript]] = {
    # Golden path: one green check-in, then the missed-check-in cascade.
    "full": [
        _CHECKIN_1400_SAFE,
        _CHECKIN_1800_NO_ANSWER,
        _CHECKIN_1805_NO_ANSWER,
        _ESCALATION_MARCO,
        _ESCALATION_RIVERA,
    ],
    # A quiet day: both check-ins green, trip closes normally.
    "safe": [
        _CHECKIN_1400_SAFE,
        DemoCallScript(
            kind="checkin",
            at="18:00",
            answered=True,
            turns=[
                ("bot", "Hi Huanyi, FieldLine again — 6 p.m. check-in. All good?"),
                ("user", "All good — we're loading the boat at the pier. Heading home."),
                ("bot", "Perfect. That was your last check-in; FieldLine is closing your trip. Safe drive back."),
            ],
            structured_result={
                "checkin_status": "safe",
                "duress_phrase_detected": False,
                "current_location": "South Pier, loading the boat",
                "plan_change": "",
                "notes": "Trip wrapping up on schedule.",
            },
            summary="Huanyi safe at the pier; trip complete.",
            task_completed=True,
            confidence=0.97,
            confidence_label="high",
            evidence=["Worker confirmed safe and off the water"],
        ),
    ],
    # The wow beat: answered check-in hiding a duress phrase.
    "duress": [
        _CHECKIN_1400_SAFE,
        _CHECKIN_1800_DURESS,
        _ESCALATION_RIVERA_DURESS,
    ],
}
