"""No real-call artifact may be committed to this repository.

The upstream maintainer of this list has removed committed real-call material from several
pull requests, and has stated the requirement in terms that leave no room for the obvious
defence: it applies even where the people on the call were team members playing a part, and
even where the numbers dialled were reserved ones that can never be assigned. That is exactly
what this project's calls were, so the rule binds here.

Which leaves the question of what stops it coming back. Four authors upstream had to be told
by hand, and one of them had already run a scrub of their own and still shipped provider call
ids. A rule that lives in a review comment gets re-learned once per contributor. So it lives
here instead, and it runs on every commit.

What counts as a real-call artifact, in the order these are cheapest to check:

  - a receipt that says it reached the production API
  - a provider call id, which is the vendor's own handle for a conversation
  - transcript text, which is the conversation itself
  - a dialled number that is not from a reserved range

Two things this deliberately does not do. It does not read the recordings to check them,
because they are not here to read. And it does not scan the working tree: it scans what git
tracks, because an untracked file is not committed and an ignored build directory would
otherwise fail this on output nobody is publishing.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Iterator

import pytest

APP = Path(__file__).resolve().parent.parent
SELF = Path(__file__).resolve()
REPO = APP.parent.parent.parent

# Every directory this contribution adds, relative to the repository root.
#
# This used to be `APP` alone, and two documents said otherwise: `README.md` and
# `THIRD-PARTY-NOTICES.md` both state that every number in this repository is fictional and
# that this file fails the build if one is not. It could not. `git ls-files -- <APP>` stops
# at `apps/python/firstbell/`, so `plugins/firstbell-absence-calls/` was outside the file
# set from the day it was added, and it was where an assignable Indian mobile was sitting.
#
# A scope narrower than the claim is worse than no gate, because the claim is what a reader
# relies on.
CONTRIBUTION_PATHS = (
    "apps/python/firstbell",
    "plugins/firstbell-absence-calls",
)

# Assertion messages here list offenders one per line. The separator is a constant
# because a literal escape inside one of these strings has been mangled twice by the
# tooling used to edit this file, once into a backspace byte that nothing displayed.
NEWLINE_INDENT = "\n  "

# The vendor's handle for a call: `call_` and then twenty-odd characters of base64-ish text.
# Written to need both a length and some evidence of encoding, so that the double's own
# `call_1` and a sentence containing the words "call_id" do not match.
PROVIDER_ID = re.compile(r"\bcall_[A-Za-z0-9_-]{16,}\b")

# The other one, and the one that matters more. CALL-E's dashboard and its usage page are
# keyed on `recipients[].attempts[].provider_call_id`, a bare 32-character hex string, so
# that is the value which joins a call to a billing record. It looks like nothing in
# particular, which is exactly why a scrub aimed at `call_...` walks straight past it: the
# first version of this module did, and found one sitting in the documentation as an example.
BILLING_ID = re.compile(r"(?<![0-9a-fA-F])[0-9a-f]{32}(?![0-9a-fA-F])")

# Numbers that may appear anywhere: a country code followed by a subscriber number starting
# 555, which is the convention that exists so a published example cannot dial a stranger.
#
# Worth being exact about how much this is worth, because the convention is not equally
# solid everywhere. In the United States 555-0100 to 555-0199 is formally set aside for
# fiction, and the United Kingdom and India publish comparable ranges. Australia, Singapore
# and Sri Lanka appear on this list because the region-routing tests need a number in each
# and those administrations publish no fiction range, so 555 is applied there by analogy
# and not by anybody's authority. What is true of all of them is that no operator has been
# observed to assign one, and that none of these was ever dialled: the calls this project
# placed went to a handset the author was holding.
RESERVED_PREFIXES = (
    "+1555", "+44555",                      # formally reserved for fiction
    "+91555", "+9155500",                   # India, the region this app targets
    "+61455", "+94555", "+65555",           # by analogy: no published fiction range
)

# Fixtures are allowed to hold authored dialogue, and only these. Each one has to say so in
# its own text, which is checked below rather than assumed from the filename.
AUTHORED_FIXTURES = "tests/data/shape-"

# Ids a test may use literally, because a test that asserts on the shape of an id needs a
# value of that shape. Listed one by one rather than matched by a rule, so that a reviewer
# can read every one of them and satisfy themselves that none is random. A rule such as "hex
# with a repeating pattern is fine" would eventually let a real one through, and the point
# of an allowlist is that adding to it is a visible act.
#
# `test_dispatch.py` held a real thirty-two-character billing id here until this check was
# written. It was the same one the documentation was using as an example. This module then
# did the same thing to itself: it held three real ids, and the exemption below let them sit
# there for a day. Every value now has to pass the same reading, including the ones in this
# file, which is why the last three are here rather than thirty lines further down.
PLACEHOLDER_IDS = frozenset({
    "aaaa1111bbbb2222cccc3333dddd4444",
    "bbbb2222cccc3333dddd4444eeee5555",
    # Three shapes the shortener has to survive: a second underscore inside the body, a
    # leading hyphen, and a bare 32-hex billing id with no prefix at all.
    "call_x_aaaa1111bbbb2222cccc3333",
    "call_-bbbb2222cccc3333dddd4444",
    "cccc3333dddd4444eeee5555ffff6666",
})


def tracked_files() -> list[Path]:
    """Every file git tracks under this app, from git itself.

    Not a glob. A glob over the working tree reports build output, virtualenvs and anything
    a contributor left lying around, and none of that is committed. Asking git is also the
    only way to be right about a file that is present but ignored.
    """
    root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=APP, capture_output=True, text=True, check=True,
    ).stdout.strip()
    # --full-name, so the paths are relative to the repository root and not to this
    # subdirectory. Without it `git ls-files` answers relative to the working directory,
    # every path joins onto the wrong prefix, and the checks below read nothing at all
    # while reporting a healthy file count. That is how the first version of this module
    # passed with the artifacts it exists to forbid still committed.
    # From the repository root, over every path this contribution adds, so a directory
    # added later cannot quietly sit outside the check.
    for relative in CONTRIBUTION_PATHS:
        assert (REPO / relative).is_dir(), (
            f"CONTRIBUTION_PATHS names {relative}, which is not a directory. A renamed or "
            f"moved path must fail here loudly rather than shrink the file set silently."
        )
    out = subprocess.run(
        ["git", "ls-files", "-z", "--full-name", "--", *CONTRIBUTION_PATHS],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout
    return [Path(root) / name for name in out.split("\0") if name]


@pytest.fixture(scope="module")
def tracked() -> list[Path]:
    files = tracked_files()
    assert len(files) > 30, (
        f"git reports only {len(files)} tracked files under {APP}, which is too few to be "
        "this app. Every check in this module would pass on an empty list, so the list "
        "itself is asserted first."
    )
    # A count is the wrong property to guard, which the first version of this module found
    # out the hard way: it counted sixty names, of which fifty-seven pointed at nothing,
    # and every check below read an empty file list and passed. Assert that the paths
    # resolve, not that there are a lot of them.
    missing = [p for p in files if not p.exists()]
    assert not missing, (
        f"{len(missing)} of {len(files)} tracked paths do not resolve, so these checks "
        f"would silently read nothing. First few: {[str(p) for p in missing[:3]]}"
    )
    readable = [p for p in files if p.suffix == ".json"]
    assert len(readable) >= 3, (
        f"only {len(readable)} tracked JSON files, and the checks that matter here parse "
        "JSON. A tree with none would pass this module for the wrong reason."
    )
    return files


def text_of(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, FileNotFoundError, OSError):
        return None


def json_documents(files: list[Path]) -> Iterator[tuple[Path, Any]]:
    for path in files:
        if path.suffix != ".json":
            continue
        body = text_of(path)
        if body is None:
            continue
        try:
            yield path, json.loads(body)
        except json.JSONDecodeError:
            continue


def walk(node: Any, trail: str = "") -> Iterator[tuple[str, str, Any]]:
    if isinstance(node, dict):
        for key, child in node.items():
            yield from walk(child, f"{trail}.{key}")
            yield trail, str(key), child
    elif isinstance(node, list):
        for child in node:
            yield from walk(child, trail + "[]")


def test_no_committed_receipt_claims_it_reached_the_production_api(tracked):
    """A receipt saying it dialled production is a record of a call that really happened."""
    offenders = []
    for path, document in json_documents(tracked):
        for _trail, key, value in walk(document):
            if key == "reached_production_api" and value is True:
                offenders.append(f"{path.name}: reached_production_api is true")
            if key == "mode" and value == "live":
                offenders.append(f"{path.name}: mode is live")
            if key == "api_base_url" and isinstance(value, str) and "heycall-e.com" in value:
                offenders.append(f"{path.name}: api_base_url names the production host")
    assert not offenders, (
        "these committed files are records of real calls:\n  " + "\n  ".join(sorted(set(offenders)))
    )


def test_no_provider_call_id_is_committed(tracked):
    """The vendor's own id for a conversation, which is what one upstream scrub missed."""
    offenders = []
    for path in tracked:
        # This file is scanned like every other. It used to be skipped, on the reasoning that
        # a module describing a pattern has to be allowed to contain it. That was true of the
        # regex and false of everything else, and three real ids lived here behind it. The
        # allowlist is the exemption now, because adding to the allowlist is something a
        # reviewer sees.
        body = text_of(path)
        if body is None:
            continue
        hits = [h for h in PROVIDER_ID.findall(body) if h not in PLACEHOLDER_IDS]
        if hits:
            offenders.append(f"{path.name}: {len(hits)} call id(s)")
        billing = [h for h in BILLING_ID.findall(body) if h not in PLACEHOLDER_IDS]
        if billing:
            offenders.append(f"{path.name}: {len(billing)} provider_call_id(s), 32-hex")
    assert not offenders, (
        "these committed files carry provider call ids:\n  " + "\n  ".join(sorted(offenders))
    )


# What a list of spoken turns looks like, whatever the key above it is called.
#
# This used to read `key == "transcript_turns"` and nothing else, and a file went straight
# past it: `tools/glosses.json` holds 53 turns from four real calls under the key `turns`,
# and the gate written to stop exactly that could not see it. A gate keyed on a name only
# checks the files that happened to use the name, which is the same as checking the files
# that were already known about.
#
# So the shape is the test. A turn is an object carrying something said and who said it,
# and any list of those is dialogue no matter what its parent is called.
TURN_KEYS = ({"text", "speaker"}, {"text", "who"}, {"said", "speaker"}, {"ta", "en"})


def turn_list(value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    first = value[0]
    if not isinstance(first, dict):
        return False
    keys = set(first)
    return any(wanted <= keys for wanted in TURN_KEYS)


# Files that hold real conversation on purpose, each with the reason written next to it.
#
# An exception a gate cannot see is an accident. An exception listed here is a decision, and
# adding a line to this tuple is a visible act in a diff, which is the whole point.
#
# `tools/glosses.json` carries the Tamil turns of four real calls with their English. It is
# here because the organiser's Language Requirements rule asks that an English translation
# accompany every submitted material, and four of the eight published calls were placed in
# Tamil. The page cannot print a Tamil transcript with no English beside it and satisfy that
# rule, and the English cannot be checked against the Tamil unless both are committed. The
# maintainer's ruling on PR #300 covers this file, `evidence/README.md` says so in the same
# words, and the undertaking there is unconditional: say so on the pull request and this file
# and the transcripts on the page both come off.
DECLARED_TRANSCRIPT_FILES = (
    "apps/python/firstbell/tools/glosses.json",
)


def transcript_offenders(documents) -> list[str]:
    """The rule itself, lifted out of the gate so that it can be shown a document.

    It used to sit inside the test, which meant the only documents it had ever been run
    against were the ones already in the tree. That is how it spent a fortnight matching a
    key name: nothing could hand it a file using a different one and watch what happened.
    """
    offenders = []
    for path, document in documents:
        spoken = [value for _t, _key, value in walk(document) if turn_list(value)]
        if not spoken:
            continue
        relative = path.as_posix()
        if any(relative.endswith(declared) for declared in DECLARED_TRANSCRIPT_FILES):
            continue
        if AUTHORED_FIXTURES not in relative:
            offenders.append(f"{relative}: holds transcript turns and is not an authored fixture")
            continue
        note = document.get("_provenance")
        if not isinstance(note, str) or "Authored, not recorded" not in note:
            offenders.append(
                f"{relative}: holds transcript turns without saying it was authored")
    return offenders


def test_the_gate_catches_a_conversation_filed_under_an_unfamiliar_key():
    """Hand the rule a document and watch it, rather than trusting the tree stays typical.

    This is the file the previous gate would have let through: real dialogue, in a tracked
    path that is not an authored fixture, under a key nobody had thought of. The gate is
    given it directly, so the check does not depend on such a file existing in order to
    mean something.
    """
    said = [{"text": "Hello, who's this?", "speaker": "user"}]
    smuggled = Path("apps/python/firstbell/tools/somewhere-new.json")

    assert transcript_offenders([(smuggled, {"lines": said})]), (
        "a tracked file carrying a conversation under the key 'lines' passed the gate, "
        "which is the shape of the miss this was written after")
    assert transcript_offenders([(smuggled, {"calls": {"S-1": {"turns": said}}})]), (
        "dialogue nested two levels down passed the gate")

    # And the three outcomes that are not offences, so the gate cannot be made to pass by
    # reporting everything it is shown.
    assert not transcript_offenders([(smuggled, {"counts": {"calls": 12, "answered": 11}})])
    assert not transcript_offenders(
        [(Path("apps/python/firstbell/tools/glosses.json"), {"calls": {"S": {"turns": said}}})])
    fixture = Path("apps/python/firstbell/tests/data/shape-call.json")
    assert not transcript_offenders(
        [(fixture, {"transcript_turns": said, "_provenance": "Authored, not recorded."})])


def test_dialogue_is_recognised_by_its_shape_and_not_by_one_key_name():
    """The detector itself, pinned, because narrowing it back would go unnoticed.

    The gate below reads every tracked JSON document, and once `tools/glosses.json` is a
    declared exception there is nothing left in the tree for it to catch. That is the state
    the previous version was in without anybody knowing: it matched the key
    `transcript_turns`, the one file holding real conversation used `turns`, and the suite
    was green because the gate was looking in the wrong place rather than because the tree
    was clean. A gate with nothing left to find has to be checked against examples instead.
    """
    said = [{"text": "Hello, who's this?", "speaker": "user"}]
    assert turn_list(said), "a plain turn list is dialogue"

    for key in ("transcript_turns", "turns", "lines", "exchange", "utterances"):
        assert turn_list({key: said}[key]), (
            f"dialogue under the key {key!r} was not recognised, so a file could carry a "
            "conversation past this gate by naming its list something new")

    for shape in ({"ta": "வணக்கம்", "en": "Greetings"},
                  {"said": "Hello", "speaker": "bot"},
                  {"text": "Hello", "who": "parent"}):
        assert turn_list([shape]), f"{sorted(shape)} is a turn and was not seen as one"

    for not_dialogue in ([], [1, 2, 3], ["a string"], [{"id": "S-1", "count": 4}],
                         [{"file": "x.json", "sha256": "ab"}], "not a list even"):
        assert not turn_list(not_dialogue), (
            f"{not_dialogue!r} is not dialogue, and a detector that says it is would put "
            "this gate in front of every list in the repository")


def test_transcript_text_appears_only_in_fixtures_that_declare_themselves_authored(tracked):
    """Conversation text is the artifact itself, so the exceptions have to be explicit.

    A fixture is allowed to hold dialogue somebody on this project wrote. It is not allowed
    to hold dialogue and stay quiet about which of the two it is, because that is the state
    a reader cannot tell apart from a recording.
    """
    offenders = transcript_offenders(json_documents(tracked))
    assert not offenders, (
        "transcript text in the wrong place:\n  " + "\n  ".join(sorted(offenders))
    )


NUMBER = re.compile(r"\+\d{10,15}")

# A run of ascending digits. No operator anywhere assigns 12345678, which is why it is the
# universal stand-in for a number in documentation. Allowed in source, and not in a fixture:
# see the two checks below for why those are different questions.
SEQUENTIAL = re.compile(r"1234567")


def numbers_in(path: Path) -> set[str]:
    body = text_of(path)
    return set(NUMBER.findall(body)) if body else set()


def test_no_number_in_a_committed_fixture_could_ring_a_real_person(tracked):
    """The strict rule, and it applies where a number stands for a call.

    A number in a fixture or a receipt is a record of somewhere this project dialled, so
    nothing but a reserved range will do. India's 5555xxxxxx block and the international
    555 convention exist so that a published example cannot reach a stranger.
    """
    offenders = []
    for path in tracked:
        if path.suffix not in (".json", ".csv", ".md"):
            continue
        if path.resolve() == SELF:
            continue
        for hit in numbers_in(path):
            if not hit.startswith(RESERVED_PREFIXES):
                offenders.append(f"{path.as_posix().split('firstbell/')[-1]}: {hit}")
    assert not offenders, (
        "a fixture, receipt or document holds a number that is not from a reserved "
        "range:\n  " + "\n  ".join(sorted(set(offenders)))
    )


def test_a_row_closed_on_an_answer_that_said_nothing_is_marked_as_one():
    """The row act 03 argues about cannot sit unmarked in act 04.

    `call_L9Ms...MYgA` is `unknown / unknown / unknown` with the outcome `resolved`, because
    that is what the committed receipt records and the receipt is committed uncorrected on
    purpose. Act 03 explains it. For a fortnight the row itself carried nothing, so a reader
    who reached act 04 first met a table contradicting the argument with no link to it, and
    both readers who checked found the row before the paragraph.

    The condition is asserted rather than the call id: every row whose outcome is `resolved`
    and whose every shown field is empty or "unknown" has to carry the mark, and no other
    row may. That way the same defect on a different call would be caught by this test
    rather than needing to be added to it.
    """
    page = APP / "out" / "index.html"
    if not page.exists():
        pytest.skip("the page has not been built in this checkout")
    page_markup = page.read_text(encoding="utf-8")

    rows = re.findall(r"<tr role=row>(.*?)</tr>", page_markup, re.S)
    table_rows = [r for r in rows if "data-label=outcome" in r]
    assert len(table_rows) >= 4, (
        f"the identifier table has {len(table_rows)} rows, which is too few to be the "
        "committed calls"
    )

    should, marked = [], []
    for row in table_rows:
        cells = re.findall(r'<td role=cell data-field="([^"]+)"[^>]*>(.*?)</td>', row, re.S)
        outcome = re.search(r'<span class="state state-[a-z]+">([a-z]+)</span>', row)
        if not outcome or not cells:
            continue
        told = any(re.sub(r"<[^>]+>", "", value).strip().lower()
                   not in ("", "unknown", "·", "&#183;")
                   for _name, value in cells)
        ident = re.search(r"call_[^<\s]+", row)
        key = ident.group(0) if ident else row[:40]
        if outcome.group(1) == "resolved" and not told:
            should.append(key)
        if "row-flag" in row:
            marked.append(key)

    assert should, (
        "no row in the identifier table is a record closed on an answer that said nothing. "
        "If the committed receipts changed, this test is the thing to reconsider, but the "
        "S-3004 row is the reason act 03 exists"
    )
    assert sorted(marked) == sorted(should), (
        f"rows meeting the condition: {should}. Rows carrying the mark: {marked}. Every "
        "record this software closed while learning nothing has to say so where a reader "
        "meets it, not only in the act that explains it"
    )


def test_no_number_in_the_source_could_ring_a_real_person(tracked):
    """The looser rule, and the reason it is looser is worth stating rather than hiding.

    Some tests exist to check that a number is parsed and routed by region: Australia,
    Singapore, Sri Lanka, and one deliberately invalid country code. A reserved range does
    not exist for every one of those countries, and inventing one would be worse than
    saying so. What those numbers need is to be unassignable in practice and obviously not
    anybody's, which a run of ascending digits achieves.

    So two categories are allowed here, both named: a reserved prefix, or a sequential
    pattern. Anything else fails, including a plausible-looking number somebody pasted in
    from a real handset. This started as one check called "every dialled number is from a
    reserved range", which was a stronger claim than the tree could support.
    """
    offenders = []
    for path in tracked:
        if path.suffix in (".json", ".csv"):
            continue
        if path.resolve() == SELF:
            continue
        for hit in numbers_in(path):
            if hit.startswith(RESERVED_PREFIXES) or SEQUENTIAL.search(hit):
                continue
            offenders.append(f"{path.name}: {hit}")
    assert not offenders, (
        "these are neither reserved nor obviously synthetic, so one of them may belong to "
        "somebody:\n  " + "\n  ".join(sorted(set(offenders)))
    )


# ---------------------------------------------------------------------------
# Images, and the one thing every check above cannot do
# ---------------------------------------------------------------------------
#
# Nothing above can read a picture. Every check in this module reads text, and a phone
# number, a provider id or a whole transcript rendered into pixels walks past all of them.
#
# That is not hypothetical either. A screenshot of the deployed evidence page was committed
# to this repository and passed every check here, while displaying twelve real API call ids
# and twelve real thirty-two-character billing ids in a table. The text scanner reported the
# tree clean because a PNG is not text.
#
# So the control for images is provenance rather than content. An image may be committed if
# it was produced from things that are already in this repository, and the one tool that
# does that, tools/gates/capture-stills.mjs, reads source files and runs the offline CLI.
# What may not be committed is anything rendered from the call recordings, which in practice
# means the output of tools/judge_page.py under out/ and the gate harness's screenshots
# under tools/gates/shots/.
#
# The limitation is stated rather than papered over: these checks would not catch a
# hand-edited PNG. What they catch is the way it actually happened.

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm")
IMAGE_HOME = "docs/images/"
STILL_TOOL = "tools/gates/capture-stills.mjs"
RECEIPT_DERIVED_DIRS = ("out", "tools/gates/shots")


def test_every_committed_image_is_declared(tracked):
    """A picture nothing describes is a picture nobody checked.

    Adding an image has to be a visible act, because the reviewer is the only thing that
    can read one. `docs/images/README.md` says what each shows and the command that
    regenerates it, and this fails on an image that is not in it.
    """
    images = [p for p in tracked if p.suffix.lower() in IMAGE_SUFFIXES]
    index = APP / "docs" / "images" / "README.md"
    if not images:
        pytest.skip("no images are committed yet")
    assert index.exists(), (
        f"{len(images)} image(s) are committed and docs/images/README.md does not exist, "
        "so nothing says what any of them show"
    )
    listed = index.read_text(encoding="utf-8")
    problems = []
    for path in images:
        relative = path.as_posix().split("firstbell/")[-1]
        if not relative.startswith(IMAGE_HOME):
            problems.append(f"{relative}: images live under {IMAGE_HOME}")
        elif path.name not in listed:
            problems.append(f"{relative}: not described in docs/images/README.md")
    assert not problems, "\n  ".join([""] + sorted(problems))


def test_no_committed_image_was_rendered_from_the_call_recordings(tracked):
    """The exact way a real artifact got in here, turned into a check.

    The evidence page is built from the recordings, so a screenshot of it is a real-call
    artifact in a format no text scanner can read. Byte-comparing every committed image
    against the two directories that hold receipt-derived renders catches that, which is
    the specific mistake this repository already made once.
    """
    import hashlib

    images = [p for p in tracked if p.suffix.lower() in IMAGE_SUFFIXES]
    if not images:
        pytest.skip("no images are committed yet")

    # `tools/gates/shots/` holds two unrelated things, which is why this is a prefix rule
    # and not a directory rule. `still-*.png` are the working copies of the annotated
    # stills, built by capture-stills.mjs from source files and the offline CLI, and they
    # are the same bytes as the committed ones by design. Everything else there is an act
    # screenshot of the page the recordings produced.
    derived: dict[str, str] = {}
    for directory in RECEIPT_DERIVED_DIRS:
        root = APP / Path(directory)
        if not root.is_dir():
            continue
        for candidate in root.rglob("*"):
            if not candidate.is_file() or candidate.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            if candidate.parent.name == "shots" and candidate.name.startswith("still-"):
                continue
            digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
            derived[digest] = candidate.as_posix().split("firstbell/")[-1]

    if not derived:
        pytest.skip("no locally built page or gate screenshots to compare against")

    offenders = []
    for path in images:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in derived:
            offenders.append(
                f"{path.name} is byte-identical to {derived[digest]}, which is rendered "
                "from the call recordings")
    assert not offenders, "\n  ".join([""] + sorted(offenders))


def test_the_tool_that_makes_the_stills_cannot_see_a_recording(tracked):
    """Provenance, checked at the source rather than taken on trust.

    An image is committable because of where its content came from. This is the check on
    that: the still-capture tool must not read the receipts directory, the deployed page,
    or the built page under out/. It reads source files and runs the offline CLI, and if
    that ever stops being true this fails before an image can be produced from a call.
    """
    tool = APP / Path(STILL_TOOL)
    if not tool.exists():
        pytest.skip(f"{STILL_TOOL} is not present")
    body = tool.read_text(encoding="utf-8")
    code = "\n".join(line for line in body.splitlines()
                     if not line.lstrip().startswith(("*", "//", "/*")))
    forbidden = {
        "FIRSTBELL_RECEIPTS": "the receipts directory",
        "--receipts": "the receipts directory",
        "firstbell-evidence.vercel.app": "the deployed page",
        "judge_page": "the page built from the recordings",
    }
    found = [f"{needle} ({why})" for needle, why in forbidden.items() if needle in code]
    assert not found, (
        f"{STILL_TOOL} reaches for " + ", ".join(sorted(found))
        + ", so an image it produces could carry real-call content"
    )


def test_the_authored_fixtures_are_what_the_generator_produces(tracked):
    """The fixtures are generated, so a hand edit to one has to be a failure.

    Without this, `_provenance` is a sentence rather than a fact: anybody could paste a
    recording into a `shape-` file, leave the note in place, and the suite would agree it
    was authored.
    """
    import sys
    sys.path.insert(0, str(APP))
    from tools.make_shape_fixtures import main as regenerate

    argv = sys.argv
    sys.argv = ["make_shape_fixtures.py", "--check"]
    try:
        code = regenerate()
    finally:
        sys.argv = argv
    assert code == 0, (
        "a fixture under tests/data/ differs from what tools/make_shape_fixtures.py "
        "produces, so it is not the generated file it claims to be"
    )

# ---------------------------------------------------------------------------
# The credential
# ---------------------------------------------------------------------------

def test_the_page_cannot_be_broken_out_of_by_its_own_data():
    """The call data is embedded in a `<script>` block, and JSON escaping is not enough.

    An HTML parser ends a script element at the literal `</script`, whatever the text
    around it means, and `json.dumps` has no reason to escape `<` because `<` is legal in
    JSON. A transcript turn carrying that string would close the block early and the rest
    of the page would be parsed as markup.

    Nothing in the committed transcripts contains it. That is not the defence: this payload
    is what a person said on the telephone, transcribed by a model, and the generator must
    not be able to produce a broken page out of its own input.
    """
    import sys as _sys

    _sys.path.insert(0, str(APP / "tools"))
    try:
        from judge_page import script_json
    finally:
        _sys.path.pop(0)

    hostile = {
        "turns": [{"text": "</script><img src=x onerror=alert(1)>"}],
        "note": "an ampersand & a line separator \u2028 and \u2029",
    }
    out = script_json(hostile)

    for forbidden in ("</script", "<", ">", "&", "\u2028", "\u2029"):
        assert forbidden not in out, (
            f"{forbidden!r} survived into the script block, so the page can be ended by "
            f"its own data"
        )
    assert json.loads(out) == hostile, "escaping changed the data, not just the bytes"


def test_the_api_key_reaches_no_surface_a_run_writes():
    """A real key in the environment, and every byte the run produces is searched for it.

    The key is read once, in `firstbell/cli.py`, and handed to the SDK. Nothing prints it
    and nothing stores it, which is easy to say and easy to stop being true: a client
    repr in an exception, a debug line, a receipt field added later. So this puts a
    distinctive value in `CALLE_API_KEY` and greps stdout, stderr and the receipt for it,
    including on the error path, which is where the phone-number leak lived.

    Offline, deliberately. The run must not need a key at all, and if it ever starts
    reading one on this path that is worth knowing too.
    """
    import os
    import subprocess
    import sys
    import tempfile

    sentinel = "iams_live_SENTINELdeadbeef0123456789"
    environment = dict(os.environ, CALLE_API_KEY=sentinel)
    receipt = Path(tempfile.mkdtemp()) / "receipt.json"

    run = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv",
         "--receipt", str(receipt)],
        cwd=APP, env=environment, capture_output=True, text=True,
        encoding="utf-8", errors="replace")
    assert run.returncode == 0, run.stderr[-400:]

    surfaces = {"stdout": run.stdout, "stderr": run.stderr}
    assert receipt.exists(), "no receipt was written, so this test checked less than it says"
    surfaces["receipt"] = receipt.read_text(encoding="utf-8")

    # The error path too. That is the one that leaked a phone number, because it prints
    # text this app did not write.
    broken = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "no-such-file.csv"],
        cwd=APP, env=environment, capture_output=True, text=True,
        encoding="utf-8", errors="replace")
    surfaces["error stdout"] = broken.stdout
    surfaces["error stderr"] = broken.stderr

    for where, body in surfaces.items():
        assert sentinel not in body, f"the whole key appears in {where}"
        assert "SENTINEL" not in body, f"part of the key appears in {where}"
        assert "deadbeef" not in body, f"part of the key appears in {where}"


def test_no_committed_file_carries_anything_shaped_like_a_key(tracked):
    """A key pasted into a file is the other way this goes wrong.

    CALL-E keys begin `iams_`. The double accepts anything for its own tests, so the
    prefix appears in this repository on purpose, and what is forbidden is a long one:
    a test key is a word, a real one is not.
    """
    key_like = re.compile(r"\biams_[A-Za-z0-9_-]{20,}\b")
    offenders = []
    for path in tracked:
        if path.resolve() == SELF:
            continue
        body = text_of(path)
        if body is None:
            continue
        for hit in set(key_like.findall(body)):
            offenders.append(f"{path.name}: {hit[:12]}...")
    assert not offenders, NEWLINE_INDENT.join(
        ["these look like real API keys:"] + sorted(offenders))



def test_no_whole_call_identifier_can_reach_the_page():
    """The maintainer asked for live identifiers to be off the published page.

    They were on it, in two places that looked unrelated: a table column and the JSON the
    scenes are drawn from. Fixing one and missing the other is the obvious way to fix this
    badly, so this checks the shortener itself and then checks that nothing in the builder
    writes a raw identifier into the page.

    A call id is not a credential. Another account's key cannot read our call. It is still
    an artifact of a real call to a real number, which is what the checklist covers.
    """
    import sys as _sys

    _sys.path.insert(0, str(APP / "tools"))
    try:
        from judge_page import mask_id
    finally:
        _sys.path.pop(0)

    # Synthetic, and on the allowlist above. The earlier version of this list held the three
    # real ids these are modelled on, which put an artifact of three real calls inside the
    # module whose job is to keep them out.
    shapes = sorted(i for i in PLACEHOLDER_IDS if len(i) > 24)
    assert len(shapes) == 5, "the shortener needs every allowlisted shape, not a subset"
    for value in shapes:
        short = mask_id(value)
        assert value not in short, f"{value} survives its own shortening"
        assert len(short) < len(value), f"{value} was not shortened at all"
        assert "\u2026" in short, f"{short} does not show that anything was removed"
        assert short.startswith(value[:4]), (
            f"{short} keeps nothing of the front, so CALL-E cannot match it to a record"
        )
        assert short.endswith(value[-4:]), f"{short} keeps nothing of the end"

    assert mask_id("") == "", "an absent identifier must stay absent, not become an ellipsis"

    # And an identifier too short to have a middle shows none of itself, which is the rule
    # the number masker in `firstbell/redaction.py` already follows. Before this, a body of
    # four characters was published whole by a function whose job is not publishing them,
    # and a body of three came out as `ab…bc`, repeating a character to fill the mask.
    for short_value in ("call_abcd", "call_abc", "call_ab", "call_a", "abcd", "ab"):
        head, sep, body = short_value.partition("_")
        if not sep:
            head, body = "", short_value
        masked = mask_id(short_value)
        # The prefix a reader needs to know what kind of identifier this was, and then
        # nothing. Asserted as an equality rather than as an absence, because a body of
        # `a` is a single character and "does not appear" is satisfied by accident.
        assert masked == f"{head}{sep}…", (
            f"{masked} shows part of a body too short to mask"
        )

    source = (APP / "tools" / "judge_page.py").read_text(encoding="utf-8")
    build = source.split("def build(", 1)[1]
    # The masking loop names both fields through a variable, so it is the one place they
    # may appear without mask_id beside them. Excluding it by name rather than by line
    # number keeps this from flagging the very code it is asking for.
    assert 'for _key in ("apiId", "providerId"):' in build, (
        "the loop that shortens every embedded identifier is gone"
    )
    # The assignment is named exactly. Excluding the loop by the variable it uses let a
    # mutation to `_call[_key] = _call[_key]` pass this test while every embedded id went
    # out whole, which is the leak this file exists to stop.
    assert "_call[_key] = mask_id(_call[_key])" in build, (
        "the embedded call data is no longer shortened before it is written into the page"
    )
    for field in ("apiId", "providerId"):
        emitted = [ln for ln in build.splitlines()
                   if field in ln and "mask_id" not in ln and "_key" not in ln]
        assert not emitted, (
            f"{field} is read in build() without mask_id on the same line: {emitted}"
        )
    for column in ("mask_id(call_id)", "mask_id(provider)"):
        assert column in build, f"the identifier table no longer shortens with {column}"


def test_every_real_result_the_readme_promises_is_on_the_page():
    """The README tells a judge the page carries all eleven, so the five are countable.

    It said that while the page carried eight, because the page drew its structured results
    from the transcripts file and the eleven live in the receipts. The sentence was checkable
    and false, which is worse than a sentence that promises less.
    """
    page = APP / "out" / "index.html"
    if not page.exists():
        pytest.skip("the page has not been built in this checkout")

    html = page.read_text(encoding="utf-8")

    # The functional half. The checks above read the builder's source; this reads what the
    # builder actually produced, which is the only artifact a judge sees.
    whole_call_ids = set(re.findall(r"call_[A-Za-z0-9_-]{15,}", html))
    # Bounded with lookarounds rather than a word-boundary escape. A backslash-b typed
    # into this file through a shell heredoc arrives as byte 0x08, and the pattern then
    # matches nothing while still passing, which is how this line spent its first run
    # testing nothing at all.
    whole_provider_ids = set(re.findall("(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])", html))
    assert not whole_call_ids, f"{len(whole_call_ids)} whole call ids are on the page"
    assert not whole_provider_ids, (
        f"{len(whole_provider_ids)} whole provider ids are on the page"
    )

    # `class=ids` followed by a space or the closing bracket, rather than the bracket
    # alone. The table states its role now, because the identifier columns restyle into
    # one block per call in a container too narrow for a table and changing `display` on a
    # table drops the semantics that go with it. A test that fails because an attribute
    # was added is testing the tag and not the table.
    table = re.search(r"<table class=ids[ >].*?</table>", html, re.S)
    assert table, "the page no longer has the identifier table the README points at"

    # `[^>]*` between the attribute and the bracket. The cell carries a `data-label` as
    # well now, and a reader that only finds the value when its attribute happens to be
    # written last is reading the tag rather than the cell.
    values = re.findall(
        r'data-field="parent_confirmed_aware"[^>]*>(?:<span class=dim>)?([^<]*)',
        table.group(0),
    )
    answered = [v.strip() for v in values if v.strip() and v.strip() != "&#183;"]
    not_yes = [v for v in answered if v != "yes"]

    readme = (APP / "README.md").read_text(encoding="utf-8")
    claim = re.search(r"all (\w+) results are on the\s*\n?\s*\[evidence page\]", readme)
    assert claim, "the README no longer makes the claim this test exists to hold"
    words = {"eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13}
    promised = words[claim.group(1)]

    assert len(answered) == promised, (
        f"the README promises {promised} results on the page and the table carries "
        f"{len(answered)}"
    )
    assert len(not_yes) == 5, (
        f"the README says five are countable and the page shows {len(not_yes)}: {not_yes}"
    )

    # The alert rate is the same two numbers divided, so it is checked here rather than by a
    # second gate that would need the receipts and would therefore skip for every reader.
    # A published percentage that nothing recomputes is how the last three counts went stale.
    stated = re.search(r"That is an alert rate of \*\*(\d+)%\*\*", readme)
    assert stated, "the README no longer states the alert rate"
    computed = round(100 * len(not_yes) / len(answered))
    assert int(stated.group(1)) == computed, (
        f"the README says the alert rate is {stated.group(1)}% and {len(not_yes)} of "
        f"{len(answered)} is {computed}%"
    )


def test_the_page_builder_masks_every_identifier_and_drops_no_result(tmp_path):
    """The masking rule and the every-result promise, checked without any real receipt.

    Everything else about the published page is checked by a gate that skips on a clean
    checkout, because it reads `out/index.html` and that file is built from records of real
    calls held outside this repository. That was declared rather than hidden, and it still
    left the two claims added last testable only by the person who wrote them.

    This builds the page a second time from `tests/fixture_page.py`, which is authored, and
    asserts the two properties that do not depend on whose calls went in: no whole identifier
    survives the build, and every call the fixture carries has a row on the page. What it
    cannot check is that the *published* page was built from the eleven real calls. That claim
    still needs the receipts, and it is declared in the register with the gate that holds it.
    """
    import subprocess
    import sys

    sys.path.insert(0, str(APP / "tests"))
    try:
        import fixture_page
    finally:
        sys.path.pop(0)

    receipts = fixture_page.write(tmp_path / "receipts")
    out = tmp_path / "page"
    built = subprocess.run(
        [sys.executable, str(APP / "tools" / "judge_page.py"), str(out),
         "--receipts", str(receipts)],
        capture_output=True, text=True, cwd=str(APP),
    )
    assert built.returncode == 0, (
        f"the page builder failed on an authored fixture:\n{built.stdout}\n{built.stderr}"
    )

    # Every page the build emits, not just the first one. A security pass over the output
    # found this gate reading `index.html` alone on the night the build began publishing
    # five document pages beside it: nothing had leaked, and nothing would have caught it
    # if it had. The rule is about what the deployment serves, so it reads what the
    # deployment serves.
    pages = sorted(out.rglob("*.html"))
    assert pages, "the builder emitted no HTML at all"
    assert len(pages) > 1, (
        "only one page came out of the build. If the document pages were removed on "
        "purpose, say so here; if they broke, this is the failure."
    )

    # The same two patterns the tracked-file scan uses, against the artifact rather than the
    # source. A build that stopped masking would still pass every source-level check.
    for page in pages:
        markup = page.read_text(encoding="utf-8")
        where = page.relative_to(out).as_posix()
        leaked_api = PROVIDER_ID.findall(markup)
        leaked_billing = [h for h in BILLING_ID.findall(markup) if h not in PLACEHOLDER_IDS]
        assert not leaked_api, f"{len(leaked_api)} whole call id(s) reached {where}"
        assert not leaked_billing, (
            f"{len(leaked_billing)} whole provider id(s) reached {where}"
        )

    html = (out / "index.html").read_text(encoding="utf-8")

    # Masked, not merely absent. A builder that dropped the column would pass the two above.
    for sid, _locale, letter, _aware, _reason, _ret in fixture_page.CALLS:
        assert sid in html, f"{sid} went into the build and has no row on the page"
        short = mask_id_from_tools()(fixture_page.api_id(letter))
        assert short in html, f"{sid} has no masked call id on the page"

    # Act 04's table carries one row per call placed, with every published field in its
    # own `data-field` cell. It used to be the first screen's register that was read
    # here; that register came off the page because it printed a transcript act 02 prints
    # again, and this walk moved to the surface that still renders every call rather than
    # to the two the first screen now plays. Act 04 is the wider surface of the two, so
    # the check got stronger by moving.
    #
    # Its rows are keyed on the shortened call id rather than on the student, because that
    # is the identifier the table is built around, and it is the one this test is about:
    # a build that stopped masking would fail on the lookup itself.
    letter_of = {sid: letter for sid, _l, letter, _a, _r, _e in fixture_page.CALLS}
    answers = {sid: aware for sid, _l, _c, aware, _r, _e in fixture_page.CALLS}

    # `<wbr>` comes out first. The table inserts one after the `call_` prefix so a long
    # identifier breaks where a reader would break it, which means the id in the markup
    # is not the id the masker produced and a literal search for it finds nothing. The
    # element adds nothing to the text a copy or a screen reader takes, so removing it
    # here compares what a reader actually sees.
    rows = html.replace("<wbr>", "").split("<tr")

    def row_of(student: str) -> str:
        short = mask_id_from_tools()(fixture_page.api_id(letter_of[student]))
        found = [r for r in rows if short in r and "data-field=" in r]
        assert len(found) == 1, (
            f"{student} has {len(found)} rows carrying its masked call id {short!r} in "
            "the table of every call placed, and this walk needs exactly one"
        )
        return found[0]

    counted_on_page = 0
    for _label, en, _ta, _agree, _of in fixture_page.PAIRS:
        row = row_of(en)
        # The one row the opening scene animates carries an extra attribute between the
        # field name and the value, so the pattern has to allow for anything up to the
        # closing bracket rather than assume the quote is the last thing before it.
        shown = {field: value for field, value in
                 re.findall(r'data-field="([^"]+)"[^>]*>([^<]*)<', row)}
        assert set(shown) == set(fixture_page.FIELD_ORDER), (
            f"the row for {en} carries {sorted(shown)}, not the published field order"
        )
        assert shown["parent_confirmed_aware"] == answers[en], (
            f"the row for {en} shows {shown['parent_confirmed_aware']!r} where the record "
            f"behind it says {answers[en]!r}"
        )
        if shown["parent_confirmed_aware"] != "yes":
            counted_on_page += 1

    from_fixture = sum(1 for _label, en, _ta, _a, _o in fixture_page.PAIRS
                       if answers[en] != "yes")
    assert counted_on_page == from_fixture, (
        f"the page shows {counted_on_page} answers that are not a yes; the records behind it "
        f"hold {from_fixture}"
    )


def mask_id_from_tools():
    """The shortener, imported from the builder rather than reimplemented here.

    A copy would agree with itself forever. This is the same function the page is built with,
    so a change to it fails the assertion above rather than quietly matching a stale twin.
    """
    import sys

    sys.path.insert(0, str(APP / "tools"))
    try:
        from judge_page import mask_id
    finally:
        sys.path.pop(0)
    return mask_id
