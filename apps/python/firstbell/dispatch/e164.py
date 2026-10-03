"""One rule for what a diallable destination is, used everywhere a call can be placed.

Two checks decided that question before this file existed, and neither of them answered it.

`sources._split_phones` asks whether a cell contains at least seven ASCII digits somewhere
inside it. That is the right question for a parser, because a district export writes
`+1, 800, 555, 0199` and `(04) 1234-5678` and both of those are one telephone number. It is
the wrong question for a dialler: `ring mum on 5550100301 after three` also contains seven
digits, and what got handed to the platform was the whole cell, sentence included.

`consent.covers_number` compares the two sides on `str.isdigit()`, which is true for
Unicode decimal digits and for superscripts. `unknown2` written with a superscript two
strips to a single character on both sides of that comparison, and two rows carrying it
were one telephone as far as the permission check was concerned.

So the boundary needs a third thing, and it is this one: the exact ASCII E.164 string, or
nothing. `canonical` is deliberately narrow. Anything it cannot reduce to a leading plus, a
country code that does not start with zero, and up to fifteen ASCII digits comes back as
None, and a None at a live boundary is a refusal rather than a guess. A number this rejects
is a number that would otherwise have become a confusing failure several seconds and one
charge later, or worse, a call to somebody the register never named.
"""

from __future__ import annotations

import re

# The grouping characters vendors actually write between the digits of one number. Space,
# tab, hyphen, brackets, full stop, comma and slash all appear in real exports, and each of
# them is noise rather than part of the address. Every one of them is ASCII on purpose:
# an en dash from a locale that autocorrects a typed hyphen, a non-breaking space from a
# spreadsheet, and a zero-width space from a paste are not on this list, so a number
# carrying one is refused rather than silently repaired into a different number.
_GROUPING = " \t-()./,"

# A leading plus, a country code that cannot start with zero, and eight to fifteen digits
# in total. `[0-9]` rather than `\d`, because `\d` on a str pattern matches Eastern Arabic
# and Devanagari numerals, which are not addresses any telephone network carries. `\Z`
# rather than `$`, because `$` also matches immediately before a trailing newline, so
# `+915550000001\n` passed the old check and a newline reached the platform.
_EXACT = re.compile(r"\+[1-9][0-9]{7,14}\Z")


def canonical(raw: object) -> str | None:
    """The exact ASCII E.164 string this text denotes, or None if it denotes none.

    Surrounding whitespace is stripped, because a CSV cell and an argv entry both carry it
    and neither means anything by it. Whitespace *inside* the number is grouping and is
    removed with the rest of `_GROUPING`. Anything left that is not a plus or an ASCII
    digit ends the attempt: there is no repair step, because every repair is a guess about
    which number the operator meant, and the cost of guessing wrong is a stranger's phone
    ringing at seven in the morning about somebody else's child.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text.isascii():
        # Checked before stripping the grouping characters rather than after. A non-ASCII
        # digit that survived into the middle of an otherwise valid number would fail
        # `_EXACT` anyway, but a zero-width space would not: it is neither a digit nor
        # grouping, and reading it as absent is how two visually identical strings become
        # one destination.
        return None
    kept = "".join(ch for ch in text if ch not in _GROUPING)
    if not kept or not _EXACT.fullmatch(kept):
        return None
    return kept


def is_canonical(raw: object) -> bool:
    """Whether this is already the exact string `canonical` would return.

    The difference matters at an assertion. `canonical(x) is not None` says x names a
    reachable number; this says x *is* the address, with no grouping left to remove, which
    is what a payload about to leave the process has to carry.
    """
    return isinstance(raw, str) and canonical(raw) == raw
