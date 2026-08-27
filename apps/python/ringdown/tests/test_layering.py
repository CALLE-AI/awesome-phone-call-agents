from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parent.parent / "ringdown"

PURE = ("extract", "dispositions", "calls", "checks", "canonical", "incident", "script",
        "adapter", "exits")

FORBIDDEN = [
    ("extract", "ringdown.calle"),
    ("dispositions", "ringdown.calle"),
    ("report", "ringdown.calle"),
    ("report", "ringdown.dispositions"),
    ("calls", "ringdown.calle"),
    ("checks", "ringdown.verify"),
    ("audit", "ringdown.escalate"),
]


def imports_of(module: str) -> set[str]:
    tree = ast.parse((PACKAGE / f"{module}.py").read_text())
    annotations_only = {
        id(inner)
        for node in ast.walk(tree)
        if isinstance(node, ast.If) and ast.unparse(node.test) == "TYPE_CHECKING"
        for inner in ast.walk(node)
    }
    names: set[str] = set()
    for node in ast.walk(tree):
        if id(node) in annotations_only:
            continue
        if isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
        elif isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
    return names


def loads(module: str, loaded: str) -> bool:
    probe = f"import ringdown.{module}, sys; print({loaded!r} in sys.modules)"
    done = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    return done.stdout.strip() == "True"


@pytest.mark.parametrize("module,forbidden", FORBIDDEN)
def test_a_layer_never_imports_the_one_that_is_supposed_to_depend_on_it(module, forbidden):
    assert forbidden not in imports_of(module)


@pytest.mark.parametrize("module", PURE + ("audit",))
def test_a_layer_that_never_calls_out_does_not_drag_in_the_http_client(module):
    assert not loads(module, "urllib.request")


def test_reading_a_ledger_does_not_load_the_provider_client():
    assert not loads("audit", "ringdown.calle")
