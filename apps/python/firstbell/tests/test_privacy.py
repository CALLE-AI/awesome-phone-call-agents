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
# can read the four of them and satisfy themselves that none is random. A rule such as "hex
# with a repeating pattern is fine" would eventually let a real one through, and the point
# of an allowlist is that adding to it is a visible act.
#
# `test_dispatch.py` held a real thirty-two-character billing id here until this check was
# written. It was the same one the documentation was using as an example.
PLACEHOLDER_IDS = frozenset({
    "aaaa1111bbbb2222cccc3333dddd4444",
    "bbbb2222cccc3333dddd4444eeee5555",
    "call_removed_11",
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
    out = subprocess.run(
        ["git", "ls-files", "-z", "--full-name", "--", str(APP)],
        cwd=APP, capture_output=True, text=True, check=True,
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
        if path.resolve() == SELF:
            continue          # this file has to be able to describe the pattern it forbids
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


def test_transcript_text_appears_only_in_fixtures_that_declare_themselves_authored(tracked):
    """Conversation text is the artifact itself, so the exceptions have to be explicit.

    A fixture is allowed to hold dialogue somebody on this project wrote. It is not allowed
    to hold dialogue and stay quiet about which of the two it is, because that is the state
    a reader cannot tell apart from a recording.
    """
    offenders = []
    for path, document in json_documents(tracked):
        spoken = [value for _t, key, value in walk(document)
                  if key == "transcript_turns" and isinstance(value, list) and value]
        if not spoken:
            continue
        relative = path.as_posix()
        if AUTHORED_FIXTURES not in relative:
            offenders.append(f"{relative}: holds transcript turns and is not an authored fixture")
            continue
        note = document.get("_provenance")
        if not isinstance(note, str) or "Authored, not recorded" not in note:
            offenders.append(
                f"{relative}: holds transcript turns without saying it was authored")
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
