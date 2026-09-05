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
# can read the four of them and satisfy themselves that none is random. A rule such as "hex
# with a repeating pattern is fine" would eventually let a real one through, and the point
# of an allowlist is that adding to it is a visible act.
#
# `test_dispatch.py` held a real thirty-two-character billing id here until this check was
# written. It was the same one the documentation was using as an example.
PLACEHOLDER_IDS = frozenset({
    "aaaa1111bbbb2222cccc3333dddd4444",
    "bbbb2222cccc3333dddd4444eeee5555",
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

    real = [
        "call_x_aaaaaaaaaaaaaaaaaaaa",
        "call_-bbbbbbbbbbbbbbbbbbbbb",
        "cccccccc11111111dddddddd22222222",
    ]
    for value in real:
        short = mask_id(value)
        assert value not in short, f"{value} survives its own shortening"
        assert len(short) < len(value), f"{value} was not shortened at all"
        assert "\u2026" in short, f"{short} does not show that anything was removed"
        assert short.startswith(value[:4]), (
            f"{short} keeps nothing of the front, so CALL-E cannot match it to a record"
        )
        assert short.endswith(value[-4:]), f"{short} keeps nothing of the end"

    assert mask_id("") == "", "an absent identifier must stay absent, not become an ellipsis"

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

    table = re.search(r"<table class=ids>.*?</table>", html, re.S)
    assert table, "the page no longer has the identifier table the README points at"

    values = re.findall(
        r'data-field="parent_confirmed_aware">(?:<span class=dim>)?([^<]*)', table.group(0)
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
