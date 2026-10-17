#!/usr/bin/env python3
"""Preview contact preference proposals against a synthetic local CRM. No inference."""
import argparse
import copy
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from validate import read_json, validate  # noqa: E402

CRM_PATH = ROOT / "demo" / "mock_crm.json"
SCALARS = {"language": "preferred_language", "channel": "preferred_channel",
           "call_window": "preferred_call_window", "voicemail": "voicemail_allowed"}


def preview(data, proposal, before):
    errors = validate(data, proposal)
    if errors:
        raise ValueError("Invalid proposal: " + "; ".join(errors))
    if before.get("synthetic") is not True or before.get("customer_id") != "demo-123":
        raise ValueError("Only the bundled synthetic demo customer is supported")
    if data["call_context"]["organization"] != before.get("organization"):
        raise ValueError("Call organization must match the synthetic CRM organization")
    if proposal["status"] == "review_required":
        return copy.deepcopy(before), [p for p in proposal["preferences"] if p["requires_human_review"]]
    after = copy.deepcopy(before)
    context = data["call_context"]
    for pref in proposal["preferences"]:
        if pref["recommended_action"] != "update_preference":
            continue
        kind = pref["preference_type"]
        if kind == "do_not_call" and pref["value"] is False:
            raise ValueError("Clearing DNC is unsupported by this mock adapter; this is not a semantic clarification")
        if kind == "do_not_call" and pref["scope"] == "organization" and pref["duration"] == "ongoing":
            # Preview only. main() requires explicit operator approval before any write.
            after["global_do_not_call"] = True
        elif pref["scope"] == "organization" and pref["duration"] == "ongoing" and kind in SCALARS:
            value = pref["value"] == "allowed" if kind == "voicemail" else pref["value"]
            after[SCALARS[kind]] = value
        else:
            record = {k: pref[k] for k in ("preference_type", "value", "scope", "duration", "evidence")}
            record["organization"] = context["organization"]
            if pref["scope"] == "this_task":
                record["task"] = context["task"]
            elif pref["scope"] == "this_campaign":
                record["campaign"] = context["campaign"]
            if "time_bound" in pref:
                record["time_bound"] = pref["time_bound"]
            collection = ("task_suppressions" if kind == "do_not_call" and pref["scope"] == "this_task"
                          else "campaign_suppressions" if kind == "do_not_call" and pref["scope"] == "this_campaign"
                          else "scoped_preferences")
            if record not in after[collection]:
                after[collection].append(record)
    # No consent mapping. Temporary/task/campaign DNC never reaches the global branch.
    return after, []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=["ongoing-window", "today-only", "order-only", "complaint"])
    parser.add_argument("--input")
    parser.add_argument("--proposal")
    parser.add_argument("--confirm", action="store_true", help="Prompt after preview; never auto-approve")
    args = parser.parse_args()
    if bool(args.case) == bool(args.input or args.proposal) or bool(args.input) != bool(args.proposal):
        parser.error("Use --case OR both --input and --proposal")
    try:
        if args.case:
            case = next(c for c in read_json(ROOT / "examples" / "demo-cases.json")["cases"] if c["id"] == args.case)
            data, proposal = case["input"], case["proposal"]
            mode = "ILLUSTRATIVE FIXTURE REPLAY (no model inference)"
        else:
            data, proposal = read_json(args.input), read_json(args.proposal)
            mode = "PROVIDED PROPOSAL (semantic correctness requires operator review)"
        if CRM_PATH.is_symlink():
            raise ValueError("mock_crm.json must not be a symlink")
        original = CRM_PATH.read_bytes()
        before = json.loads(original)
        after, review = preview(data, proposal, before)
        print(mode)
        print(json.dumps({"input": data, "proposal": proposal, "before": before, "after": after}, ensure_ascii=False, indent=2))
        if review:
            print("REVIEW REQUIRED: semantic clarification needed; no write offered for this batch.")
            for item in review:
                print(item["review_reason"] + " " + item["suggested_clarification"])
            return 0
        if after == before:
            print("NO CHANGE: nothing to write.")
            return 0
        if after["global_do_not_call"] != before["global_do_not_call"]:
            print("OPERATOR APPROVAL REQUIRED: global DNC change; the recipient's meaning is already explicit.")
        if not args.confirm:
            print("PREVIEW ONLY: use --confirm to approve or reject the displayed mock change.")
            return 0
        try:
            answer = input("Type approve to apply this preview to mock_crm.json, or reject to cancel: ")
        except (EOFError, KeyboardInterrupt):
            print("\nCANCELLED: no write.")
            return 0
        if answer.strip().lower() != "approve":
            print("REJECTED: no write.")
            return 0
        if CRM_PATH.is_symlink() or CRM_PATH.read_bytes() != original:
            raise ValueError("Mock changed since preview; rerun and review the new state")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=CRM_PATH.parent,
                                             prefix=".mock-", suffix=".json", delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(after, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
            os.replace(temporary, CRM_PATH)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        print("APPLIED: only the adjacent synthetic mock_crm.json was changed.")
        return 0
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
        print(f"STOPPED without a new write: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
