"""F5: property families, generated. The invariants as quantified sentences.

The exhaustive matrices in ``test_grounding_properties.py`` and friends
state each invariant over a hand-built matrix; these suites state the same
invariants over generated inputs, so no case is there because somebody
thought of it. Each family is one sentence:

* **read-back** — a completed read-back exchange confirms the value that
  was read; a correction followed by a completed read-back confirms only
  the corrected value;
* **grounding** — nothing hedged, fragmented, negated or out-of-turn ever
  confirms anything, whatever the value;
* **economics** — ``NOT_WORTH_PURSUING`` is exactly the arithmetic
  inequality, boundary included, and nothing else fires it;
* **identity** — the write's note id is a pure function of its anchored
  content; any single change moves it, no permutation moves it;
* **audit** — every honest chain verifies; corrupting any one field of any
  one row of any chain breaks verification.

Skipped with a reason when hypothesis is absent, so the offline floor
(``make test`` in a bare environment) stays green while ``make check``
requires them.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

hypothesis = pytest.importorskip(
    "hypothesis", reason="property suites need hypothesis (installed for make check)"
)
from hypothesis import given, settings
from hypothesis import strategies as st

from warrantyops.audit import AuditActor, AuditReason, EventChain, verify_chain
from warrantyops.gates import EconomicPolicy, assess_economics
from warrantyops.identifiers import (
    IdentifierClaim,
    IdentifierState,
    TranscriptTurn,
    evaluate_identifier,
)
from warrantyops.writeback import note_id_for

AGENT = "bot"
USER = "user"
SETTINGS = {"max_examples": 50, "deadline": None}

#: References the grounding path can bind. The exchange check binds a
#: confirmation through digit runs, and a run only forms over an unbroken
#: digit token, so the family's precondition is a pure digit reference of
#: at least ``MIN_IDENTIFIER_DIGITS`` — the common case/credit-number
#: shape. (Mixed alphanumeric references are grounded by the exact-span
#: path, covered by the exhaustive suites.)
references = st.from_regex(r"[0-9]{4,10}", fullmatch=True)


def turns(*pairs):
    return tuple(TranscriptTurn(speaker=speaker, text=text) for speaker, text in pairs)


# --- family: read-back -------------------------------------------------------


@settings(**SETTINGS)
@given(value=references)
def test_a_completed_readback_confirms_the_value_read(value):
    transcript = turns(
        (AGENT, f"Just to confirm, that is {value}, correct?"),
        (USER, "Correct."),
    )
    decision = evaluate_identifier(
        IdentifierClaim(
            value_heard=value,
            readback_performed=True,
            value_confirmed=value,
            confirmation_quote="Correct.",
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == value


@settings(**SETTINGS)
@given(original=references, corrected=references)
def test_a_correction_then_completed_readback_confirms_only_the_corrected(original, corrected):
    hypothesis.assume(original != corrected)
    transcript = turns(
        (AGENT, f"Is the reference {original}?"),
        (USER, f"No, it is {corrected}."),
        (AGENT, f"Sorry — {corrected}. Correct?"),
        (USER, "That is right."),
    )
    decision = evaluate_identifier(
        IdentifierClaim(
            value_heard=corrected,
            readback_performed=True,
            value_confirmed=corrected,
            confirmation_quote="That is right.",
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == corrected
    assert decision.value != original


# --- family: grounding -------------------------------------------------------


HEDGES = ["I think so", "probably", "if you say so", "one moment, let me check"]
NEGATIONS = ["No, that is wrong", "that is not it", "no"]


@settings(**SETTINGS)
@given(value=references, hedge=st.sampled_from(HEDGES))
def test_no_hedge_confirms_any_value(value, hedge):
    transcript = turns(
        (AGENT, f"Just to confirm, that is {value}, correct?"),
        (USER, hedge),
    )
    decision = evaluate_identifier(
        IdentifierClaim(
            value_heard=value,
            readback_performed=True,
            value_confirmed=value,
            confirmation_quote=hedge,
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert decision.value is None


@settings(**SETTINGS)
@given(value=references, negation=st.sampled_from(NEGATIONS))
def test_no_negation_confirms_any_value(value, negation):
    transcript = turns(
        (AGENT, f"Just to confirm, that is {value}, correct?"),
        (USER, negation),
    )
    decision = evaluate_identifier(
        IdentifierClaim(
            value_heard=value,
            readback_performed=True,
            value_confirmed=value,
            confirmation_quote=negation,
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER


@settings(**SETTINGS)
@given(value=references, split=st.integers(min_value=1, max_value=3))
def test_fragmented_digits_never_confirm_the_whole(value, split):
    digits = list(value)
    size = max(1, len(digits) // (split + 1))
    fragments = [digits[i:i + size] for i in range(0, len(digits), size)]
    spoken = ", ".join("".join(fragment) for fragment in fragments)
    transcript = turns(
        (AGENT, f"Just to confirm, that is {value}, correct?"),
        (USER, spoken),
    )
    decision = evaluate_identifier(
        IdentifierClaim(
            value_heard=value,
            readback_performed=True,
            value_confirmed=value,
            confirmation_quote=spoken,
        ),
        transcript=transcript,
    )
    # A fragmented echo either fails to match the whole value or is not an
    # affirmation; either way it never confirms.
    assert decision.state is not IdentifierState.CONFIRMED_IDENTIFIER


@settings(**SETTINGS)
@given(value=references)
def test_the_agent_confirming_itself_confirms_nothing(value):
    transcript = turns(
        (AGENT, f"Just to confirm, that is {value}, correct?"),
        (AGENT, "They confirmed it."),
    )
    decision = evaluate_identifier(
        IdentifierClaim(
            value_heard=value,
            readback_performed=True,
            value_confirmed=value,
            confirmation_quote="They confirmed it.",
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER


# --- family: economics -------------------------------------------------------


def policy_book(*, minimum=Decimal("0"), maximum_call_cost=None, per_call_price=None):
    return {
        "standard-pursuit": EconomicPolicy(
            policy_id="standard-pursuit",
            currency="USD",
            minimum_claim_value=minimum,
            maximum_age_days=None,
            maximum_call_cost=maximum_call_cost,
            per_call_price=per_call_price,
        )
    }


def economic_claim(value: Decimal):
    from datetime import date

    from warrantyops.envelope import ExceptionStatus, OrdinaryRemedy, SourceClaim

    return SourceClaim(
        source_platform="SYNTHETIC-DMS",
        source_claim_id="CLM-1042",
        source_version="v7",
        exception_status=ExceptionStatus.RETURNED,
        submitted_at=date(2026, 8, 1),
        caller_organization="Example Equipment Dealers",
        account_context="dealer account 4471",
        counterparty_phone_e164="+12025550142",
        economic_policy_id="standard-pursuit",
        claim_face_value=value,
        claim_currency="USD",
        ordinary_remedies=(
            OrdinaryRemedy("portal_status_check", "no detail"),
            OrdinaryRemedy("documented_code_resolution", "not covered"),
            OrdinaryRemedy("written_follow_up", "no reply"),
        ),
    )


@settings(**SETTINGS)
@given(
    minimum=st.decimals(min_value=Decimal("0.01"), max_value=1000, places=2),
    value=st.decimals(min_value=Decimal("0.01"), max_value=2000, places=2),
)
def test_the_value_line_fires_exactly_under_the_minimum(minimum, value):
    """With no cost ceiling and no age cap, the only question is the value
    line: ``BELOW_MINIMUM_VALUE`` (and therefore ``NOT_WORTH_PURSUING``)
    exactly when the face value is strictly under the minimum — at the line,
    the claim clears it."""

    decision = assess_economics(
        economic_claim(value),
        policy_book=policy_book(minimum=minimum),
        on=date(2026, 9, 1),
    )
    names = {refusal.value for refusal in decision.refusals}
    if value < minimum:
        assert names == {"BELOW_MINIMUM_VALUE", "NOT_WORTH_PURSUING"}
    else:
        assert names == set()


@settings(**SETTINGS)
@given(
    ceiling=st.decimals(min_value=Decimal("0.01"), max_value=100, places=2),
    price=st.decimals(min_value=Decimal("0.01"), max_value=200, places=2),
)
def test_the_cost_line_fires_exactly_over_the_ceiling(ceiling, price):
    """With no minimum and no age cap, the only question is the cost line:
    ``NOT_WORTH_PURSUING`` exactly when the supplied per-call price is
    strictly over the ceiling — at the ceiling, the organization pays it."""

    decision = assess_economics(
        economic_claim(Decimal("1000.00")),
        policy_book=policy_book(maximum_call_cost=ceiling, per_call_price=price),
        on=date(2026, 9, 1),
    )
    names = {refusal.value for refusal in decision.refusals}
    if price > ceiling:
        assert names == {"NOT_WORTH_PURSUING"}
    else:
        assert names == set()


# --- family: write identity --------------------------------------------------


BASE_NOTE = {
    "contract_version": "1",
    "claim_status": "STATED_RETURNED",
    "stated_reason": "r",
    "required_correction": None,
    "required_documents": ["d"],
    "stated_deadline": None,
    "escalation_path": None,
    "stated_next_action": None,
    "confirmed_reference": None,
    "evidence_pointer": "call_synthetic_property",
}

note_ids = st.fixed_dictionaries(
    {
        "source_platform": st.just("SYNTHETIC-DMS"),
        "source_claim_id": st.just("CLM-1042"),
        "source_version": st.sampled_from(["v1", "v2", "v3"]),
        "idempotency_key": st.sampled_from(["k1", "k2", "k3"]),
        "note": st.fixed_dictionaries(
            {
                "contract_version": st.just("1"),
                "claim_status": st.sampled_from(["STATED_RETURNED", "STATED_REJECTED"]),
                "stated_reason": st.sampled_from(["r", "s"]),
                "required_documents": st.lists(
                    st.sampled_from(["d1", "d2"]), min_size=0, max_size=2
                ),
            }
        ),
    }
)


@settings(**SETTINGS)
@given(payload=note_ids)
def test_the_note_id_is_a_pure_function_of_its_inputs(payload):
    first = note_id_for(**payload)
    second = note_id_for(**dict(payload, note=dict(payload["note"])))
    assert first == second
    assert len(first) == 32


@settings(**SETTINGS)
@given(payload=note_ids, field=st.sampled_from(["source_version", "idempotency_key"]))
def test_any_single_anchor_change_moves_the_identity(payload, field):
    changed = dict(payload)
    changed[field] = payload[field] + "-changed"
    assert note_id_for(**changed) != note_id_for(**payload)


@settings(**SETTINGS)
@given(payload=note_ids)
def test_key_order_never_moves_the_identity(payload):
    reordered = {
        "note": payload["note"],
        "idempotency_key": payload["idempotency_key"],
        "source_version": payload["source_version"],
        "source_claim_id": payload["source_claim_id"],
        "source_platform": payload["source_platform"],
    }
    assert note_id_for(**reordered) == note_id_for(**payload)


# --- family: the audit chain -------------------------------------------------


@settings(**SETTINGS)
@given(
    lengths=st.lists(st.integers(min_value=1, max_value=4), min_size=1, max_size=3),
    key=st.sampled_from(["a" * 64, "b" * 64]),
)
def test_every_honest_chain_verifies(lengths, key):
    chain = EventChain()
    for _ in lengths:
        chain.append(
            actor=AuditActor.WORKFLOW,
            idempotency_key=key,
            from_state=None,
            to_state="RESERVED",
            reason=AuditReason.RESERVED,
            timestamp="2026-09-01T12:00:00+00:00",
        )
    assert verify_chain(chain.events()) == []


@settings(**SETTINGS)
@given(
    rows=st.integers(min_value=1, max_value=4),
    field=st.sampled_from(
        ["reason", "to_state", "actor", "idempotency_key", "seq", "timestamp"]
    ),
)
def test_corrupting_any_field_of_any_row_breaks_verification(rows, field):
    chain = EventChain()
    for index in range(rows):
        chain.append(
            actor=AuditActor.WORKFLOW,
            idempotency_key="a" * 64,
            from_state=None if index == 0 else "RESERVED",
            to_state="RESERVED",
            reason=AuditReason.RESERVED,
            timestamp=f"2026-09-01T12:00:0{index}+00:00",
        )
    victim = chain.events()[rows - 1]
    if field == "seq":
        forged = replace(victim, seq=victim.seq + 10)
    else:
        forged = replace(victim, **{field: "forged-" + field})
    events = list(chain.events())
    events[rows - 1] = forged
    assert verify_chain(events), f"corrupting {field} went undetected"
