"""Pytest configuration for firstbell tests."""
from pathlib import Path
import pytest


@pytest.fixture(autouse=True)
def _chdir_to_app_root(monkeypatch):
    """Ensure relative paths like examples/absences.csv resolve from app root."""
    app_root = Path(__file__).resolve().parents[1]
    monkeypatch.chdir(app_root)
