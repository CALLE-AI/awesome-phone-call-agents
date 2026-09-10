"""Build the evidence page from the call recordings and the committed rules.

Nothing on the page is typed into the template. The mutation table and the rules come out of
`evidence/` and `docs/`, the call detail comes out of the recordings, and the offline demo is
run for real while the page is being written. A page written by hand drifts away from the
repository the moment either changes, and the whole argument of this app is that a claim
should carry the thing that checks it.

    python tools/judge_page.py out --receipts ../receipts
    python tools/judge_page.py out --receipts ../receipts --audio-dir ../audio

Two directories, both outside this repository, and for two different reasons.

`--audio-dir` is optional. The contribution checklist asks contributors not to commit call
recordings, so the audio lives elsewhere and the page has always had a finished no-audio
path: it still draws every waveform, every transcript turn and every structured result, and
says why there is nothing to press. Do not "improve" that path into an error state.

`--receipts` is required, and that asymmetry is deliberate. The maintainer of this list
requires committed real-call artifacts to be removed, so the responses themselves are not in
the tree either; `evidence/README.md` explains why that applies to calls the author placed to
their own phone. Without them this tool has no call detail at all, and a page missing its
real-call sections would look complete and not be. So it prints what is missing and exits 3.
A missing audio clip degrades a page. A missing receipt would falsify one.

Standard library only, so it runs anywhere the app runs.
"""
from __future__ import annotations

import argparse
import base64
import functools
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

# This file is a script as often as it is an import, and the two put different things on
# the path. Running `python tools/judge_page.py` puts tools/ there; a caller importing it
# by file location does not, and would fail on the next line for a reason that has nothing
# to do with what it was trying to do.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import doc_pages  # noqa: E402  (needs the line above)

APP = Path(__file__).resolve().parent.parent
EVIDENCE = APP / "evidence"
# Where the call recordings are read from, set by main(). Deliberately not a path inside
# this repository: the recordings are held outside it, for the reason evidence/README.md
# gives, so this tool takes a directory the way it already takes --audio-dir.
RECEIPTS: Path | None = None

TROUBLE = """COULD-NOT-MEASURE  nothing to build from.

This page is generated from the recordings of the calls this app placed, and those are
held outside this repository: the maintainer of this list requires that committed
real-call artifacts be removed, and evidence/README.md explains why that applies here.
So there is nothing in the tree for this tool to read.

  the built page   https://firstbell-evidence.vercel.app
  to build it      python tools/judge_page.py out --receipts DIR
                   or set FIRSTBELL_RECEIPTS

Everything the repository can show on its own runs without this tool:
  python -m firstbell --work-file examples/absences.csv
  python -m pytest tests/ -q
  python tools/double_conformance.py --check"""
SITE = Path(__file__).resolve().parent / "site"

# The only script this page loads from outside its own directory, pinned to a version and
# to the bytes of that version.
#
# The hash is the sha384 of what jsdelivr actually serves at that URL, recomputed rather
# than trusted: the value that used to sit here matched no file, and the tag below never
# wrote an integrity attribute, so nothing had ever checked it. Had it been emitted the
# browser would have refused the script.
#
# If those bytes ever change the browser refuses it and the page falls back to native
# scrolling, which is the state a reader already gets with JavaScript off or reduced
# motion asked for. Failing closed costs this page nothing, which is why it fails closed.
LENIS = ("https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js",
         "sha384-tKsJDT6PlUI0pSBt9/sBKJluKgA19/a6mBrDsZaXotLB4ZYfMGM6xt6/WgGpYhTm")
TYPEKIT = "https://use.typekit.net/qdx4jvs.css"

ACTS = [
    ("00", "The call"),
    ("01", "What the school knew"),
    ("02", "Both languages"),
    ("03", "Three endings"),
    ("04", "Check us against your billing"),
    ("05", "Every rule, broken"),
    ("06", "Two things to take"),
    ("07", "What is not true"),
    ("08", "Run it yourself"),
]

FIELD_LABEL = {
    "parent_confirmed_aware": "parent_confirmed_aware",
    "reason_category": "reason_category",
    "expected_return": "expected_return",
}


def script_json(payload: object) -> str:
    """`json.dumps`, safe to put between `<script>` and `</script>`.

    The HTML parser ends a script element at the literal `</script`, and it does not care
    that the text around it is JSON. `json.dumps` has no reason to escape `<`, so a
    transcript turn carrying that string would close the block early and the rest of the
    page would be parsed as markup. `\\u003c` is read back as `<` by `JSON.parse`, so
    this changes the bytes and not the data.

    `&` goes too, so the payload cannot introduce an entity, and `\\u2028` and `\\u2029`
    because both are line terminators to a JavaScript parser and neither is escaped by
    `json.dumps`.
    """
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return (text.replace("<", "\\u003c").replace(">", "\\u003e")
                .replace("&", "\\u0026")
                .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def esc_code(value: object) -> str:
    """Escape, then turn markdown code spans and bold into real ones.

    The mutation table is lifted out of MUTATIONS.md, where identifiers are wrapped in
    backticks. Rendering those literally puts a row of stray punctuation on the page for
    every mutation. Escaping runs first, so the only thing this can introduce is the code
    and strong tags themselves.

    The bold pass was missing for as long as the table has existed, and the argument in the
    paragraph above was already the argument for adding it: twenty-six rows carry
    `**Needs the built page.**` and every one of them showed the asterisks to a reader.
    Code spans run first so a pair of asterisks inside one stays inside it, and bold runs
    before italic so a pair of them is not read as two italics around nothing.

    The italic pass came from sweeping the built page for the rest of the same class rather
    than from a third report. It closes one row, the one that says to flag a result if
    *any* required field is unknown rather than *all* of them, where the emphasis is the
    whole distinction being drawn. The body of a span cannot contain `<`, so an unpaired
    asterisk cannot swallow the tags either pass above it produced.
    """
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", esc(value))
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    return re.sub(r"\*([^*<]+)\*", r"<em>\1</em>", out)


# ---- reading the evidence ---------------------------------------------------------------

def _receipts_dir() -> Path:
    if RECEIPTS is None:
        raise SystemExit("internal: main() must set RECEIPTS before building the page")
    return RECEIPTS


def receipts() -> list[tuple[str, dict]]:
    return [(p.name, json.loads(p.read_text(encoding="utf-8")))
            for p in sorted(_receipts_dir().glob("0*.json"))]


def transcripts() -> dict:
    return json.loads((_receipts_dir() / "transcripts.json").read_text(encoding="utf-8"))


def mutation_rows() -> list[tuple[str, str, str]]:
    text = (EVIDENCE / "MUTATIONS.md").read_text(encoding="utf-8")
    return re.findall(r"^\| (\d+) \| (.+?) \| (\d+) \|$", text, re.M)


def mask_id(value: str) -> str:
    """Show enough of an identifier to match a row against a dashboard, not the identifier.

    A live call id is not a credential: another account's key cannot read our call. It is
    still an artifact of a real call to a real number, and this repository's checklist asks
    contributors to keep those out of what they publish. The maintainer asked for them to be
    stripped from the linked page rather than argued about, so they are stripped.

    Enough is kept that CALL-E, who hold the billing records these rows invite a check
    against, can still line a row up with their own export. Nobody else could use a whole one.
    """
    if not value:
        return value
    head, sep, body = value.partition("_")
    if not sep:
        head, body = "", value
    keep = 4 if len(body) > 10 else 2
    # A body whose two ends are the whole body would be published entire by the line
    # below, and for `abc` it would print `ab…bc`, repeating a character to do it. The
    # number masker in `dispatch/models.py` already refuses that: below the length at
    # which the ends hide something, show none of it. Nothing here reaches this branch,
    # because a CALL-E call id is 26 characters and a provider id is 32, which is the
    # reason to close it now rather than after something shorter arrives.
    if len(body) <= keep * 2:
        return f"{head}{sep}…"
    return f"{head}{sep}{body[:keep]}…{body[-keep:]}"


def receipt_counts(name: str) -> dict[str, int]:
    """One receipt's row out of the committed record, for a page that cannot show the file.

    `evidence/recorded-calls.json` is the only artifact in this entry that carries what the
    receipts produced without carrying anything from the calls themselves. It names each
    receipt, so a reader who cannot open one can still check a count taken from it, which is
    what the queue footer needs and what it used to promise the wrong way.
    """
    record = json.loads(
        (EVIDENCE / "recorded-calls.json").read_text(encoding="utf-8"))
    for row in record["per_receipt"]:
        if row["receipt"] == name:
            return row
    raise KeyError(f"{name} is in no row of evidence/recorded-calls.json")


def recovered_provider_ids() -> dict[str, str]:
    """Receipts written before the code recorded `provider_call_id` still have one.

    It was recovered afterwards with a `GET /v1/calls/{id}`, which places no call.
    """
    mapping = _receipts_dir() / "provider-ids.json"
    return json.loads(mapping.read_text(encoding="utf-8")) if mapping.exists() else {}


def build_commit() -> str:
    """The commit this page was generated from, or a plain statement that it is unknown."""
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=APP,
                             capture_output=True, text=True, timeout=10)
        sha = out.stdout.strip()
        if out.returncode or not sha:
            return "an unknown commit"
        dirty = subprocess.run(["git", "status", "--porcelain", "--", str(APP)], cwd=APP,
                               capture_output=True, text=True, timeout=10).stdout.strip()
        return f"{sha} plus uncommitted changes" if dirty else sha
    except (OSError, subprocess.SubprocessError):
        return "an unknown commit"


def build_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def offline_run() -> str:
    """Run the app rather than pasting output that may no longer be true."""
    done = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (done.stdout or done.stderr).strip()


def test_count() -> int:
    out = subprocess.run([sys.executable, "-m", "pytest", "tests/", "--collect-only", "-q"],
                         cwd=APP, capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stdout
    match = re.search(r"(\d+) tests? collected", out)
    return int(match.group(1)) if match else 0


def cue_for(call: dict, marker: str) -> int:
    """Where the hero player rests before first play.

    Derived from a committed turn offset, never typed. The cue lands five seconds before the
    turn that carries the line, so the agent's question is intelligible before the answer.
    """
    for turn in call["turns"]:
        if turn["speaker"] == "user" and marker.lower() in turn["text"].lower():
            return max(0, turn["offset_seconds"] - 5)
    return 0


# ---- fragments --------------------------------------------------------------------------

def hear_button(play_words: str, pause_words: str) -> str:
    """The control that starts a recording, wherever a recording is on the page.

    One function because there are three of these and they were not the same. The hero had
    an unlabelled circle whose only name was an aria-label, and the two duet lanes had
    nothing at all, so the English and Tamil calls that act 02 is built to compare could not
    be heard in any build. A reader looking for the sound found the button that said "Play
    the call again", which replays the transcript in silence.

    The words are arguments and they travel in the markup, which is the rule the replay
    button beside it already follows: `announce` in player.js reads them back out of the
    element when the state flips, so the visible label and the accessible name are the same
    string and neither can be edited without the other moving.
    """
    return (f'<button class=hear data-play type=button '
            f'data-words-play="{esc(play_words)}" data-words-pause="{esc(pause_words)}" '
            f'aria-label="{esc(play_words)}" aria-pressed=false>'
            '<svg class=i-play viewBox="0 0 12 14" aria-hidden=true>'
            '<path d="M0 0l12 7-12 7z"/></svg>'
            '<svg class=i-pause viewBox="0 0 12 14" aria-hidden=true>'
            '<path d="M0 0h4v14H0zM8 0h4v14H8z"/></svg>'
            f'<span data-play-label>{esc(play_words)}</span></button>')


def commit_turns(call: dict, fields: list[str]) -> list[int]:
    """Which turn each structured field is answered at, taken out of the transcript.

    The rule is mechanical and it is the only one this file applies: the agent's questions
    are its turns ending in a question mark, and a field is answered by the first parent
    turn after the n-th of them. On the hero call that resolves to 21, 31 and 44 seconds,
    which are the three lines where the parent actually says the thing each field records.

    Where a call has fewer questions than fields, the fields left over are marked at the
    last turn, because the one moment that is certainly true of every field is that CALL-E
    had returned it by the time the call ended. Nothing here is chosen for how it looks.

    This is the page's own reading of the transcript and not a timing CALL-E published: the
    structured result arrives once, at the end. The scene says so on the screen, next to the
    fields, rather than only here.
    """
    turns = call["turns"]
    asked = [i for i, t in enumerate(turns)
             if t["speaker"] == "bot" and t["text"].rstrip().endswith("?")]
    out: list[int] = []
    for i in asked:
        answer = next((j for j in range(i + 1, len(turns))
                       if turns[j]["speaker"] == "user"), None)
        if answer is not None and answer not in out:
            out.append(answer)
        if len(out) == len(fields):
            break
    while len(out) < len(fields):
        out.append(len(turns) - 1)
    return out


def _spelled(n: int) -> str:
    """A small count in words. The hero read "Four of the 4 rows here" for a morning."""
    return {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven",
            8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve"}.get(n, str(n))


def _closed_on_nothing_mark(resolution: str, fields: dict, order: list[str]) -> str:
    """A mark on any row this software closed while learning nothing.

    Derived, not listed. The condition is the defect itself: the outcome says the record was
    closed and every field the table shows is empty or "unknown". One row in the committed
    receipts meets it, S-3004, and act 03 is built around explaining it. Without this the
    row sat in act 04 with no mark at all, and both readers who checked found the
    contradiction before they found the paragraph about it.

    Written as a condition rather than a call id so that the same defect on a different call
    would be marked without anybody remembering to.
    """
    if resolution != "resolved":
        return ""
    told_us_something = any(
        (fields.get(name) or "").strip().lower() not in ("", "unknown", "·")
        for name in order)
    if told_us_something:
        return ""
    return ('<a class=row-flag href="#act-03" '
            'aria-label="This row was closed on an answer that said nothing. '
            'Act 03 explains it.">closed on nothing</a>')


def _stakes_sentence() -> str:
    """The callback-window sentence, verbatim from the run act 08 ships.

    Matched on the part that cannot move without the program changing, and returned whole
    including the parenthetical that says whose thirty minutes it is. If the run stops
    printing it, this raises rather than falling back to a sentence written here: a
    fallback would be a second copy of the claim, which is the defect being fixed.
    """
    for line in offline_run().splitlines():
        stripped = line.strip()
        if stripped.startswith("A school would have to answer these within"):
            return stripped
    raise SystemExit(
        "act 01 quotes the run's callback-window sentence and the run no longer prints a "
        "line starting 'A school would have to answer these within'. Fix the quote or the "
        "program, but do not write the sentence here.")


def _recorded_call_total() -> int:
    """How many calls this software has placed against the production API, from one file.

    Typed into the first screen, it was four, because four is how many rows the register
    shows and nobody noticed that the sentence had gone on to claim a total. Every other
    surface reads `evidence/recorded-calls.json`, so this one does too.
    """
    return json.loads(
        (EVIDENCE / "recorded-calls.json").read_text(encoding="utf-8"))["counts"]["calls"]


def _film_running_time() -> str:
    """`2 min 58`, from the measurement, or nothing at all if it has not been measured."""
    facts = EVIDENCE / "film.json"
    if not facts.exists():
        return "the demo"
    seconds = json.loads(facts.read_text(encoding="utf-8"))["seconds"]
    return f"{int(seconds // 60)} min {int(round(seconds % 60)):02d}"


def _node_suite_size() -> tuple[int, int]:
    """How many tests the n8n recipe ships, counted rather than remembered.

    `test(` at the start of a line is how both files are written, and it is what the gate on
    the README's count reads, so the page and the gate cannot disagree about the method. Two
    numbers because the two files answer different questions and the surfaces name them
    separately: the classifier rule, and the shape of the workflow it is inlined into.
    """
    examples = APP.parents[2] / "plugins" / "firstbell-absence-calls" / "examples"

    def written(name: str) -> int:
        body = (examples / name).read_text(encoding="utf-8")
        return len([ln for ln in body.splitlines() if ln.startswith("test(")])

    return written("classify.test.mjs"), written("workflow-shape.test.mjs")


def _suite_pair() -> tuple[int, int]:
    """How many of the collected tests run on a build like this one, out of the README.

    The stat card said "624 tests" and 622 of them run: two skip, with named reasons, and a
    clean checkout skips more. A flat count on the first screen is the overstatement this
    repository spends five mutation rows preventing everywhere else.

    The page cannot measure the pair for itself. Collecting is cheap and `test_count` does
    it, but a pass-and-skip pair needs the suite to run, and the suite reads the page this
    function is building.

    So it is measured separately and written down. `tools/suite_pair.py` runs the suite and
    records what happened in `evidence/suite-pair.json`, the same way
    `evidence/recorded-calls.json` holds counts for calls whose receipts are outside this
    tree. This reads that file.

    It used to read the sentence in the README instead, and a reviewer in the buyer's seat
    was right to call that out: in an entry arguing that a claim ships with the thing that
    checks it, the largest count on the front screen was the one figure a person had typed.
    The README falls back only when the file is absent, which is a clean checkout that has
    not run the tool, and `test_the_recorded_suite_pair_is_the_one_the_readme_publishes`
    holds the two together whenever both exist.
    """
    recorded = APP / "evidence" / "suite-pair.json"
    if recorded.is_file():
        try:
            held = json.loads(recorded.read_text(encoding="utf-8"))
            # Collected less skipped, not the pass count. "Run here" means the tests this
            # tree can exercise at all, as against the ones wanting the recordings, a built
            # page or a gate report, and that is what the card claims. Reading `passed`
            # made the number depend on whether the suite was green, and the gate holding
            # this file against the README's sentence is one of the tests in it: a stale
            # file failed that gate, which lowered the pass count, which was recorded as
            # the new pair and was still stale. There was no value the pair could settle
            # on. A skip is a could-not-measure whatever else the run did, so these two are
            # the quantities a failing gate does not move.
            return int(held["collected"]) - int(held["skipped"]), int(held["skipped"])
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as bad:
            raise SystemExit(
                f"{recorded.name} does not hold a measured pair ({bad}). Run "
                "`python tools/suite_pair.py` to write it.") from bad

    readme = (APP / "README.md").read_text(encoding="utf-8")
    found = re.search(r"the same suite\s+reports \*\*(\d+) passed, (\d+) skipped\*\*", readme)
    if not found:
        raise SystemExit(
            "the README no longer states the built-tree pair where the page reads it, and "
            "evidence/suite-pair.json is absent, so the stat card cannot say how many of "
            "the collected tests run. Run `python tools/suite_pair.py`.")
    return int(found.group(1)), int(found.group(2))


def _conformance_figures() -> tuple[int, int, int]:
    """What the conformance record holds, rather than a test count typed beside its command.

    `double_conformance.py --check` runs no tests. It reads `evidence/api-shape.json`, walks
    every key path the recorded production responses carry, and prints one line. So the card
    prints what that establishes: how many responses were compared, how many paths they
    carry, and how many of those the double does not emit.
    """
    record = json.loads(
        (EVIDENCE / "api-shape.json").read_text(encoding="utf-8"))
    # `api_paths` is the mapping of path to the JSON types seen there, and
    # `missing_in_double` the list of paths our model does not emit, so both are counted
    # rather than read. Only `responses_compared` is already a number.
    return (int(record["responses_compared"]), len(record["api_paths"]),
            len(record["missing_in_double"]))


def _typeset(said: str) -> str:
    """The transcriber’s apostrophes, made one shape.

    CALL-E returns both: the agent’s own lines come back with U+2019 and the guardian’s
    with U+0027, because one side is synthesised from a script and the other is transcribed
    from speech. That is invisible in a scrolling transcript and impossible to miss on the
    first screen, where the two sit four lines apart and the page looks like it has a typo
    in the one sentence a reader is meant to remember.

    This changes the glyph and never the words. The transcript in act 02 and the receipts
    both keep exactly what came back.
    """
    return said.replace("'", "’")


def _hero_exchange(call: dict) -> tuple[str, str] | None:
    """The office question and the guardian answer, found by what they say.

    Located by phrase rather than by index. The transcriber split the question across two
    turns and could split it differently on a re-run; an index would then quietly quote the
    wrong line, which is the exact failure this page is about.
    """
    said = [(t.get("text") or "").strip() for t in call.get("turns", ())]
    answered = next((t for t in said if "left for school this morning" in t), None)
    opened = next((t for t in said if "marked absent" in t), None)
    closed = next((t for t in said if "aware of the absence?" in t), None)
    if not (opened and closed and answered):
        return None
    head = opened.partition(" on September")[0].rstrip(" ,")
    tail = closed.partition("; ")[2] or closed
    return (_typeset(f"{head}… {tail}"), _typeset(answered))


def hero_turn_markup(call: dict) -> str:
    """What the office was left with, and what this software did about it.

    `parent_confirmed_aware` is not in the schema required list and is not treated as one
    here: the guardian saying no is an answer, and an alarming one. The two fields that
    decide whether a record may close are `reason_category` and `expected_return`, and this
    reads their values rather than restating them, so the sentence cannot outlive the data.
    """
    found = call.get("structured") or {}
    decisive = [found.get("reason_category"), found.get("expected_return")]
    if not all(isinstance(v, str) and v for v in decisive):
        return ""
    why, when = (esc(v) for v in decisive)
    return (
        '<p class=hero-turn>The guardian was not aware of the absence. That is the answer '
        'that matters, and it is the only answer the call got. Why the pupil was away came '
        f'back <b>{why}</b>. When to expect her back came back <b>{when}</b>. Those two are '
        'what the office needs before it can act, so a system that counts contacts would '
        'mark this “family contacted” and close it. This one files it '
        '<span class="state state-undetermined">undetermined</span> and puts it on a named '
        'person’s desk.</p>'
    )


def register_markup(data: dict, rows: list[str], live: str, has_audio: bool) -> str:
    """The register: one row per call, one column per field, and one row still running.

    The row that is running is not a different kind of row. It is this row with the call it
    is waiting on opened out inside it, so a reader never has to connect a player somewhere
    else on the page to a row somewhere here.

    Everything is served filled. With no script, or with reduced motion asked for, this is
    a complete record of four calls and their results, which is the state the scene ends in
    anyway. The animation replays how the last row got there; it is never the only way to
    read it.
    """
    fields = data["fieldOrder"]
    call = data["calls"][live]
    commits = commit_turns(call, fields)

    out = [f'<div class=scene data-player="{esc(live)}" data-cue=0 data-playing=false '
           f'data-commits="{esc(",".join(str(c) for c in commits))}">']

    out.append('<div class=register>')
    out.append('<div class=reg-head><span>call</span>'
               + "".join(f'<span>{esc(FIELD_LABEL[f])}</span>' for f in fields)
               + '</div>')
    for rid in rows:
        c = data["calls"][rid]
        is_live = rid == live
        attrs = ' data-live=off data-result' if is_live else ''
        out.append(f'<div class=reg-row data-row="{esc(rid)}"{attrs}>')
        out.append(f'<span class=reg-id>{esc(rid)}</span>')
        for f in fields:
            value = c["structured"].get(f, "·")
            at = ' data-at=committed' if is_live else ''
            out.append(f'<span class=reg-val><span class=reg-key>{esc(FIELD_LABEL[f])}</span>'
                       f'<b class=reg-v data-field="{esc(f)}"{at}>{esc(value)}</b></span>')
        out.append('</div>')
    out.append('</div>')
    # The call sits under the register rather than inside the row it belongs to. Inside, it
    # was the same element and the light was one field, and that field ran the height of a
    # transcript: a screen with one sentence on it had a third of its area painted yellow
    # and the fourth row of the register pushed off the bottom. Out here the light is one
    # row of one register, which is what a highlighter is, and the call is joined to it by a
    # rule in the same colour rather than by being swallowed into it.
    out.append(scene_call(call, has_audio))
    out.append('</div>')
    return "".join(out)


# The browser caps the wait between one turn and the next at this, in player.js, and
# `tests/test_claims.py` holds the two copies to the same number. It is not a silence
# threshold: it applies to the interval however it was spent, which is why the caption below
# says what it does rather than calling it a trimmed silence.
SCENE_GAP_MAX = 1.5


@functools.lru_cache(maxsize=1)
def glosses() -> dict:
    """The English written for the turns CALL-E transcribed in another language.

    Committed next to this script rather than read from the receipts, because it is not
    something CALL-E returned: the platform gave back Tamil, and the English is a later
    translation of that Tamil. Keeping the two apart is the point. A reader can see which
    words came off the call and which were written afterwards, and the file itself says so.
    """
    raw = (Path(__file__).resolve().parent / "glosses.json").read_text(encoding="utf-8")
    return json.loads(raw)["calls"]


def needs_english(said: str) -> bool:
    """Whether a line of a transcript is written in something other than the Latin alphabet.

    Asked of the text rather than of the call's locale, and this is not a detail. The suite
    builds the page a second time from an authored fixture, and that fixture carries English
    turns on calls it labels `ta-IN`, because what it exists to test is identifier masking.
    A rule that read the locale would have demanded a translation of "Good morning." A rule
    that reads the text asks the question the organiser's language requirement actually
    asks, which is what language the reader is being handed, not what the metadata says.

    Punctuation, digits and spacing are ignored, so a Tamil line and an English line that
    share a full stop are not confused. A Spanish or French line is Latin and passes here;
    the locale check in `bind_glosses` is what would catch that one.
    """
    for ch in said:
        if unicodedata.category(ch)[0] in "PZNSCM":
            continue
        if not unicodedata.name(ch, "").startswith("LATIN"):
            return True
    return False


def bind_glosses(data: dict) -> None:
    """Attach the English to every turn CALL-E did not return in English.

    Done once, on the data, rather than at each place a turn is printed. The page writes a
    transcript three ways: `turns_markup` builds the duet lane, `player.js` rebuilds the
    scene out of the JSON island, and the island is itself a published file a reader can
    open. Glossing at the markup would have left the other two in Tamil with nothing under
    them, which is the same failure as glossing none of them, only harder to notice.

    Looked up by what the line says, not by its position. The transcriber splits a long
    answer into turns and could split it differently on a re-run; an index would then put
    the English for one sentence under a different one, silently, which is worse than no
    translation. A line whose text is not in the table stops the build, so a transcript that
    moves under `tools/glosses.json` cannot be published half translated.
    """
    table = glosses()
    for cid, call in data.get("calls", {}).items():
        said = call.get("turns", ())
        foreign = [t for t in said if needs_english(t.get("text", ""))]
        if not foreign:
            continue
        found = table.get(cid)
        if found is None:
            raise SystemExit(f"{cid} has {len(foreign)} turns that are not in the Latin "
                             "alphabet and no entry in tools/glosses.json, which has to "
                             "carry every call this page carries")
        english = {row["ta"].strip(): row["en"].strip() for row in found["turns"]}
        for index, turn in enumerate(said):
            if turn not in foreign:
                continue
            gloss = english.get(turn["text"].strip())
            if not gloss:
                raise SystemExit(f"{cid} turn {index} has no English in "
                                 "tools/glosses.json: either the gloss is missing or the "
                                 "transcript changed under it")
            turn["gloss"] = gloss


def turn_li(call: dict, turn: dict) -> str:
    """One line of a transcript, wherever the page prints it.

    One builder for the scene and for both lanes of the duet. They used to hold the same
    markup twice, which was survivable while a turn was three spans, and stops being
    survivable the moment a turn can carry a translation: one of them printing the English
    and the other not would read as two different transcripts of one call. `player.js`
    builds the third copy from the same field on the same object.
    """
    who = "agent" if turn["speaker"] == "bot" else "parent"
    m, s = divmod(int(turn["offset_seconds"]), 60)
    said = (f'<span class=turn-text lang="{esc(call["locale"])}">'
            f'{esc(turn["text"])}</span>')
    if turn.get("gloss"):
        said += f'<span class=turn-gloss lang=en>{esc(turn["gloss"])}</span>'
    return (f'<li data-at="{int(turn["offset_seconds"])}" data-who="{esc(turn["speaker"])}" '
            f'data-rel=ahead><span class=turn-at>{m}:{s:02d}</span>'
            f'<span class=turn-who>{who}</span>{said}</li>')


def turns_note(call: dict) -> str:
    """Who wrote the English, said once under the transcript that carries it.

    Empty for a call that was in English, because there is nothing to explain there.
    """
    if str(call.get("locale", "")).startswith("en"):
        return ""
    return ('<p class=scene-note>Each Tamil line is followed by its English. The Tamil is '
            'what CALL-E heard and returned. The English was written afterwards from that '
            'text, with a language model reading only the Tamil, and nobody spoke it on '
            'the call.</p>')


def scene_seconds(call: dict) -> float:
    """How long the scene takes to show a call, by the rule the browser uses.

    `CallPlayer.buildSchedule` walks the turn offsets and the call's length, drops a mark
    that does not move forward, and adds the interval to the previous mark capped at
    SCENE_GAP_MAX. A minute of call with fourteen turns comes out around nineteen seconds,
    which is what a reader watching the first screen actually sees.
    """
    marks = [t["offset_seconds"] for t in call["turns"]] + [call["seconds"]]
    total = 0.0
    last: float | None = None
    for m in marks:
        if last is not None:
            if m <= last:
                continue
            total += min(m - last, SCENE_GAP_MAX)
        last = m
    return total


def scene_call(call: dict, has_audio: bool) -> str:
    """The call itself, drawn inside the register row that is waiting on it.

    The canvas is served blank, hidden from assistive technology and out of the tab order.
    Nothing draws it and nothing moves it without a script, and a `role=slider` that ignores
    every arrow key is a promise the served page cannot keep. CallPlayer.upgrade adds the
    role, the tab stop and the value in the same breath as the key handler.
    """
    mins, secs = divmod(int(call["seconds"]), 60)
    out = ['<div class=reg-open>']
    out.append('<canvas data-waveform aria-hidden=true></canvas>')
    out.append('<div class=scene-bar>')
    if has_audio:
        out.append(hear_button("Hear the recording", "Pause the recording"))
    out.append(f'<span class=scene-clock data-clock>0:00 / {mins}:{secs:02d}</span>')
    # Served hidden, and CallPlayer.upgrade shows it, for the same reason the canvas is
    # served without its slider role: with no script there is no scene to play again, and a
    # button that answers nothing is the page making a promise it cannot keep. It is in the
    # markup rather than built in JavaScript so that its words live with the rest of them.
    out.append('<button class=replay type=button data-replay hidden>'
               'Run the transcript again</button>')
    # The scene moves for about twenty seconds beside prose, and it starts itself, so the
    # guideline asks for a control and not only a reduced-motion query. Served hidden and
    # disabled on the same argument as the replay beside it: before the scene has run there
    # is nothing to hold still, and with no script it never appears at all. app.js reveals
    # it, and takes its words from here so they live with the rest of them.
    #
    # `data-scene-pause` and not `data-replay`: two gates select replay controls by that
    # attribute and assert one per scene, and a pause control answering to it would read as
    # a second replay for a scene that already has one.
    out.append('<button class=replay type=button data-scene-pause=hero '
               'data-words-pause="Pause the transcript" '
               'data-words-resume="Play the transcript" '
               'hidden disabled>Pause the transcript</button>')
    out.append('</div>')
    out.append('<ol class=turns data-turns aria-live=off tabindex=0 '
        'aria-label="What was said on the call, turn by turn. Scrolls, so it takes '
        'focus and answers the arrow keys.">')
    for turn in call["turns"]:
        out.append(turn_li(call, turn))
    out.append('</ol>')
    out.append(turns_note(call))
    # Two claims the scene would otherwise make silently. Both are cheaper to print than to
    # be caught on: a judge who works out either of them for themselves stops believing the
    # rest of the page, and this one is built entirely out of things that can be checked.
    # Two lengths, because there are two things here and the caption used to describe
    # neither. The recording is 59.54 seconds and it plays whole at its own speed. The scene
    # is about nineteen, because the wait between one turn and the next is capped, and that
    # cap does not know whether the wait was silence or speech. A reader timed the scene at
    # roughly three times speed against a caption promising its own speed, and was right to.
    scene = scene_seconds(call)
    out.append(f'<p class=scene-note>The recording runs {mins}:{secs:02d} and plays whole '
               'at its own speed. The scene above it is shorter, about '
               f'{scene:.0f} seconds, because the wait between one turn and the next is '
               f'capped at {SCENE_GAP_MAX} seconds however it was spent; the timestamps are '
               'CALL-E’s own. Each field is marked at the answer it came from. CALL-E '
               'returned all three together when the call ended. The two apostrophe shapes '
               'in the turns below are CALL-E’s too, not a typesetting fault: the agent’s '
               'lines come back with a curly one because they are synthesised from a '
               "script, and the guardian's come back straight because they are transcribed "
               'from speech. Normalising them would make this transcript tidier than what '
               'the platform returned, and every other line on this page is what it '
               'returned.</p>')
    out.append('</div>')
    return "".join(out)


def turns_markup(call: dict) -> str:
    """The transcript, at CALL-E's own offsets.

    Shared by the hero scene and by both lanes of the duet so the two cannot drift: one of
    them printing a turn the other does not have would be a difference the reader would
    read as evidence.
    """
    out = ['<ol class=turns data-turns aria-live=off tabindex=0 '
        'aria-label="What was said on the call, turn by turn. Scrolls, so it takes '
        'focus and answers the arrow keys.">']
    for turn in call["turns"]:
        out.append(turn_li(call, turn))
    out.append('</ol>')
    out.append(turns_note(call))
    return "".join(out)


def lane_markup(data: dict, cid: str, label: str, has_audio: bool) -> str:
    """One side of the duet: a call, its clock, its three fields and its transcript.

    Everything is served at the value CALL-E returned, exactly as the register is, so a
    reader with no script or with reduced motion asked for gets both results in full. The
    scene rewinds it to waiting and plays it forward; it is never the only way to read it.
    """
    fields = data["fieldOrder"]
    call = data["calls"][cid]
    commits = commit_turns(call, fields)
    mins, secs = divmod(int(call["seconds"]), 60)
    out = [f'<div class=lane data-player="{esc(cid)}" data-cue=0 data-playing=false '
           f'data-commits="{esc(",".join(str(c) for c in commits))}">']
    out.append(f'<div class=lane-head><b class=lane-lang>{esc(label)}</b>'
               f'<span class=lane-id>{esc(cid)}</span>'
               # Named by language, because the whole point of this act is that these are
               # two different conversations and a reader has to be able to choose one.
               + (hear_button(f"Hear the {label} call", f"Pause the {label} call")
                  if has_audio else "")
               + f'<span class=scene-clock data-clock>0:00 / {mins}:{secs:02d}</span></div>')
    out.append('<canvas data-waveform aria-hidden=true></canvas>')
    out.append('<div class=lane-fields data-result data-live=off>')
    for f in fields:
        value = call["structured"].get(f, "·")
        out.append(f'<span class=lane-f><span class=lane-k>{esc(FIELD_LABEL[f])}</span>'
                   f'<b class=lane-v data-field="{esc(f)}" data-at=committed>{esc(value)}'
                   f'</b></span>')
    out.append('</div>')
    out.append(turns_markup(call))
    # CALL-E writes this one-sentence account in English even for a Tamil call. It is the
    # vendor's own summary, committed with the receipt, and it is what lets a reader with no
    # Tamil check that the two conversations really did cover the same ground.
    if call.get("note"):
        out.append('<p class=lane-note><span class=lane-note-k>CALL-E&#8217;s own note</span>'
                   f'{esc(call["note"])}</p>')
    out.append('</div>')
    return "".join(out)


def duet_markup(data: dict, en: str, ta: str, has_audio: bool) -> str:
    """Two calls, one start.

    They are not synchronised past that first moment and they are not meant to be. The
    English call ran 59.54 seconds and the Tamil one 109.98, so the Tamil lane is still
    going after the English lane has settled. That gap is the thing worth showing: a school
    that only reads English gets the shorter conversation and none of the longer one.
    """
    en_c, ta_c = data["calls"][en], data["calls"][ta]
    out = ['<div class=duet data-group=duet>']
    out.append(lane_markup(data, en, "English", has_audio))
    out.append(lane_markup(data, ta, "Tamil", has_audio))
    out.append('</div>')
    out.append('<div class=duet-bar>')
    # Served hidden for the same reason the hero's replay is: with no script there is no
    # scene to play again, and a button that answers nothing is a promise the page cannot
    # keep. app.js shows it once both lanes are real players.
    out.append('<button class=replay type=button data-replay-group=duet hidden>'
               'Run both again</button>')
    # One control for the pair, because two calls that started together have to hold
    # together: pausing one lane and leaving the other running would demonstrate the
    # opposite of what the duet is for. See scene_call for why it is not `data-replay`.
    out.append('<button class=replay type=button data-scene-pause=duet '
               'data-words-pause="Pause both" '
               'data-words-resume="Play both" '
               'hidden disabled>Pause both</button>')
    out.append(f'<span class=duet-len>{en_c["seconds"]:.0f}s and '
               f'{ta_c["seconds"]:.0f}s of real recording, each playing whole at its own '
               f'speed; the two scenes take about {scene_seconds(en_c):.0f}s and '
               f'{scene_seconds(ta_c):.0f}s, because the wait between turns is capped at '
               f'{SCENE_GAP_MAX} seconds</span>')
    out.append('</div>')
    return "".join(out)


# The three readings of one finished call. Only the third is this app's.
FILINGS = [
    ("resolved", "wrong",
     "a system with two buckets, closing anything that came back schema-valid",
     "the dashboard reports every family contacted, for a child nobody reached"),
    ("failed", "wrong",
     "a system with two buckets, discarding anything short of a full answer",
     "a call that did reach the parent is thrown away with the ones that never connected"),
    ("undetermined", "ours",
     "the call happened and produced no usable answer",
     "the row stays open under a name, recovers no funding, and is never counted as coverage"),
]


def endings_markup(data: dict, cid: str, run: dict) -> str:
    """One call, three filings, and the coverage arithmetic each one produces.

    The counts are read out of the committed receipt rather than argued for. The bar is
    served split the way the receipt splits it; app.js rewinds it to the single undivided
    bar a two-bucket system would print and lets the reader watch it come apart. With no
    script, or with reduced motion asked for, the true split is what is on the page and
    the two-bucket reading sits beside it already crossed out.
    """
    fields = data["fieldOrder"]
    call = data["calls"][cid]
    counts = run["counts"]
    placed = run["calls_placed"]
    resolved = counts["resolved"]
    order = ["resolved", "undetermined", "failed"]

    out = ['<div class=endings data-endings>']
    out.append('<div class=subject>')
    out.append(f'<span class=subject-id>{esc(cid)}</span>')
    out.append('<span class=subject-say>the call from the first screen, finished</span>')
    out.append('<span class=subject-fields>')
    for f in fields:
        value = call["structured"].get(f, "·")
        out.append(f'<span class=subject-f><span class=subject-k>{esc(FIELD_LABEL[f])}</span>'
                   f'<b class=subject-v>{esc(value)}</b></span>')
    out.append('</span></div>')

    out.append('<ol class=filings>')
    for name, verdict, who, cost in FILINGS:
        out.append(f'<li data-filing="{name}" data-verdict="{verdict}">'
                   f'<span class=filing-verdict>{verdict}</span>'
                   f'<b class=filing-name>{name}</b>'
                   f'<span class=filing-who>{who}</span>'
                   f'<span class=filing-cost>{cost}</span></li>')
    out.append('</ol>')

    out.append('<div class=tally>')
    # A call that connected and gave nothing usable is neither of the two words a vendor
    # deck uses. It answered, and it did not close. Act 04 prices escalations per answered
    # call, so this line has to say which number that is.
    answered = counts["resolved"] + counts["undetermined"]
    out.append(f'<p class=tally-head>One committed run. {placed} calls placed, '
               f'{answered} answered, {resolved} closed with a usable reason. '
               f'A call that connected and produced nothing usable is the difference, '
               f'and it is not coverage.</p>')
    out.append('<div class=bar role=img aria-label="'
               + esc(", ".join(f'{counts[k]} {k}' for k in order if counts[k]))
               + f' of {placed} calls">')
    for k in order:
        if not counts[k]:
            continue
        out.append(f'<span class=seg data-seg="{k}" style="flex-grow:{counts[k]}">'
                   f'<span class=seg-n>{counts[k]}</span>'
                   f'<span class=seg-k>{k}</span></span>')
    out.append('</div>')
    out.append('<p class=tally-alt><span class=tally-x>'
               f'{placed} of {placed} contacted</span> is what the same run reports with '
               'nowhere to put the middle four.</p>')
    out.append('</div>')
    out.append('</div>')
    return "".join(out)


# The response headers the deployed page is served with. Everything below that names an
# origin or a hash is read off the page that was just built, because a policy typed by hand
# describes the page its author remembered rather than the page in the directory. The first
# stylesheet that moves makes a typed policy either wrong or a lie, and a Content-Security-
# Policy that is wrong fails loudly in front of whoever opened the page.
#
# The fixed half says what this page never does. It places no network call of its own, has
# no form, embeds no plugin, and is never framed, so those are all closed rather than
# narrowed. A reader can check that against the two scripts: neither contains fetch,
# XMLHttpRequest, WebSocket, EventSource or a dynamic import.
CSP_CLOSED = (
    "default-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "manifest-src 'none'",
    "worker-src 'none'",
)


def _csp_hash(source: str) -> str:
    """A CSP source expression for one piece of inline text, over its UTF-8 bytes."""
    digest = hashlib.sha256(source.encode("utf-8")).digest()
    return "'sha256-" + base64.b64encode(digest).decode("ascii") + "'"


def _origin_of(url: str) -> str:
    """The scheme and host a subresource comes from, or 'self' when it is ours."""
    if not url.startswith(("http://", "https://")):
        return "'self'"
    return "/".join(url.split("/", 3)[:3])


def _sources(page: str, pattern: str) -> list[str]:
    """Origins matched by one pattern, ordered so the header is stable across builds."""
    found = {_origin_of(m.group(1)) for m in re.finditer(pattern, page)}
    return sorted(found, key=lambda s: (s != "'self'", s))


def content_security_policy(*pages: str) -> str:
    """The policy these exact pages need, and nothing wider.

    Plural because the header is set on `/(.*)` and the deployment serves the documents
    under `docs/` as well as the page itself. A policy derived from `index.html` alone is
    correct for `index.html` and silently wrong for everything beside it: a document page
    carries a style block index.html does not have, and a browser would refuse it while
    every check here reported a policy that agreed with the page it was derived from.

    Two allowances here read as concessions and are worth stating plainly rather than
    hiding in a header. `'unsafe-hashes'` appears because the page carries one event
    handler and two style attributes; it does not relax anything on its own, it only lets
    the hashes beside it match in an attribute position, so the sole handler a browser will
    run is the exact string `this.media='all'`. It is written into script-src and style-src
    rather than the -attr variants because Safari shipped the -attr variants late, and a
    policy that silently stops applying on one browser is worse than one that is explicit.
    """
    # Deduplicated across the pages and sorted, so the header is byte-stable whatever
    # order they were built in and two pages sharing a stylesheet share one hash.
    def across(finder) -> list[str]:
        return sorted({found for page in pages for found in finder(page)})

    def origins(pattern: str) -> list[str]:
        found = {o for page in pages for o in _sources(page, pattern)}
        return sorted(found, key=lambda o: (o != "'self'", o))

    style_blocks = across(lambda p: re.findall(r'''<style\b[^>]*>(.*?)</style>''', p, re.S))
    style_attrs = across(
        lambda p: [v for _, v in re.findall(r'''\sstyle=(["'])(.*?)\1''', p, re.S)])
    handlers = across(
        lambda p: [b for _, _, b in re.findall(r'''\son([a-z]+)=(["'])(.*?)\2''', p, re.S)])

    scripts = origins(r'''<script[^>]*\bsrc=["']?([^"'\s>]+)''')
    sheets = origins(r'''<link[^>]*rel=["']?stylesheet["']?[^>]*\bhref=["']?([^"'\s>]+)''')
    fonts = origins(r'''<link[^>]*(?:as=font|rel=preconnect)[^>]*\bhref=["']?([^"'\s>]+)''')

    # A stylesheet can pull another stylesheet from an origin this markup never names. The
    # Typekit kit does exactly that: the sheet at use.typekit.net imports a second one from
    # p.typekit.net, and reading the page will never reveal it because the page does not say
    # it. That is the ceiling on deriving a policy from bytes, and it is why the preconnect
    # hints are read here as declarations of an origin the page talks to rather than as
    # decoration. tools/gates/csp-check.mjs is what found this: the policy agreed with the
    # page and the browser refused a stylesheet anyway.
    sheets = sorted(set(sheets) | {f for f in fonts if f != "'self'"})

    unsafe_hashes = ["'unsafe-hashes'"] if (handlers or style_attrs) else []

    directives = list(CSP_CLOSED) + [
        "script-src " + " ".join(scripts + unsafe_hashes
                                 + [_csp_hash(h) for h in handlers]),
        "style-src " + " ".join(sheets + unsafe_hashes
                                + [_csp_hash(s) for s in style_blocks]
                                + [_csp_hash(a) for a in style_attrs]),
        "font-src " + " ".join(f for f in fonts if f != "'self'") if fonts else "font-src 'none'",
        # The favicon is an empty data URI, answered from the document so the request for
        # /favicon.ico never leaves the browser. That is the only data: URL on the page.
        "img-src 'self' data:",
        # One <audio> element per call row, all of them beside index.html.
        "media-src 'self'",
    ]
    return "; ".join(d for d in directives if d.split(" ", 1)[-1])


def security_headers(*pages: str) -> list[dict[str, str]]:
    """Every response header the deployment sets, in the order they are written out."""
    return [
        {"key": "Content-Security-Policy", "value": content_security_policy(*pages)},
        # The deployment serves the page, six document pages, two modules and eight audio
        # clips, every one with a correct type. Nothing here needs a browser to guess.
        {"key": "X-Content-Type-Options", "value": "nosniff"},
        # A judge arrives from a submission form or a private document. The referrer would
        # hand this page the address of whichever of those it was, so it is not sent.
        {"key": "Referrer-Policy", "value": "no-referrer"},
        # Every feature here is one nothing on this page reaches for. autoplay is not in
        # the list and belongs to the same argument: the register resumes a clip after a
        # seek without a fresh gesture, so denying autoplay would deny the page a thing it
        # actually does. A header is only worth trusting if it is not partly untrue.
        {"key": "Permissions-Policy",
         "value": "accelerometer=(), camera=(), display-capture=(), "
                  "encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), "
                  "magnetometer=(), microphone=(), midi=(), payment=(), usb=()"},
        # frame-ancestors above is the directive browsers honour. This is the same answer
        # for anything old enough to read only the header Microsoft shipped first.
        {"key": "X-Frame-Options", "value": "DENY"},
        {"key": "Cross-Origin-Opener-Policy", "value": "same-origin"},
        {"key": "Cross-Origin-Resource-Policy", "value": "same-origin"},
    ]


def deployment_config(*pages: str) -> str:
    """The Vercel configuration, serialised the way the built page is: derived, then written."""
    config = {
        "$schema": "https://openapi.vercel.sh/vercel.json",
        "headers": [{"source": "/(.*)", "headers": security_headers(*pages)}],
    }
    return json.dumps(config, indent=2) + "\n"


def paper_hex(css: str) -> str:
    """`--paper` as hex, for the one attribute on this page that cannot read a token."""
    import check_contrast

    value = check_contrast.tokens(css).get("--paper", "")
    found = check_contrast.hex_of(value)
    if not found:
        raise SystemExit(
            "the theme colour is computed from --paper and that token could not be read as "
            f"a colour: {value!r}.\n"
            "A browser chrome that does not match the page is a visible seam, so this "
            "refuses rather than guessing a hex.")
    return found


def repo_link_markup(repo_url: str | None) -> str:
    """The source link, or nothing.

    This page argues that every number on it can be checked, and until now it offered no
    way to leave: nine links, every one an in-page anchor. The reason it had none is that
    the branch is not pushed, and a link to a repository that does not exist yet is worse
    than no link, so the URL is a build input rather than a constant. Rebuild with
    `--repo-url` once there is something to point at.

    Printing nothing was the wrong conclusion from that, and a district buyer found it by
    doing what act 08 asks: they took the commands, went looking for the code, and found
    that the word GitHub appears nowhere on the page. A judge who opens the deployed link
    first, which is what the submission form points at, had no route to anything this page
    tells them to run. Where the source lives is a fact today even when the URL is not, so
    the fact goes out and the link replaces it on the next build.
    """
    if not repo_url:
        # Nothing here, and the fact in act 08 instead. See `where_it_lives`: these two
        # sentences in the masthead cost 255 vertical pixels on a 390px phone and put the
        # call itself under the fold, which is the other half of the same buyer's report.
        return ""
    safe = html.escape(repo_url, quote=True)
    return (f'<p class=source-link><a href="{safe}" rel="noopener">'
            f'Source, tests and receipts on GitHub</a></p>')


def where_it_lives(repo_url: str | None, video_url: str | None) -> str:
    """What has no link yet, said where a reader goes looking for it.

    A district buyer took the two commands act 08 gives, went to fetch the code, and found
    that the words GitHub, film and video appeared nowhere in 250KB of markup. Both absences
    were deliberate, on the rule that a link to an unpushed branch or an unpublished video is
    worse than no link. Saying nothing at all was the wrong conclusion from a true rule: on a
    page judged in part on its demo, silence cannot be told apart from having no demo, and a
    judge who opens the deployed link first had no route to anything this page told them to
    run.

    So the fact goes out without an anchor, in the act that asks for it, and each sentence
    disappears the moment its URL exists. Nothing here is clickable, so nothing here can be
    clicked and fail.
    """
    out = []
    if not repo_url:
        out.append(
            '<p>Source, tests and receipts: a pull request into '
            '<code>CALLE-AI/awesome-phone-call-agents</code>, under '
            '<code>apps/python/firstbell</code>. This build carries no link to it because '
            'the branch was not pushed when the page was built, so the pull request is in '
            'the submission form instead.</p>')
    if not video_url:
        out.append(
            f'<p>A demo film runs {_film_running_time()} and is measured in '
            '<code>evidence/film.json</code>, which records its length, its shot count, how '
            'much of it carries sound and the digest of the file. This build carries no link '
            'to it because it was not uploaded when the page was built, so the link is in '
            'the submission form instead.</p>')
    return "".join(out)


def nav_markup(repo_url: str | None, video_url: str | None) -> str:
    """The three places a reviewer wants to go, on the bar, before anything else.

    The masthead was 250px of black at the top of the screen carrying a word and a
    sentence, and the two objects a judge can actually touch started below it. A bar does
    the same job in 64px and can hold the destinations as well, which is the other half
    of what those pixels should have been buying.

    Two of the three destinations are build inputs and the third is not. The film and the
    pull request are linked when `--video-url` and `--repo-url` are given and are absent
    from the bar otherwise, on the rule the rest of this file already follows: a link to
    an unpushed branch or an unpublished video is worse than no link, and a dead button
    is worse than both. `nav_note_markup` says where they are in the meantime rather than
    leaving a reader to guess why a page about checkable claims has nothing to click.

    The plugin is different. It is in this repository today and it is described on this
    page today, so it is an anchor and it is always there.
    """
    out = []
    if video_url:
        out.append(f'<a class=nav-act href="{html.escape(video_url, quote=True)}" '
                   f'rel="noopener">Demo video, {_film_running_time()}</a>')
    if repo_url:
        out.append(f'<a class=nav-act href="{html.escape(repo_url, quote=True)}" '
                   'rel="noopener">The pull request</a>')
    out.append('<a class=nav-act href="#plugin">The n8n plugin</a>')
    return '<nav class=nav-acts aria-label="Where to go">' + "".join(out) + '</nav>'


def nav_note_markup(repo_url: str | None, video_url: str | None) -> str:
    """What the bar cannot link to yet, named rather than left blank.

    A buyer who read the old masthead went looking for the code and reported that the
    word GitHub appeared nowhere on the page. The fact is true on every build even when
    the URL is not, so the fact ships and the button replaces it on the build that has
    the URL.
    """
    missing = []
    if not video_url:
        missing.append(f'the demo film, {_film_running_time()}')
    if not repo_url:
        missing.append('the pull request into CALL-E’s own repository')
    if not missing:
        return ""
    return ('<p class=nav-note>Not linked here yet: '
            + ' and '.join(missing)
            + '. Both are in the submission form, because a link to an unpublished file '
              'is worse than no link.</p>')


def video_link_markup(video_url: str | None) -> str:
    """The demo, or nothing.

    Same rule as the source link and for a worse reason. The film existed for weeks, four
    recordings of real calls, and it was linked from no README, no page and no submission
    field, so no judge could reach it. It is not linked from a constant because the rules
    require it "uploaded to and made publicly visible on YouTube or Vimeo", and a link to a
    video nobody has published yet is worse than no link.

    Rebuild with `--video-url` the moment it is up.

    The running time is read rather than written. It said 2 min 53 here for a fortnight,
    and a re-render made the cut five seconds longer and this line wrong, along with the
    same figure in the README and in this docstring. The film is not in the repository, so
    `make-receipt.py` measures the file and writes `evidence/film.json` beside RECEIPT.md,
    and this reads that.
    """
    if not video_url:
        return ""      # and the fact in act 08. See `where_it_lives`.
    safe = html.escape(video_url, quote=True)
    return (f'<p class=source-link><a href="{safe}" rel="noopener">'
            f'Watch the demo, {_film_running_time()}</a></p>')


def marginalia(label: str, body: str) -> str:
    """A note that sits in the right margin at wide viewports.

    It carries the things a reader should be able to find without being made to read for
    them: which figure a section is talking about, the file a number came out of, the gloss
    on a word the page uses without stopping to define. Below 72rem, which is the width the
    rail appears at, the stylesheet drops the float and the note falls into normal flow
    above the block it annotates.

    Nothing here may say anything the act does not already say. A margin is the easiest
    place on a page to introduce a claim nothing checks, because it reads as an aside and
    is written last.
    """
    return (f'<aside class=marginalia aria-label="{esc(label)}"><b>{esc(label)}</b>'
            f'{body}</aside>')


def pull(quote: str, who: str = "") -> str:
    """A sentence the act already says, set large.

    The argument is the reason the exact string matters. A reader who takes the page from
    the pull-quotes alone has to end up with what the page actually claims, so every one of
    these is lifted word for word out of the prose beside it rather than sharpened for the
    lift. `tests/test_claims.py` holds the sentences these come from.
    """
    tail = f'<span class=pull-who>{esc(who)}</span>' if who else ""
    return f'<p class=pull>{esc(quote)}{tail}</p>'


LEAD_MUTATIONS = {
    "2": "Turn the consent check off, and the software phones a family that never agreed to "
         "be phoned.",
    "49": "Turn the safeguarding rule off, and a parent who did not know their child was "
          "missing is filed as handled and nobody is told.",
    "53": "Count the money from calls that were answered instead of calls that were closed, "
          "and the funding figure goes up every time a child cannot be accounted for.",
    "98": "Remove the check on how a family can be reached, and a guardian who is deaf is "
          "phoned, reaches nobody, and is recorded as unreachable.",
    "57": "Plant a real Indian mobile number where the privacy scan was not looking. This is "
          "the one row no test caught, and it is in the table for that reason.",
}

def three_endings_figure() -> str:
    """The three words the product turns on, shown once instead of defined three times.

    A reader coming to this page cold, as a school district administrator, listed
    `resolved`, `undetermined` and `failed` among the words they could not follow, having
    met all three as a table column. A sentence explaining three outcomes is a paragraph.
    Three outcomes drawn once is a glance.

    It was a Lottie until now, and what a reader actually got was two grey rounded
    rectangles and a hairline in three hundred pixels of empty page, with the words that
    gave them meaning in a separate HTML list underneath. The drawing carried no content
    and the list carried all of it, so the figure cost a 45.6 KB player, a CDN, a mounting
    observer and a still-versus-animation swap to show nothing. Every gate passed the whole
    time, because each one asked whether the machinery worked rather than whether the
    figure said anything.

    Now it is `tools/site/endings.py`: inline SVG and CSS, no script, no asset, no request,
    and the definitions inside the drawing rather than beside it. It shares
    `showcase.css` with the act 02 figure, so the closed ring, the half ring and the dashed
    ring mean the same three things in both, and a reader learns the language once.

    `make_figure.py` is untouched and still runs during the build. The film takes its
    Lottie, which is what that generator was written for.
    """
    spec = spec_from_file_location("endings", SITE / "endings.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.endings_markup()


# The languages this run's roster actually holds, spelled the way a school office would
# say them. A BCP 47 tag on a queue row is a tag; a clerk deciding who can take the
# callback needs the language. Unknown tags fall through and print as themselves rather
# than being guessed at, because a wrong language on this row sends the wrong person.
LOCALE_NAMES = {
    "en-IN": "English",
    "en-US": "English",
    "en-GB": "English",
    "ta-IN": "Tamil",
    "hi-IN": "Hindi",
    "es-US": "Spanish",
}

# The window this project promises on a safeguarding case, imported rather than typed so
# the queue and the rule cannot disagree about it.
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
from firstbell.domain import SAFEGUARDING_CALLBACK_MINUTES  # noqa: E402


def _clock(item: dict, escalated: bool) -> str:
    """When the call ended, and when the callback window on it closes.

    A district administrator reading the published queue found the gap: four rows sorted
    under "Speak to this family first", with no time raised and no minutes left against
    the thirty minutes this project promises. They could not act on "first". The position
    was shown and the clock never was.

    Read off the receipt, never derived from the build's own clock. A deadline this page
    computed from the moment somebody happened to rebuild it would be a countdown against
    nothing, and on this page that is worse than an empty cell. The committed run predates
    the field, so it says so, which is the honest version of not knowing.
    """
    if not escalated:
        return ""
    ended = item.get("completed_at")
    if not isinstance(ended, str) or not ended:
        return ""
    try:
        at = datetime.fromisoformat(ended.replace("Z", "+00:00"))
    except ValueError:
        return ""
    due = at + timedelta(minutes=SAFEGUARDING_CALLBACK_MINUTES)
    return (f'<span class=q-clock>answered {at:%H:%M}, call back by '
            f'<b>{due:%H:%M}</b></span>')


# The Tamil block. A transcript is the text of what was actually said, so the script it
# is written in is a measurement of the language the call was conducted in rather than an
# assumption about it.
_TAMIL = re.compile(r"[\u0B80-\u0BFF]")


def _language(item: dict) -> tuple[str, str]:
    """The language of the call, and where that came from.

    Returns an empty label rather than guessing. The receipt's own `locale` is
    authoritative and is used whenever it is there. The run this page is built from
    predates that field, so the fallback reads the script of the transcript: two of the
    four cases in the queue were conducted in Tamil and two in English, which is a
    staffing fact and not a decoration. A clerk sending an English speaker to ring a
    Tamil-speaking family has moved the work rather than assigned it.
    """
    locale = item.get("locale")
    if isinstance(locale, str) and locale.strip():
        return LOCALE_NAMES.get(locale, locale), "locale"
    turns = item.get("transcript") or []
    if not turns:
        return "", ""
    said = " ".join(t.get("text", "") for t in turns if isinstance(t, dict))
    if not said.strip():
        return "", ""
    return ("Tamil" if _TAMIL.search(said) else "English"), "transcript"


def _row_facts(item: dict, escalated: bool, tried: int) -> str:
    """The three things that differ between rows, in the order a clerk needs them.

    Language first, because it decides who on the rota can take the call at all.
    """
    parts = []
    label, _source = _language(item)
    if label:
        parts.append(f'<span class=q-locale>{esc(label)}</span>')
    clock = _clock(item, escalated)
    if clock:
        parts.append(clock)
    parts.append(f'{tried} number{"" if tried == 1 else "s"} tried')
    return " &middot; ".join(parts)


def _figures() -> dict:
    """The register, keyed by id. Every sourced number on this page comes from here.

    `evidence/statistics.json` holds each externally sourced figure with its publisher,
    its URL, the sentence it came from and the date it was read at source. Reading it at
    build time rather than typing the numbers means the page cannot drift from the record
    that `tests/test_claims.py` polices, and it means a corrected figure reaches the
    deployment on the next build. One of them was corrected today: the enrolment below was
    cited to a page that serves a different district.
    """
    record = json.loads((APP / "evidence" / "statistics.json").read_text(encoding="utf-8"))
    return {f["id"]: f for f in record["figures"]}


def topline_markup(run: dict) -> str:
    """Four measured numbers, on the line under the standfirst.

    A reviewer with five minutes and two hundred entries reported reaching the end of the
    first screen without meeting a single number. Everything this page is arguing was
    below the fold: the stat grid sits in act 01, one screen down, and act 00 opens with a
    transcript. The transcript is the right thing to open with, and it is worth nothing to
    somebody who has already decided this is another repository with a nice font.

    So this is a dateline, not a stat bar. One line, the type the eyebrow already uses,
    digits in mono so the eye catches them. Every value is computed from the same two
    committed files the money band divides: `evidence/recorded-calls.json` for the counts
    and `evidence/observed-price.json` for what the account was actually billed. None of
    the four may be typed, which is what `tests/test_topline.py` is for.

    It renders as nothing when the receipts are not on this machine, for the reason the
    first-screen exchange does: a number on the first screen that no reader can check is
    the one thing this page must never carry.
    """
    if not run:
        return ""
    f = money_facts(run)
    pooled, price = f["pooled"], f["price"]
    cells = (
        (pooled["calls"], "real calls"),
        (pooled["answered"], "answered"),
        (pooled["escalated"], "escalated to a person"),
        (f'${price["per_call_usd"]:.2f}', "a call, billed"),
    )
    items = "".join(f'<li><b>{esc(value)}</b> {esc(label)}</li>' for value, label in cells)
    return (f'<ul class=topline aria-label="What this page is built on, measured">'
            f'{items}</ul>')


def one_minute_markup(run: dict) -> str:
    """The whole argument in four cards, for the reader who will not scroll.

    This page is sixteen thousand words. A hackathon judge with two hundred entries, or an
    investor between meetings, reads the first screen and decides. Everything below that
    screen is evidence, and evidence nobody reaches is worth nothing. The four numbers on
    the dateline above say what the page is built on; they do not say what the page is
    *for*, and a reader who gets 12, 11, 5 and five cents still has to read three acts to
    find out why any of it matters.

    So: the problem, the fix, what changes in an office, and why the numbers can be
    believed. Four claims, one link each into the act that proves it. About a hundred
    words, which is a minute out loud and twenty seconds scanning.

    Nothing here is a new claim. Every card restates something the page already argues and
    already checks further down, and each one carries the link to that place, so this band
    can never quietly become the only version of a fact. The two counted values come from
    the same committed files the dateline divides.
    """
    if not run:
        return ""
    ran, _skipped = _suite_pair()
    cards = (
        ("The problem", "Answered is not the same as answered usefully.",
         "A call that connects and learns nothing looks exactly like a success.",
         "#act-03", "The three endings", False),
        ("What this does", "Three endings, not two.",
         "resolved closes the case. failed is retried. undetermined never closes: the "
         "call happened, it produced nothing usable, and the software says so instead of "
         "counting it.",
         "#act-03", "What the third one costs", True),
        ("What it changes", "The office gets a list, not a percentage.",
         "An attendance clerk opens a queue ordered worst first: safeguarding, then the "
         "children nobody reached, then the calls that learned nothing. Every row names "
         "the person it is waiting on.",
         "#act-08", "Run it yourself", False),
        ("Why it holds", f"{ran} tests, and every rule broken on purpose.",
         "Every number on this page is computed from a recorded run rather than typed. "
         "Break one of the rules deliberately and a named test fails; the broken rules "
         "and what caught them are published.",
         "#act-05", "Every rule, broken", False),
    )
    items = "".join(
        f'<li class="minute-card{" minute-card--focal" if focal else ""}">'
        f'<p class=minute-eyebrow>{esc(eyebrow)}</p>'
        f'<p class=minute-claim>{esc(claim)}</p>'
        f'<p class=minute-say>{esc(say)}</p>'
        f'<a class=minute-link href="{href}">{esc(cue)}</a>'
        "</li>"
        for eyebrow, claim, say, href, cue, focal in cards
    )
    return ('<ul class=minute aria-label="The argument in one minute, and where each '
            f'part is proved">{items}</ul>')


def money_facts(run: dict) -> dict:
    """What this run costs and what it sits beside, computed rather than asserted.

    A district administrator reading this page as a buyer found the gap and measured it:
    the first cost figure on the page was at 77% of its depth, inside a terminal dump, and
    the strings for a price appeared nowhere at all. Meanwhile the foot of the page cited
    four figures about school budgets as sources for claims the page never made, which
    reads like a citation list left behind after the paragraph was cut.

    So the numbers are here, and the rule for them is the rule for everything else on this
    page: the sourced ones come out of the register with their publishers, and the derived
    ones are computed off the receipt by the same arithmetic the program prints, never
    typed. `tests/test_money_block.py` fails if any of them is written by hand.
    """
    if str(APP) not in sys.path:
        sys.path.insert(0, str(APP))
    from dispatch.models import Escalation
    from firstbell.domain import StaffCost, safeguarding_escalation

    desk = StaffCost.us_school_office()
    lead = StaffCost.us_school_safeguarding_lead()
    figures = _figures()

    def number(key: str) -> float:
        return float(figures[key]["value"].replace(",", ""))

    items = run.get("items") or []
    placed = run.get("calls_placed") or 0
    escalating = {
        item.get("id") for item in items
        if (item.get("structured_result") or {})
        and safeguarding_escalation(item["structured_result"]) is not Escalation.NONE
    }
    closed = [item for item in items
              if item.get("resolution") == "resolved" and item.get("id") not in escalating]
    # Third copy of one definition, and the one the page's escalation prose divides by.
    # `undetermined` covers both a person who answered and gave nothing usable and a call
    # nobody is known to have answered, so it reads the per-row fact the receipt now
    # records. A receipt older than that field falls back to the rule it was measured
    # under; the recorded set has no undetermined row, so nothing published moves.
    answered = [item for item in items
                if item.get("resolution") == "resolved"
                or (item.get("resolution") == "undetermined"
                    and item.get("spoke_to_someone", True))]
    net_new = [item for item in items
               if item.get("resolution") == "resolved" and item.get("id") in escalating]
    # Every escalating row, not only the net-new ones. The page said "0 of 7 answered
    # calls became new work" a short scroll below a queue showing four rows marked
    # safeguarding, and reconciling the two meant reading this file.
    escalated_rows = [item for item in items if item.get("id") in escalating]
    # Restricted to attempts this run placed, because the `placed` figure beside it comes
    # from the receipt's `calls_placed`, which excludes replays on purpose: an attempt an
    # idempotency key replayed was not billed. Summing every attempt here and dividing by a
    # billed-only denominator put replays in one half of the ratio and not the other, and
    # on a partly replayed run that overstates the ceiling threefold.
    removed = sum(item.get("attempts", 0) for item in closed
                  if item.get("placed_by_this_run") is True)

    # Every figure on this band, from the module that owns the arithmetic. This function
    # used to do its own division for its own receipt, which is how the mismatched
    # denominator survived being fixed in two other places: the callback cost was per
    # answered call and it was taken off a saving that is per billed attempt. One module,
    # four integers, and the bound comes back with them.
    sys.path.insert(0, str(APP / "tools"))
    from money_across_runs import demo_row, figures_for, observed, pooled_live_row

    receipt = figures_for(placed, removed, len(answered), len(net_new), calls=placed,
                          escalated=len(escalating))
    # Every call this software has placed against the production API, from the counts in
    # `evidence/recorded-calls.json`. The band used to argue from whichever single receipt
    # the page was pointed at, which is seven calls, while the rest of the entry says
    # twelve. It is also the only numerator in the entry nobody chose.
    pooled = pooled_live_row()

    return {
        "price": observed()["observed"],
        "demo": demo_row(),
        "sis": figures["chccs-sis-renewal"],
        "enrolment": figures["chccs-enrolment"],
        "per_student": number("chccs-sis-renewal") / number("chccs-enrolment"),
        "allotment": figures["texas-basic-allotment"],
        "per_absence": number("texas-basic-allotment") / 175,
        "districts": figures["us-regular-districts"],
        "schools": figures["us-public-schools"],
        "placed": placed,
        "removed": removed,
        # `figures_for` already prices three minutes an attempt, which is why these
        # read straight off it rather than being multiplied here.
        "ceiling_at_three": receipt["gross_ceiling"],
        "net_new": len(net_new),
        "escalated": len(escalated_rows),
        "answered": len(answered),
        "added_at_three": receipt["added"],
        "net_at_three": receipt["net_ceiling"],
        "bound": receipt["net_new_bound"],
        "pooled": pooled,
        # Where the saving stops. A bound with nothing to compare it against is a number
        # a reader cannot use, and this page published one for a fortnight.
        "crossover": receipt["crossover_per_100"],
        "worst_at_three": receipt["worst_case_ceiling"],
        "desk": desk,
        "lead": lead,
    }


def _money_key_block(f: dict) -> str:
    """The figures a school board asks for, on the calls that rang.

    Three of them, or four where the record holds an escalation count: the saving, the
    crossover, the bound on the net-new rate, and the bound on the escalation rate that
    the widest reading of these calls cannot rule out.

    A landing place rather than a summary: the same numbers as the paragraph under it, with
    nothing between them and the eye. Derived from the pooled row so it cannot drift from
    the table it condenses, and empty when there is no pooled row to condense, because a
    block of "n/a" beside a heading about money is worse than no block.

    On the recorded calls rather than the demo run, because this is the block a district
    would quote and the pooled row is the only numerator on this page nobody chose. The
    demo run's own figures are in the two cards above it.
    """
    pooled = f.get("pooled")
    if not pooled:
        return ""
    if (pooled.get("net_ceiling") is None or pooled.get("net_new_bound") is None
            or pooled.get("crossover_per_100") is None):
        return ""
    # The escalation rate's own bound, as a fourth row rather than a wider guard. The
    # three above it are still true without it, and blanking a card that can answer three
    # of the four questions to punish a missing fourth is the shape of gate this entry
    # spends its time arguing against. The count in the foot is derived for the same
    # reason: a sentence saying "these three rates" over two rates is a small lie that
    # nothing would have caught.
    # The figure to quote, and the figure to plan against. Both derived: a card that hard
    # codes either one is the defect this page spends four thousand words on.
    demo = (f.get("demo") or {}).get("net_ceiling")
    every = pooled.get("ceiling_if_every_escalation_is_new")
    price = (f.get("price") or {}).get("per_call_usd")
    quote = ""
    if demo is not None and every is not None and every < 0:
        # Three figures in one order, because a district met four across three surfaces and
        # said it could not tell which one this entry stood behind. Smallest reproducible
        # saving, then the cost the widest reading prices out to, then what was actually
        # billed. All three derived.
        billed = ("" if price is None else
                  f'The calls themselves were billed at ${price:,.2f} each on the one '
                  'month of usage this account has. ')
        quote = (
            f'Quote the demo run&#8217;s ${demo:,.2f} rather than the ceiling above: it is '
            'the smaller of the two and one command reproduces it. Plan against the '
            f'${abs(every):,.2f} a call this becomes if every escalated call is priced as '
            'a callback, which is the reading this entry holds itself to. '
            + billed +
            'Which of those two a district is living in is what the first week of a pilot '
            'measures, and nothing before that week can settle it. ')

    worse, widest = "", ""
    if pooled.get("escalated_bound") is not None and pooled.get("escalated"):
        worse = (
            '<div><dt>The same bound if every escalation is a callback</dt>'
            f'<dd>{100 * pooled["escalated_bound"]:.0f} per 100</dd></div>')
        widest = (
            f'The widest of them prices all {pooled["escalated"]} escalated calls as '
            'callbacks rather than only the ones this software says it created. That is '
            f'{100 * pooled["escalated"] / pooled["answered"]:.0f} per 100 measured and '
            f'{100 * pooled["escalated_bound"]:.0f} that this many calls cannot rule out, '
            f'both above the {pooled["crossover_per_100"]:.1f} where the saving stops, so '
            'on that assumption this is a cost and not a saving. ')
    rows = [
        # "The most", not "what it can save". The README calls this figure a ceiling and
        # not a saving, eighty lines from where the card's largest label promised one, and
        # a reviewer read the label rather than the qualification. A ceiling is the honest
        # word for a number computed by pricing every removed attempt at a desk rate
        # nobody has audited, so the label says it.
        '<div><dt>The most one call can save</dt>'
        f'<dd>${pooled["net_ceiling"]:,.2f}</dd></div>',
        '<div><dt>Where that becomes a loss</dt>'
        f'<dd>{pooled["crossover_per_100"]:.1f} per 100 answered calls</dd></div>',
        # The answered count, not the placed one. The bound is a rate per answered call,
        # computed in money_across_runs.figures_for from `answered`, and one of the calls
        # reached nobody. This card said twelve for a figure over eleven, which is the same
        # defect an audit found in two other places on the same day.
        #
        # `net-new per 100` rather than `per 100`, because the label said what the sample
        # was and not what the rate was of. A reader could take 24 as what eleven calls
        # cannot rule out about escalations, and the escalation rate this run measured is
        # already twice that. The row under it is that rate's own bound.
        f'<div><dt>What {pooled["answered"]} answered calls cannot rule out</dt>'
        f'<dd>{100 * pooled["net_new_bound"]:.0f} net-new per 100</dd></div>',
    ]
    if worse:
        rows.append(worse)

    # Counted off the rows rather than set beside the branch that adds one. The literal
    # and the fourth row were assigned inside the same `if`, so the foot and the card
    # could not disagree, and the gate written to catch a disagreement could not fail:
    # its own docstring claimed it would read "these three rates" over two rows, and
    # only editing this file's literals could produce that. A count taken off the rows
    # can be wrong, which is what makes checking it worth anything.
    how_many = ("no", "one", "two", "three", "four", "five", "six")[
        sum(1 for row in rows if "per 100" in row)]

    return (
        '<dl class=money-key>'
        + "".join(rows)
        + '</dl>'
        '<p class=money-key-foot>The sample is every call this software has placed, which '
        f'is the one denominator on this page nobody chose, and these {how_many} rates '
        'are per answered call, because one of those calls reached nobody. '
        + widest +
        # Which of them to quote, in the card rather than eighty lines below it. A district
        # buyer read this block, counted four money figures across the page and could not
        # tell which one the entry stood behind, so the two that answer that are named here
        # and both are derived. The smaller one is the demo run's, which is the figure this
        # entry leads with everywhere else because one command reproduces it.
        quote +
        'The paragraph below is '
        'the same '
        'figures with the objections they answer, and the demo run&#8217;s own numbers are '
        'in the two cards above.</p>')


def money_markup(run: dict) -> str:
    """Three numbers a district recognises, and the two nobody has."""
    f = money_facts(run)
    if f["ceiling_at_three"] is None:
        return ""

    def cite(figure: dict) -> str:
        return (f'<a class=money-src href="{esc(figure["url"])}">'
                f'{esc(figure["publisher"].split(",")[0])}</a>')

    # The provenance is set under the band, not inside the cells.
    #
    # A band of three cells is as tall as its longest cell, and the third one carries 140
    # words about how CALL-E's usage panel was read. Measured at 1440: the band ran 430px
    # while the first two cells finished after 170, so two thirds of it was empty ruled
    # ground beside a wall of small print, in the act a buyer opens the page for. It also
    # put the least skimmable prose on the page in the same object as its three most
    # skimmable numbers.
    #
    # Nothing is hidden and nothing is cut. Each note keeps its figure at the front of it,
    # so a reader still knows which number it is about, and the notes are set at the UI
    # measure below the band, which is where every other provenance note on this page is.
    whys = []

    def why(figure: str, body: str) -> str:
        whys.append(f'<p class=money-why><span class=money-why-of>{figure}</span>{body}</p>')
        return ""

    return "".join([
        '<div class=money>',
        '<div class=money-row>',

        '<div class=money-cell>',
        f'<p class=money-n>${f["sis"]["value"]}</p>',
        '<p class=money-what>a year, for the system this would sit beside</p>',
        why(f'${f["sis"]["value"]} a year',
            f'One named district&#8217;s student records bundle, on its own '
            f'board record, for {esc(f["enrolment"]["value"])} students. '
            f'<b>${f["per_student"]:,.2f} a student a year.</b> One price on the record, '
            f'not a market average. {cite(f["sis"])}'),
        '</div>',

        '<div class=money-cell>',
        f'<p class=money-n>${f["per_absence"]:,.2f}</p>',
        '<p class=money-what>one student, one day, where funding follows attendance</p>',
        why(f'${f["per_absence"]:,.2f} a student-day',
            f'Texas funds ${f["allotment"]["value"]} per student in average '
            'daily attendance, over a 175-day year. Seven states funded on attendance as '
            'of 2022. Explaining an absence does not make a student present, so this run '
            f'claims none of it. {cite(f["allotment"])}'),
        '</div>',

        '<div class=money-cell>',
        f'<p class=money-n>${f["price"]["per_call_usd"]:,.2f}</p>',
        f'<p class=money-what>a call, billed. The desk time one call removes is worth '
        f'${f["demo"]["net_ceiling"]:,.2f}</p>',
        # Three endings here as well, and the third one is why this is a branch rather
        # than a format string. A run that placed calls and answered none has no
        # escalation rate: the denominator is zero, so `bound` and `worst_at_three` are
        # None, and multiplying None raised a TypeError that killed the whole page build.
        # The guard above only asked whether the ceiling existed, and on that run the
        # ceiling is 0.0, which is a number.
        #
        # It is the defect this project spends its time hunting, in its own page builder:
        # a quantity that cannot be measured, handled as though it always can be.
        # Ten rows were read and thirteen is what the total divides into. The card
        # printed the thirteen as though it had been counted, which is an inference
        # dressed as an observation on the surface a judge reads first.
        why(f'${f["price"]["per_call_usd"]:,.2f} a call',
            f'CALL-E publishes no price, so the left figure is what it '
            f'billed this account: {f["price"]["call_rows_read"]} rows on the usage panel, '
        f'every one at ${f["price"]["per_call_usd"]:,.2f}, and a period total of '
        f'${f["price"]["period_total_usd"]:,.2f} over one month that divides by it '
        f'exactly, so {f["price"]["billed_events"]} events were priced the same. That '
        f'last number is a division and not a row count. The right figure is '
        f'the demo run: {f["demo"]["attempts_removed"]} of '
        f'{f["demo"]["attempts_billed"]} attempts came off a desk at '
        f'${f["desk"].hourly:,.2f} an hour at three minutes each, less the safeguarding '
        f'callbacks at ${f["lead"].hourly:,.2f}. Not a saving: a ceiling. '
        # The demo run is reproducible because its outcomes are written down, and that is
        # the same sentence as "somebody chose this numerator". A reader who found
        # firstbell/scenario.py after reading this figure would be entitled to think the
        # page had hidden it.
        'And not a measurement: that run answers against a test double whose outcome mix '
        'is written down in <code>firstbell/scenario.py</code>, which is what lets anybody '
        'reproduce it with one command and also means somebody chose it. The measured '
        'figure is further down this paragraph, over every call this software has '
        'placed.'),

        '</div>',
        '</div>',
        # The three notes, under the band, in the order of the cells above them.
        f'<div class=money-whys>{"".join(whys)}</div>',

        # The numbers a school board asks for, out of the paragraph below.
        #
        # Two readers with the buyer's job named that paragraph as the thing that
        # nearly stopped them reading: sixteen figures in one block, with the
        # ceiling and the crossover, the only two they came for, in the middle of
        # it. Nothing was cut to pay for this. Every number in the paragraph answers
        # a different objection, and a reader who needs three can now stop at three.
        '<details class="fold act-fold money-fold"><summary>Where each of those '
        'figures comes from, and what would move it</summary><div class=fold-body>',
        _money_key_block(f),

        # Three sentences of caveat, in the order a buyer would object in. The first
        # used to say nobody has a price, which stopped being true the day the account
        # was billed. The second is the run this page is built on, which is a third run
        # again: a ceiling is a division whose numerator is measured, so it moves, and
        # for a while this page published its own figure with nothing naming the run.
        f'<p class=money-foot>${f["price"]["per_call_usd"]:,.2f} is one account&#8217;s '
        'billing on hackathon credit and not a price CALL-E stands behind, so a district '
        'confirms its own. Every one of those calls ran between '
        f'{esc(f["price"]["shortest_duration"])} and '
        f'{esc(f["price"]["longest_duration"])}, all under two minutes, so they cannot '
        'tell a flat price from a per-minute one rounded up. '
        'This page&#8217;s receipt is a third run: '
        f'{f["removed"]} of {f["placed"]} attempts removed, '
        # Three endings, and the third is why this is a branch. A run that placed calls
        # and answered none has no escalation rate: the denominator is zero, so `bound`
        # is None, and multiplying None killed the whole page build once. The guard at
        # the top only asked whether the ceiling existed, and on that run it is 0.0,
        # which is a number.
        + ('and nobody answered, so it says nothing about what the safeguarding rule '
           'adds: that rate needs an answered call and there is none here. '
           if not f["answered"] or f["bound"] is None else
           f'{f["net_new"]} of {f["answered"]} answered calls became new work for the '
           f'safeguarding lead'
           # The queue above this shows the escalating rows, and a reader who counts them
           # gets a different number from this sentence unless the sentence says why.
           + (f', though {f["escalated"]} carry the safeguarding mark: net-new counts only '
              'a call that would have closed on its own, and a call already going to a '
              'person was going there anyway'
              if f["escalated"] > f["net_new"] else '')
           + f'. {f["answered"]} calls cannot rule out '
           f'{100 * f["bound"]:.0f} per 100, against a crossover of '
           f'{f["crossover"]:.1f} per 100: above that rate the callbacks this software '
           f'creates cost a district more than the attempts it removes, which is the '
           f'sentence a school board asks for and the one a vendor deck leaves out. '
           f'At the far end of the bound '
           + (f'the ceiling is ${f["worst_at_three"]:,.2f}. '
              # No None check here, deliberately. `worst_at_three` is None only when the
              # bound or the ceiling is None, the branch above catches the bound and the
              # guard at the top of this function returns early on the ceiling, so this
              # arm is unreachable with None. A mutation that removed a None check here
              # was not caught by any test, which is how an unreachable guard announces
              # itself: it reads as protection and provides none.
              if f["worst_at_three"] > 0 else
              'the callbacks cost more than the calls save, and which end it is, is what '
              'a pilot measures in week one. '))
        + (
            # The pooled figure, and the worst bound on it. A page that publishes a
            # ceiling and withholds the number that holds if its own classification is
            # wrong is doing the thing this entry was built to argue against.
            f'Across all {f["pooled"]["calls"]} calls this software has placed against '
            f'the production API, the net ceiling is '
            f'${f["pooled"]["net_ceiling"]:,.2f} and the crossover is '
            f'{f["pooled"]["crossover_per_100"]:.1f} per 100, with '
            f'{f["pooled"]["net_new"]} of {f["pooled"]["answered"]} answered calls '
            f'measured at {100 * f["pooled"]["net_new"] / f["pooled"]["answered"]:.1f}. '
            f'The safeguarding rule marked {f["pooled"]["escalated"]}, and pricing every '
            f'one of those as a callback rather than only the ones this software says it '
            f'created turns that into '
            + ('a cost of $%.2f a call. That bound over-counts on purpose and it is the '
               'number to hold this entry to. '
               % abs(f["pooled"]["ceiling_if_every_escalation_is_new"])
               if (f["pooled"]["ceiling_if_every_escalation_is_new"] or 0) < 0 else
               '$%.2f a call. '
               % (f["pooled"]["ceiling_if_every_escalation_is_new"] or 0))
            if f["pooled"] and f["pooled"]["net_ceiling"] is not None
               and f["pooled"]["answered"] else '')
        + '<code>python tools/money_across_runs.py</code> prints every run&#8217;s '
        'figures from one piece of arithmetic. '
        'How many unanswered '
        'notifications a district handles in a morning is still a number a school office '
        'has and we do not, which is why every figure here is per call rather than per '
        f'year. For scale only: the United States has {esc(f["districts"]["value"])} '
        f'regular school districts and {esc(f["schools"]["value"])} public schools '
        f'({cite(f["districts"])}). That is the size of the problem, not a claim about '
        'adoption.</p>',
        # The act ends by saying a pilot settles which end of the bound a district is on,
        # and then offered no way to read what a pilot would be. Two buyers found that
        # document at the foot of the page or not at all.
        '</div></details>',
        '<p class=money-next><a href="docs/what-a-pilot-would-look-like.html">'
        'What a pilot would look like</a>: two schools, six weeks, and the four numbers '
        'measured before this software telephones anybody.</p>',
        '</div>',
    ])


def queue_markup(run: dict) -> str:
    """The screen a school office opens on Monday, built from a receipt that already exists.

    A reader coming to this page cold, as a district administrator, put
    this first among the things that would raise it: "Show the screen my secretary opens
    Monday morning. The only interface on this page is a terminal. No district buys a
    terminal."

    They are right, and the honest way to answer it matters more than the answer. A drawing
    of a product that does not exist is a mockup, and an entry whose whole argument is that
    every claim carries the thing that checks it cannot afford one. So nothing here is drawn.
    The rows are the items of a committed run, put through `safeguarding_escalation`, the
    same function the command line calls, and sorted by the same rule as
    `RunReport.human_queue`: anything escalated first, because a queue that lists a
    safeguarding case below eleven ordinary callbacks has technically reported it and a clerk
    working top down reaches it last.

    That means this view cannot flatter the software. If the rule changes, the queue changes.
    If a case stops escalating, it drops down this list on the next build.

    The free text note is deliberately not shown. It is the only unconstrained string CALL-E
    returns, the escalation never reads it, and putting a parent's own words about their
    child on a public page to make an interface look richer would be the wrong trade twice.
    """
    # The app itself, imported rather than restated. This view exists to show the shipped
    # rule deciding real rows, so re-implementing the rule here would make it a drawing of
    # the software instead of the software.
    if str(APP) not in sys.path:
        sys.path.insert(0, str(APP))
    from dispatch.models import Escalation
    from firstbell.domain import safeguarding_escalation

    # Escalation is asked of every row that came back with a structured result, whatever the
    # resolution was. The first version of this asked it only of `resolved` rows, on the
    # assumption that an undetermined call has nothing to escalate about. In this run all
    # four escalating cases are undetermined, so that version drew four safeguarding rows as
    # ordinary callbacks. The bug pointed the one way a bug here must never point: it made
    # the queue look calmer than the calls were.
    #
    # `ItemResult.needs_a_human` is the rule being followed: a row is in the queue if its
    # resolution needs a person OR it escalated, and the sort puts escalations first.
    rows = []
    for item in run["items"]:
        resolution = item.get("resolution") or ""
        structured = item.get("structured_result") or {}
        escalated = bool(structured) and safeguarding_escalation(structured) is not Escalation.NONE
        if resolution == "resolved" and not escalated:
            continue
        rows.append((0 if escalated else 1, escalated, item, resolution))
    rows.sort(key=lambda r: r[0])

    if not rows:
        return ""

    # What each state means to the person holding the list, rather than to the program.
    says = {
        "undetermined": ("The call connected and ended without an answer the office can use.",
                         "Call the family back."),
        "failed": ("Nobody picked up on any number we hold.",
                   "Try another contact, or send someone."),
    }

    def _reason(escalated: bool, item: dict, resolution: str) -> tuple[str, str]:
        if escalated:
            head = "The parent did not confirm they already knew their child was absent."
            if resolution != "resolved":
                head += " The call also ended without an answer the office can use."
            return head, "Speak to this family first."
        return says.get(resolution, (item.get("reason") or "", "Look at this."))

    # Say a shared reason once.
    #
    # Every row carried its own copy of it, and in this run all four rows are the same case,
    # so the same two sentences were set four times in a 46ch column: twenty-four lines of
    # identical prose, which is most of the height of the one screen on this page that is
    # supposed to read like a working queue. Reading fatigue was the highest-scoring
    # complaint a first-time reader left about this page, and repetition is the cheapest kind of it
    # to remove, because nothing is lost: a clerk still learns the reason before the first
    # row, and each row keeps the three things that differ.
    #
    # Only when they really are all the same. A mixed queue puts the reason back on every
    # row, because a shared band above rows that do not share it would be a lie about four
    # families at once.
    reasons = {_reason(escalated, item, resolution)
               for _, escalated, item, resolution in rows}
    shared = reasons.pop() if len(reasons) == 1 and len(rows) > 1 else None

    out = ['<div class=queue>',
           '<div class=queue-head>',
           f'<p class=queue-n>{len(rows)}</p>',
           '<p class=queue-said>cases need a person. Nothing here is closed.</p>',
           '</div>']
    if shared:
        out.append(f'<p class=queue-why>All {len(rows)} for the same reason. '
                   f'{esc(shared[0])}<b>{esc(shared[1])}</b></p>')
    # Said once, when no row can show a clock. The rows this page is built from were
    # placed before the receipt recorded a per-call end time, and the thirty-minute
    # window is measured from that moment, so this page can show the position the rule
    # gives a case and cannot show its deadline. The field is recorded now; this receipt
    # is the one already published, and replacing it with a newer run to make the screen
    # look better would be the trade this whole entry argues against.
    # One note under the rows, holding whatever this receipt could not tell the page.
    #
    # There were two paragraphs here for a while, one about the language and one about the
    # clock, and two stacked admissions above four rows is the same reading fatigue the
    # shared-reason band was written to remove. Every count in it is derived: a sentence
    # that says "two of the four" and means it only for one receipt is the kind of typed
    # number this project deletes on sight.
    inferred = [item for _, _e, item, _r in rows if _language(item)[1] == "transcript"]
    tamil = sum(1 for item in inferred if _language(item)[0] == "Tamil")
    escalating = [item for _, escalated, item, _res in rows if escalated]
    clockless = escalating and not any(_clock(item, True) for item in escalating)
    notes = []
    if inferred:
        notes.append(
            f"The language on {len(inferred)} of these rows is read from the script of "
            "the call's own transcript, because this receipt predates the roster field "
            "that records it")
        if tamil:
            notes.append(
                f"{tamil} of the {len(rows)} were conducted in Tamil, so this queue "
                "needs a Tamil speaker on the rota rather than whoever is free")
    if clockless:
        notes.append(
            f"each carries a {SAFEGUARDING_CALLBACK_MINUTES}-minute callback window and "
            "this receipt records no per-call end time, so the deadline is not shown. "
            "The field is written now, it was not on 4 September, and a countdown "
            "computed from the moment this page was built would be a deadline against "
            "nothing")
    if notes:
        out.append("<p class=queue-clockless>"
                   + ". ".join(note[0].upper() + note[1:] for note in notes)
                   + ".</p>")
    out.append(f'<ol class="queue-list{" is-shared" if shared else ""}">')

    for _, escalated, item, resolution in rows:
        student = esc(item.get("id") or "")
        tried = len(item.get("numbers_tried") or [])
        head, todo = _reason(escalated, item, resolution)
        if escalated:
            cls, label = "q-safeguarding", "safeguarding"
        else:
            cls, label = f"q-{resolution}", resolution
        body = "" if shared else (
            f'<div class=q-body><p class=q-head>{esc(head)}</p>'
            f'<p class=q-todo>{esc(todo)}</p></div>')
        out.append(
            f'<li class="queue-row {cls}">'
            f'<p class=q-when>{student}</p>'
            f'{body}'
            f'<p class="state state-{"undetermined" if escalated else resolution}">'
            f'{esc(label)}</p>'
            f'<p class=q-tried>{_row_facts(item, escalated, tried)}</p>'
            '</li>')
    out.append('</ol>')
    # The receipt this queue is built from is not in the repository and saying so here
    # is the difference between evidence and an assertion. A reader who went looking for
    # the file and did not find it had grounds to distrust the whole act.
    #
    # It sent a reader to the evidence page for a receipt that is not published there:
    # that page carries the recordings, the transcripts and the shortened ids, and no
    # receipt file. So this now says where each thing is, and prints the two numbers from
    # the one committed record that let a reader check these rows without the file.
    counted = receipt_counts("06-locale-matched-pairs.json")
    out.append('<p class=queue-foot>Every row is a real call from '
               '<code>06-locale-matched-pairs.json</code>, sorted by the same rule the '
               'program uses. Nothing here was arranged for the picture. The recordings '
               'are on the <a href="https://firstbell-evidence.vercel.app" '
               'rel="noopener">evidence page</a>; the receipt file is on neither that page '
               'nor in the repository, for the reason <code>evidence/README.md</code> '
               'gives. The count holds without it: '
               '<code>evidence/recorded-calls.json</code> records that receipt&#8217;s '
               f'{counted["calls"]} calls and the {counted["escalated"]} of them that '
               f'needed a human, which is the {len(rows)} rows here, and it carries the '
               'counts behind every money figure on this page.</p>')
    out.append('</div>')
    return "".join(out)


def mutation_distribution(muts: list) -> str:
    """The shape of the table beside it, drawn instead of described.

    The mutation table is the longest artifact on this page, and its shape is the argument:
    a deliberate change is almost always noticed by a small handful of tests, and exactly
    one was noticed by none. A reader who scrolls all of it arrives at that in a minute.
    This says it in a glance.

    Built from the same rows the table is built from, so the two cannot disagree. Nothing
    here is typed: every number below is counted off `muts`. Drawn as an `svg` with a
    `viewBox` and no fixed height, so it reserves its own box and shifts nothing, and with no
    script, so it is the same figure with JavaScript off.
    """
    order = ["0", "1", "2", "3", "4", "5+"]
    buckets = {key: 0 for key in order}
    for row in muts:
        try:
            n = int(row[2])
        except (ValueError, IndexError):
            continue
        buckets["5+" if n >= 5 else str(n)] += 1

    total = sum(buckets.values())
    widest = max(buckets.values()) or 1
    uncaught = buckets["0"]

    row_h, bar_x, bar_max = 22, 30, 196
    bars = []
    for i, key in enumerate(order):
        count = buckets[key]
        top = i * row_h
        # A bar of zero width would read as a missing row rather than an empty one, so an
        # empty bucket keeps a hairline. The uncaught bucket is the one worth finding, so it
        # is the only one drawn in the accent.
        width = max(round(bar_max * count / widest, 1), 1.5) if count else 1.5
        fill = "var(--brand-field)" if key == "0" and count else "var(--ink-2)"
        bars.append(
            f'<text x="0" y="{top + 14}" class=dist-k>{key}</text>'
            f'<rect x="{bar_x}" y="{top + 4}" width="{width}" height="13" fill="{fill}"/>'
            f'<text x="{bar_x + width + 5}" y="{top + 14}" class=dist-n>{count}</text>'
        )

    caption = (f"{uncaught} of {total} changes were noticed by no test at all."
               if uncaught else f"Every one of {total} changes was noticed by a test.")
    label = ("Deliberate changes grouped by how many tests noticed each one: "
             + ", ".join(f"{buckets[k]} noticed by {k}" for k in order) + ".")

    return (
        '<figure class=dist>'
        f'<svg viewBox="0 0 260 {len(order) * row_h + 4}" role=img '
        f'aria-label="{esc(label)}">{"".join(bars)}</svg>'
        f'<figcaption>Tests that noticed each change. {esc(caption)}</figcaption>'
        '</figure>'
    )


def sources_markup() -> str:
    """Every outside figure this project publishes, with somewhere to go and check it.

    The page had none of these. It argues that a claim without the thing that checks it is
    worthless, and the four figures it rests on that were not measured here, England's
    persistent absence rate, the two US language shares, the count of chronically absent
    American pupils, appeared only in a README, and even there the publisher was named
    without a link. A reviewer reading as a district buyer said the plainest version of
    this: a publisher's name is not a source, it is an assertion about a source.

    Read out of `evidence/statistics.json`, which is the file the claims gate already
    checks the README against, so the page cannot publish a figure with a different value
    from the one the record holds.
    """
    figures = json.loads(
        (EVIDENCE / "statistics.json").read_text(encoding="utf-8"))["figures"]
    rows = []
    for figure in figures:
        url = figure.get("url")
        if not url:
            raise SystemExit(
                f"the figure {figure['id']} in evidence/statistics.json has no url, so the "
                f"page would name a publisher with nowhere to go and check them"
            )
        rows.append(
            f'<li><span class=num>{esc(figure["value"])}</span> {esc(figure["claim"])}'
            f'<p><a href="{html.escape(url, quote=True)}" rel="noopener">'
            f'{esc(figure["publisher"])}</a>'
            f'<span class=read-at>, read at source {esc(figure["read_at_source"])}</span>'
            f'</p></li>'
        )
    return f'<ul class=sources>{"".join(rows)}</ul>'


def takeaway_markup() -> str:
    """The two pieces of this that are worth something to somebody who is not us.

    Two readers arrived at the same complaint from opposite directions. The platform
    engineer wrote that the transferable work is `calle_double` and that it is "filed where
    nobody will find it". The district operations director wrote that the n8n recipe "appears
    in the README only, not the page and not the video". Neither of them was going to clone a
    repository to discover it. So the page says it, with the number of tests behind each and
    the one command that checks it.

    Both of those were wrong, and a buyer found them by running them. The n8n command named
    two files and printed the count of one of them, and from the directory this page puts a
    reader in it found neither file. The other row printed "44 tests" next to a command that
    runs no tests and a figure that matched no file in the tree. A caption nobody executes is
    where a stale number lives longest, so both are now derived and both commands start with
    `cd`.
    """
    compared, paths, missing = _conformance_figures()
    classifier, shape = _node_suite_size()
    rows = [
        ("The offline CALL-E",
         "docs/the-offline-calle.html",
         "A CALL-E written from the published API, mounted on the SDK's own transport, so "
         f"the client under test is the shipped one. Every offline run in this entry is "
         f"measured against it, and the record proving it matches production compares "
         f"{compared} recorded responses path by path and type by type.",
         "cd apps/python/firstbell && python tools/double_conformance.py --check",
         f"{paths} API paths, {missing} missing"),
        ("The same rule as an n8n recipe",
         None,
         "The three-outcome classifier is not locked inside a Python CLI. It ships as an "
         "importable n8n workflow, generated from the tested module by a committed script "
         "so the two cannot drift, inactive on import with a dry run that places no calls "
         "and needs no API key.",
         "cd plugins/firstbell-absence-calls && node --test "
         "examples/classify.test.mjs examples/workflow-shape.test.mjs",
         f"{classifier + shape} tests, no n8n installed"),
    ]
    items = []
    for title, href, why, command, count in rows:
        head = (f'<a href="{href}">{esc(title)}</a>' if href else esc(title))
        items.append(
            f'<li><p class=take-h>{head}</p>'
            f'<p class=take-why>{esc(why)}</p>'
            f'<p class=take-run><code>{esc(command)}</code> '
            f'<span class=take-n>{esc(count)}</span></p></li>')
    return (
        '<p class=further-k>Two pieces of this you can take</p>'
        f'<ul class=take-list>{"".join(items)}</ul>'
    )


def further_markup() -> str:
    """The one block on this page whose links leave it.

    Placed after the last act, because it is what a reader does next rather than part of
    the argument. Two lists: the documents, and the outside numbers. Somebody coming to it as a district
    operations director found both unreachable and judged the entry on what they could
    reach, which is the correct thing for them to have done.
    """
    return (
        '<section class="further inner inner-margin" aria-labelledby=h-further>'
        '<p class=further-k>Where to go next</p>'
        '<h2 class=further-lead id=h-further>Everything this rests on, and how to leave '
        'this page to check it.</h2>'
        # Out of the fold, because the bar links to it. What ships as an importable
        # workflow rather than as this app is the reusable half of the entry, and a
        # button pointing at a closed disclosure is a button that answers nothing.
        + '<div id=plugin>' + takeaway_markup() + '</div>'
        + '<details class="fold act-fold"><summary>Every document, and every outside '
          'figure with its publisher</summary><div class=fold-body>'
        + doc_pages.index_markup()
        + '<p class=further-k>The outside figures, and who published them</p>'
        + sources_markup()
        + '</div></details>'
        + '</section>'
    )


def path_markup() -> str:
    """The stated way in, once, at the top.

    This page is 4,283 words and every one of them is held by a test, so the answer to a
    reader with two minutes cannot be to cut. It is to say where to spend them. Five
    destinations, in the order they answer the question a judge is actually asking, each an
    ordinary anchor so it works with no script and lands on a keyboard.

    The last one is the run itself. A reviewer with three minutes would rather press
    something than read about it, and the only honest version of that this page can offer
    is the offline run it already holds, played rather than pasted. It is last because
    somebody who has not heard a call yet has no reason to care what a console prints.

    It sits at the top of act 1 rather than on the first screen. Act 0 has one sentence and
    one object on it and both are the argument; a menu above the register would be the page
    explaining itself instead of showing itself, on the one screen where showing works.
    """
    steps = [
        ("act-00", "Watch a row fill in",
         "A real call to a parent who had not been told, playing in the register it "
         "belongs to."),
        ("act-02", "The same call in Tamil",
         "Two conversations of different lengths, and the three fields underneath them."),
        ("act-03", "Three endings, not two",
         "What this software does with a call it could not get an answer to."),
        # Added because a district administrator reading this page as a buyer could not
        # find a cost on it. Three destinations were the whole point of this list and a
        # fourth is a real cost to it, so the lead says which reader the fourth is for
        # rather than pretending they are all the same reader.
        ("act-04", "What it costs, and against what",
         "For a buyer: the price above which a person is cheaper, beside what a district "
         "already pays for the system this sits next to."),
        # Fifth, and last, because a reviewer with minutes rather than hours wants to run
        # the thing and the only version of that this page can offer is the run it already
        # holds. It goes at the end of the list and not the start: somebody who has not
        # heard a call yet has no reason to care what a console prints.
        ("act-08", "Run it, here, now",
         "The whole offline run is on the page: seven rows, three endings, and the totals. "
         "A button replays it line by line. No account, no key, nothing dialled."),
        # The only entry that leaves this page, and it is here because two readers coming
        # to the entry as district buyers said the same thing: this document is what
        # decides whether they pilot, and it was reachable only from the foot of a page
        # with nine acts above it. A menu of five in-page anchors is a menu that assumes
        # the reader's question is answered on the page.
        ("docs/what-a-pilot-would-look-like.html", "What a pilot would look like",
         "Two schools, six weeks, the four numbers measured before switch-on, and the "
         "children this software is not allowed to telephone. Leaves this page."),
    ]
    out = ['<div class=path>',
           '<p class=path-k>The two-minute path</p>',
           '<p class=path-lead>Three things, in the order they answer the question, a '
           'fourth if you are the person who has to pay for it, one you can press, and '
           'the document a district would decide on. Everything else here is the evidence '
           'behind them.</p>',
           '<ol class=path-steps>']
    for i, (anchor, title, why) in enumerate(steps, 1):
        href = anchor if "/" in anchor else f"#{anchor}"
        out.append(f'<li><span class=path-n>{i:02d}</span>'
                   f'<a href="{href}">{esc(title)}</a>'
                   f'<p class=path-why>{esc(why)}</p></li>')
    out.append('</ol></div>')
    return "".join(out)


def act(num: str, title: str, body: str, classes: str = "", margin: bool = False) -> str:
    # One reveal target per act. The hero never reveals: it is the first paint and it is
    # already choreographed on load.
    #
    # `margin` opts the act into the margin column, which reserves 144px of the reading
    # column at 72rem and above. It is opt-in because four acts hold an artifact that is
    # already near its minimum width there: the hero's first screen has no height to spare,
    # the duet's three fields already overlap below about 80rem, and the two identifier
    # tables are set in unbroken mono. Narrowing those buys a margin note and costs a table.
    reveal = "" if num == "00" else " data-reveal"
    inner = "inner inner-margin" if margin else "inner"
    return (f'<section class="act act-{num} {classes}" id="act-{num}" '
            f'aria-labelledby="h-{num}"><div class="{inner}"{reveal}>{body}</div></section>')


# Two markers a body list can carry to say where its fold opens and where it shuts.
# Indices would do the same job and break the first time a line is added above them, which
# is how the last three edits to this file went. A marker moves with the thing it marks.
FOLD_OPEN = "fold-open"
FOLD_SHUT = "fold-shut"


def folded(parts: list, summary: str) -> str:
    """Join an act body, putting everything between the two markers behind a disclosure.

    The page is read by someone who has thirty seconds before they decide, and by someone
    who has an hour because they intend to check it. Those two want opposite things from
    the same document: the first wants the claim, the second wants the fourteen rows under
    it. A fold serves both without shipping two pages, and it costs no script.

    Everything stays in the served HTML, so the no-JavaScript gate still sees it, a find
    on the page still reaches it in Chrome and Firefox, and the contrast gate opens every
    disclosure before it measures anything. What changes is how far a reader scrolls past
    what they did not ask for.

    `FOLD_SHUT` is optional. Without it the fold runs to the end of the body, which is what
    an act that closes on its own artifact wants; with it the act can shut the fold and
    then close the elements that were open around it.
    """
    i = parts.index(FOLD_OPEN)
    parts = [x for x in parts]
    parts.pop(i)
    try:
        j = parts.index(FOLD_SHUT)
        parts.pop(j)
    except ValueError:
        j = len(parts)
    return ("".join(parts[:i])
            + '<details class="fold act-fold"><summary>' + summary + '</summary>'
            + '<div class=fold-body>' + "".join(parts[i:j]) + '</div></details>'
            + "".join(parts[j:]))


def showcase_figure() -> str:
    """The four-stage figure, loaded from the asset directory by path.

    It is CSS and SVG with no script, so it survives the no-JavaScript pass, and it
    reserves its own box, so it costs nothing against the layout-shift budget.

    The control above it stops the figure's four loops. It is a checkbox rather than the
    button this would normally be, and that is the whole reason it works: the figure
    carries no script, and `gateNoJs` flags any element that claims an operable role with
    no script behind it. A `<button aria-pressed>` here would be exactly that claim. A
    checkbox is native, so the browser operates it with every script on the page stripped,
    and one `:checked ~` rule in page.css rests every mark at the position the
    reduced-motion block already authored.

    It sits above the figure rather than inside it because `.calle-showcase` is a scroll
    box at every width (`overflow-x: auto`), and a focus ring drawn 3px outside a control
    inside that box is clipped by it, which `gateKeyboard` measures and fails.

    `aria-label` as well as the visible `<label>`, because an `<input>` has no text of its
    own and the accessible-name check reads the element, not the `for` association.
    """
    spec = spec_from_file_location("showcase", SITE / "showcase.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    label = "Pause the diagram"
    return ('<input type=checkbox class=cs-motion id=cs-motion '
            f'aria-label="{esc(label)}">'
            f'<label class=cs-motion-label for=cs-motion>{esc(label)}</label>'
            + module.showcase_markup())


def callscope_figure(data: dict, lanes: list, headline: str) -> str:
    """The first-screen instrument, loaded from the asset directory by path.

    Same shape as `showcase_figure` above and for the same reason: the figure is a build
    step over the evidence, not a template, and keeping the geometry out of this file
    keeps it next to the comments that justify it.

    It is handed `commit_turns` rather than importing it, because that function is this
    page's own reading of the transcript and there must be exactly one of it. A figure
    that marked a field answered at a different instant from the register two screens
    below it would be two readings of one call, and the difference would be invisible.
    """
    spec = spec_from_file_location("callscope", SITE / "callscope.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.callscope_markup(data["calls"], data["fieldOrder"],
                                   commit_turns, lanes, headline)


_MORNING_CACHE: dict[str, object] = {}


def morning_module():
    """`tools/site/morning.py`, loaded once by path.

    Two pages need it now: the board's own page, and act 00, where a compact copy of the
    same board is the second thing on the first screen. Loading it twice would give two
    module objects and two copies of a stylesheet whose bytes have to stay identical
    across both pages, because the served policy hashes every style block and a hash the
    two pages do not share is a second entry for the same rules.
    """
    if "m" not in _MORNING_CACHE:
        spec = spec_from_file_location("morning", SITE / "morning.py")
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        _MORNING_CACHE["m"] = module
    return _MORNING_CACHE["m"]


def morning_html() -> str:
    """`the-morning.html`, whole, in the same inks and typefaces as everything else.

    Loaded from the asset directory by path for the same reason the two figures are: the
    geometry and the arithmetic behind it belong next to the comments that justify them,
    not inside this file.
    """
    module = morning_module()

    cspec = spec_from_file_location("cutoff", SITE / "cutoff.py")
    cutoff = module_from_spec(cspec)
    cspec.loader.exec_module(cutoff)
    # A clone with no receipts gets the morning board and no cutoff board, rather than a
    # cutoff board drawn over zeroes.
    cut = cutoff.curve(RECEIPTS) if RECEIPTS and RECEIPTS.exists() else {}

    return (
        "<!doctype html><html lang=en>"
        "<meta charset=utf-8>"
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        "<title>One school morning: firstbell</title>"
        '<meta name=description content="The scale of one morning of absence calls, '
        'and the single case a two-bucket system closes without finding the child.">'
        '<link rel=icon href="data:,">'
        f"<style>{css_for_serving(page_css())}</style>"
        f"<style>{module.MORNING_CSS}</style>"
        f"<style>{cutoff.CUTOFF_CSS}</style>"
        "<main>"
        f"{module.morning_markup(_spelled(_recorded_call_total()))}"
        f"{cutoff.cutoff_markup(cut)}"
        "</main>"
        '<script type=module src="morning.js"></script>'
        "</html>")


def page_css() -> str:
    """The whole stylesheet, as one string.

    Two stylesheets, one `<style>`. The figure's rules are scoped under `.calle-showcase`
    and neither file reads the other, so order is not load-bearing; they are concatenated
    rather than linked because a second request for 4 KB costs a round trip the page's
    weight budget was measured without.

    A function rather than a line inside `build`, because the document pages are set in
    the same stylesheet and byte-identical blocks share one hash in the policy. Two copies
    of this expression would eventually differ by a newline and cost a second hash for
    nothing.
    """
    return ((SITE / "page.css").read_text(encoding="utf-8") + "\n"
            + (SITE / "showcase.css").read_text(encoding="utf-8") + "\n"
            + (SITE / "callscope.css").read_text(encoding="utf-8"))


def css_for_serving(css: str) -> str:
    """Drop the stylesheet's comments on the way into the page.

    They are worth keeping in `tools/site/page.css`, where the next person to touch a
    duration or a contrast ratio needs to know why it is that value. They are worth
    nothing in the bytes a reader downloads, and there are a lot of them: 4,976 words,
    which is more than the whole page says out loud. Two things went wrong while they
    shipped. The reader paid for about 25 KB of design reasoning aimed at somebody else,
    and the no-JavaScript gate, which strips `<script>` but not `<style>`, counted every
    one of those words as readable text and reported a page 3.5 times longer than it is.

    Strings are tracked rather than assumed away, because `/*` inside a `content:` value
    is legal and a regex over the whole file would eat the rest of the sheet from there.
    """
    out: list[str] = []
    i, n, quote = 0, len(css), ""
    while i < n:
        c = css[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:      # an escape cannot close the string
                out.append(css[i + 1])
                i += 2
                continue
            if c == quote:
                quote = ""
            i += 1
        elif c in "\"'":
            quote = c
            out.append(c)
            i += 1
        elif c == "/" and css.startswith("/*", i):
            end = css.find("*/", i + 2)
            i = n if end == -1 else end + 2
        else:
            out.append(c)
            i += 1
    # A removed comment leaves its indentation and its blank line behind.
    lines = [ln.rstrip() for ln in "".join(out).splitlines()]
    kept: list[str] = []
    for ln in lines:
        if ln or (kept and kept[-1]):
            kept.append(ln)
    return "\n".join(kept).strip() + "\n"


# ---- the page ---------------------------------------------------------------------------

def build(has_audio: bool, repo_url: str | None = None,
          video_url: str | None = None) -> str:
    data = transcripts()
    # Masked here rather than at each use, so a new surface that reads a call cannot
    # reintroduce a whole identifier by reading the field the old ones read.
    _calls = data.get("calls", {})
    for _call in (_calls.values() if isinstance(_calls, dict) else _calls):
        for _key in ("apiId", "providerId"):
            if _call.get(_key):
                _call[_key] = mask_id(_call[_key])
    # Before anything reads a turn, so the markup here, the island `player.js` reads and
    # the published JSON all carry the same English or the build stops.
    bind_glosses(data)
    recs = receipts()
    muts = mutation_rows()
    recovered = recovered_provider_ids()
    calls = data["calls"]

    # One row per call, not one per mention. Several receipts refer to the same call: the
    # idempotent-replay receipt names a call it deliberately did not place again. Counting
    # mentions made the page claim more calls than were placed, which is exactly the kind of
    # number this page exists to make checkable.
    call_rows = []
    seen: set[str] = set()
    for name, d in recs:
        for item in d.get("items", []):
            cid = item.get("call_id")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            call_rows.append((cid,
                              item.get("provider_call_id") or recovered.get(cid),
                              item.get("resolution"), name,
                              item.get("structured_result") or {}))
    live = [(n, d) for n, d in recs if d.get("reached_production_api")]
    agree = sum(p["agree"] for p in data["pairs"])
    total = sum(p["of"] for p in data["pairs"])

    css = page_css()
    p: list[str] = []
    add = p.append

    add('<!doctype html><html lang=en'
        + (' data-audio=present' if has_audio else ' data-audio=absent') + '>')
    add('<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">')
    # The address bar, in the paper the page is printed on. Everything about this page is
    # one unbroken sheet, and on a phone the browser chrome above it was system grey, which
    # is the join the design spends nine acts not having. The value is computed from
    # `--paper` rather than typed beside it, because two spellings of one colour drift the
    # first time the ground is re-cut.
    add(f'<meta name=theme-color content="{paper_hex(css)}">')
    add('<title>firstbell: it calls the parents who never replied</title>')
    add('<meta name=description content="Software that telephones the families of absent '
        'schoolchildren and refuses to close a case it could not get an answer to. It calls '
        'in whichever language CALL-E offers for that country, which in the United States '
        'today means English. Every claim carries the thing that checks it.">')
    # Without this the browser asks for /favicon.ico on every load and the server answers
    # 404. An empty data URI answers it with nothing, from the document, costing no request.
    add('<link rel=icon href="data:,">')
    add('<link rel=preconnect href="https://use.typekit.net" crossorigin>')
    add('<link rel=preconnect href="https://p.typekit.net" crossorigin>')
    # The three faces that exist above the fold, fetched in parallel with the stylesheet
    # rather than after it. Without this the heading wraps to three lines in the fallback and
    # two in Freight Text Compressed, and the whole hero jumps when the swap lands. Measured:
    # 0.029 of layout shift with the swap, 0.000 with the font host blocked entirely.
    preload = SITE / "kit-preload.json"
    if preload.exists():
        for url in json.loads(preload.read_text(encoding="utf-8")).values():
            add(f'<link rel=preload as=font type="font/woff2" href="{esc(url)}" crossorigin>')
    # The kit ships font-display:auto and neither the API nor a URL parameter changes it, so
    # it is loaded out of the render path and the page paints on metric-matched fallbacks.
    # The onload used to add a `fonts` class to the root as well. Nothing read it: there is
    # no `.fonts` selector in page.css and neither script mentions it. A class on the root
    # invalidates the style of every element under it, so it was paying for a full restyle
    # and buying nothing.
    add(f'<link rel=stylesheet href="{TYPEKIT}" media=print onload="this.media=\'all\'">')
    add(f'<noscript><link rel=stylesheet href="{TYPEKIT}"></noscript>')
    add(f'<style>{css_for_serving(css)}</style>')
    # Byte-identical to the block `the-morning.html` serves, so the derived policy carries
    # one hash for the two pages rather than two. Not folded into `page_css`, because that
    # is also the document pages' stylesheet and none of them holds a board.
    add(f'<style>{morning_module().MORNING_CSS}</style>')

    # ---- rail
    add('<nav class=rail aria-label="Sections"><span class=rail-line aria-hidden=true>'
        '<span class=rail-fill data-rail></span></span><ol>')
    for num, title in ACTS:
        add(f'<li><a href="#act-{num}"><span class=rail-num>{num}</span>'
            f'<span class=rail-label>{esc(title)}</span></a></li>')
    # The through-line: the hero call rides in the rail as a miniature once the page has
    # left the dark, so a reader never loses the object the whole argument is about.
    add('<canvas class=rail-wave data-rail-wave width=96 height=36 aria-hidden=true></canvas>')
    add('</ol></nav>')

    # A keyboard reader met the nine-link rail before every one of the eight acts and had no
    # way past it. The link is the first thing in the tab order and it is invisible until it
    # takes focus, which is the only time it is any use to anybody.
    add('<a class=skip href="#act-00">Skip to the call</a>')

    add('<main id=main>')

    # ---- Act 0: the call
    #
    # One sentence and one object. The sentence is the only prose on this screen and the
    # object is the argument: four real calls in a register, the third of them still
    # running. A judge who reads nothing watches a row fill in and has been told the whole
    # thing.
    #
    # The rows are the English call of each committed scenario pair, in the order the
    # pairs were registered, so which four appear here is decided by the evidence file and
    # not by this template. The live one is the call where the parent had not been told.
    hero = "S-4105"
    rows = [pair["en"] for pair in data["pairs"]]
    cue = cue_for(calls[hero], "left for school")
    # A reader met the first viewport and could not name the product. They were
    # right to be unable to: `firstbell` appeared in the visible text of this page exactly
    # twice, in the browser tab and in a shell command nine screens down. The best sentence
    # in the entry was in README.md and had never been on the page a judge opens first.
    lanes_shown = [
        # The control, and it is the shorter of the two calls. It exists to say that this
        # software does not simply mark everything undetermined, which is one sentence.
        {"id": "S-4101", "label": "the parent knew, and said why",
         "two_bucket": "resolved", "two_bucket_note": "case closed",
         "ours": "resolved",
         "ours_note": "Three fields the office can act on."},
        {"id": "S-4105", "label": "the parent did not know",
         "two_bucket": "resolved",
         "two_bucket_note": "case closed. Reported as a family contacted.",
         "ours": "undetermined",
         "ours_note": "held open and escalated to a named person."},
    ]
    body = [
        '<div class=masthead>',
        '<p class=wordmark>firstbell</p>',
        nav_markup(repo_url, video_url),
        # The first sentence a buyer reads. It used to promise language access, and a
        # director of student services put it plainly: taken to a board, "in the language
        # that family speaks" is a claim a trustee can disprove by reading one page of
        # CALL-E's region table, and the meeting ends there. So the promise came off and
        # the ceiling went on in its place, on the first screen.
        #
        # A district buyer then read the pair and named what the second sentence was
        # spending: the escalation is the half of this product they would be buying, and
        # the first screen gave that space to a platform limit with no demonstration
        # beside it. The promise is gone either way, so there is nothing left up here to
        # qualify, and the ceiling has moved to act 01, one screen down, where it can name
        # the run that shows it. Both sentences now describe what the software does, and
        # the second one is the one nothing else on the market does.
        # One line, not five. The paragraph that was here described what this software
        # does when a call comes back with nothing usable. The screen underneath it now
        # shows that happening, on a real call, with the receipt beside it, and a
        # description sitting on top of a demonstration is the page talking over
        # itself. The full statement moves to act 01, next to the numbers behind it.
        # Measured 2026-09-10 against the entry that won micro1: its whole site was 77
        # visible words on one screen that never scrolled, and this first screen alone was
        # 300. A judge gives thirty to sixty seconds, so a first screen that has to be
        # read scores whatever a skimmed page scores no matter what is proved below it.
        # The budget is now the metric. What was here -- four counters and four cards of
        # prose, both of them descriptions -- moves to act 01, and the demonstration those
        # descriptions were describing comes up here in their place.
        '<p class=standfirst>firstbell places a school’s morning absence calls through '
        'CALL-E, and refuses to close the ones that came back empty.</p>',
        '</div>',
        # The instrument, directly under the one-minute lane it is the evidence for.
        #
        # That lane was four cards of prose. A reader who gave the first screen thirty
        # seconds left with four counters and none of the argument, because the argument
        # is not a number: it is that a call can connect, run longer than the one beside
        # it, and come back with nothing the office can act on. That is a comparison, and
        # a comparison read as prose is four sentences a reader has to hold at once.
        # Drawn, it is two rows of rails and the reader is holding nothing.
        #
        # The cards stay. They are the same four claims in words, above the drawing that
        # shows them, for a reader who would rather read and for one whose browser drew
        # nothing.
        callscope_figure(
            data, lanes_shown,
            'Both came back schema-valid. Only one of them found the child.'),
        # The two links a judge needs are on the first screen, under the thing that
        # earned the click, rather than above it competing with the demonstration.
        # The second object on the first screen, and the second thing a judge can put a
        # hand on. The callscope above it is the call: sixty seconds of one morning, with
        # the audio. This is the morning those two calls came out of, and it turns.
        #
        # Its own page still exists and still holds the arithmetic, the source and the two
        # paragraphs of what the board does not claim. What moved here is the object. A
        # link to a 3D board is a link, and the thing this entry has that the writing
        # cannot carry is that the board answers a drag.
        morning_module().morning_markup(_spelled(_recorded_call_total()), compact=True),
        '<div class=after-minute>',
        video_link_markup(video_url),
        repo_link_markup(repo_url),
        '</div>',
        '<p class=eyebrow>The attendance register, and the calls it is waiting on</p>',
        '<h1 id=h-00>One child is not in the register.</h1>',
        hero_turn_markup(calls[hero]),
        # Four rows, twelve calls, and the page used to say only the first number.
        # Everything else in the entry says twelve, so the first screen was the one place
        # a reader could find the two numbers disagreeing.
        # Six sentences of footnote, about 180 words, on the screen with the tightest
        # word budget on the page. Three of them explained things the acts below explain
        # again with room to do it properly: what CALL-E is, what the three columns are,
        # and the region ceiling. What has to stay here is the pair of numbers a reader
        # would otherwise find contradicting each other nine screens apart, and the
        # consent disclosure, which is not a footnote anywhere.
        #
        # Two tests read this sentence by regular expression, for the count of rows and
        # for the total, so both phrasings are load-bearing and neither may be tidied:
        # see `tests/test_page_prose_counts.py`.
        f'<p class=hero-foot>{_spelled(len(lanes_shown)).capitalize()} calls above, '
        'played from their own recordings. This '
        f'software has placed {_recorded_call_total()} calls against CALL-E in total and '
        'the money is computed over all of them; '
        f'<a href="#act-02">act 02</a> holds both conversations in full. The recordings '
        'are held outside this repository. Every call went to the author’s own line, '
        'scripted and consented, and the pupil names are fictional. '
        '<a href="#act-01">Act 01</a> says what the region ceiling costs, and '
        '<a href="#act-07">act 07</a> is the run that shows it.</p>',
        # What the bar could not link to, at the foot of the act rather than between the
        # bar and the two calls. It is a disclosure, and a disclosure above the thing it
        # discloses about is the page apologising before it has shown anything.
        nav_note_markup(repo_url, video_url),
    ]
    add(act("00", "The call", "".join(body), "hero"))

    # ---- Act 1: the residue
    body = [
        # The counters and the four cards used to open the entry. They are descriptions,
        # and act 00 now shows the thing they were describing, so they sit here instead:
        # one screen down, where a reader who scrolled has asked for the summary rather
        # than been handed it before the argument.
        topline_markup(next((d for name, d in recs if name.startswith("06-")), {})),
        one_minute_markup(next((d for name, d in recs if name.startswith("06-")), {})),
        path_markup(),
        FOLD_OPEN,
        '<div class=split><div class=claim>',
        '<div class=act-num>01</div><h2 id=h-01>The school knew nothing, and had no way to find out.</h2>',
        '<p>An unanswered absence message is not information. It is an absence of '
        'information, and it looks identical whether the child is at home with a fever or '
        'never arrived anywhere.</p>',
        '<p>The call above is the second kind. At '
        f'{cue + 5} seconds a parent learns from a robot that their daughter is not at '
        'school, having watched her leave for it that morning.</p>',
        # Not written for this page. This is what the program prints at the head of its
        # own escalation queue, and it was sitting nine screens below here, in terminal
        # text, as the last thing a reader met. A reader called it the strongest
        # sentence in the entry and reached it after the point they had stopped reading.
        #
        # Lifted out of the run rather than retyped, because retyped is what it was: this
        # said "within 30 minutes." under a line crediting the run, and the run says
        # "within 30 minutes (this project's default, which no district has agreed to)".
        # A page that quotes its own output and cuts the disclaimer out of the quote is
        # doing the thing this entry is about, on the screen most readers never leave.
        f'<p class=stakes>{esc(_stakes_sentence())}</p>',
        '<p class=stakes-src>Printed by the run itself, above the cases it refuses to '
        'close. The whole queue is in act 08.</p>',
        # The platform ceiling, moved off the masthead to sit one screen from the run that
        # demonstrates it. On the first screen it was a limit on a promise the page had
        # already stopped making; here it is a limit with its own receipt in the same
        # sentence, and act 07 is a real call the platform refused in Spanish.
        '<div class=note>Calls go out in whichever language CALL-E offers for the '
        'country. In the United States today that is English, and '
        '<a href="#act-07">act 07</a> holds the refusal, printed by a run a reader can '
        'make on their own machine.</div>',
        '</div><div class=artifact>',
        '<div class=stat-grid>',
    ]
    # One of the four is filled. A grid of four equal numbers makes a reader rank them, and
    # the page already knows the answer: the count of real calls is the number that decides
    # whether the other three are worth reading, so it is the one that carries the field.
    ran, _skipped = _suite_pair()
    for num, label, lead in ((test_count(), f"tests, {ran} of them run here", False),
                             (len(muts), "rules broken on purpose to prove a test notices", False),
                             # Not "each one checkable against CALL-E's billing", which
                             # a reader cannot do: the ids on that table are shortened and
                             # the unshortened list is published nowhere, so only CALL-E can
                             # accept. The count is the part anybody can check, and act 04
                             # says who can match a row.
                             (len(call_rows),
                              "real calls, counted in "
                              "evidence/recorded-calls.json", True),
                             ("none", "CALL-E account needed to run the demo", False)):
        body.append(f'<div class=cell{" data-lead" if lead else ""}>'
                    f'<div class=num>{esc(num)}</div>'
                    f'<div class=lbl>{label}</div></div>')
    body.append('</div></div></div>')
    add(act("01", "What the school knew",
            folded(body, 'Why an unanswered message is not information, and what the '
                         'run prints about this one'),
            margin=True))

    # ---- Act 2: the same call, both languages
    #
    # Scene 2. The hero call again, beside its own Tamil twin, both running from the same
    # moment. The English one is 59.54 seconds and the Tamil one is 109.98, so the two
    # waveforms are visibly different lengths and settle at different times, which is the
    # argument: the conversation is not the same, and the three fields underneath it are.
    en, ta = "S-4105", "S-4106"
    pair = next(q for q in data["pairs"] if q["en"] == en)
    body = [
        '<div class=act-num>02</div><h2 id=h-02>Same call. Whichever language the family speaks.</h2>',
        '<p class=eyebrow>The call from the first screen, beside the same call in Tamil</p>',
        # ---- SHOWCASE INSERTION POINT ------------------------------------------------
        # The figure below is owned by tools/site/showcase.py and tools/site/showcase.css.
        # This file loads it and places it; it does not know how it is drawn. The seam is
        # kept named so the next person editing act 02 can see where the boundary is.
        # ------------------------------------------------------------------------------
        showcase_figure(),
        duet_markup(data, en, ta, has_audio),
        f'<p class=duet-line>Different words, different lengths, '
        f'<b>{pair["agree"]} of {pair["of"]}</b> fields identical.</p>',
        '<p class=dim>There is no Tamil-specific code in this app. Language is one column '
        'in the work file and one string in the request.</p>',
        # Lifted from the sentence directly above it, word for word.
        pull("There is no Tamil-specific code in this app."),
        '<details class=fold><summary>All twelve comparisons, counted before the phone '
        f'rang: {agree} of {total} matched</summary>',
        '<p>Four scenarios, each performed twice, three enumerated fields per pair. The '
        'count was committed before any call was placed, so it could not be chosen '
        'afterwards. All three mismatches are the speaker saying different things in the '
        'two calls, which a person recalling their own script from memory will do.</p>',
        '<table class=pairs>'
        '<caption class=visually-hidden>Each scenario performed once in English and once in Tamil, with whether the two calls agreed on every enumerated field.</caption>'
        '<thead><tr><th scope=col>scenario</th><th scope=col>en-IN</th>'
        '<th scope=col>ta-IN</th><th scope=col>agreed</th></tr></thead><tbody>',
    ]
    # Not `p`: build() holds the page's own parts in `p`, and a loop variable of the same
    # name rebinds it. The page still assembled, because `add` was already bound to the
    # list's append, and then joined the last pair's keys instead: a 16 byte index.html
    # that raised nothing.
    for row in data["pairs"]:
        cls = "ok" if row["agree"] == row["of"] else "part"
        body.append(f'<tr><td>{esc(row["label"])}</td>'
                    f'<td class=mono>{esc(row["en"])}</td>'
                    f'<td class=mono>{esc(row["ta"])}</td>'
                    f'<td class="agree {cls}">{row["agree"]}/{row["of"]}</td></tr>')
    body.append('</tbody></table></details>')
    add(act("02", "Both languages", "".join(body), "act-2"))

    # ---- Act 3: three endings
    #
    # Scene 3. One call, three filings. The call is the one the reader has now watched
    # twice, and the run it belongs to is committed with its counts, so the coverage
    # arithmetic on screen is read out of a receipt rather than argued for.
    run = next(d for name, d in recs if name.startswith("06-"))
    c06 = run["counts"]
    placed = run["calls_placed"]
    open_rows = c06["undetermined"] + c06["failed"]
    body = [
        marginalia("Undetermined",
                   '<p>The <a href="#act-05">mutation table</a> holds the tests that keep '
                   'this distinction from collapsing back into two.</p>'),
        '<div class=act-num>03</div><h2 id=h-03>The third ending is the one everyone gets wrong.</h2>',
        three_endings_figure(),
        '<p class=eyebrow>The same call, filed three ways</p>',
        endings_markup(data, en, run),
        # The pull moves above the fold and the note it quotes moves below it. It is the
        # one sentence in this act a reader has to leave with, and an act that ends on a
        # closed disclosure needs its last visible line to be that sentence.
        pull("This app made the first mistake itself."),
        FOLD_OPEN,
        queue_markup(run),
        '<p class=note>This app made the first mistake itself. A parent refused to talk, '
        'CALL-E returned a schema-valid result with every required field set to '
        '<code>"unknown"</code>, and the row was recorded as resolved. The receipt stays as '
        'it was written, uncorrected, because a corrected copy would record a run that '
        'never happened. What changed is the code, and a test now fails if the distinction '
        'collapses again.</p>',
        # It sent a reader to the evidence page for a receipt not published there. That
        # page carries the recordings and the transcripts of these calls, and no receipt.
        f'<p class=dim>Counts read from one recorded run of {placed} calls, '
        '<code>06-locale-matched-pairs.json</code>, a receipt held outside this repository '
        'and published nowhere, whose counts are committed in '
        '<code>evidence/recorded-calls.json</code>. '
        f'{open_rows} of {placed} rows are still open and every one of them is named. The '
        'rate is resolved over attempted, so an open row can only ever pull it down.</p>',
    ]
    add(act("03", "Three endings",
            folded(body, 'The queue that comes out of it, named, with what each line '
                         'costs'),
            "act-3", margin=True))

    # ---- Act 4: check us
    have = sum(1 for _c, pv, _r, _s, _f in call_rows if pv)
    body = [
        # Act 04 is stacked full-width bands, not a diptych, and the money leads.
        #
        # Three defects came from the diptych, all of them measured on 2026-09-10 and all
        # of them the same shape: a full-width band cannot be a row of a grid whose other
        # rows are sticky. `.split-long > .claim` is `position: sticky`, a sticky grid item
        # is contained by the grid CONTAINER rather than by its own grid area, so the claim
        # column's travel range was the whole split (2774px) minus its own height (1249px).
        # It slid 1,526px down and came to rest sitting on top of the money band, which
        # spans `grid-column: 1 / -1` in row two. 56 occlusion-verified text-on-text
        # conflicts at 1280, 1440 and 1920, zero below 60rem where nothing is sticky.
        #
        # The second defect was the void the same row produced: row one is sized by the
        # claim at 1249px, the artifact beside it is 754px and top-aligned, so column two
        # was blank for 495px. The third was the reading order a buyer meets: the numbers
        # this act exists to be checked against sat under 1,249px of prose about why call
        # identifiers are shortened.
        #
        # Stacking removes all three at once and needs no sticky rule, no `order` override
        # at 60rem, and no full-width row inside a two-column grid. It also gives the
        # twelve-call table the full width it always wanted: the CSS above carries three
        # separate comments about that table's min-content width fighting a 616px column.
        '<div class=band>',
        '<div class=act-num>04</div><h2 id=h-04>Check us against CALL-E&#8217;s own billing.</h2>',
        '<p class=lede>The API returns one identifier and the dashboard is keyed on another. Both are '
        'here, shortened at both ends, alongside the structured answer each call brought '
        'back, so CALL-E can match any row to their own records, which is a source with no '
        'stake in these claims. A reader who is not CALL-E can check the count rather than '
        'the rows: it is committed in <code>evidence/recorded-calls.json</code>, and the '
        'note below says why the identifiers are cut.</p>',
        '</div>',
        # The numbers second, directly under the headline that invites the check. This is
        # the only act a buyer opens the page for and it used to be the part they reached
        # last.
        money_markup(run),
        FOLD_OPEN,
        '<div class=band>',
        '<div class=scrollbox tabindex=0 role=region '
        'aria-label="Every call in this run, with its identifiers and fields. '
        'Scrolls sideways on a narrow screen.">'
        '<table class=ids role=table>'
        '<caption class=visually-hidden>Every call placed, with the identifier the API returned, the identifier the billing dashboard is keyed on, and what CALL-E gave back.</caption>'
        '<thead role=rowgroup><tr role=row>'
        # Both identifiers in one column, stacked. Two columns of masked ids set a
        # min-content width of 716px in a column that is 616px wide at 1440 and 404px at
        # 1152, so the last column sat past the scroll edge. They belong together anyway:
        # a reader checking one call against the billing panel wants that call's two
        # names one under the other, not two columns apart.
        '<th scope=col role=columnheader>call id (API, then dashboard)</th>'
        # A break opportunity after each underscore, so `parent_confirmed_aware` breaks
        # where a reader would break it rather than mid-word. `<wbr>` adds nothing to the
        # text a screen reader or a copy takes, and it is the difference between a heading
        # that reads and a heading rendered two characters to a line.
        + "".join(f'<th scope=col role=columnheader>{esc(f).replace("_", "_<wbr>")}</th>'
                  for f in data["fieldOrder"])
        + '<th scope=col role=columnheader>outcome</th></tr></thead>'
        '<tbody role=rowgroup>',
    ]
    for call_id, provider, resolution, _src, fields in call_rows:
        cls = {"resolved": "resolved", "undetermined": "undetermined"}.get(resolution or "", "failed")
        # The dashboard id on the second line, in the secondary ink. Nothing labels the
        # two lines inside the cell, because the head names them in order and their shapes
        # differ: the API's identifier carries the `call_` prefix it is issued with, and
        # the billing panel's is bare hexadecimal.
        pv = (f'<span class="mono second">{esc(mask_id(provider))}</span>'
              if provider else '<span class=dim>not recorded</span>')
        # `data-label` is what each cell prints in front of itself once the column heads
        # are gone, which is the shape this table takes in a container too narrow for it.
        cells = "".join(
            f'<td role=cell data-field="{esc(f)}" data-label="{esc(f)}">'
            + (esc(fields[f]) if fields.get(f) else '<span class=dim>&#183;</span>')
            + '</td>'
            for f in data["fieldOrder"])
        # The same break opportunity in the identifier, after the `call_` prefix every
        # one of them carries. Two lines instead of ten.
        # Both identifiers inside one element. Where this cell is laid out as a grid,
        # which is what it becomes in a container too narrow for a table, every child is
        # an item of that grid: a bare identifier, a `<br>` and a span are three items and
        # the second identifier ends up in the column the label occupies.
        body.append('<tr role=row><td role=cell class=mono data-label="call id">'
                    '<span class=ids-pair>'
                    + esc(mask_id(call_id)).replace("_", "_<wbr>")
                    + f'<br>{pv}</span></td>'
                    f'{cells}'
                    f'<td role=cell data-label=outcome>'
                    f'<span class="state state-{cls}">{esc(resolution)}</span>'
                    + _closed_on_nothing_mark(resolution, fields, data["fieldOrder"])
                    + '</td></tr>')
    body.append('</tbody></table></div>')
    # The count a reader can check without reading a single row, set immediately under the
    # rows it counts rather than in a column beside them.
    body.append(f'<p class=band-count>{len(live)} of {len(recs)} committed receipts reached '
                f'the production API and {have} of {len(call_rows)} calls carry the provider '
                'identifier. The rest had it recovered afterwards with a <code>GET</code>, '
                'which places no call.</p>')
    body.append('</div>')
    body.append('<div class="band band-fine">')
    # Why the identifiers are cut, what is held where, and who requires it. Every word of
    # it was in this act before; it is set after the evidence rather than in front of it,
    # because it answers a question a reader only has once they have seen the rows.
    body.append(
        '<p class=note>The identifiers are shortened on purpose. A live call id is not a '
        'credential, because another account&#8217;s key cannot read our call, but it is an '
        'artifact of a real call to a real number and this repository asks contributors to '
        'keep those out of what they publish. CALL-E hold the billing records this table '
        'invites a check against and can match a row from what is shown; the unshortened '
        'list travels with the submission rather than on a public page.</p>'
        '<table class=compliance>'
        '<caption class=visually-hidden>What this repository holds, and what is held outside it.</caption>'
        '<tbody>'
        '<tr><td>transcripts, waveforms, the audio, and the unshortened identifiers</td>'
        '<td class=dim>not in the repository. On this page'
        + (' in full' if has_audio else ' without the audio')
        + ', apart from the identifiers, which are shortened</td></tr>'
        '<tr><td>the rules those calls produced, and the tests that hold them</td>'
        '<td class=ok>in the repository</td></tr>'
        '</tbody></table>'
        '<p class=note>The maintainer of this list requires committed real-call artifacts '
        'to be removed, and has said so even where the people on the call were team members '
        'playing a part on reserved numbers, which describes these calls exactly. So the '
        'recordings live here, the reasoning lives there, and '
        '<code>tests/test_privacy.py</code> fails the build if one crosses over.</p>')
    body.append('</div>')
    add(act("04", "Check us against your billing",
            folded(body, f'Every one of the {_spelled(len(call_rows))} calls, with both '
                         'identifiers, and what is held where')))

    # ---- Act 5: mutations
    body = [
        '<div class="split split-long"><div class=claim>',
        '<div class=act-num>05</div><h2 id=h-05>Every rule, broken on purpose.</h2>',
        '<p>A test that has never been observed to fail has not been shown to test anything. '
        'Each row is a change made to working code to check that a specific test notices. '
        'Every one was reverted and the suite returned to green.</p>',
        '<div class=note>Number 18 found a live defect rather than confirming a rule. '
        '<code>reached_production_api</code> was computed from the configured base URL alone, '
        'so a run whose every attempt died at the transport layer would still have published '
        'that it reached production.</div>',
        mutation_distribution(muts),
        '</div><div class=artifact>',
        FOLD_OPEN,
        '<div class=scrollbox tabindex=0 role=region '
        'aria-label="Every gate broken on purpose, with the number of tests that '
        'noticed. Scrolls sideways on a narrow screen.">'
        '<table class=mutations>'
        '<caption class=visually-hidden>The changes worth reading first, each made to working code on purpose, with the number of tests that noticed.</caption>'
        '<thead><tr><th scope=col>#</th><th scope=col>the change</th>'
        '<th scope=col>tests that failed</th></tr></thead><tbody>',
    ]
    lead = [row for row in muts if row[0] in LEAD_MUTATIONS]
    rest = [row for row in muts if row[0] not in LEAD_MUTATIONS]
    for num, change, caught in lead:
        body.append(f'<tr><td class=dim>{esc(num)}</td>'
                    f'<td><p class=mut-plain>{esc(LEAD_MUTATIONS[num])}</p>'
                    f'<p class=mut-code>{esc_code(change)}</p></td>'
                    f'<td class="mono caught">{esc(caught)}</td></tr>')
    body.append('</tbody></table>')
    body.append(
        f'<details class=fold><summary>The other {len(rest)}, in the same shape</summary>'
        '<table class=mutations>'
        '<caption class=visually-hidden>The rest of the changes, in the same shape: what was altered, and how many tests noticed.</caption>'
        '<thead><tr><th scope=col>#</th><th scope=col>the change</th>'
        '<th scope=col>tests that failed</th></tr></thead><tbody>')
    for num, change, caught in rest:
        body.append(f'<tr><td class=dim>{esc(num)}</td><td>{esc_code(change)}</td>'
                    f'<td class="mono caught">{esc(caught)}</td></tr>')
    body.append('</tbody></table></details>')
    body.append(FOLD_SHUT)
    body.append('</div></div></div>')
    # The first sentence of the claim above, word for word. It closes the act at full width
    # rather than sitting in the 26rem claim column, where the display face would break one
    # sentence over six lines.
    body.append(pull("A test that has never been observed to fail has not been shown to "
                     "test anything."))
    add(act("05", "Every rule, broken",
            folded(body, f'All {len(muts)} changes, and the tests that caught each one'),
            "act-2"))

    # ---- Act 6: take-aways
    # "Three outcomes, not two" used to be the first of these. Act 3 now plays it, and a
    # take-away restating the scene two screens above it is the page making its strongest
    # argument twice and being believed once.
    # Counted off the table this page already renders, never typed beside it. This card read
    # "Eighteen deliberate changes ... eighty-eight passing tests" while sitting three screens
    # under a counter reading 116, on a page whose entire argument is that its numbers are
    # counted rather than asserted. A reviewer found that before we did, which is the correct
    # outcome for a page like this one and an embarrassing one for a card like that one.
    _muts = mutation_rows()
    # The rows no test caught. There is exactly one today, and it is the row worth the space:
    # the gate that should have caught it had been scoped past a whole directory, so the
    # number it was guarding had never been inside its file set at all.
    _uncaught = [row for row in _muts if row[2] == "0"]
    _uncaught_line = (
        f"Row {_uncaught[0][0]} is the one no test caught, and finding out why is what this "
        "table is for."
        if len(_uncaught) == 1
        else f"{len(_uncaught)} of them were caught by nothing, and each one is a gate that "
             "was not guarding what it claimed to."
    ) if _uncaught else "Every one of them was caught by a test that already existed."
    takes = [
        ("Record the identifier the vendor is keyed on",
         "The id an API returns and the id its billing page shows are not always the same "
         "one. Recording only the first makes a receipt uncheckable by anyone outside the "
         "repository that wrote it."),
        ("Break a rule to prove a test catches it",
         f"{len(_muts)} deliberate changes, each reverted, each recorded with the number of "
         f"tests that failed. {_uncaught_line}"),
    ]
    # The two take-aways sit on the one dark ground the page has. Nine acts of cream with
    # nothing to break them is what a reader means by a page that reads long, and this is
    # the act where a break costs nothing: it holds no artifact, no table and no control, so
    # a plate that flips every ink inside it can be checked in one place.
    body = [
        # Counted, like the card below it and the counter three acts above it. This margin
        # note was the third place on one page that stated the size of the same table, and
        # the only one still saying eighteen.
        marginalia("Shown in act 05",
                   f'<p>The <a href="#act-05">mutation table</a> is {len(_muts)} deliberate '
                   f'changes and the tests that caught each one.</p>'),
        '<div class=act-num>06</div><h2 id=h-06>Two things worth taking, whatever you are building.</h2>',
        '<div class=plate-royal><div class=takes>',
    ]
    for i, (title, text) in enumerate(takes, 1):
        body.append(f'<div class=take><div class=take-n>{i:02d}</div>'
                    f'<h3 class=take-t>{esc(title)}</h3><p>{text}</p></div>')
    body.append('</div></div>')
    add(act("06", "Two things to take", "".join(body), margin=True))

    # ---- Act 7: what is not true
    limits = [
        # First, because it is the one a district decides on. It was in neither this list
        # nor the locale document's own "Where this evidence stops" for a fortnight, while
        # the first sentence of this page sold calling a family in their own language and
        # every figure priced on it was American. A reader who finds this in
        # `calle_double/regions.py` before finding it here stops trusting the other four.
        ("CALL-E offers English and no other language in the United States. Every figure "
         "priced on this page is American, and the language column cannot be delivered to "
         "a United States number today. The twelve real calls went to Indian numbers, "
         "where Tamil and Hindi are available.",
         "Nothing in this app changes it. Run "
         "`python -m firstbell --work-file examples/absences-oneroster.csv` and "
         "the second row prints the refusal in the platform's own words. Until it changes, "
         "the part of this that works in a United States district is the three outcomes, "
         "the consent gate and the structured reason, over whichever dialler the district "
         "already owns. That is a command and not a consolation: "
         "`python tools/adopt_call_records.py --records "
         "examples/other-dialler-records.jsonl --consent-register "
         "examples/other-dialler-consent.json` files six calls this software never "
         "placed, says why each landed where it did, and audits all six against the "
         "district's own consent register. One of them carries a transcript in which a "
         "parent says plainly that the child is at home with her, and it still goes to a "
         "person, because reading a guardian’s confirmation out of prose is the "
         "defect this entry was built to catch wearing better clothes. "
         "It also narrows the ceiling above: it binds while CALL-E places the call, and a "
         "district with Spanish-speaking families can keep the multilingual dialler it "
         "already pays for and take this layer over what that dialler returns. Nothing in "
         "that tool reads the language of a call, because it never reads the call."),
        ("Calls to India arrived from a United States caller identity, shown as Oakland, "
         "California. A family will not answer an unknown foreign number about their child.",
         "Fixable by the operator with a local number on the account. Nothing in this app "
         "changes it."),
        ("CALL-E has no cancel endpoint. Once a call is placed there is no route to stop it.",
         "The concurrency cap is the only brake that exists, so it is set low and the run "
         "reports what was already in flight when a stop was requested."),
        ("The agent does not enforce its own exit. On one call it announced it was ending, "
         "then restarted its opening disclosure.",
         "Reported to the vendor. The transcript is committed."),
        ("The locale result rests on one bilingual speaker who knew what was being tested, "
         "one language pair and one region.",
         "It is a pilot, and it is written up as one. The pre-registered comparison count is "
         "committed so nobody has to take the framing on trust."),
    ]
    body = [marginalia("Read this one first",
                       '<p>A page that names its own limits is easier to check than one '
                       'that does not. The first one is the one a district decides on, and '
                       'three of these belong to the platform.</p>'),
            '<div class="split split-long"><div class=claim>',
            '<div class=act-num>07</div><h2 id=h-07>What is not true.</h2>',
            f'<p>{_spelled(len(limits)).capitalize()} limits, each with what would '
            'close it. Three of them are the platform’s and are reported here without '
            'complaint, because a limit you can read is worth more than a claim you '
            'cannot check.</p>',
            '</div><div class=artifact>', FOLD_OPEN, '<ul class=limits>']
    # `esc_code` and not `esc`. These two strings carry commands a reader is meant to run,
    # and under plain `esc` the markup around them was escaped, so act 07 shipped a literal
    # ``python -m firstbell ...`` on the page the page itself labels read this one
    # first. The helper escapes and then promotes backticks, so nothing raw can get through
    # and the commands still render. Same helper the mutation table uses, for the same reason.
    for limit, closes in limits:
        body.append(f'<li><p class=limit>{esc_code(limit)}</p>'
                    f'<p class=closes>{esc_code(closes)}</p></li>')
    body.append('</ul>')
    body.append(FOLD_SHUT)
    body.append('</div></div>')
    add(act("07", "What is not true",
            folded(body, f'{_spelled(len(limits)).capitalize()} limits, and what would '
                         'close each one'),
            "act-deep", margin=True))

    # ---- Act 8: close
    body = [
        marginalia("No account needed",
                   '<p>The local double is an <code>httpx</code> transport, so the offline '
                   'path runs the same SDK code the live one does. Nothing here places a '
                   'telephone call.</p>'),
        '<div class=act-num>08</div><h2 id=h-08>Run the whole thing with no account.</h2>',
        '<p>No API key, no signup, no telephone call. The local double is mounted as an '
        '<code>httpx</code> transport underneath a real <code>calle.CalleClient</code>, so '
        'the offline path exercises the same SDK code as the live one.</p>',
        # The directory, because neither line runs from the root of a fresh clone and
        # the page said nothing about where to be. The same defect the take-away card had,
        # on the command this act is named after.
        # Focusable and named, the same way the run console below it is. A block that
        # scrolls sideways and cannot take focus is unreachable by keyboard, and this one
        # holds the command the act is asking a reader to run. `page.css` already lists
        # `pre:focus-visible` in the shared focus ring, so the ring was written expecting
        # this element to be focusable, and this was the only `<pre>` on the page that was
        # not.
        '<pre tabindex=0 role=region aria-label="The commands, verbatim. Scrolls sideways '
        'on a narrow screen.">cd apps/python/firstbell\n'
        'pip install -r requirements-dev.txt\n'
        'python -m firstbell --work-file examples/absences.csv</pre>',
        # The instruction used to name a button that no longer exists, and before that it
        # was the only thing telling a reader why the block below was empty. The block
        # ships whole now, so the instruction is about the optional part.
        FOLD_OPEN,
        '<p class=dim>Produced by running exactly that when this page was built, and it '
        'is all below. Watch it run to see the rows land one at a time.</p>',
        # The interactive surface, and the evidence, are one element. `console.js` reads
        # this block's own text and decides when each line appears; it never holds a copy.
        # With JavaScript off the whole run is already on the page and the controls do
        # nothing, which is the right way round for a block whose value is that it is
        # verbatim.
        '<div class=runbox data-run>',
        '<div class=runbar>'
        '<span class=switch role=group aria-label="The offline run">'
        '<button type=button data-run-play>Run it</button>'
        '<button type=button data-run-skip aria-label="Show the whole run at once">'
        'All of it</button>'
        '</span>'
        '<span class=dim>&#8202;the real output of the command above, '
        'verbatim</span>'
        '</div>',
        '<pre class=run data-run-out tabindex=0 role=region aria-live=off '
        'aria-label="What the offline run prints, verbatim. Scrolls sideways on a narrow '
        'screen.">' + esc(offline_run()) + '</pre>',
        '<div class=runlegend data-run-legend></div>',
        '</div>',
        FOLD_SHUT,
        # Where to get it, for a reader who has just been told twice to run it. This is
        # empty on a build that carries both links, because then the masthead has them.
        where_it_lives(repo_url, video_url),
    ]
    add(act("08", "Run it yourself",
            folded(body, 'Watch that exact command run, line by line'),
            margin=True))

    add(further_markup())
    add('</main>')
    # The build's own provenance. The previous footer said "if the repository changes,
    # this page changes with it", which is a claim the page cannot make about itself: a
    # deployed copy goes stale the moment the next commit lands, and this one did, telling
    # readers 88 tests and 18 mutations while the repository said otherwise. A commit and a
    # date can be checked. A promise about future rebuilds cannot.
    # The same reserve the acts take, so the closing plate ends on the line every act
    # above it ends on rather than 144px past it.
    add('<footer><div class="inner inner-margin"><div class=plate-royal>'
        f'<p>Built from <code>{build_commit()}</code> on {build_date()} by '
        '<code>tools/judge_page.py</code>, which reads the numbers rather than being told '
        'them. If that commit is not the tip of the branch, this page is behind it, and '
        'you can see that for yourself rather than being told. Contrast is measured by '
        '<code>tools/check_contrast.py</code>, which reports the pairs it could not measure '
        'so that an unmeasured pair cannot read as a pass.</p>'
        + video_link_markup(video_url) + repo_link_markup(repo_url)
        + '</div></div></footer>')

    add(f'<script id=call-data type=application/json>{script_json(data)}</script>')
    add(f'<script src="{LENIS[0]}" integrity="{LENIS[1]}" '
        f'crossorigin=anonymous defer></script>')
    add('<script type=module src="app.js"></script>')
    # Its own module rather than a call from app.js, because app.js owns the player and
    # the rail and a failure there should not take the run block with it. It mounts
    # itself: an inline module would need a hash in the derived Content-Security-Policy,
    # and a policy that has to grow a hash for every small script is a policy somebody
    # eventually widens.
    add('<script type=module src="console.js"></script>')
    # The board mounts itself off `[data-mrn-stage]`, the same way it does on its own
    # page, and returns without touching the document when that element is absent. Last,
    # after the player and the run block, because a WebGL context is the most expensive
    # thing on this page and nothing above it waits on one.
    add('<script type=module src="morning.js"></script>')
    # The animation and the script that decides whether to play it. Both are deferred and
    # both come after app.js, because the figure is nine screens down and nothing above it
    # waits on either. Served from this origin rather than a CDN, so the derived policy
    # covers them under 'self' and there is no third party in the path of a page about
    # children.
    #
    # There is no figure player any more. The three-endings figure was the only thing that
    # needed one, and it is CSS now, so `figure.js`, `figure-data.js` and the 45.6 KB
    # `lottie_light.min.js` it fetched have all left the page. That is one fewer script,
    # one fewer request and one fewer third party in the path of a page about children.
    add('</html>')
    return "".join(p)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out", nargs="?", default="out", help="output directory")
    ap.add_argument("--audio-dir", default=None,
                    help="directory holding <row-id>.m4a clips, outside this repository")
    ap.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"),
                    help="directory holding the call recordings, outside this repository")
    ap.add_argument("--video-url", default=os.environ.get("FIRSTBELL_VIDEO_URL"),
                    help="the published demo video, once it is on YouTube or Vimeo")
    ap.add_argument("--repo-url", default=os.environ.get("FIRSTBELL_REPO_URL"),
                    help="public URL of the source repository. Omitted rather than "
                         "guessed: a link to a repository that is not published yet "
                         "is worse than no link at all")
    ap.add_argument("--repo-ref", default=os.environ.get("FIRSTBELL_REPO_REF", "HEAD"),
                    help="the branch or commit the published tree is read at. HEAD is "
                         "the forge's own default branch, which is right after a merge "
                         "and wrong while the work is still on a branch")
    args = ap.parse_args()

    # No recordings, no page, and no half-built one either. This tool turns recordings into
    # a published page, and the recordings are not in this repository on purpose. Building
    # something with the real-call sections quietly missing would put a page in front of a
    # reader that looks complete and is not, which is the failure this whole project is
    # about. So it says what is missing and stops.
    global RECEIPTS
    if not args.receipts:
        print(TROUBLE)
        return 3
    RECEIPTS = Path(args.receipts).resolve()
    if not RECEIPTS.is_dir():
        print(f"--receipts {RECEIPTS} is not a directory")
        return 3
    if not sorted(RECEIPTS.glob("0*.json")):
        print(f"--receipts {RECEIPTS} holds no receipt files matching 0*.json")
        return 3

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    audio = Path(args.audio_dir).resolve() if args.audio_dir else None
    clips: list[Path] = sorted(audio.glob("*.m4a")) if audio and audio.is_dir() else []
    if audio and not clips:
        print(f"--audio-dir {audio} holds no .m4a files; building the no-audio page")
    has_audio = bool(clips)

    if has_audio:
        dest = out / "audio"
        dest.mkdir(exist_ok=True)
        for clip in clips:
            shutil.copy2(clip, dest / clip.name)

    # There is no video input, on purpose. A recorded screen capture is the same clip that
    # sits on a video platform, and reposting it here would make this page a second place to
    # watch one file. What the page shows instead is drawn from the run itself: the register
    # plays, the waveform is the audio, and the figure in act 02 is the system's shape. All
    # of it is built rather than filmed, so it stays true when the code changes.
    for asset in ("app.js", "player.js", "console.js", "morning.js"):
        shutil.copy2(SITE / asset, out / asset)

    # The Lottie the film takes is still built during this run, and it is no longer copied
    # into the page build: nothing on the page reads it, and neither the vendored player
    # nor the data script ships any more.
    #
    # It keeps being generated here rather than committed because it is derived from the
    # stylesheet's own inks, and a drawing checked into a tree is a drawing somebody
    # exported once. A checkout without python-lottie simply does not get it, which is the
    # honest outcome now that no page depends on it.
    try:
        sys.path.insert(0, str(APP / "tools"))
        import make_figure

        make_figure.write(SITE / "figures")
    except Exception:
        pass

    page = out / "index.html"
    markup = build(has_audio, args.repo_url, args.video_url)
    page.write_text(markup, encoding="utf-8", newline="\n")

    # Every document in `doc_pages.PUBLISHED`, rendered rather than retyped, in the page's
    # own inks. They are what a reader who will not clone a repository can still read:
    # the pilot shape, the file a district already exports, the legal surface, the
    # consent record, and the four that say how the evidence itself was made. The count
    # used to be written here and was wrong twice, which is what a number kept beside a
    # list rather than read from it does.
    docs = doc_pages.write_all(out, css_for_serving(page_css()),
                               args.repo_url, args.repo_ref)

    # The room next door. The first screen is two calls and the sound of them; this is the
    # scale of the morning they came out of, and it is one click away rather than below
    # the fold, which is where the entry that won micro1 kept its own three-dimensional
    # page. It is written here, beside the documents, because it is a served page and has
    # to be in the policy union below for its style block to be allowed at all.
    morning_page = out / "the-morning.html"
    morning_page.write_text(morning_html(), encoding="utf-8", newline="\n")
    docs = [*docs, morning_page]

    # The policy is derived from the bytes above rather than kept beside them, so the two
    # cannot disagree. Written after the pages for the same reason: there is nothing to
    # describe until they exist. Every page the deployment serves goes in, because the
    # header is set on `/(.*)` and a policy that fits one of six is wrong for five.
    (out / "vercel.json").write_text(
        deployment_config(markup, *(d.read_text(encoding="utf-8") for d in docs)),
        encoding="utf-8", newline="\n")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"{page}  {page.stat().st_size / 1024:.1f} KB")
    print(f"audio: {len(clips)} clips" if has_audio else "audio: none, page says why")
    print(f"total output: {total / 1024:.0f} KB across "
          f"{sum(1 for f in out.rglob('*') if f.is_file())} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
