#!/usr/bin/env python3
"""
git voice-blame — Trace lines of code back to the human phone call that authorized them.

Usage:
  python scripts/git_voice_blame.py --commit <sha>
  python scripts/git_voice_blame.py --file <file_path> [--line <line_number>]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Ensure chrono_audit is in path
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from chrono_audit.attestation import load_attestation, VoiceAttestation


def print_voice_attestation_card(attest: VoiceAttestation, line_info: str = ""):
    sig_valid = attest.verify()
    sig_badge = "[CRYPTOGRAPHIC SIGNATURE: VALID]" if sig_valid else "[WARNING: INVALID SIGNATURE]"

    print("=" * 72)
    print(f" CHRONO-AUDIT VOICE PROVENANCE RECORD {line_info}")
    print("=" * 72)
    print(f" Commit SHA          : {attest.commit_sha}")
    print(f" Pull Request        : {attest.pr_reference}")
    print(f" Audit Timestamp     : {attest.timestamp_utc}")
    print(f" Verbal Authorizer   : {attest.authorizer_name} ({attest.authorizer_phone_masked})")
    print(f" CALL-E Call UUID    : {attest.call_uuid}")
    print(f" Audio Stream Hash   : sha256:{attest.audio_sha256[:32]}...")
    print(f" Entailment Score    : {attest.entailment_score:.2f} ({attest.entailment_engine})")
    print(f" Merge Gate Verdict  : {attest.verdict}")
    print(f" Attestation Sig     : {attest.signature}")
    print(f" Integrity Status    : {sig_badge}")
    print("-" * 72)
    print(" Authorizer Transcript Statement:")
    print(f"   \"{attest.authorizer_statement}\"")
    print("=" * 72)


def blame_file_line(file_path: str, line_no: int):
    path = Path(file_path)
    if not path.exists():
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    # Run git blame
    cmd = ["git", "blame", "-L", f"{line_no},{line_no}", "--porcelain", str(path)]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        commit_sha = res.stdout.splitlines()[0].split()[0]
    except Exception as e:
        print(f"Git blame lookup failed: {e}", file=sys.stderr)
        sys.exit(1)

    attest = load_attestation(commit_sha)
    if not attest:
        print(f"No voice attestation record found for commit {commit_sha[:8]} on line {line_no}.")
        print("This commit was likely created via standard digital approval rather than verbal authorization.")
        sys.exit(0)

    print_voice_attestation_card(attest, line_info=f"[{file_path}:{line_no}]")


def main():
    parser = argparse.ArgumentParser(description="Query telephony voice provenance for Git commits")
    parser.add_argument("--commit", type=str, help="Commit SHA to inspect")
    parser.add_argument("--file", type=str, help="File path to blame")
    parser.add_argument("--line", type=int, default=1, help="Line number (default: 1)")
    args = parser.parse_args()

    if args.commit:
        attest = load_attestation(args.commit)
        if not attest:
            print(f"No voice attestation found for commit {args.commit}.", file=sys.stderr)
            sys.exit(1)
        print_voice_attestation_card(attest)
    elif args.file:
        blame_file_line(args.file, args.line)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
