"""No-call command-line walkthrough; never exposes a live dialing flag."""
import argparse
from .config import Settings
from .services.workflow import Workflow
from .storage import dump, fixture


def main():
    parser=argparse.ArgumentParser(description="Run a synthetic buyer follow-up, without telephone calls")
    parser.add_argument("--db",required=True,help="SQLite path; choose a new file for an independent case")
    parser.add_argument("--case",choices=list(fixture("replays.json")),default="preferences")
    args=parser.parse_args()
    w=Workflow(Settings(db_path=args.db))
    run=w.prepare("customer_zhang","Follow up on Ms. Zhang's recent viewings",replay_case=args.case)
    print("MODE: deterministic planning + prerecorded extraction; synthetic telephone replay")
    print(dump({"assessment":run["assessment"],"plan":run["plan"]}))
    run=w.approve(run["id"],run["revision"],contact_authorized=True,broker="offline_demo")
    w.execute(run["id"])
    run=w.process(run["id"],confirm_writeback=True)
    print(dump({"run_id":run["id"],"status":run["status"],"receipt":run["receipt"],"proposed_changes":run["batch"],
                "customer":w.crm.context("customer_zhang")["customer"]}))


if __name__=="__main__":
    main()
