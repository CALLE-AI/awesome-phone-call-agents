"""The minimal disclosure payload: what a call may say about this case.

The task text handed to CALL-E is built from this payload and from nothing
else. Building it here, behind an allowlist, is what makes the disclosure
boundary structural rather than a promise: the task builder has no route to
a field that is not on the allowlist.

Deliberately not disclosed: the claim's face value, the economic policy and
its thresholds, the authorization record reference, the operator's name and
the full ordinary-remedy log. The desk identifies the claim by its own
reference and the account context; it does not need the call priced.
"""

from __future__ import annotations

import re
from enum import Enum

from .envelope import SourceClaim
from .identifiers import fold_text

#: Every field a call task may carry. A disclosure payload containing any
#: other key is a defect, whatever produced it.
DISCLOSURE_ALLOWLIST = frozenset(
    {
        "caller_organization",
        "source_platform",
        "source_claim_id",
        "account_context",
        "exception_status",
        "documented_code",
    }
)


class TaskTextRefusal(str, Enum):
    """Why the composed task text may not be handed to a provider."""

    #: The task asks the call to do something only a human principal may do:
    #: adjudicate, approve, resubmit, negotiate, settle, retry or promise.
    #: These words in an *instruction* are prohibited; negated in a boundary
    #: ("do not negotiate") they are exactly what this gate wants said.
    PROHIBITED_TASK_TEXT = "PROHIBITED_TASK_TEXT"


#: Verbs that would turn an inquiry call into an action call. Word-boundary
#: matched on folded text, so "settlement" does not trip "settle" but
#: "settle this now" does.
PROHIBITED_TASK_VERBS = (
    "adjudicate",
    "approve",
    "resubmit",
    "negotiate",
    "settle",
    "retry",
    "promise",
)

#: A prohibited verb inside a sentence that negates it is a boundary, not an
#: instruction. The negators are matched as folded substrings of the same
#: sentence as the verb, which is the narrowest deterministic scope that
#: still lets the shipped boundary sentences ("do not negotiate", "never
#: promise") survive their own gate.
_NEGATORS = (
    "do not",
    "don t",
    "dont",
    "never",
    "must not",
    "mustn t",
    "cannot",
    "can t",
    "cant",
    "no ",
    "not to",
    "refuse to",
    "without",
)

_SENTENCE_SPLIT = re.compile(r"[.!?;\n]+")
_VERB_RE = {verb: re.compile(rf"\b{verb}\b") for verb in PROHIBITED_TASK_VERBS}


def prohibited_task_text_violations(task: str) -> tuple[str, ...]:
    """Every sentence that instructs a prohibited action, named by its verb.

    Deterministic and fail-closed: a sentence containing a prohibited verb
    passes only when the same sentence negates it. Anything ambiguous — a
    verb in a sentence with no negator — is a violation, whatever the intent
    read into it. The check runs on the composed task right before the
    reservation, so no field that reached the task builder (allowlisted or
    injected through a field's own text) can instruct the call to act.
    """

    violations: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(task or ""):
        folded = fold_text(sentence)
        if not folded:
            continue
        for verb in PROHIBITED_TASK_VERBS:
            if _VERB_RE[verb].search(folded) and not any(
                negator in folded for negator in _NEGATORS
            ):
                violations.append(verb)
    return tuple(dict.fromkeys(violations))


def build_disclosure(claim: SourceClaim) -> dict[str, str]:
    """Return only the allowlisted fields, as strings.

    ``documented_code`` is included only when the source record actually shows
    it, so the call cannot assert a code the portal never displayed.
    """

    disclosure: dict[str, str] = {
        "caller_organization": claim.caller_organization,
        "source_platform": claim.source_platform,
        "source_claim_id": claim.source_claim_id,
        "account_context": claim.account_context,
        "exception_status": claim.exception_status.value,
    }
    if (claim.documented_code or "").strip():
        disclosure["documented_code"] = (claim.documented_code or "").strip()
    return disclosure


def disclosure_violations(disclosure: dict[str, str]) -> tuple[str, ...]:
    """Every key a disclosure payload carries that it may not."""

    return tuple(
        sorted(key for key in disclosure if key not in DISCLOSURE_ALLOWLIST)
    )
