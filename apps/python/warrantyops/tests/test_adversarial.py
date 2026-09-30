"""The adversarial page: eighteen attacks, eighteen real kernel refusals.

§5.1 (locked): every "What WarrantyOps wrote" cell and every refusal code on
the page titled "We tried to make it lie." is produced by executing the real
kernel against synthetic input. These tests pin the families, pin the refusal
codes, and pin the discipline: the page regenerates byte-identically, every
row is labelled Synthetic scenario, and no complete phone number or real
call id ever reaches it.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from warrantyops.adversarial import (
    ADVERSARIAL_TITLE,
    DEFAULT_OUTPUT,
    build_adversarial_rows,
    render_adversarial_page,
    write_adversarial_page,
)

APP_ROOT = Path(__file__).resolve().parents[1]

COMPLETE_NUMBER = re.compile(r"\+1\d{10}\b")
CALL_TOKEN = re.compile(r"\bcall_[A-Za-z0-9_-]{2,}\b")
SYNTHETIC_PILL = '<span class="pill synthetic">Synthetic scenario</span>'


def rows():
    return build_adversarial_rows()


def page() -> str:
    return DEFAULT_OUTPUT.read_text(encoding="utf-8")


# --- the eighteen families ------------------------------------------------------


def test_all_eighteen_families_are_present_in_order():
    assert [row.family for row in rows()] == list(range(1, 19))
    assert [row.family for row in rows()] == [row.family for row in rows()]


def test_the_page_carries_the_locked_title_and_the_rows_are_the_runs_claim():
    body = page()
    assert ADVERSARIAL_TITLE == "We tried to make it lie."
    assert f"<h1>{ADVERSARIAL_TITLE}</h1>" in body
    assert "the rows are the runs" in body
    assert "Nothing later rescues an earlier refusal" in body
    for family in range(1, 19):
        assert f'<tr id="family-{family}">' in body


def test_every_row_is_labelled_synthetic_scenario():
    body = page()
    assert body.count(SYNTHETIC_PILL) == 18
    for row in rows():
        assert row.evidence_class == "Synthetic scenario"


def test_no_row_mixes_a_recorded_or_fictional_pill():
    body = page()
    assert "Recorded CALL-E result" not in body
    assert "Fictional case data" not in body


# --- pinned real refusal codes (each cell is a real kernel execution) --------------


def test_grounding_families_reduce_invented_status_to_unknown():
    by_family = {row.family: row for row in rows()}
    assert "STATED_PAID had no evidence quote and was reduced to UNKNOWN" in (
        by_family[1].refusal
    )
    assert "not found in a counterparty turn and was reduced to UNKNOWN" in (
        by_family[2].refusal
    )
    assert "reduced to UNKNOWN" in by_family[7].refusal
    for family in (1, 2, 7):
        assert "BUSINESS_UNRESOLVED" in by_family[family].warrantyops_wrote


def test_identifier_families_refuse_with_the_binding_vocabulary():
    by_family = {row.family: row for row in rows()}
    assert "IDENTIFIER_NOT_IN_EXCHANGE" in by_family[3].refusal
    assert "AMBIGUOUS_EXCHANGE" in by_family[4].refusal
    assert "AMBIGUOUS_EXCHANGE" in by_family[5].refusal
    assert "IDENTIFIER_NOT_IN_EXCHANGE" in by_family[6].refusal
    assert "PATTERN_MISMATCH" in by_family[6].refusal
    for family in (3, 4, 5, 6):
        state = by_family[family].warrantyops_wrote.replace("identifier ", "")
        assert state != "CONFIRMED_IDENTIFIER", state  # none of them confirms


def test_gate_families_refuse_before_the_dial():
    by_family = {row.family: row for row in rows()}
    assert "ORDINARY_ROUTE_NOT_EXHAUSTED" in by_family[8].refusal
    assert "written_follow_up" in by_family[8].warrantyops_wrote
    assert "RESIDUAL_NECESSITY" in by_family[8].warrantyops_wrote
    assert "SOURCE_CHANGED" in by_family[9].refusal
    assert "SOURCE_STATE" in by_family[9].warrantyops_wrote
    assert "DUPLICATE_CALL_SUPPRESSED" in by_family[10].refusal
    assert "ATTEMPT_LEDGER" in by_family[10].warrantyops_wrote
    assert "INVALID_PHONE" in by_family[11].refusal
    assert "ENVELOPE" in by_family[11].warrantyops_wrote
    for family in (8, 9, 11):
        assert "no call placed" in by_family[family].warrantyops_wrote
    assert "no second call" in by_family[10].warrantyops_wrote


def test_result_and_hint_families_keep_the_schema_authoritative():
    by_family = {row.family: row for row in rows()}
    assert "expected string, got int" in by_family[12].refusal
    assert "RESULT_INVALID" in by_family[12].warrantyops_wrote
    assert "RECONCILED" in by_family[13].refusal
    assert "agreement=False" in by_family[13].refusal
    assert "completed" in by_family[13].warrantyops_wrote  # the GET stands


def test_injection_and_disclosure_families_have_no_code_path_to_obey():
    by_family = {row.family: row for row in rows()}
    assert "not a documented GoalRunError code" in by_family[14].refusal
    assert "PROHIBITED_TASK_TEXT" in by_family[15].refusal
    assert "DISCLOSURE_ALLOWLIST" in by_family[18].refusal
    assert "1200.00" not in by_family[18].warrantyops_wrote
    assert "APPROVED" in by_family[17].refusal  # named only to be rejected
    assert "is not one of" in by_family[17].refusal


def test_the_live_dial_family_counts_zero_network_requests():
    by_family = {row.family: row for row in rows()}
    refusal = by_family[16].refusal
    assert "preflight gates failed" in refusal
    assert "network requests so far: 0" in refusal
    assert "refused before any client exists" in by_family[16].warrantyops_wrote


# --- safety of the artifact --------------------------------------------------------


def test_no_complete_phone_number_exists_on_the_page():
    assert COMPLETE_NUMBER.search(page()) is None
    for row in rows():
        assert COMPLETE_NUMBER.search(row.attack) is None
        assert COMPLETE_NUMBER.search(row.warrantyops_wrote) is None


def test_every_call_id_token_is_synthetic():
    for token in CALL_TOKEN.findall(page()):
        assert "synthetic" in token.lower(), token


def test_the_page_is_self_contained_offline_html():
    body = page()
    assert body.startswith("<!doctype html>")
    assert '<html lang="en">' in body
    assert "<form" not in body
    for forbidden in ("fetch(", "XMLHttpRequest", "http://", "https://", "CALLE_API_KEY"):
        assert forbidden not in body, forbidden


# --- determinism and the checked-in page ---------------------------------------------


def test_rendering_twice_is_byte_identical():
    assert render_adversarial_page() == render_adversarial_page()


def test_rebuilding_the_rows_twice_is_equal():
    assert rows() == rows()


def test_regenerating_the_checked_in_page_is_byte_identical(tmp_path):
    target = tmp_path / "regenerated.html"
    write_adversarial_page(output_path=target)
    assert target.read_text(encoding="utf-8") == page()


def test_the_cli_verify_runs_green_as_a_subprocess():
    result = subprocess.run(
        [sys.executable, "-m", "warrantyops", "--verify-adversarial"],
        cwd=str(APP_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "byte-identical" in result.stdout
    assert "sha256=" in result.stdout
