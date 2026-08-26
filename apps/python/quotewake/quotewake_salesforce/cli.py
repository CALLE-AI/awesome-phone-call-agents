"""One-shot QuoteWake Salesforce/CALL-E workflow."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import sys
import time
import uuid
from pathlib import Path
from typing import Sequence

from quotewake_salesforce.calle import CallEClient
from quotewake_salesforce.calle.client import failure_details, validate_idempotency_suffix
from quotewake_salesforce.config import (
    DEFAULT_CONFIG_PATH,
    load_call_prompt,
    load_environment,
    load_follow_up_policies,
    load_initial_follow_up_timing,
    load_logging_settings,
)
from quotewake_salesforce.domain.call_request import build_call_request
from quotewake_salesforce.domain.models import CallResult, FollowUpUpdate, SelectionDecision, SelectionResult
from quotewake_salesforce.domain.policy import RetryPolicy, SelectionPolicy, calculate_next_follow_up, configured_quote_statuses
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact
from quotewake_salesforce.presentation import format_money
from quotewake_salesforce.salesforce.client import SalesforceClient, SalesforceError
from quotewake_salesforce.salesforce.quotes import QuoteRepository, _active_picklist_values
from quotewake_salesforce.structured_logging import configure_logging, log_event, log_exception, log_context, mask_identifier


def _print_selection(result: SelectionResult, *, regional_settings=None) -> None:
    quote = result.quote
    amount = format_money(quote.money or quote.amount, quote.currency_code, regional_settings=regional_settings) if quote.amount is not None else "amount unavailable"
    print(f"Quote {mask_identifier(quote.quote_id, key='quote_id')}: {quote.quote_name} | {amount} | {result.decision.value} ({result.reason.value})")


def _follow_up_sort_key(selected: SelectionResult) -> tuple[object, object, str]:
    """Order READY Quotes by the oldest actionable follow-up timestamp."""

    quote = selected.quote
    follow_up_at = (
        quote.next_follow_up_at
        if quote.follow_up_status == "Retry" and quote.next_follow_up_at is not None
        else quote.last_modified_at
    )
    return (follow_up_at, quote.last_modified_at, quote.quote_id)


def _print_call_summary(calls: list[tuple[object, object]], *, regional_settings=None) -> None:
    """Print one selection-style line for every call persisted in this run."""

    if not calls:
        return
    print("\nCall results:")
    for quote, result in calls:
        amount = (
            format_money(
                quote.money or quote.amount,
                quote.currency_code,
                regional_settings=regional_settings,
            )
            if quote.amount is not None
            else "amount unavailable"
        )
        disposition = (
            "ATTEMPTED"
            if result.outcome in {"call_back_later", "call_not_established", "no_answer", "busy", "unknown"}
            else "CALLED"
        )
        print(
            f"Quote {mask_identifier(quote.quote_id, key='quote_id')}: {quote.quote_name} | {amount} | "
            f"{disposition} ({result.outcome})"
        )


_MAX_ATTEMPTS_NEXT_ACTION = (
    "QuoteWake will make no further attempts. A salesperson should call the "
    "customer directly."
)


def _resolve_task_next_action(
    call_result: CallResult,
    update: FollowUpUpdate,
    retry_policy: RetryPolicy,
) -> str:
    """Resolve Task guidance without changing domain or provider results."""

    if (
        update.follow_up_status == "Stopped"
        and retry_policy.retries_outcome(call_result.outcome)
    ):
        return _MAX_ATTEMPTS_NEXT_ACTION
    return call_result.next_action


def _task_description(call_result: CallResult, *, next_action: str | None = None) -> str:
    lines = [
        f"QuoteWake call outcome: {call_result.outcome}",
        f"Interest level: {call_result.interest_level}",
        "Summary:",
        call_result.summary,
        "Next action:",
        call_result.next_action if next_action is None else next_action,
    ]
    if call_result.preferred_date:
        lines.extend(("Preferred date:", call_result.preferred_date.isoformat()))
    lines.extend(("CALL-E call ID:", call_result.call_id))
    return "\n".join(lines)


def _call_error_message(error: BaseException) -> str:
    """Render bounded CALL-E diagnostics and reconciliation guidance."""

    details = failure_details(error)
    parts = [
        f"classification={details['classification']}",
        f"code={details['code']}",
        f"reason={details['reason']}",
    ]
    if details["http_status"] is not None:
        parts.append(f"http_status={details['http_status']}")
    message = "CALL-E " + ", ".join(parts)
    if details["creation_unknown"]:
        key = details.get("idempotency_key")
        suffix = f" ({mask_identifier(key, key='idempotency_key')})" if isinstance(key, str) and key else ""
        message += (
            ". Creation outcome is unknown; the call may already exist. "
            "Reconcile or replay with the same idempotency key" + suffix + "; "
            "do not create a new attempt."
        )
    elif details["result_unknown"]:
        call_id = details.get("provider_call_id") or "unknown"
        message += (
            f". CALL-E accepted call {mask_identifier(call_id, key='call_id')}, terminal result is unknown; "
            "reconcile this call before any new attempt."
        )
    elif details["code"] == "call_not_ready":
        message += ". Review CALL-E task, recipient, locale, and region readiness before retrying."
    return message


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Process Salesforce Quotes with QuoteWake (dry-run by default).",
        epilog=(
            "Example (test/support only): uv run python -m quotewake_salesforce "
            "--idempotency-suffix test-02 --max-calls 1. Omit this option in production."
        ),
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--execute", action="store_true", help="Place calls and write completed results to Salesforce.")
    mode.add_argument("--show-prompt", action="store_true", help="Print rendered prompts without CALL-E or Salesforce writes.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="QuoteWake TOML configuration path.")
    parser.add_argument("--allowed-quote-status", action="append", help="Allowed Salesforce Quote status.")
    parser.add_argument("--do-not-call-field", help="Optional Contact opt-out field API name.")
    parser.add_argument("--max-calls", type=_positive_int, default=10, metavar="N", help="Maximum READY Quotes to process in this run (default: 10).")
    parser.add_argument(
        "--idempotency-suffix",
        type=validate_idempotency_suffix,
        metavar="SUFFIX",
        help=(
            "Optional test/support suffix appended to CALL-E idempotency keys; "
            "omit in production (ASCII alphanumeric start, max 32 characters)."
        ),
    )
    return parser


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--max-calls must be a positive integer") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--max-calls must be a positive integer")
    return parsed


def _run_mode(args: argparse.Namespace) -> str:
    if args.execute:
        return "execute"
    if args.show_prompt:
        return "show_prompt"
    return "dry_run"


def _log_run_finished(
    *,
    run_id: str,
    mode: str,
    exit_code: int,
    started: float,
    evaluated: int | None = None,
    ready: int | None = None,
    selected_for_processing: int | None = None,
    deferred: int | None = None,
    failures: int | None = None,
) -> None:
    """Emit the final normal lifecycle event after external clients are closed."""

    counters = {
        "evaluated": evaluated,
        "ready": ready,
        "selected_for_processing": selected_for_processing,
        "deferred": deferred,
        "failures": failures,
    }
    log_event(
        "run_finished",
        level="INFO",
        run_id=run_id,
        mode=mode,
        exit_code=exit_code,
        elapsed_ms=round(max(0.0, time.perf_counter() - started) * 1000, 2),
        **{name: value for name, value in counters.items() if value is not None},
    )


def salesforce_dry_run_main(argv: Sequence[str]) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv))
    run_id = uuid.uuid4().hex
    started = time.perf_counter()
    mode = _run_mode(args)
    evaluated: int | None = None
    ready_count: int | None = None
    selected_count: int | None = None
    deferred_count: int | None = None
    failures_count: int | None = None
    try:
        prompt_settings = load_call_prompt(Path(args.config))
        settings = load_logging_settings(Path(args.config))
        configure_logging(level=settings.level, log_format=settings.format, log_directory=settings.directory, max_bytes=settings.max_bytes, backup_count=settings.backup_count, redact_sensitive=settings.redact_sensitive)
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
            # The Salesforce query provides a stable candidate stream, but the
            # throughput limit must favour the oldest actionable follow-up,
            # not the oldest Salesforce record. Retry due dates and initial
            # follow-up timestamps share one timeline; ties use LastModifiedDate
            # and Quote ID.
            ready.sort(key=_follow_up_sort_key)
            selected_for_processing = ready[: args.max_calls]
            deferred = len(ready) - len(selected_for_processing)
            evaluated = len(selections)
            ready_count = len(ready)
            selected_count = len(selected_for_processing)
            deferred_count = deferred
            lines = repository.load_quote_lines([item.quote.quote_id for item in selected_for_processing]) if selected_for_processing else {}
            failures = 0
            called_quotes: list[tuple[object, object]] = []
            if args.show_prompt:
                for selected in selected_for_processing:
                    quote = selected.quote
                    try:
                        request = build_call_request(selected, lines.get(quote.quote_id, []), prompt_settings=prompt_settings, regional_settings=regional)
                        print(f"Quote {mask_identifier(quote.quote_id, key='quote_id')} prompt:\n{request.goal}\n")
                    except Exception as exc:
                        failures += 1
                        log_exception("quote_prompt_failed", exc, quote_id=quote.quote_id)
                        print(f"[ERROR] Quote {mask_identifier(quote.quote_id, key='quote_id')} prompt failed ({type(exc).__name__})", file=sys.stderr)
                print(
                    f"Evaluated: {len(selections)}; READY: {len(ready)}; "
                    f"selected for processing: {len(selected_for_processing)}; "
                    f"deferred by limit: {deferred}; failures: {failures}"
                )
                exit_code = 1 if failures else 0
                failures_count = failures
                _log_run_finished(
                    run_id=run_id,
                    mode=mode,
                    exit_code=exit_code,
                    started=started,
                    evaluated=evaluated,
                    ready=ready_count,
                    selected_for_processing=selected_count,
                    deferred=deferred_count,
                    failures=failures_count,
                )
                return exit_code
            calle = CallEClient(
                api_key=env.calle_api_key,
                base_url=env.calle_base_url,
                execute=args.execute,
                timeout_seconds=prompt_settings.wait_timeout_seconds,
                raw_calle_api=settings.raw_calle_api,
                idempotency_suffix=args.idempotency_suffix,
            )
            try:
                for selected in selected_for_processing:
                    quote = selected.quote
                    try:
                        request = build_call_request(selected, lines.get(quote.quote_id, []), prompt_settings=prompt_settings, regional_settings=regional)
                        next_attempt = quote.attempt_count + 1
                        retry_marker = quote.next_follow_up_at
                        if not args.execute:
                            print(f"[DRY-RUN] {mask_identifier(quote.quote_id, key='quote_id')}: {mask_identifier(calle.preview(request, next_attempt=next_attempt, retry_marker=retry_marker)['idempotency_key'], key='idempotency_key')}")
                            continue
                        result = calle.execute(request, next_attempt=next_attempt, retry_marker=retry_marker)
                        update = calculate_next_follow_up(quote, result, policies)
                        task_next_action = _resolve_task_next_action(
                            result,
                            update,
                            policies.retry,
                        )
                        task_description = _task_description(
                            result,
                            next_action=task_next_action,
                        )
                    except Exception as exc:
                        failures += 1
                        details = failure_details(exc)
                        log_event(
                            "quote_processing_failed",
                            quote_id=quote.quote_id,
                            classification=details["classification"],
                            http_status=details["http_status"],
                            code=details["code"],
                            reason=details["reason"],
                            creation_unknown=details["creation_unknown"],
                            result_unknown=details["result_unknown"],
                            provider_call_id=details["provider_call_id"],
                            phase=details["phase"],
                            idempotency_key=details["idempotency_key"],
                            error_type=type(exc).__name__,
                        )
                        if args.execute and hasattr(exc, "classification"):
                            print(f"[ERROR] Quote {mask_identifier(quote.quote_id, key='quote_id')} failed: {_call_error_message(exc)}", file=sys.stderr)
                        else:
                            print(f"[ERROR] Quote {mask_identifier(quote.quote_id, key='quote_id')} failed ({type(exc).__name__})", file=sys.stderr)
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
                            f"[ERROR] Quote {mask_identifier(quote.quote_id, key='quote_id')} persistence failed ({type(exc).__name__}); "
                            "aborting remaining calls",
                            file=sys.stderr,
                        )
                        break
                    log_event(
                        "quote_processed",
                        quote_id=quote.quote_id,
                        outcome=result.outcome,
                        follow_up_status=update.follow_up_status,
                        attempt_count=update.attempt_count,
                    )
                    called_quotes.append((quote, result))
            finally:
                calle.close()
            _print_call_summary(called_quotes, regional_settings=regional)
            print(
                f"Evaluated: {len(selections)}; READY: {len(ready)}; "
                f"selected for processing: {len(selected_for_processing)}; "
                f"deferred by limit: {deferred}; failures: {failures}"
            )
            exit_code = 1 if args.execute and failures else 0
            failures_count = failures
            _log_run_finished(
                run_id=run_id,
                mode=mode,
                exit_code=exit_code,
                started=started,
                evaluated=evaluated,
                ready=ready_count,
                selected_for_processing=selected_count,
                deferred=deferred_count,
                failures=failures_count,
            )
            return exit_code
    except Exception as exc:
        log_exception("run_failed", exc)
        detail = str(exc).strip()
        message = f"[ERROR] QuoteWake run failed ({type(exc).__name__})"
        if isinstance(exc, (SalesforceError, ValueError)) and detail:
            message += f": {detail}"
        print(message, file=sys.stderr)
        _log_run_finished(
            run_id=run_id,
            mode=mode,
            exit_code=1,
            started=started,
            evaluated=evaluated,
            ready=ready_count,
            selected_for_processing=selected_count,
            deferred=deferred_count,
            failures=failures_count,
        )
        return 1


def main(argv: Sequence[str] | None = None) -> int:
    selected = list(argv) if argv is not None else sys.argv[1:]
    if "--help" in selected or "-h" in selected:
        _build_parser().print_help()
        return 0
    return salesforce_dry_run_main(selected)
