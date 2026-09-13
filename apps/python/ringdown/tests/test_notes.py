from __future__ import annotations

import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from ringdown.audit import DETAIL_LIMIT, append_record, chain_checks, notified_record
from ringdown.calle import UntrustedHost, assert_trusted_url
from ringdown.escalate import LadderResult
from ringdown.exits import EXIT_ACKNOWLEDGED, EXIT_UNKNOWN, EXIT_UNRESOLVED, EXIT_UNVERIFIED
from ringdown.notes import VENDORS, note_text, post_note
from tests.data import ALICE, EXTRACTION, an_attempt

PAGERDUTY, OPSGENIE = VENDORS["pagerduty"], VENDORS["opsgenie"]
REFUSAL = {"error": {"message": "Requester User Not Found"}}

RECEIVED: list[dict] = []


class _Notes(BaseHTTPRequestHandler):
    status = 200
    envelope = REFUSAL

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        RECEIVED.append(
            {
                "path": self.path,
                "headers": dict(self.headers),
                "body": json.loads(body or b"{}"),
            }
        )
        self.send_response(type(self).status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(type(self).envelope).encode())

    def log_message(self, *_) -> None:
        return


@pytest.fixture
def notes():
    RECEIVED.clear()
    _Notes.status = 200
    _Notes.envelope = REFUSAL
    server = HTTPServer(("127.0.0.1", 0), _Notes)
    threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True
    ).start()
    yield server, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def a_result(verdict="acknowledged", **overrides) -> LadderResult:
    fields = {"verdict": "acknowledged", "reason": ""}
    return LadderResult(verdict, (an_attempt(**{**fields, **overrides}),))


def test_the_note_quotes_what_the_recipient_said_and_names_the_ledger_head():
    text = note_text(a_result(), EXIT_ACKNOWLEDGED, 8, "sha256:1ebde0bc")

    assert 'Heard: "yes, this is alice"' in text
    assert 'Heard: "yes, i am taking this incident right now"' in text
    assert "Stated ETA: 15 minutes." in text
    assert "Ledger at the verdict: 8 records, head sha256:1ebde0bc" in text


def test_the_note_masks_the_phone_number_it_reports():
    text = note_text(a_result(), EXIT_ACKNOWLEDGED, 8, "sha256:1ebde0bc")

    assert ALICE.phone not in text
    assert "+1********00" in text


def test_the_note_says_it_changes_no_incident_state():
    assert "changes no incident state" in note_text(a_result(), EXIT_ACKNOWLEDGED, 8, "sha256:aaa")


def test_the_note_carries_the_injection_flag_when_one_was_recorded():
    text = note_text(a_result(instructed=True), EXIT_ACKNOWLEDGED, 8, "sha256:aaa")

    assert "not followed" in text


def test_a_ladder_that_placed_no_call_still_renders_a_note():
    assert "no call" in note_text(LadderResult("unknown", ()), EXIT_ACKNOWLEDGED, 0, "sha256:aaa")


def test_the_note_is_posted_where_pagerduty_documents_it(notes):
    _, url = notes

    assert post_note(PAGERDUTY, url, "tok", "ops@example.com", "PBAZLIU", "hello").delivered

    sent = RECEIVED[0]
    assert sent["path"] == "/incidents/PBAZLIU/notes"
    assert sent["body"] == {"note": {"content": "hello"}}
    assert sent["headers"]["Authorization"] == "Token token=tok"
    assert sent["headers"]["From"] == "ops@example.com"
    assert sent["headers"]["Accept"] == "application/vnd.pagerduty+json;version=2"
    assert sent["headers"]["Content-Type"] == "application/json"


def test_the_note_is_posted_where_opsgenie_documents_it(notes):
    _Notes.status = 202
    _, url = notes

    assert post_note(OPSGENIE, url, "key", "", "a1b2", "hello").delivered

    sent = RECEIVED[0]
    assert sent["path"] == "/v2/alerts/a1b2/notes?identifierType=id"
    assert sent["body"] == {"note": "hello", "source": "Ringdown"}
    assert sent["headers"]["Authorization"] == "GenieKey key"
    assert "From" not in sent["headers"]
    assert "Accept" not in sent["headers"]


def test_the_same_words_go_to_both_vendors():
    text = note_text(a_result(), EXIT_ACKNOWLEDGED, 8, "sha256:1ebde0bc")

    assert PAGERDUTY.body(text) == {"note": {"content": text}}
    assert OPSGENIE.body(text) == {"note": text, "source": "Ringdown"}


def test_an_opsgenie_error_reports_the_message_it_puts_at_the_root(notes):
    _, url = notes
    _Notes.status = 422
    _Notes.envelope = {"message": "Alert not found", "took": 0.1}

    written = post_note(OPSGENIE, url, "key", "", "a1b2", "hello")

    assert not written.delivered
    assert written.detail == "http 422 Alert not found"


def test_an_identifier_from_an_alert_payload_cannot_reshape_the_path(notes):
    _, url = notes

    post_note(OPSGENIE, url, "key", "", "../../v2/alerts/other", "hello")

    assert RECEIVED[0]["path"] == "/v2/alerts/..%2F..%2Fv2%2Falerts%2Fother/notes?identifierType=id"


def test_a_refused_note_is_reported_without_raising(notes):
    _Notes.status = 403

    written = post_note(PAGERDUTY, notes[1], "tok", "nobody@example.com", "PBAZLIU", "hello")

    assert not written.delivered
    assert "403" in written.detail
    assert "Requester User Not Found" in written.detail


@pytest.mark.parametrize("vendor", VENDORS.values(), ids=list(VENDORS))
def test_a_lookalike_host_never_receives_the_token(vendor):
    RECEIVED.clear()

    with pytest.raises(UntrustedHost):
        post_note(vendor, f"{vendor.live[0]}.evil.test", "tok", "ops@example.com", "P1", "hi")

    assert not RECEIVED


def test_the_credential_of_one_vendor_is_never_sent_to_the_other():
    RECEIVED.clear()

    for vendor, other in ((PAGERDUTY, OPSGENIE), (OPSGENIE, PAGERDUTY)):
        with pytest.raises(UntrustedHost):
            post_note(vendor, other.live[0], "tok", "ops@example.com", "P1", "hi")

    assert not RECEIVED


@pytest.mark.parametrize(
    "vendor,live",
    [(vendor, live) for vendor in VENDORS.values() for live in vendor.live],
)
def test_both_documented_regions_of_each_vendor_are_trusted(vendor, live):
    assert assert_trusted_url(live, vendor.live) == live


def test_a_provider_error_too_long_for_the_ledger_is_cut_by_whoever_produces_it(notes):
    _, url = notes
    _Notes.status = 400
    _Notes.envelope = {
        "error": {"message": "The From header is not a valid PagerDuty user: " + "x" * 178}
    }

    written = post_note(PAGERDUTY, url, "tok", "ops@example.com", "PBAZLIU", "hello")

    assert not written.delivered
    assert len(written.detail) == DETAIL_LIMIT
    record = notified_record("PBAZLIU", host="api.pagerduty.com", delivered=False, detail=written.detail)
    assert record["detail"].startswith("http 400 The From header")


def test_a_server_that_never_answers_is_reported_as_a_transport_failure(notes):
    server, url = notes
    server.shutdown()

    written = post_note(PAGERDUTY, url, "tok", "ops@example.com", "PBAZLIU", "hello", timeout=0.2)

    assert not written.delivered
    assert "transport failure" in written.detail


def test_the_note_names_the_reason_a_page_was_not_acknowledged():
    text = note_text(
        LadderResult("unacknowledged", (an_attempt(verdict="not_acknowledged", reason="voicemail"),)),
        20,
        4,
        "sha256:aaa",
    )

    assert "did not acknowledge the page" in text
    assert "Reason recorded: voicemail." in text


def test_an_attempt_without_an_extraction_still_renders():
    bare = replace(an_attempt(), verdict="unknown", call_id=None, snapshot=None, extraction=None)

    assert "Ringdown called" in note_text(
        LadderResult("unknown", (bare,)), EXIT_UNKNOWN, 1, "sha256:aaa"
    )


def test_a_contradicted_run_never_reports_a_clean_acknowledgement():
    text = note_text(a_result(), EXIT_UNVERIFIED, 8, "sha256:aaa")

    assert "not trustworthy" in text
    assert "unowned" in text
    assert "exited 40" in text


def test_a_run_nobody_corroborated_says_so():
    text = note_text(a_result(), EXIT_UNRESOLVED, 8, "sha256:aaa")

    assert "could not corroborate" in text
    assert "exited 45" in text


def test_a_delivered_note_leaves_the_ledger_verifying_clean(tmp_path):
    ledger = tmp_path / "l.jsonl"
    append_record(ledger, notified_record("inc-1", host="api.pagerduty.com", delivered=True, detail="http 200"))

    assert all(ok for ok, _ in chain_checks(ledger))


def test_a_note_that_never_arrived_is_visible_to_whoever_audits_the_ledger(tmp_path):
    ledger = tmp_path / "l.jsonl"
    append_record(ledger, notified_record("inc-1", host="api.pagerduty.com", delivered=False, detail="http 403"))

    assert [label for ok, label in chain_checks(ledger) if ok is None and "not delivered" in label]


def test_a_providers_error_text_cannot_smuggle_newlines_into_the_ledger(tmp_path):
    ledger = tmp_path / "l.jsonl"
    append_record(
        ledger,
        notified_record("inc-1", host="h", delivered=False, detail="http 400\nfake: injected line"),
    )

    written = json.loads(ledger.read_text().splitlines()[0])
    assert "\n" not in written["detail"]
