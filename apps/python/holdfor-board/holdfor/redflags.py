"""The one red-flag list, and the only way to read it.

Both consumers go through here: the prompt builder, which tells the agent what to stop
on during the call, and `scan()`, which decides afterwards whether a Review Item is
flagged. Two lists would eventually disagree, and the call where they disagreed would
be the one that mattered. See docs/adr/0005-stop-conditions-are-enforced-twice.md.

A section of the source file contributes phrases only when it cites a source. That is
not tidiness: it makes the citation structural, so an uncited phrase silently does
nothing rather than quietly becoming a clinical claim of ours.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_PATH = (
    REPO_ROOT / "skills" / "holdfor-post-visit-followup" / "references" / "red-flags.md"
)

SOURCE_PREFIX = "Source:"
PHRASE_PREFIX = "- "

_CACHE: dict[Path, tuple[str, ...]] = {}


def path() -> Path:
    """Where the list lives. `HOLDFOR_RED_FLAGS` overrides it, for tests."""
    override = os.environ.get("HOLDFOR_RED_FLAGS")
    return Path(override) if override else DEFAULT_PATH


def phrases(source: Path | None = None) -> tuple[str, ...]:
    """Every cited phrase, case-folded, in file order, without duplicates."""
    target = (source or path()).resolve()
    if target not in _CACHE:
        _CACHE[target] = _parse(target.read_text(encoding="utf-8"))
    return _CACHE[target]


def _parse(text: str) -> tuple[str, ...]:
    found: list[str] = []
    for section in text.split("\n## ")[1:]:
        lines = section.splitlines()
        if not any(line.startswith(SOURCE_PREFIX) for line in lines):
            continue
        for line in lines:
            if line.startswith(PHRASE_PREFIX):
                phrase = line[len(PHRASE_PREFIX) :].strip()
                if phrase:
                    found.append(phrase.casefold())
    return tuple(dict.fromkeys(found))


def _pattern(phrase: str) -> re.Pattern[str]:
    return re.compile(rf"(?<!\w){re.escape(phrase)}(?!\w)", re.IGNORECASE)


def match(text: str, source: Path | None = None) -> str | None:
    """The first cited phrase appearing in `text`, or None.

    Whole phrase, word boundaries, case-folded: `short of breath` matches, `breath`
    alone does not.
    """
    for phrase in phrases(source):
        if _pattern(phrase).search(text):
            return phrase
    return None


def prompt_block(source: Path | None = None) -> str:
    """The phrases as the agent is shown them, compiled from the same list."""
    return "\n".join(f"- {phrase}" for phrase in phrases(source))
