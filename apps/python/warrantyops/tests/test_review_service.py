"""The loopback review service: CSRF, origin, jail, journal — and no CORS.

These tests run the real HTTP service on 127.0.0.1 with real sockets,
because the properties they pin live at the HTTP boundary: the double-submit
cookie, the origin check, the 16 KB body cap, the jailed transcript, and the
hash-chained decision journal. Everything fails closed.
"""

from __future__ import annotations

import http.client
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import pytest

from warrantyops.review import ReviewPacket
from warrantyops.review_screen import build_live_model
from warrantyops.review_service import (
    MAX_BODY_BYTES,
    DecisionResult,
    ReviewService,
    make_server,
)

FIXED_NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def packet(review_id: str = "ab12cd34ef56") -> ReviewPacket:
    return ReviewPacket(
        review_id=review_id,
        terminal_state="INFORMATION_OBTAINED",
        transport_state="completed",
        recipient_masked="+1 ••• ••• 0142",
        business={
            "claim_status": "UNKNOWN",
            "required_correction": "send the installation photograph",
            "required_documents": ["installation photograph"],
            "confirmed_reference": {"value": "BR-4821", "kind": "CASE"},
            "evidence": (
                {"field": "required_documents", "quote": "It requires an installation photograph."},
                {"field": "confirmed_reference", "quote": "Correct, case BR-4821.",
                 "method": "DIRECT_COUNTERPARTY_QUOTE"},
            ),
        },
        identifier={"state": "CONFIRMED_IDENTIFIER"},
        packet_sha256="9f86d081884c7d65",
    )


def model_for(target: ReviewPacket):
    return build_live_model(
        target,
        claim_id="W-1042",
        organization="NorthStar Equipment",
        counterparty="claims desk (synthetic)",
        amount_display="$800",
        situation="Residual exception — documentation incomplete",
    )


class App:
    """One registered review served on a real loopback socket."""

    def __init__(self, tmp_path: Path) -> None:
        self.service = ReviewService(
            operator_id="maya",
            private_root=tmp_path,
            secret=b"unit-test-secret",
            now=lambda: FIXED_NOW,
        )
        self.packet = packet()
        self.writer_results: list[DecisionResult] = []
        self.writer_calls: list[str] = []

        def writer(decision) -> DecisionResult:
            self.writer_calls.append(decision.value)
            return self.writer_results.pop(0)

        self.writer = writer
        self.transcript_path = tmp_path / f"{self.packet.review_id}.txt"
        self.transcript_path.write_text("bot: private transcript\n", encoding="utf-8")
        self.service.register(
            self.packet,
            model=model_for(self.packet),
            transcript_path=self.transcript_path,
            decide=writer,
        )
        self.server = make_server(self.service, host="127.0.0.1", port=0)
        self.host = "127.0.0.1"
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    # -- HTTP helpers --------------------------------------------------------

    def request(self, method: str, path: str, *, form=None, headers=None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=5)
        body = None
        send_headers = dict(headers or {})
        if form is not None:
            body = urlencode(form)
            send_headers["Content-Type"] = "application/x-www-form-urlencoded"
        conn.request(method, path, body=body, headers=send_headers)
        response = conn.getresponse()
        payload = response.read().decode("utf-8")
        head = {name.lower(): value for name, value in response.getheaders()}
        status = response.status
        conn.close()
        return status, head, payload

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post_decision(self, *, token: str, packet_hash: str | None = None,
                      decision: str = "APPROVE", cookie: str | None = None,
                      origin: str | None = None, referer: str | None = None):
        headers = {"Cookie": f"wops_csrf={cookie}"} if cookie is not None else {}
        if origin:
            headers["Origin"] = origin
        if referer:
            headers["Referer"] = referer
        return self.request(
            "POST",
            f"/review/{self.packet.review_id}/decision",
            form={
                "csrf_token": token,
                "packet_sha256": packet_hash
                if packet_hash is not None
                else self.packet.packet_sha256,
                "decision": decision,
            },
            headers=headers,
        )

    def csrf(self) -> str:
        return self.service.csrf_token(self.packet.review_id)


@pytest.fixture()
def app(tmp_path):
    application = App(tmp_path)
    yield application
    application.close()


# --- bind and route surface ------------------------------------------------------


def test_make_server_refuses_every_non_loopback_host():
    service = ReviewService(operator_id="maya")
    for host in ("0.0.0.0", "192.168.1.5", "10.0.0.1", "example.com"):
        with pytest.raises(ValueError, match="loopback-only"):
            make_server(service, host=host)


def test_an_unknown_review_id_is_a_404(app):
    status, _head, body = app.get("/review/deadbeef0000")
    assert status == 404
    assert "unknown review id" in body


def test_anything_else_is_a_404(app):
    assert app.get("/")[0] == 404
    assert app.get("/admin")[0] == 404
    assert app.get("/review/")[0] == 404


def test_unimplemented_methods_are_refused(app):
    status, _head, _body = app.request("PUT", f"/review/{app.packet.review_id}/decision")
    assert status == 501


# --- the page and its cookie -------------------------------------------------------


def test_the_review_page_sets_the_httponly_csrf_cookie(app):
    status, head, body = app.get(f"/review/{app.packet.review_id}")
    assert status == 200
    cookie = head["set-cookie"]
    assert cookie.startswith(f"wops_csrf={app.csrf()};")
    assert "HttpOnly" in cookie
    assert "SameSite=Strict" in cookie
    assert 'action="/review/ab12cd34ef56/decision"' in body
    assert 'value="APPROVE"' in body


def test_every_response_carries_no_store_and_nosniff(app):
    for status, head, _body in (
        app.get(f"/review/{app.packet.review_id}"),
        app.get("/review/none"),
    ):
        assert status in (200, 404)
        assert head["cache-control"] == "no-store"
        assert head["x-content-type-options"] == "nosniff"


def test_no_response_ever_carries_a_cors_header(app):
    for _status, head, _body in (
        app.get(f"/review/{app.packet.review_id}"),
        app.get(f"/transcript/{app.packet.review_id}"),
        app.get("/review/none"),
    ):
        for name in head:
            assert not name.startswith("access-control-"), name


# --- the decision POST: fail closed ---------------------------------------------------


def test_a_post_without_the_csrf_pair_is_403_and_records_nothing(app):
    token = app.csrf()
    for kwargs in (
        {"token": token},  # no cookie at all
        {"token": token, "cookie": "not-the-token"},  # wrong cookie
        {"token": "not-the-token", "cookie": token},  # wrong form token
        {"token": "", "cookie": token},  # empty form token
    ):
        status, _head, body = app.post_decision(**kwargs)
        assert status == 403, kwargs
        assert "CSRF check failed" in body
    assert app.writer_calls == []
    assert app.service.journal.entries() == ()


def test_a_cross_origin_post_is_403(app):
    token = app.csrf()
    for headers in ({"origin": "http://evil.example"}, {"referer": "https://evil.example/x"}):
        status, _head, body = app.post_decision(token=token, cookie=token, **headers)
        assert status == 403
        assert "cross-origin" in body
    assert app.service.journal.entries() == ()


def test_a_same_origin_post_passes_the_origin_check(app):
    app.writer_results.append(
        DecisionResult(write_back="NOTE_WRITTEN", note_id="note-7")
    )
    token = app.csrf()
    status, _head, body = app.post_decision(
        token=token,
        cookie=token,
        origin=f"http://{app.host}:{app.port}",
        referer=f"http://{app.host}:{app.port}/review/{app.packet.review_id}",
    )
    assert status == 200
    assert "note-7" in body


def test_a_stale_or_empty_packet_hash_is_403(app):
    token = app.csrf()
    for bad_hash in ("", "0" * 16, app.packet.packet_sha256.upper()):
        status, _head, body = app.post_decision(token=token, cookie=token, packet_hash=bad_hash)
        assert status == 403, bad_hash
        assert "PACKET_HASH_MISMATCH" in body
    assert app.writer_calls == []
    assert app.service.journal.entries() == ()


def test_an_unknown_decision_value_is_403(app):
    token = app.csrf()
    status, _head, body = app.post_decision(
        token=token, cookie=token, decision="APPROVE_AND_REMBEMBER"
    )
    assert status == 403
    assert "UNKNOWN_DECISION" in body
    assert app.service.journal.entries() == ()


def test_a_missing_or_oversized_body_is_400(app):
    token = app.csrf()
    status, _head, body = app.post_decision(
        token="x" * (MAX_BODY_BYTES + 1), cookie=token
    )
    assert status == 400
    assert "oversized" in body
    assert app.service.journal.entries() == ()


def test_every_refusal_page_says_nothing_was_written(app):
    token = app.csrf()
    _status, _head, body = app.post_decision(token="wrong", cookie=token)
    assert "Nothing was written." in body


# --- the decision POST: the happy paths --------------------------------------------


def test_approve_runs_the_registered_writer_once_and_shows_the_receipt(app):
    app.writer_results.append(
        DecisionResult(write_back="NOTE_WRITTEN", note_id="note-7")
    )
    token = app.csrf()
    status, _head, body = app.post_decision(token=token, cookie=token)
    assert status == 200
    assert app.writer_calls == ["APPROVE"]
    assert "Approved" in body and "operator maya" in body
    assert "note-7" in body
    assert "journal head" in body


def test_a_replayed_approve_shows_the_same_note_and_says_replay(app):
    app.writer_results += [
        DecisionResult(write_back="NOTE_WRITTEN", note_id="note-7"),
        DecisionResult(
            write_back="NOTE_REPLAYED_IDEMPOTENT", note_id="note-7", replayed=True
        ),
    ]
    token = app.csrf()
    first = app.post_decision(token=token, cookie=token)
    second = app.post_decision(token=token, cookie=token)
    assert first[0] == second[0] == 200
    assert app.writer_calls == ["APPROVE", "APPROVE"]
    assert "idempotent replay" in second[2]
    assert "note-7" in second[2]


def test_refuse_and_return_record_a_safe_non_write_without_dialing_the_writer(app):
    token = app.csrf()
    for decision in ("REFUSE", "RETURN_TO_DIGITAL"):
        status, _head, body = app.post_decision(
            token=token, cookie=token, decision=decision
        )
        assert status == 200, decision
        assert "SAFE_NON_WRITE" in body
    assert app.writer_calls == []  # only APPROVE can ever reach the writer
    assert [entry.decision for entry in app.service.journal.entries()] == [
        "REFUSE",
        "RETURN_TO_DIGITAL",
    ]


def test_an_approve_without_a_registered_writer_refuses(app):
    app.service.register(packet("ff0099aa11bb"), model=model_for(packet("ff0099aa11bb")))
    token = app.service.csrf_token("ff0099aa11bb")
    status, _head, body = app.request(
        "POST",
        "/review/ff0099aa11bb/decision",
        form={
            "csrf_token": token,
            "packet_sha256": "9f86d081884c7d65",
            "decision": "APPROVE",
        },
        headers={"Cookie": f"wops_csrf={token}"},
    )
    assert status == 403
    assert "NO_WRITER_REGISTERED" in body


def test_an_empty_operator_refuses_before_any_writer_runs(tmp_path):
    service = ReviewService(operator_id="   ", private_root=tmp_path)
    target = packet("ff0099aa11bb")
    service.register(target, model=model_for(target))
    state, refusal = service.decide(
        "ff0099aa11bb", "APPROVE", packet_sha256=target.packet_sha256
    )
    assert state is None
    assert refusal == "OPERATOR_MISSING"


# --- the jailed transcript -----------------------------------------------------------


def test_the_transcript_is_served_for_its_own_id_only(app):
    status, head, body = app.get(f"/transcript/{app.packet.review_id}")
    assert status == 200
    assert head["content-type"].startswith("text/plain")
    assert "private transcript" in body


def test_a_traversal_shaped_id_matches_no_registration(app):
    for path in (
        "/transcript/..%2f..%2fetc%2fpasswd",
        "/transcript/..",
        "/transcript/.",
        "/review/..%2f..%2fetc%2fpasswd",
    ):
        status, _head, _body = app.get(path)
        assert status == 404, path


def test_registering_a_transcript_outside_the_private_root_refuses(tmp_path):
    service = ReviewService(operator_id="maya", private_root=tmp_path)
    outside = tmp_path.parent / f"{tmp_path.name}-outside" / "t.txt"
    outside.parent.mkdir(exist_ok=True)
    outside.write_text("x", encoding="utf-8")
    target = packet("ff0099aa11bb")
    with pytest.raises(ValueError, match="escapes the private root"):
        service.register(target, model=model_for(target), transcript_path=outside)
    assert service.transcript("ff0099aa11bb") is None


# --- the decision journal ------------------------------------------------------------


def test_the_journal_chains_entries_by_hash(tmp_path):
    service = ReviewService(
        operator_id="maya",
        private_root=tmp_path,
        now=lambda: FIXED_NOW,
    )
    first = packet("aaaaaaaa0001")
    second = packet("aaaaaaaa0002")
    for target in (first, second):
        service.register(target, model=model_for(target))
    service.decide("aaaaaaaa0001", "REFUSE", packet_sha256=first.packet_sha256)
    service.decide("aaaaaaaa0002", "RETURN_TO_DIGITAL", packet_sha256=second.packet_sha256)
    entries = service.journal.entries()
    assert len(entries) == 2
    assert entries[0].prior_hash == ""
    assert entries[1].prior_hash == entries[0].entry_hash
    assert service.journal.head() == entries[1].entry_hash
    assert entries[0].operator_id == "maya"
    assert entries[0].write_back == "SAFE_NON_WRITE"
    assert entries[0].decided_at == "2026-09-01T12:00:00Z"


def test_a_refused_post_appends_nothing_to_the_journal(app):
    token = app.csrf()
    app.post_decision(token="wrong", cookie=token)
    app.post_decision(token=token, cookie=token, packet_hash="stale")
    assert app.service.journal.entries() == ()
    assert app.service.journal.head() == ""
