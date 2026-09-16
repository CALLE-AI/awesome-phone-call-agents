"""The v1.0.0 freeze cannot drift from package metadata or pinned artifacts."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import warrantyops

APP = Path(__file__).resolve().parents[1]


def test_package_and_runtime_versions_are_frozen_at_1_0_0() -> None:
    pyproject = (APP / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version = "([^"]+)"$', pyproject, re.MULTILINE)
    assert match is not None
    assert match.group(1) == "1.0.0"
    assert warrantyops.__version__ == "1.0.0"


def test_the_release_changelog_names_the_frozen_boundary() -> None:
    changelog = (APP / "CHANGELOG.md").read_text(encoding="utf-8")
    assert "## 1.0.0 — 2026-09-13" in changelog
    assert "R8 and R3" in changelog
    assert "produce no platform evidence" in changelog
    assert "separately gated by the owner" in changelog


def test_release_artifact_checksums_match_the_pinned_manifest() -> None:
    manifest = APP / "proof" / "release-v1.0.0.sha256"
    entries = manifest.read_text(encoding="utf-8").splitlines()
    assert entries
    for entry in entries:
        expected, relative_path = entry.split("  ", 1)
        assert relative_path.startswith("proof/")
        artifact = APP / relative_path
        observed = hashlib.sha256(artifact.read_bytes()).hexdigest()
        assert observed == expected
