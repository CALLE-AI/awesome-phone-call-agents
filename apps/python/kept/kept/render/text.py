"""Terminal rendering. Every number here is printed from the same view model."""

from __future__ import annotations

from kept.engine import RunSummary
from kept.models import CallPlan, PromiseStatus, mask_phone
from kept.money import format_minor
from kept.report import Portfolio

_STATUS_MARK = {
    PromiseStatus.KEPT: "kept",
    PromiseStatus.OPEN: "open",
    PromiseStatus.PARTIAL: "partial",
    PromiseStatus.BROKEN: "BROKEN",
    PromiseStatus.SUPERSEDED: "replaced",
}


def render_plan(plan: CallPlan) -> str:
    lines = [_heading("CALL PLAN"), f"  calls to place : {plan.calls_required}"]
    for target in plan.targets:
        lines.append(
            f"    dial {mask_phone(target.customer.primary_phone or '')}  {target.invoice.id:<10}"
            f"  {target.customer.name:<24}  {target.cycle.value:<15}"
            f"  {format_minor(target.outstanding_minor, target.invoice.currency)}"
        )
    lines.append(f"  calls avoided  : {len(plan.suppressions)}")
    for suppression in plan.suppressions:
        lines.append(
            f"    skip {suppression.invoice_id:<10}  {suppression.reason.value:<26}  {suppression.detail}"
        )
    return "\n".join(lines)


def render_run(summary: RunSummary) -> str:
    lines = [
        _heading(f"RUN {summary.run_id}"),
        f"  calls placed     : {summary.calls_placed}",
        f"  promises recorded: {len(summary.promises)}",
        f"  disputes recorded: {len(summary.disputes)}",
        f"  handed to human  : {len(summary.rejections)}",
        f"  call failures    : {len(summary.failures)}",
    ]
    for promise in summary.promises:
        lines.append(
            f"    promise {promise.invoice_id:<10} "
            f"{format_minor(promise.amount_minor, '')} by {promise.due_date}"
            f"  ({promise.method}, confidence {promise.confidence:.2f})"
        )
    for invoice_id, reason in summary.rejections:
        lines.append(f"    no record {invoice_id:<10} {reason}")
    for invoice_id, code in summary.failures:
        lines.append(f"    failed    {invoice_id:<10} {code}")
    return "\n".join(lines)


def render_portfolio(portfolio: Portfolio) -> str:
    lines = [_heading(f"PORTFOLIO as of {portfolio.as_of}"), _totals(portfolio), ""]
    lines.append("  PROMISES")
    lines.append(f"    {'invoice':<10} {'customer':<24} {'amount':>14} {'due':<12} {'status':<10} paid")
    for line in portfolio.promises:
        lines.append(
            f"    {line.promise.invoice_id:<10} {line.customer_name:<24} "
            f"{format_minor(line.promise.amount_minor, portfolio.currency):>14} "
            f"{line.promise.due_date.isoformat():<12} {_STATUS_MARK[line.status]:<10} "
            f"{format_minor(line.paid_minor, portfolio.currency)}"
        )
    lines.append("")
    lines.append("  INVOICES")
    lines.append(f"    {'invoice':<10} {'customer':<24} {'outstanding':>14} next action")
    for line in portfolio.invoices:
        name = line.customer.name if line.customer else line.invoice.customer_id
        lines.append(
            f"    {line.invoice.id:<10} {name:<24} "
            f"{format_minor(line.outstanding_minor, portfolio.currency):>14} {line.next_action}"
        )
    if portfolio.suppressions:
        lines.append("")
        lines.append("  CALLS AVOIDED")
        for reason, count in portfolio.suppressions:
            lines.append(f"    {count:>4}  {reason}")
    return "\n".join(lines)


def _totals(portfolio: Portfolio) -> str:
    currency = portfolio.currency
    keep_rate = portfolio.keep_rate
    rate = "n/a" if keep_rate is None else f"{keep_rate * 100:.0f}%"
    return "\n".join(
        [
            f"  outstanding            : {format_minor(portfolio.outstanding_minor, currency)}",
            f"  covered by open promise: {format_minor(portfolio.covered_by_open_promise_minor, currency)}",
            f"  arrived on promise     : {format_minor(portfolio.kept_minor, currency)}",
            f"  promised but not paid  : {format_minor(portfolio.broken_minor, currency)}",
            f"  promise keep rate      : {rate}",
            f"  calls avoided to date  : {portfolio.calls_avoided}",
        ]
    )


def _heading(title: str) -> str:
    return f"\n{title}\n{'-' * len(title)}"
