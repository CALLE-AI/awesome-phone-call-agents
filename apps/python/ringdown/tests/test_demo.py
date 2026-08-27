from __future__ import annotations

import re
import subprocess
import sys
from typing import NamedTuple

import pytest

from tests.data import EXAMPLES

APP = EXAMPLES.parent
EXPECTED = APP / "demo" / "EXPECTED.md"
LEDGER = EXAMPLES / "ledger.example.jsonl"
QUOTED = re.compile(r"```text\n(.*?)```", re.S)
WALL_CLOCK = re.compile(r"\b\d\d:\d\d local")


class DemoRun(NamedTuple):
    output: str
    committed_ledger: bytes
    written_ledger: bytes


def settle(text: str) -> str:
    return WALL_CLOCK.sub("HH:MM local", text).rstrip("\n")


def quoted_blocks() -> list[str]:
    return [settle(block) for block in QUOTED.findall(EXPECTED.read_text())]


@pytest.fixture(scope="module")
def demo_run() -> DemoRun:
    committed = LEDGER.read_bytes()
    try:
        run = subprocess.run(
            [sys.executable, "-m", "demo.run_local"],
            cwd=APP,
            capture_output=True,
            text=True,
            check=True,
        )
        written = LEDGER.read_bytes()
    finally:
        LEDGER.write_bytes(committed)
    return DemoRun(settle(run.stdout), committed, written)


def test_the_demo_prints_every_block_expected_md_quotes_in_the_order_it_quotes_them(demo_run):
    blocks = quoted_blocks()

    assert blocks, "EXPECTED.md quotes no output at all"

    read_up_to = 0
    for block in blocks:
        found = demo_run.output.find(block, read_up_to)
        assert found >= 0, (
            "EXPECTED.md quotes output the demo no longer prints, or prints out of order. "
            "Run python -m demo.run_local and reconcile:\n\n" + block
        )
        read_up_to = found + len(block)


def test_the_committed_example_ledger_is_the_one_the_demo_writes(demo_run):
    assert demo_run.written_ledger == demo_run.committed_ledger, (
        "examples/ledger.example.jsonl is not what the demo writes any more. "
        "Run python -m demo.run_local and commit the file as it comes out."
    )
