"""P14 (locked, line 315): 100 sequential FakeCalle reviews.

One hundred sequential review cycles against the fixture-replaying fake
produce byte-identical receipts, zero provider creates, and zero log leaks.
The receipts are stamped ``Synthetic scenario`` once each; the event stream
is captured in full and shown to carry no recipient number anywhere.
"""

from __future__ import annotations

import re

from test_scenarios import NOW, authorization_for, fixtures

from warrantyops.envelope import source_claim_from_dict
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.observability import EventLog
from warrantyops.providers.fake import FakeCallProvider
from warrantyops.receipt import EvidenceClass, build_receipt, render_receipt_json
from warrantyops.review import ReviewDecision, ReviewRecord, prepare_review
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import run_exception
from warrantyops.writeback import InMemoryNoteLedger, WriteBackRefusal, write_back

SCENARIO = "case_a_useful_resolution"
REVIEWS = 100


def one_review(lines: list[str]) -> tuple[str, FakeCallProvider]:
    """One full review cycle: run, review, approve, write, render."""

    fixture = fixtures()[SCENARIO]
    claim = source_claim_from_dict(fixture["envelope"])
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    provider = FakeCallProvider(scenario=SCENARIO)
    events = EventLog(sink=lines.append)
    run = run_exception(
        claim,
        authorization_for(fixture["recipient_e164"]),
        provider,
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=NOW,
        allowlist=frozenset({fixture["recipient_e164"]}),
        events=events,
    )
    assert run.refusal is None
    packet = prepare_review(run.outcome, fixture["recipient_e164"])
    assert run.outcome is not None
    written = write_back(
        claim,
        store,
        InMemoryNoteLedger(),
        packet,
        ReviewRecord(
            decision=ReviewDecision.APPROVE,
            reviewer="p14-reviewer",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-p14",
        ),
        run.outcome,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=run.outcome.transport.call_id,
        written_at=NOW,
    )
    assert not isinstance(written, WriteBackRefusal)
    receipt = build_receipt(
        run,
        recipient_e164=fixture["recipient_e164"],
        provider_name=provider.name,
        evidence_class=EvidenceClass.SYNTHETIC,
        source_platform=claim.source_platform,
        source_object_id=claim.source_claim_id,
    )
    return render_receipt_json(receipt), provider


def test_p14_one_hundred_sequential_reviews():
    lines: list[str] = []
    rendered: list[str] = []
    creates = 0
    for _ in range(REVIEWS):
        receipt_json, provider = one_review(lines)
        rendered.append(receipt_json)
        creates += provider.calls_placed

    # Identical receipts: one unique byte string across all one hundred.
    assert len(set(rendered)) == 1
    assert rendered[0].count('"Synthetic scenario"') == 1

    # Zero creates: the fake replays a fixture and cannot dial.
    assert creates == 0

    # Zero log leaks: no captured event line carries the recipient number,
    # raw or as any unmasked E.164-shaped token outside the reserved block.
    recipient = fixtures()[SCENARIO]["recipient_e164"]
    e164 = re.compile(r"\+[1-9]\d{7,14}\b")
    reserved = re.compile(re.escape("+1" + "20255501") + r"\d{2}\b")
    assert lines, "the event stream was captured"
    for line in lines:
        assert recipient not in line
        for number in e164.findall(line):
            assert reserved.fullmatch(number), number
