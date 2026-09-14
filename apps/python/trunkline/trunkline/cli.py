"""Command line for Trunkline.

Three run modes, and only one of them can dial a telephone:

* ``preview`` builds the plan and prints the task. No network, no key.
* ``fixture`` runs the real client against a local fake of the CALL-E API.
* ``live``   places real calls, and refuses without a written authorization
  record for the payer it is about to dial.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import date
from typing import Dict, List, Optional, Sequence

from . import audit, authz, client as calle_client, demo, engine, hold, plan as plan_mod, policy, redact, vault, workflows, workqueue
from .models import (
    ANSWERED,
    CLOSED,
    NEEDS_HUMAN,
    PENDING_CALL,
    PENDING_RECONCILIATION,
    QUEUED,
    UNKNOWN,
    Ledger,
    load_ledger,
    save_ledger,
)

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(PACKAGE_DIR)
FIXTURES_DIR = os.path.join(APP_DIR, "fixtures")


def load_env_file(path: str = ".env") -> None:
    """Populate os.environ from a local .env without overriding a real export."""
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def api_key() -> str:
    return os.environ.get("CALLE_API_KEY", "").strip()


def base_url() -> str:
    return os.environ.get("TRUNKLINE_BASE_URL", calle_client.OFFICIAL_ORIGIN).strip()


def context(args: argparse.Namespace) -> engine.Context:
    ledger = load_ledger(args.data)
    config = engine.Config(
        max_hold_minutes=getattr(args, "max_hold_minutes", 25),
        hold_budget_minutes=getattr(args, "hold_budget_minutes", 240),
        max_calls_per_run=getattr(args, "max_calls", 25),
        ignore_window=bool(getattr(args, "force", False)),
        webhook_url=os.environ.get("TRUNKLINE_WEBHOOK_URL", ""),
    )
    return engine.Context(data_dir=args.data, ledger=ledger, config=config, fixtures_dir=FIXTURES_DIR)


def out(text: str = "") -> None:
    print(redact.mask_phone_text(text))


# ---------------------------------------------------------------------------
# init-demo
# ---------------------------------------------------------------------------

def cmd_init_demo(args: argparse.Namespace) -> int:
    ledger, records = demo.build()
    workqueue.rescore(ledger)
    os.makedirs(args.data, exist_ok=True)
    save_ledger(args.data, ledger)
    for patient_ref, values in records.items():
        vault.put(args.data, patient_ref, values)
    audit.record(args.data, actor="cli", action="demo.seeded", subject=args.data,
                 detail={"claims": len(ledger.claims), "patients": len(records)})
    out("Seeded %d claims, %d payers, %d vault records in %s"
        % (len(ledger.claims), len(ledger.payers), len(records), args.data))
    out("")
    out("The ledger holds no patient identifiers. Prove it with:  trunkline --data %s vault-check" % args.data)
    out("See the queue with:                                      trunkline --data %s status" % args.data)
    return 0


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

def cmd_status(args: argparse.Namespace) -> int:
    ctx = context(args)
    ledger = ctx.ledger
    workqueue.rescore(ledger)

    counts: Dict[str, int] = {}
    for claim in ledger.claims:
        counts[claim.state] = counts.get(claim.state, 0) + 1

    out("Practice: %s" % (ledger.practices[0].name if ledger.practices else "none"))
    out("Claims:   %s" % ", ".join("%s %d" % (state, counts.get(state, 0))
                                   for state in (QUEUED, PENDING_CALL, PENDING_RECONCILIATION,
                                                 ANSWERED, NEEDS_HUMAN, CLOSED) if counts.get(state)))
    out("Calls:    %d placed this ledger, %s of hold recorded"
        % (ledger.calls_placed, hold.format_duration(ledger.hold_seconds_used)))
    if engine.kill_switch_engaged(args.data):
        out("KILL SWITCH ENGAGED - every call is refused")
    out("")

    bundles = workqueue.build_bundles(ledger, workflow=args.workflow, payer_id=args.payer)
    if not bundles:
        out("No callable claims. A claim is callable when it is queued, has a vault record, and its")
        out("timely-filing deadline has not passed.")
        return 0

    saving = workqueue.bundling_saving(bundles)
    out("%d callable claims bundle into %d calls (%d calls avoided, %.0f%% fewer)"
        % (saving["claims"], saving["calls"], saving["calls_avoided"], saving["reduction"] * 100))
    out("")
    for bundle in bundles:
        payer = ledger.payer(bundle.payer_id)
        reasons = engine.suppression_for(ctx, bundle, args.mode)
        for line in workqueue.explain(bundle, payer):
            out("  " + line)
        if reasons:
            out("  holds: %s" % ", ".join(reasons))
            for reason in reasons:
                out("     - %s: %s" % (reason, policy.describe_suppression(reason)))
        else:
            out("  ready to call in %s mode" % args.mode)
        out("")
    return 0


# ---------------------------------------------------------------------------
# plan
# ---------------------------------------------------------------------------

def cmd_plan(args: argparse.Namespace) -> int:
    ctx = context(args)
    ctx.config.ignore_window = True
    workqueue.rescore(ctx.ledger)
    bundles = workqueue.build_bundles(ctx.ledger, workflow=args.workflow, payer_id=args.payer, max_bundles=args.limit)
    if not bundles:
        out("Nothing to plan.")
        return 1
    for bundle in bundles:
        outcome = engine.run_bundle(ctx, bundle, mode=engine.MODE_PREVIEW)
        if outcome.suppressed:
            out("suppressed: %s" % ", ".join(outcome.suppressed))
            continue
        out("=" * 78)
        out(plan_mod.plan_preview(outcome.plan))
        out("")
    out("=" * 78)
    out("No call was placed. calls_placed = 0")
    return 0


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------

def cmd_run(args: argparse.Namespace) -> int:
    if args.mode == engine.MODE_LIVE and args.force:
        out("--force is refused in live mode. It exists so a fixture demo can run outside business hours.")
        return 2
    if args.mode == engine.MODE_LIVE and not args.yes:
        out("Live mode places real phone calls to a health plan. Re-run with --yes to confirm,")
        out("and note that each payer also needs an authorization record (trunkline authorize).")
        return 2

    ctx = context(args)
    workqueue.rescore(ctx.ledger)
    bundles = workqueue.build_bundles(ctx.ledger, workflow=args.workflow, payer_id=args.payer, max_bundles=args.limit)
    if not bundles:
        out("Nothing to call about.")
        return 1

    server = None
    key = api_key()
    url = base_url()
    if args.mode == engine.MODE_FIXTURE:
        server = calle_client.FakeCalleServer(FIXTURES_DIR).start()
        url = server.base_url
        key = "fixture-local-key"

    placed = 0
    try:
        for bundle in bundles:
            scenario = demo.scenario_for(
                FIXTURES_DIR,
                bundle.workflow,
                [claim.claim_number for claim in bundle.claims],
                explicit=args.scenario,
            )
            payer = ctx.ledger.payer(bundle.payer_id)
            out("-" * 78)
            out("%s - %s - %d claim(s) - %s"
                % (payer.name, bundle.workflow, len(bundle.claims), policy.mask_phone(payer.phone)))
            try:
                outcome = engine.run_bundle(
                    ctx, bundle, mode=args.mode, api_key=key, base_url=url,
                    fixture_scenario=scenario, first_poll_delay=0.0 if args.mode == engine.MODE_FIXTURE else None,
                )
            except calle_client.CalleError as error:
                out("  call failed: %s" % error)
                if args.mode == engine.MODE_LIVE:
                    out("  Live batch halted. Reconcile the unresolved call before running again.")
                    return 3
                continue
            if outcome.suppressed:
                out("  held: %s" % ", ".join(outcome.suppressed))
                for reason in outcome.suppressed:
                    out("     - %s" % policy.describe_suppression(reason))
                if args.mode == engine.MODE_LIVE and "pending_reconciliation" in outcome.suppressed:
                    out("  Live batch halted. Reconcile the unresolved call before running again.")
                    return 2
                continue
            placed += 1
            _print_call(ctx, outcome)
    finally:
        if server is not None:
            server.stop()

    out("-" * 78)
    out("%d call(s) placed in %s mode." % (placed, args.mode))
    if placed:
        out("Review what needs a person:  trunkline --data %s review" % args.data)
    return 0


def _print_call(ctx: engine.Context, outcome: engine.RunOutcome) -> None:
    record = outcome.call
    if record is None:
        return
    profile = outcome.hold_profile
    payer = ctx.ledger.payer(record.payer_id)
    phone_patterns = redact.build_phone_patterns([payer.phone])

    def safe(value) -> str:
        return redact.mask_phone_text(str(value), phone_patterns)

    out("  outcome:   %s" % record.outcome)
    if profile:
        out("  %s" % profile.receipt())
        out("  talking:   %s of a %s call" % (
            hold.format_duration(record.talk_seconds), hold.format_duration(record.total_seconds)))
    out("  reference: %s   representative: %s" % (
        safe(record.reference_number), safe(record.rep_name),
    ))
    out("  estimated cost: $%.2f" % record.cost_estimate_usd)
    for finding in record.findings:
        out("  ! %s" % safe(finding))
    for claim_id in record.claim_ids:
        claim = ctx.ledger.claim(claim_id)
        fields = record.per_claim.get(claim_id, {})
        grounded = "grounded" if fields.get("_grounded") else "NOT GROUNDED"
        out("  %s  %s  [%s]  -> %s" % (claim.claim_number, claim.workflow, grounded, claim.state))
        for name in sorted(fields):
            if name.startswith("_") or name in ("claim_number", "evidence_quote"):
                continue
            out("      %-24s %s" % (name, safe(fields[name])))
        quote = fields.get("evidence_quote", UNKNOWN)
        if quote and quote != UNKNOWN:
            out("      evidence: \"%s\"" % safe(quote))


# ---------------------------------------------------------------------------
# review / approve
# ---------------------------------------------------------------------------

def cmd_review(args: argparse.Namespace) -> int:
    ctx = context(args)
    pending = [c for c in ctx.ledger.claims if c.state in (ANSWERED, NEEDS_HUMAN)]
    if not pending:
        out("Nothing waiting for review.")
        return 0
    pending.sort(key=lambda c: (c.state != NEEDS_HUMAN, c.claim_number))
    for claim in pending:
        payer = ctx.ledger.payer(claim.payer_id)
        phone_patterns = redact.build_phone_patterns([payer.phone])
        out("%s  %s  %s  %s  $%.2f" % (claim.id, claim.state, claim.claim_number, payer.name, claim.billed_amount))
        for name in sorted(claim.result):
            if name.startswith("_") or name == "claim_number":
                continue
            value = redact.mask_phone_text(str(claim.result[name]), phone_patterns)
            out("    %-24s %s" % (name, value))
        if not claim.result.get("_grounded", True):
            out("    reason for review: the answer had no quotable support on the call")
        out("")
    out("Approve one with:  trunkline --data %s approve <claim_id> --note \"...\"" % args.data)
    return 0


def cmd_approve(args: argparse.Namespace) -> int:
    ctx = context(args)
    try:
        claim = ctx.ledger.claim(args.claim_id)
    except KeyError as error:
        out(str(error))
        return 1
    try:
        engine.approve(ctx, claim, args.note)
    except engine.EngineError as error:
        out(str(error))
        return 1
    out("Approved %s (%s). It is now closed and exportable." % (claim.id, claim.claim_number))
    return 0


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def cmd_export(args: argparse.Namespace) -> int:
    ctx = context(args)
    rows = []
    for claim in ctx.ledger.claims:
        if args.only_closed and claim.state != CLOSED:
            continue
        if not claim.result:
            continue
        payer = ctx.ledger.payer(claim.payer_id)
        call = None
        if claim.call_ids:
            try:
                call = ctx.ledger.call(claim.call_ids[-1])
            except KeyError:
                call = None
        row = {
            "claim_id": claim.id,
            "claim_number": claim.claim_number,
            "payer": payer.name,
            "workflow": claim.workflow,
            "state": claim.state,
            "billed_amount": "%.2f" % claim.billed_amount,
            "date_of_service": claim.date_of_service,
            "filing_deadline": claim.filing_deadline,
            "reference_number": call.reference_number if call else UNKNOWN,
            "representative": call.rep_name if call else UNKNOWN,
            "hold_seconds": call.hold_seconds if call else 0,
            "grounded": claim.result.get("_grounded", False),
        }
        for name in sorted(claim.result):
            if not name.startswith("_") and name != "claim_number":
                row[name] = claim.result[name]
        phone_patterns = redact.build_phone_patterns([payer.phone])
        rows.append(redact.scrub_value(row, [], phone_patterns))

    if not rows:
        out("Nothing to export yet.")
        return 1

    columns: List[str] = []
    for row in rows:
        for name in row:
            if name not in columns:
                columns.append(name)

    with open(args.out, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    out("Wrote %d row(s) to %s" % (len(rows), args.out))
    out("The export carries claim numbers and plan answers. It carries no patient identifiers.")
    return 0


# ---------------------------------------------------------------------------
# impact
# ---------------------------------------------------------------------------

MANUAL_MINUTES_PER_CALL = 25.0
LOADED_RATE_PER_HOUR = 27.30
REVIEW_MINUTES_PER_CALL = 1.5


def cmd_impact(args: argparse.Namespace) -> int:
    ctx = context(args)
    calls = [c for c in ctx.ledger.calls if c.completed_at]
    claims_touched = sum(len(c.claim_ids) for c in calls)
    if not calls:
        out("No completed calls yet. Run `trunkline run --mode fixture` first.")
        return 1

    hold_total = sum(c.hold_seconds for c in calls)
    manual_minutes = MANUAL_MINUTES_PER_CALL * claims_touched
    trunkline_minutes = REVIEW_MINUTES_PER_CALL * len(calls)
    saved_minutes = manual_minutes - trunkline_minutes
    rate_per_minute = LOADED_RATE_PER_HOUR / 60.0

    out("Measured on this ledger, not modelled:")
    out("")
    out("  completed calls          %d" % len(calls))
    out("  claims resolved on them  %d" % claims_touched)
    out("  agent time on hold       %s" % hold.format_duration(hold_total))
    out("  longest single hold      %s" % hold.format_duration(max(c.hold_seconds for c in calls)))
    out("")
    out("Against a manual baseline of %.0f staff minutes per claim inquiry:" % MANUAL_MINUTES_PER_CALL)
    out("  staff minutes before     %.0f" % manual_minutes)
    out("  staff minutes after      %.0f  (%.1f min review per completed call)"
        % (trunkline_minutes, REVIEW_MINUTES_PER_CALL))
    out("  staff minutes returned   %.0f  (%.1f hours)" % (saved_minutes, saved_minutes / 60.0))
    out("  at $%.2f/hour loaded     $%.2f" % (LOADED_RATE_PER_HOUR, saved_minutes * rate_per_minute))
    out("")
    out("Baseline source: CAQH Index, 25 minutes of staff time for a phone claim-status inquiry.")
    out("The dollar figure is staff time only. It does not claim recovered revenue: whether a claim")
    out("is appealed, and whether the appeal wins, is a human decision Trunkline never makes.")
    return 0


# ---------------------------------------------------------------------------
# authorization
# ---------------------------------------------------------------------------

def cmd_authorize(args: argparse.Namespace) -> int:
    ctx = context(args)
    try:
        payer = ctx.ledger.payer(args.payer)
    except KeyError as error:
        out(str(error))
        return 1
    if payer.phone != args.phone:
        out("The payer record's number is %s and you authorized %s."
            % (policy.mask_phone(payer.phone), policy.mask_phone(args.phone)))
        out("They must match exactly. Fix the payer record or the authorization.")
        return 1
    try:
        record = authz.write(args.data, payer_id=payer.id, phone=args.phone, region=payer.region,
                             until=args.until, max_calls=args.max_calls, note=args.note)
    except (authz.AuthorizationError, policy.PolicyError) as error:
        out(str(error))
        return 1
    audit.record(args.data, actor="cli", action="authorization.written", subject=payer.id,
                 detail={"until": record.until, "max_calls": record.max_calls,
                         "destination": policy.mask_phone(record.phone)})
    out("Authorized live calls to %s at %s until %s, %d call(s) maximum."
        % (payer.name, policy.mask_phone(record.phone), record.until, record.max_calls))
    out("Revoke at any time with:  trunkline --data %s revoke --payer %s" % (args.data, payer.id))
    return 0


def cmd_revoke(args: argparse.Namespace) -> int:
    if authz.revoke(args.data, args.payer):
        audit.record(args.data, actor="cli", action="authorization.revoked", subject=args.payer, detail={})
        out("Revoked live-call authorization for %s. Live runs against it now refuse." % args.payer)
        return 0
    out("No authorization record for %s." % args.payer)
    return 1


# ---------------------------------------------------------------------------
# reconcile
# ---------------------------------------------------------------------------

def cmd_reconcile(args: argparse.Namespace) -> int:
    ctx = context(args)
    stuck = [c for c in ctx.ledger.calls if c.status in engine.UNRESOLVED_CALL_STATUSES]
    if args.call:
        stuck = [c for c in stuck if c.id == args.call]
    if args.provider_call_id and not args.call:
        out("--provider-call-id requires --call so it cannot attach to the wrong record.")
        return 2
    if args.provider_call_id and args.clear:
        out("--provider-call-id and --clear cannot be used together.")
        return 2
    if not stuck:
        out("Nothing to reconcile.")
        return 0
    for record in stuck:
        if args.clear:
            engine.clear_pending(ctx, record)
            out("%s cleared; its claims are back in the queue." % record.id)
            continue
        try:
            profile = engine.reconcile(ctx, record, api_key=api_key(), base_url=base_url(),
                                       allow_local_fake=args.allow_local_fake,
                                       provider_call_id=args.provider_call_id)
        except (calle_client.CalleError, engine.EngineError) as error:
            out("%s: %s" % (record.id, error))
            continue
        if profile is None:
            out("%s is still running at CALL-E. Try again later." % record.id)
        else:
            out("%s reconciled: %s, %s" % (record.id, record.outcome, profile.receipt()))
    return 0


# ---------------------------------------------------------------------------
# audit / vault-check / kill-switch
# ---------------------------------------------------------------------------

def cmd_audit(args: argparse.Namespace) -> int:
    entries = audit.read_all(args.data)
    if not entries:
        out("No audit entries yet.")
        return 0
    if args.verify:
        check = audit.verify_chain(args.data)
        if check.ok:
            out("Audit chain intact across %d entries." % check.entries)
            return 0
        out("Audit chain BROKEN at entry %s: %s" % (check.broken_at, check.reason))
        return 1
    for entry in entries[-args.limit:]:
        out("%4d  %s  %-24s %-16s %s"
            % (entry["seq"], entry["at"], entry["action"], entry["actor"], entry["subject"]))
        if args.detail and entry.get("detail"):
            out("      %s" % json.dumps(entry["detail"], sort_keys=True))
    out("")
    out("Verify the chain with:  trunkline --data %s audit --verify" % args.data)
    return 0


def cmd_vault_check(args: argparse.Namespace) -> int:
    """Scan everything Trunkline wrote for identifiers that should never be there."""
    from . import redact

    secrets: Dict[str, List[str]] = {}
    vault_directory = vault.vault_dir(args.data)
    if not os.path.isdir(vault_directory):
        out("No vault at %s." % vault_directory)
        return 1
    for name in sorted(os.listdir(vault_directory)):
        if name.endswith(".json"):
            patient_ref = name[:-5]
            secrets[patient_ref] = vault.all_secrets_for(args.data, patient_ref)

    scanned = 0
    leaks: List[str] = []
    for root, _dirs, files in os.walk(args.data):
        if os.path.abspath(root).startswith(os.path.abspath(vault_directory)):
            continue
        for name in files:
            path = os.path.join(root, name)
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    text = handle.read()
            except (OSError, UnicodeDecodeError):
                continue
            scanned += 1
            for patient_ref, values in secrets.items():
                for value in values:
                    if redact.contains_any(text, [value]):
                        leaks.append("%s carries an identifier belonging to %s"
                                     % (os.path.relpath(path, args.data), patient_ref))
    out("Scanned %d file(s) under %s, excluding the vault itself." % (scanned, args.data))
    out("Vault holds %d patient record(s) with %d identifier(s)."
        % (len(secrets), sum(len(v) for v in secrets.values())))
    if leaks:
        out("")
        out("LEAK DETECTED:")
        for leak in sorted(set(leaks)):
            out("  %s" % leak)
        return 1
    out("")
    out("No patient identifier appears anywhere outside the vault.")
    return 0


def cmd_kill_switch(args: argparse.Namespace) -> int:
    path = engine.kill_switch_path(args.data)
    if args.state == "on":
        os.makedirs(args.data, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("Every Trunkline call is refused while this file exists.\n")
        audit.record(args.data, actor="cli", action="kill_switch.on", subject=args.data, detail={})
        out("Kill switch engaged. Every call is refused until it is turned off.")
        return 0
    if os.path.exists(path):
        os.remove(path)
        audit.record(args.data, actor="cli", action="kill_switch.off", subject=args.data, detail={})
        out("Kill switch cleared.")
        return 0
    out("Kill switch was not engaged.")
    return 0


def cmd_console(args: argparse.Namespace) -> int:
    from .console import serve

    return serve(args.data, host=args.host, port=args.port)


def cmd_fixtures(args: argparse.Namespace) -> int:
    for name in calle_client.available_fixtures(FIXTURES_DIR):
        out(name)
    return 0


# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="trunkline",
        description="Call a health plan about a claim, and bring back a structured answer.",
    )
    parser.add_argument("--data", default="./data", help="directory for the ledger, vault, and audit log")
    subparsers = parser.add_subparsers(dest="command")

    def add(name: str, handler, help_text: str) -> argparse.ArgumentParser:
        sub = subparsers.add_parser(name, help=help_text)
        sub.set_defaults(handler=handler)
        return sub

    add("init-demo", cmd_init_demo, "seed a fictional practice, payers, patients, and claims")

    status = add("status", cmd_status, "show the queue, the bundles, and every hold that applies")
    status.add_argument("--workflow", choices=workflows.names())
    status.add_argument("--payer")
    status.add_argument("--mode", choices=engine.MODES, default=engine.MODE_FIXTURE)

    plan = add("plan", cmd_plan, "print the exact task text CALL-E would receive; places no call")
    plan.add_argument("--workflow", choices=workflows.names())
    plan.add_argument("--payer")
    plan.add_argument("--limit", type=int, default=1)

    run = add("run", cmd_run, "run a cycle in preview, fixture, or live mode")
    run.add_argument("--mode", choices=engine.MODES, default=engine.MODE_FIXTURE)
    run.add_argument("--workflow", choices=workflows.names())
    run.add_argument("--payer")
    run.add_argument("--limit", type=int, default=1)
    run.add_argument("--scenario", help="fixture name to replay (fixture mode only)")
    run.add_argument("--force", action="store_true", help="ignore the calling window; refused in live mode")
    run.add_argument("--yes", action="store_true", help="confirm that live mode may place real calls")
    run.add_argument("--max-hold-minutes", type=int, default=25)
    run.add_argument("--hold-budget-minutes", type=int, default=240)
    run.add_argument("--max-calls", type=int, default=25)

    add("review", cmd_review, "list claims waiting on a person")

    approve = add("approve", cmd_approve, "sign off on one claim's answer")
    approve.add_argument("claim_id")
    approve.add_argument("--note", default="")

    export = add("export", cmd_export, "write answers to CSV")
    export.add_argument("--out", default="trunkline-export.csv")
    export.add_argument("--only-closed", action="store_true")

    add("impact", cmd_impact, "staff time measured from the calls in this ledger")

    authorize = add("authorize", cmd_authorize, "write a live-call authorization record for one payer")
    authorize.add_argument("--payer", required=True)
    authorize.add_argument("--phone", required=True)
    authorize.add_argument("--until", required=True, help="YYYY-MM-DD")
    authorize.add_argument("--max-calls", type=int, required=True)
    authorize.add_argument("--note", default="")

    revoke = add("revoke", cmd_revoke, "delete a payer's live-call authorization")
    revoke.add_argument("--payer", required=True)

    reconcile = add("reconcile", cmd_reconcile, "resolve calls that were submitted but never folded back in")
    reconcile.add_argument("--call")
    reconcile.add_argument("--clear", action="store_true",
                           help="assert no call exists at the provider and requeue its claims")
    reconcile.add_argument("--provider-call-id",
                           help="attach the CALL-E id found in the provider dashboard")
    reconcile.add_argument("--allow-local-fake", action="store_true")

    audit_cmd = add("audit", cmd_audit, "read the hash-chained audit log")
    audit_cmd.add_argument("--verify", action="store_true", help="check the chain instead of printing it")
    audit_cmd.add_argument("--limit", type=int, default=20)
    audit_cmd.add_argument("--detail", action="store_true")

    add("vault-check", cmd_vault_check, "prove no patient identifier escaped the vault")

    kill = add("kill-switch", cmd_kill_switch, "refuse every call, or stop refusing")
    kill.add_argument("state", choices=("on", "off"))

    console = add("console", cmd_console, "serve the local review console or synthetic public demo")
    console.add_argument("--host", default="127.0.0.1")
    console.add_argument("--port", type=int, default=8770)

    add("fixtures", cmd_fixtures, "list the replayable call fixtures")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    load_env_file()
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return 1
    try:
        return int(args.handler(args))
    except (policy.PolicyError, vault.VaultError, engine.EngineError, authz.AuthorizationError) as error:
        out("refused: %s" % error)
        return 2
    except calle_client.CalleError as error:
        out("CALL-E: %s" % error)
        return 3
    except KeyboardInterrupt:
        out("")
        out("Interrupted. A call already accepted by CALL-E keeps running; use `trunkline reconcile`.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
