"""Corroborating a readback against the conversation it happened in.

A caller can report that it read a value back and the provider agreed. That
report is the strongest single input the tier policy takes, because it is what
lets a low-judgment field publish without a curator. So it cannot be taken on
the caller's word: until this module runs, the caller is a witness to its own
call.

Nothing here asks a model anything. It reads the recorded transcript and looks
for the exchange the report claims happened, which is three turns in order:

1. the **provider** says the new thing, in their own words;
2. the **assistant** says the whole value back to them;
3. the **provider** agrees, without hedging or correcting.

All three are required, and the order is required. Two of them are not enough:
an assistant that reads out what the record already holds and gets "the phone
number is right, but the hours moved" has been corrected, not confirmed, and a
value nobody said first is a value the caller brought to the call itself.

Three properties are deliberate.

**It fails towards a person.** Spoken language is not going to normalise cleanly
onto a canonical value every time, so this will sometimes fail to find a
readback that did occur. That costs a curator thirty seconds. The opposite error
publishes a wrong address for a food pantry, so the asymmetry is the whole point
and the thresholds are set for it.

**It reads the stored transcript**, the same redacted text a curator will later
read. So its verdict is reproducible from what the ledger holds, rather than
from something transient that only existed inside one call. One consequence
follows and is not a bug: `redact_pii` masks phone numbers, so a phone readback
cannot be corroborated from the record, and a phone change from a live call
always goes to a curator.

**It only ever removes confidence.** A corroborated readback does not make a
change safe; it makes it eligible for the evidence policy to consider, which
then applies its own rules about removals, high-judgment fields and canonical
form.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Words a provider uses to agree. Matched whole, so "correctly" and "no" inside
# "nothing" do not count.
AFFIRMATIONS = frozenset({
    "yes", "yeah", "yep", "yup", "correct", "right", "exactly", "perfect",
    "confirmed", "affirmative", "ok", "okay", "sure", "spot", "precisely",
})

# Anything that makes agreement doubtful. A provider who says "yes, I think so"
# has not confirmed a readback, and "yes, but actually it moved again" is a
# correction. Both land here.
HESITATIONS = frozenset({
    "no", "not", "nope", "wrong", "isn", "wasn", "doesn", "don", "actually",
    "maybe", "perhaps", "probably", "think", "guess", "believe", "unsure",
    "sorry", "wait", "hold", "check", "double", "might", "possibly", "roughly",
    "about", "around", "approximately", "usually", "sometimes", "depends",
    # Contrastive and correcting words. "Yes, but it moved again" agrees with
    # the first half of a sentence and not with the change.
    "but", "though", "however", "except", "changed", "change", "moved", "moves",
    "instead", "different", "new", "update", "updated", "correction",
})

DAY_FORMS: dict[str, frozenset[str]] = {
    "MO": frozenset({"mo", "mon", "monday", "mondays"}),
    "TU": frozenset({"tu", "tue", "tues", "tuesday", "tuesdays"}),
    "WE": frozenset({"we", "wed", "weds", "wednesday", "wednesdays"}),
    "TH": frozenset({"th", "thu", "thur", "thurs", "thursday", "thursdays"}),
    "FR": frozenset({"fr", "fri", "friday", "fridays"}),
    "SA": frozenset({"sa", "sat", "saturday", "saturdays"}),
    "SU": frozenset({"su", "sun", "sunday", "sundays"}),
}

NUMBER_WORDS: dict[int, frozenset[str]] = {
    0: frozenset({"0", "zero", "midnight"}),
    1: frozenset({"1", "one"}),
    2: frozenset({"2", "two"}),
    3: frozenset({"3", "three"}),
    4: frozenset({"4", "four"}),
    5: frozenset({"5", "five"}),
    6: frozenset({"6", "six"}),
    7: frozenset({"7", "seven"}),
    8: frozenset({"8", "eight"}),
    9: frozenset({"9", "nine"}),
    10: frozenset({"10", "ten"}),
    11: frozenset({"11", "eleven"}),
    12: frozenset({"12", "twelve", "noon", "midday"}),
    13: frozenset({"13", "thirteen"}),
    14: frozenset({"14", "fourteen"}),
    15: frozenset({"15", "fifteen"}),
    16: frozenset({"16", "sixteen"}),
    17: frozenset({"17", "seventeen"}),
    18: frozenset({"18", "eighteen"}),
    19: frozenset({"19", "nineteen"}),
    20: frozenset({"20", "twenty"}),
    21: frozenset({"21", "twentyone"}),
    22: frozenset({"22", "twentytwo"}),
    23: frozenset({"23", "twentythree"}),
}

# Words too common to carry evidence on their own.
STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "there", "here", "have",
    "has", "are", "was", "were", "will", "you", "your", "our", "not", "but",
    "all", "any", "can", "may", "who", "its", "it", "a", "an", "of", "to", "in",
    "on", "at", "is", "be", "or", "as", "by", "we", "us", "if", "so", "no",
})

SCHEDULE_VALUE = re.compile(
    r"((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*)\s+"
    r"(\d{2}):(\d{2})[-–](\d{2}):(\d{2})"
)

# The proportion of a free-text value's distinctive words that has to reappear in
# the readback. Two thirds tolerates the agent rewording the value; it does not
# tolerate the agent reading back something else.
FREE_TEXT_COVERAGE = 2 / 3

REDACTION_MARKERS = ("[phone redacted]", "[email redacted]")


@dataclass(frozen=True, slots=True)
class ReadbackEvidence:
    """What the transcript does or does not show about one proposed change."""

    corroborated: bool
    reason: str
    readback_quote: str = ""
    confirmation_quote: str = ""

    def as_note(self, field: str) -> str:
        verdict = "corroborated" if self.corroborated else "not corroborated"
        return f"{field}: readback {verdict} in the transcript ({self.reason})"


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _time_forms(hour: str, minute: str) -> frozenset[str]:
    """Surface forms a spoken clock time can take, in 24 and 12 hour readings."""
    hour_value = int(hour)
    forms = set(NUMBER_WORDS.get(hour_value, frozenset()))
    twelve_hour = hour_value % 12 or 12
    forms |= NUMBER_WORDS.get(twelve_hour, frozenset())
    forms.add(f"{hour_value:02d}{minute}")
    forms.add(f"{hour_value}{minute}")
    if minute != "00":
        forms |= {f"{hour_value}", f"{twelve_hour}"}
    return frozenset(forms)


def value_evidence_groups(field: str, value: str) -> list[frozenset[str]]:
    """The things a genuine readback of ``value`` has to contain.

    Each group is a set of acceptable surface forms for one part of the value,
    and every group has to appear. A schedule read back as "Wednesdays, ten in
    the morning to one in the afternoon" satisfies the day group, the opening
    group and the closing group of ``WE 10:00-13:00``; a readback that names the
    right day and the wrong hour satisfies two of three and fails.
    """
    text = (value or "").strip()
    if not text:
        return []

    match = SCHEDULE_VALUE.fullmatch(text)
    if field == "schedule" and match:
        days, open_hour, open_minute, close_hour, close_minute = match.groups()
        groups = [DAY_FORMS[day] for day in days.split(",") if day in DAY_FORMS]
        groups.append(_time_forms(open_hour, open_minute))
        groups.append(_time_forms(close_hour, close_minute))
        return groups

    if field == "status":
        return [frozenset({text.lower(), "closed", "ended", "stopped", "suspended", "inactive"})]

    distinctive = [
        word for word in _words(text)
        if word not in STOPWORDS and (len(word) > 3 or word.isdigit())
    ]
    return [frozenset({word}) for word in distinctive] or [frozenset(_words(text))]


def _hits(groups: list[frozenset[str]], spoken: set[str]) -> int:
    return sum(1 for group in groups if group & spoken)


def _covered(hits: int, total: int, field: str) -> bool:
    """Whether that many parts of the value is enough to call it a full readback."""
    if not total:
        return False
    if field in {"schedule", "status"}:
        return hits == total
    return hits >= max(1, round(total * FREE_TEXT_COVERAGE))


def _affirms(text: str) -> bool:
    spoken = set(_words(text))
    return bool(spoken & AFFIRMATIONS) and not (spoken & HESITATIONS)


def corroborate(
    transcript: list[dict[str, str]], field: str, new_value: str | None
) -> ReadbackEvidence:
    """Look for the readback exchange a `read_back_confirmed` flag claims happened.

    The provider has to have said the new thing first, the assistant has to have
    said the whole value back after that, and the provider has to have agreed
    after that. All three quotes are kept so a curator reviewing the change reads
    the same exchange the machine relied on.
    """
    if not new_value:
        return ReadbackEvidence(False, "there is no value to have read back")
    if not transcript:
        return ReadbackEvidence(False, "no transcript was recorded for this call")

    groups = value_evidence_groups(field, new_value)
    if not groups:
        return ReadbackEvidence(False, "the proposed value carries no words to match")

    turns = [
        (str(turn.get("role", "")), str(turn.get("text", "")))
        for turn in transcript
        if turn.get("text")
    ]
    if field == "phone" and any(
        marker in text.lower() for _, text in turns for marker in REDACTION_MARKERS
    ):
        return ReadbackEvidence(
            False,
            "the transcript redacts phone numbers before it is stored, so a phone readback "
            "cannot be checked against the record",
        )

    # 1. The provider says it first, in their own words. Half the value, rounded
    #    up, is enough here: somebody reporting a change says "they moved it to
    #    ten to one", not the canonical HSDS string. Less than half is not a
    #    statement of the value, it is a word that happens to appear in it.
    source = next(
        (
            index
            for index, (role, text) in enumerate(turns)
            if role in {"provider", "seeker"}
            and _hits(groups, set(_words(text))) >= max(1, (len(groups) + 1) // 2)
        ),
        None,
    )
    if source is None:
        return ReadbackEvidence(
            False,
            "no provider turn states this value, so it did not come from the provider",
        )

    # 2. The assistant says the whole of it back, after that.
    best = 0
    for index in range(source + 1, len(turns)):
        role, text = turns[index]
        if role != "assistant":
            continue
        hits = _hits(groups, set(_words(text)))
        best = max(best, hits)
        if not _covered(hits, len(groups), field):
            continue
        # 3. The provider agrees with the readback, and does not correct it.
        reply = next(
            (
                (position, spoken)
                for position, (speaker, spoken) in enumerate(turns[index + 1:], index + 1)
                if speaker in {"provider", "seeker"}
            ),
            None,
        )
        if reply is None:
            continue
        _, spoken = reply
        if _affirms(spoken):
            return ReadbackEvidence(
                True,
                "the provider stated it, the assistant read the whole value back, and the "
                "provider agreed",
                text,
                spoken,
            )

    if best:
        return ReadbackEvidence(
            False,
            f"the assistant never said the whole value back after the provider raised it "
            f"({best} of {len(groups)} parts matched), or the provider did not plainly agree",
        )
    return ReadbackEvidence(False, "no assistant turn reads this value back")


def quote_supported(transcript: list[dict[str, str]], quote: str) -> bool:
    """Whether the provider actually said something like the quote attributed to them.

    The voice agent supplies a verbatim quote with every proposal. This checks it
    against what the transcript records the provider saying, so `explicitly_confirmed`
    stops being a claim the model makes about itself.
    """
    distinctive = [word for word in _words(quote) if word not in STOPWORDS and len(word) > 3]
    if not distinctive:
        return False
    for turn in transcript:
        if str(turn.get("role")) not in {"provider", "seeker"}:
            continue
        spoken = set(_words(str(turn.get("text", ""))))
        hits = sum(1 for word in distinctive if word in spoken)
        if hits >= max(1, round(len(distinctive) * FREE_TEXT_COVERAGE)):
            return True
    return False


def covers_value(text: str, field: str, value: str) -> bool:
    """Whether one utterance says the whole of a value.

    Used for the other direction of the same evidence rule: a provider who
    agrees with an assistant reading out the value the record already holds has
    confirmed the record, and that also has to be found in the transcript rather
    than reported by the caller.
    """
    groups = value_evidence_groups(field, value)
    if not groups:
        return False
    return _covered(_hits(groups, set(_words(text))), len(groups), field)


def affirms(text: str) -> bool:
    """Whether a reply agrees plainly, with no hedge and no correction."""
    return _affirms(text)
