"""The patient vault: the only place identifiers live, and the only way out.

Trunkline's ledger stores ``patient_ref`` and nothing else about a patient. The
identifiers sit here, one file per reference, readable only by the owner. A call
plan cannot reach into this store directly; it asks ``resolve_envelope`` for a
workflow, and gets back only the fields that workflow's disclosure envelope
permits.

That is the minimum-necessary rule enforced as code. Widening what a claim-status
call may say about a patient requires editing ``policy.DISCLOSURE_ENVELOPES`` in
a reviewed change, not editing a prompt.
"""
from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import policy


class VaultError(RuntimeError):
    pass


@dataclass
class Disclosure:
    """What a single call is permitted to say about one patient.

    ``values`` is held in memory for the length of the call and never persisted.
    ``fields_disclosed`` is the audit-safe record: field names, no values.
    """

    patient_ref: str
    workflow: str
    values: Dict[str, str] = field(default_factory=dict)
    fields_disclosed: List[str] = field(default_factory=list)

    def all_secrets(self) -> List[str]:
        return [value for value in self.values.values() if value]


def vault_dir(data_dir: str) -> str:
    return os.path.join(data_dir, "vault")


def _record_path(data_dir: str, patient_ref: str) -> str:
    if not patient_ref or "/" in patient_ref or "\\" in patient_ref or patient_ref.startswith("."):
        raise VaultError("invalid patient_ref: %r" % patient_ref)
    return os.path.join(vault_dir(data_dir), "%s.json" % patient_ref)


def put(data_dir: str, patient_ref: str, values: Dict[str, str]) -> None:
    """Write a vault record with owner-only permissions."""
    unknown = sorted(set(values) - set(policy.VAULT_FIELDS))
    if unknown:
        raise VaultError("unknown vault fields: %s" % ", ".join(unknown))
    directory = vault_dir(data_dir)
    os.makedirs(directory, exist_ok=True)
    os.chmod(directory, stat.S_IRWXU)
    path = _record_path(data_dir, patient_ref)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump({key: str(value) for key, value in values.items()}, handle, indent=2, sort_keys=True)
        handle.write("\n")


def get(data_dir: str, patient_ref: str) -> Optional[Dict[str, str]]:
    path = _record_path(data_dir, patient_ref)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def exists(data_dir: str, patient_ref: str) -> bool:
    return os.path.exists(_record_path(data_dir, patient_ref))


def resolve_envelope(data_dir: str, patient_ref: str, workflow: str) -> Disclosure:
    """Return only the identifiers this workflow is allowed to speak aloud.

    Two independent checks run here. The envelope decides what a workflow may
    ask for; ``policy.NEVER_DISCLOSE`` overrides the envelope for fields that no
    payer call may carry, so a mistaken envelope entry still cannot leak.
    """
    envelope = policy.DISCLOSURE_ENVELOPES.get(workflow)
    if envelope is None:
        raise VaultError("workflow %r has no disclosure envelope" % workflow)

    record = get(data_dir, patient_ref)
    if record is None:
        raise VaultError("no vault record for %s" % patient_ref)

    permitted = [name for name in envelope if name not in policy.NEVER_DISCLOSE]
    values: Dict[str, str] = {}
    for name in permitted:
        value = str(record.get(name, "")).strip()
        if value:
            values[name] = value

    return Disclosure(
        patient_ref=patient_ref,
        workflow=workflow,
        values=values,
        fields_disclosed=sorted(values),
    )


def all_secrets_for(data_dir: str, patient_ref: str) -> List[str]:
    """Every identifier held for a patient, disclosed or not.

    The redactor uses this rather than only the disclosed fields: a
    representative may read back something the agent never said.
    """
    record = get(data_dir, patient_ref) or {}
    return [str(value) for value in record.values() if str(value).strip()]
