"""The spoken vocabulary, and the scanners that read one sentence for its parts.

Two modules read the same English from opposite ends. `transcript.py` turns a
provider's sentence into a candidate record value; `readback.py` checks an
assistant's sentence against a value that already exists. They have to agree
about what a sentence contains. If one of them can see a day or a clock time the
other cannot, a value can be proposed out of half a sentence and then read back
as though it were the whole of it, which is the one failure this system is built
to make impossible. So the lexicon and both scanners live here, and neither
reader keeps its own.
"""

from __future__ import annotations

import re

#: Every form of a day that carries the day. Bare two-letter forms are
#: deliberately absent: nobody says "we" for Wednesday out loud, and admitting
#: it turns the pronoun in "we open at ten" into a day of the week.
DAY_FORMS: dict[str, frozenset[str]] = {
    "MO": frozenset({"mon", "monday", "mondays"}),
    "TU": frozenset({"tue", "tues", "tuesday", "tuesdays"}),
    "WE": frozenset({"wed", "weds", "wednesday", "wednesdays"}),
    "TH": frozenset({"thu", "thur", "thurs", "thursday", "thursdays"}),
    "FR": frozenset({"fri", "friday", "fridays"}),
    "SA": frozenset({"sat", "saturday", "saturdays"}),
    "SU": frozenset({"sun", "sunday", "sundays"}),
}

DAY_TOKEN = {form: code for code, forms in DAY_FORMS.items() for form in forms}
DAY_ORDER = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
WEEKDAY = re.compile(r"\b(weekday|weekdays)\b")
WEEKDAY_CODES = ("MO", "TU", "WE", "TH", "FR")

WORD_TO_HOUR = {
    "midnight": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "noon": 12, "midday": 12,
}
WORD_TO_MINUTE = {
    "oclock": 0, "sharp": 0, "fifteen": 15, "quarter": 15, "thirty": 30, "half": 30,
    "fortyfive": 45, "forty": 40, "fifty": 50, "ten": 10, "twenty": 20, "five": 5,
}

CLOCK = re.compile(r"\b(\d{1,2})[:.h](\d{2})\b")


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def clock_times_in(text: str) -> list[tuple[int, int, int]]:
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

    spoken = words(lowered)
    positions: list[int] = []
    cursor = 0
    for word in spoken:
        index = lowered.find(word, cursor)
        positions.append(index)
        cursor = index + len(word)

    index = 0
    while index < len(spoken):
        word = spoken[index]
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
        for offset, nxt in enumerate(spoken[index + 1 : index + 4]):
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
        tail = " ".join(spoken[index : index + 6])
        if re.search(r"\b(pm|afternoon|evening|night)\b", tail) and hour < 12:
            hour += 12
        elif re.search(r"\b(am|morning)\b", tail) and hour == 12:
            hour = 0
        found.append((position, hour, minute))
        index += step
    return sorted(found)


def day_mentions_in(text: str) -> list[tuple[int, str]]:
    """Every day named in a sentence as (position, code), in the order said.

    Positions are what tells one session from another: a day word that arrives
    after a time has stopped describing the range before it and started
    describing another one.
    """
    lowered = text.lower()
    found: list[tuple[int, str]] = []
    cursor = 0
    for word in words(lowered):
        position = lowered.find(word, cursor)
        cursor = position + len(word)
        code = DAY_TOKEN.get(word)
        if code:
            found.append((position, code))
    for match in WEEKDAY.finditer(lowered):
        found.extend((match.start(), code) for code in WEEKDAY_CODES)
    return sorted(found)


def day_codes_in(text: str) -> list[str]:
    """The set of days a sentence names, in week order."""
    seen: list[str] = []
    for _, code in day_mentions_in(text):
        if code not in seen:
            seen.append(code)
    return sorted(seen, key=DAY_ORDER.index)
