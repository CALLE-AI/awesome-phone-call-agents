"""The judge-facing proof screen: deterministic, sanitized, offline.

The page a judge opens is generated from the checked-in fixture by the
renderer, so these tests pin that identity (regeneration is byte-identical)
and pin the safety properties: no secret, no complete phone number, no
unmasked call id, no private path, and no way for the page to reach a
network or start a call.
"""

from __future__ import annotations

import json
import re

from warrantyops.proof_screen import (
    DEFAULT_FIXTURE,
    DEFAULT_OUTPUT,
    build_proof_model,
    write_proof_screen,
)

PUBLIC_RECEIPT = DEFAULT_OUTPUT.parent / "runtime-proof-receipt.public.json"

#: Exact values from the verified sanitized runtime receipt. Never invented,
#: never polished.
MASKED_CALL_ID = "call_dMU…A-3Q"
EXACT_QUOTE = "Br Hyphen, 4821."
LIMITATION = (
    "Recorded CALL-E runtime proof using a consenting role-player. This is "
    "not evidence of deployment at a warranty desk."
)
TRUST_NOTE = (
    "The counterparty did not explicitly state the claim status, so "
    "WarrantyOps refuses to invent it."
)

#: A complete US-style E.164 number must never appear.
COMPLETE_NUMBER = re.compile(r"\+1\d{10}\b")
#: Any call-id-looking token other than the masked display form.
CALL_TOKEN = re.compile(r"\bcall_[A-Za-z0-9_-]{2,}\b")


def fixture() -> dict:
    return json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))


def page() -> str:
    return DEFAULT_OUTPUT.read_text(encoding="utf-8")


# --- determinism --------------------------------------------------------------


def test_regenerating_the_checked_in_page_is_byte_identical(tmp_path):
    target = tmp_path / "regenerated.html"
    write_proof_screen(output_path=target)
    assert target.read_text(encoding="utf-8") == page()


def test_the_page_is_generated_from_the_fixture_not_hand_written():
    model = build_proof_model()
    data = fixture()
    claim = data["claim"]
    runtime = data["runtime"]
    assert model.claim_id == claim["id"]
    assert model.organization == claim["organization"]
    assert model.counterparty == claim["counterparty"]
    assert model.amount_display == claim["amount_display"]
    assert model.administrator == claim["administrator"]
    assert model.transport_row is not None
    assert model.transport_row.value == runtime["transport_state"]
    assert model.reference_row is not None
    assert model.reference_row.value == data["outcome"]["reference"]["display"]
    assert model.reference_row.quote == EXACT_QUOTE
    assert model.terminal_row is not None
    assert model.terminal_row.value == data["outcome"]["terminal_state"]
    assert model.decision.write_back == data["boundary"]["write_back"]
    assert model.runtime_limitation == runtime["limitation"]
    assert MASKED_CALL_ID in model.runtime_lines[2]
    # …and the decisive values are server-rendered into the page itself.
    body = visible_html()
    for value in (
        model.claim_id,
        model.transport_row.value,
        model.reference_row.value,
        EXACT_QUOTE,
        MASKED_CALL_ID,
    ):
        assert value in body, value


def test_the_reveal_payload_carries_exactly_the_fixture_labels():
    embedded = page().split('<script type="application/json" id="reveal-data">')[1]
    embedded = embedded.split("</script>")[0]
    replay = fixture()["replay"]
    assert json.loads(embedded) == {
        "revealed_label": replay["revealed_label"],
        "announce": replay["announce"],
    }


# --- required content ----------------------------------------------------------


def test_the_page_carries_every_required_label():
    body = page()
    for required in (
        "Reveal recorded result",
        "Reveals the saved, sanitized runtime result",
        "Fictional case data",
        "Recorded CALL-E result",
        MASKED_CALL_ID,
        EXACT_QUOTE,
        "Maya",
        "NorthStar Equipment",
        "W-1042",
        "$800",
        "BlueRock Machinery",
        "Installation photograph",
        "BR-4821",
        "Direct counterparty quote",
        "INFORMATION_OBTAINED",
        "UNKNOWN",
        "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW",
        "Exactly one call per claim version",
        "Provider CALL-E performed the phone interaction",
        "Recorded calls: 1",
        "portal status check — portal shows only",
        "no published code sheet covers R-RETURNED-NO-REASON",
        "claim face value $800 (source record) ≥ policy minimum $250.00 "
        "(organization policy) — holds",
        "Private transcript: not published on this page",
        "System will not write until a named human approves",
        LIMITATION,
        TRUST_NOTE,
    ):
        assert required in body, required


def test_no_invented_evidence_survives():
    body = page()
    for invented in (
        "It is case BR-4821.",
        "call_…0742",
        "local recording",
    ):
        assert invented not in body, invented


def test_the_fixture_tells_the_locked_story_honestly():
    data = fixture()
    assert data["claim"]["id"] == "W-1042"
    assert data["claim"]["amount_display"] == "$800"
    assert data["claim"]["fictional_label"] == "Fictional demonstration case"
    assert data["runtime"]["recorded_calls"] == 1
    assert data["runtime"]["transport_state"] == "completed"
    assert data["runtime"]["masked_call_id"] == MASKED_CALL_ID
    assert data["runtime"]["limitation"] == LIMITATION
    assert data["outcome"]["claim_status"] == "UNKNOWN"
    assert data["outcome"]["trust_note"] == TRUST_NOTE
    assert data["outcome"]["reference"]["display"] == "BR-4821"
    assert data["outcome"]["reference"]["method"] == "DIRECT_COUNTERPARTY_QUOTE"
    assert data["outcome"]["reference"]["quote"] == EXACT_QUOTE
    assert data["boundary"]["write_back"] == "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW"
    assert data["replay"]["hint"] == (
        "Reveals the saved, sanitized runtime result. This control never "
        "starts a live call."
    )


# --- safety ---------------------------------------------------------------------


def test_no_complete_phone_number_or_unmasked_call_id_exists():
    for text in (page(), DEFAULT_FIXTURE.read_text(encoding="utf-8")):
        assert COMPLETE_NUMBER.search(text) is None
        for token in CALL_TOKEN.findall(text):
            # Only the masked display form and documented vocabulary may appear.
            assert token.startswith("call_…") or token in {
                "call_id",
                "call_task",
                "call_completed",
                "call_failed",
                "call_dMU",
            }, token


def test_the_public_receipt_exists_and_agrees_on_decisive_values():
    assert PUBLIC_RECEIPT.exists()
    public = json.loads(PUBLIC_RECEIPT.read_text(encoding="utf-8"))
    data = fixture()
    assert public["call_id"] == MASKED_CALL_ID
    assert public["claim_status"] == "UNKNOWN"
    assert public["terminal_state"] == "INFORMATION_OBTAINED"
    assert public["transport_state"] == "completed"
    assert public["ledger_state"] == "COMPLETED"
    assert public["write_back"] == "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW"
    assert public["missing_requirement"] == ["installation photograph"]
    assert public["reference"]["display"] == data["outcome"]["reference"]["display"]
    assert public["reference"]["method"] == "DIRECT_COUNTERPARTY_QUOTE"
    assert public["limitation"] == LIMITATION
    quotes = [item["quote"] for item in public["evidence"]]
    assert EXACT_QUOTE in quotes  # verbatim, never polished


def test_the_public_receipt_is_sanitized():
    public = json.loads(PUBLIC_RECEIPT.read_text(encoding="utf-8"))
    assert "recipient" not in public
    text = PUBLIC_RECEIPT.read_text(encoding="utf-8")
    assert COMPLETE_NUMBER.search(text) is None
    assert "+91" not in text
    for forbidden in ("CALLE_API_KEY", "/private/tmp", "api.heycall-e.com", "secret"):
        assert forbidden not in text, forbidden


def test_the_receipt_reference_is_an_offline_relative_link():
    body = page()
    assert 'href="runtime-proof-receipt.public.json"' in body
    assert "http://" not in body and "https://" not in body


def test_no_secret_private_path_or_adoption_claim_exists():
    body = page()
    for forbidden in (
        "CALLE_API_KEY",
        "/private/tmp",
        "api.heycall-e.com",
        "production deployment",
        "customer validation",
        "measured business impact",
        "recovery rate",
        "ROI",
    ):
        assert forbidden not in body, forbidden


def test_the_page_cannot_reach_a_network_or_start_a_call():
    body = page()
    for forbidden in (
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "<form",
        "place_call",
        "calls.create",
        "http://",
        "https://",
        "<img",
        "<iframe",
        "src=",
    ):
        assert forbidden not in body, forbidden


def test_the_page_is_self_contained_offline_html():
    body = page()
    assert body.startswith("<!doctype html>")
    assert '<html lang="en">' in body
    assert 'role="status"' in body and "aria-live" in body
    assert "prefers-reduced-motion" in body
    assert "@media (max-width:900px)" in body


# --- visible interaction (a label must render, not merely exist as data) -----


def visible_html() -> str:
    """The page with the embedded reveal JSON removed.

    Anything asserted here must therefore be present in markup or script,
    not hidden inside the data blob.
    """

    body = page()
    marker = '<script type="application/json" id="reveal-data">'
    start = body.index(marker)
    end = body.index("</script>", start) + len("</script>")
    return body[:start] + body[end:]


def test_every_javascript_element_reference_exists_in_the_html():
    body = page()
    referenced = set(re.findall(r'getElementById\("([A-Za-z0-9_-]+)"\)', body))
    referenced |= set(
        re.findall(r'querySelector\("#([A-Za-z0-9_-]+)"\)', body)
    )
    assert referenced, "the scan itself must find references"
    for element_id in referenced:
        assert f'id="{element_id}"' in body, element_id


def test_the_stale_receipt_line_lookup_is_gone():
    assert "receipt-line" not in page()


def test_essential_labels_are_server_rendered_outside_the_embedded_json():
    markup = visible_html()
    assert ">Reveal recorded result</button>" in markup
    assert "Fictional case data" in markup
    assert "Recorded CALL-E result" in markup
    assert MASKED_CALL_ID in markup
    assert EXACT_QUOTE in markup


def test_the_locked_result_is_server_rendered_inside_the_hidden_block():
    body = page()
    start = body.index('<div id="after-result" hidden>')
    end = body.index("</section>", start)
    hidden = body[start:end]
    for value in (
        EXACT_QUOTE,
        "BR-4821",
        "Installation photograph",
        "INFORMATION_OBTAINED",
        "not provided on the call → UNKNOWN",
    ):
        assert value in hidden, value


def test_the_reveal_script_reads_only_the_payload_and_own_elements():
    body = page()
    script = body[body.index("<script>\n(function") :]
    assert 'getElementById("reveal-data")' in script
    # Everything the handler touches exists server-rendered; no label is
    # initialized from script, and visibility toggles are all it performs.
    for element_id in ("after-locked", "after-result", "after-card", "announcer"):
        assert f'getElementById("{element_id}")' in script, element_id
    assert "hidden = true" in script
    assert "hidden = false" in script
    assert "place_call" not in script and "fetch" not in script
