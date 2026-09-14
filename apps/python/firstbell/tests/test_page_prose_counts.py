"""Every count the page spells out in a sentence is checked against the thing it counts.

Some numbers on this page cannot be derived at build time without reading better than a
template does, so they are written as words: "Four real calls placed by this software", "All
twelve comparisons". Written as words they read properly, and written as words nothing
updates them.

The sibling gate in `test_page_counts_rather_than_types.py` handles the mutation table, which
is derived. This one handles the rest: it leaves the prose alone and checks it, which is the
same bargain the whole entry makes.

It reads the built page, so it skips when the page has not been built. The page needs receipts
that are deliberately outside this repository. That skip is declared in
`GATES_THAT_CANNOT_ALWAYS_RUN`.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
PAGE = APP / "out" / "index.html"

WORD = {
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
}


def _page() -> str:
    if not PAGE.exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    return PAGE.read_text(encoding="utf-8")


def test_the_hero_counts_the_calls_the_first_screen_actually_plays():
    """"Two calls above, played from their own recordings" is a claim about the cards.

    It used to be a claim about a register of four rows, and the register came off the
    first screen because it printed a transcript act 02 prints again. The claim moved
    with it and so does this gate: a third card arriving, or one being dropped, makes the
    sentence wrong and nothing else in the build would notice.

    Counted from the ids the cards rendered rather than from a number recorded somewhere
    else, because the ids are what a reader counts when they check it.
    """
    page = _page()

    # Not sliced between two class names. Both of them appear in the stylesheet in the
    # head, before any markup, so a slice from one to the other is a slice of CSS and
    # matches nothing. The attribute is only ever written on a card.
    ids = re.findall(r'data-csc-lane="(S-\d{4})"', page)
    shown = sorted(set(ids))

    claim = re.search(r"class=hero-foot>(\w+) calls above", page)
    assert claim, (
        "the sentence under the cards has been reworded, so this gate is checking "
        "nothing; point it at whatever states the count now"
    )

    spelled = claim.group(1).lower()
    assert spelled in WORD, (
        f"the card count is written as {claim.group(1)!r}, which this gate cannot turn "
        "into a number; widen the table rather than leaving the count unchecked"
    )
    assert WORD[spelled] == len(shown), (
        f"the page says {claim.group(1)} calls and the first screen renders "
        f"{len(shown)}: {shown}"
    )

    assert len(ids) == len(shown), (
        f"two cards on the first screen carry the same call id: {ids}"
    )


def test_the_hero_separates_the_calls_it_publishes_from_the_money_denominator():
    """Two quantities in one sentence, and this gate holds the relationship, not a value.

    It used to assert that the hero's "in total" figure EQUALS `counts.calls`. Those were
    the same number the day it was written. Twelve more calls were placed on 2026-09-11
    and the pool was deliberately not recomputed, because the cost model is frozen on the
    original twelve, so "has placed 12 calls against CALL-E in total" went false on the
    first screen and this gate stayed green while enforcing it. A gate asserting the one
    relationship that had stopped holding is worse than no gate: the page carried a false
    claim with a passing test beside it, which is the defect the whole entry is about.

    So it checks three things, none of them a literal count:

      the published figure is the number of calls the page actually carries, counted off
      the `call-data` island the page is built from rather than off a receipt, because the
      receipts are held outside this repository and a clean checkout has to be able to run
      this;

      the money figure is `counts.calls`, which is the frozen denominator; and

      when the two differ, no sentence claims the money covers everything placed. That is
      the clause that went false, and it is the one a reword would put back.

    Neither figure is the number of calls placed. Counting by `apiId`, the only identifier
    the receipts and `transcripts.json` share, the two sets hold twelve and twenty and
    overlap on eight, so twenty-four distinct calls have been placed. Twenty-four is not
    derivable from anything committed, so the page claims no total and this gate does not
    invent one.
    """
    page = _page()

    island = re.search(
        r"<script id=call-data type=application/json>(.*?)</script>", page, re.S)
    assert island, (
        "the call data island is gone, so there is nothing to count the published figure "
        "against and this gate would be checking a number against itself")
    published = len(json.loads(island.group(1))["calls"])

    # The sentence used to read "This page publishes N calls, each with its transcript",
    # and this gate held that N against the island, which is where those transcripts sit
    # unrendered. Claim and evidence were the same object, so the gate was green while the
    # page published two of twenty. The verb is now "placed", which the island can speak
    # for, and whether anything is over-claimed as rendered is asked by
    # tests/test_transcripts_are_reachable.py against the built markup instead.
    shown = re.search(r"out of (\d+) this software placed through CALL-E", page)
    assert shown, (
        "the first screen no longer says how many calls this software placed. It is the "
        "figure a reader compares against the player controls in front of them")
    assert int(shown.group(1)) == published, (
        f"the first screen says it placed {shown.group(1)} calls and the page carries "
        f"{published}")

    pooled = json.loads(
        (APP / "evidence" / "recorded-calls.json").read_text(encoding="utf-8")
    )["counts"]["calls"]

    money = re.search(r"money is computed over the (\d+) pooled in", page)
    assert money, (
        "the first screen no longer names the denominator the money is computed over, so "
        "a reader takes the published count for it, which is the contradiction this "
        "sentence was rewritten to remove")
    assert int(money.group(1)) == pooled, (
        f"the first screen says the money is computed over {money.group(1)} calls and "
        f"evidence/recorded-calls.json pools {pooled}")

    if published != pooled:
        # Scoped the way `test_real_call_denominator.py` scopes the same page, and for the
        # reason its docstring records. The first version of this check split the stripped
        # page on full stops, and caught two things it should not have. The mutation table
        # is rendered on this page and its cells carry no terminator, so the whole tbody
        # flattened into one 6,000 word "sentence" holding both halves of the pattern; it
        # is also a catalogue of sentences this repository refuses, so matching it is
        # matching the ledger rather than a claim. And a block element with no full stop
        # joined the block after it, which is how a neighbouring cell gets to excuse a
        # wrong one.
        #
        # So: table rows out, then every block close is a sentence boundary.
        markup = re.sub(r"<tr>.*?</tr>", " ", page, flags=re.S)
        markup = re.sub(r"</(?:dt|dd|p|li|h1|h2|h3|div|figcaption|summary|caption)>",
                        ". ", markup)
        text = html.unescape(re.sub(r"<[^>]+>", " ", markup))

        totalising = [
            " ".join(sentence.split())
            for sentence in re.split(r"(?<=[.;:!?])\s+", text)
            if re.search(r"in total|all of them|every call this software has placed",
                         sentence)
            and re.search(r"\bmoney\b|computed over|sample is", sentence)
        ]
        assert not totalising, (
            f"the page pools {pooled} calls and publishes {published}, and these sentences "
            "say the money covers everything this software placed, which is the claim that "
            "went false when the two figures came apart:\n  " + "\n  ".join(totalising))


def test_the_locale_fold_counts_the_comparisons_it_contains():
    """"All twelve comparisons, counted before the phone rang" is the pre-registration claim.

    It is the strongest sentence in that act, because counting the family before measuring is
    the thing that stops a favourable subset being reported as the result. It is also the one
    a reviewer would check first, so it is checked here.
    """
    page = _page()

    claim = re.search(r"All (\w+) comparisons, counted before the phone rang", page)
    assert claim, (
        "the pre-registration sentence has been reworded or removed; it is the claim that "
        "makes the locale result more than a favourable subset, so it does not go quietly"
    )

    spelled = claim.group(1).lower()
    assert spelled in WORD, (
        f"the comparison count is written as {claim.group(1)!r}, which this gate cannot read"
    )

    # The fold states its own arithmetic two sentences later: scenarios, performed twice,
    # with a fixed number of enumerated fields each. The product has to be the total, or the
    # family being claimed is not the family being described.
    shape = re.search(
        r"(\w+) scenarios, each performed twice, (\w+) enumerated fields per pair", page)
    assert shape, (
        "the fold no longer says how the comparison family was built, so the total above it "
        "rests on nothing a reader can re-derive"
    )

    scenarios, fields = shape.group(1).lower(), shape.group(2).lower()
    assert scenarios in WORD and fields in WORD, (
        f"the fold's arithmetic is written as {shape.group(1)!r} and {shape.group(2)!r}, "
        "which this gate cannot read"
    )
    assert WORD[scenarios] * WORD[fields] == WORD[spelled], (
        f"the fold says {shape.group(1)} scenarios with {shape.group(2)} fields each, which "
        f"is {WORD[scenarios] * WORD[fields]} comparisons, and claims {claim.group(1)}"
    )
def test_the_stat_card_does_not_say_every_collected_test_runs_here():
    """A flat count on the first screen, for a suite where two of them skip.

    The card said "624 tests" and 622 of them run: two skip with named reasons, and a clean
    checkout skips more again. This repository spends five mutation rows on stopping an
    undeclared skip, and the register was pointed at everything except its own first screen.
    A district buyer counted the difference.

    The card reads the pair out of the README rather than carrying a copy of it, so this
    holds the two together: the number on the card is the number the README measured.
    """
    markup = _page()
    readme = (APP / "README.md").read_text(encoding="utf-8")

    measured = re.search(r"the same suite\s+reports \*\*(\d+) passed, (\d+) skipped\*\*", readme)
    assert measured, "the README no longer states the pair the card is built from"
    ran = int(measured.group(1))

    card = re.search(r"<div class=lbl>tests, (\d+) of them run here</div>", markup)
    assert card, (
        "the stat card states a flat test count again, which reads as every collected test "
        "having run, and two of them skip")
    assert int(card.group(1)) == ran, (
        f"the card says {card.group(1)} of the tests run here and the README measured {ran}")


def test_the_embedded_provenance_names_files_a_reader_can_open():
    """The block that vouches for all eight transcripts, checked like any other citation.

    It named `07-locale-experiment.md`, which sits in the receipts directory the recordings
    are held in and in no clone of this repository. The committed write-up of that experiment
    is `docs/locale-is-not-only-a-hint.md`. It also said the waveform peaks are "the only
    representation of the audio that ships here", which is true of the tree and false of the
    page it is embedded in, where the recordings sit beside `index.html` and a control on
    each call plays them.

    Nine sentences of that shape were fixed in the prose on the same day, and the gate
    written for those could not see this one, because it is inside a JSON island rather than
    in a paragraph. So this reads the island.
    """
    markup = _page()
    island = re.search(r"<script id=call-data type=application/json>(.*?)</script>",
                       markup, re.S)
    assert island, "the call data island is gone, and the whole page is built from it"
    provenance = json.loads(island.group(1))["_provenance"]

    missing = []
    for text in provenance.values():
        for named in re.findall(r"\b[\w./-]+\.(?:md|csv|json)\b", text):
            if not (APP / named).exists() and not (APP.parents[2] / named).exists():
                missing.append(named)
    assert not missing, (
        "the provenance for every transcript on this page names files a reader cannot open: "
        + ", ".join(sorted(set(missing)))
    )

    # And what it says about the audio has to be true of the page it is embedded in, not
    # only of the tree the page was built from.
    if "data-audio=present" in markup:
        assert "in the tree" in provenance["audio"], (
            "the provenance says the waveforms are the only representation of the audio "
            "that ships, on a build that ships the recordings and plays them")
def test_the_language_ceiling_is_on_the_page_and_names_its_demonstration():
    """The one limit a school board can check, and where it has to live.

    It used to be the masthead's second sentence. A director of student services had asked
    for it there, because the sentence before it promised to call "in the language that
    family speaks", which a trustee disproves in one page of CALL-E's region table. Then a
    district buyer pointed out what that arrangement cost: the first screen was spending its
    second sentence on a platform limit while the escalation, which is the half of the
    product they would be buying, was nine screens down.

    The promise came off first, so there is nothing on the masthead left to qualify, and the
    ceiling moved to act 01 where it can name the run that shows it. That leaves two ways for
    the page to go wrong, and this holds both: the ceiling can be dropped in a reword, and
    the masthead can reacquire the promise now that its qualifier has moved away.
    """
    markup = _page()

    ceiling = re.search(
        r"whichever language CALL-E offers[^<]{0,120}?"
        r"United States today[^<]{0,40}?English[^<]{0,60}?"
        r'<a href="#(act-\d\d)">',
        markup)
    assert ceiling, (
        "the page no longer states the language ceiling and name the act that demonstrates "
        "it. It is the one limit a school trustee can check in CALL-E's own region table, "
        "and a page that drops it is making the promise the limit was written to answer.")

    named = ceiling.group(1)
    assert f'id="{named}"' in markup or f"id={named}" in markup, (
        f"the language ceiling points a reader at {named}, which is not an act on this page")

    # And the masthead, which no longer carries the limit, must not go back to promising a
    # language. Anything of the "in the language they speak" shape is the claim the limit
    # existed to qualify, and up there it would now sit unqualified.
    masthead = re.search(r"<div class=masthead>(.*?)</div>", markup, re.S)
    assert masthead, "the masthead is gone, and it is the first thing a reviewer reads"
    promise = re.search(
        r"in (?:the|whatever|whichever) language[^<]{0,60}?"
        r"(?:they|family|families|parent|parents|guardian|guardians)\b",
        masthead.group(1), re.I)
    assert not promise, (
        "the masthead promises to call in the family's own language: "
        + " ".join(promise.group(0).split())
        + ". CALL-E offers one language per country and English in the United States, so "
        "that sentence is disproved by one page of its region table. The ceiling is in "
        f"act 01; a promise up here needs it back beside it.")


def test_the_recorded_suite_pair_is_the_one_the_readme_publishes():
    """The largest count on the front screen used to be the one nothing checked.

    `tools/judge_page.py` printed "N tests, M of them run here" and read M out of a sentence
    in the README, which its own docstring admitted: "The page cannot measure the pair for
    itself." The collected count was held against a live collection. The pair beside it was
    held against the prose it was copied from, so a stale sentence made the card stale and
    both agreed with each other while disagreeing with the suite.

    `tools/suite_pair.py` measures it and writes `evidence/suite-pair.json`. That tool is not
    part of this suite, because a test that ran it would be measuring a run containing
    itself. This holds the recorded file and the published sentence together, and checks the
    file is internally consistent, which is the part that would catch a hand edit.
    """
    recorded = APP / "evidence" / "suite-pair.json"
    if not recorded.is_file():
        pytest.skip("no evidence/suite-pair.json; run python tools/suite_pair.py first")

    held = json.loads(recorded.read_text(encoding="utf-8"))
    for field in ("collected", "passed", "skipped", "failed", "tree"):
        assert field in held, f"{recorded.name} has no {field}, so it records no measurement"

    assert held["passed"] + held["skipped"] + held["failed"] == held["collected"], (
        f"{recorded.name} says {held['passed']} passed, {held['skipped']} skipped and "
        f"{held['failed']} failed of {held['collected']} collected, which do not add up. "
        "A hand edit is the only way to get here")

    readme = (APP / "README.md").read_text(encoding="utf-8")
    published = re.search(r"the same suite\s+reports \*\*(\d+) passed, (\d+) skipped\*\*",
                          readme)
    assert published, (
        "the README no longer publishes the built-tree pair, and it is the sentence a "
        "reader compares the card against")

    if held["tree"] != "built":
        pytest.skip(
            f"the recorded pair was measured on a {held['tree']}, and the README sentence "
            "this compares against is the built-tree one. Two true numbers about two "
            "different trees are not a disagreement")

    # Collected less skipped, for the reason the builder gives where it reads the same
    # two fields: the pass count moves when a gate that reads this file is itself failing,
    # and this is one of those gates, so a pair taken off it could never settle anywhere.
    runs = held["collected"] - held["skipped"]
    assert (int(published.group(1)), int(published.group(2))) == (runs,
                                                                  held["skipped"]), (
        f"the README publishes {published.group(1)} passed and {published.group(2)} "
        f"skipped; {recorded.name} records {held['collected']} collected and "
        f"{held['skipped']} skipped, so {runs} of them run on a tree like this one. The "
        "card reads the file, so the sentence is the stale one")

    # Whether the recorded run was green is checked by `tools/suite_pair.py --check` and
    # not here. It was here, and it is one of the tests whose result the file records: a
    # file written by a red run failed it, which kept the run red, which was what got
    # recorded on the next write. There is no state in which the suite could satisfy it.


def test_the_card_reads_the_measurement_and_not_the_sentence(tmp_path, monkeypatch):
    """Which source the card believes, proven by giving it two that disagree.

    The gate above compares the recorded pair to the published sentence, and it cannot tell
    where the card got its number: while the file and the prose agree, a builder reading
    either one passes. So this builds a tree whose file and prose disagree on purpose. The
    card has to come back with the measurement, because the whole argument of this entry is
    that a claim ships with the thing that checks it and the largest count on the front
    screen was the one figure a person had typed.

    Then it takes the file away, and the sentence has to be the fallback. A clean checkout
    that has not run `tools/suite_pair.py` still has to be able to build a page, and the
    prose is the only pair on disk at that point.
    """
    import sys

    sys.path.insert(0, str(APP / "tools"))
    import judge_page

    root = tmp_path / "app"
    (root / "evidence").mkdir(parents=True)
    # Two failures on purpose, so the pass count and the number of tests this tree can run
    # are different numbers: 700 collected less 10 skipped is 690 that run here, and 688
    # of those passed. A fixture where the two agreed could not tell a card reading the
    # pass count from one reading the pair, and the pass count is the reading that cannot
    # settle: the gate holding this file against the README is one of the tests it counts,
    # so a stale file lowers the very number that is supposed to correct it.
    (root / "evidence" / "suite-pair.json").write_text(json.dumps({
        "collected": 700, "passed": 688, "skipped": 10, "failed": 2,
        "tree": "built"}), encoding="utf-8")
    (root / "README.md").write_text(
        "Build the page and run the gates and the same suite\n"
        "reports **11 passed, 22 skipped**. Both pairs are measured.\n", encoding="utf-8")

    monkeypatch.setattr(judge_page, "APP", root)

    assert judge_page._suite_pair() == (690, 10), (
        "the card came back with the pair out of the README while a measurement sat on "
        "disk beside it, so the largest count on the front screen is a typed sentence "
        "again and a stale sentence makes a stale card")

    (root / "evidence" / "suite-pair.json").unlink()
    assert judge_page._suite_pair() == (11, 22), (
        "with no measurement on disk the builder has to fall back to the published "
        "sentence rather than refusing, because a reviewer who has just cloned this and "
        "wants to look at the page has not run the tool that writes the file")


def test_every_pull_quote_is_a_sentence_this_repository_states_somewhere():
    """The rule `judge_page.pull` describes, which had never been a gate.

    Its docstring said each pull quote is "lifted word for word out of the prose beside it"
    and named `tests/test_claims.py` as the thing holding them. No such check existed, in
    that file or any other, so the one rule governing the largest type on the page was a
    sentence about itself.

    The rule as written was also the wrong one. Setting a claim twice on one screen, once as
    body prose and once at 2rem, is the repetition the queue's shared-reason band exists to
    remove, and act 05 was doing exactly that with about nine hundred words in between.

    So the rule is the weaker and truer one: a pull quote has to be a sentence this
    repository states somewhere a reader can go and check, whether that is the page itself or
    a document the page links to. A sharpened line invented for the lift still fails.
    """
    page = (APP / "out" / "index.html")
    if not page.is_file():
        pytest.skip("the page is not built, and this reads what the build produced")

    import html as html_mod

    built = html_mod.unescape(page.read_text(encoding="utf-8"))
    quotes = re.findall(r"<p class=pull>(.*?)(?:<span class=pull-who>|</p>)", built, re.S)
    assert quotes, "the page carries no pull quotes, so this gate is measuring nothing"

    # Everything a reader can reach from the page EXCEPT the pull quotes themselves.
    #
    # The first version of this gate did not make that exception, and so it passed on a pull
    # quote invented for the lift: the page's own visible text contains every pull quote,
    # because a pull quote is visible text on the page. It was a gate that required what it
    # produced, and it took a mutation to show it, which is the argument act 05 makes.
    without_pulls = re.sub(r"<p class=pull>.*?</p>", " ", built, flags=re.S)
    corpus = [_visible_text(without_pulls)]
    for doc in sorted(APP.glob("**/*.md")):
        if "node_modules" in doc.parts:
            continue
        corpus.append(_flat(doc.read_text(encoding="utf-8")))
    haystack = " ".join(corpus)

    missing = []
    for quote in quotes:
        said = _flat(html_mod.unescape(re.sub(r"<[^>]+>", "", quote)))
        if said and said not in haystack:
            missing.append(said)

    assert not missing, (
        "these pull quotes are not sentences this repository states anywhere a reader can "
        "check them, so the largest type on the page is saying something nothing else does:"
        "\n  " + "\n  ".join(missing))


def _flat(text: str) -> str:
    """Whitespace and typographic punctuation flattened, so a quote matches its source."""
    text = (text.replace("’", "'").replace("‘", "'")
                .replace("“", '"').replace("”", '"')
                .replace(" ", " ").replace(" ", " "))
    return re.sub(r"\s+", " ", text).strip()


def _visible_text(built: str) -> str:
    body = re.sub(r"<script.*?</script>", " ", built, flags=re.S)
    body = re.sub(r"<style.*?</style>", " ", body, flags=re.S)
    return _flat(re.sub(r"<[^>]+>", " ", body))
