"""The numbers in judge-facing files have to match the repository.

A README that says 64 tests when there are 84 is a small lie that costs more than the
sentence is worth, and it happens by drift rather than by intent. These tests make the
drift fail the suite.

The count comes from pytest's own collection, not from counting `def test_` in the source.
The README states what `pytest -q` prints, and parametrised tests make those two numbers
differ, so counting the source would compare the README against a number no reader ever
sees: the same class of error as measuring the wrong property and calling it a gate.

No count is written down here. A file whose job is to catch drift should not carry a
figure that drifts, and an earlier version of this docstring did exactly that.

`--collect-only` imports the modules but runs nothing, so calling it from inside the suite
terminates.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
COUNT = re.compile(r"(\d+) tests? collected")


def _collected_test_count() -> int:
    out = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "--collect-only", "-q"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stdout
    match = COUNT.search(out)
    assert match, "could not read a collection count from pytest: " + out[-300:]
    return int(match.group(1))


def test_the_readme_states_the_real_number_of_tests():
    readme = (APP / "README.md").read_text(encoding="utf-8")
    claimed = re.search(r"pytest tests/ -q\s*#\s*(\d+) tests", readme)
    assert claimed, "the README no longer states a test count where this test looks for it"
    assert int(claimed.group(1)) == _collected_test_count()


def test_the_readme_sample_is_what_the_program_actually_prints():
    """The sample run had drifted by a whole output block before this gate existed.

    It compares rather than regenerates. A gate that produced the artifact it checks
    would pass by construction and prove nothing, so regeneration stays a separate,
    deliberate act and this only ever reports a mismatch.

    The offline double is deterministic, so a difference here is a real difference and
    not thread ordering.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    blocks = re.findall(r"```\n(OFFLINE\..*?)```", readme, re.S)
    assert len(blocks) == 1, "expected exactly one sample run in the README"
    run = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert run.returncode == 0, run.stderr[-400:]
    printed = run.stdout.replace("\r\n", "\n").strip()
    assert blocks[0].strip() == printed, (
        "The README sample no longer matches the program. Regenerate it rather than "
        "editing it by hand."
    )


def test_the_prose_numbers_match_the_program_too():
    """The excerpt and the derived figure in the README are quoted by hand.

    The generated sample block sits directly above them, which makes them look as though
    something checks them. Until this test, nothing did.

    `$0.67` is not printed as a bare string anywhere: it is the three-minute case of the
    per-minute ceiling, so it is recomputed here rather than searched for.
    """
    from firstbell.domain import StaffCost

    readme = (APP / "README.md").read_text(encoding="utf-8")
    run = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert run.returncode == 0, run.stderr[-400:]
    printed = run.stdout.replace("\r\n", "\n")

    quoted = [
        "attempts billed     8",
        "attempts removed    4",
        "attempts still open 4",
        "break-even          $0.20 per call, for every minute one manual attempt takes",
    ]
    for line in quoted:
        assert line in printed, "the README quotes a line the program no longer prints: " + line
        assert line in readme, "the program prints a line the README no longer quotes: " + line

    # Read out of the run, never recomputed here.
    #
    # This block used to be `ceiling = (4 / 7) * (staff.hourly / 60.0)`, with the 4 and the
    # 7 typed in. The demonstration then gained a row, the program started dividing by 8,
    # and the figure it printed moved from $0.67 to $0.59 while this assertion went on
    # passing against the old constant. The README carried both numbers, forty lines apart,
    # and the one test written to stop exactly that had become the thing hiding it.
    #
    # A gate may not hold its own copy of the quantity it is checking.
    printed_ceiling = re.search(
        r"cheaper than the desk below \$([0-9.,]+) a call at 3 minutes an attempt", printed)
    assert printed_ceiling, "the program no longer prints a three-minute break-even"
    assert f"**${printed_ceiling.group(1)} a call**" in readme, (
        f"the program prints ${printed_ceiling.group(1)} a call at three minutes and the "
        f"README prose says something else"
    )

    # The two counts the prose restates in words, taken from the same run.
    attempted = re.search(r"^\s+attempted\s+(\d+)", printed, re.M)
    placed = re.search(r"^\s+attempts placed\s+(\d+)", printed, re.M)
    assert attempted and placed, "the run summary no longer prints attempted and placed"
    words = {5: "Five", 6: "Six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
    a, c = int(attempted.group(1)), int(placed.group(1))
    assert a in words and c in words, f"add {a} and {c} to `words` so this gate keeps checking"
    assert f"{words[a]} students were attempted and {words[c]} calls were placed" in readme, (
        f"the program attempted {a} and placed {c}; the README prose disagrees"
    )
    assert f"the number that\nmatters to a budget is the {words[c]}." in readme
    # The wage is a sourced constant rather than a run output, so it is compared
    # against the class that carries its provenance.
    staff = StaffCost.us_school_office()
    assert f"**${staff.annual:,.0f}**" in readme, (
        "the README's wage no longer matches the sourced figure"
    )
    assert staff.source_url in readme


def test_the_still_generator_names_no_line_it_has_not_looked_up():
    """The pictures drifted because their line numbers were typed into the generator.

    `proof-call-site.png` carried the caption "The only call site.
    dispatch/scheduler.py:211-221" over what had become the thread pool, and
    `proof-classification.png` labelled seven ranges RESOLVED, FAILED and UNDETERMINED
    inside a method that had moved a hundred and twenty lines. Re-running the tool would
    have redrawn both, still wrong, still confident.

    Every figure is looked up in the source now. This checks that none has been typed back
    in, which is the only way the drift returns. It reads the generator rather than the
    PNGs because nothing here can read a picture.
    """
    src = (APP / "tools/gates/capture-stills.mjs").read_text(encoding="utf-8")
    typed = []
    for pattern, why in (
        (r"const\s+(?:start|end|hlFrom|hlTo)\s*=\s*\d", "a window bound assigned a literal"),
        (r"\{\s*from:\s*\d+\s*,\s*to:\s*\d+", "a highlight zone with literal bounds"),
        (r"\(lines?\s+\d+", "a caption naming a literal line"),
    ):
        for hit in re.findall(pattern, src):
            typed.append(f"{why}: {hit.strip()!r}")
    assert not typed, (
        "a line number was typed into the still generator instead of looked up in the "
        "source, which is how the last two pictures came to describe code that had "
        "moved:\n  " + "\n  ".join(typed)
    )


ANCHOR = re.compile(r"`([^`]+)` at\s*\n?\s*`([a-z_/]+\.py):(\d+)`")


def test_every_cited_line_number_still_says_what_the_readme_claims():
    """A line number in prose rots the first time anything above it moves.

    The README points a reader at four exact lines for where CALL-E is called. Each
    citation names the symbol it expects to find there, so this can check the pair rather
    than just that the file exists.

    The count assertion is the important half. Without it, deleting every anchor would
    make this test pass on an empty list, which is the way a check like this usually dies.
    """
    # Both documents, because the pictures drifted while the README stayed right. The
    # captions inside the PNGs are derived by `capture-stills.mjs` at render time; this
    # checks the prose beside them, which is the half a reader quotes.
    documents = {"README.md": 5, "docs/images/README.md": 4}
    pairs = []
    for name, least in documents.items():
        body = (APP / name).read_text(encoding="utf-8")
        found = ANCHOR.findall(body)
        assert len(found) >= least, (
            f"expected at least {least} runtime anchors in {name}, found {len(found)}. "
            "If they were removed on purpose, lower this number deliberately."
        )
        pairs.extend(found)

        # And the count the prose states, against the list under it. A floor can only ever
        # be too low: the README said "Four lines do all of it" above five anchored bullets
        # for as long as this gate had been passing, because five is at least four. A
        # district buyer counted the bullets.
        stated = re.search(r"\b([A-Z][a-z]+) lines do all of it", body)
        if stated:
            spoken = stated.group(1).lower()
            claimed = NUMBER_WORDS_SMALL.get(spoken)
            assert claimed is not None, f"{spoken!r} is not a number this gate can read"
            assert claimed == len(found), (
                f"{name} says {spoken} lines do all of it and carries {len(found)} "
                f"anchored lines")

    for symbol, path, line in pairs:
        target = APP / path
        assert target.exists(), f"the README cites {path}, which does not exist"
        lines = target.read_text(encoding="utf-8").splitlines()
        number = int(line)
        assert number <= len(lines), (
            f"the README cites {path}:{number} but the file has {len(lines)} lines"
        )
        assert symbol in lines[number - 1], (
            f"the README says {symbol!r} is at {path}:{number}, but that line is "
            f"{lines[number - 1].strip()!r}"
        )


def test_every_work_file_the_first_screen_names_closes_at_least_one_record():
    """Runs the commands rather than checking that their files exist.

    Unmarked on purpose. It is the slowest test in the suite, three subprocesses, and a
    marker is how a check stops running: an earlier gate here was deselected by a `-m`
    filter for a fortnight and nobody noticed it had gone quiet.

    This is the gate that was missing. `test_the_three_minute_path_settles_what_it_says_it
    _settles` asserted `(APP / rel).exists()` for each example file, and for a fortnight two
    of the three closed nothing: every call in `absences-oneroster.csv` and
    `absences-siblings.csv` fell through to the offline double's `{"ok": true}`, failed the
    result schema, and the process exited 0. A reviewer with three minutes runs the command.
    The README had already found this exact failure on the HTTP path and fixed it there,
    which is what makes the file-listing gate worth replacing rather than defending.

    "At least one" rather than "all": a fixture whose every row closes would be the demo
    this project argues against, and `absences-oneroster.csv` deliberately carries a row
    CALL-E refuses for language. What is not allowed is a run that closes nothing, because
    that is a product that does not work.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    start = readme.find("## If you have three minutes")
    end = readme.find("## If you have twenty minutes", start)
    assert end > start > 0, "the three-minute path moved"
    named = sorted(set(re.findall(r"examples/[\w.-]+\.csv", readme[start:end])))
    assert len(named) >= 3, "the three-minute path names fewer than three example files"

    for rel in named:
        run = subprocess.run(
            [sys.executable, "-m", "firstbell", "--work-file", rel],
            cwd=APP, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180,
        )
        assert run.returncode == 0, (
            f"`python -m firstbell --work-file {rel}` exited {run.returncode}:\n"
            f"{(run.stderr or run.stdout)[-1200:]}"
        )
        found = re.search(r"^\s*resolved\s+(\d+)", run.stdout, re.M)
        assert found, (
            f"`python -m firstbell --work-file {rel}` printed no resolved count, so the "
            f"first screen offers a command whose output cannot be read:\n"
            f"{run.stdout[-1200:]}"
        )
        assert int(found.group(1)) >= 1, (
            f"the first screen tells a reviewer to run {rel} and it closes "
            f"{found.group(1)} record(s). Every call in it failed, and the process still "
            f"exited 0, so a reviewer with three minutes sees a product that does not "
            f"work:\n{run.stdout[-1600:]}"
        )


def test_every_document_summary_counts_and_names_what_its_document_holds():
    """The card a reader clicks has to describe the page behind it.

    `docs/the-legal-surface.md` has seven numbered questions and its own published summary
    said eight, and named COPPA, which appears in no document in this repository. That
    summary is the page's meta description and the text of the further-reading card, so it
    is what a district's counsel reads before deciding whether to open the thing.

    Both halves are derived. The count comes from the `## N.` headings, and the statutes come
    out of the summary itself: any token of three or more upper-case letters that is not one
    of this project's own words has to appear in the document. That way a document added to
    `PUBLISHED` is covered without anybody editing this test, which is how the miscount
    survived in the first place.
    """
    from tools import doc_pages

    words = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven",
             8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve"}
    # Tokens that look like a statute and are not one. Kept short on purpose: every entry
    # is a hole in the rule, so each one has to be a word this project itself uses.
    not_a_statute = {"CALL", "CSV", "SDK", "API", "JSON", "HTML", "CSS", "URL", "AA",
                     "WCAG", "SIS", "SIP", "AI", "ID", "IDS", "US", "UK", "IN", "PR",
                     "README", "TTS", "LUFS", "E164", "ADA", "BLS"}

    checked = 0
    for slug, rel, _title, summary in doc_pages.PUBLISHED:
        path = APP / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        checked += 1

        headings = re.findall(r"^## (\d+)\. ", text, re.M)
        if headings:
            found = len(headings)
            expected = words.get(found)
            claimed = re.match(r"^([A-Z][a-z]+) questions?\b", summary)
            if claimed and expected:
                assert claimed.group(1).lower() == expected, (
                    f"the published summary of docs/{slug}.md says "
                    f"{claimed.group(1).lower()} questions and the document has {found}. "
                    f"That summary is the meta description and the further-reading card, "
                    f"so it is what a reader sees before opening it"
                )

        for token in set(re.findall(r"\b[A-Z]{2,}\b", summary)):
            if token in not_a_statute:
                continue
            assert token.lower() in text.lower(), (
                f"the published summary of docs/{slug}.md names {token} and the document "
                f"does not mention it anywhere. A summary naming a statute its own page "
                f"never discusses sends a reader looking for something that is not there"
            )

    assert checked >= 5, (
        f"this gate examined {checked} published document(s), which is too few to be "
        "covering the reading list"
    )


def test_every_sourced_figure_is_in_its_own_quote_or_says_why_not():
    """The register exists so a number can be checked against the words it came from.

    Four of its thirteen quotes did not contain the figure beside them. The worst was the
    largest dollar figure in the entry, a school district's system renewal, whose quote read
    "the annual renewal of the PowerSchool, LLC Contract for 2024-25" and carried no amount
    at all. A reader following the register to check $157,664 found a sentence that could
    not confirm it.

    Some figures genuinely cannot appear in a quote: a table cell has no sentence behind it,
    and a figure derived by subtraction is not in the source at all. Those are allowed, and
    they have to say so in `quote_is`, because a stated reason is checkable and a missing
    number is not.
    """
    doc = json.loads((APP / "evidence" / "statistics.json").read_text(encoding="utf-8"))
    figures = doc["figures"]
    assert len(figures) >= 10, f"the register holds {len(figures)} figures, which is too few"

    for figure in figures:
        value = str(figure["value"])
        quote = str(figure.get("quote") or "")
        assert quote, f"{figure['id']} has no quote at all"
        bare = value.replace(",", "").replace("%", "").replace("$", "")
        in_quote = value in quote or bare in quote.replace(",", "")
        if in_quote:
            continue
        why = str(figure.get("quote_is") or "")
        assert why, (
            f"{figure['id']} claims {value} and its quote does not contain it: "
            f"{quote[:90]!r}. Either quote the words carrying the figure, or say in "
            f"`quote_is` why no such words exist"
        )
        assert len(why) > 40, (
            f"{figure['id']} explains a missing figure with {why!r}, which is too short "
            "to be a reason a reader can check"
        )


def test_the_three_minute_path_settles_what_it_says_it_settles():
    """The first screen a reviewer reads, checked against the things it points at.

    A reviewer has minutes, so the first screen makes four claims and names the check for
    each. That makes it the highest-traffic prose in the repository and the worst place
    for a number to go stale. Every example file it names has to exist, every figure it
    quotes has to be the one the program or the ledger produces now, and the count of
    mutation rows has to be the real one.

    The figures are compared against their own sources rather than against a constant
    written here, because a test holding its own copy of $0.21 is the second place that
    number is written down.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    start = readme.find("## If you have three minutes")
    assert start > 0, "the README no longer opens with a three-minute path"
    end = readme.find("## If you have twenty minutes", start)
    assert end > start, "the three-minute path no longer sits above the reading order"
    path = readme[start:end]

    rows = [line for line in path.splitlines() if line.startswith("| ") and " | " in line]
    assert len(rows) >= 5, (
        f"the three-minute path has {len(rows)} table lines, which is too few to be four "
        "claims and a header"
    )

    # Every work file it tells a reviewer to run.
    named = re.findall(r"examples/[\w.-]+\.csv", path)
    assert len(named) >= 3, "the three-minute path names fewer than three example files"
    for rel in sorted(set(named)):
        assert (APP / rel).exists(), (
            f"the first screen tells a reviewer to run {rel}, which is not in the tree"
        )

    # Every file it links.
    for rel in re.findall(r"\]\(([^)h][^)]*)\)", path):
        assert (APP / rel).exists(), f"the first screen links {rel}, which does not exist"

    # The mutation count, against the ledger.
    ledger = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")
    real_rows = len(re.findall(r"^\| \d+ \|", ledger, re.M))
    quoted = re.search(r"(\d+) rows", path)
    assert quoted and int(quoted.group(1)) == real_rows, (
        f"the first screen says {quoted.group(1) if quoted else 'nothing'} mutation rows "
        f"and MUTATIONS.md has {real_rows}"
    )

    # The two money figures, from the run the first screen names rather than from a
    # fixture built here. A hand-built wave agreed with the demo run for as long as both
    # divided by the wrong thing, and stopped agreeing the moment one of them was fixed,
    # which is a test asserting its own arithmetic and not the program's.
    import sys
    sys.path.insert(0, str(APP / "tools"))
    from money_across_runs import demo_row

    demo = demo_row()
    crossover = demo["crossover_per_100"]
    assert crossover is not None, "the crossover rate is no longer computed"
    assert f"{crossover:.1f}" in path, (
        f"the first screen quotes a crossover the program does not compute "
        f"({crossover:.1f} per 100)"
    )
    assert f"${demo['net_ceiling']:,.2f} a call" in path, (
        f"the first screen does not quote the demo run's net ceiling "
        f"(${demo['net_ceiling']:,.2f} a call)"
    )


def test_the_ten_minute_reading_order_is_ten_minutes_of_files_that_exist():
    """The list on the first screen, checked for both halves of what it promises.

    A dead link there is worse than no list. So is a budget the rows do not add up to: the
    heading offers a reader a budget, every row states its own cost, and nothing was
    checking that those two agree. They did not, by a minute, from the day the section was
    written.

    The count is a range rather than a number. Pinning it to exactly five meant that adding
    a sixth file broke a test about dead links, which is not what that test is for. The
    lower bound is what stops the list quietly emptying.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    # The heading is read rather than spelled out here. Hardcoding one wording meant that
    # honestly raising the budget to match the rows failed this test for the wrong reason,
    # which pushes the next person towards shaving a row's estimate instead of the heading.
    words = {"ten": 10, "fifteen": 15, "twenty": 20}
    # The last of these headings, not the first. A three-minute path was added above the
    # reading order because a reviewer's budget is minutes rather than tens of minutes,
    # and this test then scored the three-minute heading against the reading-order table
    # underneath it, which is two different sections read as one.
    headings = list(re.finditer(r"## If you have (\w+) minutes", readme))
    assert headings, "the README no longer has a reading order"
    found = headings[-1]
    assert found.group(1) in words, (
        f"the reading order offers '{found.group(1)}' minutes, which this test cannot score"
    )
    order = readme.split(found.group(0), 1)
    assert len(order) == 2, "the README no longer has a reading order"
    table = order[1].split("### Where CALL-E is called", 1)[0]

    linked = re.findall(r"\]\(([^)]+)\)", table)
    assert 4 <= len(linked) <= 9, (
        f"the reading order has {len(linked)} entries, which is either too few to be a "
        "reading order or too many to read in the time offered"
    )
    for rel in linked:
        assert (APP / rel).exists(), f"the reading order points at {rel}, which does not exist"

    budget = words[found.group(1)]
    stated = [int(m) for m in re.findall(r"\| (\d+) min \|", table)]
    assert len(stated) == len(linked), (
        f"{len(linked)} rows but {len(stated)} of them state a reading time"
    )
    assert sum(stated) <= budget, (
        f"the heading offers {budget} minutes and the rows add up to {sum(stated)}"
    )


def test_the_mutation_table_is_numbered_without_gaps():
    """Rows are numbered by hand, so a row inserted in the middle silently duplicates an id."""
    table = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")
    ids = [int(m) for m in re.findall(r"^\| (\d+) \|", table, re.M)]
    assert ids, "no mutation rows found"
    assert ids == list(range(1, len(ids) + 1)), "mutation ids are not 1..n: " + str(ids)


NUMBER_WORDS_SMALL = {name: value for value, name in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}

_ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen "
         "fourteen fifteen sixteen seventeen eighteen nineteen").split()
_TENS = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty",
         6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}


def _in_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, rest = divmod(n, 10)
        return _TENS[tens] + (f"-{_ONES[rest]}" if rest else "")
    hundreds, rest = divmod(n, 100)
    head = f"{_ONES[hundreds]} hundred"
    return head if not rest else f"{head} and {_in_words(rest)}"


# Generated rather than typed. The hand-written version stopped at whatever number was
# current when it was last edited, and the gate below then failed with a note asking
# somebody to extend it, which is a maintenance task standing between a contributor and a
# green suite.
NUMBER_WORDS = {n: _in_words(n) for n in range(1000)}


def test_every_surface_states_the_real_number_of_platform_findings():
    """Counted from the headings, not from a number somebody remembered.

    A thirteenth finding was added to `call-e-feedback.md` and two surfaces went on saying
    twelve: its own opening line and the README's reading list. Both spell the number in
    words, so a grep for the digit finds neither, which is why this reads the headings and
    then looks for the wrong word as well as the right one.

    The same shape as the mutation-count gate, and it exists for the same reason: the half
    that checks the right number is worthless without the half that catches the old number
    surviving somewhere else.
    """
    words = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven",
             8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
             13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen"}
    feedback = (APP / "call-e-feedback.md").read_text(encoding="utf-8")
    numbered = re.findall(r"^## (\d+)\. ", feedback, re.M)
    found = len(numbered)
    assert found >= 2, "call-e-feedback.md has no numbered findings to count"
    assert [int(n) for n in numbered] == list(range(1, found + 1)), (
        f"the findings are numbered {numbered}, which is not 1 to {found}: a gap or a "
        "repeat means one of them is unreachable from the list that cites it"
    )
    assert found in words, f"{found} findings is past what this gate can spell"
    right = words[found]

    surfaces = {
        "call-e-feedback.md": feedback,
        "README.md": (APP / "README.md").read_text(encoding="utf-8"),
    }

    # Every phrase that counts findings, and the two numbers either of them may be.
    #
    # A reader with the platform's SDK open found "the other eleven platform findings" in
    # the README six lines under a sentence that already said sixteen. This gate had read
    # every surface for a wrong count and walked past that one twice over: it searched for
    # `<word> findings` and there is a word in between, and it knew only the total, while
    # "the other fifteen" is the true way to write that sentence about a file of sixteen.
    # So it now knows the idiom. Anything after "the other" is one less than the total,
    # one word may sit between the count and the noun, and no third number is allowed.
    spoken = "|".join(words[n] for n in sorted(words))
    phrase = re.compile(
        rf"(?P<other>the other\s+)?\b(?P<word>{spoken})\b(?:\s+[a-z-]+)?\s+findings",
        re.I)
    by_word = {word: n for n, word in words.items()}

    for rel, text in surfaces.items():
        totals = 0
        for m in phrase.finditer(text):
            said = by_word[m.group("word").lower()]
            want = found - 1 if m.group("other") else found
            assert said == want, (
                f"{rel} says {m.group(0)!r} and the file holds {found} findings, so that "
                f"number should be {words[want]}"
            )
            totals += 0 if m.group("other") else 1
        assert totals, (
            f"{rel} never states the total: it does not say '{right} findings' anywhere, "
            f"and the file holds {found}"
        )


def test_the_readme_states_the_real_number_of_mutations():
    """The third count in this README to go stale, and the first one caught from outside.

    A first-time reader found "Twenty-two gates" and "Thirteen of them" in a file whose own
    mutation table had twenty-six rows. The test-count gate next door had been passing the
    whole time, which is the trap: a checked number sitting beside an unchecked one makes
    the unchecked one look checked.

    Only the count that is actually written down is asserted. The prose no longer states a
    second one, so there is nothing else here to keep in step.
    """
    table = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")
    rows = len([ln for ln in table.splitlines() if re.match(r"^\| \d+ ", ln)])
    assert rows > 0, "no numbered rows found in MUTATIONS.md"

    word = NUMBER_WORDS.get(rows)
    assert word, f"add {rows} to NUMBER_WORDS so this gate can keep checking"

    # Both files that state this count, not just the one that was caught first. The index
    # beside the table said "Forty-four test gates and eleven browser gates" while the table
    # held sixty-eight rows, and it stayed wrong through every run of this gate because this
    # gate only ever read the app README. A checked number beside an unchecked one is the
    # whole failure, and it happened twice in the same repository. A third file was then
    # found saying "Thirteen rules" while the table held seventy-five, which is why this
    # reads a list rather than a pair.
    stating = ("README.md", "evidence/README.md", "docs/proving-a-gate-fires.md")
    bodies = {rel: (APP / rel).read_text(encoding="utf-8") for rel in stating}

    for rel, text in bodies.items():
        assert f"{word.capitalize()} gates broken on purpose" in text, (
            f"MUTATIONS.md has {rows} rows, so {rel} should say "
            f"'{word.capitalize()} gates broken on purpose'"
        )

    # And no other spelled-out count may appear beside the word "gates", which is how the
    # stale "Thirteen of them" survived several edits. Read across all three files rather
    # than the app README alone: the half above was widened to three when a second file was
    # caught, and this half was left reading one, which put a checked sentence and an
    # unchecked one in the same file for a day.
    for rel, text in bodies.items():
        for other, other_word in NUMBER_WORDS.items():
            if other == rows:
                continue
            assert f"{other_word.capitalize()} gates" not in text, (
                f"{rel} still says '{other_word.capitalize()} gates' somewhere"
            )
            assert f"{other_word.capitalize()} of them" not in text, (
                f"{rel} still says '{other_word.capitalize()} of them' somewhere"
            )


def test_no_committed_text_file_carries_an_invisible_control_byte():
    """Catch the corruption that every tool renders as nothing.

    Escaped text written through a shell can arrive with the backslash consumed, so a
    `\\b` intended for a regex becomes byte 0x08. That is a real backspace: the file
    still parses, the regex still compiles, it silently stops matching what it was written
    for, and `cat`, `sed` and `git diff` all display it as empty space because a terminal
    renders a backspace by moving the cursor left.

    It happened three times while this app was being written, and only this kind of check
    would have found the third one. Tab, newline and carriage return are the only control
    characters a text file has any business holding.

    Binary files are skipped by decoding rather than by extension, so a new image format
    needs no entry here and a `.py` full of bytes is still caught.
    """
    allowed = {9, 10, 13}          # tab, newline, carriage return
    offenders = []
    for path in _tracked_paths():
        try:
            data = path.read_bytes()
        except OSError:
            continue
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            continue                # a binary file, and not this test's business
        stray = sorted({byte for byte in data if byte < 32 and byte not in allowed})
        if stray:
            offenders.append(
                f"{path.name}: {', '.join(hex(b) for b in stray)}")
    assert not offenders, (
        "control bytes in a committed text file, which nothing displays:\n  "
        + "\n  ".join(sorted(offenders)))


def _tracked_paths():
    """Every file git tracks under this app. See tests/test_privacy.py for why git."""
    root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=APP, capture_output=True, text=True, check=True).stdout.strip()
    listing = subprocess.run(
        ["git", "ls-files", "-z", "--full-name", "--", str(APP)],
        cwd=APP, capture_output=True, text=True, check=True).stdout
    paths = [Path(root) / name for name in listing.split("\0") if name]
    assert len(paths) > 30, f"only {len(paths)} tracked files, which cannot be this app"
    return paths


def test_every_file_in_evidence_is_described():
    """Nothing sits in evidence/ without the index saying what it is.

    This used to glob `0*.json`, the receipts, and it kept working right up until the
    receipts were removed, at which point it looped over nothing and passed. The count is
    asserted first for that reason: the check is only worth anything if it read something.

    A companion check, `test_no_receipt_claims_production_without_naming_the_host`, lived
    here too. It required a receipt claiming production to name the host it dialled, and it
    is gone rather than generalised, because `tests/test_privacy.py` now forbids a
    committed file from claiming production at all. Keeping a rule about how to do
    something correctly, next to a rule saying not to do it, is how a tree ends up with two
    answers.
    """
    directory = APP / "evidence"
    listed = (directory / "README.md").read_text(encoding="utf-8")
    described = [p for p in sorted(directory.iterdir())
                 if p.is_file() and p.name != "README.md"]
    assert len(described) >= 2, (
        f"only {len(described)} file(s) in evidence/ besides the index, which is too few "
        "for this check to be measuring anything"
    )
    for path in described:
        assert path.name in listed, f"{path.name} is committed but not described"


CREATION_CLAIM = re.compile(
    r"first commit in this directory is `([0-9a-f]{7,40})`,\s*(\d{4}-\d{2}-\d{2})")
PUBLISHED_PATHSPEC = re.compile(r"git log --reverse[^\n]*?--\s+(\S+)")


def _first_commit_touching(pathspec: str, cwd: Path) -> str:
    """The first line the README's own command produces, run without a shell."""
    out = subprocess.run(
        ["git", "log", "--reverse", "--format=%h %ad", "--date=short", "--", pathspec],
        cwd=cwd, capture_output=True, text=True, check=True).stdout
    lines = [line for line in out.splitlines() if line.strip()]
    # An empty history is the failure this is most likely to meet, and an empty answer
    # compared against an empty answer agrees with everything. The published command
    # already had this defect once: its pathspec is written relative to the repository
    # root, so running it in the directory the README sits in printed nothing and exited
    # zero.
    assert lines, (
        f"`git log ... -- {pathspec}` run from {cwd} printed nothing and exited zero, so "
        "the command the README publishes does not show a reader anything"
    )
    return lines[0]


def test_the_creation_date_the_readme_publishes_is_the_one_git_records():
    """The provenance claim, which is the one claim here a reader cannot check by reading.

    The rules require an entry to say whether it is new or a significant update, so this
    sentence is a compliance answer and not decoration. It names a commit and a date, and
    both are the kind of fact that goes stale silently: prose does not notice a rebase.

    Nothing is written down here. The hash and the date are read out of the README and
    compared against git, so this file carries no figure of its own to drift, and the
    pathspec is read out of the published command rather than retyped, so the command a
    reader is invited to run is the command that is checked.

    A rebase makes this fail, and that is the intended behaviour rather than a cost. After
    one, the published hash names nothing and the sentence is false; the author date the
    claim rests on survives a rebase, so only the half that genuinely changed goes red.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")

    claim = CREATION_CLAIM.search(readme)
    assert claim, "the README no longer states a first commit and date where this looks"
    claimed_hash, claimed_date = claim.group(1), claim.group(2)

    published = PUBLISHED_PATHSPEC.search(readme)
    assert published, "the README no longer publishes a command a reader could run"
    pathspec = published.group(1)

    root = Path(subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], cwd=APP,
        capture_output=True, text=True, check=True).stdout.strip())

    # From the repository root, which is where the published pathspec is written to work.
    got_hash, got_date = _first_commit_touching(pathspec, root).split()
    assert got_hash == claimed_hash, (
        f"the README says the first commit here is {claimed_hash}, git says {got_hash}"
    )
    assert got_date == claimed_date, (
        f"the README says this was created {claimed_date}, git says {got_date}"
    )

    # And the same commit is the first one touching this directory, asked a second way, so
    # the claim is about this app rather than about whatever the pathspec happens to name.
    assert _first_commit_touching(".", APP).split()[0] == claimed_hash
# Every test allowed to skip, and why. A skip is a real third outcome in this project and it
# is the one that hides: under `-q` it prints the same dot a pass does. Both entries below
# need an artifact that is deliberately not in the repository, so they cannot be made to run
# on a clean checkout without committing the thing the privacy rules keep out.
def test_what_the_page_says_about_audio_is_what_the_build_holds():
    """A build that ships recordings has to say so, and one that says it has none must not.

    `out/audio/` held eight recordings of real calls while `<html>` said
    `data-audio=absent`, which meant no control was rendered, nothing on the page referenced
    a single clip, and the strongest artifact this entry owns was unreachable in every build
    since the flag was added. The cause was a documented command with the flag missing from
    it. Nothing in eighteen browser gates or six hundred tests could see it, because both
    halves were internally consistent: the page was a correct no-audio page and the
    directory was a correct set of recordings.

    The browser gate next door asks whether a control reaches the bytes. This asks the
    question that cannot be asked from inside the page: whether the two halves agree.
    """
    page = APP / "out" / "index.html"
    if not page.is_file():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    markup = page.read_text(encoding="utf-8", errors="replace")
    clips = sorted((APP / "out" / "audio").glob("*.m4a")) if (APP / "out" / "audio").is_dir() \
        else []
    says_present = "data-audio=present" in markup

    if clips and not says_present:
        raise AssertionError(
            f"out/audio holds {len(clips)} recording(s) and the page says it has no audio, "
            f"so nothing on it can reach {clips[0].name}. Rebuild with --audio-dir")
    if says_present and not clips:
        raise AssertionError(
            "the page says its audio is present and out/audio holds no .m4a file, so every "
            "control on it asks for a recording the build does not have")

    if says_present:
        # Every call the page draws a player for has to have its own file, because the
        # player builds the URL out of the id: a missing one is a control that answers 404.
        ids = {i for group in re.findall(r'data-player="([^"]+)"', markup)
               for i in group.split(",")}
        have = {c.stem for c in clips}
        assert ids, "the page says it has audio and draws no player at all"
        missing = sorted(ids - have)
        assert not missing, (
            f"the page draws a player for {', '.join(missing)} and out/audio holds no "
            f"recording for it, so its control answers 404")
def test_every_documented_way_to_build_the_page_still_works():
    """A command in this repository's own documentation that cannot run.

    `docs/images/README.md` printed `python tools/judge_page.py out` and `--receipts` became
    mandatory some time after that line was written, so the documented build exits 3 with the
    trouble text. Nothing noticed, and the consequence was not a wrong sentence: it is that
    the page was rebuilt for weeks by hand from a half-remembered command, without
    `--audio-dir`, so eight recordings of real calls sat in `out/audio/` with no control on
    the page that could reach one.

    Read as text rather than run, because running it needs the receipts. What it asks is
    whether each documented invocation carries the arguments the tool refuses to work
    without, which is a question the argument parser can answer for itself.
    """
    required = {"--receipts"}
    documented = []
    for path in _tracked_paths():
        if path.suffix != ".md":
            continue
        for n, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            stripped = line.strip()
            if not re.match(r"^\$?\s*python[0-9.]*\s+\S*judge_page\.py\b", stripped):
                continue
            documented.append((path, n, stripped.split("#")[0].strip()))

    assert documented, (
        "no documented way to build the page was found at all, which means either this "
        "test cannot see the documentation or the documentation stopped saying how")

    for path, n, cmd in documented:
        missing = sorted(flag for flag in required if flag not in cmd)
        assert not missing, (
            f"{path.name}:{n} documents `{cmd}` and tools/judge_page.py exits 3 without "
            f"{', '.join(missing)}. A reader following this line gets the trouble text")
def test_the_scene_gap_cap_is_the_same_number_in_both_copies_of_the_rule():
    """One rule, two languages, and a caption that prints it.

    `player.js` caps the wait between turns at GAP_MAX and `judge_page.py` recomputes the
    same schedule at build time so the caption can say how long the scene takes. Two copies
    of a constant is a drift waiting to happen, and this one is printed on the first screen:
    if the browser capped at 2.0 and the caption said 1.5, the page would be describing a
    scene nobody watched. That is the defect the caption had before, in a smaller way. It
    read "played at its own speed with silences over 1.5 seconds shortened" while the
    recording played whole and the scene ran about three times faster than the call.
    """
    js = (APP / "tools" / "site" / "player.js").read_text(encoding="utf-8")
    found = re.search(r"^const GAP_MAX = ([0-9.]+);", js, re.M)
    assert found, "player.js no longer declares GAP_MAX, so the caption cannot be checked"

    sys.path.insert(0, str(APP / "tools"))
    import judge_page

    assert float(found.group(1)) == judge_page.SCENE_GAP_MAX, (
        f"player.js caps the wait between turns at {found.group(1)}s and judge_page.py "
        f"computes the caption from {judge_page.SCENE_GAP_MAX}s, so the page states a "
        f"length no reader will see")

    # And the schedule itself, against the rule written out by hand.
    call = {"seconds": 20.0,
            "turns": [{"offset_seconds": 0.0}, {"offset_seconds": 1.0},
                      {"offset_seconds": 9.0}, {"offset_seconds": 9.0},
                      {"offset_seconds": 12.0}]}
    # 0 -> 1 is 1.0, 1 -> 9 caps at 1.5, the repeat of 9 is not a segment, 9 -> 12 caps at
    # 1.5, and 12 -> 20 caps at 1.5.
    assert judge_page.scene_seconds(call) == 5.5, judge_page.scene_seconds(call)
def test_the_page_says_where_its_source_is_and_whether_a_film_exists():
    """Act 08 is called "Run it yourself" and the page never said where to get it.

    A district buyer took the two commands act 08 gives, went looking for the code, and
    found that "github", "film" and "video" appeared zero times in 250KB of markup. Both
    absences were deliberate: a link to an unpushed branch or an unpublished video is worse
    than no link. Saying nothing at all was the wrong conclusion, because a judge opening the
    deployed link, which is what the submission form points at, had no route to anything the
    page told them to run.

    Two builds have to satisfy this. With the URLs, a link. Without them, the fact and where
    the link will be. The gate accepts either and refuses silence.
    """
    page = APP / "out" / "index.html"
    if not page.is_file():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    markup = page.read_text(encoding="utf-8", errors="replace")

    source = ("github" in markup.lower()
              or "awesome-phone-call-agents" in markup)
    assert source, (
        "the page names no repository and carries no source link, so a judge who opens it "
        "first cannot reach the code act 08 tells them to run")

    film = "demo film" in markup.lower() or "watch the demo" in markup.lower()
    assert film, (
        "the page never mentions a film, and one of the four criteria is Product Experience "
        "and Demo. A reader cannot tell an unlinked film from no film")

GATES_THAT_CANNOT_ALWAYS_RUN = {
    # Both read the built page, which a clean checkout does not carry. What is lost while
    # they are quiet is the check that the four numbers on the first screen still match the
    # committed files they are computed from. The third dateline gate, the one that proves
    # they are computed at all rather than typed, runs anywhere.
    "cells":
        "reads out/index.html, which only exists after the page has been built",
    # tests/test_transcripts_are_reachable.py, both helpers and the narrow second gate.
    # They read the built pages, so a clean clone cannot run them. What is lost while they
    # are quiet is the only check that separates a transcript the page carries from one a
    # reader can reach. Two sentences claimed a transcript for every call while the build
    # drew two, and both were checked against the page's own data island, which is where
    # the undrawn eighteen live. A gate reading the island cannot see that defect, so these
    # read the markup with script tags cut out and nothing else.
    "_reader_text":
        "reads out/*.html, which only exists after the page has been built",
    "_calls":
        "reads the call-data island out of out/index.html, built from receipts held "
        "outside this repository",
    "test_the_calls_with_a_play_control_have_their_words_for_the_player":
        "reads out/index.html, which only exists after the page has been built",
    # tests/test_hero_paragraph.py. The paragraph under the hero card is prose, so nothing
    # derives it, and it has described the wrong call twice: written for S-3103 it kept
    # that child's school bus through the whole period S-3127 was the hero, and written for
    # S-3127 it kept his bike through the move to S-4105. Both times every derived value
    # beside it was right, which is what let it survive. Quiet in a clean clone because it
    # needs both the built page and the hero's own turns.
    "_hero_paragraph":
        "reads out/index.html, which only exists after the page has been built",
    "_hero_and_calls":
        "needs transcripts.json, which is held outside this repository",
    "test_the_dateline_is_derived_and_not_written_out":
        "asks the builder for the block twice, which needs the receipts on this machine",
    # Reads evidence/suite-pair.json, which tools/suite_pair.py writes and which is not
    # written by running the suite, because a gate cannot require what it produces. What is
    # lost while it is quiet is the claim that the pass count on the page's first screen is
    # the measured one; the card falls back to the README sentence in exactly that case.
    "test_the_recorded_suite_pair_is_the_one_the_readme_publishes":
        "needs evidence/suite-pair.json, written by python tools/suite_pair.py",
    "test_the_queue_rows_are_the_number_the_committed_record_holds":
        "needs a page built by tools/judge_page.py, which needs the call receipts",
    "test_the_take_away_card_prints_commands_that_can_be_run":
        "needs a page built by tools/judge_page.py, which needs the call receipts",
    "test_the_page_says_where_its_source_is_and_whether_a_film_exists":
        "needs a page built by tools/judge_page.py, which needs the call receipts",
    "test_what_the_page_says_about_audio_is_what_the_build_holds":
        "needs a page built by tools/judge_page.py, which needs the call receipts",
    # The mark on any row this software closed while learning nothing, checked against the
    # built page. It needs `out/index.html`, which is built from the receipts and so cannot
    # exist in a clean clone. What is lost while this is quiet is the guarantee that the
    # S-3004 row still links to the act explaining it; the condition it asserts is derived
    # from the row rather than from a call id, so it also covers the same defect appearing
    # on a call nobody has placed yet.
    "test_a_row_closed_on_an_answer_that_said_nothing_is_marked_as_one":
        "needs out/index.html, which is built from receipts held outside this repository",
    # The three gates on the English under every Tamil line. Two of them read the built page
    # and one reads the JSON island inside it, so a clone with no receipts cannot run them.
    # What is lost while they are quiet is the guarantee that the page a reviewer opens
    # carries a translation of every line it prints in Tamil, which is a rule of entry and
    # not a nicety. The gloss file itself is committed, so the two gates that read it
    # directly run everywhere and hold the harder half: that the English is written in
    # English and that the file says who wrote it.
    "test_the_island_carries_english_for_every_turn_it_carries":
        "needs out/index.html, which is built from receipts held outside this repository",
    "test_the_rendered_transcript_puts_the_english_under_the_tamil":
        "needs out/index.html, which is built from receipts held outside this repository",
    "test_the_page_says_who_wrote_the_english":
        "needs out/index.html, which is built from receipts held outside this repository",
    # The throughput figures the README publishes, against the tool run on the receipts
    # that produced them. The receipts are held outside this repository, so a clone cannot
    # run this one and should not be told its numbers are wrong. The ten beside it hold the
    # arithmetic and run anywhere; what is lost while this is quiet is the claim that the
    # published block is the current output rather than a transcription of an old one.
    "test_the_readme_block_is_what_the_tool_prints_now":
        "skips when no run receipts are on the machine, and it is the only check that the "
        "throughput block in the README is what tools/throughput.py prints today",
    # The cost band's one check that reads the built page rather than the builder. It goes
    # quiet on a checkout with nothing built, which is the same condition every other
    # page-reading gate here skips on. The eight beside it in that file need no page and
    # hold the arithmetic, so what is lost while it is quiet is only the claim that the
    # band is rendered rather than merely computed.
    "test_the_band_reaches_the_page_rather_than_only_the_test":
        "skips when out/index.html has not been built, and it is the check that the cost "
        "band is on the page at all rather than only in the function that makes it",
    # This one skips on a clean checkout today.
    "test_every_real_result_the_readme_promises_is_on_the_page":
        "reads out/index.html, which is built from receipts held outside this repository. "
        "What it checks that does not depend on whose calls went in is now also checked by "
        "test_the_page_builder_masks_every_identifier_and_drops_no_result, which builds the "
        "page from an authored fixture and runs on any checkout. What is left here is the "
        "claim about the eleven real calls, which nothing without the receipts can settle",
    # These three guard the committed images, so they go quiet exactly when there are none
    # to guard, which is the moment an image gate is easiest to lose by accident. Only the
    # second one skipped in the run this register was written against, and it has two
    # separate skip conditions rather than one.
    "test_every_committed_image_is_declared":
        "skips when no image is committed, which is the state it exists to stop returning to",
    "test_no_committed_image_was_rendered_from_the_call_recordings":
        "skips when no image is committed, and again when there is no locally built page or "
        "gate screenshot to compare against; this is the gate written after a committed "
        "screenshot published twelve real call ids and twelve real billing ids",
    "test_the_tool_that_makes_the_stills_cannot_see_a_recording":
        "skips when the still tool is absent, so deleting the tool would silence it",
    # The two on the generated figure. Both go quiet for a reason that is about the machine
    # rather than about the page, which is exactly the shape that hides a gate if it is not
    # written down here.
    "test_the_committed_figure_is_what_the_generator_makes_today":
        "skips when python-lottie is not installed, because the check regenerates the figure "
        "and cannot do that without the library that draws it",
    "test_the_figure_carries_no_text_of_its_own":
        "skips when the figure has not been generated in this checkout, since there is no "
        "SVG to read for text that should not be in it",
    # The leak gate on the video's fact document. It reads the receipts, and the receipts
    # live outside this tree, so a clean checkout has no identifiers to prove are masked.
    "test_the_video_is_never_handed_a_whole_call_identifier":
        "reads the call identifiers out of the receipts, which are held outside this "
        "repository, so on a checkout without them there is nothing to check the masking "
        "against",
    # Not a test: the helper every test in test_queue_view.py goes through, which is where
    # the skip lives and so where the AST finds it. The receipts are held outside this tree,
    # so on a checkout without them the whole office-queue view has nothing to be checked
    # against.
    "_run":
        "the office queue is drawn from a committed receipt, and the receipts are held "
        "outside this repository, so every test of that view goes quiet without them",
    # Same reason, one file over. `test_money_block.py` reads two different receipts now,
    # one for a run that holds records open and one for a run that holds none, so the
    # loader takes the name as an argument and the skip lives in it.
    "test_every_pull_quote_is_a_sentence_this_repository_states_somewhere":
        "reads the pull quotes out of the built page, so it has nothing to check on a "
        "checkout where out/index.html has not been built",
    "_receipt":
        "the money band is priced from committed receipts, and the receipts are held "
        "outside this repository, so the band goes quiet without them",
    # These two carry a second skip of their own, on top of the helper's. Both are about the
    # shape of the committed run rather than the machine: a run where nothing escalates has
    # no marking to check, and a run where everything escalates has no order to check.
    "test_every_escalated_row_is_marked_as_one":
        "skips when no row in the committed run escalates, because there is then nothing "
        "for the safeguarding marking to be wrong about",
    "test_the_escalated_rows_come_first":
        "skips when the run does not mix escalated rows with ordinary ones, because order "
        "proves nothing about a list that is all one kind. The committed run is all "
        "escalations today, so this is the state it skips in",
    # Not a test: the helper the classifier parity check runs the JavaScript through. It
    # skips for two reasons that are both about the machine rather than about either
    # classifier, and a parity check that goes quiet is the one shape that would let the two
    # surfaces drift back apart without anybody hearing about it.
    "_javascript_verdicts":
        "skips when node is not on PATH, because there is then no way to run the n8n "
        "recipe's classifier at all, and again when the plugin directory is not in the "
        "checkout, because the module it compares against is not there to run",
    # The one branch of the video's fact reader that cannot be exercised while the thing it
    # needs is present. It goes quiet on this machine and runs on a clean checkout, which is
    # the opposite way round from the image gates above.
    "test_a_missing_gate_report_refuses_rather_than_reporting_zero":
        "skips when tools/gates/gate-report.json is present, because the branch under test "
        "is the one that refuses when it is absent. The report is not committed, so this "
        "runs on any fresh checkout and goes quiet only after the browser gates have run",
    # Not a test: the helper both tests in test_gate_report.py go through, which is where
    # the two skip conditions live. Named here because that is where the AST finds them.
    # Not a test either: the helper both tests in test_page_prose_counts.py read the page
    # through. It skips on any checkout where the page has not been built, which needs the
    # receipts held outside this repository.
    # Added when a bug hunt measured a fresh clone and got five failures where the README
    # promises two skips. This one reads the gate report, which is a build artifact and is
    # not committed. Its own sibling twenty lines below it had always guarded for the same
    # file, which is how the gap was visible once anybody looked.
    "test_the_counts_are_the_numbers_the_rest_of_the_suite_already_agrees_on":
        "cross-checks the video's fact reader against the page's, and one of the two counts "
        "comes from tools/gates/gate-report.json. The report is written by the browser "
        "suite and deliberately not committed, so on a clean checkout there is nothing to "
        "cross-check against",
    "test_the_page_leads_with_the_rate_the_account_pays_now":
        "reads out/index.html to check that the price on the page is the metered one and "
        "that the retired rate is named as retired. The page is built from receipts held "
        "outside this repository, so on a clean checkout there is nothing to read",
    "_page":
        "reads out/index.html to check the counts the page spells out in a sentence against "
        "the data those sentences describe. The page is built from receipts that are "
        "deliberately not committed, so on a clean checkout there is nothing to read",
    # Two reasons rather than one, and the second is the interesting half. The card is
    # generated only where the pooled record carries the counts its rates are computed
    # from, so a page can exist and legitimately have no card in it. A gate that failed in
    # that case would be asserting that a rate must be published rather than that a
    # published rate must carry its bound, which is a different and much weaker claim.
    "_card":
        "reads the money card out of out/index.html, which is built from receipts held "
        "outside this repository, and skips again when a page has no money card because "
        "the pooled record carries no rate for it to bound",
    "_contrast":
        "reads tools/gates/gate-report.json, which is a build artifact and not committed. "
        "It skips when the report is absent, and again when the report is older than "
        "out/index.html, because a report about an earlier build reads exactly like a "
        "current one and every number in it would be about a page no longer on disk",
    # Not a test: the helper every test in test_security_headers.py reads the policy through.
    "_headers":
        "reads out/vercel.json, the response headers the build derives from the page it just "
        "wrote. Both are build artifacts and neither is committed, so on a clean checkout "
        "there is no policy to check and no page for it to be checked against. The half of "
        "this that a browser measures is a gate in tools/gates/run.mjs and skips on its own "
        "terms, reporting could-not-measure rather than passing",
}


def test_no_gate_skips_without_saying_so():
    """A new silent skip cannot be added without this failing.

    A skipped test prints the same dot under `-q` that a passing one prints, so a run where
    everything passed and a run where a gate never executed look alike to anyone not reading
    `-rs`. That is the shape of a gate that quietly stopped running, which is the failure this
    whole project is written against, so the ones that cannot always run are named above and
    any new one has to be argued for rather than merely added.

    This started out reading function bodies for a call to `pytest.skip` and nothing else,
    which left every other way of switching a test off invisible to it. Prepending a single
    `@pytest.mark.skipif(True, ...)` to the test holding the safeguarding rule took that rule
    out of the suite, and nothing went red: the collected count does not move either, because
    a skipped test is still collected. Four shapes are read now, and the decorator ones are
    the shapes a person reaches for first.
    """
    import ast

    def dotted(node):
        """`pytest.mark.skipif` and `skip` alike, as a string, or "" for anything else."""
        parts = []
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if isinstance(node, ast.Name):
            parts.append(node.id)
        elif parts:
            return ""
        return ".".join(reversed(parts))

    SKIP_CALLS = ("pytest.skip", "skip", "pytest.importorskip", "importorskip")
    SKIP_MARKS = ("pytest.mark.skip", "pytest.mark.skipif", "mark.skip", "mark.skipif")

    skipping = {}
    module_level = []
    for path in sorted((APP / "tests").glob("test_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))

        # A module-level `pytestmark` switches off every test in the file at once, which is
        # the largest version of this defect and the one no per-function walk would see.
        for node in tree.body:
            targets = (node.targets if isinstance(node, ast.Assign)
                       else [node.target] if isinstance(node, ast.AnnAssign) else [])
            if any(isinstance(t, ast.Name) and t.id == "pytestmark" for t in targets):
                module_level.append(path.name)

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue

            for decorator in node.decorator_list:
                target = decorator.func if isinstance(decorator, ast.Call) else decorator
                if dotted(target) in SKIP_MARKS:
                    skipping.setdefault(node.name, path.name)

            for inner in ast.walk(node):
                call = inner.value if isinstance(inner, ast.Expr) else inner
                if isinstance(call, ast.Call) and dotted(call.func) in SKIP_CALLS:
                    skipping.setdefault(node.name, path.name)

    assert not module_level, (
        "these files switch off every test in them from module scope, which no per-test note "
        "can describe: " + ", ".join(sorted(set(module_level)))
    )

    # A file that can skip has to be able to skip.
    #
    # This file reached 1,300 lines without importing pytest, because every gate in it that
    # cannot always run reported its could-not-measure some other way. The audio gate added
    # on 8 September calls `pytest.skip` when there is no built page, and in a tree with a
    # built page that branch never runs, so it raised `NameError: name 'pytest' is not
    # defined` the first time it was executed, in a worktree of a clean snapshot. A test
    # that cannot skip fails instead, and the person who would have found it is a reviewer
    # cloning the repository.
    #
    # The check is static because the defect is: a branch that has never run cannot be
    # caught by running the suite in the one tree where it is unreachable.
    missing_import = []
    for path in sorted((APP / "tests").glob("test_*.py")):
        body = path.read_text(encoding="utf-8")
        if "pytest." not in body:
            continue
        tree = ast.parse(body)
        imported = any(
            (isinstance(node, ast.Import)
             and any(a.name == "pytest" or a.name.startswith("pytest.")
                     for a in node.names))
            or (isinstance(node, ast.ImportFrom) and node.module == "pytest")
            for node in ast.walk(tree))
        if not imported:
            missing_import.append(path.name)
    assert not missing_import, (
        "these files reach for pytest and never import it, so the branch that does raises "
        "NameError the first time it runs, which is whenever the artifact it skips for is "
        "absent: " + ", ".join(missing_import)
    )

    undeclared = sorted(set(skipping) - set(GATES_THAT_CANNOT_ALWAYS_RUN))
    assert not undeclared, (
        "these tests can skip and no reason is recorded for them: "
        + ", ".join(f"{n} ({skipping[n]})" for n in undeclared)
    )

    stale = sorted(set(GATES_THAT_CANNOT_ALWAYS_RUN) - set(skipping))
    assert not stale, (
        "these are declared as unable to run and no longer skip, so the note is now wrong: "
        + ", ".join(stale)
    )


def test_every_published_statistic_is_one_we_recorded_the_source_for():
    """The one class of number in this README that no test could reach, until now.

    Everything else here is computed by the program or counted out of a file, so drift fails
    the suite. A figure from a government release is neither, and one of them was simply
    wrong: the README said England recorded 18.7% persistent absence in 2024/25, a number
    that appears nowhere in the DfE release. The published rate is 17.63%. It was found by
    reading the primary source, which is luck rather than a process, and this file is the
    process.

    `evidence/statistics.json` holds each figure with its publisher, its URL, the sentence it
    came from and the date it was read at source. This checks the two directions that matter:
    no figure may appear in the sourced section without being in that file, and nothing in
    that file may be quoted at a different value.

    It read percentages only, for months. The file's own note said it "fails if the README
    publishes a figure that is not here", and the regex only matched a percent sign, so "More than 14
    million American students were chronically absent" walked straight through: a real
    figure, correctly sourced in a link, with no machine-readable record behind it and
    nothing able to notice if the link rotted or the number drifted. A gate whose stated
    scope is wider than its actual scope is worse than no gate, because the note is what
    everybody reads.
    """
    import json

    record = json.loads(
        (APP / "evidence" / "statistics.json").read_text(encoding="utf-8"))
    figures = {f["value"]: f for f in record["figures"]}
    assert figures, "evidence/statistics.json records no figures"

    for value, entry in figures.items():
        for field in ("claim", "publisher", "url", "quote", "read_at_source"):
            assert entry.get(field), f"{value} has no {field}"
        assert entry["url"].startswith("https://"), f"{value} has no resolvable source"
        bare = value.rstrip("%").replace(",", "").replace(".", "")
        for word in (" million", " billion", " thousand"):
            bare = bare.replace(word, "")
        assert bare.isdigit(), f"{value} is not a figure this gate can compare"

    readme = (APP / "README.md").read_text(encoding="utf-8")
    # The sourced section only. Percentages elsewhere are computed by the program and are
    # held by their own gates, so pulling them in here would make this file the second
    # place a computed number is written down, which is the defect it exists to prevent.
    # Anchored to the heading rather than to a sentence inside the section. It used to
    # name the opening line, and rewording that line turned this gate off with a
    # message about the section having moved, which is the one failure mode a gate
    # anchored on prose always has.
    start = readme.find(chr(10) + "## The problem" + chr(10)) + 1
    # The +1 steps past the newline the search matched, so that the heading itself is
    # inside the window and the next-heading search below does not match it.
    # Anchored to the start of a line, because `find("## ")` also matches the "## " inside
    # a "### " heading. It did: the third-level heading two paragraphs in ended the window
    # at 1,551 characters of a 4,231-character section, and seven of the thirteen
    # registered figures were compared against a piece of README they do not appear in.
    # A gate that measures a window has to be asked how wide the window is.
    heading = re.compile(r"^## ", re.M).search(readme, start + 1)
    end = heading.start() if heading else len(readme)
    assert start > 0 and end > start, "the sourced statistics section has moved or gone"
    section = readme[start:end]
    assert len(section) > 3_000, (
        f"the sourced section is {len(section)} characters, which is too short to be the "
        "whole of it. The last time this gate went quiet, its end boundary had matched "
        "inside a third-level heading."
    )

    # Percentages, and counts with a magnitude word or thousands separators. The second
    # half is the part that was missing. `\b\d[\d,.]*` alone would also catch a year and a
    # section number, so a count only registers when it carries a magnitude word or a comma.
    published = set(re.findall(r"\d+\.?\d*%", section))
    published |= {
        found.strip()
        for found in re.findall(r"\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand)\b",
                                section)
    }
    published |= set(re.findall(r"\b\d{1,3}(?:,\d{3})+\b", section))
    unsourced = sorted(published - set(figures))
    assert not unsourced, (
        "these figures are published with no entry in evidence/statistics.json: "
        + ", ".join(unsourced)
    )

    for value, entry in figures.items():
        if value not in published:
            continue
        assert entry["url"] in section, (
            f"{value} is published without the source link recorded for it"
        )

    # Every registered figure, wherever in the file it is published. The loop above only
    # reaches the sourced section, so a figure the program prints (both wage grades are
    # printed by `firstbell/domain.py` rather than written in prose) was registered and
    # then never compared against anything. Two of the thirteen were in that position.
    # Widened from the README alone on 8 September 2026. The five absence-volume inputs are
    # published in `docs/what-a-pilot-would-look-like.md`, which is where the derivation a
    # finance director needs actually lives, and a README-only search called them unused
    # when they are used. Left as it was, this gate would have argued for moving a figure
    # into the README to satisfy a check rather than because a reader needed it there, which
    # is the wrong way round. The rule it enforces is unchanged: a registered figure has to
    # be published somewhere a reader reaches, with its source in the same file.
    surfaces = {"README.md": readme}
    for path in sorted((APP / "docs").glob("*.md")):
        surfaces[f"docs/{path.name}"] = path.read_text(encoding="utf-8")

    for value, entry in figures.items():
        where = [name for name, body in surfaces.items() if value in body]
        assert where, (
            f"{value} is registered in evidence/statistics.json and published nowhere in "
            "the README or under docs/. A register of sources for figures that are not "
            "used is a register nobody has to keep true."
        )
        assert any(entry["url"] in surfaces[name] for name in where), (
            f"{value} is published in {', '.join(where)} and {entry['url']} is in none of "
            "them, so the figure is in the entry and its source is not"
        )


def test_the_mutation_counts_the_readme_quotes_match_the_table_it_points_at():
    """The README names three mutations by their kill count. The table is the source.

    Both of the numbers this was written for were wrong. The README said the consent gate
    fails 3 tests and the dropped error code fails 3; the table said 8 and 4, and 8 and 4 is
    what a measurement produces. The sentence carrying them is the one telling a reader that
    every gate is listed "with the change made and the number of tests that caught it", which
    makes it the worst line in the file to disagree with the table it points at.

    Rows are matched on a phrase from the row rather than on a row number, because rows get
    renumbered and a gate keyed on position goes quiet the first time one does.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    rows = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")

    # (the phrase the README uses, a phrase that identifies the row it is referring to)
    quoted = [
        ("removing the concurrency cap fails", "concurrency cap"),
        ("disabling the consent check fails", "disabling the consent gate"),
        ("real error code from the double fails", "API_ERROR_CODES"),
        ("host by substring\ninstead of hostname lets a look-alike domain through and fails",
         "Match the production host by substring"),
    ]

    wrong = []
    for phrase, row_marker in quoted:
        found = re.search(re.escape(phrase) + r"\s+(\d+)", readme)
        assert found, f"the README no longer says {phrase!r}, so this gate checks nothing"
        claimed = int(found.group(1))

        candidates = [line for line in rows.splitlines()
                      if line.startswith("|") and row_marker in line]
        assert len(candidates) == 1, (
            f"{row_marker!r} matches {len(candidates)} rows in MUTATIONS.md, so this gate "
            f"cannot say which row the README means"
        )
        measured = int(candidates[0].rsplit("|", 2)[1].strip())
        if claimed != measured:
            wrong.append(f"the README says {claimed} for {phrase!r}, the table says {measured}")

    # And the same rule for a row copied whole into another document.
    # `docs/proving-a-gate-fires.md` reproduces two rows verbatim so a reader can run them,
    # and one of the two carried a 1 where the table measures 2, for as long as it took
    # somebody to read the two files side by side. This gate used to read the README alone,
    # which is exactly why that survived.
    changes = {}
    for line in rows.splitlines():
        if line.startswith("| ") and line.count("|") == 4:
            _, number, change, count, _ = line.split("|")
            if number.strip().isdigit():
                changes[change.strip()] = count.strip()

    for rel in ("docs/proving-a-gate-fires.md",):
        for line in (APP / rel).read_text(encoding="utf-8").splitlines():
            if not line.startswith("| ") or line.count("|") != 3:
                continue
            _, change, count, _ = line.split("|")
            measured = changes.get(change.strip())
            if measured is not None and measured != count.strip():
                wrong.append(f"{rel} says {count.strip()} for a row the table measures at "
                             f"{measured}: {change.strip()[:60]}")

    assert not wrong, (
        "a document quotes kill counts the mutation table disagrees with:\n  "
        + "\n  ".join(wrong)
    )


def test_prose_that_names_a_mutation_row_agrees_with_that_row():
    """`evidence/MUTATIONS.md` explains some rows in prose and quotes their kill count.

    One of those sentences said row 29 fails six tests while row 29 said seven, and the
    correction log four hundred lines further up recorded the change from six to seven. The
    row moved, the sentence did not, and the file disagreed with itself in two directions at
    once.

    The pattern this reads is the one the file actually uses: a row number, the word "fails",
    and a number word or digit.
    """
    text = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")

    rows = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) == 3 and cells[0].isdigit() and cells[2].isdigit():
            rows[int(cells[0])] = int(cells[2])
    assert len(rows) > 50, f"only {len(rows)} rows parsed, so this gate is reading the wrong table"

    # Generated rather than a longer literal, and it reaches past twenty on purpose. This
    # map stopped at "twenty" and the pattern below matched `\w+`, which cannot match a
    # hyphen, so the first count to reach twenty-one failed the gate with "the note has
    # been reworded" when the note was fine. A gate that breaks on the next value of the
    # thing it counts is a gate with a deadline in it.
    ones = ("zero one two three four five six seven eight nine ten eleven twelve thirteen "
            "fourteen fifteen sixteen seventeen eighteen nineteen").split()
    words = {name: value for value, name in enumerate(ones)}
    for base, ten in ((20, "twenty"), (30, "thirty"), (40, "forty"), (50, "fifty"),
                      (60, "sixty"), (70, "seventy"), (80, "eighty"), (90, "ninety")):
        words[ten] = base
        for unit in range(1, 10):
            words[f"{ten}-{ones[unit]}"] = base + unit

    wrong = []
    for match in re.finditer(r"\b(\d+) fails ([a-z-]+|\d+) tests?\b", text):
        row = int(match.group(1))
        spoken = match.group(2)
        claimed = int(spoken) if spoken.isdigit() else words.get(spoken)
        if claimed is None:
            continue
        if row not in rows:
            wrong.append(f"prose names row {row}, which is not in the table")
        elif rows[row] != claimed:
            wrong.append(f"prose says row {row} fails {claimed}, the row says {rows[row]}")

    assert not wrong, "MUTATIONS.md disagrees with its own table:\n  " + "\n  ".join(wrong)

    # The instruction at the top of that file names how many rows cannot be reproduced on a
    # clean checkout. Every other count in this project is computed, so this one is too.
    marked = [line for line in text.splitlines()
              if line.startswith("|") and "**Needs the built page.**" in line]
    stated = re.search(r"except\s+the ([\w-]+) marked \*\*needs the built page\*\*", text,
                       re.S | re.I)
    assert stated, (
        "the note saying how many rows need a built page has been reworded, so nothing is "
        "counting them"
    )
    spoken = stated.group(1).lower()
    claimed = int(spoken) if spoken.isdigit() else words.get(spoken)
    assert claimed == len(marked), (
        f"the file says {spoken} rows need a built page; {len(marked)} carry the marker"
    )


def test_the_count_of_gates_the_page_really_failed_is_counted_not_typed():
    """The browser-gate table separates two kinds of row and the prose counts one of them.

    A row either records a state the page was really in, and says so in its own text, or it
    records a change invented to make a gate fire. The sentence under the table said nine
    were real, then listed eight, one of which was an invented one. Seven rows carry the
    marker. Nobody would notice the difference by reading, so it is counted here.
    """
    text = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")

    start = text.index("| The change | What the gate said |")
    end = text.index("\n\n", start)
    table = [ln for ln in text[start:end].splitlines()
             if ln.startswith("|") and not set(ln) <= set("|- ")]
    body = [ln for ln in table if not ln.startswith("| The change |")]

    shipped = [ln for ln in body if "which is how" in ln]

    # Widened to thirty when the table passed twenty rows, which is what this gate's own
    # message asks for. A hyphen is a word character to a reader and not to `\w`, so the
    # pattern takes one too: without that, "twenty-two" reads as "two" and the gate would
    # have compared the table's twenty-two rows against the number 2, failing for a reason
    # that has nothing to do with whether the count is right.
    words = ("zero one two three four five six seven eight nine ten eleven twelve "
             "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty "
             "twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six "
             "twenty-seven twenty-eight twenty-nine thirty").split()
    claim = re.search(r"\b([\w-]+) of those ([\w-]+) are the state this page was actually in",
                      text)
    assert claim, "the sentence this gate checks has been reworded, so it is checking nothing"

    for group in (1, 2):
        assert claim.group(group).lower() in words, (
            f"the prose counts in {claim.group(group)!r}, which this gate cannot turn into a "
            "number; widen the word list rather than leaving the count unchecked"
        )

    assert words.index(claim.group(1).lower()) == len(shipped), (
        f"the prose says {claim.group(1)} rows record a state the page was really in; "
        f"{len(shipped)} rows carry the marker that says so"
    )
    assert words.index(claim.group(2).lower()) == len(body), (
        f"the prose says the table holds {claim.group(2)} rows; it holds {len(body)}"
    )


def test_every_line_range_the_feedback_file_cites_holds_what_it_says_it_holds():
    """The file we hand to CALL-E cites five ranges, three of them in other people's apps.

    Two were wrong when this was written. Both pointed into `README.md`: one landed on the
    phone-masking bullet instead of the escape-hatch one, the other on the tail of the India
    caller-id bullet instead of the call-termination limitation. A reader following either
    would have found an unrelated paragraph and concluded the finding was made up.

    The existing anchor gate could not see them. It matches "symbol at path.py:NNN" and reads
    two files, and these are ranges written as "path:START-END" in a third. Rather than widen
    that regex, each citation now carries the phrase it points at, so this compares text
    against text and a renumbered file fails loudly instead of drifting quietly.
    """
    text = (APP / "call-e-feedback.md").read_text(encoding="utf-8")

    cited = re.findall(
        r"`([A-Za-z0-9_./-]+):(\d+)-(\d+)`[,)]?\s*\(?\s*\"([^\"]+)\"",
        text,
    )
    assert len(cited) >= 5, (
        f"only {len(cited)} citations parsed out of the feedback file, so this gate has "
        f"stopped reading the form the file is written in"
    )

    wrong = []
    for rel, start, end, phrase in cited:
        # Paths starting `apps/` are repository-relative; everything else is app-relative.
        # APP is apps/python/firstbell, so the repository root is three levels up.
        target = (APP.parents[2] / rel) if rel.startswith("apps/") else (APP / rel)
        if not target.exists():
            wrong.append(f"{rel} does not exist")
            continue

        lines = target.read_text(encoding="utf-8").splitlines()
        first, last = int(start), int(end)
        if last > len(lines):
            wrong.append(f"{rel}:{first}-{last} runs past the end of a {len(lines)} line file")
            continue

        window = "\n".join(lines[first - 1:last])
        if phrase not in window:
            wrong.append(f"{rel}:{first}-{last} does not contain {phrase!r}")

    assert not wrong, (
        "the feedback file cites line ranges that do not hold what it says:\n  "
        + "\n  ".join(wrong)
    )


def test_the_readme_states_the_real_number_of_classifier_tests():
    """A count from the other language in this contribution, checked from this one.

    The README said the classifier module runs "its fourteen tests" while it ran nineteen, and
    the plugin's own `manifest.json` said nineteen twice, so two files in one submission
    disagreed. Every count on the Python side is computed, and this one sat outside that
    because it belongs to a `node --test` suite. Counting `test(` at the start of a line is
    enough: that is how both files are written, and a test moved inside a block would change
    the shape this reads and fail rather than quietly pass.
    """
    plugin = APP.parents[2] / "plugins" / "firstbell-absence-calls" / "examples"
    source = (plugin / "classify.test.mjs").read_text(encoding="utf-8")
    real = len([line for line in source.splitlines() if line.startswith("test(")])
    assert real > 10, f"only {real} tests found, so this is counting the wrong thing"

    readme = (APP / "README.md").read_text(encoding="utf-8")
    # `[\w-]+` rather than `\w+`, and the reverse of the generated table rather than the
    # hand-written one. The count reached twenty-four, the README spelled it "twenty-four",
    # and both of those stopped this gate: the pattern matched only "twenty" and then found
    # no " tests" after it, so the gate failed by claiming the README no longer states a
    # count it states plainly. That is the maintenance task the comment above `NUMBER_WORDS`
    # is about, met a second time.
    found = re.search(r"runs\s+its ([\w-]+) tests", readme)
    assert found, "the README no longer states this count where this gate looks for it"

    spoken = found.group(1).lower()
    in_words = {word: value for value, word in NUMBER_WORDS.items()}
    claimed = int(spoken) if spoken.isdigit() else in_words.get(spoken)
    assert claimed is not None, f"{spoken!r} is not a number this gate can read"
    assert claimed == real, (
        f"the README says the classifier module runs {spoken} tests; it runs {real}"
    )


def test_the_contrast_tool_still_measures_the_palette_the_page_is_painted_in():
    """The footer's sentence about unmeasured pairs, with something behind it.

    A pair that names a token the stylesheet no longer declares is reported rather than
    silently dropped, which is the right behaviour and is why this was findable at all.
    It is not enough on its own: nine such rows sat in the table for as long as it took
    somebody to run the tool by hand and read the bottom of its output.

    The ALIAS half matters as much. `--ink-3` is re-cut to `--lit-ink-3` inside a panel,
    so measuring `--ink-3` against paper says nothing about the text a reader is looking
    at, and the tool says so by naming the re-cut no pair covers.
    """
    run = subprocess.run(
        [sys.executable, "tools/check_contrast.py"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert run.returncode == 0, (run.stdout[-500:] + run.stderr[-500:])

    tally = re.search(r"measured (\d+) pairs, (\d+) failing, (\d+) unmeasured", run.stdout)
    assert tally, f"the tool no longer prints its tally: {run.stdout[-300:]!r}"
    measured, failing, unmeasured = (int(g) for g in tally.groups())

    assert measured >= 18, f"the table shrank to {measured} pairs"
    assert failing == 0, run.stdout
    assert unmeasured == 0, (
        f"{unmeasured} pair(s) name a token page.css does not declare. The footer tells a "
        "reader this tool covers the page's contrast, so a row that cannot be measured is "
        "a hole in that sentence, not a note at the bottom of a report."
    )
    alias = [ln.strip() for ln in run.stdout.splitlines() if ln.strip().startswith("ALIAS")]
    assert not alias, (
        "the stylesheet re-cuts an ink token for a surface that no pair measures: "
        + "; ".join(alias)
    )


def test_the_demo_video_is_linked_when_there_is_one_to_link():
    """The page has to be able to point at the video, and point at nothing when there is none.

    Ledger row 139: the demo video existed for weeks, two minutes and fifty three seconds of
    it, four recordings of real calls, and it was linked from no README, no page and no
    submission field. Nobody judging the entry could reach it.

    The fix cannot be a constant, because the rules require the video to be "uploaded to and
    made publicly visible on YouTube or Vimeo" and a link to something nobody has published
    is worse than no link. So it is a build input, and this is the gate on both halves of
    that: a URL passed in reaches the page, and no URL leaves nothing to click.

    This used to require the no-URL case to print nothing at all, and a district buyer showed
    that was half a rule: on a page judged in part on its demo, silence cannot be told apart
    from having no demo, and act 08 told them to run code without saying where to get it. The
    rule now has a place as well as a shape. The masthead carries a link or nothing, because
    an explanation of a missing link is not worth the top of the page and measured out at 255
    vertical pixels of a phone screen. `where_it_lives` states the fact in act 08, which is
    the act that asks a reader to run it, and each sentence disappears when its URL exists.
    """
    import sys

    sys.path.insert(0, str(APP / "tools"))
    from judge_page import repo_link_markup, video_link_markup, where_it_lives

    for name, empty in (("video", video_link_markup(None)),
                        ("repo", repo_link_markup(None))):
        assert empty == "", (
            f"the {name} block puts something in the masthead with no URL behind it")

    note = where_it_lives(None, None)
    assert "<a " not in note and "href" not in note, (
        "act 08 offers something to click with no URL behind it")
    assert "awesome-phone-call-agents" in note, (
        "act 08 tells a reader to run the code and does not say where the code is")
    assert "demo film" in note and "submission form" in note, (
        "act 08 does not say a film exists, so a reader cannot tell an unlinked film from "
        "no film")

    # And nothing when both links exist, because then the masthead has them and repeating
    # them at the foot of act 08 is a second thing to keep true.
    assert where_it_lives("https://example.test/repo", "https://youtu.be/abc123") == ""

    markup = video_link_markup("https://youtu.be/abc123")
    assert "https://youtu.be/abc123" in markup
    assert markup.startswith("<p") and markup.endswith("</p>")

    # A URL is a build input, so it is attacker-adjacent in the same way every other input
    # on this page is, and the page ships under a Content-Security-Policy that a quote
    # break would not save it from.
    hostile = video_link_markup('https://x/"><script>alert(1)</script>')
    assert "<script>" not in hostile, "the video URL is written into an attribute unescaped"
    assert "&quot;" in hostile or "&#x27;" in hostile
def _node_suite_counts() -> tuple[int, int]:
    """The two numbers every surface in this contribution states about the n8n recipe.

    `test(` at the start of a line, the same method `judge_page._node_suite_size` uses and
    the same one the README gate above uses, so nothing here can pass by counting
    differently from the thing it checks.
    """
    examples = APP.parents[2] / "plugins" / "firstbell-absence-calls" / "examples"

    def written(name: str) -> int:
        body = (examples / name).read_text(encoding="utf-8")
        return len([line for line in body.splitlines() if line.startswith("test(")])

    return written("classify.test.mjs"), written("workflow-shape.test.mjs")


def test_every_count_of_the_n8n_recipes_suite_is_the_number_it_runs():
    """One suite, four surfaces, three different wrong numbers.

    A district buyer ran the command the page prints for the n8n recipe and got 35 tests
    where the page said 27. Twenty-seven is the classifier file on its own; the command names
    the shape file too, which adds eight. Following that number to its other homes found the
    plugin README and that plugin's `manifest.json` both saying "32 passing" for the same
    pair, and the manifest saying "The 24 classifier tests" where there are twenty-seven.
    Four surfaces, and the only one that was right was the app README, because it is the only
    one a gate was reading.

    So this reads all of them. Each is a count stated in prose next to a command nobody runs
    while editing prose, which is the condition every stale number in this repository has
    been found in.
    """
    classifier, shape = _node_suite_counts()
    assert classifier > 10 and shape > 3, (
        f"counted {classifier} and {shape} tests, so this is counting the wrong thing")
    both = classifier + shape

    plugin = APP.parents[2] / "plugins" / "firstbell-absence-calls"
    readme = (plugin / "README.md").read_text(encoding="utf-8")
    manifest = (plugin / "manifest.json").read_text(encoding="utf-8")

    wrong = []

    # The pair, in the fenced block the plugin README opens with and in the manifest field
    # that names the same command.
    for where, body in (("the plugin README", readme), ("manifest.json", manifest)):
        for stated in re.findall(r"(\d+) passing", body):
            if int(stated) != both:
                wrong.append(f"{where} says {stated} passing; the pair runs {both}")

    # The classifier alone, which is the number the manifest breaks out.
    for stated in re.findall(r"The (\d+) classifier tests", manifest):
        if int(stated) != classifier:
            wrong.append(
                f"manifest.json says {stated} classifier tests; there are {classifier}")

    # The shape file alone, spelled in the plugin README's own section about it and given in
    # digits in the manifest.
    for stated in re.findall(r"The (\d+) shape tests", manifest):
        if int(stated) != shape:
            wrong.append(f"manifest.json says {stated} shape tests; there are {shape}")
    spelled = re.search(r"The other ([\w-]+) tests read the generated workflow", readme)
    assert spelled, "the plugin README no longer states the shape count where this looks"
    in_words = {word: value for value, word in NUMBER_WORDS.items()}
    said = spelled.group(1).lower()
    counted = int(said) if said.isdigit() else in_words.get(said)
    if counted != shape:
        wrong.append(f"the plugin README says {said} shape tests; there are {shape}")

    # And the sentence in the app README that sends a reader to the plugin, which has to
    # agree about the eight it adds.
    app_readme = (APP / "README.md").read_text(encoding="utf-8")
    adds = re.search(r"The shape tests add ([\w-]+) more", app_readme)
    assert adds, "the app README no longer says how many the shape tests add"
    said = adds.group(1).lower()
    counted = int(said) if said.isdigit() else in_words.get(said)
    if counted != shape:
        wrong.append(f"the app README says the shape tests add {said}; they add {shape}")

    assert not wrong, "\n  ".join([""] + wrong)


def test_the_take_away_card_prints_commands_that_can_be_run():
    """The card offers two pieces of this entry to reuse, and neither command ran.

    A buyer took both. `node --test examples/classify.test.mjs
    examples/workflow-shape.test.mjs` runs nothing from the directory the page puts a reader
    in, because the files are three levels up and across in `plugins/`. And the count beside
    it was the count of one of the two files it names. The other row printed "44 tests" beside
    `python tools/double_conformance.py --check`, which runs no tests at all and prints one
    line, and 44 was the size of nothing in this tree.

    Both commands now start with `cd`, so this resolves each one against a fresh clone: the
    directory has to exist, every path argument in it has to exist inside that directory, and
    the numbers beside them have to be the numbers the files hold. A command in a caption is
    the last thing anyone runs, so it is checked here rather than trusted.
    """
    page = APP / "out" / "index.html"
    if not page.is_file():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    markup = page.read_text(encoding="utf-8", errors="replace")

    rows = re.findall(
        r"<p class=take-run><code>(.*?)</code>\s*<span class=take-n>(.*?)</span>", markup)
    assert len(rows) >= 2, (
        f"found {len(rows)} take-away command(s) on the page; the card offers two")

    root = APP.parents[2]
    for raw, count in rows:
        command = raw.replace("&amp;", "&").replace("&#8217;", "'")
        head, _, rest = command.partition(" && ")
        assert head.startswith("cd "), (
            f"`{command}` names no directory, so it runs wherever the reader happens to be "
            f"and the page never says where that is")
        where = root / head[3:].strip()
        assert where.is_dir(), f"`{head}` names a directory this repository does not have"
        args = [word for word in rest.split()
                if "/" in word and not word.startswith("-")]
        assert args, f"`{rest}` names no file, so this gate is checking nothing"
        for arg in args:
            assert (where / arg).is_file(), (
                f"`{command}` names {arg}, which does not exist under {head[3:].strip()}, "
                f"so a reader who runs it gets nothing")

    # Act 08 is called "Run it yourself" and printed two commands with no directory, so
    # neither ran from the root of a fresh clone. Same claim, same gate.
    # Any attributes on the element, not a bare `<pre>`. The block gained `tabindex`,
    # `role` and an `aria-label` when it turned out to be the one scrollable region on
    # the page that keyboard could not reach, and this gate went blind rather than red:
    # it stopped finding the block at all and reported that no directory was named.
    block = re.search(r"<pre[^>]*>(cd [^<]*)</pre>", markup)
    assert block, (
        "the command block in act 08 names no directory, so a reader who clones the "
        "repository and follows it is in the wrong place for both lines")
    where = root / block.group(1).splitlines()[0][3:].strip()
    assert where.is_dir(), f"act 08 says to be in {where}, which this repository has not got"
    assert (where / "requirements-dev.txt").is_file(), (
        "act 08 tells a reader to install from a requirements file that is not in the "
        "directory it puts them in")

    classifier, shape = _node_suite_counts()
    node_row = [count for raw, count in rows if "node --test" in raw]
    assert len(node_row) == 1, "the n8n row is not on the page under a node command"
    assert node_row[0].startswith(f"{classifier + shape} tests"), (
        f"the card says {node_row[0]!r} for a command that runs {classifier + shape}")

    record = json.loads(
        (APP / "evidence" / "api-shape.json").read_text(encoding="utf-8"))
    paths, missing = len(record["api_paths"]), len(record["missing_in_double"])
    double_row = [count for raw, count in rows if "double_conformance" in raw]
    assert len(double_row) == 1, "the offline CALL-E row is not on the page"
    assert double_row[0] == f"{paths} API paths, {missing} missing", (
        f"the card says {double_row[0]!r}; the conformance record holds {paths} paths and "
        f"{missing} missing")
# The claim this repository made nine times, in the shape it made it: a subject, a verb of
# being or holding, and the evidence page as where it is. A rule about prose is a weaker gate
# than a rule about a file, and this one is here because the defect was in prose, with no
# filename in seven of the nine.
#
# `SUBJECT` is sixty characters because the longest real subject was "the recordings and the
# receipts of real calls". `BETWEEN` is where a negation has to sit to count as one: "is on
# neither that page" is a denial, and "are not in this directory. They are on the evidence
# page" is the sentence this whole gate exists for, so a negation anywhere in the window
# would have skipped it.
LOCATED_THERE = re.compile(
    r"(?P<subject>[^.;:!?]{0,60})"
    r"\b(?:are|is|were|was|live|lives|held|sit|sits|published)\b"
    r"(?P<between>[^.;:!?]{0,40}?)"
    r"\bon (?:the|that)\b[^.;:!?]{0,30}?\b(?:evidence|linked) page\b", re.I)
# The same claim with its halves swapped: "on the evidence page, which is where the receipts
# of real calls are held". A mutation in that shape survived the first version of this gate,
# because the version above needs the thing named before the location. Nothing shipped in
# this shape; it is the shape anybody rewording the sentence would reach for next.
LOCATED_THERE_REVERSED = re.compile(
    r"\bon (?:the|that)\b[^.;:!?]{0,30}?\b(?:evidence|linked) page\b"
    # The window runs past the noun as well as up to it, because a denial written this way
    # round lands after it. "on the linked page while the receipt files are on neither
    # surface" is the honest sentence and "on the evidence page, which is where the receipts
    # of real calls are held" is the false one, and everything before the noun is the same.
    r"(?P<between>[^.;:!?]{0,70}?(?:receipts?\b|\b\d\d-[a-z0-9-]+\.json\b)"
    r"[^.;:!?]{0,45})", re.I)
A_DENIAL = re.compile(r"\b(?:not|never|neither|nor|outside)\b", re.I)
A_PRONOUN = re.compile(r"^(?:\W*)(?:they|it|those|these|both)\b", re.I)
# What counts as naming a receipt: the word, or one of the six files by name. The caption
# under act 03 said "06-locale-matched-pairs.json, which is on the evidence page rather than
# in the repository" and used neither the word nor a pronoun, so a rule that read only the
# word walked straight past it.
A_RECEIPT = re.compile(r"receipt|\b\d\d-[a-z0-9-]+\.json\b", re.I)
HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")


def _as_a_reader_sees_it(text: str) -> str:
    """Markup out, string-literal quotes out, whitespace collapsed.

    The page writes `on the <a href=...>evidence page</a>` and the builder writes the same
    sentence split across Python literals. Neither is a claim about a tag or a quote, and a
    gate that reads the bytes rather than the sentence missed both.
    """
    return re.sub(r"\s+", " ", HTML_TAG.sub(" ", text).replace('"', "").replace("'", ""))


def test_nothing_sends_a_reader_to_the_evidence_page_for_a_receipt():
    """The receipts are on nobody's disk but the author's, and nine surfaces said otherwise.

    `evidence/README.md` opened with "their receipts are not in this directory. They are on
    the evidence page". `README.md` said it twice, once in the money paragraph and once in
    the reading list. `docs/receipt-provenance.md` said it of the replay receipt, which is
    the one carrying the claim that no telephone rang. The page said it twice: in the footer
    under the escalation queue and in the caption under act 03, which is the page telling a
    reader that a file is on the page. A comment over the generated response fixtures said
    it, and so did the provenance line stamped inside each of those fixtures.

    What that page publishes is the recording of each call, its transcript, its waveform and
    a shortened id. No receipt file is on it, and none is in the tree. Nine of these were
    written by hand and four of the nine were found by this gate after I had fixed five and
    believed I was done.

    The honest version was already sitting in one of them: the counts are committed in
    `evidence/recorded-calls.json`, which names all six receipts and carries no conversation,
    no telephone number and no call id.
    """
    def read(where: str, path: Path) -> tuple[str, str]:
        """One surface, with the mutation ledger's own rows taken out of it first.

        Eleven rows in `evidence/MUTATIONS.md` record a change whose whole text is the
        sentence this gate refuses, so the gate flagged the repository's record of itself,
        in the file and again in the copy of that table the page renders. A ledger row
        describes a change somebody made on purpose and reverted. It is not a claim.

        Only that ledger, and only its rows. The README makes real claims inside tables,
        two of which this gate caught, and the prose around the ledger's table stays in
        scope. Both cuts happen before the text is flattened, because flattening removes
        the newlines and the tags a row is recognised by.
        """
        text = path.read_text(encoding="utf-8", errors="replace")
        if where == "MUTATIONS.md":
            text = "\n".join(ln for ln in text.splitlines() if not ln.startswith("|"))
        elif where == "out/index.html":
            text = re.sub(r"<tr>.*?</tr>", " ", text, flags=re.S)
        return where, _as_a_reader_sees_it(text)

    surfaces = [read(path.name, path)
                for path in _tracked_paths()
                if path.suffix in {".md", ".py"} and "test_claims" not in path.name]

    page = APP / "out" / "index.html"
    if page.is_file():
        surfaces.append(read("out/index.html", page))

    claiming = []
    for where, body in surfaces:
        for found in LOCATED_THERE_REVERSED.finditer(body):
            if A_DENIAL.search(found.group("between")):
                continue
            claiming.append(f"{where}: " + " ".join(found.group(0).split())[:170])

        for found in LOCATED_THERE.finditer(body):
            if A_DENIAL.search(found.group("between")):
                continue
            # Both halves of the claim, because the comment over the generated fixtures put
            # the noun in the second one: "are published as receipts on the linked evidence
            # page".
            said = found.group("subject") + found.group("between")
            if A_PRONOUN.search(said.strip()) or not said.strip():
                # The subject is somewhere before the full stop, which is exactly how the
                # sentence that started this was written.
                said = body[max(0, found.start() - 260):found.start()]
            if not A_RECEIPT.search(said):
                continue
            claiming.append(f"{where}: " + " ".join(found.group(0).split())[:170])

    assert not claiming, (
        "these say a receipt is on the evidence page, and that page publishes recordings, "
        "transcripts, waveforms and shortened ids, and no receipt file:\n  "
        + "\n  ".join(claiming)
    )


def test_the_queue_rows_are_the_number_the_committed_record_holds():
    """A count no reader could check, made checkable by the one artifact that travels.

    The footer under the escalation queue names the receipt those four rows come from and
    says nothing there was arranged for the picture. Neither half could be checked, because
    the receipt is published nowhere. What is committed is `evidence/recorded-calls.json`,
    which records that receipt by name, the seven calls it placed and the four of them that
    needed a human. Four is the number of rows.

    The first version of this held each number against the record and then looked for the
    digits in the footer, which "the 4 of them that needed a human" satisfied twice over: a
    footer claiming five rows above four rows passed it. So it holds the sentence now.
    """
    page = APP / "out" / "index.html"
    if not page.is_file():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    markup = page.read_text(encoding="utf-8", errors="replace")

    record = json.loads(
        (APP / "evidence" / "recorded-calls.json").read_text(encoding="utf-8"))
    named = "06-locale-matched-pairs.json"
    row = next((r for r in record["per_receipt"] if r["receipt"] == named), None)
    assert row, f"{named} is in no row of evidence/recorded-calls.json"

    drawn = len(re.findall(r'class="queue-row', markup))
    assert drawn == row["escalated"], (
        f"the queue draws {drawn} row(s) and the committed record says {row['escalated']} of "
        f"that receipt's calls needed a human")

    found = re.search(r"<p class=queue-foot>(.*?)</p>", markup, re.S)
    assert found, "the queue footer is gone, and with it the only place these counts are said"
    said = " ".join(found.group(1).split())
    for phrase in (f"{row['calls']} calls",
                   f"the {row['escalated']} of them",
                   f"which is the {drawn} rows here"):
        assert phrase in said, (
            f"the footer does not say {phrase!r}, so a reader cannot check these rows "
            f"against the one record that is committed")



def test_every_pair_the_readme_publishes_adds_up_to_the_number_collected():
    """The count above them was checked. What they add up to was not.

    `README.md` states the number of tests collected, and then explains it with the pairs
    a reader can reproduce: what a clean checkout reports, what the same suite reports once
    the page is built and the gates have run, and what it reports on a built tree without
    the recordings. Every pair describes the same suite, so every one has to sum to the
    same number, and that number is the one directly above them.

    The closing sentence was read for the literal word "both" until a third pair was
    published on 2026-09-13, at which point the gate failed on the wording rather than on
    the arithmetic. A gate that counts pairs should not also hard-code how many there are.

    They did not. The tree grew by eighteen tests in one night, the collected count moved
    because a gate made it move, and both pairs went on adding up to the figure from the
    commit before. A reader checking the arithmetic in that paragraph would have found it
    consistent with itself and inconsistent with the line above it, which is the worst
    shape a published number can take: it looks checked because its neighbour is.

    Three more figures in the same paragraph are checked here for the same reason. The
    first run in a fresh clone reports one more skip and one fewer pass, because the figure
    on the first screen is generated and `tools/make_figure.py --check` has nothing to
    compare against until it has run once; that pair is derived from the clean pair rather
    than read. The breakdown of the skips by reason is spelled in words, so a grep for a
    digit finds none of it, and it has to add up to the skip count two sentences above it.
    """
    collected = _collected_test_count()
    readme = re.sub(r"\s+", " ", (APP / "README.md").read_text(encoding="utf-8"))

    pairs = [(int(passed), int(skipped)) for passed, skipped
             in re.findall(r"\*\*(\d+) passed, (\d+) skipped\*\*", readme)]
    assert len(pairs) >= 2, (
        f"the README publishes {len(pairs)} measured pair(s) and the paragraph explaining "
        "the collected count needs two: what a clean checkout reports and what a built one "
        "reports")

    for passed, skipped in pairs:
        assert passed + skipped == collected, (
            f"the README publishes {passed} passed and {skipped} skipped, which is "
            f"{passed + skipped}, and the suite collects {collected}. Both pairs describe "
            "this suite, so a pair that does not add up to the count above it was measured "
            "on a tree that no longer exists")

    stated = re.search(r"(?:both|all \w+) add up to (\d+)", readme)
    assert stated, (
        "the README no longer says what the pairs add up to, and that sentence is the "
        "one a reader checks the arithmetic against")
    assert int(stated.group(1)) == collected, (
        f"the README says both pairs add up to {stated.group(1)} and the suite collects "
        f"{collected}")

    # The clean pair is the one with more skips, because the skips are what a clean
    # checkout has instead of a built page.
    clean = max(pairs, key=lambda pair: pair[1])
    first = re.search(r"one more skip and one fewer pass, (\d+) and (\d+)", readme)
    assert first, (
        "the README no longer states the first-run pair, and two runs of the same suite on "
        "the same commit giving two answers is worth saying rather than leaving a reader to "
        "wonder which of us miscounted")
    assert (int(first.group(1)), int(first.group(2))) == (clean[0] - 1, clean[1] + 1), (
        f"the first-run pair reads {first.group(1)} and {first.group(2)}, and one fewer "
        f"pass and one more skip than {clean[0]} and {clean[1]} is {clean[0] - 1} and "
        f"{clean[1] + 1}")

    opens = readme.find("passing quietly:")
    assert opens != -1, (
        "the README no longer breaks the skips down by reason. A skip here is a "
        "could-not-measure rather than a pass, so a reader is owed the reason for each one")
    span = readme[opens:]
    shuts = span.find("Build the page and run the gates")
    assert shuts != -1, "the breakdown no longer ends where this gate reads it to"
    span = span[:shuts]

    backwards = {word: value for value, word in NUMBER_WORDS.items()}
    # No leading comma or "and" required. The first clause of the sentence follows a
    # colon, so a pattern wanting one of those in front of the number word read four of
    # the five clauses and would have passed a breakdown missing the largest of them.
    named = re.findall(r"\b([a-z-]+) (?:wants|want|is)\b", span)
    counted = [backwards[word] for word in named if word in backwards]
    assert len(counted) >= 3, (
        f"the breakdown names {len(counted)} reasons and the skips come from more than "
        f"that. Clauses read: {named}")
    assert sum(counted) == clean[1], (
        f"the breakdown accounts for {sum(counted)} skips {named} and a clean checkout "
        f"reports {clean[1]}")
    assert NUMBER_WORDS[clean[1]] in readme.lower(), (
        f"the README does not spell the skip count in words beside the breakdown, and "
        f"{clean[1]} is '{NUMBER_WORDS[clean[1]]}'")
