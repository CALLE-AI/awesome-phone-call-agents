from __future__ import annotations

import argparse
import json
from pathlib import Path

from .calle_client import CalleHTTPClient
from .models import RecoveryTask
from .recovery import RecoveryStore, dry_run, live_recovery, preview, recovery_id_for
from .safety import validate_e164

FIXTURES = {
    "claim_status": "The claims department confirmed the claim is under review and the next action is adjuster review.",
    "billing": "The billing representative confirmed the review was completed and the $340 charge was reversed.",
    "renewal": "The customer said they are still thinking about it and will decide soon.",
    "policy_service": "No answer. The call reached voicemail.",
}

def load_task(path: str) -> RecoveryTask:
    data = json.loads(Path(path).read_text())
    return RecoveryTask(**data)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--approve", action="store_true")
    parser.add_argument("--state", default=".insurance-call-recovery-state.json")
    args = parser.parse_args()

    if args.dry_run == args.live:
        parser.error("choose exactly one of --dry-run or --live")

    task = load_task(args.input)
    validate_e164(task.destination)

    rid = recovery_id_for(task)
    mode = "dry_run" if args.dry_run else "live"
    print("PREVIEW")
    print(preview(task, rid, mode))

    if args.dry_run:
        result = dry_run(task, rid, FIXTURES.get(task.task_type, ""))
    else:
        client = CalleHTTPClient()
        store = RecoveryStore(args.state)
        result = live_recovery(task, client, store, approved=args.approve)

    print("\nRESULT")
    print(json.dumps(result.to_dict(), indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
