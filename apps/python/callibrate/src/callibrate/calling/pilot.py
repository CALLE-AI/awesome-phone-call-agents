"""The pilot line: a scripted conversation, read by the production evidence rules.

Every hackathon build needs a way to exercise the parts of a system that a real
phone call is too slow, too expensive and too rude to exercise a hundred times.
The pilot line is that: a set of scripted conversations in CALL-E's own
transcript shape, replayed through the same normaliser, the same readback
corroborator, the same reconciler and the same policy as a real CALL-E run.

Two rules keep it honest.

**It is never presented as a real call.** `is_live` is false, the caller name it
writes into the ledger is `pilot-line`, and the console labels the run.

**It gets no shortcuts.** It returns raw turns, not evidence. If the transcript
reader cannot find a readback in a pilot script, the pilot script does not get
its update either. Two of the scripts below exist precisely to fail.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from callibrate.calling.base import VerificationCaller
from callibrate.calling.models import CallError, CallEvidence, CallOutcome
from callibrate.contracts.models import VerificationContract
from callibrate.evidence.reconcile import build_evidence
from callibrate.evidence.transcript import normalize_turns

#: Conversations in CALL-E's `transcript_turns` shape: `speaker` is `bot` or `user`.
PILOT_SCRIPTS: dict[str, dict[str, Any]] = {
    "hours_changed": {
        "label": "The hours have moved",
        "status": "COMPLETED",
        "summary": "The provider gave new Wednesday hours and confirmed them on a readback.",
        "turns": [
            ("bot", "Hello, this is an automated assistant calling on behalf of the community resource directory. Can I check what we publish for the weekly grocery pickup?"),
            ("user", "Sure, go ahead."),
            ("bot", "Thank you. We publish it as Wednesdays, nine in the morning until twelve. Is that still right?"),
            ("user", "That changed, actually. It is ten until one now."),
            ("bot", "Let me read that back so I have it exactly. Wednesdays, ten in the morning until one in the afternoon. Have I got that right?"),
            ("user", "Yes, ten to one on Wednesdays is correct."),
            ("bot", "Thank you, that is very helpful. Have a good afternoon."),
        ],
    },
    "confirmed": {
        "label": "Everything is still correct",
        "status": "COMPLETED",
        "summary": "The provider confirmed the published hours without changes.",
        "turns": [
            ("bot", "Hello, this is an automated assistant calling on behalf of the community resource directory. I am checking the details we publish for the weekly grocery pickup."),
            ("user", "Go ahead."),
            ("bot", "We publish the pickup as Wednesdays, nine in the morning until twelve. Is that still right?"),
            ("user", "That is correct. Wednesday nine to twelve, unchanged."),
            ("bot", "Thank you, I will note that nothing has changed."),
        ],
    },
    "program_closed": {
        "label": "The program has closed",
        "status": "COMPLETED",
        "summary": "The provider said the program is ending. No question was pressed.",
        "turns": [
            ("bot", "Hello, this is an automated assistant calling on behalf of the community resource directory, about the service you run."),
            ("user", "Oh. We are ending that program next month, it closed to new people already."),
            ("bot", "Thank you for telling me. I will not ask you anything else about that, and I will not change your listing. Someone from the directory will be in touch."),
            ("user", "That is fine, thank you."),
        ],
    },
    "uncertain_volunteer": {
        "label": "A volunteer is not sure",
        "status": "COMPLETED",
        "summary": "A volunteer could not confirm the hours.",
        "turns": [
            ("bot", "Hello, this is an automated assistant calling on behalf of the community resource directory. I am checking the details we publish for the weekly grocery pickup."),
            ("user", "I am just a volunteer, but I can try."),
            ("bot", "Thank you. We publish Wednesdays, nine in the morning until twelve. Is that still the day and time?"),
            ("user", "I think it might be ten until one now, but I would have to check with the coordinator."),
            ("bot", "That is completely fine, I will not record anything uncertain. Thank you for your time."),
        ],
    },
    "stop_calling": {
        "label": "The organization opts out",
        "status": "COMPLETED",
        "summary": "The organization asked not to be called again.",
        "turns": [
            ("bot", "Hello, this is an automated assistant calling on behalf of the community resource directory. I am checking the details we publish for the weekly grocery pickup."),
            ("user", "Please stop calling and take us off your list."),
            ("bot", "Understood. I am ending the call now and this number will not be called again."),
        ],
    },
    "corrects_the_readback": {
        "label": "The provider corrects the readback",
        "status": "COMPLETED",
        "summary": "The readback was wrong and the provider said so.",
        "turns": [
            ("bot", "Hello, this is an automated assistant calling on behalf of the community resource directory about the weekly grocery pickup."),
            ("user", "Yes?"),
            ("bot", "We publish Wednesdays nine until twelve. Is that right?"),
            ("user", "It moved to ten until one."),
            ("bot", "So that is Wednesdays, ten in the morning until three in the afternoon?"),
            ("user", "No, one in the afternoon, not three."),
            ("bot", "Thank you for the correction. I will leave this for someone to confirm."),
        ],
    },
    "no_answer": {
        "label": "Nobody picks up",
        "status": "NO_ANSWER",
        "summary": "",
        "turns": [],
    },
}


class PilotLineCaller(VerificationCaller):
    """Replay a scripted conversation through the production evidence pipeline."""

    name = "pilot-line"
    is_live = False

    def __init__(self, scenario: str = "hours_changed") -> None:
        if scenario not in PILOT_SCRIPTS:
            raise CallError(f"unknown pilot scenario {scenario!r}", retryable=False)
        self.scenario = scenario

    @staticmethod
    def scenarios() -> list[dict[str, str]]:
        return [
            {"id": key, "label": script["label"]} for key, script in PILOT_SCRIPTS.items()
        ]

    async def verify(self, contract: VerificationContract) -> CallEvidence:
        script = PILOT_SCRIPTS[self.scenario]
        started = datetime.now(UTC)
        clock = time.monotonic()
        raw = [
            {"speaker": speaker, "text": text, "offset_seconds": index * 6.0}
            for index, (speaker, text) in enumerate(script["turns"])
        ]
        turns = normalize_turns(raw)
        status = str(script["status"])
        outcome = CallOutcome.COMPLETED if status == "COMPLETED" else CallOutcome.NO_ANSWER
        return build_evidence(
            contract,
            turns=turns,
            caller=self.name,
            outcome=outcome,
            caller_result={"status": status, "scenario": self.scenario},
            call_id=f"pilot_{self.scenario}",
            provider_status=status,
            summary=str(script["summary"]),
            started_at=started,
            completed_at=datetime.now(UTC),
            duration_seconds=time.monotonic() - clock,
        )
