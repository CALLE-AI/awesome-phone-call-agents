"""Repo-wide safety net: fails if a phone-number-shaped pattern outside the
officially reserved fictional ranges is found anywhere in this app's source
tree. A real phone number was once accidentally used as a test fixture and
pushed to a public fork before being caught and scrubbed from history — this
makes sure anyone who runs the test suite catches it before committing, not
just a specific contributor's local git hooks."""
from pathlib import Path

from pipeline.guardrails import find_unsafe_phone_numbers

APP_ROOT = Path(__file__).resolve().parent.parent
SCAN_SUFFIXES = {".py", ".md", ".json", ".txt", ".toml"}
SKIP_DIR_NAMES = {".venv", "__pycache__", ".pytest_cache", ".git"}
# .llm_budget_state.json is gitignored and only ever holds a date and a
# dollar amount — skipped because a spend value can coincidentally look
# phone-shaped once its decimal point is stripped, not because it's exempt
# from mattering. .call_guardrail_state.json is deliberately NOT in this
# list, even though it's also gitignored: it's the one file in this app
# most likely to accumulate a real dialed number during actual use, so it
# stays in scope as a backstop in case .gitignore is ever bypassed.
SKIP_FILE_NAMES = {".llm_budget_state.json"}


def test_no_unsafe_phone_numbers_in_source_tree():
    flagged = []
    for path in APP_ROOT.rglob("*"):
        if path.is_dir() or path.suffix not in SCAN_SUFFIXES or path.name in SKIP_FILE_NAMES:
            continue
        if SKIP_DIR_NAMES & set(path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for match in find_unsafe_phone_numbers(text):
            flagged.append(f"{path.relative_to(APP_ROOT)}: {match!r}")

    # Deliberately spelled with "XXX" rather than a literal digit range —
    # writing the range out with real boundary digits and a dash would itself
    # look like a phone number to the very heuristic this message explains.
    assert not flagged, (
        "Phone-number-shaped pattern(s) found outside the officially reserved fictional "
        "ranges (use Ofcom 07700900XXX / 02079460XXX, or NANP 555-01XX):\n" + "\n".join(flagged)
    )
