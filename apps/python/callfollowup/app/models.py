from dataclasses import dataclass
from typing import Optional

# Status values used across the application.
# UNKNOWN is used whenever the outcome of an API call cannot be confirmed.
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "canceled", "unknown"}


@dataclass
class FollowUp:
    contact_name: str
    phone_number: str
    call_goal: str
    status: str = "pending"
    outcome: Optional[str] = None
    notes: Optional[str] = None
    next_action: Optional[str] = None
    callback_at: Optional[str] = None
    call_id: Optional[str] = None
