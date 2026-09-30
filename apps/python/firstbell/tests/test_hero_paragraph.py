# Copyright (c) 2026 Kesav2k04
# SPDX-License-Identifier: MIT
"""The paragraph under the hero card must describe the call the hero card plays.

This defect has shipped twice. The paragraph in `tools/judge_page.py` that opens
"The call above is the second kind" is prose, so nothing derived it and nothing checked it.
It was written for S-3103 and kept that call's daughter and her school bus through the whole
period S-3127 was the hero. It was then rewritten for S-3127 and kept his bike and his friend
through the move to S-4105. Each time it sat one screen below a card playing a different
conversation, and each time every *derived* value in the same paragraph was correct, which is
exactly what let it survive: `reason_category` and `parent_confirmed_aware` are read off the
hero, so the gates watching them stayed green while the sentence around them described
somebody else's child.

The check is not "does this prose read well", which no test can ask. It is narrower and it
catches the real failure: a word that is distinctive to some *other* call's transcript, and
absent from the hero's, is a word that came from the wrong call. "bike" is in S-3127 and in
no other call; finding it in a paragraph about S-4105 is the whole bug, mechanically.

Common words are not evidence. A term is only distinctive if few transcripts carry it, so
"school", "absence" and "morning" never trip this no matter which call is the hero.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
PAGE = APP / "out" / "index.html"

# A word carried by more transcripts than this is ordinary vocabulary for these calls and
# proves nothing about which one a sentence describes.
DISTINCTIVE_AT_MOST = 3

# Shorter words are function words or fragments, and matching on them produces noise.
MIN_WORD = 4

# Words that are about the *page* rather than about a call. They legitimately appear in the
# paragraph and may appear in transcripts by coincidence.
PAGE_VOCABULARY = {
    "call", "calls", "above", "second", "kind", "seconds", "reason", "absence", "came",
    "back", "confirmed", "aware", "unknown", "parent", "parents", "school", "child",
    "office", "attendance", "nobody", "could", "where", "actually", "person", "answered",
    "asked", "confirm", "know", "knew", "they", "that", "this", "with", "from", "about",
    "said", "says", "morning", "left", "were", "been", "have", "their", "there",
}


def _hero_and_calls() -> tuple[str, dict]:
    receipts = APP / "evidence" / "receipts" / "transcripts.json"
    import os
    external = os.environ.get("FIRSTBELL_RECEIPTS")
    if external:
        candidate = Path(external) / "transcripts.json"
        if candidate.is_file():
            receipts = candidate
    if not receipts.is_file():
        pytest.skip("no transcripts.json reachable, so the hero's own words cannot be read")
    data = json.loads(receipts.read_text(encoding="utf-8"))
    calls = data["calls"]
    hero = data.get("hero")
    if hero not in calls:
        hero = next(iter(calls))
    return hero, calls


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= MIN_WORD}


def _hero_paragraph() -> str:
    if not PAGE.exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    markup = PAGE.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"<p>The call above is the second kind\.(.*?)</p>", markup, re.S)
    assert match, (
        "the page no longer carries the paragraph that introduces the hero call. If it was "
        "renamed, rename it here too; if it was deleted, delete this gate with it")
    return html.unescape(re.sub(r"<[^>]+>", " ", match.group(1)))


def test_the_hero_paragraph_uses_no_word_that_belongs_to_another_call():
    hero, calls = _hero_and_calls()

    spoken = {}
    for cid, call in calls.items():
        text = " ".join((t.get("text") or "") + " " + (t.get("gloss") or "")
                        for t in call.get("turns", []))
        spoken[cid] = _words(text)

    hero_words = spoken[hero]
    carried_by = {}
    for cid, words in spoken.items():
        for word in words:
            carried_by.setdefault(word, set()).add(cid)

    borrowed = []
    for word in sorted(_words(_hero_paragraph()) - PAGE_VOCABULARY):
        owners = carried_by.get(word, set())
        if not owners or word in hero_words:
            continue
        if len(owners) <= DISTINCTIVE_AT_MOST:
            borrowed.append(f"{word!r} is said in {', '.join(sorted(owners))} and never in "
                            f"{hero}")

    assert not borrowed, (
        f"the paragraph under the hero card describes a call that is not {hero}, which is "
        f"the call the card plays. Each word below is distinctive to another call's "
        f"transcript and absent from the hero's:\n  " + "\n  ".join(borrowed)
        + "\n\nThis has shipped twice before. Rewrite the paragraph in tools/judge_page.py "
          "against the hero's own turns, and do not assert anything the receipt left unknown."
    )
