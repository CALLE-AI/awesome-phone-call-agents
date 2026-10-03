"""The Phase 6 artifacts cannot claim more than they hold.

docs/adapter-contract.md is checked against the code it describes (Delivery
fields, refusal codes, the three MCP tools), proof/independent-run.md is
checked for its honesty rules (no third party has run; the record template
stays empty; the pinned digests match the artifacts on disk), and the Skill
is checked for the surfaces it references.
"""

from __future__ import annotations

import dataclasses
import hashlib
import re
from pathlib import Path

from warrantyops.claim_adapter import Delivery
from warrantyops.gates import VersionRefusal
from warrantyops.ledger import LedgerRefusal
from warrantyops.mcp_surface import MCP_TOOLS
from warrantyops.writeback import WriteBackRefusal

APP = Path(__file__).resolve().parents[1]
DOCS = APP / "docs"
PROOF = APP / "proof"
SKILL = Path(__file__).resolve().parents[4] / "skills/warranty-recovery/SKILL.md"

#: The locked §6.2 contract block, verbatim.
CONTRACT_BLOCK = """\
Claim Adapter Contract — fixtures built now; DMS integration planned
in: claim_id, source_version, supplied money/policy, missing requirement,
    structured exhaustion manifest, recipient authorization class
out: terminal packet, review decision, provider receipt,
     idempotent note/status payload, audit reference
"""

PINNED_ARTIFACTS = (
    "w1042-proof.html",
    "w1042-proof.json",
    "runtime-proof-receipt.public.json",
    "adversarial.html",
)


def adapter_contract() -> str:
    return (DOCS / "adapter-contract.md").read_text(encoding="utf-8")


def independent_run() -> str:
    """Collapsed across line breaks, so hard-wrapped prose still matches."""

    return " ".join((PROOF / "independent-run.md").read_text(encoding="utf-8").split())


def skill() -> str:
    return " ".join(SKILL.read_text(encoding="utf-8").split())


# --- the adapter contract doc ------------------------------------------------------------


def test_the_locked_contract_block_appears_verbatim():
    assert CONTRACT_BLOCK in adapter_contract()


def test_the_doc_says_planned_not_a_connector():
    doc = adapter_contract()
    assert "not a DMS/ERP connector" in doc
    assert "DMS/ERP sequence diagram — **planned**" in doc
    assert "No DMS/ERP connector exists here" in doc
    assert "planned, not built" in doc


def test_the_output_side_names_exactly_the_delivery_fields():
    doc = adapter_contract()
    fields = {field.name for field in dataclasses.fields(Delivery)}
    assert fields == {
        "terminal_packet",
        "review_decision",
        "provider_receipt",
        "note_payload",
        "audit_reference",
    }
    for name in fields:
        assert name in doc, name


def test_every_refusal_code_the_cookbook_names_is_real():
    doc = adapter_contract()
    for code in (
        VersionRefusal.SOURCE_RECHECK_UNAVAILABLE,
        LedgerRefusal.DUPLICATE_CALL_SUPPRESSED,
        LedgerRefusal.IDEMPOTENCY_CONFLICT,
        WriteBackRefusal.REVIEW_CONFLICT,
        WriteBackRefusal.SOURCE_CHANGED,
    ):
        assert code.value in doc, code


def test_the_doc_names_the_three_mcp_tools_and_the_no_bypass_rule():
    doc = adapter_contract()
    for tool in MCP_TOOLS:
        assert tool in doc, tool
    assert "No Skill or MCP tool can bypass" in doc


def test_no_real_shaped_number_appears_in_the_contract_doc():
    e164 = re.compile(r"\+[1-9]\d{7,14}\b")
    reserved = re.compile(re.escape("+1" + "20255501") + r"\d{2}\b")
    for number in e164.findall(adapter_contract()):
        assert reserved.fullmatch(number), number


# --- the independent-run record ----------------------------------------------------------


def test_the_run_states_plainly_it_never_happened():
    doc = independent_run()
    assert "NOT independently run" in doc
    assert "no third party has run this repository" in doc
    assert "no fork or clone has been pushed or published" in doc
    assert "not third-party evidence" in doc


def test_the_third_party_record_is_intentionally_empty():
    doc = independent_run()
    assert "intentionally empty" in doc
    assert doc.count("| — |") >= 9  # every field of the record table


def test_the_procedure_needs_no_private_context_or_live_key():
    doc = independent_run()
    for needed in ("make check", "pytest -q", "pip install -e", "CALLE_API_KEY"):
        assert needed in doc, needed
    assert "outside this repository" in doc  # the hygiene leg's owner tool
    assert "exit 2" in doc  # it stops loudly rather than silently skipping


def test_the_pinned_digests_match_the_artifacts_on_disk():
    doc = independent_run()
    for name in PINNED_ARTIFACTS:
        digest = hashlib.sha256((PROOF / name).read_bytes()).hexdigest()
        assert digest in doc, name


def test_the_signed_out_link_check_is_recorded():
    doc = independent_run()
    assert "signed out of every service" in doc
    assert "2026-09-12" in doc


# --- the Skill ----------------------------------------------------------------------------


def test_the_skill_references_the_governed_surfaces():
    doc = skill()
    assert "no Skill, CLI or MCP tool can bypass the kernel" in doc
    for tool in MCP_TOOLS:
        assert tool in doc, tool
    for reference in (
        "docs/adapter-contract.md",
        "docs/evidence-table.md",
        "proof/independent-run.md",
    ):
        assert reference in doc, reference


def test_the_skill_names_the_three_evidence_classes():
    doc = skill()
    for pill in (
        "Recorded CALL-E result",
        "Synthetic scenario",
        "Fictional case data",
    ):
        assert pill in doc, pill
