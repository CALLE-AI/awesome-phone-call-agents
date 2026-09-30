"""Places the independent verification call for a flagged case.

## The one security invariant everything else depends on

``resolve_dial_target`` returns ``case.on_file_phone`` — always, unconditionally.
``case.request_supplied_callback_number`` is never read for dialing purposes;
it exists on the Case model only so an attempt to smuggle one in can be
logged as a security event. This is proven by
``tests/test_invariant_never_calls_request_supplied_number.py`` — the load-
bearing test this whole product's trustworthiness rests on.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .case import Case
from .safety import InvalidPhoneNumber, mask_phone, normalize_e164

PREVIEWED = "previewed"
DIALED = "dialed"
ERROR = "error"

# Matches call-e-integrations's own "Supported Regions and Languages" table
# convention (region/locale on the recipient). Left unset on a Case, a real
# international number silently fails at the carrier/provider layer instead
# of a clean rejection: during pre-submission validation, calls to a
# documented-supported international number failed instantly (zero ring
# time, differing provider error codes) because region/locale were never
# sent at all.
DEFAULT_REGION = "US"
DEFAULT_LOCALE = "en-US"

# Fictional, per this repo's own "fictional-only demo data" convention (see
# README's Safety section) -- named explicitly rather than left generic
# ("their financial institution") because CALL-E's own content-policy layer
# rejects a task that doesn't name a concrete requesting entity, citing
# exactly the vague/hidden-identity risk this project's own detection logic
# screens callers for. Surfaced only by exercising the live API, not by
# review.
DEFAULT_INSTITUTION_NAME = "Fictional National Bank"

# Disclosure-first, open-question script. Never asks "is this really you" —
# a coached or panicked victim mid-scam will answer "yes" to that. Instead
# asks about documented scam red flags without leading the account holder
# toward a "safe" answer. See references/scam-red-flags.md for why each
# question exists and what it's cited from.
QUESTIONS = (
    "Did anyone ask you to keep this transaction private, or not to tell "
    "your bank or family?",
    "Is there time pressure — were you told this has to happen today or "
    "right now?",
    "Can you describe your relationship to the recipient, in your own "
    "words?",
    "Were you asked to pay by wire, gift card, or cryptocurrency "
    "specifically?",
)

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "secrecy_demand_present": {"type": "boolean"},
        "urgency_pressure_present": {"type": "boolean"},
        "relationship_explained": {"type": "boolean"},
        "irreversible_payment_demanded": {"type": "boolean"},
        "explicit_hold_requested": {"type": "boolean"},
    },
    "required": [
        "secrecy_demand_present",
        "urgency_pressure_present",
        "relationship_explained",
        "irreversible_payment_demanded",
        "explicit_hold_requested",
    ],
}


@dataclass
class VerificationCallOutcome:
    case_id: str
    dialed_phone_masked: str
    status: str
    call_id: str | None = None
    detail: str = ""


@dataclass
class SecurityEventLog:
    path: Path
    events: list[dict] = field(default_factory=list, repr=False)

    def record(self, event: dict) -> None:
        self.events.append(event)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")


def resolve_dial_target(case: Case, security_log: SecurityEventLog | None = None) -> str:
    """Return the only phone number ringfence may dial for this case.

    Always ``case.on_file_phone``. ``request_supplied_callback_number`` is
    read here for exactly one purpose — logging that it was present and
    ignored — never to influence which number gets dialed, even if it is
    identical to the on-file number.
    """
    on_file = normalize_e164(case.on_file_phone)
    if case.request_supplied_callback_number and security_log is not None:
        try:
            smuggled_masked = mask_phone(normalize_e164(case.request_supplied_callback_number))
        except InvalidPhoneNumber:
            smuggled_masked = "[unparseable]"
        security_log.record(
            {
                "event": "rejected_request_supplied_callback_number",
                "case_id": case.case_id,
                "on_file_phone_masked": mask_phone(on_file),
                "request_supplied_phone_masked": smuggled_masked,
            }
        )
    return on_file


def render_task(case: Case) -> str:
    institution = case.institution_name or DEFAULT_INSTITUTION_NAME
    numbered = " ".join(f"({i + 1}) {q}" for i, q in enumerate(QUESTIONS))
    return (
        f"You are calling {case.account_holder_name} on behalf of "
        f"{institution} to independently verify a transaction their own "
        "fraud system has flagged as unusual. Disclose immediately, "
        f"before anything else, that this is an automated verification call "
        f"from {institution} — not the transaction counterparty, and you "
        "will never ask for a password, one-time code, or account "
        "credential. Ask the following questions in order, without leading "
        "the account holder or revealing which answer is 'safe': "
        f"{numbered} If the account holder says to stop or hold at any "
        "point, acknowledge immediately and end the call without asking "
        "any further questions."
    )


def place_verification_call(
    case: Case,
    *,
    live: bool,
    security_log: SecurityEventLog | None = None,
    client_factory: Callable[[], object] | None = None,
) -> VerificationCallOutcome:
    """Place (or preview) the single verification call for this case.

    Dry-run by default. One attempt per case — callers do not loop this;
    a blocked/declined case requires the institution to resubmit a new
    case deliberately, never an automatic re-dial.
    """
    dial_target = resolve_dial_target(case, security_log)
    masked = mask_phone(dial_target)
    task_text = render_task(case)

    if not live:
        return VerificationCallOutcome(
            case.case_id,
            masked,
            PREVIEWED,
            detail=f"goal rendered ({len(task_text)} chars); DRY RUN, no call placed",
        )

    if client_factory is None:
        raise ValueError("client_factory is required for a live call")
    client = client_factory()
    region = case.region or DEFAULT_REGION
    locale = case.locale or DEFAULT_LOCALE
    try:
        call = client.calls.create_and_wait(
            task=task_text,
            recipients=[{"phones": [dial_target], "region": region, "locale": locale}],
            result_schema=RESULT_SCHEMA,
            idempotency_key=f"ringfence:{case.case_id}",
        )
        call_id = call.get("id") if isinstance(call, dict) else getattr(call, "id", None)
        return VerificationCallOutcome(case.case_id, masked, DIALED, call_id=call_id)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a case-level error
        return VerificationCallOutcome(case.case_id, masked, ERROR, detail=str(exc))
