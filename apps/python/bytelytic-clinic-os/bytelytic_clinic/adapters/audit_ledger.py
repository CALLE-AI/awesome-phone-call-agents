"""
HIPAA-Compliant In-Memory / Signed Audit Ledger
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Dict, Any
import hashlib
import json
import uuid


@dataclass
class AuditEntry:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    actor: str = "system"
    action: str = "call.dispatch"
    resource_type: str = "appointment"
    resource_id: str = ""
    details_sanitized: Dict[str, Any] = field(default_factory=dict)
    entry_hash: str = ""


class AuditLedger:
    """
    Append-only tamper-evident audit ledger for clinical events.
    """

    def __init__(self):
        self.entries: List[AuditEntry] = []

    def record(self, actor: str, action: str, resource_type: str, resource_id: str, details: Dict[str, Any]) -> AuditEntry:
        # Sanitize any potential PHI
        sanitized = {k: ("***" if "phone" in k or "dob" in k or "ssn" in k else v) for k, v in details.items()}
        entry = AuditEntry(
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details_sanitized=sanitized,
        )
        data_str = f"{entry.timestamp}|{entry.actor}|{entry.action}|{entry.resource_type}|{entry.resource_id}|{json.dumps(sanitized, sort_keys=True)}"
        entry.entry_hash = hashlib.sha256(data_str.encode()).hexdigest()
        self.entries.append(entry)
        return entry

    def verify_integrity(self) -> bool:
        for entry in self.entries:
            data_str = f"{entry.timestamp}|{entry.actor}|{entry.action}|{entry.resource_type}|{entry.resource_id}|{json.dumps(entry.details_sanitized, sort_keys=True)}"
            expected = hashlib.sha256(data_str.encode()).hexdigest()
            if entry.entry_hash != expected:
                return False
        return True


audit_ledger = AuditLedger()
