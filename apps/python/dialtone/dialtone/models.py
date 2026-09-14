"""Normalized call transcripts.

Speaker labels follow CALL-E's API: ``bot`` is *our* agent, ``user`` is the
party being classified (the counterpart). Transcripts pulled from the inbound
AI line are flipped so the caller becomes ``user`` - the classifier is always
asked "what is on the other end?".
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

LABELS = ("human", "ivr", "agent")
WORDS_PER_SECOND = 2.7


def words(text: str) -> list[str]:
    return [w for w in text.replace("—", " ").split() if any(c.isalnum() for c in w)]


def speech_seconds(text: str) -> float:
    """Rough spoken duration of a turn. CALL-E only exposes turn start offsets."""
    if text.strip().startswith("[DTMF"):
        return 0.3
    return 0.2 + len(words(text)) / WORDS_PER_SECOND


@dataclass
class Turn:
    speaker: str
    text: str
    offset_seconds: float | None = None

    @property
    def end_estimate(self) -> float | None:
        if self.offset_seconds is None:
            return None
        return self.offset_seconds + speech_seconds(self.text)


@dataclass
class Transcript:
    id: str
    turns: list[Turn]
    label: str | None = None
    source: str = "sim"
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def duration(self) -> float:
        ends = [t.end_estimate for t in self.turns if t.end_estimate is not None]
        return max(ends) if ends else 0.0

    def user_turns(self) -> list[Turn]:
        return [t for t in self.turns if t.speaker == "user"]

    def window(self, until: float | None) -> "Transcript":
        """Only the turns that had *started* by ``until`` seconds."""
        if until is None:
            return self
        kept = [t for t in self.turns if t.offset_seconds is not None and t.offset_seconds <= until]
        return Transcript(self.id, kept, self.label, self.source, self.meta)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "source": self.source,
            "meta": self.meta,
            "turns": [asdict(t) for t in self.turns],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Transcript":
        meta = dict(d.get("meta") or {})
        for key in ("difficulty", "scenario", "task", "outcome"):
            if key in d:
                meta[key] = d[key]
        turns = [
            Turn(
                speaker=_norm_speaker(t.get("speaker") or t.get("role")),
                text=str(t.get("text") or t.get("message") or ""),
                offset_seconds=_float(t.get("offset_seconds")),
            )
            for t in d["turns"]
        ]
        return cls(d["id"], turns, d.get("label"), d.get("source", "sim"), meta)

    @classmethod
    def load(cls, path: str | Path) -> "Transcript":
        return cls.from_dict(json.loads(Path(path).read_text()))

    @classmethod
    def from_calle(cls, call: dict[str, Any], label: str | None = None) -> "Transcript":
        """Build from a CALL-E call object (``GET /v1/calls/{id}``).

        A call can have several recipients and attempts; we keep the attempt
        with the most transcript turns (the one that actually connected).
        """
        best: list[dict[str, Any]] = []
        attempt_meta: dict[str, Any] = {}
        for recipient in call.get("recipients") or []:
            for attempt in recipient.get("attempts") or []:
                turns = attempt.get("transcript_turns") or []
                if len(turns) > len(best):
                    best = turns
                    attempt_meta = {k: attempt.get(k) for k in ("started_at", "ended_at", "status") if k in attempt}
        # Live CALL-E transcripts arrive as fragments ("Yes," / "please confirm it") with whole-second
        # offsets. Consecutive fragments from one speaker are one turn for timing and lexical features.
        turns: list[Turn] = []
        for t in best:
            speaker, text = _norm_speaker(t.get("speaker")), (t.get("text") or "").strip()
            if turns and turns[-1].speaker == speaker:
                turns[-1].text = f"{turns[-1].text} {text}".strip()
            else:
                turns.append(Turn(speaker, text, _float(t.get("offset_seconds"))))
        meta = {
            "calle_call_id": call.get("id"),
            "status": call.get("status"),
            "task_completed": call.get("task_completed"),
            "completion_confidence": call.get("completion_confidence"),
            "structured_result": call.get("structured_result"),
            "evidence": call.get("evidence"),
            "task": call.get("task"),
            **attempt_meta,
        }
        return cls(call.get("id") or "calle-call", turns, label, "real-calle", meta)

    @classmethod
    def from_calle_events(cls, call: dict[str, Any], events: list[dict[str, Any]], label: str | None = None) -> "Transcript":
        """Build from CALL-E's realtime call events (``GET /v1/calls/{id}/events``).

        The event stream carries millisecond timestamps for "Bot is speaking: ...", growing
        "Callee said: ..." partials, and "Callee interrupted: ...". That gives *measured* turn
        starts and barge-ins instead of the whole-second offsets in ``transcript_turns``.
        """
        from datetime import datetime

        def ts(e: dict[str, Any]) -> float:
            return datetime.fromisoformat(e["created_at"].replace("Z", "+00:00")).timestamp()

        events = sorted((e for e in events if e.get("created_at")), key=ts)
        connected = next((ts(e) for e in events if (e.get("message") or "").startswith("Call connected")), None)
        if connected is None:
            return cls.from_calle(call, label)
        interruptions: list[float] = []
        # Group each speaker's events into utterances independently (the two streams interleave
        # while both talk), then order utterances by start time.
        utterances: list[Turn] = []
        open_by_speaker: dict[str, tuple[Turn, float]] = {}
        for e in events:
            msg, at = e.get("message") or "", round(ts(e) - connected, 3)
            if msg.startswith("Callee interrupted:"):
                interruptions.append(at)
                continue
            if msg.startswith("Bot is speaking: "):
                speaker, text = "bot", msg[len("Bot is speaking: "):].strip()
            elif msg.startswith("Callee said: "):
                speaker, text = "user", msg[len("Callee said: "):].strip()
            else:
                continue
            current = open_by_speaker.get(speaker)
            other = open_by_speaker.get("user" if speaker == "bot" else "bot")
            other_spoke_since = other is not None and current is not None and other[1] > current[1] and not _is_partial_revision(current[0].text, text)
            if current and at - current[1] < 2.5 and not other_spoke_since:
                turn = current[0]
                if speaker == "user":
                    # Callee partials are cumulative and get revised ("You for calling Lou" -> "Thank you for calling Luigi's ...").
                    turn.text = text if _is_partial_revision(turn.text, text) else f"{turn.text} {text}"
                else:
                    turn.text = f"{turn.text} {text}"
            else:
                turn = Turn(speaker, text, at)
                utterances.append(turn)
            open_by_speaker[speaker] = (turn, at)
        utterances.sort(key=lambda u: u.offset_seconds)
        turns: list[Turn] = []
        for u in utterances:
            if turns and turns[-1].speaker == u.speaker:
                turns[-1].text = f"{turns[-1].text} {u.text}"
            else:
                turns.append(u)
        base = cls.from_calle(call, label)
        base.turns = turns
        base.meta.update({"timing_source": "calle_events", "interruptions": interruptions, "n_events": len(events)})
        return base
        """Build from a Vapi call object, seen from the *line's* side.

        Vapi's ``bot``/``assistant`` is our voicebot (-> ``bot``); the inbound
        caller (the CALL-E agent) becomes ``user``, the party we classify.
        """
        messages = (call.get("artifact") or {}).get("messages") or call.get("messages") or []
        turns = []
        for m in messages:
            role = m.get("role")
            if role not in ("bot", "assistant", "user"):
                continue
            offset = _float(m.get("secondsFromStart"))
            turns.append(Turn("bot" if role in ("bot", "assistant") else "user", m.get("message") or "", offset))
        meta = {
            "vapi_call_id": call.get("id"),
            "ended_reason": call.get("endedReason"),
            "started_at": call.get("startedAt"),
            "ended_at": call.get("endedAt"),
            "perspective": "inbound-line",
        }
        return cls(call.get("id") or "vapi-call", turns, label, "real-vapi", meta)


def _is_partial_revision(old: str, new: str) -> bool:
    """True when ``new`` is a grown/revised version of the partial transcript ``old``."""
    a = {w.strip(".,?!'").lower() for w in old.split()}
    b = {w.strip(".,?!'").lower() for w in new.split()}
    return bool(a) and len(new) >= len(old) * 0.8 and len(a & b) >= max(1, len(a) // 2)


def _norm_speaker(value: Any) -> str:
    value = str(value or "").lower()
    if value in ("bot", "assistant", "agent", "calle"):
        return "bot"
    if value in ("user", "customer", "counterpart", "callee"):
        return "user"
    return "unknown"


def _float(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def load_dir(path: str | Path) -> list[Transcript]:
    return [Transcript.load(p) for p in sorted(Path(path).glob("*.json"))]
