"""Data models for GetPaid.

Kept dependency-free (plain dataclasses) so the app has no ORM to configure
before a judge can run it.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Optional
import uuid


class CallStatus(str, Enum):
    NOT_CALLED = "not_called"
    IN_PROGRESS = "in_progress"
    PAID = "paid"
    PROMISED = "promised"
    DISPUTED = "disputed"
    VOICEMAIL = "voicemail"
    NO_ANSWER = "no_answer"
    WRONG_NUMBER = "wrong_number"
    DECLINED = "declined"
    FAILED = "failed"


# Statuses that make an invoice eligible for an automatic follow-up call:
# "promised" once its promised_date has passed, and "voicemail"/"no_answer"
# once RETRY_AFTER_HOURS has elapsed since the last attempt (see
# Invoice.is_eligible_for_auto_follow_up). Anything else (disputed, wrong
# number, declined) is routed to a human instead of being retried
# automatically.
AUTO_FOLLOW_UP_STATUSES = {CallStatus.PROMISED, CallStatus.VOICEMAIL, CallStatus.NO_ANSWER}

# An invoice with no answer/voicemail becomes eligible for one automatic
# retry call this many hours after the last attempt. Overridable via env var
# so a demo doesn't have to wait 24h to show the retry firing.
def retry_after_hours() -> float:
    return float(os.environ.get("RETRY_AFTER_HOURS", "24"))


# Hard cap on automatic follow-up calls per invoice (not counting the first,
# manually-triggered call). Once hit, the invoice is excluded from all
# future automatic follow-up runs and flagged for a human to look at.
MAX_AUTO_FOLLOW_UPS = 2


@dataclass
class CallAttempt:
    id: str
    invoice_id: str
    created_at: str
    mode: str  # "fixture" | "live"
    status: CallStatus
    promised_date: Optional[str] = None
    note: str = ""
    calle_call_id: Optional[str] = None
    transcript_url: Optional[str] = None

    def to_dict(self):
        d = asdict(self)
        d["status"] = self.status.value
        return d


@dataclass
class Invoice:
    id: str
    freelancer_name: str
    client_name: str
    client_phone: str  # E.164
    invoice_number: str
    amount: str
    currency: str
    due_date: str  # ISO date
    region: str = "US"
    locale: str = "en-US"
    notes: str = ""
    status: CallStatus = CallStatus.NOT_CALLED
    promised_date: Optional[str] = None
    follow_up_count: int = 0
    last_attempt_at: Optional[str] = None
    needs_human_review: bool = False
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    attempts: list = field(default_factory=list)

    @staticmethod
    def new(**kwargs) -> "Invoice":
        return Invoice(id=str(uuid.uuid4()), **kwargs)

    def to_dict(self):
        d = asdict(self)
        d["status"] = self.status.value
        return d

    def is_overdue_promise(self) -> bool:
        if self.status != CallStatus.PROMISED or not self.promised_date:
            return False
        try:
            return date.fromisoformat(self.promised_date) < date.today()
        except ValueError:
            return False

    def is_stale_attempt(self) -> bool:
        """True if this invoice is sitting in voicemail/no_answer and the
        last attempt happened more than retry_after_hours() ago."""
        if self.status not in (CallStatus.VOICEMAIL, CallStatus.NO_ANSWER):
            return False
        if not self.last_attempt_at:
            return False
        try:
            last = datetime.fromisoformat(self.last_attempt_at)
        except ValueError:
            return False
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - last >= timedelta(hours=retry_after_hours())

    def is_eligible_for_auto_follow_up(self) -> bool:
        """Single source of truth for whether an automatic follow-up call
        should be placed: caps total auto follow-ups, then applies the
        date-based rule for promised invoices and the time-based retry rule
        for voicemail/no_answer invoices."""
        if self.follow_up_count >= MAX_AUTO_FOLLOW_UPS:
            return False
        if self.status == CallStatus.PROMISED:
            return self.is_overdue_promise()
        if self.status in (CallStatus.VOICEMAIL, CallStatus.NO_ANSWER):
            return self.is_stale_attempt()
        return False
