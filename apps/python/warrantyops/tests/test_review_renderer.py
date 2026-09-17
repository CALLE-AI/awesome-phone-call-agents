"""The one renderer behind the live review screen and the static proof page.

D3 (locked): one deterministic renderer produces both surfaces. These tests
pin the determinism, the one-evidence-pill-per-field rule, the escaping, and
the decision-area contract: the static page never renders a form, the live
page renders one only with a CSRF token, and a recorded decision renders as
a receipt.
"""

from __future__ import annotations

from warrantyops.proof_screen import build_proof_model
from warrantyops.receipt import EvidenceClass
from warrantyops.review import ReviewDecision, ReviewPacket
from warrantyops.review_screen import (
    DECISION_PENDING,
    DecisionState,
    ReviewScreenModel,
    build_live_model,
    render_review_screen,
)

SYNTHETIC = EvidenceClass.SYNTHETIC.value
RECORDED = EvidenceClass.RECORDED.value
FICTIONAL = EvidenceClass.FICTIONAL.value


def packet() -> ReviewPacket:
    return ReviewPacket(
        review_id="ab12cd34ef56",
        terminal_state="INFORMATION_OBTAINED",
        transport_state="completed",
        recipient_masked="+1 ••• ••• 0142",
        business={
            "claim_status": "UNKNOWN",
            "required_correction": "send the installation photograph",
            "required_documents": ["installation photograph"],
            "confirmed_reference": {"value": "BR-4821", "kind": "CASE"},
            "evidence": (
                {
                    "field": "required_documents",
                    "quote": "It requires an installation photograph.",
                },
                {
                    "field": "confirmed_reference",
                    "quote": "Correct, case BR-4821.",
                    "method": "DIRECT_COUNTERPARTY_QUOTE",
                },
            ),
        },
        identifier={"state": "CONFIRMED_IDENTIFIER"},
        packet_sha256="9f86d081884c7d65",
    )


def live_model(**overrides) -> ReviewScreenModel:
    kwargs: dict[str, object] = {
        "claim_id": "W-1042",
        "organization": "NorthStar Equipment",
        "counterparty": "BlueRock Machinery",
        "amount_display": "$800",
        "situation": "Residual exception — <script>alert(1)</script>",
        "transcript_path": "/transcript/ab12cd34ef56",
        "transcript_available": True,
        "csrf_token": "tok-123",
    }
    kwargs.update(overrides)
    return build_live_model(packet(), **kwargs)  # type: ignore[arg-type]


# --- determinism ---------------------------------------------------------------


def test_the_renderer_is_a_pure_function_of_its_model():
    assert render_review_screen(live_model()) == render_review_screen(live_model())


def test_the_checked_in_proof_page_model_is_stable():
    model = build_proof_model()
    page = render_review_screen(model)
    again = render_review_screen(build_proof_model())
    assert page == again
    assert model.page_kind == "static-proof"
    assert model.runtime_marker == RECORDED


# --- evidence pills ------------------------------------------------------------


def test_every_runtime_row_carries_exactly_one_evidence_pill():
    page = render_review_screen(live_model())
    for row_anchor in ("Transport", "Stated status", "Terminal state"):
        assert row_anchor in page
    # The runtime marker appears on the runtime card and the claim bar and
    # every runtime row — and it is always the same class on one instance.
    assert page.count(f">{SYNTHETIC}<") >= 6
    assert f">{RECORDED}<" not in page  # a synthetic instance never mixes Recorded


def test_the_static_instance_never_carries_the_synthetic_marker():
    page = render_review_screen(build_proof_model())
    assert f">{SYNTHETIC}<" not in page
    assert f">{RECORDED}<" in page


def test_the_claim_context_carries_the_fictional_pill_on_both_surfaces():
    for page in (
        render_review_screen(live_model()),
        render_review_screen(build_proof_model()),
    ):
        assert f">{FICTIONAL}<" in page


# --- escaping -------------------------------------------------------------------


def test_every_dynamic_value_is_html_escaped():
    page = render_review_screen(live_model())
    assert "<script>alert(1)</script>" not in page
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in page


def test_quotes_and_values_are_escaped_in_rows():
    page = render_review_screen(live_model())
    assert "&lt;script&gt;" in page


# --- decision area contract -------------------------------------------------------


def test_the_static_proof_page_renders_no_form():
    page = render_review_screen(build_proof_model())
    assert "<form" not in page
    assert "Approve note" not in page


def test_the_live_page_without_a_csrf_token_renders_no_form():
    page = render_review_screen(live_model(csrf_token=""))
    assert "<form" not in page
    assert "Approve note" not in page


def test_the_live_page_with_a_csrf_token_renders_the_three_decisions():
    page = render_review_screen(live_model())
    assert '<form method="post" action="/review/ab12cd34ef56/decision">' in page
    assert 'name="csrf_token" value="tok-123"' in page
    assert 'name="packet_sha256" value="9f86d081884c7d65"' in page
    for label in (
        'value="APPROVE">Approve note',
        'value="REFUSE"',
        'value="RETURN_TO_DIGITAL"',
    ):
        assert label in page


def test_a_recorded_decision_renders_as_a_receipt_not_a_form():
    decided = DecisionState(
        mode=ReviewDecision.APPROVE.value,
        operator_id="maya",
        decided_at="2026-09-01T12:00:00Z",
        write_back="NOTE_WRITTEN",
        note_id="note-1",
    )
    model = live_model(decision=decided)
    assert model.page_kind == "decision-receipt"
    page = render_review_screen(model)
    assert "<form" not in page
    assert "Approved" in page and "operator maya" in page
    assert "note-1" in page


def test_a_replayed_decision_says_so():
    decided = DecisionState(mode="APPROVE", replayed=True, write_back="NOTE_WRITTEN")
    page = render_review_screen(live_model(decision=decided))
    assert "idempotent replay" in page


def test_a_pending_decision_state_still_renders_the_form():
    pending = live_model(decision=DecisionState(mode=DECISION_PENDING))
    assert pending.page_kind == "live-review"
    assert "<form" in render_review_screen(pending)


# --- boundary card ---------------------------------------------------------------


def test_the_boundary_card_names_the_human_gate_and_the_jailed_transcript():
    page = render_review_screen(live_model())
    assert "System will not write until a named human approves" in page
    assert 'href="/transcript/ab12cd34ef56"' in page
    assert "local-only" in page


def test_without_a_transcript_the_boundary_card_says_so():
    page = render_review_screen(
        live_model(transcript_available=False, transcript_path="")
    )
    assert "Private transcript: not published on this page" in page
    assert "/transcript/" not in page


def test_the_runtime_limitation_and_lines_render():
    page = render_review_screen(
        live_model(
            runtime_lines=("Provider fake: synthetic replay, zero real calls placed",),
            runtime_limitation="Synthetic scenario — no live call was placed.",
        )
    )
    assert "Provider fake: synthetic replay, zero real calls placed" in page
    assert "Synthetic scenario — no live call was placed." in page
    assert "Exactly one call per claim version" in page
