"""Reading a CALL-E transcript without asking anything to interpret it.

Two jobs live here.

**Normalising.** CALL-E returns turns labelled `bot` and `user`. On an outbound
verification call the `user` is the person who picked up the provider's phone,
so `user` becomes `provider` and `bot` becomes `assistant`. Getting this wrong is
not cosmetic: the readback corroborator looks for a *provider* agreeing with an
*assistant*, so a mislabelled transcript silently stops every automatic update
without anything failing. Each turn gets a stable id, and free text is redacted
before it is stored.

**Proposing.** Spoken language has to become a canonical record value before
anything can be compared with the record. "ten until one on Wednesdays" has to
become `WE 10:00-13:00`, or the two are not comparable and the whole verification
is a vibe. That conversion happens here, from the transcript alone, by rule.

Everything in this module is deliberately conservative. A sentence it cannot
parse produces no candidate, which sends the field to a curator. It never
guesses a value in order to have one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from callibrate.evidence.readback import AFFIRMATIONS, HESITATIONS
from callibrate.evidence.spoken import (
    DAY_ORDER,
    DAY_TOKEN,
    clock_times_in,
    day_codes_in,
    day_mentions_in,
    words,
)
from callibrate.privacy import redact_pii

#: Words that make a *statement* uncertain. Deliberately much narrower than
#: `HESITATIONS`, which is the set for a confirmation turn: "it actually changed
#: to ten until one" is a plain statement of a new value, and reading it as a
#: hedge would send every genuine correction to a curator.
UNCERTAINTY = frozenset({
    "think", "guess", "believe", "maybe", "perhaps", "probably", "might",
    "possibly", "unsure", "roughly", "around", "approximately", "usually",
    "sometimes", "depends", "check", "double", "wait", "hold", "suppose",
    "somewhere", "ish",
})

#: How CALL-E labels a speaker, and who that is on an outbound verification call.
SPEAKER_ROLES = {
    "bot": "assistant",
    "agent": "assistant",
    "assistant": "assistant",
    "ai": "assistant",
    "calle": "assistant",
    "user": "provider",
    "human": "provider",
    "customer": "provider",
    "callee": "provider",
    "recipient": "provider",
    "provider": "provider",
}

STOP_PHRASES = (
    "stop calling", "take us off", "do not call", "don't call", "remove us from",
    "take me off", "no more calls", "opt us out", "unsubscribe",
)
DISTRESS_PHRASES = (
    "i want to hurt", "kill myself", "suicide", "emergency", "i am in danger",
    "someone is hurting",
)
CLIENT_PHRASES = (
    "i need food", "i need help", "looking for help", "help for my", "i am hungry",
    "do you have any food for me", "can you help me",
)
WRONG_PARTY_PHRASES = (
    "wrong number", "you have the wrong", "there is no such", "never heard of",
    "this is a private", "i think you misdialled", "i think you misdialed",
)
CLOSURE_PHRASES = (
    "closed", "shut down", "shutting down", "ended the program", "ending the program",
    "no longer running", "no longer offer", "stopped offering", "we do not run",
    "we don't run", "discontinued", "wound down", "last week we closed",
)
ELIGIBILITY_PHRASES = (
    "only for", "no longer serving", "you have to live", "you now need", "we now require",
    "referral only", "must be referred", "income limit", "proof of",
)
DISCLOSURE_PHRASES = (
    "automated", "ai assistant", "artificial intelligence", "this is an automated",
    "i am an automated", "i'm an automated", "automated assistant", "a i assistant",
    "virtual assistant", "computer calling",
)


@dataclass(frozen=True, slots=True)
class NormalizedTurn:
    id: str
    role: str
    text: str
    offset_seconds: float | None


def speaker_role(speaker: str) -> str:
    """Map a CALL-E speaker label onto a Callibrate role.

    An unrecognised label becomes `system`, never `provider`: an unknown speaker
    must not be able to satisfy a readback.
    """
    return SPEAKER_ROLES.get(str(speaker or "").strip().lower(), "system")


def normalize_turns(raw_turns: list[dict[str, Any]], *, redact: bool = True) -> list[NormalizedTurn]:
    """Turn CALL-E `transcript_turns` into stored turns with stable ids."""
    turns: list[NormalizedTurn] = []
    for index, raw in enumerate(raw_turns or []):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or raw.get("content") or "").strip()
        if not text:
            continue
        offset = raw.get("offset_seconds", raw.get("offsetSeconds"))
        turns.append(
            NormalizedTurn(
                id=f"t{index + 1}",
                role=speaker_role(raw.get("speaker") or raw.get("role") or ""),
                text=redact_pii(text)[:4000] if redact else text[:4000],
                offset_seconds=float(offset) if isinstance(offset, (int, float)) else None,
            )
        )
    return turns


#: Words that join two clock times into one span. "and" is here because "we
#: open nine and close twelve" is a range; a comma alone is not.
RANGE_MARKERS = frozenset({"to", "til", "till", "until", "through", "thru", "and", "between"})


def _is_a_range(text: str, first_end: int, second_start: int) -> bool:
    """Whether the words between two times make them a span rather than a list.

    "ten until one" is opening hours. "the one time, ten o'clock" is one time
    and a stray numeral, and reading it as 01:00-10:00 would publish nonsense.
    """
    between = text.lower()[first_end:second_start]
    spoken = re.findall(r"[a-z]+", between)
    # "Tuesdays at ten and Thursdays at two" names two separate sessions, not a
    # span. A day word between the two times is the cheapest way to see that.
    if any(word in DAY_TOKEN for word in spoken):
        return False
    if any(marker in between for marker in ("-", "–", "—")):
        return True
    return any(word in RANGE_MARKERS for word in spoken)


def _sessions(text: str, times: list[tuple[int, int, int]]) -> list[dict[str, int]]:
    """The utterance cut where a day word starts describing a different session.

    "Tuesdays ten to twelve and Thursdays one to three" is two sessions, and the
    cut is the day word that arrives after a time: what precedes it belongs to
    the range it introduced, and what follows it belongs to another one. Each
    piece is counted rather than kept, because the only question asked here is
    whether the sentence describes exactly one range.
    """
    events: list[tuple[int, str]] = [(position, "day") for position, _ in day_mentions_in(text)]
    events += [(position, "time") for position, _, _ in times]
    blocks: list[dict[str, int]] = [{"days": 0, "times": 0}]
    for _, kind in sorted(events):
        if kind == "day" and blocks[-1]["times"]:
            blocks.append({"days": 0, "times": 0})
        blocks[-1]["days" if kind == "day" else "times"] += 1
    return blocks


def names_more_than_one_session(text: str) -> bool:
    """Whether a sentence describes hours a single range cannot hold.

    Two sessions in one utterance, or a day named outside the range the times
    belong to. `spoken_schedule` refuses both, and the refusal is worth saying
    out loud: the provider did state their hours, and the reason the record did
    not move is that this reader will not choose which half of the sentence to
    keep.
    """
    times = clock_times_in(text)
    if len(times) < 2:
        return False
    blocks = _sessions(text, times)
    timed = [block for block in blocks if block["times"]]
    if len(timed) != 1 or timed[0]["times"] != 2:
        return True
    return bool(timed[0]["days"]) and sum(block["days"] for block in blocks) != timed[0]["days"]


def spoken_schedule(text: str, *, default_days: list[str] | None = None) -> str | None:
    """Canonicalise a spoken opening-hours sentence, or return nothing.

    "It's ten until one now" carries no day, so the day the record already holds
    is supplied by the caller as `default_days`. A sentence with fewer than two
    readable times, two times that are not joined as a range, or a range that
    ends before it starts, produces no candidate at all.

    It also has to describe *one* session. A record value is one range over a
    set of days, so "Tuesdays ten to twelve and Thursdays one to three" has no
    candidate to give: reading the first two times and both days would publish
    Thursday as ten to twelve, which is a change the provider never stated. Two
    sessions in one sentence go to a curator whole.
    """
    times = clock_times_in(text)
    if len(times) < 2 or names_more_than_one_session(text):
        return None

    days = day_codes_in(text) or list(default_days or [])
    if not days:
        return None

    (first_position, open_hour, open_minute), (second_position, close_hour, close_minute) = times[0], times[1]
    if not _is_a_range(text, first_position, second_position):
        return None

    if (close_hour, close_minute) <= (open_hour, open_minute) and close_hour < 12:
        # "ten until one" is one in the afternoon. Promoting a bare closing hour
        # by twelve is only allowed when it repairs an impossible range and
        # leaves a plausible working day; "seven until seven" stays impossible,
        # because an overnight shelter is not something one sentence can settle.
        promoted = close_hour + 12
        if (promoted, close_minute) > (open_hour, open_minute) and promoted - open_hour <= 12:
            close_hour = promoted
    opens = f"{open_hour:02d}:{open_minute:02d}"
    closes = f"{close_hour:02d}:{close_minute:02d}"
    if opens >= closes:
        return None
    return f"{','.join(sorted(set(days), key=DAY_ORDER.index))} {opens}-{closes}"


def contains_any(text: str, phrases: tuple[str, ...]) -> str:
    lowered = text.lower()
    return next((phrase for phrase in phrases if phrase in lowered), "")


def is_affirmation(text: str) -> bool:
    spoken = set(words(text))
    return bool(spoken & AFFIRMATIONS) and not (spoken & HESITATIONS)


def is_hedged(text: str) -> bool:
    """Whether a provider stating a value sounded unsure of it."""
    return bool(set(words(text)) & UNCERTAINTY)


def is_correction(text: str) -> bool:
    """Whether a reply disagrees with what was just said to it."""
    return bool(set(words(text)) & {"no", "not", "nope", "wrong", "isn", "wasn"})


def disclosure_spoken(turns: list[NormalizedTurn]) -> bool:
    """Whether the assistant said it was automated, in the first few turns.

    The disclosure has to arrive before the questions do. A disclosure buried
    after the provider has already answered is not a disclosure.
    """
    for turn in turns[:4]:
        if turn.role == "assistant" and contains_any(turn.text, DISCLOSURE_PHRASES):
            return True
    return False
