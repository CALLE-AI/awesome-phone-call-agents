#!/usr/bin/env python3
"""Create a validated Git branch for this repository."""

from __future__ import annotations

import argparse
import subprocess
import sys

from check_branch_name import validate_branch_name


def run_git(args: list[str], *, inherit_stdio: bool = False) -> subprocess.CompletedProcess[str]:
    if inherit_stdio:
        return subprocess.run(["git", *args], check=False, text=True)
    return subprocess.run(
        ["git", *args],
        check=False,
        capture_output=True,
        text=True,
    )


def fail(message: str, status: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(status)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a branch after validating the repository naming convention.",
    )
    parser.add_argument(
        "branch",
        nargs="?",
        help="Branch name to create, for example docs/git-naming-conventions.",
    )
    parser.add_argument(
        "--branch",
        dest="branch_option",
        help="Branch name to create. Takes precedence over the positional branch.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    branch_name = args.branch_option or args.branch or ""

    if not branch_name:
        fail("Usage: python3 scripts/create_branch.py <type>/<short-kebab-summary>")

    validation = validate_branch_name(branch_name)
    if not validation.ok:
        fail(validation.message)

    ref_format = run_git(["check-ref-format", "--branch", branch_name])
    if ref_format.returncode != 0:
        fail(f"Invalid git ref format: {branch_name}", ref_format.returncode or 1)

    local_branch = run_git(
        ["show-ref", "--verify", "--quiet", f"refs/heads/{branch_name}"]
    )
    if local_branch.returncode == 0:
        fail(f"Local branch already exists: {branch_name}")

    remote_branch = run_git(
        ["show-ref", "--verify", "--quiet", f"refs/remotes/origin/{branch_name}"]
    )
    if remote_branch.returncode == 0:
        fail(f"Fetched origin branch already exists: {branch_name}")

    print(validation.message)
    switch_result = run_git(["switch", "-c", branch_name], inherit_stdio=True)
    return switch_result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
