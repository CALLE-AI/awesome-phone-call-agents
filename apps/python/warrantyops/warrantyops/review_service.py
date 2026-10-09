"""The loopback-only local review service: render, decide, never dial.

P2/F12 (locked): the review surface is an HTTP service bound to loopback
only. It serves one registered review packet per ``review_id``: the page a
human reads, the jailed private transcript behind a local-only link, and
the three decisions — Approve, Refuse, Return to digital — behind a CSRF
check (double-submit cookie plus form token plus an origin check when the
browser sends one). It emits no CORS header of any kind, answers no method
beyond GET and POST, and holds no capability to place a call: writing is
delegated to the ``decide`` callback registered with the packet, which is
the kernel's own write-back path with its source recheck and idempotency.

Every decision is appended to a small hash-chained decision journal
(F11/P1): reviewer principal, timestamp, packet hash, decision, outcome.
The chain head appears in the decision receipt the operator sees.

The transcript link is jailed by construction: the URL carries only a
``review_id``, never a path, and the service maps that id to the exact file
the operator registered — after checking the file lives inside the
designated private root. A traversal-shaped id matches no registration and
is a 404.
"""

from __future__ import annotations

import getpass
import hashlib
import hmac
import html
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlparse

from .review import ReviewDecision, ReviewPacket, ReviewRefusal
from .review_screen import (
    DecisionState,
    ReviewScreenModel,
    build_live_model,
    render_review_screen,
)

__all__ = [
    "DecisionJournal",
    "DecisionResult",
    "Registration",
    "ReviewService",
    "make_server",
]

#: The only hosts the service may bind. Loopback or nothing.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

#: Requests larger than this are refused without reading further.
MAX_BODY_BYTES = 16 * 1024


@dataclass
class DecisionResult:
    """What the kernel's write path said about one decision."""

    write_back: str
    note_id: str = ""
    replayed: bool = False
    refusal: str = ""


@dataclass
class Registration:
    """One registered review: its page model, transcript, and writer."""

    packet: ReviewPacket
    model: ReviewScreenModel
    transcript_path: Optional[Path] = None
    decide: Optional[Callable[[ReviewDecision], DecisionResult]] = None


@dataclass
class JournalEntry:
    """One appended decision record (F11/P1: principal, time, hash)."""

    sequence: int
    review_id: str
    decision: str
    operator_id: str
    decided_at: str
    packet_sha256: str
    write_back: str
    prior_hash: str
    entry_hash: str


class DecisionJournal:
    """A hash-chained, append-only record of review decisions."""

    def __init__(self) -> None:
        self._entries: list[JournalEntry] = []

    def append(
        self,
        *,
        review_id: str,
        decision: str,
        operator_id: str,
        decided_at: str,
        packet_sha256: str,
        write_back: str,
    ) -> JournalEntry:
        prior = self._entries[-1].entry_hash if self._entries else ""
        body = json.dumps(
            {
                "review_id": review_id,
                "decision": decision,
                "operator_id": operator_id,
                "decided_at": decided_at,
                "packet_sha256": packet_sha256,
                "write_back": write_back,
                "prior_hash": prior,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        entry = JournalEntry(
            sequence=len(self._entries),
            review_id=review_id,
            decision=decision,
            operator_id=operator_id,
            decided_at=decided_at,
            packet_sha256=packet_sha256,
            write_back=write_back,
            prior_hash=prior,
            entry_hash=hashlib.sha256(body.encode("utf-8")).hexdigest(),
        )
        self._entries.append(entry)
        return entry

    def entries(self) -> tuple[JournalEntry, ...]:
        return tuple(self._entries)

    def head(self) -> str:
        return self._entries[-1].entry_hash if self._entries else ""


class ReviewService:
    """The state behind the loopback service. No network code lives here."""

    def __init__(
        self,
        *,
        operator_id: str,
        private_root: Optional[Path] = None,
        secret: Optional[bytes] = None,
        now: Optional[Callable[[], datetime]] = None,
    ) -> None:
        self.operator_id = operator_id
        self.private_root = private_root
        self._secret = secret if secret is not None else secrets.token_bytes(32)
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._registrations: dict[str, Registration] = {}
        self.journal = DecisionJournal()

    # --- registration -------------------------------------------------------

    def register(
        self,
        packet: ReviewPacket,
        *,
        model: ReviewScreenModel,
        transcript_path: Optional[Path] = None,
        decide: Optional[Callable[[ReviewDecision], DecisionResult]] = None,
    ) -> str:
        """Register one review. Returns its review_id (idempotent)."""

        if transcript_path is not None and self.private_root is not None:
            root = self.private_root.resolve()
            resolved = transcript_path.resolve()
            if root != resolved and root not in resolved.parents:
                raise ValueError(
                    "transcript path escapes the private root; refusing to jail it"
                )
        self._registrations.setdefault(packet.review_id, Registration(
            packet=packet, model=model, transcript_path=transcript_path, decide=decide
        ))
        return packet.review_id

    def registration(self, review_id: str) -> Optional[Registration]:
        return self._registrations.get(review_id)

    # --- CSRF ----------------------------------------------------------------

    def csrf_token(self, review_id: str) -> str:
        """A per-review token derived from the server secret."""

        return hmac.new(
            self._secret, f"csrf:{review_id}".encode(), hashlib.sha256
        ).hexdigest()

    def csrf_valid(self, review_id: str, cookie: str, form: str) -> bool:
        expected = self.csrf_token(review_id)
        return (
            hmac.compare_digest(cookie, expected)
            and hmac.compare_digest(form, expected)
        )

    # --- pages ---------------------------------------------------------------

    def render_page(self, review_id: str) -> Optional[str]:
        """The live review page, or None when the id is unknown."""

        registration = self._registrations.get(review_id)
        if registration is None:
            return None
        model = build_live_model(
            registration.packet,
            claim_id=registration.model.claim_id,
            organization=registration.model.organization,
            counterparty=registration.model.counterparty,
            amount_display=registration.model.amount_display,
            situation=registration.model.situation,
            administrator=registration.model.administrator,
            routes_exhausted=registration.model.routes_exhausted,
            economics=registration.model.economics,
            before_lines=registration.model.before_lines,
            after_lines=registration.model.after_lines,
            controls=registration.model.controls,
            runtime_limitation=registration.model.runtime_limitation,
            receipt_link=registration.model.receipt_link,
            person_indicator=_person_indicator(registration.model),
            transcript_path=f"/transcript/{review_id}",
            transcript_available=registration.transcript_path is not None,
            csrf_token=self.csrf_token(review_id),
            runtime_marker=registration.model.runtime_marker,
        )
        return render_review_screen(model)

    def render_decision_page(
        self, review_id: str, decision: DecisionState
    ) -> Optional[str]:
        registration = self._registrations.get(review_id)
        if registration is None:
            return None
        model = build_live_model(
            registration.packet,
            claim_id=registration.model.claim_id,
            organization=registration.model.organization,
            counterparty=registration.model.counterparty,
            amount_display=registration.model.amount_display,
            situation=registration.model.situation,
            administrator=registration.model.administrator,
            routes_exhausted=registration.model.routes_exhausted,
            economics=registration.model.economics,
            before_lines=registration.model.before_lines,
            after_lines=registration.model.after_lines,
            controls=registration.model.controls,
            runtime_limitation=registration.model.runtime_limitation,
            receipt_link=registration.model.receipt_link,
            person_indicator=_person_indicator(registration.model),
            transcript_path=f"/transcript/{review_id}",
            transcript_available=registration.transcript_path is not None,
            runtime_marker=registration.model.runtime_marker,
            decision=decision,
        )
        return render_review_screen(model)

    # --- decisions -----------------------------------------------------------

    def decide(
        self,
        review_id: str,
        decision_text: str,
        *,
        packet_sha256: str,
    ) -> tuple[Optional[DecisionState], str]:
        """Record one decision and run the registered writer when approving.

        Returns ``(decision_state, refusal)``. ``refusal`` is empty when the
        decision was recorded; otherwise it names why the POST failed closed
        and the decision was *not* recorded.
        """

        registration = self._registrations.get(review_id)
        if registration is None:
            return None, "UNKNOWN_REVIEW"
        try:
            decision = ReviewDecision(decision_text)
        except ValueError:
            return None, "UNKNOWN_DECISION"
        if not packet_sha256 or packet_sha256 != registration.packet.packet_sha256:
            # A stale approval is not an approval (P2: fail closed).
            return None, ReviewRefusal.PACKET_HASH_MISMATCH.value
        if not self.operator_id.strip():
            # A decision that names no principal cannot be audited (F11/P1).
            return None, ReviewRefusal.OPERATOR_MISSING.value

        moment = self._now()
        decided_at = moment.strftime("%Y-%m-%dT%H:%M:%SZ")
        if decision is ReviewDecision.APPROVE:
            if registration.decide is None:
                return None, "NO_WRITER_REGISTERED"
            result = registration.decide(decision)
            state = DecisionState(
                mode=decision.value,
                operator_id=self.operator_id,
                decided_at=decided_at,
                write_back=result.write_back,
                note_id=result.note_id,
                replayed=result.replayed,
                refusal=result.refusal,
            )
            journal_write_back = result.write_back
        else:
            state = DecisionState(
                mode=decision.value,
                operator_id=self.operator_id,
                decided_at=decided_at,
                write_back="SAFE_NON_WRITE",
            )
            journal_write_back = "SAFE_NON_WRITE"
        entry = self.journal.append(
            review_id=review_id,
            decision=decision.value,
            operator_id=self.operator_id,
            decided_at=decided_at,
            packet_sha256=registration.packet.packet_sha256,
            write_back=journal_write_back,
        )
        state = replace(
            state, write_back=f"{state.write_back} · journal head {entry.entry_hash[:16]}…"
        )
        return state, ""

    # --- transcript ----------------------------------------------------------

    def transcript(self, review_id: str) -> Optional[str]:
        """The jailed transcript body for a registered review, or None."""

        registration = self._registrations.get(review_id)
        if registration is None or registration.transcript_path is None:
            return None
        try:
            return registration.transcript_path.read_text(encoding="utf-8")
        except OSError:
            return None


def _person_indicator(model: ReviewScreenModel) -> str:
    if model.person_row is not None:
        return model.person_row.value
    return ""


def _refusal_page(reason: str) -> bytes:
    body = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<title>WarrantyOps — refused</title></head>"
        "<body><h1>Refused</h1>"
        f"<p>The review action failed closed: {html.escape(reason, quote=True)}.</p>"
        "<p>Nothing was written.</p></body></html>\n"
    )
    return body.encode("utf-8")


def make_server(
    service: ReviewService,
    *,
    host: str = "127.0.0.1",
    port: int = 0,
) -> ThreadingHTTPServer:
    """Bind the loopback-only HTTP service. Refuses any other host."""

    if host not in LOOPBACK_HOSTS:
        raise ValueError(
            f"refusing to bind {host!r}: the review service is loopback-only"
        )

    class Handler(BaseHTTPRequestHandler):
        # Quiet the default stderr logging; the journal is the record.
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

        def _send(
            self,
            code: int,
            body: bytes,
            content_type: str,
            *,
            set_csrf: Optional[str] = None,
        ) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if set_csrf is not None:
                # HttpOnly keeps the cookie out of page script; the form
                # carries the same token for the double-submit check.
                self.send_header(
                    "Set-Cookie",
                    f"wops_csrf={set_csrf}; HttpOnly; SameSite=Strict",
                )
            self.end_headers()
            self.wfile.write(body)

        def _page(self, page: Optional[str], review_id: str) -> None:
            if page is None:
                self._send(
                    404,
                    _refusal_page("unknown review id"),
                    "text/html; charset=utf-8",
                )
                return
            self._send(
                200,
                page.encode("utf-8"),
                "text/html; charset=utf-8",
                set_csrf=service.csrf_token(review_id),
            )

        def _cookie_token(self) -> str:
            header = self.headers.get("Cookie", "")
            for part in header.split(";"):
                name, _, value = part.strip().partition("=")
                if name == "wops_csrf":
                    return value
            return ""

        def _origin_ok(self) -> bool:
            """When the browser names an origin, it must be this host."""

            for header in ("Origin", "Referer"):
                value = self.headers.get(header)
                if not value:
                    continue
                host = self.headers.get("Host", "")
                parsed = urlparse(value)
                if parsed.netloc != host or parsed.scheme != "http":
                    return False
            return True

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            path = unquote(urlparse(self.path).path)
            if path.startswith("/review/"):
                review_id = path[len("/review/"):]
                self._page(service.render_page(review_id), review_id)
                return
            if path.startswith("/transcript/"):
                review_id = path[len("/transcript/"):]
                body = service.transcript(review_id)
                if body is None:
                    self._send(
                        404,
                        _refusal_page("no jailed transcript for that id"),
                        "text/html; charset=utf-8",
                    )
                    return
                self._send(200, body.encode("utf-8"), "text/plain; charset=utf-8")
                return
            self._send(404, _refusal_page("not found"), "text/html; charset=utf-8")

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            path = unquote(urlparse(self.path).path)
            prefix = "/review/"
            if not path.startswith(prefix) or not path.endswith("/decision"):
                self._send(404, _refusal_page("not found"), "text/html; charset=utf-8")
                return
            review_id = path[len(prefix):-len("/decision")]
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send(
                    400,
                    _refusal_page("missing or oversized body"),
                    "text/html; charset=utf-8",
                )
                return
            form = parse_qs(
                self.rfile.read(length).decode("utf-8"), keep_blank_values=True
            )
            token = (form.get("csrf_token") or [""])[0]
            packet_sha256 = (form.get("packet_sha256") or [""])[0]
            decision_text = (form.get("decision") or [""])[0]
            if not service.csrf_valid(review_id, self._cookie_token(), token):
                self._send(
                    403, _refusal_page("CSRF check failed"), "text/html; charset=utf-8"
                )
                return
            if not self._origin_ok():
                self._send(
                    403,
                    _refusal_page("cross-origin review action"),
                    "text/html; charset=utf-8",
                )
                return
            state, refusal = service.decide(
                review_id, decision_text, packet_sha256=packet_sha256
            )
            if refusal:
                self._send(403, _refusal_page(refusal), "text/html; charset=utf-8")
                return
            assert state is not None  # decide returns state exactly when accepted
            page = service.render_decision_page(review_id, state)
            self._page(page, review_id)

    return ThreadingHTTPServer((host, port), Handler)


def host_derived_operator() -> str:
    """The workstation's account name, as the audit principal."""

    return getpass.getuser()
