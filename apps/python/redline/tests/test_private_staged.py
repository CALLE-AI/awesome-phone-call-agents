"""The package-local hook must block private inputs even after `git add -f`."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_private_staged.py"
HOOK = Path(__file__).resolve().parent.parent / ".githooks" / "pre-commit"


def load_scanner():
    spec = importlib.util.spec_from_file_location("check_private_staged", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_private_inputs_are_rejected_by_basename() -> None:
    scanner = load_scanner()
    assert scanner.private_staged_paths(
        ["apps/python/redline/.env", "customer/redline.scope.yaml", "README.md"]
    ) == ["apps/python/redline/.env", "customer/redline.scope.yaml"]


def test_public_examples_and_normal_files_are_allowed() -> None:
    scanner = load_scanner()
    assert scanner.private_staged_paths(
        ["apps/python/redline/.env.example", "redline.scope.example.yaml", "redline.yaml"]
    ) == []


def test_the_hook_and_scanner_ship_together() -> None:
    assert SCRIPT.is_file()
    assert HOOK.is_file()
    assert "check_private_staged.py" in HOOK.read_text(encoding="utf-8")


def test_a_force_added_scope_file_is_refused_from_the_real_index(
    tmp_path: Path,
) -> None:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / ".gitignore").write_text("redline.scope.yaml\n", encoding="utf-8")
    (tmp_path / "redline.scope.yaml").write_text("private\n", encoding="utf-8")
    subprocess.run(
        ["git", "add", "-f", "redline.scope.yaml"], cwd=tmp_path, check=True
    )

    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "redline.scope.yaml" in result.stderr
