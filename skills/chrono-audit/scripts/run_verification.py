#!/usr/bin/env python3
"""
CLI entry point. Two ways to feed it a PR:

    # 1. Directly
    python scripts/run_verification.py --title "..." --body "..." --pr-ref "local#1"

    # 2. From a GitHub Actions pull_request event payload
    python scripts/run_verification.py --github-event $GITHUB_EVENT_PATH

Exit codes (meant to gate a CI job):
    0 = VERIFIED
    1 = BLOCKED           (a claimed authorization was contradicted)
    2 = NEEDS_HUMAN_REVIEW (fail closed — could not confidently verify)

The phonebook (name -> real phone number) is intentionally never derived
from the PR itself — see docs/SAFETY.md on why that would defeat the
whole point. It comes from a separately maintained JSON file.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chrono_audit.config import Config  # noqa: E402
from chrono_audit.github_integration import post_pr_comment, set_commit_status  # noqa: E402
from chrono_audit.models import Verdict  # noqa: E402
from chrono_audit.verifier import ChronoAuditor  # noqa: E402

_EXIT_CODE = {
    Verdict.VERIFIED: 0,
    Verdict.BLOCKED: 1,
    Verdict.NEEDS_HUMAN_REVIEW: 2,
}


def _load_phonebook(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {}
    with p.open() as f:
        raw = json.load(f)
    return {k.strip().lower(): v for k, v in raw.items()}


def _load_from_github_event(event_path: str):
    with open(event_path) as f:
        event = json.load(f)
    pr = event.get("pull_request", {})
    title = pr.get("title", "")
    body = pr.get("body", "") or ""
    number = pr.get("number")
    sha = pr.get("head", {}).get("sha")
    repo_full_name = event.get("repository", {}).get("full_name", "")
    return title, body, number, sha, repo_full_name


def main() -> int:
    parser = argparse.ArgumentParser(description="Run CHRONO-AUDIT against one PR.")
    parser.add_argument("--title", default="")
    parser.add_argument("--body", default="")
    parser.add_argument("--pr-ref", default="local")
    parser.add_argument("--pr-number", type=int, default=None)
    parser.add_argument("--commit-sha", default=None)
    parser.add_argument("--github-event", default=None, help="Path to a GitHub Actions event JSON file")
    parser.add_argument(
        "--phonebook",
        default="phonebook.json",
        help="JSON file mapping authorizer name -> E.164 phone number",
    )
    parser.add_argument(
        "--post-to-github",
        action="store_true",
        help="Post the verdict as a PR comment / commit status (requires GITHUB_TOKEN)",
    )
    args = parser.parse_args()

    title, body, pr_number, commit_sha = args.title, args.body, args.pr_number, args.commit_sha

    if args.github_event:
        title, body, gh_number, gh_sha, _repo = _load_from_github_event(args.github_event)
        pr_number = pr_number or gh_number
        commit_sha = commit_sha or gh_sha

    config = Config.from_env()
    phonebook = _load_phonebook(args.phonebook)
    auditor = ChronoAuditor(config=config, phonebook=phonebook)

    outcome = auditor.audit_pr(pr_reference=args.pr_ref, title=title, body=body)

    print(outcome.to_markdown())
    print(f"[chrono-audit] dress_rehearsal={config.dress_rehearsal} verdict={outcome.verdict.value}")

    if args.post_to_github:
        if pr_number:
            post_pr_comment(config, pr_number, outcome)
        if commit_sha:
            set_commit_status(config, commit_sha, outcome)

    return _EXIT_CODE[outcome.verdict]


if __name__ == "__main__":
    raise SystemExit(main())
