"""No surface says a real call was placed in Spanish, because none was.

Act 07 shows CALL-E refusing Spanish, and the refusal comes from `calle_double`, which
raises `unsupported_language` out of the region table transcribed from CALL-E's own
published "Supported regions and languages" list. A reader reproduces it offline with no
account. Every real call this entry has placed went to Indian numbers, in English and Tamil.

This gate exists because the sentence "act 07 shows the platform refusing Spanish on a real
run" was proposed by a reviewer, accepted, written into the page and the README, and only
then checked. Nothing in the suite would have caught it. It is the entry's own failure mode
arriving in the words of somebody grading the entry, which is the most persuasive form it
takes, so the claim now carries a check like every other one.

Two halves, and the second is what keeps the first from going stale. The rule is enforced
only while CALL-E offers no Spanish for the country the entry is priced in; if the region
table ever gains it, this says so rather than quietly policing a limit that has lifted.
"""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from calle_double import regions  # noqa: E402

# "a real call in Spanish", "a live Spanish run", "Spanish, on a real call". Written as two
# orders because the halves swap freely in prose, and a gate with one direction is a gate
# that catches the wording you happened to think of. That lesson cost four survivors.
CLAIMED = re.compile(
    r"(?:\breal\b|\blive\b)[^.;:!?]{0,40}?\b(?:call|calls|run|runs)\b[^.;:!?]{0,60}?\bSpanish\b"
    r"|\bSpanish\b[^.;:!?]{0,60}?(?:\breal\b|\blive\b)[^.;:!?]{0,40}?\b(?:call|calls|run|runs)\b",
    re.I)

# The sentence that says no such call was placed reads as a denial, so it is not a claim.
# "no real call", "not a real call", "never placed".
#
# "refuse" is deliberately not in this list, though it was for one draft. Every sentence
# here is about a refusal, honest and dishonest alike, so excusing the word excused the whole
# subject: "prints the platform refusing Spanish on a real call" walked through untouched.
# A denial has to deny the thing being claimed, and "refused" denies nothing about whether a
# telephone rang.
A_DENIAL = re.compile(r"\b(?:no|not|never|nobody|without|cannot|could not)\b", re.I)


def _sentence(flat: str, start: int, end: int) -> str:
    """The whole sentence a match sits in, on both sides of it.

    A denial has no fixed side. It sits in front of the words it denies in the README's "No
    real call has been placed in Spanish", which is the sentence this gate exists to protect,
    and behind them in the ledger's "it said act 07 shows the platform refusing Spanish on a
    real run, which it does not", which is the ledger recording the defect the gate catches.
    A backward-only window flagged the second. A gate with one direction catches the wording
    you happened to think of, which is the third time that has been true in this suite.
    """
    before = flat[max(0, start - 140):start]
    cut = max(before.rfind(mark) for mark in ".;:!?")
    after = flat[end:end + 140]
    stop = min((i for i in (after.find(mark) for mark in ".;!?") if i >= 0), default=-1)
    return (before[cut + 1:] if cut >= 0 else before) + flat[start:end] + (
        after[:stop] if stop >= 0 else after)


def _surfaces() -> list[tuple[str, str]]:
    """Every document a reader meets, plus the built page when there is one.

    Two rows of `evidence/MUTATIONS.md` record this exact overclaim, because putting it back
    is how the gate below was shown to fire. So does the page's rendering of that table. A
    scanner that reads its own rule description as a violation of the rule fails on the
    honest ledger and cannot be made to pass without deleting the evidence, which is the
    third time that shape has come up in this repository.

    The rows are cut before anything is matched, and only for those two surfaces. The
    README makes real claims inside tables, so its rows stay.
    """
    found: list[tuple[str, str]] = []
    for rel in ["README.md", "call-e-feedback.md", "evidence/README.md",
                "evidence/MUTATIONS.md"]:
        path = APP / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if rel == "evidence/MUTATIONS.md":
            text = "\n".join(ln for ln in text.splitlines() if not ln.startswith("|"))
        found.append((rel, text))
    for path in sorted((APP / "docs").glob("*.md")):
        found.append((f"docs/{path.name}", path.read_text(encoding="utf-8", errors="replace")))

    page = APP / "out" / "index.html"
    if page.is_file():
        # Flattened, because the page writes this sentence with a link in the middle of it
        # and a byte-level scan reads straight past `<a href="#act-07">act 07</a>`.
        markup = re.sub(r"<tr>.*?</tr>", " ", page.read_text(encoding="utf-8",
                                                             errors="replace"), flags=re.S)
        found.append(("out/index.html", html.unescape(re.sub(r"<[^>]+>", " ", markup))))
    return found


def test_the_united_states_still_offers_only_english():
    """The precondition, asserted rather than assumed.

    Every figure in this entry is priced American, and the reason a Spanish call cannot have
    happened on the priced path is that CALL-E's table gives the United States one language.
    Read it rather than remember it: a table that gains Spanish makes the gate below a rule
    about nothing, and this is what says so.
    """
    us = regions.REGIONS["US"]
    assert us.languages == ("English",), (
        f"CALL-E's region table now offers {', '.join(us.languages)} for the United States. "
        "The gate below refuses any claim of a real call in Spanish, which was written "
        "because no such call could be placed on the priced path. Re-read it against the "
        "new table rather than deleting it.")


def test_nothing_claims_a_real_call_was_placed_in_spanish():
    """Every document, and the page when it has been built."""
    claiming = []
    for where, body in _surfaces():
        flat = re.sub(r"\s+", " ", body)
        for found in CLAIMED.finditer(flat):
            phrase = found.group(0)
            if A_DENIAL.search(_sentence(flat, found.start(), found.end())):
                continue
            claiming.append(f"{where}: " + phrase[:150])

    assert not claiming, (
        "these say a real or live call happened in Spanish, and none did:\n  "
        + "\n  ".join(claiming)
        + "\n\nThe refusal in act 07 is produced by calle_double from the region table "
        "transcribed out of CALL-E's published list, which is why a reader can reproduce it "
        "with no account. Every real call this entry has placed went to Indian numbers. Say "
        "what the run "
        "does, or place the call.")
