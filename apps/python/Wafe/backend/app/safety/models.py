from enum import Enum

from pydantic import BaseModel


class SafetyStatus(str, Enum):
    SAFE = "safe"
    CONCERN = "concern"
    DANGER = "danger"
    UNKNOWN = "unknown"


class SafetyDecision(BaseModel):
    status: SafetyStatus
    reason: str
    distress_detected: bool = False
    user_confirmed_danger: bool = False