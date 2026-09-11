"""Detect two answers to the same question, and record both.

Two things produce a dispute: what an agent said on this call contradicting the
institution's own recorded policy, and what an agent said on this call
contradicting what a different agent at the same institution said on an earlier
one. The design note calls the second one out by name because it is common and
because nobody records it.

Nothing here picks a winner. A conflict carries the stated answer, the
counter-answer, and where each came from, and `capture.py` turns that into
DISPUTED. Choosing silently is how a family posts an original death certificate
that then goes missing.

A field is compared only when both sides have an answer. An unanswered question
is a gap, which is PARTIAL, and is a different problem from a contradiction.
"""

from __future__ import annotations

import unicodedata

from .models import (
    Conflict,
    DirectDebits,
    Institution,
    PriorCall,
    Requirement,
    Ternary,
)


def normalise(text: str) -> str:
    """Fold case, accents and punctuation, so "Bereavement Team" and
    "bereavement team." are not reported to a grieving family as a dispute."""
    decomposed = unicodedata.normalize("NFKD", text.strip().lower())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return "".join(c for c in stripped if c.isalnum())


def document_set(documents: tuple[str, ...]) -> frozenset[str]:
    return frozenset(normalise(d) for d in documents if normalise(d))


def _describe_documents(documents: tuple[str, ...]) -> str:
    return "; ".join(documents)


def compare(
    stated: Requirement,
    counter: Requirement,
    counter_source: str,
    quote: str = "",
) -> tuple[Conflict, ...]:
    """Compare one stated requirement against one other answer.

    The same function serves the policy and the prior-call case, so a dispute
    cannot be detected in one direction and missed in the other.
    """
    found: list[Conflict] = []

    if normalise(stated.department) and normalise(counter.department):
        if normalise(stated.department) != normalise(counter.department):
            found.append(
                Conflict(
                    field_name="department",
                    stated=stated.department,
                    stated_source="this_call",
                    counter=counter.department,
                    counter_source=counter_source,
                    quote=quote,
                )
            )

    stated_docs = document_set(stated.documents_needed)
    counter_docs = document_set(counter.documents_needed)
    if stated_docs and counter_docs and stated_docs != counter_docs:
        found.append(
            Conflict(
                field_name="documents_needed",
                stated=_describe_documents(stated.documents_needed),
                stated_source="this_call",
                counter=_describe_documents(counter.documents_needed),
                counter_source=counter_source,
                quote=quote,
            )
        )

    if (
        stated.certified_copy_accepted is not Ternary.UNKNOWN
        and counter.certified_copy_accepted is not Ternary.UNKNOWN
        and stated.certified_copy_accepted is not counter.certified_copy_accepted
    ):
        found.append(
            Conflict(
                field_name="certified_copy_accepted",
                stated=stated.certified_copy_accepted.value,
                stated_source="this_call",
                counter=counter.certified_copy_accepted.value,
                counter_source=counter_source,
                quote=quote,
            )
        )

    if (
        stated.direct_debits_action is not DirectDebits.UNKNOWN
        and counter.direct_debits_action is not DirectDebits.UNKNOWN
        and stated.direct_debits_action is not counter.direct_debits_action
    ):
        found.append(
            Conflict(
                field_name="direct_debits_action",
                stated=stated.direct_debits_action.value,
                stated_source="this_call",
                counter=counter.direct_debits_action.value,
                counter_source=counter_source,
                quote=quote,
            )
        )

    return tuple(found)


def against_policy(
    stated: Requirement, institution: Institution, quote: str = ""
) -> tuple[Conflict, ...]:
    """Compare with what the institution itself publishes.

    The policy is not treated as the truth. It is the other side of the
    argument, and `source` is what makes the argument answerable later.
    """
    policy = institution.recorded_policy
    if policy is None:
        return ()
    return compare(
        stated,
        policy.as_requirement(),
        counter_source=f"recorded_policy:{policy.source}",
        quote=quote,
    )


def against_prior_calls(
    stated: Requirement, priors: tuple[PriorCall, ...], quote: str = ""
) -> tuple[Conflict, ...]:
    """Compare with every earlier call to the same institution.

    Every prior call is compared, not just the most recent, because the useful
    fact is that the institution has answered inconsistently at all.
    """
    found: list[Conflict] = []
    for prior in priors:
        found.extend(
            compare(
                stated,
                prior.requirement,
                counter_source=f"prior_call:{prior.call_id}:{prior.captured_on.isoformat()}",
                quote=quote,
            )
        )
    return tuple(found)


def detect(
    stated: Requirement,
    institution: Institution,
    priors: tuple[PriorCall, ...] = (),
    quote: str = "",
) -> tuple[Conflict, ...]:
    """Every dispute this call raises, policy first, then prior calls."""
    return against_policy(stated, institution, quote) + against_prior_calls(
        stated, priors, quote
    )
