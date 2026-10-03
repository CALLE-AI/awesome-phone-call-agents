"""Who had the floor, second by second, from a call's own event stream.

CALL-E logs "Call connected", "Bot is speaking: ..." and "Callee speech detected" (or
"Callee said: ...") with timestamps, on `GET /v1/calls/{id}/events`. Those are point events,
not intervals, so what this module builds is a set of marks on a timeline: one channel for
the agent, one for the person who answered. A bot mark that lands within `WINDOW` seconds
after a callee mark is a collision: the agent opened its turn while the other side still
had the floor.

That single measurement is why the survey produced no prices, and it is the evidence behind
upstream issue #415. It is here as a command so anyone can run it on their own calls:

    sticker trace --call-id call_xxx           # reads the events with your key
    sticker trace --events saved_events.json   # replays a saved stream, no key needed

Nothing here dials. It only ever reads.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

WINDOW = 1.5  # seconds: a bot mark this soon after a callee mark is a collision


@dataclass(frozen=True)
class Mark:
    t: float  # seconds after the line connected
    channel: str  # "bot" or "them"
    collision: bool  # bot opened its turn on top of the callee


@dataclass(frozen=True)
class Trace:
    marks: tuple[Mark, ...]
    span: float  # seconds from connect to the last mark

    @property
    def collisions(self) -> int:
        return sum(1 for m in self.marks if m.collision)

    @property
    def bot_turns(self) -> int:
        return sum(1 for m in self.marks if m.channel == "bot")

    @property
    def callee_turns(self) -> int:
        return sum(1 for m in self.marks if m.channel == "them")

    @property
    def first_collision(self) -> float | None:
        for m in self.marks:
            if m.collision:
                return m.t
        return None


def _when(stamp: str) -> float:
    return _dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()


def turns(events: list[dict], window: float = WINDOW) -> Trace:
    """Build the trace from the platform's event objects, in any order."""
    connect: float | None = None
    raw: list[tuple[float, str]] = []
    for event in events:
        stamp = event.get("created_at")
        message = str(event.get("message") or "")
        if not stamp:
            continue
        if message.startswith("Call connected"):
            connect = _when(stamp)
        elif message.startswith("Bot is speaking"):
            raw.append((_when(stamp), "bot"))
        elif message.startswith(("Callee said", "Callee speech detected")):
            raw.append((_when(stamp), "them"))
    if not raw:
        return Trace(marks=(), span=0.0)
    zero = connect if connect is not None else min(t for t, _ in raw)
    them = [t for t, ch in raw if ch == "them"]
    marks = tuple(
        Mark(
            t=round(t - zero, 2),
            channel=ch,
            collision=(ch == "bot" and any(0 <= t - h <= window for h in them)),
        )
        for t, ch in sorted(raw)
    )
    return Trace(marks=marks, span=round(max(t for t, _ in raw) - zero, 2))


def render(trace: Trace, width: int = 60, seconds: float | None = None) -> str:
    """The trace as text: agent on the top line, callee on the bottom, X where they collide.

    `seconds` fixes the window drawn (60 s makes calls comparable); by default the whole
    call fits the width.
    """
    if not trace.marks:
        return "line never opened: no speech events on this call\n"
    horizon = seconds or max(trace.span, 1.0)
    bot = [" "] * width
    them = [" "] * width
    for m in trace.marks:
        if m.t > horizon:
            continue
        col = min(width - 1, int(m.t / horizon * (width - 1)))
        if m.channel == "bot":
            bot[col] = "X" if m.collision else "|"
        else:
            them[col] = "|"
    ticks = "".join(
        "+" if i % (width // 4 or 1) == 0 or i == width - 1 else "-" for i in range(width)
    )
    label = f"0s{' ' * (width - 6)}{horizon:.0f}s"
    lines = [
        f"agent   {''.join(bot)}",
        f"callee  {''.join(them)}",
        f"        {ticks}",
        f"        {label}",
        "",
        f"{trace.bot_turns} agent turns, {trace.callee_turns} callee turns, "
        f"{trace.collisions} collisions over {trace.span:.0f}s "
        f"(X = agent opened its turn within {WINDOW:.1f}s of the callee speaking)",
    ]
    if trace.first_collision is not None:
        lines.append(f"first collision at {trace.first_collision:.1f}s after connect")
    beyond = sum(1 for m in trace.marks if m.t > horizon)
    if beyond:
        lines.append(f"{beyond} marks after {horizon:.0f}s not drawn")
    return "\n".join(lines) + "\n"
