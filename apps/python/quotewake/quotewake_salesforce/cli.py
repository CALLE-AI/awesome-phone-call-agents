"""QuoteWake Salesforce selection, CALL-E planning, and simulation CLI."""

from __future__ import annotations

import argparse
import logging
import re
import shlex
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from quotewake_salesforce.calle import (
    CallEPlanningClient,
    CallEPlanningError,
    CallSimulationError,
    simulate_call,
)
from quotewake_salesforce.config import (
    DEFAULT_CONFIG_PATH,
    load_initial_follow_up_timing,
    load_follow_up_policies,
    load_logging_settings,
    load_regional_settings,
)
from quotewake_salesforce.domain.call_planning import build_call_plan_request
from quotewake_salesforce.domain.models import (
    CallPlanDecision,
    CallPlanResult,
    SelectionDecision,
    SelectionResult,
    SimulationOutcome,
)
from quotewake_salesforce.domain.policy import (
    SelectionPolicy,
    calculate_next_follow_up,
    configured_quote_statuses,
)
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact
from quotewake_salesforce.phone import mask_phone
from quotewake_salesforce.presentation import (
    format_business_datetime,
    format_money,
)
from quotewake_salesforce.salesforce.client import (
    SalesforceClient,
    SalesforceError,
    SalesforceSchemaError,
)
from quotewake_salesforce.salesforce.quotes import QuoteRepository, _active_picklist_values
from quotewake_salesforce.structured_logging import (
    configure_logging,
    log_event,
    log_exception,
    log_context,
)

def _new_run_id() -> str:
    """Create a short, non-secret identifier for one CLI processing attempt."""

    return uuid.uuid4().hex


def _configure_logging_from_config(config_path: str):
    """Load TOML logging settings and configure the application logger."""

    try:
        logging_settings = load_logging_settings(Path(config_path))
    except ValueError as exc:
        print(f"[ERROR] Invalid QuoteWake configuration: {exc}", file=sys.stderr)
        return None
    configure_logging(
        level=logging_settings.level,
        log_format=logging_settings.format,
        log_directory=logging_settings.directory,
        max_bytes=logging_settings.max_bytes,
        backup_count=logging_settings.backup_count,
    )
    return logging_settings


def _display_amount(
    result: SelectionResult,
    *,
    regional_settings=None,
) -> str:
    amount = result.quote.amount
    if amount is None:
        return "amount unavailable"
    return format_money(
        result.quote.money or amount,
        result.quote.currency_code,
        regional_settings=regional_settings,
    )


def _print_selection(result: SelectionResult, *, regional_settings=None) -> None:
    quote = result.quote
    print(
        f"\nQuote ID: {quote.quote_id} | Total: "
        f"{_display_amount(result, regional_settings=regional_settings)}"
    )
    print(f"Description: {quote.quote_name}")
    print(
        "Status: READY"
        if result.decision is SelectionDecision.READY
        else f"Status: SKIP | Reason: {result.reason.value}"
    )
    if result.decision is SelectionDecision.SKIP and quote.follow_up_status:
        print(f"Follow-up status: {quote.follow_up_status}")
    if result.decision is SelectionDecision.READY and result.contact is not None:
        phone = mask_phone(result.contact.phone) if result.contact.phone else "not set"
        print(f"Contact: {result.contact.name} | Phone: {phone}")
        next_at = (
            format_business_datetime(quote.next_follow_up_at, regional_settings)
            if regional_settings is not None and quote.next_follow_up_at
            else quote.next_follow_up_at.isoformat()
            if quote.next_follow_up_at
            else "not set"
        )
        print(f"Attempts: {quote.attempt_count} | Next follow-up: {next_at}")


def salesforce_dry_run_main(argv: Sequence[str]) -> int:
    """Evaluate Salesforce Quotes and optionally create non-executing CALL-E plans."""

    if "--simulate-call" in argv:
        return salesforce_simulation_main(argv)

    parser = argparse.ArgumentParser(
        description=(
            "QuoteWake Salesforce selection dry-run with optional CALL-E planning."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Read and evaluate Salesforce without writes or calls (the only mode).",
    )
    parser.add_argument(
        "--target-org",
        help="Salesforce CLI alias or username. Defaults to the current sf org.",
    )
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help="QuoteWake TOML configuration path.",
    )
    parser.add_argument(
        "--allowed-quote-status",
        action="append",
        help="Commercial Quote status allowed for follow-up; repeat for multiple values.",
    )
    parser.add_argument(
        "--do-not-call-field",
        help="Optional Contact opt-out field API name; when true, the Contact is not called.",
    )
    parser.add_argument(
        "--plan-calls",
        action="store_true",
        help="Create CALL-E plans for READY Quotes without running any calls.",
    )
    parser.add_argument(
        "--call-language",
        help="Explicit CALL-E call language; required with --plan-calls.",
    )
    parser.add_argument(
        "--call-region",
        help="Explicit CALL-E call region; required with --plan-calls.",
    )
    parser.add_argument(
        "--calle-command",
        default="calle",
        help="Official CALL-E CLI command or path. Default: calle.",
    )
    args = parser.parse_args(list(argv))
    run_id = _new_run_id()
    logging_settings = _configure_logging_from_config(args.config)
    if logging_settings is None:
        return 1
    log_scope = log_context(run_id=run_id)
    log_scope.__enter__()
    log_event(
        "run_started",
        mode="salesforce_dry_run",
        target_org_configured=bool(args.target_org),
        config_path=args.config,
        plan_calls=args.plan_calls,
        call_language=args.call_language if args.plan_calls else None,
        call_region=args.call_region if args.plan_calls else None,
        do_not_call_filter_configured=bool(args.do_not_call_field),
    )

    try:
        if args.plan_calls and (not args.call_language or not args.call_region):
            raise ValueError(
                "--plan-calls requires explicit --call-language and --call-region values."
            )
        initial_follow_up_timing = load_initial_follow_up_timing(Path(args.config))
        regional_settings = load_regional_settings(Path(args.config))
        follow_up_policies = load_follow_up_policies(Path(args.config), regional_settings)
        log_event(
            "configuration_loaded",
            mode="salesforce_dry_run",
            business_timezone=str(regional_settings.business_timezone),
            configured_follow_up_statuses=sorted(
                configured_quote_statuses(args.allowed_quote_status)
            ),
        )
        client = SalesforceClient(target_org=args.target_org)
        org = client.org_info()
        log_event(
            "salesforce_connection_verified",
            org_id=org.org_id,
            org_alias=org.alias,
            api_version=org.api_version,
        )
        print("QuoteWake Salesforce dry-run")
        print(f"Target org: {args.target_org or org.alias or 'current default'}")
        print(f"Org username: {org.username}")
        print(f"Org ID: {org.org_id}")
        print("[OK] Salesforce connection verified (read-only)")

        repository = QuoteRepository(client, do_not_call_field=args.do_not_call_field)
        quote_fields, _ = repository.validate_schema()
        log_event(
            "salesforce_schema_verified",
            quote_field_count=len(quote_fields),
            contact_opt_out_field_configured=bool(args.do_not_call_field),
        )
        print("[OK] Quote and Contact schema verified")
        if args.do_not_call_field is None:
            log_event(
                "contact_opt_out_filter_disabled",
                level=logging.WARNING,
                reason="no_contact_opt_out_field_configured",
            )
            if logging_settings.format == "text":
                print(
                    "[WARN] Contact opt-out filtering is disabled (no field configured).",
                    file=sys.stderr,
                )
        status_values = _active_picklist_values(quote_fields["Status"]) or set()
        allowed_statuses = configured_quote_statuses(args.allowed_quote_status)
        unknown_statuses = sorted(allowed_statuses - status_values)
        if unknown_statuses:
            raise SalesforceSchemaError(
                "Configured Quote statuses are not available in this org: "
                + ", ".join(unknown_statuses)
                + f". Available values: {', '.join(sorted(status_values))}"
            )
        policy = SelectionPolicy(
            initial_follow_up_timing=initial_follow_up_timing,
            retry_policy=follow_up_policies.retry,
            cooldown_policy=follow_up_policies.cooldown,
            calling_hours_policy=follow_up_policies.calling_hours,
            allowed_quote_statuses=allowed_statuses,
            business_timezone=regional_settings.business_timezone,
        )
        log_event(
            "salesforce_quote_load_started",
            allowed_quote_statuses=sorted(allowed_statuses),
        )
        quotes, contacts_by_opportunity = repository.load()
        log_event(
            "salesforce_quotes_loaded",
            quote_count=len(quotes),
            opportunity_contact_group_count=len(contacts_by_opportunity),
        )
        now = datetime.now(timezone.utc)
        selections: list[SelectionResult] = []
        ready_count = 0
        for quote in quotes:
            result = evaluate_quote(quote, now, policy)
            log_event(
                "quote_selection_evaluated",
                quote_id=quote.quote_id,
                decision=result.decision.value,
                reason=result.reason.value,
                quote_status=quote.quote_status,
                attempt_count=quote.attempt_count,
            )
            if result.decision is SelectionDecision.READY:
                result = validate_callable_contact(
                    result, contacts_by_opportunity.get(quote.opportunity_id, [])
                )
                log_event(
                    "quote_contact_validation_evaluated",
                    quote_id=quote.quote_id,
                    decision=result.decision.value,
                    reason=result.reason.value,
                    contact_count=len(contacts_by_opportunity.get(quote.opportunity_id, [])),
                    contact_id=result.contact.contact_id if result.contact else None,
                )
            if result.decision is SelectionDecision.READY:
                ready_count += 1
            _print_selection(result, regional_settings=regional_settings)
            selections.append(result)

        print(f"\n[OK] Evaluated {len(selections)} Quotes; READY: {ready_count}")
        log_event(
            "quote_selection_report_completed",
            quote_count=len(selections),
            ready_count=ready_count,
        )

        plan_failures = 0
        if args.plan_calls:
            ready_selections = [
                result
                for result in selections
                if result.decision is SelectionDecision.READY
            ]
            if ready_selections:
                planner = CallEPlanningClient(command=shlex.split(args.calle_command))
                log_event("call_e_planner_verification_started")
                planner.verify_ready()
                log_event("call_e_planner_verified")
                quote_lines = repository.load_quote_lines(
                    [result.quote.quote_id for result in ready_selections]
                )
                for selection in ready_selections:
                    log_event(
                        "call_e_plan_attempt_started",
                        quote_id=selection.quote.quote_id,
                        language=args.call_language,
                        region=args.call_region,
                    )
                    request = build_call_plan_request(
                        selection,
                        quote_lines.get(selection.quote.quote_id, []),
                        language=args.call_language,
                        region=args.call_region,
                        regional_settings=regional_settings,
                    )
                    try:
                        plan_result = planner.plan(request)
                    except CallEPlanningError as exc:
                        plan_failures += 1
                        log_exception(
                            "call_e_plan_attempt_failed",
                            exc,
                            quote_id=selection.quote.quote_id,
                        )
                        plan_result = CallPlanResult(
                            quote_id=selection.quote.quote_id,
                            decision=CallPlanDecision.PLAN_ERROR,
                            ready_to_run=False,
                            error=str(exc),
                        )
                    else:
                        log_event(
                            "call_e_plan_attempt_completed",
                            quote_id=selection.quote.quote_id,
                            decision=plan_result.decision.value,
                            ready_to_run=plan_result.ready_to_run,
                            plan_id=plan_result.plan_id,
                        )
                    print(
                        f"[CALL-E] {selection.quote.quote_name}: "
                        f"{plan_result.decision.value}"
                    )
            print(
                f"[OK] Planned {len(ready_selections)} READY Quotes; "
                f"errors: {plan_failures}"
            )
            print("[OK] plan_call only; run_call was not invoked")

        print("[OK] No Salesforce records were modified and no outbound calls were made")
        log_event(
            "run_completed",
            mode="salesforce_dry_run",
            status="failed" if plan_failures else "succeeded",
            quote_count=len(selections),
            ready_count=ready_count,
            plan_failures=plan_failures,
        )
        return 1 if plan_failures else 0
    except (SalesforceError, CallEPlanningError, ValueError) as exc:
        log_exception("run_failed", exc, mode="salesforce_dry_run")
        if logging_settings.format == "text":
            print(f"[ERROR] {type(exc).__name__}", file=sys.stderr)
            print(
                "[ERROR] No Salesforce records were modified and QuoteWake did not invoke "
                "an outbound call. Fix the authentication/schema/configuration issue and "
                "retry safely.",
                file=sys.stderr,
            )
        return 1
    finally:
        log_scope.__exit__(None, None, None)


def _parse_cli_datetime(value: str) -> datetime:
    """Parse an explicit ISO-8601 DateTime and require a timezone."""

    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(
            f"Invalid DateTime '{value}'. Use ISO-8601, for example 2026-08-10T10:00:00Z."
        ) from exc
    if parsed.tzinfo is None:
        raise ValueError("DateTime values must include a timezone, such as Z or +00:00.")
    return parsed


def salesforce_simulation_main(argv: Sequence[str]) -> int:
    """Run one deterministic ES simulation and atomically write its outcome."""

    parser = argparse.ArgumentParser(
        description="QuoteWake deterministic CALL-E simulator for Salesforce demo Quotes."
    )
    parser.add_argument("--simulate-call", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--target-org", help="Salesforce CLI alias or username.")
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help=(
            "QuoteWake TOML configuration path. Use /dev/stdin to provide a "
            "one-run configuration through a shell pipe."
        ),
    )
    parser.add_argument("--allowed-quote-status", action="append")
    parser.add_argument("--do-not-call-field")
    parser.add_argument("--quote-id", required=True, help="Exactly one Quote ID to simulate.")
    parser.add_argument("--simulation-outcome", required=True, choices=[item.value for item in SimulationOutcome])
    parser.add_argument("--call-language", required=True)
    parser.add_argument("--call-region", required=True)
    parser.add_argument(
        "--next-follow-up-at",
        help="Optional customer-requested callback time for call_back_later; timezone-aware ISO-8601 DateTime.",
    )
    parser.add_argument(
        "--confirm-demo-write",
        action="store_true",
        help="Required acknowledgement before writing the seeded demo Quote and Task.",
    )
    args = parser.parse_args(list(argv))
    run_id = _new_run_id()
    logging_settings = _configure_logging_from_config(args.config)
    if logging_settings is None:
        return 1
    log_scope = log_context(run_id=run_id)
    log_scope.__enter__()
    log_event(
        "run_started",
        mode="salesforce_simulation",
        target_org_configured=bool(args.target_org),
        config_path=args.config,
        quote_id=args.quote_id,
        simulation_outcome=args.simulation_outcome,
        call_language=args.call_language,
        call_region=args.call_region,
        confirm_demo_write=args.confirm_demo_write,
        do_not_call_filter_configured=bool(args.do_not_call_field),
    )

    try:
        if not args.target_org:
            raise ValueError("--simulate-call requires an explicit --target-org.")
        if not args.confirm_demo_write:
            raise ValueError("--simulate-call requires --confirm-demo-write.")
        if args.call_region.strip().upper() != "ES":
            raise ValueError("The simulator currently supports --call-region ES only.")
        if not args.call_language.strip():
            raise ValueError("--call-language cannot be empty.")
        if not re.fullmatch(r"[A-Za-z0-9]{15,18}", args.quote_id):
            raise ValueError("--quote-id must be a valid 15- or 18-character Salesforce ID.")
        next_at = _parse_cli_datetime(args.next_follow_up_at) if args.next_follow_up_at else None
        initial_follow_up_timing = load_initial_follow_up_timing(Path(args.config))
        regional_settings = load_regional_settings(Path(args.config))
        follow_up_policies = load_follow_up_policies(Path(args.config), regional_settings)
        log_event(
            "configuration_loaded",
            mode="salesforce_simulation",
            business_timezone=str(regional_settings.business_timezone),
        )
        client = SalesforceClient(target_org=args.target_org)
        org = client.org_info()
        log_event(
            "salesforce_connection_verified",
            quote_id=args.quote_id,
            org_id=org.org_id,
            org_alias=org.alias,
            api_version=org.api_version,
        )
        print("QuoteWake Salesforce CALL-E simulation")
        print(f"Target org: {args.target_org}")
        print(f"Org username: {org.username}")
        print(f"Org ID: {org.org_id}")
        print("[OK] Salesforce connection verified")

        repository = QuoteRepository(client, do_not_call_field=args.do_not_call_field)
        quote_fields, _ = repository.validate_schema()
        log_event(
            "salesforce_schema_verified",
            quote_id=args.quote_id,
            quote_field_count=len(quote_fields),
            contact_opt_out_field_configured=bool(args.do_not_call_field),
        )
        status_values = _active_picklist_values(quote_fields["Status"]) or set()
        allowed_statuses = configured_quote_statuses(args.allowed_quote_status)
        unknown_statuses = sorted(allowed_statuses - status_values)
        if unknown_statuses:
            raise SalesforceSchemaError(
                "Configured Quote statuses are not available in this org: "
                + ", ".join(unknown_statuses)
            )
        policy = SelectionPolicy(
            initial_follow_up_timing=initial_follow_up_timing,
            retry_policy=follow_up_policies.retry,
            cooldown_policy=follow_up_policies.cooldown,
            calling_hours_policy=follow_up_policies.calling_hours,
            allowed_quote_statuses=allowed_statuses,
            business_timezone=regional_settings.business_timezone,
        )
        log_event(
            "salesforce_quote_load_started",
            quote_id=args.quote_id,
            allowed_quote_statuses=sorted(allowed_statuses),
        )
        quotes, contacts_by_opportunity = repository.load(quote_id=args.quote_id)
        log_event(
            "salesforce_quotes_loaded",
            quote_id=args.quote_id,
            quote_count=len(quotes),
            opportunity_contact_group_count=len(contacts_by_opportunity),
        )
        selected_quote = next((item for item in quotes if item.quote_id == args.quote_id), None)
        if selected_quote is None:
            raise ValueError(f"Quote {args.quote_id} was not returned by Salesforce.")
        if not selected_quote.quote_name.startswith("QuoteWake Demo - "):
            raise ValueError(
                "Simulation writes are restricted to seeded Quotes named 'QuoteWake Demo - ...'."
            )
        now = datetime.now(timezone.utc)
        selection = evaluate_quote(selected_quote, now, policy)
        log_event(
            "quote_selection_evaluated",
            quote_id=selected_quote.quote_id,
            decision=selection.decision.value,
            reason=selection.reason.value,
            quote_status=selected_quote.quote_status,
            attempt_count=selected_quote.attempt_count,
        )
        if selection.decision is SelectionDecision.READY:
            selection = validate_callable_contact(
                selection, contacts_by_opportunity.get(selected_quote.opportunity_id, [])
            )
            log_event(
                "quote_contact_validation_evaluated",
                quote_id=selected_quote.quote_id,
                decision=selection.decision.value,
                reason=selection.reason.value,
                contact_count=len(contacts_by_opportunity.get(selected_quote.opportunity_id, [])),
                contact_id=selection.contact.contact_id if selection.contact else None,
            )
        if selection.decision is not SelectionDecision.READY:
            raise ValueError(
                f"Quote {selected_quote.quote_id} is not READY: {selection.reason.value}."
            )
        assert selection.contact is not None
        quote_lines = repository.load_quote_lines([selected_quote.quote_id]).get(
            selected_quote.quote_id, []
        )
        request = build_call_plan_request(
            selection,
            quote_lines,
            language=args.call_language,
            region=args.call_region,
            regional_settings=regional_settings,
        )
        simulation = simulate_call(
            request,
            args.simulation_outcome,
            now=now,
            next_follow_up_at=next_at,
        )
        follow_up_update = calculate_next_follow_up(
            selected_quote,
            simulation,
            follow_up_policies,
            occurred_at=simulation.simulation_timestamp,
        )
        log_event(
            "call_e_simulation_completed",
            quote_id=selected_quote.quote_id,
            simulation_id=simulation.simulation_id,
            outcome=simulation.outcome,
            provider_status=simulation.provider_status,
        )
        description = (
            "QuoteWake simulated call; no outbound call was placed.\n"
            f"Simulation ID: {simulation.simulation_id}\n"
            f"Outcome: {simulation.outcome}\n"
            f"Summary: {simulation.summary}\n"
            f"Next action: {simulation.next_action}"
        )
        write_result = client.composite_write(
            selected_quote,
            selection.contact,
            simulation,
            follow_up_update=follow_up_update,
            task_description=description,
            business_timezone=regional_settings.business_timezone,
        )
        log_event(
            "salesforce_persistence_completed",
            quote_id=selected_quote.quote_id,
            task_id=write_result.task_id,
            write_type="quote_and_task_composite",
            outcome=simulation.outcome,
        )
        print(f"[OK] Simulated outcome: {simulation.outcome}")
        print(f"[OK] Salesforce Quote updated and Task created: {write_result.task_id}")
        print("[OK] No CALL-E command or outbound call was invoked")
        log_event(
            "run_completed",
            mode="salesforce_simulation",
            status="succeeded",
            quote_id=selected_quote.quote_id,
            simulation_id=simulation.simulation_id,
            task_id=write_result.task_id,
        )
        return 0
    except (SalesforceError, CallSimulationError, ValueError) as exc:
        log_exception(
            "run_failed",
            exc,
            mode="salesforce_simulation",
            quote_id=args.quote_id,
        )
        if logging_settings.format == "text":
            print(f"[ERROR] {type(exc).__name__}", file=sys.stderr)
            print("[ERROR] No simulation write was applied.", file=sys.stderr)
        return 1
    finally:
        log_scope.__exit__(None, None, None)


def _top_level_help_parser() -> argparse.ArgumentParser:
    """Build the complete public CLI help without executing a mode."""

    parser = argparse.ArgumentParser(
        prog="python3 -m quotewake_salesforce",
        description="QuoteWake Salesforce selection, CALL-E planning, and ES simulation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Modes:\n"
            "  No Salesforce flags       Show this Salesforce-oriented workflow help.\n"
            "  --dry-run                 Read Salesforce and report READY/SKIP Quotes.\n"
            "  --plan-calls              Create remote CALL-E plans only; never place calls.\n"
            "  --simulate-call           Simulate one seeded ES Quote and write Quote + Task.\n\n"
            "Examples:\n"
            "  python3 -m quotewake_salesforce --dry-run --target-org quotewake-dev\n"
            "  python3 -m quotewake_salesforce --plan-calls --target-org quotewake-dev "
            "--call-language Spanish --call-region ES\n"
            "  python3 -m quotewake_salesforce --simulate-call --target-org quotewake-dev "
            "--quote-id <QUOTE_ID> --simulation-outcome interested "
            "--call-language Spanish --call-region ES --confirm-demo-write\n\n"
            "The simulator accepts --config /dev/stdin for one-run timing overrides."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and evaluate Salesforce without writes or calls.",
    )
    parser.add_argument("--target-org", help="Salesforce CLI alias or username.")
    parser.add_argument(
        "--config",
        metavar="PATH",
        help="QuoteWake TOML configuration path, or /dev/stdin for a one-run pipe.",
    )
    parser.add_argument(
        "--allowed-quote-status",
        action="append",
        metavar="STATUS",
        help="Allowed commercial Quote status; repeat for multiple values.",
    )
    parser.add_argument(
        "--do-not-call-field",
        metavar="FIELD",
        help="Optional Contact opt-out field API name.",
    )
    parser.add_argument(
        "--plan-calls",
        action="store_true",
        help="Create CALL-E plans for READY Quotes without running calls.",
    )
    parser.add_argument("--call-language", metavar="LANGUAGE", help="Explicit call language.")
    parser.add_argument("--call-region", metavar="REGION", help="Explicit call region.")
    parser.add_argument("--calle-command", metavar="COMMAND", help="CALL-E CLI command path.")
    parser.add_argument(
        "--simulate-call",
        action="store_true",
        help="Simulate one seeded Quote locally and write its Quote + Task outcome.",
    )
    parser.add_argument("--quote-id", metavar="ID", help="Exactly one Quote ID to simulate.")
    parser.add_argument(
        "--simulation-outcome",
        choices=[item.value for item in SimulationOutcome],
        help="Deterministic simulator outcome.",
    )
    parser.add_argument(
        "--next-follow-up-at",
        metavar="DATETIME",
        help="Optional future timezone-aware ISO-8601 DateTime for call_back_later.",
    )
    parser.add_argument(
        "--confirm-demo-write",
        action="store_true",
        help="Acknowledge the simulator's seeded Quote + Task write.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch the Salesforce selection, planning, and simulation workflows."""

    selected = list(argv) if argv is not None else sys.argv[1:]
    if "--help" in selected or "-h" in selected:
        _top_level_help_parser().print_help()
        return 0
    if any(
        flag in selected
        for flag in (
            "--dry-run",
            "--target-org",
            "--config",
            "--allowed-quote-status",
            "--do-not-call-field",
            "--plan-calls",
            "--call-language",
            "--call-region",
            "--calle-command",
            "--simulate-call",
            "--quote-id",
            "--simulation-outcome",
            "--next-follow-up-at",
            "--confirm-demo-write",
        )
    ):
        if "--simulate-call" in selected:
            if "--plan-calls" in selected:
                message = "--simulate-call and --plan-calls are mutually exclusive."
                run_id = _new_run_id()
                configure_logging()
                with log_context(run_id=run_id):
                    log_exception("run_failed", ValueError(message), mode="cli")
                    print(f"[ERROR] {message}", file=sys.stderr)
                return 1
            return salesforce_simulation_main(selected)
        return salesforce_dry_run_main(selected)
    _top_level_help_parser().print_help()
    return 0
