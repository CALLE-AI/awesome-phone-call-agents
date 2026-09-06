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
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
EVIDENCE = APP / "evidence"
# Where the call recordings are read from, set by main(). Deliberately not a path inside
# this repository: the recordings are held outside it, for the reason evidence/README.md
# gives, so this tool takes a directory the way it already takes --audio-dir.
RECEIPTS: Path | None = None

TROUBLE = """Nothing to build from.

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
    """Escape, then turn markdown code spans into real ones.

    The mutation table is lifted out of MUTATIONS.md, where identifiers are wrapped in
    backticks. Rendering those literally puts a row of stray punctuation on the page for
    every mutation. Escaping runs first, so the only thing this can introduce is the code
    tag itself.
    """
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", esc(value))


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
    return f"{head}{sep}{body[:keep]}…{body[-keep:]}"


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

def player_markup(ids: list[str], data: dict, cue: int, has_audio: bool) -> str:
    """One player, switching between the calls in `ids`.

    The result block renders filled at first paint and only dims during playback. Starting it
    empty would hide committed evidence behind an interaction, and would show blank rows to
    anyone with JavaScript off.
    """
    first = data["calls"][ids[0]]
    out = [f'<div class=player data-player="{esc(",".join(ids))}" data-cue="{cue}" '
           f'data-playing=false>']

    out.append('<div class=transport>')
    if has_audio:
        out.append(
            '<button class=play data-play type=button aria-label="Play this call">'
            '<svg class=i-play viewBox="0 0 12 14" aria-hidden=true><path d="M0 0l12 7-12 7z"/></svg>'
            '<svg class=i-pause viewBox="0 0 12 14" aria-hidden=true>'
            '<path d="M0 0h4v14H0zM8 0h4v14H8z"/></svg></button>')
        out.append(f'<span class=cue>Listen from {cue // 60}:{cue % 60:02d}</span>')
    else:
        out.append('<p class="cue no-audio">The recordings are not in this repository, '
                   'because the contribution checklist asks contributors not to commit call '
                   'recordings. Every word below is the transcript CALL-E returned, and the '
                   'shape is measured from the audio.</p>')
    out.append('<span class=switch role=group aria-label="Language">')
    for rid in ids:
        c = data["calls"][rid]
        out.append(f'<button type=button data-switch="{esc(rid)}" aria-pressed=false>'
                   f'{esc(c["locale"])}</button>')
    out.append('</span></div>')

    out.append('<div class=stage>')
    # Blank and silent until a script can stand behind it. Clicking the waveform seeks,
    # and seeking moves the transcript highlight with or without a recording, so it is a
    # control and a keyboard has to reach it. All of that is player.js. Served on its own
    # it draws nothing and does nothing, so announcing it as a slider here would be telling
    # a reader without JavaScript that arrow keys work when they do not. CallPlayer.upgrade
    # adds the role, the tab stop and the value, in the same breath as the key handler.
    out.append('<canvas data-waveform aria-hidden=true></canvas>')
    out.append(turns_markup(call))
    out.append('</div>')

    out.append('<div class=result data-result data-state=in>')
    out.append('<h3>What CALL-E returned</h3>')
    out.append('<p class=note-free data-note>' + esc(first.get("note") or "") + '</p>')
    out.append('<dl>')
    for field in data["fieldOrder"]:
        out.append(f'<dt>{esc(FIELD_LABEL[field])}</dt>'
                   f'<dd data-field="{esc(field)}">{esc(first["structured"].get(field, "·"))}</dd>')
    out.append('</dl>')
    conf = first.get("confidence")
    if conf is not None:
        out.append(f'<p class=conf>completion confidence <b data-conf>{esc(conf)}</b></p>')
    out.append('</div></div>')
    return "".join(out)


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
        out.append(
            '<button class=play data-play type=button aria-label="Play this call">'
            '<svg class=i-play viewBox="0 0 12 14" aria-hidden=true><path d="M0 0l12 7-12 7z"/></svg>'
            '<svg class=i-pause viewBox="0 0 12 14" aria-hidden=true>'
            '<path d="M0 0h4v14H0zM8 0h4v14H8z"/></svg></button>')
    out.append(f'<span class=scene-clock data-clock>0:00 / {mins}:{secs:02d}</span>')
    # Served hidden, and CallPlayer.upgrade shows it, for the same reason the canvas is
    # served without its slider role: with no script there is no scene to play again, and a
    # button that answers nothing is the page making a promise it cannot keep. It is in the
    # markup rather than built in JavaScript so that its words live with the rest of them.
    out.append('<button class=replay type=button data-replay hidden>'
               'Play the call again</button>')
    out.append('</div>')
    out.append('<ol class=turns data-turns aria-live=off tabindex=0 '
        'aria-label="What was said on the call, turn by turn. Scrolls, so it takes '
        'focus and answers the arrow keys.">')
    for turn in call["turns"]:
        who = "agent" if turn["speaker"] == "bot" else "parent"
        m, s = divmod(int(turn["offset_seconds"]), 60)
        out.append(
            f'<li data-at="{int(turn["offset_seconds"])}" data-who="{esc(turn["speaker"])}" '
            f'data-rel=ahead><span class=turn-at>{m}:{s:02d}</span>'
            f'<span class=turn-who>{who}</span>'
            f'<span class=turn-text lang="{esc(call["locale"])}">{esc(turn["text"])}</span></li>')
    out.append('</ol>')
    # Two claims the scene would otherwise make silently. Both are cheaper to print than to
    # be caught on: a judge who works out either of them for themselves stops believing the
    # rest of the page, and this one is built entirely out of things that can be checked.
    out.append(f'<p class=scene-note>The {mins}:{secs:02d} recording, played at its own '
               'speed with silences over 1.5 seconds shortened; the timestamps are CALL-E’s. '
               'Each field is marked at the answer it came from. CALL-E returned all three '
               'together when the call ended.</p>')
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
        who = "agent" if turn["speaker"] == "bot" else "parent"
        m, s = divmod(int(turn["offset_seconds"]), 60)
        out.append(
            f'<li data-at="{int(turn["offset_seconds"])}" data-who="{esc(turn["speaker"])}" '
            f'data-rel=ahead><span class=turn-at>{m}:{s:02d}</span>'
            f'<span class=turn-who>{who}</span>'
            f'<span class=turn-text lang="{esc(call["locale"])}">{esc(turn["text"])}</span></li>')
    out.append('</ol>')
    return "".join(out)


def lane_markup(data: dict, cid: str, label: str) -> str:
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
               f'<span class=scene-clock data-clock>0:00 / {mins}:{secs:02d}</span></div>')
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
    out.append(lane_markup(data, en, "English"))
    out.append(lane_markup(data, ta, "Tamil"))
    out.append('</div>')
    out.append('<div class=duet-bar>')
    # Served hidden for the same reason the hero's replay is: with no script there is no
    # scene to play again, and a button that answers nothing is a promise the page cannot
    # keep. app.js shows it once both lanes are real players.
    out.append('<button class=replay type=button data-replay-group=duet hidden>'
               'Play both again</button>')
    out.append(f'<span class=duet-len>{en_c["seconds"]:.0f}s and '
               f'{ta_c["seconds"]:.0f}s of real recording, each played at its own speed '
               'with silences over 1.5 seconds shortened</span>')
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
    out.append(f'<p class=tally-head>One committed run. {placed} calls placed, '
               f'{resolved} answered.</p>')
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


def content_security_policy(page: str) -> str:
    """The policy this exact page needs, and nothing wider.

    Two allowances here read as concessions and are worth stating plainly rather than
    hiding in a header. `'unsafe-hashes'` appears because the page carries one event
    handler and two style attributes; it does not relax anything on its own, it only lets
    the hashes beside it match in an attribute position, so the sole handler a browser will
    run is the exact string `this.media='all'`. It is written into script-src and style-src
    rather than the -attr variants because Safari shipped the -attr variants late, and a
    policy that silently stops applying on one browser is worse than one that is explicit.
    """
    style_blocks = re.findall(r'''<style\b[^>]*>(.*?)</style>''', page, re.S)
    style_attrs = [v for _, v in re.findall(r'''\sstyle=(["'])(.*?)\1''', page, re.S)]
    handlers = [b for _, _, b in re.findall(r'''\son([a-z]+)=(["'])(.*?)\2''', page, re.S)]

    scripts = _sources(page, r'''<script[^>]*\bsrc=["']?([^"'\s>]+)''')
    sheets = _sources(page, r'''<link[^>]*rel=["']?stylesheet["']?[^>]*\bhref=["']?([^"'\s>]+)''')
    fonts = _sources(page, r'''<link[^>]*(?:as=font|rel=preconnect)[^>]*\bhref=["']?([^"'\s>]+)''')

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


def security_headers(page: str) -> list[dict[str, str]]:
    """Every response header the deployment sets, in the order they are written out."""
    return [
        {"key": "Content-Security-Policy", "value": content_security_policy(page)},
        # The page serves one HTML file, two modules, a stylesheet and eight audio clips,
        # every one of them with a correct type. Nothing here needs a browser to guess.
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


def deployment_config(page: str) -> str:
    """The Vercel configuration, serialised the way the built page is: derived, then written."""
    config = {
        "$schema": "https://openapi.vercel.sh/vercel.json",
        "headers": [{"source": "/(.*)", "headers": security_headers(page)}],
    }
    return json.dumps(config, indent=2) + "\n"


def repo_link_markup(repo_url: str | None) -> str:
    """The source link, or nothing.

    This page argues that every number on it can be checked, and until now it offered no
    way to leave: nine links, every one an in-page anchor. The reason it had none is that
    the branch is not pushed, and a link to a repository that does not exist yet is worse
    than no link, so the URL is a build input rather than a constant. Rebuild with
    `--repo-url` once there is something to point at.
    """
    if not repo_url:
        return ""
    safe = html.escape(repo_url, quote=True)
    return (f'<p class=source-link><a href="{safe}" rel="noopener">'
            f'Source, tests and receipts on GitHub</a></p>')


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


def path_markup() -> str:
    """The stated way in, once, at the top.

    This page is 4,283 words and every one of them is held by a test, so the answer to a
    reader with two minutes cannot be to cut. It is to say where to spend them. Three
    destinations, in the order they answer the question a judge is actually asking, each an
    ordinary anchor so it works with no script and lands on a keyboard.

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
    ]
    out = ['<div class=path>',
           '<p class=path-k>The two-minute path</p>',
           '<p class=path-lead>Three things, in the order they answer the question. '
           'Everything else here is the evidence behind them.</p>',
           '<ol class=path-steps>']
    for i, (anchor, title, why) in enumerate(steps, 1):
        out.append(f'<li><span class=path-n>{i:02d}</span>'
                   f'<a href="#{anchor}">{esc(title)}</a>'
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


def showcase_figure() -> str:
    """The four-stage figure, loaded from the asset directory by path.

    It is CSS and SVG with no script, so it survives the no-JavaScript pass, and it
    reserves its own box, so it costs nothing against the layout-shift budget.
    """
    spec = spec_from_file_location("showcase", SITE / "showcase.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.showcase_markup()


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

def build(has_audio: bool, repo_url: str | None = None) -> str:
    data = transcripts()
    # Masked here rather than at each use, so a new surface that reads a call cannot
    # reintroduce a whole identifier by reading the field the old ones read.
    _calls = data.get("calls", {})
    for _call in (_calls.values() if isinstance(_calls, dict) else _calls):
        for _key in ("apiId", "providerId"):
            if _call.get(_key):
                _call[_key] = mask_id(_call[_key])
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

    # Two stylesheets, one <style>. The figure's rules are scoped under
    # `.calle-showcase` and neither file reads the other, so order is not load-bearing;
    # they are concatenated rather than linked because a second request for 4 KB costs a
    # round trip the page's weight budget was measured without.
    css = ((SITE / "page.css").read_text(encoding="utf-8") + "\n"
           + (SITE / "showcase.css").read_text(encoding="utf-8"))
    p: list[str] = []
    add = p.append

    add('<!doctype html><html lang=en'
        + (' data-audio=present' if has_audio else ' data-audio=absent') + '>')
    add('<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">')
    add('<title>firstbell: it calls the parents who never replied</title>')
    add('<meta name=description content="Software that telephones the families of absent '
        'schoolchildren in the language that family speaks, and refuses to close a case it '
        'could not get an answer to. Every claim carries the thing that checks it.">')
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
    # A blind reviewer read the first viewport and could not name the product. They were
    # right to be unable to: `firstbell` appeared in the visible text of this page exactly
    # twice, in the browser tab and in a shell command nine screens down. The best sentence
    # in the entry was in README.md and had never been on the page a judge opens first.
    body = [
        '<div class=masthead>',
        '<p class=wordmark>firstbell</p>',
        '<p class=standfirst>Phones the families whose absence notification went '
        'unanswered, in the language that family speaks, and brings back a structured '
        'reason a school office can act on.</p>',
        repo_link_markup(repo_url),
        '</div>',
        '<p class=eyebrow>The attendance register, and the calls it is waiting on</p>',
        '<h1 id=h-00>One child is not in the register.</h1>',
        register_markup(data, rows, hero, has_audio),
        '<p class=hero-foot>Four real calls placed by this software, one row each, and the '
        'three columns are the three fields CALL-E returns. The recordings are held outside '
        'this repository; the transcript, the offsets and the shape of the waveform are what '
        'CALL-E returned. Every call went to the author’s own line, scripted and consented, '
        'and the pupil names in the transcripts are fictional.</p>',
    ]
    add(act("00", "The call", "".join(body), "hero"))

    # ---- Act 1: the residue
    body = [
        path_markup(),
        '<div class=split><div class=claim>',
        '<div class=act-num>01</div><h2 id=h-01>The school knew nothing, and had no way to find out.</h2>',
        '<p>An unanswered absence message is not information. It is an absence of '
        'information, and it looks identical whether the child is at home with a fever or '
        'never arrived anywhere.</p>',
        '<p>The call above is the second kind. At '
        f'{cue + 5} seconds a parent learns from a robot that their daughter is not at '
        'school, having watched her leave for it that morning.</p>',
        '</div><div class=artifact>',
        '<div class=stat-grid>',
    ]
    # One of the four is filled. A grid of four equal numbers makes a reader rank them, and
    # the page already knows the answer: the count of real calls is the number that decides
    # whether the other three are worth reading, so it is the one that carries the field.
    for num, label, lead in ((test_count(), "tests", False),
                             (len(muts), "rules broken on purpose to prove a test notices", False),
                             (len(call_rows), "real calls, each one checkable against CALL-E’s billing", True),
                             ("none", "CALL-E account needed to run the demo", False)):
        body.append(f'<div class=cell{" data-lead" if lead else ""}>'
                    f'<div class=num>{esc(num)}</div>'
                    f'<div class=lbl>{label}</div></div>')
    body.append('</div></div></div>')
    add(act("01", "What the school knew", "".join(body), margin=True))

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
        '<table class=pairs><thead><tr><th>scenario</th><th>en-IN</th><th>ta-IN</th>'
        '<th>agreed</th></tr></thead><tbody>',
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
                   '<p>The third ending. A call that finished without an answer the office '
                   'can act on, named in the run rather than filed as resolved. The '
                   '<a href="#act-05">mutation table</a> holds the tests that keep the '
                   'distinction from collapsing.</p>'),
        '<div class=act-num>03</div><h2 id=h-03>The third ending is the one everyone gets wrong.</h2>',
        '<p class=eyebrow>The same call, filed three ways</p>',
        endings_markup(data, en, run),
        '<p class=note>This app made the first mistake itself. A parent refused to talk, '
        'CALL-E returned a schema-valid result with every required field set to '
        '<code>"unknown"</code>, and the row was recorded as resolved. The receipt stays as '
        'it was written, uncorrected, because a corrected copy would record a run that '
        'never happened. What changed is the code, and a test now fails if the distinction '
        'collapses again.</p>',
        # The opening sentence of the note above, word for word.
        pull("This app made the first mistake itself."),
        f'<p class=dim>Counts read from one committed run of {placed} calls, '
        '<code>06-locale-matched-pairs.json</code>. '
        f'{open_rows} of {placed} rows are still open and every one of them is named. The '
        'rate is resolved over attempted, so an open row can only ever pull it down.</p>',
    ]
    add(act("03", "Three endings", "".join(body), "act-3", margin=True))

    # ---- Act 4: check us
    have = sum(1 for _c, pv, _r, _s, _f in call_rows if pv)
    body = [
        '<div class="split split-long"><div class=claim>',
        '<div class=act-num>04</div><h2 id=h-04>Check us against CALL-E&#8217;s own billing.</h2>',
        '<p>The API returns one identifier and the dashboard is keyed on another. Both are '
        'here, shortened at both ends, alongside the structured answer each call brought '
        'back, so any row can be taken to the vendor&#8217;s records and checked against a '
        'source with no stake in these claims.</p>',
        '<p class=note>The identifiers are shortened on purpose. A live call id is not a '
        'credential, because another account&#8217;s key cannot read our call, but it is an '
        'artifact of a real call to a real number and this repository asks contributors to '
        'keep those out of what they publish. CALL-E hold the billing records this table '
        'invites a check against and can match a row from what is shown; the unshortened '
        'list travels with the submission rather than on a public page.</p>',
        f'<p>{len(live)} of {len(recs)} committed receipts reached the production API and '
        f'{have} of {len(call_rows)} calls carry the provider identifier. The rest had it '
        'recovered afterwards with a <code>GET</code>, which places no call.</p>',
        '<table class=compliance><tbody>'
        '<tr><td>transcripts, waveforms, the audio, and the unshortened identifiers</td>'
        '<td class=dim>not in the repository, and not published whole</td></tr>'
        '<tr><td>the rules those calls produced, and the tests that hold them</td>'
        '<td class=ok>in the repository</td></tr>'
        '</tbody></table>',
        '<p class=note>The maintainer of this list requires committed real-call artifacts '
        'to be removed, and has said so even where the people on the call were team members '
        'playing a part on reserved numbers, which describes these calls exactly. So the '
        'recordings live here, the reasoning lives there, and '
        '<code>tests/test_privacy.py</code> fails the build if one crosses over.</p>',
        '</div><div class=artifact>',
        '<div class=scrollbox tabindex=0 role=region '
        'aria-label="Every call in this run, with its identifiers and fields. '
        'Scrolls sideways on a narrow screen.">'
        '<table class=ids><thead><tr><th>API id</th>'
        '<th>provider id (dashboard)</th>'
        + "".join(f'<th>{esc(f)}</th>' for f in data["fieldOrder"])
        + '<th>outcome</th></tr></thead><tbody>',
    ]
    for call_id, provider, resolution, _src, fields in call_rows:
        cls = {"resolved": "resolved", "undetermined": "undetermined"}.get(resolution or "", "failed")
        pv = (f'<span class=mono>{esc(mask_id(provider))}</span>'
              if provider else '<span class=dim>not recorded</span>')
        cells = "".join(
            f'<td data-field="{esc(f)}">'
            + (esc(fields[f]) if fields.get(f) else '<span class=dim>&#183;</span>')
            + '</td>'
            for f in data["fieldOrder"])
        body.append(f'<tr><td class=mono>{esc(mask_id(call_id))}</td><td>{pv}</td>'
                    f'{cells}'
                    f'<td><span class="state state-{cls}">{esc(resolution)}</span></td></tr>')
    body.append('</tbody></table></div></div></div>')
    add(act("04", "Check us against your billing", "".join(body)))

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
        '<div class=scrollbox tabindex=0 role=region '
        'aria-label="Every gate broken on purpose, with the number of tests that '
        'noticed. Scrolls sideways on a narrow screen.">'
        '<table class=mutations><thead><tr><th>#</th><th>the change</th>'
        '<th>tests that failed</th></tr></thead><tbody>',
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
        '<table class=mutations><thead><tr><th>#</th><th>the change</th>'
        '<th>tests that failed</th></tr></thead><tbody>')
    for num, change, caught in rest:
        body.append(f'<tr><td class=dim>{esc(num)}</td><td>{esc_code(change)}</td>'
                    f'<td class="mono caught">{esc(caught)}</td></tr>')
    body.append('</tbody></table></details></div></div></div>')
    # The first sentence of the claim above, word for word. It closes the act at full width
    # rather than sitting in the 26rem claim column, where the display face would break one
    # sentence over six lines.
    body.append(pull("A test that has never been observed to fail has not been shown to "
                     "test anything."))
    add(act("05", "Every rule, broken", "".join(body), "act-2"))

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
                       'that does not. Two of these four belong to the platform and are '
                       'reported without complaint.</p>'),
            '<div class="split split-long"><div class=claim>',
            '<div class=act-num>07</div><h2 id=h-07>What is not true.</h2>',
            '<p>Four limits, each with what would close it. Two of them are the '
            'platform’s and are reported here without complaint, because a limit you '
            'can read is worth more than a claim you cannot check.</p>',
            '</div><div class=artifact><ul class=limits>']
    for limit, closes in limits:
        body.append(f'<li><p class=limit>{esc(limit)}</p>'
                    f'<p class=closes>{esc(closes)}</p></li>')
    body.append('</ul></div></div>')
    add(act("07", "What is not true", "".join(body), "act-deep", margin=True))

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
        '<pre>pip install -r requirements-dev.txt\n'
        'python -m firstbell --work-file examples/absences.csv</pre>',
        '<p class=dim>Produced by running exactly that when this page was built:</p>',
        '<pre class=run tabindex=0 role=region aria-label="What the offline run prints, '
        'verbatim. Scrolls sideways on a narrow screen.">' + esc(offline_run()) + '</pre>',
    ]
    add(act("08", "Run it yourself", "".join(body), margin=True))

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
        + repo_link_markup(repo_url) + '</div></div></footer>')

    add(f'<script id=call-data type=application/json>{script_json(data)}</script>')
    add(f'<script src="{LENIS[0]}" integrity="{LENIS[1]}" '
        f'crossorigin=anonymous defer></script>')
    add('<script type=module src="app.js"></script>')
    add('</html>')
    return "".join(p)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out", nargs="?", default="out", help="output directory")
    ap.add_argument("--audio-dir", default=None,
                    help="directory holding <row-id>.m4a clips, outside this repository")
    ap.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"),
                    help="directory holding the call recordings, outside this repository")
    ap.add_argument("--repo-url", default=os.environ.get("FIRSTBELL_REPO_URL"),
                    help="public URL of the source repository. Omitted rather than "
                         "guessed: a link to a repository that is not published yet "
                         "is worse than no link at all")
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
    for asset in ("app.js", "player.js"):
        shutil.copy2(SITE / asset, out / asset)

    page = out / "index.html"
    markup = build(has_audio, args.repo_url)
    page.write_text(markup, encoding="utf-8", newline="\n")

    # The policy is derived from the bytes above rather than kept beside them, so the two
    # cannot disagree. Written after the page for the same reason: there is nothing to
    # describe until the page exists.
    (out / "vercel.json").write_text(deployment_config(markup), encoding="utf-8",
                                     newline="\n")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"{page}  {page.stat().st_size / 1024:.1f} KB")
    print(f"audio: {len(clips)} clips" if has_audio else "audio: none, page says why")
    print(f"total output: {total / 1024:.0f} KB across "
          f"{sum(1 for f in out.rglob('*') if f.is_file())} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
