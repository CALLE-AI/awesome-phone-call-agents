"""A local stand-in for the CALL-E Developer API: calls.create, calls.get and calls.list_events.

Nothing here touches the network. Payload shapes follow what the calle-ai SDK returns from the live
API (a call task with recipients, attempts, transcript_turns, structured_result and
completion_confidence; events as a cursor-paged list), so call.py runs against this fake and
against CALL-E unchanged. A repeated idempotency key returns the call it already created.

A named scenario scripts the person who answers. The caller's opening line is taken from the task
that was actually sent, so the disclosure check depends on the real script. Everything said here
is synthetic.
"""
from __future__ import annotations

import copy
import re
from datetime import datetime, timedelta
from typing import Any

from .call import E164

SCENARIOS = ("grounded", "ungrounded", "no-disclosure", "denied", "declined", "no-answer")

_ASK_RECEIVED = "Did you receive the order?"
_ASK_CHARGE = "Do you recognise the charge for that order?"
_DISCLOSES = re.compile(r"automated|assistant|virtual agent|\bai\b|artificial", re.I)
_START = datetime(2026, 1, 15, 16, 0, 5)


def _answers(received: str, charge: str, purchaser: str = "cardholder", declined: str = "no") -> dict[str, str]:
    return {"received": received, "recognises_charge": charge, "purchaser": purchaser, "declined_to_talk": declined}


def _conversation(opening: str, first: str, second: str) -> list[tuple[str, str]]:
    return [("bot", opening), ("user", "Okay."), ("bot", _ASK_RECEIVED), ("user", first),
            ("bot", _ASK_CHARGE), ("user", second), ("bot", "Thank you. Goodbye.")]


def scenario(name: str, opening: str) -> dict[str, Any]:
    """What CALL-E reports for a scenario, and what was actually said on the call."""
    done = {"status": "completed", "task_completed": True, "confidence": 0.93, "failure": None}
    if name == "grounded":
        said = _conversation(opening, "Yes, I got them last week.", "Yes, that charge is mine.")
        return {**done, "result": _answers("yes", "yes"), "said": said}
    if name == "ungrounded":
        # CALL-E reports yes twice, but the customer never said yes to either question.
        said = _conversation(opening, "Sorry, who is this?", "Can you call me later?")
        return {**done, "result": _answers("yes", "yes"), "said": said}
    if name == "no-disclosure":
        plain = opening.replace("this is an automated assistant calling", "I'm calling")
        if _DISCLOSES.search(plain):
            plain = "Hello, I'm calling about a recent order."
        said = _conversation(plain, "Yes, I got them last week.", "Yes, that charge is mine.")
        return {**done, "result": _answers("yes", "yes"), "said": said}
    if name == "denied":
        said = _conversation(opening, "No, nothing arrived.", "No, that charge is not mine.")
        return {**done, "result": _answers("no", "no", purchaser="unknown"), "said": said}
    if name == "declined":
        said = [("bot", opening), ("user", "I don't want to talk about this. Please end the call."),
                ("bot", "Understood. Thank you for your time. Goodbye.")]
        return {**done, "task_completed": False, "confidence": 0.9,
                "result": _answers("unknown", "unknown", purchaser="unknown", declined="yes"), "said": said}
    if name == "no-answer":
        return {"status": "failed", "task_completed": False, "confidence": None, "failure": "no_answer",
                "result": None, "said": []}
    raise ValueError(f"unknown scenario {name!r}; choose one of: {', '.join(SCENARIOS)}")


def _stamp(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


class _Calls:
    def __init__(self, fake: "FakeCalle"):
        self._fake = fake

    def create(self, **kwargs: Any) -> dict[str, Any]:
        return self._fake._create(**kwargs)

    def get(self, call_id: str) -> dict[str, Any]:
        return self._fake._get(call_id)

    def list_events(self, call_id: str, *, cursor: str | None = None, limit: int | None = None) -> dict[str, Any]:
        return self._fake._events(call_id, cursor, limit)

    def wait_for_result(self, call_id: str, **_: Any) -> dict[str, Any]:
        result = self._fake._get(call_id)
        while result["status"] not in ("completed", "failed"):
            result = self._fake._get(call_id)
        return result


class FakeCalle:
    """Answers calls from a named scenario.

    polls      how many calls.get it takes for a call to finish; earlier polls show it in progress
               with the transcript so far, so streaming can be observed
    page_size  events per calls.list_events page, to exercise cursor paging
    """

    def __init__(self, scenario_name: str = "grounded", *, polls: int = 1, page_size: int = 100):
        scenario(scenario_name, "")  # rejects an unknown name up front
        self.scenario = scenario_name
        self.polls = max(1, polls)
        self.page_size = max(1, page_size)
        self.requests: list[dict[str, Any]] = []  # every create request, replays included
        self._by_key: dict[str, str] = {}
        self._calls: dict[str, dict[str, Any]] = {}

    @property
    def calls(self) -> _Calls:
        return _Calls(self)

    @property
    def placed(self) -> int:
        """Distinct calls created. A replayed idempotency key does not add one."""
        return len(self._calls)

    def _create(self, *, task: str, recipients: list[dict[str, Any]] | None = None,
                result_schema: dict[str, Any] | None = None, metadata: dict[str, Any] | None = None,
                webhook_url: str | None = None, idempotency_key: str | None = None, **_: Any) -> dict[str, Any]:
        self.requests.append({"task": task, "recipients": copy.deepcopy(recipients), "result_schema": result_schema,
                              "metadata": dict(metadata or {}), "idempotency_key": idempotency_key})
        if idempotency_key and idempotency_key in self._by_key:
            return copy.deepcopy(self._calls[self._by_key[idempotency_key]]["created"])
        phones = [p for r in recipients or [] for p in r.get("phones") or []]
        if not task or not phones or not all(E164.match(p) for p in phones):
            raise ValueError("invalid_request: a task and at least one E.164 recipient phone are required")
        cid = f"call_fake{len(self._calls) + 1:03d}"
        created = {"id": cid, "object": "call_task", "status": "queued", "task": task, "metadata": dict(metadata or {})}
        m = re.search(r'Start the call by saying: "([^"]+)"', task)
        script = scenario(self.scenario, m.group(1) if m else "Hello.")
        turns, offset = [], 0
        for speaker, text in script["said"]:
            turns.append({"offset_seconds": offset, "speaker": speaker, "text": text})
            offset += 2 + len(text) // 15
        self._calls[cid] = {"created": created, "phone": phones[0], "task": task, "metadata": dict(metadata or {}),
                            "script": script, "turns": turns, "polls": 0}
        if idempotency_key:
            self._by_key[idempotency_key] = cid
        return copy.deepcopy(created)

    def _get(self, call_id: str) -> dict[str, Any]:
        c = self._calls[call_id]
        c["polls"] = min(c["polls"] + 1, self.polls)
        sc, done = c["script"], c["polls"] >= self.polls
        status = sc["status"] if done else "in_progress"
        turns = c["turns"] if done else c["turns"][: len(c["turns"]) * c["polls"] // self.polls]
        last = c["turns"][-1]["offset_seconds"] + 3 if c["turns"] else 30
        attempt = {"id": f"att_{call_id}", "phone": c["phone"], "status": status, "started_at": _stamp(_START),
                   "completed_at": _stamp(_START + timedelta(seconds=last)) if done else None, "summary": "",
                   "transcript_turns": copy.deepcopy(turns), "provider_call_id": "fake",
                   "failure_code": sc["failure"] if done else None, "failure_message": None}
        confidence = sc["confidence"] if done else None
        return {"id": call_id, "object": "call_task", "status": status, "task": c["task"],
                "recipients": [{"id": f"rcp_{call_id}", "phones": [c["phone"]], "status": status, "attempts": [attempt]}],
                "structured_result": copy.deepcopy(sc["result"]) if done else None, "summary": "",
                "task_completed": sc["task_completed"] if done else None,
                "completion_confidence": None if confidence is None else
                {"score": confidence, "label": "high" if confidence >= 0.8 else "low"},
                "evidence": [], "metadata": copy.deepcopy(c["metadata"]),
                "failure_code": sc["failure"] if done else None, "failure_message": None,
                "created_at": _stamp(_START - timedelta(seconds=5)),
                "completed_at": _stamp(_START + timedelta(seconds=last + 2)) if done else None}

    def _events(self, call_id: str, cursor: str | None, limit: int | None) -> dict[str, Any]:
        c = self._calls[call_id]
        sc = c["script"]
        stage = min(c["polls"] + 1, self.polls)  # what the next calls.get will show
        messages = ["run_call started.", "calling task created.", "Call is ringing."]
        if sc["status"] == "completed" and (stage > 1 or self.polls == 1):
            messages.append("Call answered.")
        if stage >= self.polls:
            messages.append("Call completed." if sc["status"] == "completed" else "Call failed.")
            if sc["status"] != "completed":
                messages.insert(-1, "No answer.")
        final = stage >= self.polls
        data = [{"id": f"evt_{call_id}_{i}",
                 "type": "call.completed" if final and i == len(messages) - 1 else "call.in_progress",
                 "call_id": call_id, "level": "info",
                 "status": sc["status"] if final and i == len(messages) - 1 else "in_progress",
                 "message": m, "details": {}} for i, m in enumerate(messages)]
        start = int(cursor or 0)
        size = min(limit or self.page_size, self.page_size)
        return {"object": "list", "data": data[start:start + size],
                "next_cursor": str(start + size) if start + size < len(data) else None}
