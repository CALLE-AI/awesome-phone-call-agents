"""Every line this page prints in a language other than English carries its English.

The organiser's Language Requirements rule permits a submission in another language when an
English translation accompanies the video, the text description, the testing instructions
"as well as all other materials submitted". Four of the eight committed calls were placed in
Tamil, because a school that serves families who do not read English is the case this
software exists for and a demo in one language would have dodged it. That makes the
translation a requirement rather than a courtesy, and requirements that live only in a
person's memory are the ones that ship broken.

The page writes a transcript three ways: `turns_markup` builds the duet lane, `player.js`
rebuilds the scene from the JSON island, and the island is itself a published file a reader
can open. This checks all three, because glossing one of them and not the others is the same
failure as glossing none, only harder to see.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

APP = Path(__file__).resolve().parent.parent
GLOSSES = APP / "tools" / "glosses.json"
PAGE = APP / "out" / "index.html"

TAMIL = re.compile(r"[஀-௿]")
ISLAND = re.compile(r"<script id=call-data type=application/json>(.*?)</script>", re.S)
TURN = re.compile(r"<li data-at=.*?</li>", re.S)


def gloss_table() -> dict:
    return json.loads(GLOSSES.read_text(encoding="utf-8"))["calls"]


def island() -> dict:
    """The published call data, read off the built page.

    The skip belongs to the test rather than to this helper. A helper that skips is a test
    that can stop running under a name no register of could-not-measure gates would list,
    and this repository holds a rule that every skip is declared by the name it skips under.
    """
    found = ISLAND.search(PAGE.read_text(encoding="utf-8"))
    assert found, "the page no longer carries a call-data island"
    return json.loads(found.group(1))


def test_the_gloss_file_says_where_its_english_came_from():
    """Provenance, in the file rather than in a commit message nobody reads.

    The English was written afterwards by a machine reading the Tamil. A reader who mistakes
    it for a second transcript would be reading a translation as evidence of what was said,
    and this page's whole argument is that the difference between those two things matters.
    """
    doc = json.loads(GLOSSES.read_text(encoding="utf-8"))
    for key in ("_note", "_method", "_produced"):
        assert doc.get(key), f"tools/glosses.json has no {key}"
    assert "translation" in doc["_note"].lower()
    assert "language model" in doc["_method"].lower(), (
        "the method has to name what wrote the English, because a reader deciding how much "
        "to trust a translation needs to know who made it"
    )


def test_every_english_gloss_is_written_in_english():
    """A gloss that still holds Tamil is a gloss that was not written."""
    for cid, call in gloss_table().items():
        for index, row in enumerate(call["turns"]):
            assert row["en"].strip(), f"{cid} gloss {index} is empty"
            leaked = TAMIL.findall(row["en"])
            assert not leaked, (
                f"{cid} gloss {index} carries {len(leaked)} Tamil characters in the English"
            )
            assert TAMIL.search(row["ta"]), (
                f"{cid} gloss {index} translates a line that holds no Tamil, so it does not "
                "belong in this file"
            )


def test_the_island_carries_english_for_every_turn_it_carries():
    """The published data, which is what `player.js` rebuilds the scene out of.

    Asked of each turn's own text rather than of the call's locale, because a call placed in
    Tamil opens with an English announcement and those lines need no translation. Asserted
    on the condition rather than on a list of call ids, so a Tamil turn added later is
    caught by this test instead of needing to be added to it.
    """
    if not PAGE.exists():
        pytest.skip("the page has not been built in this checkout")
    bare = []
    counted = 0
    for cid, call in island().get("calls", {}).items():
        for index, turn in enumerate(call.get("turns", ())):
            if not TAMIL.search(turn.get("text", "")):
                continue
            counted += 1
            if not str(turn.get("gloss", "")).strip():
                bare.append(f"{cid} turn {index}")
    assert counted, "no Tamil turn reached the page, which cannot be right"
    assert not bare, f"{len(bare)} turns published with no English: {bare[:8]}"


def test_the_rendered_transcript_puts_the_english_under_the_tamil():
    """The markup a reader with no JavaScript meets.

    Every rendered turn that holds Tamil has to hold an English gloss in the same list item.
    A gloss somewhere else on the page would not be a translation of that line.
    """
    if not PAGE.exists():
        pytest.skip("the page has not been built in this checkout")
    markup = PAGE.read_text(encoding="utf-8")
    tamil_turns = [t for t in TURN.findall(markup) if TAMIL.search(t)]
    assert tamil_turns, "no Tamil turn is rendered, which cannot be right"
    bare = [t for t in tamil_turns if "class=turn-gloss" not in t]
    assert not bare, (
        f"{len(bare)} of {len(tamil_turns)} rendered Tamil turns carry no English: "
        f"{bare[0][:160]}"
    )


def test_the_page_says_who_wrote_the_english():
    """A translation presented without saying it is one is a claim about the recording."""
    if not PAGE.exists():
        pytest.skip("the page has not been built in this checkout")
    markup = PAGE.read_text(encoding="utf-8")
    assert "class=turn-gloss" in markup, "no gloss is rendered, so there is nothing to note"
    assert "nobody spoke it on the call" in markup, (
        "the transcript that carries a translation has to say the English was written "
        "afterwards and was not part of the recording"
    )


def documents_with_tamil() -> list[tuple[Path, list[str]]]:
    """Every tracked document that prints Tamil, and the lines it prints.

    Markdown only, and blockquotes inside it, and both boundaries are worth stating.

    Markdown, because Tamil also appears in two test fixtures and in the generator that
    writes them, where it is a pupil name being pushed through a filter rather than
    something a reader is asked to read. A name inside a fixture is data.

    Blockquotes, because a quotation in this repository is a blockquote and the two gates
    below are about quotations. `evidence/MUTATIONS.md` describes a change that retyped a
    Tamil character, and a row describing a wrong quotation is not itself a quotation of
    anything. Checking it against the transcript failed the row for saying what it was
    written to say, which is the gate being wrong about the document rather than the
    document being wrong.
    """
    docs = []
    for path in sorted(APP.rglob("*.md")):
        if any(part in ("node_modules", "out", ".git") for part in path.parts):
            continue
        said = [line for line in path.read_text(encoding="utf-8").splitlines()
                if TAMIL.search(line) and line.lstrip().startswith(">")]
        if said:
            docs.append((path, said))
    return docs


def test_every_tamil_line_a_document_quotes_is_quoted_exactly():
    """A document that quotes a transcript has to quote it, not retype it.

    `docs/the-legal-surface.md` used to open its quotation with வருகைக் where the recording
    says வருகைப். One consonant, in a script the person who wrote the surrounding English
    cannot proofread, inside the one paragraph whose entire argument is that the disclosure
    a parent hears is the disclosure on the recording. A reader who checked it against the
    audio would have found the document and the call saying different things.

    Checked against `tools/glosses.json` rather than against the receipts, because the
    receipts are held outside this repository and a gate that can only run on one machine is
    the shape of gate this project keeps finding broken. The gloss file carries the Tamil
    verbatim and the build already refuses to publish if that copy drifts from the
    transcript, so matching it is matching the recording.
    """
    known = {row["ta"].strip() for call in gloss_table().values() for row in call["turns"]}
    assert known, "tools/glosses.json carries no Tamil, so this gate is checking nothing"
    stray = []
    for path, lines in documents_with_tamil():
        for line in lines:
            said = line.lstrip("> ").strip()
            if said not in known:
                stray.append(f"{path.relative_to(APP)}: {said[:60]}")
    assert not stray, (
        "these lines are not any line of any committed transcript, so they are a retyping "
        "of one or a quotation of something that was never said: " + "; ".join(stray)
    )


def test_every_tamil_line_a_document_quotes_carries_its_english():
    """The language rule applies to the documents too, not only to the page.

    The transcript on the page was glossed and this document was not, which left one file
    in the submitted tree printing two sentences of Tamil with no English anywhere near
    them. The privacy gate could not see it either: it reads `transcript_turns` inside JSON
    and has never opened a markdown file.
    """
    english = {row["ta"].strip(): row["en"] for call in gloss_table().values()
               for row in call["turns"]}
    bare = []
    for path, lines in documents_with_tamil():
        body = path.read_text(encoding="utf-8")
        for line in lines:
            said = line.lstrip("> ").strip()
            gloss = english.get(said)
            if gloss and gloss not in body:
                bare.append(f"{path.relative_to(APP)}: {said[:40]}")
    assert not bare, (
        "these documents print Tamil with no English translation beside it: "
        + "; ".join(bare)
    )


def builder():
    """The page builder, imported rather than run.

    Imported because the three checks below are about a refusal, and a refusal is cheaper to
    provoke on a five line dictionary than by building a whole page from receipts this
    repository does not carry. Importing it also means these run on a clean checkout, which
    the gates that read `out/index.html` cannot.
    """
    import judge_page

    return judge_page


def one_tamil_call(said: str) -> dict:
    """The smallest thing shaped like the data the builder is handed."""
    return {"calls": {"S-0000": {
        "locale": "ta-IN",
        "turns": [{"offset_seconds": 0, "speaker": "bot", "text": said}],
    }}}


def test_the_builder_refuses_a_call_it_has_no_glosses_for(monkeypatch):
    """A Tamil call the gloss file has never heard of stops the build.

    The alternative is a page that prints one untranslated line in the middle of a scroller,
    which breaks a rule of entry invisibly. A build that stops is a build somebody fixes.
    """
    page = builder()
    monkeypatch.setattr(page, "glosses", lambda: {})
    with pytest.raises(SystemExit) as refused:
        page.bind_glosses(one_tamil_call("வணக்கம்"))
    assert "S-0000" in str(refused.value)


def test_the_builder_refuses_a_gloss_that_is_empty(monkeypatch):
    """An empty string is not a translation, and it would render as one."""
    page = builder()
    said = "வணக்கம்"
    monkeypatch.setattr(page, "glosses", lambda: {
        "S-0000": {"locale": "ta-IN", "turns": [{"ta": said, "en": "   "}]}})
    with pytest.raises(SystemExit) as refused:
        page.bind_glosses(one_tamil_call(said))
    assert "S-0000" in str(refused.value)


def test_the_builder_refuses_a_transcript_that_moved_under_its_gloss(monkeypatch):
    """The failure this is really written against.

    The transcriber splits a long answer into turns and could split it differently on a
    re-run. The English would then sit under a sentence it is not a translation of, and
    every gate above would still pass, because a gloss would be present on every line.
    Matching the Tamil byte for byte is the only check that catches it.
    """
    page = builder()
    monkeypatch.setattr(page, "glosses", lambda: {
        "S-0000": {"locale": "ta-IN",
                   "turns": [{"ta": "வணக்கம்",
                              "en": "greetings"}]}})
    with pytest.raises(SystemExit) as refused:
        page.bind_glosses(one_tamil_call(
            "வணக்கம் ஐயா"))
    assert "S-0000" in str(refused.value)
