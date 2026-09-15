"""Transcript-derived timing. CALL-E transcripts carry `offset_seconds` per turn, so response latency,
silences and overlaps can be measured from the terminal snapshot alone — no audio, no provider metrics.
Everything here is arithmetic; nothing here is a model."""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median


@dataclass
class Timing:
    agent_turns: int = 0
    callee_turns: int = 0
    response_latencies: list[float] = field(default_factory=list)  # agent turn start − previous callee turn start (seconds)
    silences: list[float] = field(default_factory=list)  # gaps > silence_threshold between any two turns
    overlaps: int = 0  # a turn that starts before the previous one (negative gap) — a proxy for talking over
    duration_seconds: float = 0.0
    agent_talk_share: float | None = None  # share of turns that are the agent's (transcripts have no durations)

    @property
    def p50(self) -> float | None:
        return round(median(self.response_latencies), 2) if self.response_latencies else None

    @property
    def p95(self) -> float | None:
        if not self.response_latencies:
            return None
        s = sorted(self.response_latencies)
        return round(s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))], 2)

    def as_dict(self) -> dict:
        return {"agent_turns": self.agent_turns, "callee_turns": self.callee_turns, "response_p50_s": self.p50, "response_p95_s": self.p95, "silences_over_threshold": len(self.silences), "longest_silence_s": round(max(self.silences), 2) if self.silences else 0.0, "overlaps": self.overlaps, "duration_seconds": round(self.duration_seconds, 2), "agent_talk_share": self.agent_talk_share}


AGENT_SPEAKERS = {"agent", "assistant", "ai", "calle", "call-e", "bot"}


def is_agent(speaker: str) -> bool:
    return (speaker or "").strip().lower() in AGENT_SPEAKERS


def analyze_turns(turns: list[dict], silence_threshold: float = 4.0) -> Timing:
    t = Timing()
    prev_offset: float | None = None
    prev_callee_offset: float | None = None
    for turn in turns:
        off = float(turn.get("offset_seconds") or 0.0)
        spk = str(turn.get("speaker") or "")
        if prev_offset is not None:
            gap = off - prev_offset
            if gap < 0:
                t.overlaps += 1
            elif gap > silence_threshold:
                t.silences.append(gap)
        if is_agent(spk):
            t.agent_turns += 1
            if prev_callee_offset is not None:
                lat = off - prev_callee_offset
                if lat >= 0:
                    t.response_latencies.append(round(lat, 3))
        else:
            t.callee_turns += 1
            prev_callee_offset = off
        prev_offset = off
        t.duration_seconds = max(t.duration_seconds, off)
    total = t.agent_turns + t.callee_turns
    t.agent_talk_share = round(t.agent_turns / total, 3) if total else None
    return t
