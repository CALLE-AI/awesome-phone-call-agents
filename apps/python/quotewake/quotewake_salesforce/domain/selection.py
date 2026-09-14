"""Pure quote and callable-contact selection functions."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Iterable

from quotewake_salesforce.phone import normalize_phone

from .models import (
    ContactTarget,
    QuoteCandidate,
    SelectionDecision,
    SelectionReason,
    SelectionResult,
)
from .policy import SelectionPolicy


KNOWN_FOLLOW_UP_STATUSES = frozenset(
    {"In Progress", "Retry", "Completed", "Stopped"}
)


def _skip(quote: QuoteCandidate, reason: SelectionReason) -> SelectionResult:
    return SelectionResult(SelectionDecision.SKIP, reason, quote)


def evaluate_quote(
    quote: QuoteCandidate, now: datetime, policy: SelectionPolicy
) -> SelectionResult:
    """Evaluate quote-level rules without Salesforce or other I/O."""

    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    if quote.enabled is not True:
        return _skip(quote, SelectionReason.DISABLED)
    if quote.follow_up_status is not None and (
        quote.follow_up_status == ""
        or quote.follow_up_status not in policy.actionable_follow_up_statuses
    ):
        reason = (
            SelectionReason.NON_ACTIONABLE_FOLLOW_UP_STATUS
            if quote.follow_up_status in KNOWN_FOLLOW_UP_STATUSES
            else SelectionReason.INVALID_FOLLOW_UP_STATUS
        )
        return _skip(quote, reason)
    if quote.follow_up_status == "Retry":
        if quote.next_follow_up_at is None or quote.next_follow_up_at.tzinfo is None:
            return _skip(quote, SelectionReason.NOT_DUE)
        if quote.next_follow_up_at > now:
            return _skip(quote, SelectionReason.NOT_DUE)
    if quote.attempt_count >= policy.max_attempts:
        return _skip(quote, SelectionReason.MAX_ATTEMPTS)
    business_now = now.astimezone(policy.business_timezone)
    if quote.expiration_date is not None and quote.expiration_date < business_now.date():
        return _skip(quote, SelectionReason.QUOTE_EXPIRED)
    if quote.opportunity_is_closed:
        return _skip(quote, SelectionReason.OPPORTUNITY_CLOSED)
    if quote.quote_status not in policy.allowed_quote_statuses:
        return _skip(quote, SelectionReason.INVALID_QUOTE_STATUS)
    if quote.follow_up_status is None:
        if quote.last_modified_at.tzinfo is None:
            raise ValueError("quote.last_modified_at must be timezone-aware")
        timing = policy.initial_follow_up_timing
        past_minimum_delay = (
            now >= quote.last_modified_at + timing.minimum_delay
        )
        past_standard_delay = (
            now >= quote.last_modified_at + timing.standard_delay
        )
        due_soon = (
            quote.expiration_date is not None
            and quote.expiration_date
            <= (business_now + timing.due_soon_window).date()
        )
        if not past_minimum_delay or not (past_standard_delay or due_soon):
            return _skip(quote, SelectionReason.NOT_DUE)
    return SelectionResult(SelectionDecision.READY, SelectionReason.READY, quote)


def validate_callable_contact(
    result: SelectionResult, contacts: Iterable[ContactTarget]
) -> SelectionResult:
    """Resolve and validate exactly one primary contact after quote checks.

    The Salesforce repository supplies only primary Opportunity Contact Roles
    to this stage. A missing role therefore cannot silently fall back to an
    arbitrary Account contact.
    """

    if result.decision is SelectionDecision.SKIP:
        return result

    primary_contacts = list(contacts)
    if not primary_contacts:
        return _skip(result.quote, SelectionReason.NO_PRIMARY_CONTACT)
    if len(primary_contacts) > 1:
        return _skip(result.quote, SelectionReason.MULTIPLE_PRIMARY_CONTACTS)

    contact = primary_contacts[0]
    if contact.do_not_call:
        return SelectionResult(
            SelectionDecision.SKIP, SelectionReason.DO_NOT_CALL, result.quote
        )
    if not contact.phone:
        return SelectionResult(
            SelectionDecision.SKIP, SelectionReason.NO_PHONE, result.quote
        )

    normalized = normalize_phone(contact.phone)
    if normalized is None:
        return SelectionResult(
            SelectionDecision.SKIP, SelectionReason.INVALID_PHONE, result.quote
        )
    return SelectionResult(
        SelectionDecision.READY,
        SelectionReason.READY,
        result.quote,
        replace(contact, phone=normalized),
    )
