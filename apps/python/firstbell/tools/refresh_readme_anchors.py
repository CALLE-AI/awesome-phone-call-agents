"""Point every line number the documents cite at where its subject actually is.

The README names four runtime call sites by file and line, which is the thing that makes
"this really speaks to CALL-E" checkable in ten seconds instead of by reading a package.
`tests/test_claims.py` has always failed when one drifted, so no wrong number ever shipped.
What kept happening is the other cost: an edit anywhere above a cited line breaks the build
for a reason that has nothing to do with the edit, and the fix is a number nobody can derive
without opening the file. That happened three times in one night.

So the numbers are recomputed here instead. The gate does not change and is not weakened:
it still fails on a wrong number, and this is what a person runs to make it right. What the
gate cannot check is whether the symbol is worth citing at all, and that stays a decision.

It does the same for the line ranges in `call-e-feedback.md`, which cite a file and a
quoted phrase inside it. Those drift for the same reason and are held by their own gate.

    python tools/refresh_readme_anchors.py            # rewrite the numbers
    python tools/refresh_readme_anchors.py --check    # say what is wrong, change nothing
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent

# The same pattern the gate uses, deliberately. Two patterns would eventually disagree
# about what an anchor is, and the one that mattered would be whichever ran second.
ANCHOR = re.compile(r"`([^`]+)` at\s*\n?\s*`([a-z_/]+\.py):(\d+)`")

DOCUMENTS = ("README.md", "docs/images/README.md")

# `path:first-last` followed by the phrase the range is claimed to contain. The same shape
# `tests/test_claims.py` parses, for the same reason the anchor pattern is shared.
RANGE = re.compile(r"`([\w./-]+):(\d+)-(\d+)`\s*\(\"([^\"]+)\"\)")


def find(symbol: str, path: Path, was: int) -> int:
    """Where the symbol is now, or an exit that says why it cannot be found.

    Ambiguity is refused rather than guessed at. A symbol on two lines has no answer, and
    picking the nearer one to the old number would quietly re-point a citation at the wrong
    call site the first time somebody duplicated a line.
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    hits = [n for n, line in enumerate(lines, 1) if symbol in line]
    if not hits:
        raise SystemExit(
            f"{path.relative_to(APP)} no longer contains {symbol!r}, cited at line {was}. "
            f"Either the call site moved to another file or the README is citing something "
            f"that has been removed, and neither is a line number this can fix."
        )
    if len(hits) > 1:
        raise SystemExit(
            f"{symbol!r} appears on {len(hits)} lines of {path.relative_to(APP)} "
            f"({', '.join(str(h) for h in hits)}), so there is no single line to cite. "
            f"Cite something that names one of them instead."
        )
    return hits[0]


def main() -> int:
    check = "--check" in sys.argv[1:]
    moved, held = 0, 0

    for name in DOCUMENTS:
        doc = APP / name
        text = doc.read_text(encoding="utf-8")

        def repoint(match: re.Match) -> str:
            nonlocal moved, held
            symbol, path, was = match.group(1), match.group(2), int(match.group(3))
            now = find(symbol, APP / path, was)
            if now == was:
                held += 1
                return match.group(0)
            moved += 1
            print(f"{name}: {symbol!r} {path}:{was} -> {now}")
            # Only the number is rewritten. The whitespace between the symbol and the
            # citation carries a line break in some of these, and reflowing the sentence
            # around a two-digit change is how a refresher starts editing prose.
            return match.group(0).replace(f":{was}`", f":{now}`")

        rewritten = ANCHOR.sub(repoint, text)
        if rewritten != text and not check:
            doc.write_text(rewritten, encoding="utf-8", newline="\n")

    moved, held = repoint_ranges(check, moved, held)

    if check and moved:
        print(f"{moved} anchor(s) point at the wrong line. Run this without --check.")
        return 1
    print(f"{held} anchor(s) already right, {moved} moved.")
    return 0


def repoint_ranges(check: bool, moved: int, held: int) -> tuple[int, int]:
    """The feedback file's `path:first-last ("phrase")` citations.

    A range is repointed by finding the phrase and keeping the window the same size, which
    is right when a citation drifts because something above it grew and wrong if the passage
    itself was rewritten. The gate is what tells the difference: if the phrase is no longer
    in the file this refuses, and if the resized window no longer holds it the gate fails on
    the next run.
    """
    doc = APP / "call-e-feedback.md"
    if not doc.exists():
        return moved, held
    text = doc.read_text(encoding="utf-8")

    def repoint(match: re.Match) -> str:
        nonlocal moved, held
        rel, first, last, phrase = (match.group(1), int(match.group(2)),
                                    int(match.group(3)), match.group(4))
        target = (APP.parents[2] / rel) if rel.startswith("apps/") else (APP / rel)
        if not target.exists():
            raise SystemExit(f"call-e-feedback.md cites {rel}, which does not exist")
        lines = target.read_text(encoding="utf-8").splitlines()
        if phrase in chr(10).join(lines[first - 1:last]):
            held += 1
            return match.group(0)
        hits = [n for n, line in enumerate(lines, 1) if phrase in line]
        if not hits:
            raise SystemExit(
                f"{rel} no longer contains {phrase!r}, cited at {first}-{last}. The passage "
                f"was rewritten rather than moved, and that is not a line number this can fix."
            )
        if len(hits) > 1:
            raise SystemExit(
                f"{phrase!r} appears on {len(hits)} lines of {rel}, so the citation has no "
                f"single home. Quote something that appears once."
            )
        start = hits[0]
        end = start + (last - first)
        moved += 1
        print(f"call-e-feedback.md: {phrase!r} {rel}:{first}-{last} -> {start}-{end}")
        return match.group(0).replace(f"{rel}:{first}-{last}", f"{rel}:{start}-{end}")

    rewritten = RANGE.sub(repoint, text)
    if rewritten != text and not check:
        doc.write_text(rewritten, encoding="utf-8", newline=chr(10))
    return moved, held


if __name__ == "__main__":
    raise SystemExit(main())
