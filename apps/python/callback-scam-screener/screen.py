"""Screen a suspicious callback-scam email against a phone number.

Default mode is PREVIEW: parses the email, runs prechecks, and prints the
number that would be dialed and the task CALL-E would receive. It contacts
nothing and needs no credentials.

--demo runs a deterministic, zero-credential walkthrough against a canned
sample transcript instead — no CALL-E account or API key needed, nothing is
dialed.

Live mode requires --live, --confirm, and --to-phone matching the number
extracted from the email exactly (this app never guesses which number to
dial). It places exactly one real CALL-E call and scores the real transcript
with your own ANTHROPIC_API_KEY — see docs/CONCEPT.md for full design notes.

Usage:
  python screen.py --demo remote_access
  python screen.py --email suspicious.txt --sender-domain example.com
  python screen.py --email suspicious.txt --sender-domain example.com \\
      --live --confirm --to-phone "+18005550187" \\
      --allow-number "+18005550187"
"""
import argparse
import functools
import json
import sys
import warnings
from pathlib import Path

from pipeline.caller import MockCallEClient, RealCallEClient
from pipeline.guardrails import BudgetExceeded, CallGuardrails, GuardrailViolation, LLMBudgetGuard, normalize_phone
from pipeline.llm_providers import PROVIDERS as LLM_PROVIDERS
from pipeline.orchestrator import SCREENER_TASK_TEMPLATE, run_pipeline
from pipeline.signal_catalog import tag_transcript_llm
from pipeline.trigger import extract_alert

SAMPLES = Path(__file__).parent / "samples"

DEMO_SCENARIOS = {
    "remote_access": "transcript_scam_remote_access.txt",  # asks to install AnyDesk -> likely_scam, distinct warning
    "giftcard": "transcript_scam_giftcard.txt",  # asks for a gift card -> likely_scam
    "subtle": "transcript_subtle.txt",  # patient, evasive caller -> inconclusive
    "legit": "transcript_legit.txt",  # cooperative, verifiable caller -> likely_legitimate
}

EXIT_OK = 0
EXIT_NOT_SUSPICIOUS = 0  # a clean, correctly-not-flagged email is not an error
EXIT_USAGE_OR_REFUSAL = 50
EXIT_CALLE_REJECTED_PLAN = 51
EXIT_BUDGET_OR_GUARDRAIL = 52


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--demo",
        choices=sorted(DEMO_SCENARIOS),
        default=None,
        help="Run a canned scenario against a mock CALL-E client instead of --email/--live. No account, no API "
        "key, nothing is dialed.",
    )
    parser.add_argument("--email", type=Path, default=None, help="Path to the suspicious email body (text file). Required unless --demo.")
    parser.add_argument("--sender-domain", default=None, help="Domain the email actually came from. Required unless --demo.")
    parser.add_argument("--official-number", default=None, help="The claimed company's real published support number, if known.")
    parser.add_argument("--live", action="store_true", help="Place a real call instead of previewing.")
    parser.add_argument("--confirm", action="store_true", help="Required alongside --live — explicit intent, not implied by --live alone.")
    parser.add_argument("--to-phone", default=None, help="Must exactly match the number extracted from --email. Required with --live.")
    parser.add_argument(
        "--allow-number",
        action="append",
        default=None,
        help="Add a number to the dev/test allowlist enforced before dialing. Repeatable. "
        "Omit entirely to run unrestricted (production mode).",
    )
    parser.add_argument(
        "--daily-budget-usd",
        type=float,
        default=1.00,
        help="Best-effort daily cap on LLM spend for transcript tagging, in USD (default: $1.00 — a conservative "
        "starting point, not a limit on what CALL-E itself can cost you). Raise it if your own usage needs more.",
    )
    parser.add_argument(
        "--max-calls-per-day",
        type=int,
        default=20,
        help="Best-effort daily cap on how many screening calls this app will place (default: 20, matching "
        "CALL-E's free tier). Raise it if you're on a paid plan with more headroom.",
    )
    parser.add_argument(
        "--llm-provider",
        choices=sorted(LLM_PROVIDERS),
        default="anthropic",
        help="Which LLM reads the transcript and tags scam signals (default: anthropic). Reads that provider's "
        "own API key from your environment — see pipeline/llm_providers.py. Only install the SDK you need: "
        "`uv sync --extra anthropic` or `uv sync --extra gemini`.",
    )
    parser.add_argument(
        "--llm-model",
        default=None,
        help="Override the default model for --llm-provider (e.g. a specific Gemini or Claude model name).",
    )
    parser.add_argument(
        "--calle-request-timeout-seconds",
        type=float,
        default=60.0,
        help="Per-request timeout passed to the calle CLI (default: 60 — the CLI's own default of 15 has been "
        "seen timing out a real plan_call). Raise it if you keep seeing 'MCP request timed out' errors.",
    )
    args = parser.parse_args()

    if args.demo:
        email_body = (SAMPLES / "suspicious_email.txt").read_text(encoding="utf-8-sig")
        transcript = (SAMPLES / DEMO_SCENARIOS[args.demo]).read_text(encoding="utf-8-sig")
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
            return EXIT_NOT_SUSPICIOUS
        print(json.dumps(result.to_dict(), indent=2))
        return EXIT_OK

    if not args.email or not args.sender_domain:
        parser.error("--email and --sender-domain are required unless --demo is used.")

    email_body = args.email.read_text(encoding="utf-8-sig")
    alert = extract_alert(email_body, args.sender_domain)
    if alert is None:
        print("Email did not meet the suspicious-alert threshold — nothing would be dialed.")
        return EXIT_NOT_SUSPICIOUS

    task_preview = SCREENER_TASK_TEMPLATE.format(phone_number=alert.phone_number)

    if not args.live:
        print("PREVIEW — no call will be placed. Add --live --confirm --to-phone <number> to place a real call.\n")
        print("Phone number extracted:", alert.phone_number)
        print("Claimed reason:", alert.claimed_reason)
        print("\nTask CALL-E would receive:\n")
        print(task_preview)
        return EXIT_OK

    if not args.confirm:
        print("Refusing to place a live call without --confirm (explicit intent required alongside --live).", file=sys.stderr)
        return EXIT_USAGE_OR_REFUSAL
    if not args.to_phone:
        print("Refusing to place a live call without --to-phone.", file=sys.stderr)
        return EXIT_USAGE_OR_REFUSAL
    if normalize_phone(args.to_phone) != normalize_phone(alert.phone_number):
        print(
            f"--to-phone ({args.to_phone}) does not match the number extracted from the email "
            f"({alert.phone_number}) — refusing to guess which number to dial.",
            file=sys.stderr,
        )
        return EXIT_USAGE_OR_REFUSAL

    guardrails = CallGuardrails(
        allowed_numbers=set(args.allow_number) if args.allow_number else None,
        max_calls=args.max_calls_per_day,
    )
    budget = LLMBudgetGuard(daily_limit_usd=args.daily_budget_usd)
    tagger = functools.partial(
        tag_transcript_llm, provider=args.llm_provider, model=args.llm_model, budget=budget
    )

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = run_pipeline(
                email_body=email_body,
                sender_domain=args.sender_domain,
                call_client=RealCallEClient(request_timeout_seconds=args.calle_request_timeout_seconds),
                official_support_number=args.official_number,
                guardrails=guardrails,
                tagger=tagger,
            )
            for w in caught:
                print(f"\n*** {w.message} ***\n", file=sys.stderr)
    except (GuardrailViolation, BudgetExceeded) as e:
        print(f"Refusing to place this call: {e}", file=sys.stderr)
        return EXIT_BUDGET_OR_GUARDRAIL
    except RuntimeError as e:
        print(f"CALL-E would not plan this call: {e}", file=sys.stderr)
        return EXIT_CALLE_REJECTED_PLAN

    if result is None:
        print("Email did not meet the suspicious-alert threshold — no call placed.")
        return EXIT_NOT_SUSPICIOUS

    print(json.dumps(result.to_dict(), indent=2))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
