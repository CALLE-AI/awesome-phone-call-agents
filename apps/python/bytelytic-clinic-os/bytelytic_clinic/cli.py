"""
Interactive Command Line Interface for Bytelytic Clinic OS
"""
from __future__ import annotations
import argparse
import json
import sys
from .adapters.calle_adapter import calle_adapter
from .adapters.audit_ledger import audit_ledger
from .server import app


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Bytelytic Clinic OS — Autonomous Healthcare Phone Desk",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python app.py --campaign confirmation --phone "+15550192834"
  python app.py --campaign no_show
  python app.py --campaign prior_auth
  python app.py --campaign recall
  python app.py --campaign survey
  python app.py --serve
  python app.py --list-audit
        """
    )
    parser.add_argument(
        "--campaign",
        choices=["confirmation", "no_show", "prior_auth", "recall", "survey"],
        default="confirmation",
        help="Campaign type to run (default: confirmation)"
    )
    parser.add_argument("--phone", default="+15550192834", help="Patient phone number (E.164)")
    parser.add_argument("--live", action="store_true", help="Run in live mode (requires CALLE_API_KEY)")
    parser.add_argument("--serve", action="store_true", help="Start FastAPI HTTP server on port 8000")
    parser.add_argument("--list-audit", action="store_true", help="Show the current audit ledger entries")

    args = parser.parse_args(argv)

    if args.serve:
        import uvicorn
        print("[Bytelytic Clinic OS] Starting API Server on http://127.0.0.1:8000 ...")
        uvicorn.run(app, host="127.0.0.1", port=8000)
        return

    if args.list_audit:
        print("\n=== Audit Ledger ===")
        if not audit_ledger.entries:
            print("  (No entries yet)")
        for e in audit_ledger.entries:
            print(f"  [{e.timestamp}] {e.actor} | {e.action} | {e.resource_type}:{e.resource_id}")
        print(f"\nIntegrity Verified: {audit_ledger.verify_integrity()}")
        return

    original_dry_run = calle_adapter.cfg.dry_run
    original_policy_dry_run = calle_adapter.policy.dry_run

    try:
        if args.live:
            calle_adapter.cfg.dry_run = False
            calle_adapter.policy.dry_run = False
        else:
            calle_adapter.cfg.dry_run = True
            calle_adapter.policy.dry_run = True

        _banner(args)

        res = None
        if args.campaign == "confirmation":
            res = calle_adapter.dispatch_confirmation_call(phone=args.phone)
        elif args.campaign == "no_show":
            res = calle_adapter.dispatch_noshow_recovery_call(phone=args.phone)
        elif args.campaign == "prior_auth":
            res = calle_adapter.dispatch_prior_auth_call(
                payor_phone="1-800-676-2583",
                payor_name="Blue Cross Blue Shield",
                cpt_code="99213",
                member_id_masked="MBR-***-8492",
            )
        elif args.campaign == "recall":
            res = calle_adapter.dispatch_recall_call(phone=args.phone)
        elif args.campaign == "survey":
            res = calle_adapter.dispatch_survey_call(phone=args.phone)

        print("\nExecution Result:")
        print(json.dumps(res, indent=2, default=str))
        print(f"\nAudit Ledger Integrity Verified: {audit_ledger.verify_integrity()}\n")
    finally:
        calle_adapter.cfg.dry_run = original_dry_run
        calle_adapter.policy.dry_run = original_policy_dry_run


def _banner(args):
    width = 62
    print("=" * width)
    print("  Bytelytic Clinic OS — Autonomous Clinical Phone Operations")
    print(f"  Mode    : {'LIVE CALL' if args.live else 'DRY-RUN (Safe Fixture)'}")
    print(f"  Campaign: {args.campaign.upper()}")
    print(f"  Target  : {args.phone[:5]}***{args.phone[-4:]}" if len(args.phone) >= 9 else f"  Target  : {args.phone}")
    print("=" * width + "\n")


if __name__ == "__main__":
    main()
