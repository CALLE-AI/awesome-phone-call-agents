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

from callibrate.evidence.readback import AFFIRMATIONS, DAY_FORMS, HESITATIONS, _words
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

WORD_TO_HOUR = {
    "midnight": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "noon": 12, "midday": 12,
}
WORD_TO_MINUTE = {
    "oclock": 0, "sharp": 0, "fifteen": 15, "quarter": 15, "thirty": 30, "half": 30,
    "fortyfive": 45, "forty": 40, "fifty": 50, "ten": 10, "twenty": 20, "five": 5,
}

DAY_TOKEN = {form: code for code, forms in DAY_FORMS.items() for form in forms}
DAY_ORDER = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")

CLOCK = re.compile(r"\b(\d{1,2})[:.h](\d{2})\b")

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


#: Words that make two clock times a range rather than two separate mentions.
#: Words that join two clock times into one span. "and" is here because "we
#: open nine and close twelve" is a range; a comma alone is not.
RANGE_MARKERS = frozenset({"to", "til", "till", "until", "through", "thru", "and", "between"})


def _times_in(text: str) -> list[tuple[int, int, int]]:
    """Every clock time in a sentence as (position, hour, minute), in order.

    Digits win where they exist, and the characters they occupy are then closed
    to the word pass: without that, "close 12:30" is read as a 12:30 and then
    again as a 12 and a 30, and the sentence acquires times nobody said.
    """
    lowered = text.lower()
    found: list[tuple[int, int, int]] = []
    consumed: list[tuple[int, int]] = []
    for match in CLOCK.finditer(lowered):
        hour, minute = int(match.group(1)), int(match.group(2))
        if hour < 24 and minute < 60:
            found.append((match.start(), hour, minute))
            consumed.append((match.start(), match.end()))

    words = re.findall(r"[a-z0-9]+", lowered)
    positions: list[int] = []
    cursor = 0
    for word in words:
        index = lowered.find(word, cursor)
        positions.append(index)
        cursor = index + len(word)

    index = 0
    while index < len(words):
        word = words[index]
        position = positions[index]
        if any(start <= position < stop for start, stop in consumed):
            index += 1
            continue
        hour = WORD_TO_HOUR.get(word)
        if hour is None and word.isdigit() and 0 <= int(word) <= 23 and len(word) <= 2:
            hour = int(word)
        if hour is None:
            index += 1
            continue
        minute = 0
        step = 1
        for offset, nxt in enumerate(words[index + 1 : index + 4]):
            if nxt in {"thirty", "half"}:
                minute, step = 30, offset + 2
                break
            if nxt in {"fifteen", "quarter"}:
                minute, step = 15, offset + 2
                break
            if nxt in {"forty", "fortyfive"}:
                minute, step = 45, offset + 2
                break
            if nxt.isdigit() and len(nxt) == 2 and int(nxt) < 60:
                minute, step = int(nxt), offset + 2
                break
        tail = " ".join(words[index : index + 6])
        if re.search(r"\b(pm|afternoon|evening|night)\b", tail) and hour < 12:
            hour += 12
        elif re.search(r"\b(am|morning)\b", tail) and hour == 12:
            hour = 0
        found.append((position, hour, minute))
        index += step
    return sorted(found)


def _is_a_range(text: str, first_end: int, second_start: int) -> bool:
    """Whether the words between two times make them a span rather than a list.

    "ten until one" is opening hours. "the one time, ten o'clock" is one time
    and a stray numeral, and reading it as 01:00-10:00 would publish nonsense.
    """
    between = text.lower()[first_end:second_start]
    words = re.findall(r"[a-z]+", between)
    # "Tuesdays at ten and Thursdays at two" names two separate sessions, not a
    # span. A day word between the two times is the cheapest way to see that.
    if any(word in DAY_TOKEN for word in words):
        return False
    if any(marker in between for marker in ("-", "–", "—")):
        return True
    return any(word in RANGE_MARKERS for word in words)


def _days_in(text: str) -> list[str]:
    seen: list[str] = []
    for word in _words(text):
        code = DAY_TOKEN.get(word)
        if code and code not in seen:
            seen.append(code)
    if re.search(r"\b(weekday|weekdays)\b", text.lower()):
        for code in ("MO", "TU", "WE", "TH", "FR"):
            if code not in seen:
                seen.append(code)
    return sorted(seen, key=DAY_ORDER.index)


def spoken_schedule(text: str, *, default_days: list[str] | None = None) -> str | None:
    """Canonicalise a spoken opening-hours sentence, or return nothing.

    "It's ten until one now" carries no day, so the day the record already holds
    is supplied by the caller as `default_days`. A sentence with fewer than two
    readable times, two times that are not joined as a range, or a range that
    ends before it starts, produces no candidate at all.
    """
    times = _times_in(text)
    if len(times) < 2:
        return None
    days = _days_in(text) or list(default_days or [])
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
    spoken = set(_words(text))
    return bool(spoken & AFFIRMATIONS) and not (spoken & HESITATIONS)


def is_hedged(text: str) -> bool:
    """Whether a provider stating a value sounded unsure of it."""
    return bool(set(_words(text)) & UNCERTAINTY)


def is_correction(text: str) -> bool:
    """Whether a reply disagrees with what was just said to it."""
    return bool(set(_words(text)) & {"no", "not", "nope", "wrong", "isn", "wasn"})


def disclosure_spoken(turns: list[NormalizedTurn]) -> bool:
    """Whether the assistant said it was automated, in the first few turns.

    The disclosure has to arrive before the questions do. A disclosure buried
    after the provider has already answered is not a disclosure.
    """
    for turn in turns[:4]:
        if turn.role == "assistant" and contains_any(turn.text, DISCLOSURE_PHRASES):
            return True
    return False
