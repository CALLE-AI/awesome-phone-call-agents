"""Nothing this contribution adds to the repository may carry real-world data.

The repository's public zone holds synthetic data only. This test is the
machine-checkable half of that rule for the files this contribution owns; the
whole-repository and git-history sweep lives outside the repository, because a
check that ships in the thing it checks is not much of a check.
"""

from __future__ import annotations

import re
from pathlib import Path

from warrantyops.config import find_repository_root

REPO_ROOT = find_repository_root()
assert REPO_ROOT is not None

CONTRIBUTION_PATHS = (
    REPO_ROOT / "apps" / "python" / "warrantyops",
    REPO_ROOT / "skills" / "warranty-recovery",
    REPO_ROOT / "apps" / "python" / "warrantyops" / "PHASE0_HANDOFF.md",
)

TEXT_SUFFIXES = {".py", ".md", ".json", ".toml", ".yaml", ".yml", ".txt", ".jsonl"}
SKIP_DIRS = {"__pycache__", "node_modules", "artifacts"}

#: North American fictional numbers reserved for use in fiction: the 555-0100
#: to 555-0199 block. Any other +1 number in these files is a defect.
RESERVED_US_RE = re.compile(r"^\+1\d{3}55501\d{2}$")
US_E164_RE = re.compile(r"\+1\d{10}")

SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{20,}"),
    re.compile(r"\bcalle_(?:live|prod|sk)_[A-Za-z0-9]{8,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)

#: Identifiers in the CALL-E vocabulary that share the ``call_`` prefix without
#: being call ids: object names, webhook event names and stable error codes.
#: ``call_dMU`` and ``call_Zs2`` are deliberately different: each is the
#: *masked* public form of one real recorded call — prefix only, the middle
#: elided — and the data-zone rules allow exactly those two forms. This is a
#: list of one-time evidence facts, never a class of permitted prefixes.
DOCUMENTED_CALL_TOKENS = frozenset(
    {
        "call_id",
        "call_task",
        "call_failed",
        "call_completed",
        "call_not_ready",
        "call_dMU",
        "call_Zs2",
        "call_result_validation_failed",
        # Structured-observation event/reason names, not provider call ids.
        "call_created",
        "call_id_persisted",
    }
)

def text_files() -> list[Path]:
    files: list[Path] = []
    for root in CONTRIBUTION_PATHS:
        if not root.exists():
            continue
        if root.is_file():
            files.append(root)
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                continue
            # Dot-directories (.mypy_cache, .ruff_cache, .hypothesis,
            # .pytest_cache, .venv) are machine-local, git-ignored tool
            # caches, not contribution content — nothing inside them is
            # data this contribution ships.
            parts = path.relative_to(REPO_ROOT).parts
            if SKIP_DIRS & set(parts) or any(p.startswith(".") for p in parts):
                continue
            files.append(path)
    return files


def test_the_contribution_has_files_to_check():
    assert text_files()


def test_only_reserved_fictional_numbers_appear():
    offenders: list[str] = []
    for path in text_files():
        text = path.read_text(encoding="utf-8")
        for number in US_E164_RE.findall(text):
            if not RESERVED_US_RE.fullmatch(number):
                offenders.append(f"{path.relative_to(REPO_ROOT)}: non-reserved number")
    assert not offenders, offenders


def test_no_credential_shaped_strings_appear():
    offenders: list[str] = []
    for path in text_files():
        text = path.read_text(encoding="utf-8")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                offenders.append(f"{path.relative_to(REPO_ROOT)}: {pattern.pattern}")
    assert not offenders, offenders


def test_every_synthetic_call_id_is_labelled_synthetic():
    offenders: list[str] = []
    for path in text_files():
        text = path.read_text(encoding="utf-8")
        for call_id in re.findall(r"\bcall_[A-Za-z0-9_-]+", text):
            if "synthetic" not in call_id and call_id not in DOCUMENTED_CALL_TOKENS:
                offenders.append(f"{path.relative_to(REPO_ROOT)}: {call_id}")
    assert not offenders, offenders
