"""Reading the answer -- the part that decides whether a call counted.

Indian tele-recruitment data is blunt about this: roughly 76% of answered calls
produce a "yes" and under 10% of those yeses produce a donation. The gap is not
dishonesty. It is politeness. "Haan, koshish karunga" -- yes, I'll try -- is a
courteous way of saying no, and a caller ticking a yes/no box records it as a
yes. The register then shows ninety confirmed donors and nine turn up.

So the bar here is deliberately higher than agreement: a confirmation requires a
specific arrival window. "Yes, I'll come sometime" is not a commitment. "Yes,
9 to 11 tomorrow morning" is. Everything in between is unclear, and unclear is
not a yes -- but it is not a no either, so the donor stays in the register,
uncounted, and the cascade moves to the next person.

This grader is the deterministic reference used by the fixture harness and as a
fallback. On a live call the authoritative reading is the agent applying
references/reading-the-answer.md to the transcript, because a hedge can be
carried entirely by tone and word order. When the two disagree, take the
stricter of the two.
"""

from __future__ import annotations

import re

from .order import CONFIRMED, DECLINED, NO_ANSWER, UNCLEAR

# Hedges outrank agreement. "Yes, maybe I'll try" is unclear, not confirmed.
# Hindi and Tamil forms are included romanised because that is how they arrive
# in a transcript.
HEDGES: tuple[str, ...] = (
    "maybe", "may be", "i'll try", "ill try", "will try", "try to", "let's see",
    "lets see", "we'll see", "probably", "might", "if possible", "if i can",
    "hopefully", "i think so", "should be able", "not sure", "see how",
    "call me later", "let you know", "text me", "i'll check", "have to check",
    "koshish", "dekhenge", "dekhta", "dekhti", "ho sakta", "shayad", "agar",
    "paarkalam", "paarpom", "try pannuren", "theriyala",
)

DECLINES: tuple[str, ...] = (
    "no thanks", "not interested", "can't", "cant", "cannot", "not able",
    "unable", "don't want", "dont want", "won't", "wont be able", "busy",
    "out of town", "travelling", "traveling", "remove me", "stop calling",
    "do not call", "nahi", "nahin", "mat karo", "illa", "mudiyathu", "venda",
)

AFFIRMATIONS: tuple[str, ...] = (
    "yes", "yeah", "yep", "sure", "of course", "certainly", "definitely",
    "i will come", "i'll come", "ill come", "i can come", "i'm coming",
    "im coming", "count me in", "happy to", "no problem", "ok", "okay",
    "haan", "haa", "ji haan", "bilkul", "aa jaunga", "aa jaungi", "aunga",
    "vanthu", "varen", "sari", "seri",
)

# Opt-out is not a decline. It is a standing instruction that outranks the run.
OPT_OUT: tuple[str, ...] = (
    "remove me", "stop calling", "do not call", "don't call me", "unsubscribe",
    "take me off", "mat karo", "phone mat",
)

# A window needs a clock time. "Tomorrow morning" is a sentiment, not a slot --
# it is exactly the kind of soft agreement that shows up as a no-show.
_TIME = re.compile(
    r"(?:\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?|o'?clock|baje|mani)\b)"
    r"|(?:\b\d{1,2}\s*(?:to|-|–|until|till)\s*\d{1,2}\b)",
    re.IGNORECASE,
)


def _contains(text: str, needles: tuple[str, ...]) -> str | None:
    for n in needles:
        if n in text:
            return n
    return None


def has_arrival_window(text: str) -> bool:
    return bool(_TIME.search(text or ""))


def grade(text: str | None, *, answered: bool = True) -> tuple[str, str]:
    """Grade one donor reply. Returns (state, the phrase that decided it).

    Order matters and is the safety argument: opt-out first, then decline, then
    hedge, and only then agreement. Agreement is checked last so that it can
    never override a hedge sitting in the same sentence.
    """
    if not answered:
        return NO_ANSWER, "no answer"
    t = (text or "").strip().lower()
    if not t:
        return UNCLEAR, "empty reply"

    if (marker := _contains(t, OPT_OUT)) is not None:
        return DECLINED, f"opt-out: {marker}"
    if (marker := _contains(t, DECLINES)) is not None:
        return DECLINED, f"decline: {marker}"
    if (marker := _contains(t, HEDGES)) is not None:
        return UNCLEAR, f"hedge: {marker}"
    if (marker := _contains(t, AFFIRMATIONS)) is not None:
        if has_arrival_window(t):
            return CONFIRMED, f"agreement with window: {marker}"
        return UNCLEAR, f"agreement without a specific arrival window: {marker}"
    return UNCLEAR, "no recognisable commitment"


def wants_opt_out(text: str | None) -> bool:
    """Whether this reply must be written back to the register as an opt-out."""
    return _contains((text or "").lower(), OPT_OUT) is not None

