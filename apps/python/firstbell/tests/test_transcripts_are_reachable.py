# Copyright (c) 2026 Kesav2k04
# SPDX-License-Identifier: MIT
"""No page may promise a transcript for a call it never shows anybody.

Two sentences shipped this claim. The first screen read "This page publishes 20 calls, each
with its transcript", and `the-morning.html` read "This software has placed 20 real calls,
and the transcript of every one of them is on the evidence page". Both were false the same
way: twenty transcripts sat complete inside the page's own `call-data` island, where a
parser reaches them and a reader does not. Two rendered. Eleven of the twenty call ids were
never printed anywhere in the eleven-page build.

Eight hundred and fifty tests were green over it, and the gate that was watching the first
of those sentences is the reason. It held the number in the sentence against
`len(transcripts()["calls"])`, which is the island: the claim checked against the thing the
claim was about. A gate cannot catch an overclaim by asking the source of the claim.

So this reads the built markup with `<script>` cut out, which is a reader's view of the
page and not a parser's, and it looks only for sentences that promise a transcript is there
to be read. It does not require the page to publish anything. What the page chooses to show
is an editorial decision; whether it describes that choice truthfully is not.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
OUT = APP / "out"

# A transcript counts as shown when this much of it reaches the markup. Not all of it: a
# future excerpt is a legitimate editorial choice and is not the defect this file is about.
SHOWN_SHARE = 0.80

# Shorter fragments are timestamps and speaker labels rather than speech.
MIN_PROBE = 12

# The shapes that promise a reader can read it. A whitelist rather than "a number near the
# word transcript", which matched a mutation-table row reading "nine of twelve: Extraction
# was faithful to the transcript" and two other sentences making no promise at all.
PROMISES = (
    r"each with (?:its|their) transcripts?",
    r"transcripts? of every one of them",
    r"every transcript",
    r"all (?:\w+ )?transcripts?",
    r"publishes [\w-]+ calls?,? (?:and )?(?:each |with )",
)


def _reader_text() -> dict[str, str]:
    """Every built page as a reader meets it, with script and style removed."""
    if not (OUT / "index.html").exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    seen = {}
    for path in sorted(OUT.rglob("*.html")):
        markup = path.read_text(encoding="utf-8", errors="replace")
        markup = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", " ", markup,
                        flags=re.S | re.I)
        seen[path.name] = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup)))
    return seen


def _calls() -> dict:
    """The calls the page was built from, read off the island.

    The island is not evidence that anything was published, which is the point of this
    file. It is the list of calls to look for, and reading it here rather than from
    `evidence/receipts/` keeps this runnable in a clean checkout, where the receipts are
    not on disk at all.
    """
    markup = (OUT / "index.html").read_text(encoding="utf-8", errors="replace")
    island = re.search(r"<script id=call-data type=application/json>(.*?)</script>",
                       markup, re.S)
    if not island:
        pytest.skip("no call-data island in the built page")
    return json.loads(html.unescape(island.group(1)))["calls"]


def _shown() -> int:
    pages = _reader_text()
    count = 0
    for call in _calls().values():
        probes = [t["text"].strip() for t in call.get("turns", [])
                  if len((t.get("text") or "").strip()) >= MIN_PROBE]
        if not probes:
            continue
        best = max((sum(1 for probe in probes if probe in text) / len(probes)
                    for text in pages.values()), default=0.0)
        if best >= SHOWN_SHARE:
            count += 1
    return count


def test_no_page_promises_a_transcript_a_reader_cannot_reach():
    shown = _shown()
    found = []
    for name, text in _reader_text().items():
        for shape in PROMISES:
            for match in re.finditer(shape, text, re.I):
                window = text[max(0, match.start() - 90):match.end() + 60].strip()
                # A sentence saying the transcripts are held elsewhere promises nothing
                # about this page, and saying so is the honest form of the same fact.
                if re.search(r"outside|repositor|receipts?\b|\.json|not committed",
                             window, re.I):
                    continue
                found.append(f"{name}: ...{window}...")

    assert not found, (
        f"the built pages show {shown} transcript(s) in full, and these sentences promise "
        f"a reader more than that:\n  " + "\n  ".join(found)
        + "\n\nEither show them or say what is true. A transcript that exists only in the "
          "call-data island is shipped, not published."
    )


def test_the_calls_with_a_play_control_have_their_words_for_the_player():
    """The player writes a transcript as it plays, so the island has to hold one.

    Narrower than the rule above and aimed at the opposite mistake. `player.js` builds the
    turn list from the island at playback, which is why those calls are reachable without
    being in the served markup. If a play control names a call the island has no turns for,
    the reader gets a recording and silence where the words should be.
    """
    if not (OUT / "index.html").exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    markup = (OUT / "index.html").read_text(encoding="utf-8", errors="replace")
    played = sorted(set(re.findall(r'data-csc-play="(S-\d+)"', markup)))
    if not played:
        pytest.skip("no play controls in this build, so there is nothing to check")

    calls = _calls()
    empty = [cid for cid in played if not calls.get(cid, {}).get("turns")]
    assert not empty, (
        "these calls have a play control and no turns for the player to write: "
        + ", ".join(empty))
