"""Per-call freshness challenge.

A recorded greeting cannot answer a question minted seconds ago. That is the
only thing the nonce proves, and it is the only thing it is used for.

Matching happens here, in code. The model reports the words it heard; it is
never asked whether they were correct.
"""

from __future__ import annotations

import random
import unicodedata
from datetime import date

from .models import Nonce, Observations

#: Short, common, phonetically distinct words: easy to hear on a poor line and
#: easy to say for an elderly speaker. No clusters, no rare vocabulary.
WORD_POOL: tuple[str, ...] = (
    "river", "table", "yellow", "garden", "window", "silver", "orange",
    "mountain", "candle", "harbour", "letter", "morning", "basket", "copper",
    "meadow", "lantern", "pepper", "ribbon", "summer", "walnut",
)

WEEKDAYS: tuple[str, ...] = (
    "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday",
)


def mint(when: date, rng: random.Random | None = None) -> Nonce:
    """Mint a nonce for one call. `when` fixes the expected weekday."""
    picker = rng or random.SystemRandom()
    words = tuple(picker.sample(WORD_POOL, 3))
    return Nonce(words=words, weekday=WEEKDAYS[when.weekday()])


def normalise(text: str) -> str:
    """Fold case, accents and punctuation, so ASR spelling never fails a living
    person."""
    decomposed = unicodedata.normalize("NFKD", text.strip().lower())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return "".join(c for c in stripped if c.isalnum())


def _words_match(expected: tuple[str, ...], heard: tuple[str, ...]) -> bool:
    """Order matters: it is what separates a live reply from an echo.

    Words around the sequence are tolerated, because people say
    "right, um, river, table, yellow".
    """
    wanted = [normalise(w) for w in expected]
    spoken = [normalise(w) for w in heard if normalise(w)]
    if len(spoken) < len(wanted):
        return False
    for start in range(len(spoken) - len(wanted) + 1):
        if spoken[start : start + len(wanted)] == wanted:
            return True
    return False


def check(nonce: Nonce, observed: Observations) -> bool:
    """True only when the echo and the weekday were both satisfied."""
    if not _words_match(nonce.words, observed.nonce_words_heard):
        return False
    return normalise(observed.weekday_heard) == normalise(nonce.weekday)


def check_reversed(nonce: Nonce, observed: Observations) -> bool:
    """True when the three words came back in reverse order.

    Echoing forwards is something a recording or an inattentive parrot can do.
    Reversing requires having understood the instruction, so this is the
    stronger of the two legs -- and unlike a knowledge challenge it collects no
    personal information at all, which is what allows it to be asked on a
    platform that refuses security questions.
    """
    return _words_match(nonce.reversed_words, observed.nonce_words_reversed_heard)
