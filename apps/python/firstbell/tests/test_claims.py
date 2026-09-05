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
        "attempts billed     7",
        "attempts removed    4",
        "attempts still open 3",
        "break-even          $0.22 per call, for every minute one manual attempt takes",
    ]
    for line in quoted:
        assert line in printed, "the README quotes a line the program no longer prints: " + line
        assert line in readme, "the program prints a line the README no longer quotes: " + line

    # The derived three-minute figure, recomputed from the same inputs.
    staff = StaffCost.us_school_office()
    ceiling = (4 / 7) * (staff.hourly / 60.0)
    assert f"**${ceiling * 3:,.2f} a call**" in readme, (
        "the README's three-minute break-even no longer matches the arithmetic"
    )
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
    heading offers a reader ten minutes, every row states its own cost, and nothing was
    checking that those two agree. They did not, by a minute, from the day the section was
    written.

    The count is a range rather than a number. Pinning it to exactly five meant that adding
    a sixth file broke a test about dead links, which is not what that test is for. The
    lower bound is what stops the list quietly emptying.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    heading = "## If you have ten minutes"
    order = readme.split(heading, 1)
    assert len(order) == 2, "the README no longer has a reading order"
    table = order[1].split("### Where CALL-E is called", 1)[0]

    linked = re.findall(r"\]\(([^)]+)\)", table)
    assert 4 <= len(linked) <= 8, (
        f"the reading order has {len(linked)} entries, which is either too few to be a "
        "reading order or too many to read in the time offered"
    )
    for rel in linked:
        assert (APP / rel).exists(), f"the reading order points at {rel}, which does not exist"

    budget = int(re.search(r"## If you have (\w+) minutes", readme).group(1)
                 .replace("ten", "10").replace("fifteen", "15").replace("twenty", "20"))
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


NUMBER_WORDS = {
    13: "thirteen", 18: "eighteen", 22: "twenty-two", 26: "twenty-six",
    27: "twenty-seven", 28: "twenty-eight", 29: "twenty-nine", 30: "thirty",
    33: "thirty-three", 34: "thirty-four", 35: "thirty-five",
    36: "thirty-six", 37: "thirty-seven", 38: "thirty-eight",
    31: "thirty-one", 32: "thirty-two", 39: "thirty-nine", 40: "forty", 41: "forty-one", 42: "forty-two", 43: "forty-three", 44: "forty-four",
}


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

    readme = (APP / "README.md").read_text(encoding="utf-8")
    assert f"{word.capitalize()} gates broken on purpose" in readme, (
        f"MUTATIONS.md has {rows} rows, so the README should say "
        f"'{word.capitalize()} gates broken on purpose'"
    )

    # And no other spelled-out count may appear beside the word "gates", which is how the
    # stale "Thirteen of them" survived several edits.
    for other, other_word in NUMBER_WORDS.items():
        if other == rows:
            continue
        assert f"{other_word.capitalize()} gates" not in readme, (
            f"the README still says '{other_word.capitalize()} gates' somewhere"
        )
        assert f"{other_word.capitalize()} of them" not in readme, (
            f"the README still says '{other_word.capitalize()} of them' somewhere"
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
