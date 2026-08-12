"""One-shot QuoteWake Salesforce/CALL-E workflow."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import sys
import uuid
from pathlib import Path
from typing import Sequence

from quotewake_salesforce.calle import CallEClient
from quotewake_salesforce.config import (
    DEFAULT_CONFIG_PATH,
    load_call_prompt,
    load_environment,
    load_follow_up_policies,
    load_initial_follow_up_timing,
    load_logging_settings,
)
from quotewake_salesforce.domain.call_request import build_call_request
from quotewake_salesforce.domain.models import SelectionDecision, SelectionResult
from quotewake_salesforce.domain.policy import SelectionPolicy, calculate_next_follow_up, configured_quote_statuses
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact
from quotewake_salesforce.presentation import format_money
from quotewake_salesforce.salesforce.client import SalesforceClient, SalesforceError
from quotewake_salesforce.salesforce.quotes import QuoteRepository, _active_picklist_values
from quotewake_salesforce.structured_logging import configure_logging, log_event, log_exception, log_context


def _print_selection(result: SelectionResult, *, regional_settings=None) -> None:
    quote = result.quote
    amount = format_money(quote.money or quote.amount, quote.currency_code, regional_settings=regional_settings) if quote.amount is not None else "amount unavailable"
    print(f"Quote {quote.quote_id}: {quote.quote_name} | {amount} | {result.decision.value} ({result.reason.value})")
    if result.decision is SelectionDecision.READY and result.contact:
        print(f"  Contact: {result.contact.name} | phone configured: yes | attempts: {quote.attempt_count}")


def _task_description(call_result) -> str:
    preferred = f" Preferred date: {call_result.preferred_date.isoformat()}." if call_result.preferred_date else ""
    return f"QuoteWake call outcome: {call_result.outcome}. Interest: {call_result.interest_level}. Summary: {call_result.summary}. Next action: {call_result.next_action}.{preferred} CALL-E call ID: {call_result.call_id}."


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process Salesforce Quotes with QuoteWake (dry-run by default).")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--execute", action="store_true", help="Place calls and write completed results to Salesforce.")
    mode.add_argument("--show-prompt", action="store_true", help="Print rendered prompts without CALL-E or Salesforce writes.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="QuoteWake TOML configuration path.")
    parser.add_argument("--allowed-quote-status", action="append", help="Allowed Salesforce Quote status.")
    parser.add_argument("--do-not-call-field", help="Optional Contact opt-out field API name.")
    parser.add_argument("--max-calls", type=_positive_int, default=10, metavar="N", help="Maximum READY Quotes to process in this run (default: 10).")
    return parser


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--max-calls must be a positive integer") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--max-calls must be a positive integer")
    return parsed


def salesforce_dry_run_main(argv: Sequence[str]) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv))
    run_id = uuid.uuid4().hex
    try:
        prompt_settings = load_call_prompt(Path(args.config))
        settings = load_logging_settings(Path(args.config))
        configure_logging(level=settings.level, log_format=settings.format, log_directory=settings.directory, max_bytes=settings.max_bytes, backup_count=settings.backup_count)
        with log_context(run_id=run_id):
            env = load_environment(require_calle=args.execute)
            timing = load_initial_follow_up_timing(Path(args.config))
            policies = load_follow_up_policies(Path(args.config))
            allowed = configured_quote_statuses(args.allowed_quote_status)
            client = SalesforceClient(env.salesforce_domain, env.salesforce_client_id, env.salesforce_client_secret, env.salesforce_api_version)
            repository = QuoteRepository(
                client,
                do_not_call_field=(
                    args.do_not_call_field or env.salesforce_do_not_call_field
                ),
                default_currency_code=env.salesforce_currency_code,
            )
            fields, _ = repository.validate_schema()
            regional = repository.load_organization_regional_settings()
            available = _active_picklist_values(fields["Status"]) or set()
            unknown = allowed - available
            if unknown:
                raise SalesforceError("Configured Quote statuses are unavailable in Salesforce")
            policy = SelectionPolicy(timing, policies.retry, allowed_quote_statuses=allowed, business_timezone=regional.business_timezone)
            quotes, contacts = repository.load()
            now = datetime.now(timezone.utc)
            selections: list[SelectionResult] = []
            for quote in quotes:
                selected = evaluate_quote(quote, now, policy)
                if selected.decision is SelectionDecision.READY:
                    selected = validate_callable_contact(selected, contacts.get(quote.opportunity_id, []))
                selections.append(selected)
                _print_selection(selected, regional_settings=regional)
            ready = [item for item in selections if item.decision is SelectionDecision.READY]
            selected_for_processing = ready[: args.max_calls]
            deferred = len(ready) - len(selected_for_processing)
            lines = repository.load_quote_lines([item.quote.quote_id for item in selected_for_processing]) if selected_for_processing else {}
            failures = 0
            if args.show_prompt:
                for selected in selected_for_processing:
                    quote = selected.quote
                    try:
                        request = build_call_request(selected, lines.get(quote.quote_id, []), prompt_settings=prompt_settings, regional_settings=regional)
                        print(f"Quote {quote.quote_id} prompt:\n{request.goal}\n")
                    except Exception as exc:
                        failures += 1
                        log_exception("quote_prompt_failed", exc, quote_id=quote.quote_id)
                        print(f"[ERROR] Quote {quote.quote_id} prompt failed ({type(exc).__name__})", file=sys.stderr)
                print(
                    f"Evaluated: {len(selections)}; READY: {len(ready)}; "
                    f"selected for processing: {len(selected_for_processing)}; "
                    f"deferred by limit: {deferred}; failures: {failures}"
                )
                return 1 if failures else 0
            calle = CallEClient(api_key=env.calle_api_key, base_url=env.calle_base_url, execute=args.execute)
            for selected in selected_for_processing:
                quote = selected.quote
                try:
                    request = build_call_request(selected, lines.get(quote.quote_id, []), prompt_settings=prompt_settings, regional_settings=regional)
                    next_attempt = quote.attempt_count + 1
                    retry_marker = quote.next_follow_up_at
                    if not args.execute:
                        print(f"[DRY-RUN] {quote.quote_id}: {calle.preview(request, next_attempt=next_attempt, retry_marker=retry_marker)['idempotency_key']}")
                        continue
                    result = calle.execute(request, next_attempt=next_attempt, retry_marker=retry_marker)
                    update = calculate_next_follow_up(quote, result, policies)
                    task_description = _task_description(result)
                except Exception as exc:
                    failures += 1
                    log_exception("quote_processing_failed", exc, quote_id=quote.quote_id)
                    print(f"[ERROR] Quote {quote.quote_id} failed ({type(exc).__name__})", file=sys.stderr)
                    continue

                # A completed CALL-E result without a Salesforce write would
                # be unsafe to treat as a successful batch item.  Stop here so
                # the next quote is not called with an unknown persisted state.
                try:
                    client.composite_write(
                        quote,
                        selected.contact,
                        update,
                        result,
                        task_description=task_description,
                        business_timezone=regional.business_timezone,
                    )
                except Exception as exc:
                    failures += 1
                    log_exception(
                        "quote_persist_failed",
                        exc,
                        quote_id=quote.quote_id,
                        call_id=result.call_id,
                        phase="persist",
                    )
                    print(
                        f"[ERROR] Quote {quote.quote_id} persistence failed ({type(exc).__name__}); "
                        "aborting remaining calls",
                        file=sys.stderr,
                    )
                    break
                log_event("quote_processed", quote_id=quote.quote_id, outcome=result.outcome)
            print(
                f"Evaluated: {len(selections)}; READY: {len(ready)}; "
                f"selected for processing: {len(selected_for_processing)}; "
                f"deferred by limit: {deferred}; failures: {failures}"
            )
            return 1 if args.execute and failures else 0
    except Exception as exc:
        log_exception("run_failed", exc)
        detail = str(exc).strip()
        message = f"[ERROR] QuoteWake run failed ({type(exc).__name__})"
        if isinstance(exc, (SalesforceError, ValueError)) and detail:
            message += f": {detail}"
        print(message, file=sys.stderr)
        return 1


def main(argv: Sequence[str] | None = None) -> int:
    selected = list(argv) if argv is not None else sys.argv[1:]
    if "--help" in selected or "-h" in selected:
        _build_parser().print_help()
        return 0
    return salesforce_dry_run_main(selected)
