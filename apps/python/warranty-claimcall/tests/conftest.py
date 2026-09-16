"""Shared helpers for the ClaimCall CLI tests."""

from __future__ import annotations

from pathlib import Path

from claimcall.schemas import ClaimFile

FIXTURES = Path(__file__).resolve().parent.parent / "claimcall" / "fixtures"


def fixture_path(name: str) -> str:
    return str(FIXTURES / name)


def load_claim(name: str) -> ClaimFile:
    return ClaimFile.model_validate_json((FIXTURES / name).read_text())
