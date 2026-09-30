"""Hold accounting, derived from the transcript CALL-E already returns.

A payer call is mostly waiting. CALL-E timestamps every transcript turn with
``offset_seconds``, and nobody speaks while hold music plays, so a long gap
between consecutive turns is hold. That makes hold measurable with no extra
instrumentation and no new API surface: it falls out of the transcript.

Summing every gap over the threshold, rather than only the first one, is
deliberate. A transfer drops the call into a second queue, so a real payer call
often holds twice. The budget and the cap apply to the total.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Sequence, Tuple

# A pause longer than this between two spoken turns is treated as hold rather
# than as conversational silence. Forty-five seconds sits above a
# representative pausing to look a claim up and well below a queue wait, which
# runs to minutes.
HOLD_GAP_THRESHOLD_SECONDS = 45


@dataclass
class HoldProfile:
    total_seconds: int = 0
    hold_seconds: int = 0
    talk_seconds: int = 0
    segments: List[Tuple[int, int]] = field(default_factory=list)

    @property
    def hold_share(self) -> float:
        return (self.hold_seconds / self.total_seconds) if self.total_seconds else 0.0

    def receipt(self) -> str:
        if not self.total_seconds:
            return "No transcript timing available."
        parts = ["Hold: %s of %s on the call" % (
            format_duration(self.hold_seconds), format_duration(self.total_seconds)
        )]
        if len(self.segments) > 1:
            parts.append(
                "%d separate holds (%s)"
                % (len(self.segments), ", ".join(format_duration(end - start) for start, end in self.segments))
            )
        return " - ".join(parts)


def format_duration(seconds: int) -> str:
    seconds = max(0, int(seconds))
    minutes, remainder = divmod(seconds, 60)
    if minutes >= 60:
        hours, minutes = divmod(minutes, 60)
        return "%dh %02dm %02ds" % (hours, minutes, remainder)
    return "%dm %02ds" % (minutes, remainder)


def transcript_turns(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pull the turn list out of a terminal call payload.

    The Developer API nests turns under recipients then attempts. The last
    attempt is the one that reached someone.
    """
    recipients = payload.get("recipients") or []
    for recipient in recipients:
        attempts = recipient.get("attempts") or []
        for attempt in reversed(attempts):
            turns = attempt.get("transcript_turns")
            if turns:
                return list(turns)
    return list(payload.get("transcript_turns") or [])


def derive(turns: Sequence[Dict[str, Any]], threshold: int = HOLD_GAP_THRESHOLD_SECONDS) -> HoldProfile:
    offsets: List[int] = []
    for turn in turns:
        try:
            offsets.append(int(float(turn.get("offset_seconds", 0))))
        except (TypeError, ValueError):
            continue
    if len(offsets) < 2:
        return HoldProfile(total_seconds=offsets[0] if offsets else 0)

    offsets.sort()
    total = offsets[-1] - offsets[0]
    segments: List[Tuple[int, int]] = []
    hold = 0
    for earlier, later in zip(offsets, offsets[1:]):
        gap = later - earlier
        if gap >= threshold:
            hold += gap
            segments.append((earlier, later))
    return HoldProfile(
        total_seconds=total,
        hold_seconds=hold,
        talk_seconds=max(0, total - hold),
        segments=segments,
    )


# ---------------------------------------------------------------------------
# Cost governor
# ---------------------------------------------------------------------------

@dataclass
class CostModel:
    """Local estimate of what a call costs to place.

    CALL-E does not publish a per-minute rate in the integration docs, and
    whether hold bills at the talk rate is unverified, so this is an operator
    input rather than a discovered value. ``trunkline calibrate`` rewrites it
    from a real call once you have one. Everything downstream treats the number
    as an estimate and says so.
    """

    usd_per_minute: float = 0.12
    fixed_usd_per_call: float = 0.10
    expected_minutes: float = 18.0

    def estimate(self, minutes: float) -> float:
        return round(self.fixed_usd_per_call + (self.usd_per_minute * max(0.0, minutes)), 4)

    def projected(self) -> float:
        return self.estimate(self.expected_minutes)


def cost_cap_exceeded(
    *,
    claim_value_usd: float,
    projected_cost_usd: float,
    max_share_of_claim: float = 0.25,
) -> bool:
    """Never spend more chasing a claim than the claim can return.

    A bundle carries the summed value of its claims, so bundling is what makes
    small claims worth calling about at all.
    """
    if claim_value_usd <= 0:
        return True
    return projected_cost_usd > (claim_value_usd * max_share_of_claim)
