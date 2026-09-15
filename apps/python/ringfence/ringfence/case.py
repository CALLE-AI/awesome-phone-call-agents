"""The Case model: what an institution's fraud system submits to ringfence.

A case carries two categories of phone number that must never be confused:

- ``on_file_phone`` — sourced independently by the institution, *before* the
  flagged request existed (the number on the account, from onboarding/KYC).
  This is the only number ringfence is ever allowed to dial. See
  ``verify_call.resolve_dial_target`` for the invariant this enables.
- ``request_supplied_callback_number`` — a callback number that arrived as
  part of the flagged transaction request itself (e.g. "call me back at
  this number to confirm"). This is exactly what a scammer controls and
  would smuggle in to redirect the verification call to themselves. It is
  carried on the case only so it can be logged as a security event — it is
  never dialed, regardless of whether it matches ``on_file_phone``.

``region``/``locale`` are optional and, if unset, default to
``verify_call.DEFAULT_REGION``/``DEFAULT_LOCALE`` (``"US"``/``"en-US"``).
Found missing entirely during pre-submission validation against the live
API: dialing a documented-supported international number (per
``call-e-integrations``'s own Supported Regions table) without an explicit
``region`` failed at the provider layer with zero ring time. Every other
app in this repo that places international calls sets ``region``/``locale``
explicitly per case — RingFence never did.

``institution_name`` is optional and, if unset, defaults to
``verify_call.DEFAULT_INSTITUTION_NAME``. Found missing during
pre-submission validation against the live API: CALL-E's own content-policy
layer rejected a call whose task described the caller only as "their
financial institution" — generic, no named entity — asking "which financial
institution should the call identify as the requester? This is needed so
the recipient is not misled by a vague or hidden identity." A vague-identity
caller is itself a red flag this project's own detection logic screens
for, so naming a concrete (fictional, per this repo's demo-data convention)
institution is a genuine, not cosmetic, fix.
"""

from __future__ import annotations

from dataclasses import dataclass

from .safety import normalize_e164


@dataclass(frozen=True)
class Case:
    case_id: str
    account_holder_name: str
    on_file_phone: str
    claimed_transaction_amount: str
    claimed_recipient: str
    claimed_payment_method: str
    request_supplied_callback_number: str | None = None
    region: str | None = None
    locale: str | None = None
    institution_name: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Case":
        known = {f.name for f in cls.__dataclass_fields__.values()}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"case payload has unknown field(s): {sorted(unknown)}")
        optional = {"request_supplied_callback_number", "region", "locale", "institution_name"}
        missing = known - optional - set(data)
        if missing:
            raise ValueError(f"case payload is missing required field(s): {sorted(missing)}")

        # Normalize (and validate) both phone-shaped fields here, at the one
        # place every entry point (CLI/webhook/MCP) constructs a Case from
        # untrusted input — a malformed number fails as a clean ValueError
        # instead of an uncaught crash deep inside resolve_dial_target().
        data = dict(data)
        data["on_file_phone"] = normalize_e164(data["on_file_phone"])
        if data.get("request_supplied_callback_number"):
            data["request_supplied_callback_number"] = normalize_e164(
                data["request_supplied_callback_number"]
            )
        return cls(**data)
