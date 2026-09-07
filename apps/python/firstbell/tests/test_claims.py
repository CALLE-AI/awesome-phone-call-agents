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
    placed = re.search(r"^\s+calls placed\s+(\d+)", printed, re.M)
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
    documents = {"README.md": 4, "docs/images/README.md": 4}
    pairs = []
    for name, least in documents.items():
        found = ANCHOR.findall((APP / name).read_text(encoding="utf-8"))
        assert len(found) >= least, (
            f"expected at least {least} runtime anchors in {name}, found {len(found)}. "
            "If they were removed on purpose, lower this number deliberately."
        )
        pairs.extend(found)

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
    found = re.search(r"## If you have (\w+) minutes", readme)
    assert found, "the README no longer has a reading order"
    assert found.group(1) in words, (
        f"the reading order offers '{found.group(1)}' minutes, which this test cannot score"
    )
    order = readme.split(found.group(0), 1)
    assert len(order) == 2, "the README no longer has a reading order"
    table = order[1].split("### Where CALL-E is called", 1)[0]

    linked = re.findall(r"\]\(([^)]+)\)", table)
    assert 4 <= len(linked) <= 8, (
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


def test_the_readme_states_the_real_number_of_mutations():
    """The third count in this README to go stale, and the first one caught from outside.

    A blind reviewer found "Twenty-two gates" and "Thirteen of them" in a file whose own
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
GATES_THAT_CANNOT_ALWAYS_RUN = {
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
    "_page":
        "reads out/index.html to check the counts the page spells out in a sentence against "
        "the data those sentences describe. The page is built from receipts that are "
        "deliberately not committed, so on a clean checkout there is nothing to read",
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
    start = readme.find("So the office still works a list by hand.")
    end = readme.find("## ", start)
    assert start > 0 and end > start, "the sourced statistics section has moved or gone"
    section = readme[start:end]

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

    assert not wrong, (
        "the README quotes kill counts the mutation table disagrees with:\n  "
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

    words = {name: value for value, name in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen "
        "fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}

    wrong = []
    for match in re.finditer(r"\b(\d+) fails ([a-z]+|\d+) tests?\b", text):
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
    stated = re.search(r"except\s+the (\w+) marked \*\*needs the built page\*\*", text,
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
    that: a URL passed in reaches the page, and no URL leaves no dangling markup.
    """
    import sys

    sys.path.insert(0, str(APP / "tools"))
    from judge_page import video_link_markup

    assert video_link_markup(None) == "", (
        "the page would carry an empty video link, which reads as a broken one"
    )
    assert video_link_markup("") == ""

    markup = video_link_markup("https://youtu.be/abc123")
    assert "https://youtu.be/abc123" in markup
    assert markup.startswith("<p") and markup.endswith("</p>")

    # A URL is a build input, so it is attacker-adjacent in the same way every other input
    # on this page is, and the page ships under a Content-Security-Policy that a quote
    # break would not save it from.
    hostile = video_link_markup('https://x/"><script>alert(1)</script>')
    assert "<script>" not in hostile, "the video URL is written into an attribute unescaped"
    assert "&quot;" in hostile or "&#x27;" in hostile
