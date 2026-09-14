"""Copy DIALTONE into a local clone of awesome-phone-call-agents and run its validator.

  python3 scripts/package_submission.py /path/to/awesome-phone-call-agents

Local only: it creates/overwrites apps/python/dialtone and skills/dialtone-handshake,
adds index rows to README.md and apps/README.md, and runs the repository's
validator. It never commits, pushes, or opens a PR.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROW = ("| [`apps/python/dialtone`](apps/python/dialtone/) | Python | For calls where the other end is also an AI: a spoken "
           "handshake compiled into the CALL-E task, a human / IVR / agent detector with a published blind evaluation, and an "
           "attestation gate that refuses bookings two agents \"confirmed\" without any person or record behind them. |")
APPS_ROW = APP_ROW.replace("apps/python/dialtone", "python/dialtone", 1).replace("(apps/python/dialtone/)", "(python/dialtone/)")
SAFETY_BULLET = ("- [`Two agents agreeing is not a commitment`](apps/python/dialtone/docs/PROTOCOL.md) - DIALTONE v1: spoken "
                 "agent-to-agent handshake, mode switch, and attestation labels that never upgrade `task_completed`.")
IGNORE = shutil.ignore_patterns(".git", ".venv", "out", "raw", ".claude", "__pycache__", ".pytest_cache", ".env", "*.log",
                                "demo.real.json", "skills", "*.egg-info", "uv.lock", ".DS_Store")


def insert_after_table_row(text: str, anchor: str, row: str) -> str:
    if row in text:
        return text
    lines = text.splitlines()
    idx = next((i for i, l in enumerate(lines) if anchor in l), None)
    if idx is None:
        raise SystemExit(f"anchor not found: {anchor}")
    while idx + 1 < len(lines) and lines[idx + 1].startswith("|"):
        idx += 1
    lines.insert(idx + 1, row)
    return "\n".join(lines) + "\n"


def main(repo: Path):
    app = repo / "apps/python/dialtone"
    shutil.rmtree(app, ignore_errors=True)
    shutil.copytree(ROOT, app, ignore=IGNORE)
    skill = repo / "skills/dialtone-handshake"
    shutil.rmtree(skill, ignore_errors=True)
    shutil.copytree(ROOT / "skills/dialtone-handshake", skill)

    readme = repo / "README.md"
    text = readme.read_text()
    text = insert_after_table_row(text, "| App | Language | Purpose |", APP_ROW)
    if SAFETY_BULLET not in text:
        m = re.search(r"^### Safety patterns\s*\n(?:\s*\n)?((?:- .*\n)+)", text, re.M)
        if m:
            text = text[: m.end()] + SAFETY_BULLET + "\n" + text[m.end():]
    readme.write_text(text)

    apps_readme = repo / "apps/README.md"
    apps_readme.write_text(insert_after_table_row(apps_readme.read_text(), "| App | Language | Purpose |", APPS_ROW))

    leaks = subprocess.run(["grep", "-rInE", r"iams_live_[A-Za-z0-9]{6,}|AQ\.[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}", str(app), str(skill)],
                           capture_output=True, text=True).stdout
    if leaks:
        raise SystemExit(f"possible secret in package:\n{leaks}")
    print(subprocess.run([sys.executable, "scripts/validate_repository.py"], cwd=repo, capture_output=True, text=True).stdout[-2000:])


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
