"""Every demo bundle must have a recording that actually belongs to it.

Two bugs live here, and both of them look like the product working correctly
until you read closely.

The first: a bundle replaying another payer's recording gets back an answer
about claims nobody asked about, so every claim comes back ungrounded and the
call is marked unusable. That is the evidence guard doing its job on a problem
that only exists because the wrong tape was loaded. A demonstration whose first
call fails for that reason teaches the reader the opposite of the truth.

The second: a transcript that speaks an identifier belonging to a patient who
is not on the call. The scrubber redacts the identifiers of the patients whose
claims are on the call, which is the right rule, so a stray identifier from
somebody else survives into the ledger. ``vault-check`` catches it, but only if
somebody runs it after a call that happens to hit that fixture.
"""
from __future__ import annotations

import json
import os

import pytest

from tests.helpers import FIXTURES_DIR, context, run, seed
from trunkline import client as calle_client, demo, verify, workqueue
from trunkline.models import ANSWERED

ADVERSARIAL = ("ungrounded_evidence", "schema_violation")

# Four digits collide with the tail of a claim number on purpose: the redactor
# matches short identifiers exactly rather than loosely, so ``4417`` does not
# eat the end of CLM-2026-004417. Only identifiers long enough to be unique to
# one person are evidence of a leak.
MIN_DISTINGUISHING_LENGTH = 6


def _all_bundles(ctx):
    found = []
    for workflow in sorted(demo.CANONICAL_SCENARIOS):
        found.extend(workqueue.build_bundles(ctx.ledger, workflow=workflow))
    return found


def _fixture(name):
    return calle_client.load_fixture(FIXTURES_DIR, name)


def _transcript(fixture):
    turns = fixture["recipients"][0]["attempts"][0]["transcript_turns"]
    return verify.transcript_text(turns)


def _claim_numbers(fixture):
    result = fixture.get("structured_result") or {}
    return {
        verify.normalize_claim_number(entry.get("claim_number", ""))
        for entry in (result.get("claims") or [])
    }


def _patient_by_claim_number():
    mapping = {}
    for claim in demo.claims():
        mapping[verify.normalize_claim_number(claim.claim_number)] = claim.patient_ref
    return mapping


def test_every_demo_bundle_resolves_to_a_recording_that_covers_its_claims(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)

    for bundle in _all_bundles(ctx):
        numbers = [claim.claim_number for claim in bundle.claims]
        scenario = demo.scenario_for(FIXTURES_DIR, bundle.workflow, numbers)
        covered = _claim_numbers(_fixture(scenario))
        missing = [n for n in numbers if verify.normalize_claim_number(n) not in covered]
        assert not missing, (
            "%s/%s resolved to %r, which never mentions %s"
            % (bundle.payer_id, bundle.workflow, scenario, missing)
        )


def test_every_demo_bundle_answers_when_it_is_actually_run(tmp_path):
    """The end-to-end version: no bundle in the shipped demo comes back unusable."""
    data = str(tmp_path)
    seed(data)
    ctx = context(data)

    for bundle in _all_bundles(ctx):
        numbers = [claim.claim_number for claim in bundle.claims]
        scenario = demo.scenario_for(FIXTURES_DIR, bundle.workflow, numbers)
        outcome = run(ctx, bundle, scenario)
        assert outcome.call is not None
        assert outcome.call.outcome == ANSWERED, (
            "%s/%s came back %s" % (bundle.payer_id, bundle.workflow, outcome.call.outcome)
        )
        for claim_id in outcome.call.claim_ids:
            assert outcome.call.per_claim[claim_id].get("_grounded") is True


@pytest.mark.parametrize("scenario", ADVERSARIAL)
def test_an_adversarial_fixture_is_never_chosen_on_its_own(tmp_path, scenario):
    """They share their claim numbers with claim_status_paid and must still lose.

    A guardrail should fire because somebody aimed it, not because a lookup
    landed there.
    """
    data = str(tmp_path)
    seed(data)
    ctx = context(data)

    for bundle in _all_bundles(ctx):
        numbers = [claim.claim_number for claim in bundle.claims]
        assert demo.scenario_for(FIXTURES_DIR, bundle.workflow, numbers) != scenario

    # Asked for by name, it is honoured.
    bundle = workqueue.build_bundles(ctx.ledger, workflow="claim_status", payer_id="pay_meridian")[0]
    numbers = [claim.claim_number for claim in bundle.claims]
    assert demo.scenario_for(FIXTURES_DIR, "claim_status", numbers, explicit=scenario) == scenario


def test_no_fixture_speaks_an_identifier_belonging_to_someone_not_on_the_call():
    """The scrubber redacts the patients on the call. Nobody else may be named."""
    owner_of = _patient_by_claim_number()

    for name in sorted(calle_client.available_fixtures(FIXTURES_DIR)):
        fixture = _fixture(name)
        transcript = _transcript(fixture)
        on_the_call = {owner_of[number] for number in _claim_numbers(fixture) if number in owner_of}

        for patient_ref, record in demo.VAULT.items():
            if patient_ref in on_the_call:
                continue
            for field, value in record.items():
                if not value or len(value) < MIN_DISTINGUISHING_LENGTH:
                    continue
                assert value not in transcript, (
                    "fixture %r speaks %s belonging to %s, who has no claim on that call; "
                    "the scrubber will not redact it" % (name, field, patient_ref)
                )
