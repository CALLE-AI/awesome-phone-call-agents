"""Deterministic, zero-credential walkthrough of the pipeline against canned
sample transcripts — no CALL-E account or API key needed, nothing is dialed.
Usage: python demo.py [remote_access|giftcard|subtle|legit]

For a real run against a real email and a real phone number, see screen.py,
which previews by default and requires --live --confirm to place a call.
"""
import json
import sys
import warnings
from pathlib import Path

from pipeline.caller import MockCallEClient
from pipeline.orchestrator import run_pipeline

SAMPLES = Path(__file__).parent / "samples"

SCENARIOS = {
    "remote_access": "transcript_scam_remote_access.txt",
    "giftcard": "transcript_scam_giftcard.txt",
    "subtle": "transcript_subtle.txt",
    "legit": "transcript_legit.txt",
}


def main() -> None:
    scenario = sys.argv[1] if len(sys.argv) > 1 else "remote_access"
    if scenario not in SCENARIOS:
        print(f"Unknown scenario '{scenario}'. Choose from: {', '.join(SCENARIOS)}")
        return

    email_body = (SAMPLES / "suspicious_email.txt").read_text(encoding="utf-8")
    transcript = (SAMPLES / SCENARIOS[scenario]).read_text(encoding="utf-8")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = run_pipeline(
            email_body=email_body,
            sender_domain="secure-alerts-billing.com",
            call_client=MockCallEClient(canned_transcript=transcript),
        )
        for w in caught:
            print(f"\n*** {w.message} ***\n")

    if result is None:
        print("Email did not meet the suspicious-alert threshold — no call placed.")
        return

    print(json.dumps(result.to_dict(), indent=2))


if __name__ == "__main__":
    main()
