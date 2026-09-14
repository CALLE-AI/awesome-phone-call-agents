"""The refusal catalog: every named refusal, its meaning and its next action.

``docs/refusals.md`` is generated from this module
(``python -m warrantyops --generate-docs``). The entries are data, stated
once; the renderer walks the live enums so the generated file cannot lag the
code — a member with no entry here breaks ``--generate-docs`` and the test
suite, and an entry whose key is not a member breaks them too.

The last column answers one operational question: *does making this right
require a new source version before a new attempt may even be considered?*
``yes`` means the idempotency key is bound to a version that is now spent,
moved or superseded — a human reconciles, the source moves, a new key is
derived. ``no`` means nothing was attempted or reserved; the operational
cause is fixed and the same version may be re-run.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .authorization import AuthorizationRefusal
from .config import ConfigRefusal
from .disclosure import TaskTextRefusal
from .envelope import EnvelopeRefusal
from .gates import EconomicRefusal, ResidualRefusal, VersionRefusal
from .identifiers import IdentifierRefusal
from .ledger import LedgerRefusal
from .review import ReviewRefusal
from .workflow import RefusalGate
from .writeback import WriteBackRefusal


@dataclass(frozen=True)
class RefusalEntry:
    meaning: str
    next_action: str
    needs_new_source_version: str  # "yes" | "no"


ENTRIES: dict[str, dict[str, RefusalEntry]] = {
    "EnvelopeRefusal": {
        "MISSING_SOURCE_PLATFORM": RefusalEntry(
            "The claim names no source platform, so no version reader and no adapter can be bound.",
            "Fix the claim extraction; the envelope is not a basis for any step.",
            "no",
        ),
        "MISSING_SOURCE_CLAIM_ID": RefusalEntry(
            "No claim identifier to anchor the idempotency key or the write-back to.",
            "Fix the claim extraction.",
            "no",
        ),
        "MISSING_SOURCE_VERSION": RefusalEntry(
            "Without a version the pre-call re-read and the write-back guard cannot work.",
            "Fix the claim extraction.",
            "no",
        ),
        "MISSING_EXCEPTION_STATUS": RefusalEntry(
            "The residual-necessity gate has no status to test against the exhaustion manifest.",
            "Fix the claim extraction.",
            "no",
        ),
        "MISSING_SUBMITTED_AT": RefusalEntry(
            "Claim age cannot be computed, so the economics gate cannot run.",
            "Fix the claim extraction.",
            "no",
        ),
        "SUBMITTED_IN_THE_FUTURE": RefusalEntry(
            "A claim dated after the run date is malformed or the clock is wrong.",
            "Fix the extraction or the clock; never proceed on a future-dated claim.",
            "no",
        ),
        "MISSING_ORGANIZATION": RefusalEntry(
            "The disclosure task cannot name the caller organization.",
            "Fix the claim extraction.",
            "no",
        ),
        "MISSING_ACCOUNT_CONTEXT": RefusalEntry(
            "The counterparty cannot be told which account the call concerns.",
            "Fix the claim extraction.",
            "no",
        ),
        "INVALID_PHONE": RefusalEntry(
            "The counterparty number is not a valid E.164 address.",
            "Fix the number in the source system.",
            "no",
        ),
        "MISSING_POLICY_ID": RefusalEntry(
            "No economic policy can be looked up for the claim.",
            "Fix the claim extraction or add the policy.",
            "no",
        ),
        "VALUE_WITHOUT_CURRENCY": RefusalEntry(
            "A claim value with no currency cannot be compared against the minimum.",
            "Fix the claim extraction.",
            "no",
        ),
        "CURRENCY_WITHOUT_VALUE": RefusalEntry(
            "A currency with no value cannot be compared against the minimum.",
            "Fix the claim extraction.",
            "no",
        ),
        "INVALID_CLAIM_VALUE": RefusalEntry(
            "The claim value is not a usable amount.",
            "Fix the claim extraction.",
            "no",
        ),
        "REMEDY_MISSING_CHANNEL": RefusalEntry(
"A claimed remedy names no channel, so the exhaustion manifest "
            "cannot be checked against it.",
            "Fix the remedies on the claim.",
            "no",
        ),
        "REMEDY_MISSING_OUTCOME": RefusalEntry(
"A claimed remedy records no outcome, so the exhaustion manifest "
            "cannot be checked against it.",
            "Fix the remedies on the claim.",
            "no",
        ),
        "MISSING_EXHAUSTION_MANIFEST": RefusalEntry(
"No structured record that the ordinary routes were attempted. "
            "Without it the call is not proven residual.",
            "The claim adapter layer supplies the manifest for this source version.",
            "no",
        ),
        "EXHAUSTION_MANIFEST_INCOMPLETE": RefusalEntry(
"The manifest is not a complete record for this source version: no routes, "
            "a route with no outcome, no stated information gap, or bound to a "
            "different version.",
            "The claim adapter layer repairs the manifest for this exact source version.",
            "no",
        ),
    },
    "ResidualRefusal": {
        "ORDINARY_ROUTE_NOT_EXHAUSTED": RefusalEntry(
"An ordinary route exists that has not been tried to completion. "
            "The phone is not first.",
            "Exhaust the listed ordinary routes in the manifest before reconsidering a call.",
            "no",
        ),
        "SOURCE_ALREADY_ANSWERS": RefusalEntry(
            "The source record already contains the answer the call would ask for.",
            "Read the answer from the source; no call is residual.",
            "no",
        ),
    },
    "VersionRefusal": {
        "SOURCE_CHANGED": RefusalEntry(
            "The authoritative source version no longer matches the envelope's version.",
            "Re-extract the claim at its new version; every downstream identity is version-bound.",
            "yes",
        ),
        "SOURCE_RECHECK_UNAVAILABLE": RefusalEntry(
"No version reader was supplied, so the live version could not be "
            "re-read before dialing.",
            "Supply a reader; a stale envelope is never dialed as if current.",
            "no",
        ),
    },
    "EconomicRefusal": {
        "POLICY_NOT_FOUND": RefusalEntry(
            "No economic policy exists for the claim's policy id.",
            "Add the policy or fix the policy id.",
            "no",
        ),
        "CURRENCY_MISMATCH": RefusalEntry(
            "The claim currency differs from the policy's currency.",
            "Fix the policy book or the claim extraction.",
            "no",
        ),
        "CLAIM_VALUE_UNKNOWN": RefusalEntry(
            "The claim value is unknown, so worth-vs-cost cannot be computed.",
            "Establish the value in the source system, or set a policy for unknown values.",
            "no",
        ),
        "BELOW_MINIMUM_VALUE": RefusalEntry(
            "The claim value is below the policy's minimum for a call.",
            "Handle through ordinary routes; the call does not clear the organization's economics.",
            "no",
        ),
        "CLAIM_TOO_OLD": RefusalEntry(
            "The claim is older than the policy's maximum age for a call.",
            "Handle through ordinary routes.",
            "no",
        ),
        "CALL_COST_UNKNOWN": RefusalEntry(
            "The cost of the call is unknown, so worth-vs-cost cannot be computed.",
            "Set the call cost in the policy book; an unknown cost is never treated as free.",
            "no",
        ),
        "NOT_WORTH_PURSUING": RefusalEntry(
"The expected recovery does not clear the cost of the call under the "
            "policy's arithmetic.",
            "Handle through ordinary routes.",
            "no",
        ),
    },
    "AuthorizationRefusal": {
        "INVALID_E164": RefusalEntry(
            "The authorized recipient is not a valid E.164 number.",
            "Fix the authorization record.",
            "no",
        ),
        "MISSING_PURPOSE": RefusalEntry(
            "The authorization record names no purpose.",
            "Fix the authorization record.",
            "no",
        ),
        "PURPOSE_MISMATCH": RefusalEntry(
            "The record's purpose does not match the purpose of this run.",
            "Use an authorization whose purpose matches, or fix the record.",
            "no",
        ),
        "EXPIRED": RefusalEntry(
            "The authorization record has expired.",
            "Obtain a current authorization.",
            "no",
        ),
        "NOT_YET_VALID": RefusalEntry(
            "The authorization record is not valid yet.",
            "Wait for its validity window, or fix the record.",
            "no",
        ),
        "MISSING_RECORD_REFERENCE": RefusalEntry(
            "The decision carries no reference to the authorization record it was made from.",
            "Fix the authorization record.",
            "no",
        ),
        "RECIPIENT_NOT_ALLOWLISTED": RefusalEntry(
            "The recipient is not on the configured allowlist for live calling.",
"Add the recipient to the allowlist through the governed process, or use "
            "the fake provider.",
            "no",
        ),
        "AUTHORIZED_RECIPIENT_MISMATCH": RefusalEntry(
"The authorization names a number other than this claim's counterparty. "
            "An authorization is for one destination.",
            "Use the authorization that belongs to this claim's counterparty.",
            "no",
        ),
    },
    "TaskTextRefusal": {
        "PROHIBITED_TASK_TEXT": RefusalEntry(
"The composed task text instructs a prohibited action: adjudicate, approve, "
            "resubmit, negotiate, settle, retry or promise.",
            "Fix the disclosure payload that produced the text; an inquiry call may ask, not act.",
            "no",
        ),
    },
    "LedgerRefusal": {
        "ATTEMPT_LEDGER_UNAVAILABLE": RefusalEntry(
"No attempt ledger was supplied, or the ledger could not be opened or "
            "written. Without a reservation no call may be placed.",
            "Restore the ledger (path, permissions, schema) and re-run; nothing was dialed.",
            "no",
        ),
        "DUPLICATE_CALL_SUPPRESSED": RefusalEntry(
"This claim version was already attempted; the reservation exists in "
            "whatever state it ended in.",
"Human reconciliation of the earlier attempt; a new attempt needs a new "
            "source version and therefore a new key.",
            "yes",
        ),
        "IDEMPOTENCY_CONFLICT": RefusalEntry(
            "The key was already reserved for a different request body.",
            "Investigate the collision; never silently replay a key onto a different request.",
            "yes",
        ),
        "LEDGER_NOT_DURABLE": RefusalEntry(
            "A live-capable provider was paired with a non-durable (in-memory) ledger.",
            "Use a durable SQLite ledger for any live-capable provider.",
            "no",
        ),
        "LEDGER_PATH_MISSING": RefusalEntry(
            "No ledger database path was configured.",
            "Configure the ledger path outside the repository.",
            "no",
        ),
        "LEDGER_PATH_INSIDE_REPOSITORY": RefusalEntry(
            "The ledger path resolves inside the repository; call data must never enter git.",
            "Move the ledger outside the repository.",
            "no",
        ),
    },
    "IdentifierRefusal": {
        "NO_VALUE": RefusalEntry(
            "The counterparty stated no claim, case or credit reference at all.",
            "The field stays absent; the receipt records the absence.",
            "no",
        ),
        "NO_READBACK": RefusalEntry(
            "A reference was stated but never read back digit by digit.",
            "Treat the reference as unconfirmed; only a completed read-back exchange confirms it.",
            "no",
        ),
        "NO_CONFIRMATION_VALUE": RefusalEntry(
            "The read-back was attempted but no value to confirm could be isolated.",
            "Treat the reference as unconfirmed.",
            "no",
        ),
        "QUOTE_MISSING": RefusalEntry(
            "No confirmation quote exists in the transcript.",
            "Treat the reference as unconfirmed.",
            "no",
        ),
        "QUOTE_TOO_SHORT": RefusalEntry(
            "The candidate confirmation is not a whole answer (a bare digit fragment or filler).",
            "Treat the reference as unconfirmed; fragments never confirm.",
            "no",
        ),
        "QUOTE_NOT_AFFIRMATIVE": RefusalEntry(
            "The reply to the read-back is not an affirmation.",
            "Treat the reference as unconfirmed.",
            "no",
        ),
        "QUOTE_NEGATED": RefusalEntry(
            "The reply to the read-back denies the value just read.",
            "Treat the reference as unconfirmed; a denial is not a correction either.",
            "no",
        ),
        "QUOTE_HEDGED": RefusalEntry(
            "The reply to the read-back hedges or defers to a record the speaker cannot see.",
            "Treat the reference as unconfirmed.",
            "no",
        ),
        "TRANSCRIPT_UNAVAILABLE": RefusalEntry(
            "No transcript exists to ground the exchange in.",
            "The reference cannot be confirmed from this attempt.",
            "no",
        ),
        "QUOTE_NOT_IN_COUNTERPARTY_TURN": RefusalEntry(
            "The confirmation does not come from the counterparty's own turn.",
            "Treat the reference as unconfirmed; the agent confirming itself confirms nothing.",
            "no",
        ),
        "IDENTIFIER_NOT_IN_EXCHANGE": RefusalEntry(
"The confirmation does not belong to the exchange that carried the "
            "read-back of this value.",
            "Treat the reference as unconfirmed.",
            "no",
        ),
        "AMBIGUOUS_EXCHANGE": RefusalEntry(
            "More than one exchange could be the confirming one.",
"Treat the reference as unconfirmed; ambiguity never resolves in favor "
            "of confirmation.",
            "no",
        ),
        "PATTERN_MISMATCH": RefusalEntry(
            "The read-back value does not match the expected reference pattern.",
            "Treat the reference as unconfirmed.",
            "no",
        ),
        "REFERENCE_EVIDENCE_UNGROUNDED": RefusalEntry(
            "The claimed reference is not grounded in an exact transcript span.",
"Treat the reference as unconfirmed; only an exact span or a completed "
            "exchange grounds a field.",
            "no",
        ),
    },
    "ConfigRefusal": {
        "LIVE_NOT_ENABLED": RefusalEntry(
            "The live-call kill switch (CALLE_LIVE_CALLS_ENABLED) is not set.",
"Set the environment variable if — and only if — a live call is intended "
            "and authorized.",
            "no",
        ),
        "MISSING_API_KEY": RefusalEntry(
            "No CALLE_API_KEY in the environment for a live-capable provider.",
            "Provide the key through the environment; never on a command line or in a file in git.",
            "no",
        ),
        "UNOFFICIAL_ORIGIN": RefusalEntry(
            "The configured API origin is not the official CALL-E origin.",
            "Fix the origin configuration.",
            "no",
        ),
        "ARTIFACT_DIR_MISSING": RefusalEntry(
            "No private artifact directory is configured for raw call artifacts.",
            "Configure the directory outside the repository.",
            "no",
        ),
        "ARTIFACT_DIR_INSIDE_REPOSITORY": RefusalEntry(
            "The private artifact directory resolves inside the repository.",
            "Move it outside the repository; raw artifacts never enter git.",
            "no",
        ),
    },
    "ReviewRefusal": {
        "NOT_APPROVED": RefusalEntry(
            "The human decision was REFUSE or RETURN_TO_DIGITAL, which never authorize a write.",
            "Record the safe non-write; no mutation happens.",
            "no",
        ),
        "MISSING_REVIEWER": RefusalEntry(
            "The decision names no reviewer.",
            "Re-record the decision with a reviewer.",
            "no",
        ),
        "NOT_TIMEZONE_AWARE": RefusalEntry(
            "The decision timestamp carries no timezone.",
            "Re-record the decision with an aware timestamp.",
            "no",
        ),
        "NOT_BOUND_TO_PACKET": RefusalEntry(
            "The decision was recorded against a different review id than this packet's.",
            "Re-review this packet; a stale approval is not an approval.",
            "no",
        ),
        "OPERATOR_MISSING": RefusalEntry(
            "No host-derived operator identity was recorded with the decision.",
            "Re-record the decision with the operator principal.",
            "no",
        ),
        "PACKET_HASH_MISMATCH": RefusalEntry(
            "The decision was recorded against a different packet body than the one being written.",
            "Re-review the current packet.",
            "no",
        ),
    },
    "WriteBackRefusal": {
        "NO_BUSINESS_RESULT": RefusalEntry(
            "The outcome carries no write-back-eligible business result.",
            "Nothing to write; the receipt is the record.",
            "no",
        ),
        "NOT_REVIEWED": RefusalEntry(
            "No approved, bound human decision exists for this outcome.",
            "Route the packet through review.",
            "no",
        ),
        "SOURCE_CHANGED": RefusalEntry(
"The source version moved between the call and the write. The write would "
            "land on a different record than the one asked about.",
            "Re-run against the new version from the envelope gate onward.",
            "yes",
        ),
        "REVIEW_CONFLICT": RefusalEntry(
"A note already exists under this write's identity, approved by a "
            "different review. Two approvals of one write is one too many.",
            "A human resolves which review governs the note; this code does not decide.",
            "no",
        ),
    },
}

#: Section order for the generated document: the gate order first, then the
#: post-call vocabularies. Each names the enum the section renders.
SECTIONS: tuple[tuple[str, str, str], ...] = (
    ("EnvelopeRefusal", "Envelope gate", str(RefusalGate.ENVELOPE.value)),
    ("ResidualRefusal", "Residual-necessity gate", str(RefusalGate.RESIDUAL_NECESSITY.value)),
    ("VersionRefusal", "Source-state gate", str(RefusalGate.SOURCE_STATE.value)),
    ("EconomicRefusal", "Economics gate", str(RefusalGate.ECONOMICS.value)),
    ("AuthorizationRefusal", "Authorization gate", str(RefusalGate.AUTHORIZATION.value)),
    ("TaskTextRefusal", "Disclosure gate", str(RefusalGate.DISCLOSURE.value)),
    ("LedgerRefusal", "Attempt-ledger gate", str(RefusalGate.ATTEMPT_LEDGER.value)),
    ("IdentifierRefusal", "Identifier grounding (inside derivation, not a gate)", ""),
    ("ConfigRefusal", "Configuration (before any gate)", ""),
    ("ReviewRefusal", "Review binding", ""),
    ("WriteBackRefusal", "Write-back guard", ""),
)

#: The live enums the catalog documents, by section name. Typed against
#: ``type[Enum]`` so iteration yields members, not uninferrable joins of
#: eleven distinct enum metaclasses.
_ENUM_BY_NAME: dict[str, type[Enum]] = {
    "EnvelopeRefusal": EnvelopeRefusal,
    "ResidualRefusal": ResidualRefusal,
    "VersionRefusal": VersionRefusal,
    "EconomicRefusal": EconomicRefusal,
    "AuthorizationRefusal": AuthorizationRefusal,
    "TaskTextRefusal": TaskTextRefusal,
    "LedgerRefusal": LedgerRefusal,
    "IdentifierRefusal": IdentifierRefusal,
    "ConfigRefusal": ConfigRefusal,
    "ReviewRefusal": ReviewRefusal,
    "WriteBackRefusal": WriteBackRefusal,
}


def catalog_problems() -> list[str]:
    """Every way the catalog has drifted from the enums it documents."""

    problems: list[str] = []
    for name, enum in _ENUM_BY_NAME.items():
        documented = set(ENTRIES[name])
        actual = {member.value for member in enum}
        for value in sorted(actual - documented):
            problems.append(f"{name}.{value}: no catalog entry")
        for value in sorted(documented - actual):
            problems.append(f"{name}.{value}: entry names a non-member")
    for name in ENTRIES:
        if name not in _ENUM_BY_NAME:
            problems.append(f"{name}: catalog section has no enum")
    return problems


def render_refusals_markdown() -> str:
    """The canonical ``docs/refusals.md`` body, as a string."""

    problems = catalog_problems()
    if problems:
        raise ValueError("refusal catalog is out of sync: " + "; ".join(problems))

    lines = [
        "# Refusals",
        "",
        "Generated from ``warrantyops/refusals_catalog.py`` — regenerate with",
        "``make docs`` (``python -m warrantyops --generate-docs``). Do not",
        "edit by hand; the tests assert this file matches the catalog, and",
        "the catalog asserts it matches the enums.",
        "",
        "Every refusal is a named member of an enum, never free text. A",
        "refusal never reaches a later gate, and nothing later rescues an",
        "earlier refusal. The last column answers one operational question:",
        "does making this right require a **new source version** before a",
        "new attempt may even be considered? ``yes`` means the idempotency",
        "key is bound to a version that is now spent, moved or superseded.",
        "",
    ]
    for enum_name, title, gate in SECTIONS:
        heading = f"## {title}" + (f" (`{gate}`)" if gate else "")
        lines.append(heading)
        lines.append("")
        lines.append("| Refusal | Meaning | Next action | New source version needed? |")
        lines.append("|---|---|---|---|")
        enum = _ENUM_BY_NAME[enum_name]
        for member in enum:
            entry = ENTRIES[enum_name][member.value]
            lines.append(
                f"| `{member.value}` | {entry.meaning} | {entry.next_action} "
                f"| {entry.needs_new_source_version} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
