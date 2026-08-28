"""Screen a suspicious callback-scam email against a phone number.

Default mode is PREVIEW: parses the email, runs prechecks, and prints the
number that would be dialed and the task CALL-E would receive. It contacts
nothing and needs no credentials.

--demo runs a deterministic, zero-credential walkthrough against a canned
sample transcript instead — no CALL-E account or API key needed, nothing is
dialed.

Live mode requires --live, --confirm, and --to-phone matching the number
extracted from the email exactly (this app never guesses which number to
dial) and in strict E.164 format. It also requires either --allow-number
(dev/test allowlist, itself an exact per-number gate) or both --unrestricted
and --confirm-number (an explicit, destination-specific authorization for
that exact E.164 number) — there is no silent unrestricted default, and
--unrestricted alone is not accepted as authorization to dial a specific
destination. It places exactly one real CALL-E call and scores the real
transcript with your own --llm-provider's API key (default: gemini, reads
GEMINI_API_KEY/GOOGLE_API_KEY) — see docs/CONCEPT.md for full design notes.
Printed output masks the dialed number by default; pass --show-full-number
to see it in full.

Usage:
  python screen.py --demo remote_access
  python screen.py --email suspicious.txt --sender-domain example.com
  python screen.py --email suspicious.txt --sender-domain example.com \\
      --live --confirm --to-phone "+18005550187" \\
      --allow-number "+18005550187"
  python screen.py --email suspicious.txt --sender-domain example.com \\
      --live --confirm --to-phone "+18005550187" \\
      --unrestricted --confirm-number "+18005550187"
"""
import argparse
import functools
import json
import sys
import warnings
from pathlib import Path

from pipeline.caller import AmbiguousCallOutcome, MockCallEClient, RealCallEClient
from pipeline.guardrails import (
    BudgetExceeded,
    CallGuardrails,
    GuardrailViolation,
    LLMBudgetGuard,
    is_valid_e164,
    mask_phone_number,
    normalize_phone,
)
from pipeline.llm_providers import PROVIDERS as LLM_PROVIDERS
from pipeline.orchestrator import SCREENER_TASK_TEMPLATE, RecipientMismatch, run_pipeline
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
EXIT_AMBIGUOUS_CALL_OUTCOME = 53
EXIT_RECIPIENT_MISMATCH = 54


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
        help="Add a number to the dev/test allowlist enforced before dialing. Repeatable. If omitted, "
        "--unrestricted must be passed instead — there is no silent unrestricted default.",
    )
    parser.add_argument(
        "--unrestricted",
        action="store_true",
        help="Required alongside --live when --allow-number is omitted: explicitly acknowledges this run may "
        "dial a number that isn't on a pre-verified dev/test allowlist. On its own this is a general "
        "acknowledgment, not authorization for any specific destination — --confirm-number is also required.",
    )
    parser.add_argument(
        "--confirm-number",
        default=None,
        help="Required alongside --unrestricted: the exact E.164 destination you are authorizing this specific "
        "call to dial. Must match --to-phone exactly (strict string equality, typed independently) — this is "
        "the affirmative, destination-specific authorization --unrestricted alone does not provide.",
    )
    parser.add_argument(
        "--show-full-number",
        action="store_true",
        help="Print the dialed phone number in full in the JSON output instead of the default masked form "
        "(e.g. +*********87). Only the printed/returned output is affected — scoring always uses the real "
        "number internally.",
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
        default="gemini",
        help="Which LLM reads the transcript and tags scam signals (default: gemini — currently the only "
        "registered provider, see pipeline/llm_providers.py). Reads that provider's own API key from your "
        "environment. Only install the SDK you need: `uv sync --extra gemini`.",
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
    # Canonicalize once, here, rather than relying on every downstream
    # comparison to strip consistently — incidental leading/trailing
    # whitespace on a copy-pasted --to-phone or --allow-number value could
    # otherwise read as a "different" number to an exact-string comparison
    # (e.g. the recipient-binding check against CALL-E's own clean response).
    if args.to_phone:
        args.to_phone = args.to_phone.strip()
    if args.allow_number:
        args.allow_number = [n.strip() for n in args.allow_number]

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
        print(json.dumps(result.to_dict(mask_numbers=not args.show_full_number), indent=2))
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
        shown_number = alert.phone_number if args.show_full_number else mask_phone_number(alert.phone_number, alert.phone_number)
        shown_task = task_preview if args.show_full_number else mask_phone_number(task_preview, alert.phone_number)
        # claimed_reason is whichever line of the raw email matched an
        # urgency keyword — in a real callback scam that's routinely the
        # same sentence as the callback number itself ("call us now at
        # 555-0187"), so this needs the same masking as everything else here.
        shown_reason = (
            alert.claimed_reason if args.show_full_number else mask_phone_number(alert.claimed_reason, alert.phone_number)
        )
        print("PREVIEW — no call will be placed. Add --live --confirm --to-phone <number> to place a real call.\n")
        print("Phone number extracted:", shown_number)
        print("Claimed reason:", shown_reason)
        print("\nTask CALL-E would receive:\n")
        print(shown_task)
        return EXIT_OK

    if not args.confirm:
        print("Refusing to place a live call without --confirm (explicit intent required alongside --live).", file=sys.stderr)
        return EXIT_USAGE_OR_REFUSAL
    if not args.to_phone:
        print("Refusing to place a live call without --to-phone.", file=sys.stderr)
        return EXIT_USAGE_OR_REFUSAL
    # Intentionally still digit-based/format-tolerant here, not exact-string
    # like the allowlist and recipient-binding checks: alert.phone_number is
    # whatever loosely-formatted text the extraction regex found in the raw
    # email (often with no explicit country code at all, e.g. "(800)
    # 555-0187"), so exact E.164 comparison would reject the very case this
    # check exists to allow - a human confirming, via --to-phone, the number
    # they can already see in the email. This is a "does this match what's
    # in the email" sanity check, not the authorization boundary. --allow-number
    # (below) is an exact gate; --unrestricted is not a gate on the number
    # at all - it's a bare acknowledgment that any destination matching what's
    # in the email is accepted, so in --unrestricted mode this loose,
    # last-10-digit check is the only thing tying the dialed number to the
    # email at all. That's the accepted tradeoff of --unrestricted, not a bug,
    # but --unrestricted does not make this check "exact" the way the
    # allowlist path does.
    if normalize_phone(args.to_phone) != normalize_phone(alert.phone_number):
        print(
            f"--to-phone ({mask_phone_number(args.to_phone, args.to_phone)}) does not match the number "
            f"extracted from the email ({mask_phone_number(alert.phone_number, alert.phone_number)}) — "
            "refusing to guess which number to dial.",
            file=sys.stderr,
        )
        return EXIT_USAGE_OR_REFUSAL
    if not is_valid_e164(args.to_phone):
        print(
            f"--to-phone ({mask_phone_number(args.to_phone, args.to_phone)}) is not a strict E.164 number "
            "(e.g. +18005550187) — refusing to dial an ambiguously-formatted number.",
            file=sys.stderr,
        )
        return EXIT_USAGE_OR_REFUSAL
    if not args.allow_number and not args.unrestricted:
        print(
            "Refusing to place a live call without either --allow-number (dev/test allowlist) or "
            "--unrestricted (explicit acknowledgment that this may dial any number extracted from the email).",
            file=sys.stderr,
        )
        return EXIT_USAGE_OR_REFUSAL
    # --unrestricted on its own is a general acknowledgment ("this run may
    # dial an unverified number"), not authorization for the specific
    # destination about to be dialed — --allow-number already ties
    # authorization to an exact number, but --unrestricted didn't have an
    # equivalent gate. --confirm-number closes that: it must be typed
    # independently and match --to-phone by strict string equality (not
    # normalize_phone's loose digit comparison used for the email-extraction
    # sanity check above), so it can't be satisfied by copy-pasting the same
    # value used elsewhere without a deliberate second confirmation.
    if args.unrestricted and args.confirm_number != args.to_phone:
        print(
            "Refusing to place a live call: --unrestricted requires --confirm-number to exactly match "
            "--to-phone — an acknowledgment that some number extracted from the email may be dialed is not "
            "authorization for this specific destination.",
            file=sys.stderr,
        )
        return EXIT_USAGE_OR_REFUSAL

    try:
        guardrails = CallGuardrails(
            allowed_numbers=set(args.allow_number) if args.allow_number else None,
            unrestricted=args.unrestricted,
            max_calls=args.max_calls_per_day,
        )
    except GuardrailViolation as e:
        print(f"Refusing to place this call: {e}", file=sys.stderr)
        return EXIT_BUDGET_OR_GUARDRAIL
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
                to_phone=args.to_phone,
                official_support_number=args.official_number,
                guardrails=guardrails,
                tagger=tagger,
            )
            for w in caught:
                print(f"\n*** {w.message} ***\n", file=sys.stderr)
    except (GuardrailViolation, BudgetExceeded) as e:
        print(f"Refusing to place this call: {e}", file=sys.stderr)
        return EXIT_BUDGET_OR_GUARDRAIL
    except AmbiguousCallOutcome as e:
        print(
            f"Call outcome is ambiguous, not retried automatically: {e}",
            file=sys.stderr,
        )
        return EXIT_AMBIGUOUS_CALL_OUTCOME
    except RecipientMismatch as e:
        print(f"Refusing to score this result: {e}", file=sys.stderr)
        return EXIT_RECIPIENT_MISMATCH
    except RuntimeError as e:
        print(f"CALL-E would not plan this call: {e}", file=sys.stderr)
        return EXIT_CALLE_REJECTED_PLAN

    if result is None:
        print("Email did not meet the suspicious-alert threshold — no call placed.")
        return EXIT_NOT_SUSPICIOUS

    print(json.dumps(result.to_dict(mask_numbers=not args.show_full_number), indent=2))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
