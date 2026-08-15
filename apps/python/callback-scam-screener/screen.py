"""Screen a suspicious callback-scam email against a real phone number.

Default mode is PREVIEW: parses the email, runs prechecks, and prints the
number that would be dialed and the task CALL-E would receive. It contacts
nothing and needs no credentials.

Live mode requires --live, --confirm, and --to-phone matching the number
extracted from the email exactly (this app never guesses which number to
dial). It places exactly one real CALL-E call and scores the real transcript
with your own ANTHROPIC_API_KEY — see docs/CONCEPT.md for full design notes.

Usage:
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

from pipeline.caller import RealCallEClient
from pipeline.guardrails import BudgetExceeded, CallGuardrails, GuardrailViolation, LLMBudgetGuard, normalize_phone
from pipeline.orchestrator import SCREENER_TASK_TEMPLATE, run_pipeline
from pipeline.signal_catalog import tag_transcript_llm
from pipeline.trigger import extract_alert

EXIT_OK = 0
EXIT_NOT_SUSPICIOUS = 0  # a clean, correctly-not-flagged email is not an error
EXIT_USAGE_OR_REFUSAL = 50
EXIT_CALLE_REJECTED_PLAN = 51
EXIT_BUDGET_OR_GUARDRAIL = 52


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, type=Path, help="Path to the suspicious email body (text file).")
    parser.add_argument("--sender-domain", required=True, help="Domain the email actually came from.")
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
        help="Hard daily cap on LLM spend for transcript tagging, in USD (default: $1.00 — a conservative "
        "starting point, not a limit on what CALL-E itself can cost you). Raise it if your own usage needs more.",
    )
    parser.add_argument(
        "--max-calls-per-day",
        type=int,
        default=20,
        help="Hard daily cap on how many screening calls this app will place (default: 20, matching CALL-E's "
        "free tier). Raise it if you're on a paid plan with more headroom.",
    )
    args = parser.parse_args()

    email_body = args.email.read_text(encoding="utf-8")
    alert = extract_alert(email_body, args.sender_domain)
    if alert is None:
        print("Email did not meet the suspicious-alert threshold — nothing would be dialed.")
        return EXIT_NOT_SUSPICIOUS

    task_preview = SCREENER_TASK_TEMPLATE.format(
        phone_number=alert.phone_number,
        claimed_reason=alert.claimed_reason or "an urgent account issue",
    )

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
    tagger = functools.partial(tag_transcript_llm, budget=budget)

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = run_pipeline(
                email_body=email_body,
                sender_domain=args.sender_domain,
                call_client=RealCallEClient(),
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
