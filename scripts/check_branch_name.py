#!/usr/bin/env python3
"""Validate branch names for this repository."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass

BRANCH_NAME_PATTERN = re.compile(
    r"^(feat|fix|docs|chore|refactor|test|ci|build|release|hotfix|spike)/[a-z0-9]+(-[a-z0-9]+)*$"
)
DOC_PATH = "docs/git-naming-conventions.md"
LONG_LIVED_BRANCHES = {"main", "master"}
GENERATED_BRANCHES = {"changeset-release/main"}


@dataclass(frozen=True)
class BranchValidation:
    ok: bool
    skipped: bool
    message: str


def read_current_branch() -> str:
    env_branch = (
        os.environ.get("GITHUB_HEAD_REF")
        or os.environ.get("BRANCH_NAME")
        or os.environ.get("GITHUB_REF_NAME")
    )
    if env_branch:
        return env_branch

    result = subprocess.run(
        ["git", "branch", "--show-current"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("Unable to read the current git branch.", file=sys.stderr)
        raise SystemExit(result.returncode or 1)

    return result.stdout.strip()


def validate_branch_name(
    branch_name: str,
    *,
    allow_long_lived: bool = False,
) -> BranchValidation:
    if not branch_name:
        return BranchValidation(
            ok=True,
            skipped=True,
            message="No branch name found; skipping branch name check.",
        )

    if allow_long_lived and branch_name in LONG_LIVED_BRANCHES:
        return BranchValidation(
            ok=True,
            skipped=True,
            message=f"Skipping branch name check for long-lived branch: {branch_name}",
        )

    if allow_long_lived and branch_name in GENERATED_BRANCHES:
        return BranchValidation(
            ok=True,
            skipped=True,
            message=f"Skipping branch name check for generated branch: {branch_name}",
        )

    if not BRANCH_NAME_PATTERN.fullmatch(branch_name):
        return BranchValidation(
            ok=False,
            skipped=False,
            message="\n".join(
                [
                    f"Invalid branch name: {branch_name}",
                    f"Expected <type>/<short-kebab-summary> from {DOC_PATH}.",
                    "Allowed types: feat, fix, docs, chore, refactor, test, ci, build, release, hotfix, spike.",
                    "Example: docs/git-naming-conventions",
                ]
            ),
        )

    return BranchValidation(
        ok=True,
        skipped=False,
        message=f"Branch name follows {DOC_PATH}: {branch_name}",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate this repository's branch naming convention.",
    )
    parser.add_argument(
        "branch",
        nargs="?",
        help="Branch name to validate. If omitted, the current branch is used.",
    )
    parser.add_argument(
        "--branch",
        dest="branch_option",
        help="Branch name to validate. Takes precedence over the positional branch.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    explicit_branch = args.branch_option or args.branch or ""
    branch_name = explicit_branch or read_current_branch()
    result = validate_branch_name(branch_name, allow_long_lived=not explicit_branch)

    if result.ok:
        print(result.message)
        return 0

    print(result.message, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
