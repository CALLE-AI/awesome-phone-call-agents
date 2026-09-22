"""Written, expiring, budgeted permission to call one payer line.

A live call needs more than a command-line flag. The operator writes an
authorization record naming the exact destination, an expiry date, and a maximum
number of calls. A live run refuses if the record is missing, expired, spent, or
if the payer's number no longer matches the authorized destination character for
character.

This is what makes an unattended run safe to schedule: the schedule carries no
approval of its own, only a pointer to a record a person wrote and can delete.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Optional

from . import policy


class AuthorizationError(RuntimeError):
    pass


@dataclass
class Authorization:
    payer_id: str
    phone: str
    region: str
    until: str
    max_calls: int
    calls_used: int = 0
    note: str = ""
    created_at: str = ""

    def remaining(self) -> int:
        return max(0, self.max_calls - self.calls_used)


def authorizations_dir(data_dir: str) -> str:
    return os.path.join(data_dir, "authorizations")


def _path(data_dir: str, payer_id: str) -> str:
    if not payer_id or "/" in payer_id or "\\" in payer_id or payer_id.startswith("."):
        raise AuthorizationError("invalid payer id: %r" % payer_id)
    return os.path.join(authorizations_dir(data_dir), "%s.json" % payer_id)


def write(
    data_dir: str,
    *,
    payer_id: str,
    phone: str,
    region: str,
    until: str,
    max_calls: int,
    note: str = "",
) -> Authorization:
    from .models import now_iso

    policy.validate_destination(phone, region)
    try:
        expiry = datetime.strptime(until, "%Y-%m-%d").date()
    except ValueError:
        raise AuthorizationError("--until must be YYYY-MM-DD, got %r" % until) from None
    if expiry < date.today():
        raise AuthorizationError("--until is already in the past")
    if max_calls <= 0:
        raise AuthorizationError("--max-calls must be positive")

    record = Authorization(
        payer_id=payer_id,
        phone=phone,
        region=region,
        until=until,
        max_calls=max_calls,
        note=note,
        created_at=now_iso(),
    )
    directory = authorizations_dir(data_dir)
    os.makedirs(directory, exist_ok=True)
    with open(_path(data_dir, payer_id), "w", encoding="utf-8") as handle:
        json.dump(asdict(record), handle, indent=2, sort_keys=True)
        handle.write("\n")
    return record


def load(data_dir: str, payer_id: str) -> Optional[Authorization]:
    path = _path(data_dir, payer_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return Authorization(**payload)


def save(data_dir: str, record: Authorization) -> None:
    with open(_path(data_dir, record.payer_id), "w", encoding="utf-8") as handle:
        json.dump(asdict(record), handle, indent=2, sort_keys=True)
        handle.write("\n")


def revoke(data_dir: str, payer_id: str) -> bool:
    path = _path(data_dir, payer_id)
    if os.path.exists(path):
        os.remove(path)
        return True
    return False


def check(record: Optional[Authorization], *, phone: str, today: Optional[date] = None) -> Optional[str]:
    """Return a suppression reason, or None when the call is authorized."""
    if record is None:
        return "no_authorization"
    reference = today or date.today()
    try:
        expiry = datetime.strptime(record.until, "%Y-%m-%d").date()
    except ValueError:
        return "authorization_expired"
    if expiry < reference:
        return "authorization_expired"
    if record.remaining() <= 0:
        return "authorization_exhausted"
    if record.phone != phone:
        return "authorization_mismatch"
    return None
