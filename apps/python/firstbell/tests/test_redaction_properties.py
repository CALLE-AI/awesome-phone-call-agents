"""Redaction, checked against a generated corpus rather than against a handful of examples.

`redact` is the only thing standing between a number CALL-E quotes back in an error message
and a receipt somebody commits. The tests that existed for it named a few shapes: a bare
number, one with spaces, one with commas. A rule that has only been tried on the shapes its
author thought of is a rule whose edges nobody has looked at, and the edge is where a leak
lives. The comma was added to `_LONG_DIGIT_RUN` only after a vendor grouped a number with
commas, broke the run into pieces shorter than the seven-digit floor, and let every piece
through.

So this builds the shapes instead of listing them: every documented separator, at every
grouping boundary, inside every context the string is known to arrive in, and it asserts a
property rather than an expected string. `hypothesis` is not installed here, so the corpus
is generated from a fixed seed. Fixed, because a redaction test that passes on Tuesday and
fails on Wednesday teaches nobody anything, and a counterexample nobody can reproduce is
not a counterexample.

Every number is built at runtime from `tests/fixtures.py`, so no digit string that could
reach a subscriber is written down anywhere in this file.

The invariant is restated here rather than imported. Asserting with the module's own
`_LONG_DIGIT_RUN` would ask the implementation whether it agrees with itself, and it always
will. `_phone_shaped_runs` is written from the docstring's promise instead, so the two are
able to disagree.
"""
from __future__ import annotations

import random
import re
from typing import Any, Iterator

import pytest

from dispatch.models import mask, redact, redact_free_text
from tests.fixtures import india

# The separators `redact` promises to hold a run together across, taken from its own
# docstring: "a number written 04 1234 5678, (04) 1234-5678 or +1, 800, 555, 0199 is still
# caught". Whitespace is spelled out one character at a time because a vendor that wraps a
# long error message inserts a newline, and a non-breaking space is what arrives when the
# message has been through anything that renders HTML.
SEPARATORS = (" ", "-", ".", ",", ", ", " - ", "\t", "\n", "\r\n", "\xa0", ") ", " (")

# The floor `redact` documents: seven digits, shorter than any diallable number and longer
# than a SIP code, an HTTP status or the string "E.164".
FLOOR = 7

# A maximal stretch of digits and those separators. Written from the promise rather than
# imported, so that this file can contradict the implementation.
RUN = re.compile(r"[\d\s(),.\-]+")

# The contexts the string actually arrives in. The first two are the ones that leaked:
# CALL-E rejects a number and quotes it back inside `failure_message`, which this app used
# to store, print and write into a receipt unchanged.
CONTEXTS = (
    "{}",
    "invalid_phone: could not ring {}",
    "The number {} is not in a supported region.",
    "phone={}&key=redacted",
    "recipient {} failed after 3 attempts",
    "{} / {}",
)


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


def _phone_shaped_runs(text: str) -> list[str]:
    """Every stretch of the text that is digits joined by nothing but separators."""
    return [run for run in RUN.findall(text) if len(_digits(run)) >= FLOOR]


def _subscriber_part(number: str) -> str:
    """What `mask` is supposed to destroy: everything but the first three and last two."""
    return _digits(number)[3:-2]


def _written_forms(number: str, rng: random.Random) -> list[str]:
    """The same number written the ways a person and a vendor write it."""
    digits = _digits(number)
    cuts = sorted(rng.sample(range(2, len(digits) - 1), k=3))
    groups = [digits[:cuts[0]], digits[cuts[0]:cuts[1]],
              digits[cuts[1]:cuts[2]], digits[cuts[2]:]]
    forms = [lead + separator.join(groups)
             for separator in SEPARATORS for lead in ("+", "", "00")]
    forms.append("(" + groups[0] + ") " + " ".join(groups[1:]))
    return forms


def _corpus() -> list[tuple[str, str]]:
    """(the number that went in, the string it went in inside)."""
    rng = random.Random(20260905)
    pairs = []
    for _ in range(40):
        # A wide spread inside the fictional +91 555 block, so that no two numbers share a
        # subscriber part. Numbers that differ only in their last digits would make this
        # forty repetitions of one case.
        number = india(rng.randrange(1_000_000, 9_999_999))
        for written in _written_forms(number, rng):
            for context in CONTEXTS:
                pairs.append((number, context.replace("{}", written)))
    return pairs


CORPUS = _corpus()


def test_the_corpus_is_big_enough_to_be_measuring_something():
    """A property test over an empty list is a test that passes by reading nothing.

    This project has already shipped one check that looped over zero files and reported the
    tree clean, so the corpus is asserted before anything is asserted with it.
    """
    assert len(CORPUS) > 1000, f"only {len(CORPUS)} generated strings"
    assert len({n for n, _ in CORPUS}) >= 35, "the numbers collided; this is one case, not 40"
    assert len({_subscriber_part(n) for n, _ in CORPUS}) >= 35, (
        "the subscriber parts collided, so a leak of one would look like a leak of all"
    )
    assert any("\xa0" in text for _, text in CORPUS), "the non-breaking space arm is missing"
    assert all(_phone_shaped_runs(text) for _, text in CORPUS), (
        "some generated strings hold nothing phone-shaped, so redacting them proves nothing"
    )


def test_no_written_form_of_a_number_survives_redaction():
    """The property: whatever the separators, the subscriber digits do not come out."""
    leaked = [text for number, text in CORPUS
              if _subscriber_part(number) in _digits(redact(text))]
    assert not leaked, (
        f"{len(leaked)} of {len(CORPUS)} written forms kept their subscriber digits. "
        f"First few: {leaked[:5]!r}"
    )


def test_nothing_phone_shaped_is_left_anywhere_in_the_output():
    """Stated as an invariant of the output rather than as a fact about the input.

    The test above has to know which number went in. This one does not, so it also covers
    the case where masking one run leaves a second one beside it untouched, which is what
    `{} / {}` is in the corpus for.
    """
    survivors = [(text, remaining) for _, text in CORPUS
                 if (remaining := _phone_shaped_runs(redact(text)))]
    assert not survivors, (
        f"{len(survivors)} outputs still hold a phone-shaped run: {survivors[:3]!r}"
    )


def test_redaction_is_idempotent():
    """Masking twice must not move the digits that survive.

    `mask` keeps the first three characters and the last two. A redactor that still saw a
    run in its own output would keep a different three and a different two, so a receipt
    written after a retry would disagree with the one written the first time.
    """
    unstable = [text for _, text in CORPUS if redact(redact(text)) != redact(text)]
    assert not unstable, f"{len(unstable)} strings change on a second pass: {unstable[:3]!r}"


def test_a_run_below_the_floor_is_left_alone():
    """The other half of the rule, and the half that keeps the output readable.

    Without this, "seven digits" is asserted in one direction only and a redactor that
    masked everything would pass. A SIP code, an HTTP status and a count have to survive,
    because they are what an administrator reads when a call fails.

    A date does not survive, and that is deliberate rather than an omission here: `redact`
    documents that a timestamp inside a long run loses its digits too, and buys a rule with
    no exceptions to get wrong. Asserting the loss keeps this test honest about the cost.
    """
    for text in ("code 603", "HTTP 404 from the API", "attempt 3 of 4", "E.164",
                 "concurrency 4, limit 12", "resolved 12, undetermined 3", "$0.67 per call"):
        assert redact(text) == text, f"{text!r} was masked and it is not phone-shaped"
    assert redact("2026-09-05") != "2026-09-05", (
        "an eight-digit run is masked whether or not it is a number; if that changed, the "
        "docstring's stated tradeoff changed with it"
    )


@pytest.mark.parametrize("length", range(0, 20))
def test_mask_shows_the_ends_and_destroys_the_middle(length):
    """The shape of the mask itself, at every length including the boundary.

    Length is preserved on purpose: a receipt says how long the number was, which is enough
    to tell a ten-digit mobile from a five-digit shortcode and not enough to dial either.
    """
    value = "".join(str((i * 7) % 10) for i in range(length))
    out = mask(value)
    assert len(out) == len(value), "the mask changed the length"
    if length <= 5:
        assert out == "*" * length, "a short value must not show any of itself"
    else:
        assert out[:3] == value[:3] and out[-2:] == value[-2:]
        assert set(out[3:-2]) == {"*"}, "something other than a star survived the middle"


def _strings_in(node: Any) -> Iterator[str]:
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield from _strings_in(key)
            yield from _strings_in(value)
    elif isinstance(node, (list, tuple)):
        for value in node:
            yield from _strings_in(value)


def _nested(rng: random.Random, depth: int, planted: str) -> Any:
    """A structure shaped like a result CALL-E returns, with a number somewhere in it."""
    if depth == 0:
        return rng.choice([planted, f"said {planted} twice: {planted}", "unknown", 7, None])
    children = [_nested(rng, depth - 1, planted) for _ in range(rng.randint(1, 3))]
    kind = rng.choice(("dict", "list", "tuple"))
    if kind == "dict":
        return {f"field_{i}": child for i, child in enumerate(children)}
    return children if kind == "list" else tuple(children)


def test_redact_free_text_reaches_a_string_at_any_depth_and_in_any_container():
    """A structured result is the vendor's account of what a person said out loud.

    Nothing constrains its shape: `_extract_result` returns whatever the response carried,
    so the guarantee cannot be "the fields we know about are redacted". It has to be every
    string anywhere inside it, at any depth, in any container. That is generated here
    rather than listed, because the shapes a model returns are not a list anybody holds.

    The check walks the returned structure and reads only its strings. Flattening it with
    `repr` would let the digits of a container index join a number and report a leak that
    is not there.
    """
    rng = random.Random(20260905)
    number = india(4_812_357)
    subscriber = _subscriber_part(number)
    planted, checked = 0, 0
    for _ in range(200):
        structure = _nested(rng, rng.randint(1, 4), number)
        if number not in list(_strings_in(structure)) and not any(
                number in s for s in _strings_in(structure)):
            continue
        planted += 1
        for text in _strings_in(redact_free_text(structure)):
            checked += 1
            assert subscriber not in _digits(text), (
                f"a number survived redaction at {text!r} in {structure!r}")
    assert planted > 50, (
        f"only {planted} of 200 generated structures held the number, so this mostly "
        "asserted nothing"
    )
    assert checked > planted, "the walk read fewer strings than structures it went into"


def test_redact_free_text_returns_the_same_shape_it_was_given():
    """Redaction may not quietly restructure a receipt.

    A tuple becomes a list, because JSON has no tuple and the receipt is JSON. Everything
    else keeps its container and its keys, and a value that is not a string comes back
    unchanged rather than stringified: a confidence of 0.82 must not become "0.82".
    """
    given = {"a": ["x", ("y", "z")], "b": {"c": "d"}, "n": 7, "f": 1.5,
             "t": True, "z": None}
    assert redact_free_text(given) == {
        "a": ["x", ["y", "z"]], "b": {"c": "d"}, "n": 7, "f": 1.5,
        "t": True, "z": None,
    }
    assert redact_free_text(()) == []
    assert redact_free_text("") == ""
    assert redact_free_text(None) is None


def test_the_error_message_that_actually_leaked_is_covered():
    """The regression, kept beside the generated corpus rather than replaced by it.

    CALL-E answers an unroutable number with a message quoting it. That message was stored
    verbatim, printed to stdout and written to a receipt. It is why `redact` exists, so it
    is asserted by name and not left to the generator to happen to produce.
    """
    number = india(2_390_144)
    message = f"invalid_phone: '{number}' is not a valid E.164 number"
    out = redact(message)
    assert _subscriber_part(number) not in _digits(out)
    assert "invalid_phone" in out, "the code beside the number is the useful half"
    assert "E.164" in out, "a fixed vocabulary must survive"


# The separators a spreadsheet introduces on its own. Word and Excel autocorrect a typed
# hyphen to an en dash between digits in several locales, a pasted number arrives carrying a
# zero-width space, and a vendor export writes a slash. None of these are in the ASCII class
# the implementation started with, so each one broke a number into runs under the floor and
# nothing was masked. Held apart from SEPARATORS because that tuple is the promise the
# docstring makes and this one is the promise it should have made.
WIDER_SEPARATORS = ("–", "—", "−", "/", "_", "​", "·", "|")


@pytest.mark.parametrize("sep", WIDER_SEPARATORS)
def test_a_separator_a_spreadsheet_writes_does_not_defeat_the_mask(sep):
    """A number grouped by a non-ASCII separator must still be masked.

    The floor is what makes widening safe: `hide` refuses to mask any run carrying fewer
    than seven digits and returns it unchanged, so admitting more separator characters can
    only ever catch more numbers and can never mask a SIP code or an HTTP status.
    """
    number = india(2_390_144)
    grouped = sep.join((number[:3], number[3:7], number[7:]))
    message = f"invalid_phone: '{grouped}' is not a valid E.164 number"
    out = redact(message)
    assert _subscriber_part(number) not in _digits(out), (
        f"a number separated by {sep!r} passed through unmasked")
    assert "invalid_phone" in out


def test_widening_the_class_still_refuses_to_mask_a_short_code():
    """The guard that makes the wider class safe, asserted directly."""
    for short in ("E.164", "SIP 486", "HTTP 503", "attempt 2 of 3"):
        assert redact(short) == short


def test_no_model_prints_a_raw_number_or_a_transcript_through_its_repr():
    """A default dataclass repr is a sink nobody chose and every debugger reaches.

    `masked_numbers` is the only serialised view, so no production path formats one of
    these today. That is what makes it worth closing now rather than after: one `print`,
    one error reporter that captures locals, or one assertion message on a live run turns
    a latent field into a leak, and the transcript rides out with it.
    """
    from dispatch.models import ItemResult, Resolution, WorkItem

    number = india(2_390_144)
    item = WorkItem(id="S-1", phones=(number,))
    said = "my mother's number is " + india(2_390_145)
    result = ItemResult(
        item=item, resolution=Resolution.RESOLVED,
        numbers_tried=(number,),
        transcript=({"speaker": "guardian", "text": said},),
    )

    for shown in (repr(item), repr(result), f"{item}", f"{result}"):
        assert _subscriber_part(number) not in _digits(shown), (
            "a raw telephone number reached a repr")
        assert "mother's number" not in shown, "a transcript reached a repr"

    assert "S-1" in repr(item), "the id has to survive or the repr is useless for debugging"


def test_a_schema_complaint_does_not_carry_the_value_it_is_complaining_about():
    """The third instance of one bug, found after two fixes of the same shape.

    `problems()` names the off-enum value so an operator can see what arrived. CALL-E fills
    these fields from what a person said, and a guardian reading out a callback number is
    the obvious way a number lands in one. That complaint became `reason`, and `reason` was
    written into the receipt raw, one line below `structured_result`, which is redacted for
    exactly this reason.
    """
    from dispatch.scheduler import WaveDispatcher
    from firstbell.domain import RESULT_SCHEMA
    from dispatch.models import WorkItem

    number = india(2_390_144)
    dispatcher = WaveDispatcher(client=object(), task_builder=lambda item: "task",
                                result_schema=RESULT_SCHEMA)
    out = dispatcher._classify(
        WorkItem(id="S-1", phones=("+915550000001",)),
        {"id": "c", "status": "completed", "structured_result": {
            "reason_category": f"ring back on {number}", "expected_return": "tomorrow"}},
        placed_id="c")

    assert _subscriber_part(number) not in _digits(out.reason), (
        "the number the parent read out reached `reason`, which the receipt writes raw")
    assert "reason_category" in out.reason, "the useful half of the complaint must survive"
