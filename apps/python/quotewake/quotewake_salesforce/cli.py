"""QuoteWake CLI and backwards-compatible local scaffold helpers."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from dataclasses import dataclass
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
    load_regional_settings,
)
from quotewake_salesforce.domain.call_planning import build_call_plan_request
from quotewake_salesforce.domain.models import (
    CallPlanDecision,
    CallPlanResult,
    CallResult,
    Money,
    SelectionDecision,
    SelectionResult,
    SimulationOutcome,
)
from quotewake_salesforce.domain.policy import SelectionPolicy, configured_quote_statuses
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact
from quotewake_salesforce.phone import mask_phone
from quotewake_salesforce.presentation import (
    format_business_datetime,
    format_money,
    money_record,
)
from quotewake_salesforce.salesforce.client import (
    SalesforceClient,
    SalesforceError,
    SalesforceSchemaError,
)
from quotewake_salesforce.salesforce.quotes import QuoteRepository, _active_picklist_values

# Standard E.164 phone number pattern (7 to 15 digits starting with +)
E164_REGEX = re.compile(r"^\+[1-9]\d{6,14}$")


class NumberValidationError(ValueError):
    """Raised when a phone number does not conform to the E.164 format."""


def validate_e164_phone(phone: str) -> str:
    """Validate that a phone number string matches canonical E.164 format.

    Args:
        phone: The input phone number string.

    Returns:
        The validated E.164 phone string.

    Raises:
        NumberValidationError: If the phone number is invalid or empty.
    """
    cleaned = phone.strip()
    if not cleaned or not E164_REGEX.match(cleaned):
        raise NumberValidationError(
            f"Invalid E.164 phone number format: '{phone}'. Must start with '+' followed by 7-15 digits."
        )
    return cleaned


def mask_phone_number(phone: str) -> str:
    """Mask an E.164 phone number to protect customer privacy in logs and reports.

    Example:
        '+14155550131' -> '+15*******11'

    Args:
        phone: The E.164 formatted phone number.

    Returns:
        The masked phone string.
    """
    validated = validate_e164_phone(phone)
    prefix = validated[:3]
    suffix = validated[-2:]
    masked_middle = "*" * (len(validated) - 5)
    return f"{prefix}{masked_middle}{suffix}"


@dataclass
class Invoice:
    """Represents a customer invoice needing potential follow-up."""

    invoice_id: str
    customer_name: str
    phone_number: str
    amount_due: float
    due_date: str
    status: str = "pending"
    currency: str = "USD"

    def __post_init__(self) -> None:
        """Validate fields upon initialization."""
        self.phone_number = validate_e164_phone(self.phone_number)
        if self.amount_due < 0:
            raise ValueError(f"Invoice amount_due cannot be negative: {self.amount_due}")


def should_follow_up(invoice: Invoice) -> bool:
    """Determine whether an invoice requires a follow-up call.

    Args:
        invoice: The invoice instance to evaluate.

    Returns:
        True if the invoice status is pending or overdue and has an amount due > 0;
        False otherwise.
    """
    normalized_status = invoice.status.strip().lower()
    return normalized_status in {"pending", "overdue"} and invoice.amount_due > 0.0


def build_call_context(invoice: Invoice) -> dict[str, str]:
    """Construct a structured call context payload for CALL-E agent follow-up.

    Args:
        invoice: The target invoice.

    Returns:
        A dictionary containing safe task parameters and masked phone references.
    """
    masked_phone = mask_phone_number(invoice.phone_number)
    task_prompt = (
        f"Call {invoice.customer_name} regarding outstanding Invoice #{invoice.invoice_id} "
        f"for {invoice.currency} {invoice.amount_due:.2f} due on {invoice.due_date}. "
        "Inquire about payment status, offer assistance with payment options, "
        "and record any promised payment date."
    )
    return {
        "invoice_id": invoice.invoice_id,
        "customer_name": invoice.customer_name,
        "masked_phone": masked_phone,
        "amount_due": f"{invoice.currency} {invoice.amount_due:.2f}",
        "due_date": invoice.due_date,
        "task_prompt": task_prompt,
    }


def sample_invoices() -> list[Invoice]:
    """Provide sample invoice data for demonstration and dry-run execution."""
    return [
        Invoice(
            invoice_id="INV-1001",
            customer_name="Acme Corp",
            phone_number="+14155550131",
            amount_due=450.00,
            due_date="2026-08-01",
            status="overdue",
        ),
        Invoice(
            invoice_id="INV-1002",
            customer_name="Beta Logistics",
            phone_number="+14155550142",
            amount_due=1250.50,
            due_date="2026-08-15",
            status="pending",
        ),
        Invoice(
            invoice_id="INV-1003",
            customer_name="Gamma Services",
            phone_number="+14155550153",
            amount_due=0.00,
            due_date="2026-07-20",
            status="paid",
        ),
    ]


def run_quotewake(invoices: Sequence[Invoice], dry_run: bool = True) -> dict[str, object]:
    """Execute the QuoteWake follow-up pipeline across given invoices.

    Args:
        invoices: Sequence of Invoice instances.
        dry_run: If True, simulates the calls without invoking external services.

    Returns:
        Structured result summary of the run.
    """
    evaluated: list[dict[str, object]] = []
    follow_up_count = 0

    for inv in invoices:
        needs_call = should_follow_up(inv)
        entry: dict[str, object] = {
            "invoice_id": inv.invoice_id,
            "customer_name": inv.customer_name,
            "masked_phone": mask_phone_number(inv.phone_number),
            "status": inv.status,
            "amount_due": inv.amount_due,
            "should_follow_up": needs_call,
        }

        if needs_call:
            follow_up_count += 1
            entry["call_context"] = build_call_context(inv)
            entry["action"] = "simulated_call_scheduled" if dry_run else "live_call_triggered"
        else:
            entry["action"] = "skipped"

        evaluated.append(entry)

    return {
        "mode": "dry_run / simulated" if dry_run else "live",
        "total_invoices": len(invoices),
        "follow_ups_required": follow_up_count,
        "results": evaluated,
    }


def legacy_main(argv: Sequence[str] | None = None) -> int:
    """Run the original local scaffold demonstration."""
    parser = argparse.ArgumentParser(
        description="QuoteWake - Outbound Payment Follow-up Agent for Small Businesses"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Simulate evaluation and output without placing live calls (default: True).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit output in JSON format.",
    )
    args = parser.parse_args(argv)

    invoices = sample_invoices()
    summary = run_quotewake(invoices, dry_run=args.dry_run)

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print("=" * 60)
        print("QUOTEWAKE PAYMENT FOLLOW-UP AGENT (DRY RUN / SIMULATION)")
        print("=" * 60)
        print(f"Total Invoices Evaluated: {summary['total_invoices']}")
        print(f"Follow-ups Required:     {summary['follow_ups_required']}")
        print("-" * 60)
        results = summary.get("results", [])
        if isinstance(results, list):
            for item in results:
                if isinstance(item, dict):
                    status_symbol = "[CALL]" if item.get("should_follow_up") else "[SKIP]"
                    print(
                        f"{status_symbol} Invoice #{item.get('invoice_id')} | "
                        f"{item.get('customer_name')} ({item.get('masked_phone')}) | "
                        f"Status: {item.get('status')} | Action: {item.get('action')}"
                    )
        print("=" * 60)

    return 0


def _json_amount(value: object) -> int | float | None:
    """Serialize Decimal amounts as useful JSON numbers."""

    if value is None:
        return None
    decimal_value = value
    if hasattr(decimal_value, "as_tuple") and decimal_value == decimal_value.to_integral_value():
        return int(decimal_value)
    return float(decimal_value)


def _json_datetime(value: datetime | None) -> str | None:
    """Serialize an aware DateTime as canonical UTC RFC3339 with ``Z``."""

    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("JSON report DateTime values must be timezone-aware.")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _result_record(result: SelectionResult) -> dict[str, object]:
    """Create a concise, secret-free JSONL record."""

    quote = result.quote
    exact_money = quote.money
    if exact_money is None and quote.amount is not None and quote.currency_code:
        exact_money = Money(
            quote.amount,
            quote.currency_code,
            "legacy_amount",
            max(0, -quote.amount.as_tuple().exponent),
        )
    record: dict[str, object] = {
        "schema_version": 2,
        "report_schema_version": 2,
        "quote_id": quote.quote_id,
        "quote_name": quote.quote_name,
        "decision": result.decision.value,
        "reason": result.reason.value,
        "quote_status": quote.quote_status,
        "amount": _json_amount(quote.amount),
        "currency_code": quote.currency_code,
        "money": money_record(exact_money),
        "expiration_date": (
            quote.expiration_date.isoformat() if quote.expiration_date else None
        ),
        "last_modified_at": _json_datetime(quote.last_modified_at),
        "attempt_count": quote.attempt_count,
        "next_follow_up_at": (
            _json_datetime(quote.next_follow_up_at)
        ),
    }
    if result.contact is not None:
        record["contact"] = {
            "contact_id": result.contact.contact_id,
            "name": result.contact.name,
            "phone": mask_phone(result.contact.phone) if result.contact.phone else None,
        }
    return record


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


def _plan_record(result: CallPlanResult, selection: SelectionResult) -> dict[str, object]:
    """Create a token-free local record for one CALL-E planning attempt."""

    contact = selection.contact
    return {
        "report_schema_version": 2,
        "schema_version": 2,
        "quote_id": selection.quote.quote_id,
        "quote_name": selection.quote.quote_name,
        "opportunity_id": selection.quote.opportunity_id,
        "contact_id": contact.contact_id if contact else None,
        "phone": mask_phone(contact.phone) if contact and contact.phone else None,
        "decision": result.decision.value,
        "ready_to_run": result.ready_to_run,
        "plan_id": result.plan_id,
        "confirm_summary": result.confirm_summary,
        "clarifying_questions": list(result.clarifying_questions),
        "error": result.error,
    }


def _write_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


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
        "--output",
        default="results/quotewake_salesforce_dry_run.jsonl",
        help="Local JSONL report path.",
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
    parser.add_argument(
        "--plan-output",
        default="results/quotewake_salesforce_call_plans.jsonl",
        help="Local redacted CALL-E plan JSONL path.",
    )
    args = parser.parse_args(list(argv))

    try:
        if args.plan_calls and (not args.call_language or not args.call_region):
            raise ValueError(
                "--plan-calls requires explicit --call-language and --call-region values."
            )
        initial_follow_up_timing = load_initial_follow_up_timing(Path(args.config))
        regional_settings = load_regional_settings(Path(args.config))
        client = SalesforceClient(target_org=args.target_org)
        org = client.org_info()
        print("QuoteWake Salesforce dry-run")
        print(f"Target org: {args.target_org or org.alias or 'current default'}")
        print(f"Org username: {org.username}")
        print(f"Org ID: {org.org_id}")
        print("[OK] Salesforce connection verified (read-only)")

        repository = QuoteRepository(client, do_not_call_field=args.do_not_call_field)
        quote_fields, _ = repository.validate_schema()
        print("[OK] Quote and Contact schema verified")
        if args.do_not_call_field is None:
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
            allowed_quote_statuses=allowed_statuses,
            business_timezone=regional_settings.business_timezone,
        )
        quotes, contacts_by_opportunity = repository.load()
        now = datetime.now(timezone.utc)
        results: list[dict[str, object]] = []
        selections: list[SelectionResult] = []
        ready_count = 0
        for quote in quotes:
            result = evaluate_quote(quote, now, policy)
            if result.decision is SelectionDecision.READY:
                result = validate_callable_contact(
                    result, contacts_by_opportunity.get(quote.opportunity_id, [])
                )
            if result.decision is SelectionDecision.READY:
                ready_count += 1
            _print_selection(result, regional_settings=regional_settings)
            selections.append(result)
            results.append(_result_record(result))

        output_path = Path(args.output)
        _write_jsonl(output_path, results)
        print(f"\n[OK] Evaluated {len(results)} Quotes; READY: {ready_count}")
        print(f"[OK] Local JSONL report: {output_path}")

        plan_failures = 0
        if args.plan_calls:
            ready_selections = [
                result
                for result in selections
                if result.decision is SelectionDecision.READY
            ]
            plan_records: list[dict[str, object]] = []
            if ready_selections:
                planner = CallEPlanningClient(command=shlex.split(args.calle_command))
                planner.verify_ready()
                quote_lines = repository.load_quote_lines(
                    [result.quote.quote_id for result in ready_selections]
                )
                for selection in ready_selections:
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
                        plan_result = CallPlanResult(
                            quote_id=selection.quote.quote_id,
                            decision=CallPlanDecision.PLAN_ERROR,
                            ready_to_run=False,
                            error=str(exc),
                        )
                    print(
                        f"[CALL-E] {selection.quote.quote_name}: "
                        f"{plan_result.decision.value}"
                    )
                    plan_records.append(_plan_record(plan_result, selection))

            plan_output_path = Path(args.plan_output)
            _write_jsonl(plan_output_path, plan_records)
            print(
                f"[OK] Planned {len(plan_records)} READY Quotes; "
                f"errors: {plan_failures}"
            )
            print(f"[OK] Redacted CALL-E plan report: {plan_output_path}")
            print("[OK] plan_call only; run_call was not invoked")

        print("[OK] No Salesforce records were modified and no outbound calls were made")
        return 1 if plan_failures else 0
    except (SalesforceError, CallEPlanningError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        print(
            "[ERROR] No Salesforce records were modified and QuoteWake did not invoke "
            "an outbound call. Fix the authentication/schema/configuration issue and "
            "retry safely.",
            file=sys.stderr,
        )
        return 1


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


def _simulation_record(
    selection: SelectionResult,
    simulation: CallResult,
    task_id: str,
) -> dict[str, object]:
    """Build the local simulation report without customer secrets."""

    # Keep this explicit instead of serializing the dataclass wholesale so a
    # future provider field cannot accidentally leak into the report.
    quote = selection.quote
    contact = selection.contact
    return {
        "schema_version": 2,
        "report_schema_version": 2,
        "quote_id": quote.quote_id,
        "opportunity_id": quote.opportunity_id,
        "contact_id": contact.contact_id if contact else None,
        "phone": mask_phone(contact.phone) if contact and contact.phone else None,
        "simulation_id": simulation.simulation_id,
        "provider_status": simulation.provider_status,
        "outcome": simulation.outcome,
        "interest_level": simulation.interest_level,
        "preferred_date": (
            simulation.preferred_date.isoformat() if simulation.preferred_date else None
        ),
        "summary": simulation.summary,
        "next_action": simulation.next_action,
        "next_follow_up_at": (
            _json_datetime(simulation.next_follow_up_at)
        ),
        "simulation_at": (
            _json_datetime(simulation.simulation_timestamp)
        ),
        "result": {
            "provider_status": simulation.provider_status,
            "outcome": simulation.outcome,
            "interest_level": simulation.interest_level,
            "preferred_date": (
                simulation.preferred_date.isoformat() if simulation.preferred_date else None
            ),
            "summary": simulation.summary,
            "next_action": simulation.next_action,
        },
        "quote_status_written": (
            "Retry"
            if simulation.next_follow_up_at
            else "Completed"
            if simulation.outcome == "Interested"
            else "Stopped"
            if simulation.outcome in {"Not Interested", "Invalid Number"}
            else "Retry"
        ),
        "quote_result_written": simulation.outcome,
        "quote_follow_up_status": (
            "Retry"
            if simulation.next_follow_up_at
            else "Completed"
            if simulation.outcome == "Interested"
            else "Stopped"
            if simulation.outcome in {"Not Interested", "Invalid Number"}
            else "Retry"
        ),
        "task_id": task_id,
        "simulated": True,
        "salesforce_write_applied": True,
    }


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
        help="Required for retry outcomes; timezone-aware ISO-8601 DateTime.",
    )
    parser.add_argument(
        "--confirm-demo-write",
        action="store_true",
        help="Required acknowledgement before writing the seeded demo Quote and Task.",
    )
    parser.add_argument(
        "--simulation-output",
        default="results/quotewake_salesforce_simulations.jsonl",
        help="Redacted local JSONL simulation report path.",
    )
    args = parser.parse_args(list(argv))

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
        client = SalesforceClient(target_org=args.target_org)
        org = client.org_info()
        print("QuoteWake Salesforce CALL-E simulation")
        print(f"Target org: {args.target_org}")
        print(f"Org username: {org.username}")
        print(f"Org ID: {org.org_id}")
        print("[OK] Salesforce connection verified")

        repository = QuoteRepository(client, do_not_call_field=args.do_not_call_field)
        quote_fields, _ = repository.validate_schema()
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
            allowed_quote_statuses=allowed_statuses,
            business_timezone=regional_settings.business_timezone,
        )
        quotes, contacts_by_opportunity = repository.load()
        selected_quote = next((item for item in quotes if item.quote_id == args.quote_id), None)
        if selected_quote is None:
            raise ValueError(f"Quote {args.quote_id} was not returned by Salesforce.")
        if not selected_quote.quote_name.startswith("QuoteWake Demo - "):
            raise ValueError(
                "Simulation writes are restricted to seeded Quotes named 'QuoteWake Demo - ...'."
            )
        now = datetime.now(timezone.utc)
        selection = evaluate_quote(selected_quote, now, policy)
        if selection.decision is SelectionDecision.READY:
            selection = validate_callable_contact(
                selection, contacts_by_opportunity.get(selected_quote.opportunity_id, [])
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
            task_description=description,
            business_timezone=regional_settings.business_timezone,
        )
        record = _simulation_record(selection, simulation, write_result.task_id)
        output_path = Path(args.simulation_output)
        _write_jsonl(output_path, [record])
        print(f"[OK] Simulated outcome: {simulation.outcome}")
        print(f"[OK] Salesforce Quote updated and Task created: {write_result.task_id}")
        print(f"[OK] Redacted simulation report: {output_path}")
        print("[OK] No CALL-E command or outbound call was invoked")
        return 0
    except (SalesforceError, CallSimulationError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        print("[ERROR] No simulation write was applied.", file=sys.stderr)
        return 1


def _top_level_help_parser() -> argparse.ArgumentParser:
    """Build the complete public CLI help without executing a mode."""

    parser = argparse.ArgumentParser(
        prog="python3 -m quotewake_salesforce",
        description="QuoteWake Salesforce selection, CALL-E planning, and ES simulation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Modes:\n"
            "  No Salesforce flags       Run the backwards-compatible local invoice demo.\n"
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
    parser.add_argument("--json", action="store_true", help="Format the legacy demo as JSON.")
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
    parser.add_argument("--output", metavar="PATH", help="Selection JSONL report path.")
    parser.add_argument(
        "--plan-calls",
        action="store_true",
        help="Create CALL-E plans for READY Quotes without running calls.",
    )
    parser.add_argument("--call-language", metavar="LANGUAGE", help="Explicit call language.")
    parser.add_argument("--call-region", metavar="REGION", help="Explicit call region.")
    parser.add_argument("--calle-command", metavar="COMMAND", help="CALL-E CLI command path.")
    parser.add_argument("--plan-output", metavar="PATH", help="CALL-E plan JSONL report path.")
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
        help="Future timezone-aware ISO-8601 DateTime for Retry outcomes.",
    )
    parser.add_argument(
        "--confirm-demo-write",
        action="store_true",
        help="Acknowledge the simulator's seeded Quote + Task write.",
    )
    parser.add_argument(
        "--simulation-output",
        metavar="PATH",
        help="Redacted simulation JSONL report path.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch the Salesforce dry-run CLI while preserving the old scaffold demo."""

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
            "--output",
            "--plan-calls",
            "--call-language",
            "--call-region",
            "--calle-command",
            "--plan-output",
            "--simulate-call",
            "--quote-id",
            "--simulation-outcome",
            "--next-follow-up-at",
            "--confirm-demo-write",
            "--simulation-output",
        )
    ):
        if "--simulate-call" in selected:
            if "--plan-calls" in selected:
                print("[ERROR] --simulate-call and --plan-calls are mutually exclusive.", file=sys.stderr)
                return 1
            return salesforce_simulation_main(selected)
        return salesforce_dry_run_main(selected)
    return legacy_main(selected)
