"""The video is not allowed to type a number or a colour it could have counted.

`video/captions.py` in the workshop rendered a caption plate reading "The suite goes from
78 passing to a failure that names itself" and "Thirteen rules were checked this way". Both
were true once. By the time anybody looked the suite was three hundred and the mutation
table held a hundred and thirty-eight rows, and neither figure had any way of finding out,
because it had been typed into a string and then baked into a PNG.

No gate in this repository could have caught that and none can catch it now: the video is
built outside this tree and the plate is a picture. What can be gated is the thing the
video reads. `tools/video_facts.py` computes every number and every colour from the
artifact it describes, and these tests are what stop somebody quietly restoring a constant
to make a build go through.

The palette half matters for a different reason. The page's inks live in `page.css` and the
video's had been retyped into a Python file beside it, so a re-cut on the page left the
video a hue behind with nothing to say so. Reading one from the other makes them one value.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP / "tools"))

import video_facts  # noqa: E402


def test_the_palette_is_the_pages_palette_and_not_a_copy_of_it():
    """Every colour the video paints with resolves to a token defined in the stylesheet.

    This is the drift gate. If somebody renames `--resolved` in `page.css`, the video must
    fail loudly on the next build rather than render a card in whatever the old constant
    happened to be.
    """
    css = (APP / "tools" / "site" / "page.css").read_text(encoding="utf-8")
    palette = video_facts.palette()

    assert palette, "the video was handed an empty palette, which nothing would notice"

    for name, value in palette.items():
        assert re.search(rf"^\s*--{re.escape(name)}\s*:", css, re.MULTILINE), (
            f"the video paints with --{name}, which page.css no longer defines. A colour "
            "the stylesheet has forgotten is a colour the page and the video disagree about."
        )
        assert re.fullmatch(r"#[0-9A-F]{6}", value), (
            f"--{name} resolved to {value!r}, which is not a colour Remotion or Pillow can "
            "use. The conversion produced something neither renderer will accept."
        )


def test_no_colour_the_video_uses_is_written_into_the_deriving_module():
    """A hex literal in `video_facts.py` is a colour that stopped being derived.

    The module converts oklch to sRGB, so it is full of conversion coefficients, and those
    are arithmetic rather than colour. What must never appear is a `#RRGGBB` literal: the
    only honest source of one is the stylesheet.
    """
    source = (APP / "tools" / "video_facts.py").read_text(encoding="utf-8")

    # The format string that builds a colour is not a colour. Everything else that looks
    # like one is.
    source = source.replace('"#%02X%02X%02X"', " ")
    literals = re.findall(r"#[0-9A-Fa-f]{6}\b", source)

    assert not literals, (
        f"tools/video_facts.py contains the colour literals {sorted(set(literals))}. The "
        "module exists so the video reads its colours off page.css; a literal here is the "
        "drift it was written to stop."
    )


def test_no_count_the_video_states_is_written_into_the_deriving_module():
    """The same rule for the counts, which is the pair that actually rotted.

    `78` and `thirteen` were typed into a caption once. Any integer literal sitting next to
    a word like `tests` or `mutations` here would be the same mistake wearing the clothes of
    a fix.
    """
    source = (APP / "tools" / "video_facts.py").read_text(encoding="utf-8")

    offenders = []
    for number, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith('"'):
            continue
        if not re.search(r"\b(tests?|mutations?|gates?|rows?)\b", stripped, re.I):
            continue
        # Indices and slice bounds are not claims about the repository.
        candidate = re.sub(r"\[[^\]]*\]", " ", stripped)
        if re.search(r"=\s*\d+\b", candidate):
            offenders.append(f"line {number}: {stripped[:70]!r}")

    assert not offenders, (
        "a count is assigned as a constant in the module whose whole job is to measure "
        "one:\n  " + "\n  ".join(offenders)
    )


def test_the_counts_are_the_numbers_the_rest_of_the_suite_already_agrees_on():
    """Cross-check against the readers the page uses, so two things must move together."""
    from judge_page import mutation_rows

    # The sibling twenty lines down guards for exactly this file and this one did not, so on
    # a fresh clone `browser_gate_count()` did the right thing, refused with "cannot be
    # measured", and failed a test that had no way to know the report was absent. The gate
    # report is a build artifact and is not committed on purpose.
    if not (APP / "tools" / "gates" / "gate-report.json").exists():
        pytest.skip("no gate report; run node tools/gates/run.mjs first")

    facts = {
        "mutations": video_facts.mutation_count(),
        "gates": video_facts.browser_gate_count(),
    }

    assert facts["mutations"] == len(mutation_rows()), (
        "the video would state a different number of mutation rows than the page does"
    )

    passed, ran = facts["gates"]
    assert ran > 0, "the gate report named zero gates, which is a measurement failure"
    assert 0 <= passed <= ran, f"{passed} of {ran} gates passed, which cannot be true"


def test_a_missing_gate_report_refuses_rather_than_reporting_zero():
    """The third outcome, on the one number that could silently become zero.

    `browser_gate_count` reads a file this repository does not commit. The tempting
    implementation returns 0 when it is absent, and then a video renders "0 of 0 browser
    gates" and looks like a project with no gates at all rather than a build that could not
    measure.
    """
    report = APP / "tools" / "gates" / "gate-report.json"
    if report.exists():
        pytest.skip("the gate report is present, so the absent branch cannot be exercised")

    with pytest.raises(SystemExit) as caught:
        video_facts.browser_gate_count()

    assert "cannot be measured" in str(caught.value)


def test_the_video_is_never_handed_a_whole_call_identifier():
    """The masking that reached the page had never reached the video.

    Ledger row 132 closed Must Fix 1 by stripping whole call identifiers at the source "so
    a new surface cannot reintroduce a whole one". The video was exactly that new surface.
    `video/panels.py` in the workshop printed three of them at full length onto a
    1920x1080 plate, for months, because it is built outside this
    tree and holds its own copies.

    Masking on the way out would not have helped: the caller still held the whole value.
    So the contract hands over identifiers that are already short, and this is the test
    that keeps them that way.
    """
    from judge_page import mask_id

    receipts = next(
        (base for base in (Path(os.environ.get("FIRSTBELL_RECEIPTS") or "nowhere"),
                           APP / "evidence" / "receipts")
         if base.is_dir()),
        None,
    )
    if receipts is None:
        pytest.skip("the receipts are held outside this repository and are not here")

    whole = set()
    for path in sorted(receipts.glob("0*.json")):
        import json

        for item in json.loads(path.read_text(encoding="utf-8")).get("items", []):
            if item.get("call_id"):
                whole.add(item["call_id"])

    assert whole, "no call identifiers were read, so this test proved nothing"

    emitted = video_facts.calls(receipts)
    assert emitted, "the call panels would be handed nothing to print"

    text = str(emitted)
    leaked = sorted(one for one in whole if one in text)
    assert not leaked, (
        "the document the video build reads contains whole call identifiers: "
        f"{leaked}. Mask them where they are read, not where they are printed."
    )

    for work_item, call in emitted.items():
        assert call["call_id_masked"] == mask_id(call["call_id_masked"]) or "…" in (
            call["call_id_masked"]
        ), f"{work_item} carries an identifier that was never masked"
