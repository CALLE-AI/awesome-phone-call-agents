"""QuoteWake CLI and backwards-compatible local scaffold helpers."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from quotewake_salesforce.domain.models import SelectionDecision, SelectionResult
from quotewake_salesforce.domain.policy import SelectionPolicy, configured_quote_statuses
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact
from quotewake_salesforce.salesforce.client import (
    SalesforceClient,
    SalesforceError,
    SalesforceSchemaError,
)
from quotewake_salesforce.salesforce.quotes import QuoteRepository

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


def _result_record(result: SelectionResult) -> dict[str, object]:
    """Create a concise, secret-free JSONL record."""

    quote = result.quote
    record: dict[str, object] = {
        "quote_id": quote.quote_id,
        "quote_name": quote.quote_name,
        "decision": result.decision.value,
        "reason": result.reason.value,
        "quote_status": quote.quote_status,
        "amount": _json_amount(quote.amount),
        "currency_code": quote.currency_code,
        "attempt_count": quote.attempt_count,
        "next_follow_up_at": (
            quote.next_follow_up_at.isoformat() if quote.next_follow_up_at else None
        ),
    }
    if result.contact is not None:
        record["contact"] = {
            "contact_id": result.contact.contact_id,
            "name": result.contact.name,
            "phone": result.contact.phone,
        }
    return record


def _display_amount(result: SelectionResult) -> str:
    amount = result.quote.amount
    if amount is None:
        return "amount unavailable"
    currency = result.quote.currency_code or ""
    return f"{currency + ' ' if currency else ''}{amount:g}"


def _print_selection(result: SelectionResult) -> None:
    quote = result.quote
    print(f"\n{quote.quote_name} | {_display_amount(result)}")
    print(result.decision.value if result.decision is SelectionDecision.READY else f"SKIP: {result.reason.value}")
    if result.decision is SelectionDecision.READY and result.contact is not None:
        print(f"Contact: {result.contact.name}")
        print(f"Phone: {result.contact.phone}")
        print(f"Attempts: {quote.attempt_count}")
        next_at = quote.next_follow_up_at.isoformat() if quote.next_follow_up_at else "not set"
        print(f"Next follow-up: {next_at}")


def salesforce_dry_run_main(argv: Sequence[str]) -> int:
    """Read Salesforce, evaluate quotes, and write only a local JSONL report."""

    parser = argparse.ArgumentParser(
        description="QuoteWake Salesforce quote selection dry-run (read-only)."
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
    args = parser.parse_args(list(argv))

    try:
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
        status_values = {
            item.get("value")
            for item in quote_fields["Status"].get("picklistValues", [])
            if isinstance(item, dict) and isinstance(item.get("value"), str)
        }
        allowed_statuses = configured_quote_statuses(args.allowed_quote_status)
        unknown_statuses = sorted(allowed_statuses - status_values)
        if unknown_statuses:
            raise SalesforceSchemaError(
                "Configured Quote statuses are not available in this org: "
                + ", ".join(unknown_statuses)
                + f". Available values: {', '.join(sorted(status_values))}"
            )
        policy = SelectionPolicy(allowed_quote_statuses=allowed_statuses)
        quotes, contacts_by_opportunity = repository.load()
        now = datetime.now(timezone.utc)
        results: list[dict[str, object]] = []
        ready_count = 0
        for quote in quotes:
            result = evaluate_quote(quote, now, policy)
            if result.decision is SelectionDecision.READY:
                result = validate_callable_contact(
                    result, contacts_by_opportunity.get(quote.opportunity_id, [])
                )
            if result.decision is SelectionDecision.READY:
                ready_count += 1
            _print_selection(result)
            results.append(_result_record(result))

        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in results),
            encoding="utf-8",
        )
        print(f"\n[OK] Evaluated {len(results)} Quotes; READY: {ready_count}")
        print(f"[OK] Local JSONL report: {output_path}")
        print("[OK] No Salesforce records were modified and no CALL-E calls were made")
        return 0
    except (SalesforceError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        print(
            "[ERROR] This milestone is read-only; no Salesforce records were modified. "
            "Fix the authentication/schema/configuration issue and retry safely.",
            file=sys.stderr,
        )
        return 1


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch the Salesforce dry-run CLI while preserving the old scaffold demo."""

    selected = list(argv) if argv is not None else sys.argv[1:]
    if any(
        flag in selected
        for flag in (
            "--dry-run",
            "--target-org",
            "--allowed-quote-status",
            "--do-not-call-field",
            "--output",
        )
    ):
        return salesforce_dry_run_main(selected)
    return legacy_main(selected)

