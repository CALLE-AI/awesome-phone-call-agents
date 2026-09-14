"""Rewrite the README's sample run from a real offline run of the app.

The sample in the README drifted once, silently, by predating an entire output block. It
drifted because nothing compared it to the program. `tests/test_claims.py` now does, and
this is the other half: the way to fix a mismatch, so that nobody edits the sample by hand
and no gate both produces and checks the same artifact.

Run from the app directory:

    python tools/refresh_readme_sample.py

It finds the fenced block by its content rather than by line number, so it can be run any
number of times. An earlier version of this script hardcoded the fence positions, worked
once, and broke the moment the block changed length.
"""
from __future__ import annotations

import io
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
README = APP / "README.md"
WORK_FILE = "examples/absences.csv"

# The block is identified by the banner the offline run always prints first. Anchoring on
# content rather than position is what makes this repeatable.
BLOCK = re.compile(r"(?P<open>```\n)(?P<body>OFFLINE\..*?)(?P<close>```)", re.S)


def sample() -> str:
    run = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", WORK_FILE],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if run.returncode != 0:
        raise SystemExit("the app exited %d:\n%s" % (run.returncode, run.stderr[-800:]))
    text = run.stdout.replace("\r\n", "\n").strip("\n")
    if not text.startswith("OFFLINE."):
        raise SystemExit("expected the offline banner, got: " + text[:80])
    return text


def main() -> int:
    raw = io.open(README, "r", newline="", encoding="utf-8").read()
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")

    matches = list(BLOCK.finditer(src))
    if len(matches) != 1:
        raise SystemExit("expected exactly one sample block, found %d" % len(matches))

    body = sample()
    before = matches[0].group("body").strip("\n")
    if before == body:
        print("README sample already matches the program. Nothing written.")
        return 0

    src = src[:matches[0].start("body")] + body + "\n" + src[matches[0].end("body"):]
    io.open(README, "w", newline="\r\n" if crlf else "\n", encoding="utf-8").write(src)
    print("README sample refreshed: %d lines -> %d lines."
          % (len(before.split("\n")), len(body.split("\n"))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
