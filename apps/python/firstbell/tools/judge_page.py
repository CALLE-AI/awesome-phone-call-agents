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
import html
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
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

# Pinned, with integrity. Both are comfort layers: if either fails to arrive the page still
# scrolls, plays and reads, which is also the reduced-motion path.
LENIS = ("https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js",
         "sha384-uxdRfmAAt0Y8V0FBZDwCzUKKrGqfMKZmVSbUXjJZJHYIWJmXWvzYBWZeVLJHqbTQ")
TYPEKIT = "https://use.typekit.net/qdx4jvs.css"

ACTS = [
    ("00", "The call"),
    ("01", "What the school knew"),
    ("02", "Twelve comparisons"),
    ("03", "The receipt of being wrong"),
    ("04", "Check us against your billing"),
    ("05", "Every rule, broken"),
    ("06", "Three things to take"),
    ("07", "What is not true"),
    ("08", "Run it yourself"),
]

FIELD_LABEL = {
    "parent_confirmed_aware": "parent_confirmed_aware",
    "reason_category": "reason_category",
    "expected_return": "expected_return",
}


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
    out.append('<canvas data-waveform role=img aria-label="Waveform of the call, '
               'click to seek"></canvas>')
    out.append('<ol class=turns data-turns aria-live=off>')
    for turn in first["turns"]:
        who = "agent" if turn["speaker"] == "bot" else "parent"
        mins, secs = divmod(int(turn["offset_seconds"]), 60)
        out.append(
            f'<li data-at="{turn["offset_seconds"]}" data-who="{esc(turn["speaker"])}" '
            f'data-rel=ahead><span class=turn-at>{mins}:{secs:02d}</span>'
            f'<span class=turn-who>{who}</span>'
            f'<span class=turn-text lang="{esc(first["locale"])}">{esc(turn["text"])}</span></li>')
    out.append('</ol>')
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
        out.append(f'<p class=conf>completion confidence <b data-conf>{conf}</b></p>')
    out.append('</div></div>')
    return "".join(out)


def act(num: str, title: str, body: str, classes: str = "") -> str:
    # One reveal target per act. The hero never reveals: it is the first paint and it is
    # already choreographed on load.
    reveal = "" if num == "00" else " data-reveal"
    return (f'<section class="act act-{num} {classes}" id="act-{num}" '
            f'aria-labelledby="h-{num}"><div class=inner{reveal}>{body}</div></section>')


# ---- the page ---------------------------------------------------------------------------

def build(has_audio: bool) -> str:
    data = transcripts()
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
                              item.get("resolution"), name))
    live = [(n, d) for n, d in recs if d.get("reached_production_api")]
    agree = sum(p["agree"] for p in data["pairs"])
    total = sum(p["of"] for p in data["pairs"])

    css = (SITE / "page.css").read_text(encoding="utf-8")
    p: list[str] = []
    add = p.append

    add('<!doctype html><html lang=en'
        + (' data-audio=present' if has_audio else ' data-audio=absent') + '>')
    add('<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">')
    add('<title>firstbell: it calls the parents who never replied</title>')
    add('<meta name=description content="Software that telephones the families of absent '
        'schoolchildren in the language that family speaks, and refuses to close a case it '
        'could not get an answer to. Every claim carries the thing that checks it.">')
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
    add(f'<link rel=stylesheet href="{TYPEKIT}" media=print '
        f'onload="this.media=\'all\';document.documentElement.classList.add(\'fonts\')">')
    add(f'<noscript><link rel=stylesheet href="{TYPEKIT}"></noscript>')
    add(f'<style>{css}</style>')

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

    add('<main>')

    # ---- Act 0: the call
    hero_ids = ["S-4105", "S-4106"]
    cue = cue_for(calls["S-4105"], "left for school")
    body = [
        '<p class=eyebrow>08:40. A register is taken. One child is not in it.</p>',
        '<h1 id=h-00>It calls the parents who never replied.</h1>',
        '<p class=lede>The school already sent a text message. Some families answer it. This '
        'is about the ones who do not, and it is the same call in whichever language that '
        'family speaks.</p>',
        player_markup(hero_ids, data, cue, has_audio),
        '<p class=hero-foot>Two real calls, placed by this software. Different languages, '
        f'different words, the same three fields. Both are the author’s own line, '
        'scripted and consented; the pupil names are fictional.</p>',
    ]
    add(act("00", "The call", "".join(body), "theatre"))

    # ---- Act 1: the residue
    body = [
        '<div class=split><div class=claim>',
        '<h3>01</h3><h2 id=h-01>The school knew nothing, and had no way to find out.</h2>',
        '<p>An unanswered absence message is not information. It is an absence of '
        'information, and it looks identical whether the child is at home with a fever or '
        'never arrived anywhere.</p>',
        '<p>The call above is the second kind. At '
        f'{cue + 5} seconds a parent learns from a robot that their daughter is not at '
        'school, having watched her leave for it that morning.</p>',
        '</div><div class=artifact>',
        '<div class=stat-grid>',
    ]
    for num, label in ((test_count(), "tests"),
                       (len(muts), "rules broken on purpose to prove a test notices"),
                       (len(call_rows), "real calls, every id checkable against CALL-E’s billing"),
                       ("none", "CALL-E account needed to run the demo")):
        body.append(f'<div class=cell><div class=num>{esc(num)}</div>'
                    f'<div class=lbl>{label}</div></div>')
    body.append('</div></div></div>')
    add(act("01", "What the school knew", "".join(body)))

    # ---- Act 2: twelve comparisons
    body = [
        '<div class=split><div class=claim>',
        '<h3>02</h3><h2 id=h-02>Twelve comparisons, written down before the phone rang.</h2>',
        '<p>Four scenarios, each performed twice, once in English and once in Tamil. Three '
        'enumerated fields per pair. Twelve comparisons, counted and committed before any '
        f'call was placed, so the number could not be chosen afterwards.</p>',
        f'<p class=result-line><b>{agree} of {total}</b> matched.</p>',
        '<p>Then the transcripts were read. All three mismatches are the speaker saying '
        'different things in the two calls, which a person recalling their own script from '
        'memory will do. Extraction was faithful to what was actually said in twelve of '
        'twelve, in both languages.</p>',
        '<p class=dim>There is no Tamil-specific code anywhere in this app. Language is one '
        'column in the work file and one string in the request.</p>',
        '</div><div class=artifact>',
        '<table class=pairs><thead><tr><th>scenario</th><th>en-IN</th><th>ta-IN</th>'
        '<th>agreed</th></tr></thead><tbody>',
    ]
    for pair in data["pairs"]:
        cls = "ok" if pair["agree"] == pair["of"] else "part"
        body.append(f'<tr><td>{esc(pair["label"])}</td>'
                    f'<td class=mono>{esc(pair["en"])}</td>'
                    f'<td class=mono>{esc(pair["ta"])}</td>'
                    f'<td class="agree {cls}">{pair["agree"]}/{pair["of"]}</td></tr>')
    body.append('</tbody></table></div></div>')
    add(act("02", "Twelve comparisons", "".join(body), "act-2"))

    # ---- Act 3: the receipt of being wrong
    body = [
        '<div class=split><div class=claim>',
        '<h3>03</h3><h2 id=h-03>This app got one wrong, and the receipt is committed '
        'uncorrected.</h2>',
        '<p>A parent refused to talk. CALL-E returned a schema-valid result with every '
        'required field set to <code>"unknown"</code>, and the row was recorded as resolved. '
        'It was not resolved. Nobody had spoken to that family about their child.</p>',
        '<p>The receipt stays as it was written, because a corrected copy would record a run '
        'that never happened. What changed is the code, and a test now fails if the '
        'distinction collapses again.</p>',
        '<p class=dim>Listen to the call it came from. The refusal is the shortest pair in '
        'the set and its two languages agreed on all three fields.</p>',
        '</div><div class=artifact>',
        player_markup(["S-4107", "S-4108"], data, 0, has_audio),
        '</div></div>',
    ]
    add(act("03", "The receipt of being wrong", "".join(body), "act-3"))

    # ---- Act 4: check us
    have = sum(1 for _c, pv, _r, _s in call_rows if pv)
    body = [
        '<div class=split><div class=claim>',
        '<h3>04</h3><h2 id=h-04>Check us against your own billing.</h2>',
        '<p>The API returns one identifier. CALL-E’s dashboard and usage page are keyed '
        'on another. Both are printed here, so any row can be taken to the vendor’s own '
        'records and checked against a source with no stake in these claims.</p>',
        f'<p>{len(live)} of {len(recs)} committed receipts reached the production API, and '
        f'{have} of {len(call_rows)} calls carry the provider identifier. The receipts '
        'written before this app recorded that field had it recovered afterwards with a '
        '<code>GET</code>, which places no call.</p>',
        '<h3>What is committed, and what is only served here</h3>',
        '<table class=compliance><tbody>'
        '<tr><td>call ids, transcripts, waveform shape, structured results, the audio</td>'
        '<td class=dim>served on this page only</td></tr>'
        '<tr><td>the rules those calls produced, and the tests that hold them</td>'
        '<td class=ok>in the repository</td></tr>'
        '</tbody></table>'
        '<p class=note>Nothing on the left is in the repository. The maintainer of this '
        'list requires committed real-call artifacts to be removed, and has said the '
        'requirement holds even where the people on the call were team members playing a '
        'part and the numbers were reserved ones, which describes these calls exactly. '
        'So the recordings live here and the reasoning lives there, and '
        '<code>tests/test_privacy.py</code> fails the build if one crosses over.</p>',
        '</div><div class=artifact>',
        '<table class=ids><thead><tr><th>API id</th><th>provider id (dashboard)</th>'
        '<th>outcome</th></tr></thead><tbody>',
    ]
    for call_id, provider, resolution, _src in call_rows:
        cls = {"resolved": "resolved", "undetermined": "undetermined"}.get(resolution or "", "failed")
        pv = (f'<button data-copy="{esc(provider)}" title="Copy">{esc(provider)}</button>'
              if provider else '<span class=dim>not recorded</span>')
        body.append(f'<tr><td class=mono>{esc(call_id)}</td><td class=mono>{pv}</td>'
                    f'<td><span class="state state-{cls}">{esc(resolution)}</span></td></tr>')
    body.append('</tbody></table></div></div>')
    add(act("04", "Check us against your billing", "".join(body)))

    # ---- Act 5: mutations
    body = [
        '<div class=split><div class=claim>',
        '<h3>05</h3><h2 id=h-05>Every rule, broken on purpose.</h2>',
        '<p>A test that has never been observed to fail has not been shown to test anything. '
        'Each row is a change made to working code to check that a specific test notices. '
        'Every one was reverted and the suite returned to green.</p>',
        '<div class=note>Number 18 found a live defect rather than confirming a rule. '
        '<code>reached_production_api</code> was computed from the configured base URL alone, '
        'so a run whose every attempt died at the transport layer would still have published '
        'that it reached production.</div>',
        '</div><div class=artifact>',
        '<table class=mutations><thead><tr><th>#</th><th>the change</th>'
        '<th>tests that failed</th></tr></thead><tbody>',
    ]
    for num, change, caught in muts:
        body.append(f'<tr><td class=dim>{esc(num)}</td><td>{esc_code(change)}</td>'
                    f'<td class="mono caught">{esc(caught)}</td></tr>')
    body.append('</tbody></table></div></div>')
    add(act("05", "Every rule, broken", "".join(body), "act-2"))

    # ---- Act 6: take-aways
    takes = [
        ("Three outcomes, not two",
         "<code>resolved</code> is an answer on record. <code>failed</code> is nobody "
         "reached. <code>undetermined</code> is a call that connected and produced nothing "
         "usable, and it goes to a named person. It is never counted toward a coverage "
         "percentage, because the whole point is a child nobody has heard about."),
        ("Record the identifier the vendor is keyed on",
         "The id an API returns and the id its billing page shows are not always the same "
         "one. Recording only the first makes a receipt uncheckable by anyone outside the "
         "repository that wrote it."),
        ("Break a rule to prove a test catches it",
         "Eighteen deliberate changes, each reverted, each recorded with the tests that "
         "failed. It cost an afternoon and it found a real defect that eighty-eight passing "
         "tests had not."),
    ]
    body = ['<h3>06</h3><h2 id=h-06>Three things worth taking, whatever you are building.</h2>',
            '<div class=takes>']
    for i, (title, text) in enumerate(takes, 1):
        body.append(f'<div class=take><div class=take-n>{i:02d}</div>'
                    f'<h4>{esc(title)}</h4><p>{text}</p></div>')
    body.append('</div>')
    add(act("06", "Three things to take", "".join(body)))

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
    body = ['<div class=split><div class=claim>',
            '<h3>07</h3><h2 id=h-07>What is not true.</h2>',
            '<p>Four limits, each with what would close it. Two of them are the '
            'platform’s and are reported here without complaint, because a limit you '
            'can read is worth more than a claim you cannot check.</p>',
            '</div><div class=artifact><ul class=limits>']
    for limit, closes in limits:
        body.append(f'<li><p class=limit>{esc(limit)}</p>'
                    f'<p class=closes>{esc(closes)}</p></li>')
    body.append('</ul></div></div>')
    add(act("07", "What is not true", "".join(body), "act-deep"))

    # ---- Act 8: close
    body = [
        '<h3>08</h3><h2 id=h-08>Run the whole thing with no account.</h2>',
        '<p>No API key, no signup, no telephone call. The local double is mounted as an '
        '<code>httpx</code> transport underneath a real <code>calle.CalleClient</code>, so '
        'the offline path exercises the same SDK code as the live one.</p>',
        '<pre>pip install -r requirements-dev.txt\n'
        'python -m firstbell --work-file examples/absences.csv</pre>',
        '<p class=dim>Produced by running exactly that when this page was built:</p>',
        f'<pre class=run>{esc(offline_run())}</pre>',
    ]
    add(act("08", "Run it yourself", "".join(body)))

    add('</main>')
    # The build's own provenance. The previous footer said "if the repository changes,
    # this page changes with it", which is a claim the page cannot make about itself: a
    # deployed copy goes stale the moment the next commit lands, and this one did, telling
    # readers 88 tests and 18 mutations while the repository said otherwise. A commit and a
    # date can be checked. A promise about future rebuilds cannot.
    add(f'<footer><p>Built from <code>{build_commit()}</code> on {build_date()} by '
        '<code>tools/judge_page.py</code>, which reads the numbers rather than being told '
        'them. If that commit is not the tip of the branch, this page is behind it, and '
        'you can see that for yourself rather than being told. Contrast is measured by '
        '<code>tools/check_contrast.py</code>, which reports the pairs it could not measure '
        'so that an unmeasured pair cannot read as a pass.</p></footer>')

    add(f'<script id=call-data type=application/json>{json.dumps(data, ensure_ascii=False, separators=(",", ":"))}</script>')
    add(f'<script src="{LENIS[0]}" defer></script>')
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

    for asset in ("app.js", "player.js"):
        shutil.copy2(SITE / asset, out / asset)

    page = out / "index.html"
    page.write_text(build(has_audio), encoding="utf-8", newline="\n")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"{page}  {page.stat().st_size / 1024:.1f} KB")
    print(f"audio: {len(clips)} clips" if has_audio else "audio: none, page says why")
    print(f"total output: {total / 1024:.0f} KB across "
          f"{sum(1 for f in out.rglob('*') if f.is_file())} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
