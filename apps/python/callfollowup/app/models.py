from dataclasses import dataclass
from typing import Optional


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