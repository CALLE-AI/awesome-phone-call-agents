"""HTTP surface for the browser extension.

The extension talks only to this server. This server holds the CALL-E key and
is the only thing that talks to CALL-E, which is what CALL-E's own
documentation requires: "Do not call the Developer API directly from a browser,
public frontend, or untrusted client. If a frontend user needs to start a call,
send the request to your backend first, validate the user, and let your backend
call CALL-E with its project API key."

Four properties hold at every endpoint:

* no call is placed without the one-time token issued with that specific
  proposal, so nothing can dial without first fetching what the call would be;
* no full phone number is ever returned to the client;
* fixture mode is the default, so an unconfigured deployment cannot dial;
* an ambiguous outcome halts and is reported, never retried.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import uuid
from dataclasses import dataclass, field

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .call_task import answer_field, build_schema, build_task, region_for
from .caller import (
    AmbiguousOutcome, ConfigurationError, IdempotentReplay, build_caller, safe_snapshot,
    transcript_of, wait_for_terminal,
)
from .detect import Finding, detect
from .draft import build_draft, unresolved_note
from .gate import evaluate
from .llm import ModelUnavailable, build_provider, findings_from_model, merge
from .numbers import accept_typed, find_candidates, mask, mask_text
from .thread import thread_from_payload
from .verify import verify_finding

APP_NAME = "conversation-clarify"
DEV_TOKEN = "local-dev-token"


# --- configuration -----------------------------------------------------------

@dataclass
class Settings:
    mode: str
    token: str
    caller_name: str

    @classmethod
    def load(cls, env=None) -> "Settings":
        env = env if env is not None else os.environ
        mode = (env.get("CONVERSATION_CLARIFY_MODE") or "fixture").strip().lower()
        token = (env.get("CONVERSATION_CLARIFY_TOKEN") or "").strip()

        if mode == "live" and (not token or token == DEV_TOKEN):
            # A live deployment with no shared secret is an open endpoint that
            # places real phone calls for anyone who finds it.
            raise ConfigurationError(
                "CONVERSATION_CLARIFY_MODE=live requires CONVERSATION_CLARIFY_TOKEN to be set "
                "to a secret value. Refusing to start an unauthenticated live caller."
            )
        return cls(mode=mode, token=token or DEV_TOKEN,
                   caller_name=(env.get("CONVERSATION_CLARIFY_USER") or "").strip())


# --- state -------------------------------------------------------------------

@dataclass
class Proposal:
    id: str
    finding: Finding
    phone: str                 # server-side only; never serialised
    masked: str
    recipient_name: str
    subject: str
    caller_name: str
    task: str
    schema: dict
    base_key: str
    idempotency_key: str
    confirm_token: str
    state: str = "awaiting_confirmation"
    call_id: str = ""
    result: dict = field(default_factory=dict)


class Store:
    """In-memory, single process. State is deliberately not durable: a restart
    loses proposals, which is safe, whereas a half-remembered call is not."""

    TERMINAL = {"resolved", "unresolved", "failed_to_place"}

    # The attempt counter is in memory, so a restart forgets it. That is only
    # safe because the base key carries a digest of the request: a rebuilt key
    # after a restart still differs from anything CALL-E has seen with a
    # different body, so it cannot collide.
    def __init__(self) -> None:
        self._items: dict[str, Proposal] = {}
        self._lock = threading.Lock()
        self._in_flight: set[str] = set()
        self._attempts: dict[str, int] = {}

    def attempt_for(self, base_key: str) -> int:
        """Which attempt number a new proposal for this question should use.

        A stable idempotency key is what stops a double-click dialling twice.
        But a call that never connected must be retryable, and CALL-E returns
        the ORIGINAL call for a reused key -- so a genuine retry needs a new
        one. The counter advances only after the previous attempt reached a
        terminal state; while one is in flight, the key stays put.
        """
        with self._lock:
            current = self._attempts.get(base_key, 0)
            if current == 0:
                self._attempts[base_key] = 1
                return 1
            live = [
                p for p in self._items.values()
                if p.base_key == base_key and p.state not in self.TERMINAL
            ]
            if live:
                return current
            self._attempts[base_key] = current + 1
            return current + 1

    def put(self, proposal: Proposal) -> None:
        with self._lock:
            self._items[proposal.id] = proposal

    def get(self, proposal_id: str) -> Proposal:
        with self._lock:
            if proposal_id not in self._items:
                raise HTTPException(status_code=404, detail="No such proposal.")
            return self._items[proposal_id]

    def claim(self, key: str) -> bool:
        """One in-flight call per idempotency key, process-wide."""
        with self._lock:
            if key in self._in_flight:
                return False
            self._in_flight.add(key)
            return True

    def release(self, key: str) -> None:
        with self._lock:
            self._in_flight.discard(key)


# --- request models ----------------------------------------------------------

class MessageIn(BaseModel):
    sender: str = ""
    from_me: bool = False
    body: str = ""
    sent_at: str = ""


class ThreadIn(BaseModel):
    thread_id: str = ""
    subject: str = ""
    messages: list[MessageIn] = Field(default_factory=list)
    # The extension pre-checks every thread you open. Running the model on all of
    # them costs money and latency for threads that are almost always fine, so
    # the automatic pass asks for rules only and the model is reserved for the
    # full check a person asked for.
    rules_only: bool = False


class ProposeIn(BaseModel):
    thread: ThreadIn
    # The finding to act on, exactly as /analyze returned it.
    #
    # An index would be wrong here. /analyze can merge rule findings with model
    # findings; this endpoint has no model pass, so re-running detection would
    # produce a different, shorter list and the same position would mean a
    # different question -- or none at all. Sending the finding removes the
    # ambiguity, and verify_finding re-establishes every part of it against the
    # thread so nothing is taken on the client's word.
    finding: dict | None = None
    finding_index: int = 0     # legacy: rules-only selection, kept for the CLI path
    phone_token: str = ""      # an opaque candidate id from /analyze
    phone_typed: str = ""      # or a full +E.164 the user typed
    recipient_name: str = ""
    caller_name: str = ""


class ConfirmIn(BaseModel):
    confirm: str


# --- app ---------------------------------------------------------------------

def _for_display(value):
    """A copy safe to put in a response, a log, or a panel.

    Findings quote the thread verbatim, and the thread can contain a phone
    number -- in a signature, in the sentence itself, anywhere. Masking is
    applied to every string reached, lists included, because `options` is one.
    """
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, list):
        return [_for_display(v) for v in value]
    if isinstance(value, dict):
        return {k: _for_display(v) for k, v in value.items()}
    return value


def create_app(env=None) -> FastAPI:
    settings = Settings.load(env)
    caller = build_caller(env)
    provider = build_provider(env)
    store = Store()

    # A nonce for this process, mixed into every idempotency key.
    #
    # The attempt counter lives in memory, so a restart forgets it and the next
    # proposal for an unchanged thread rebuilds the key the previous run already
    # used. CALL-E answers a reused key with the ORIGINAL call, so nothing is
    # dialled and a stale outcome is reported as a fresh one. Observed live.
    #
    # The in-flight claim is in memory too, so a restart never protected against
    # a double-dial anyway; this gives up nothing and makes a retry after a
    # restart actually place a call. Within one run the key is unchanged, so a
    # double-click still cannot dial twice.
    run_id = secrets.token_hex(4)
    app = FastAPI(title="Conversation Clarify", version="0.1.0")

    # The browser extension reaches this server from a service worker, which is
    # not subject to CORS. The standalone page is, so loopback origins are
    # allowed and nothing else. A deployment that needs another origin must name
    # it explicitly; there is no wildcard.
    extra = [o.strip() for o in (env or os.environ).get("CONVERSATION_CLARIFY_ORIGINS", "").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:8777", "http://localhost:8777",
            "http://127.0.0.1:8000", "http://localhost:8000",
            *extra,
        ],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def auth(authorization: str = Header(default="")) -> None:
        expected = f"Bearer {settings.token}"
        if not secrets.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Unauthorized.")

    @app.get("/health")
    def health() -> dict:
        return {
            "app": APP_NAME,
            "mode": caller.mode,
            "dials_real_phones": caller.mode == "live",
            "model_pass": provider.name if provider else "off",
        }

    @app.post("/v1/analyze", dependencies=[Depends(auth)])
    def analyze(payload: ThreadIn) -> dict:
        thread = thread_from_payload(payload.model_dump())
        findings = detect(thread)

        # The model only ever adds. If it is unreachable, slow, or returns
        # nonsense, the rules stand on their own and the user is told the pass
        # did not run -- rather than silently getting weaker detection.
        model_note = ""
        if provider is not None and not payload.rules_only:
            try:
                findings = merge(findings, findings_from_model(thread, provider))
            except ModelUnavailable as exc:
                model_note = str(exc)

        candidates, _ = find_candidates(thread)
        return {
            "thread_fingerprint": thread.fingerprint(),
            "counterparty": mask_text(thread.counterparty),
            # Masked on the way out, like every other quoted-thread field. The
            # client hands these back on the next call and verify_finding masks
            # both sides before comparing, so the round trip still holds.
            "findings": [_for_display(f.to_dict()) for f in findings],
            "phone_candidates": [c.to_dict() for c in candidates],
            "model_pass": ("skipped" if (provider and payload.rules_only)
                           else (provider.name if provider else "off")),
            "model_note": model_note,
        }

    @app.post("/v1/proposals", dependencies=[Depends(auth)])
    def propose(payload: ProposeIn) -> dict:
        thread = thread_from_payload(payload.thread.model_dump())

        if payload.finding is not None:
            finding = verify_finding(thread, payload.finding, source="client")
            if finding is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "That finding could not be verified against this thread. Its quotes must "
                        "appear in the messages it names, the question must be yours and the reply "
                        "theirs, and any options must appear in the question. Re-check the thread."
                    ),
                )
        else:
            findings = detect(thread)
            if not findings:
                raise HTTPException(status_code=400, detail="Nothing unresolved was found in this thread.")
            if not 0 <= payload.finding_index < len(findings):
                raise HTTPException(status_code=400, detail="finding_index is out of range.")
            finding = findings[payload.finding_index]

        _, lookup = find_candidates(thread)
        if payload.phone_typed:
            phone, error = accept_typed(payload.phone_typed)
            if error:
                raise HTTPException(status_code=400, detail=error)
        elif payload.phone_token:
            phone = lookup.get(payload.phone_token, "")
            if not phone:
                # The id did not come from this thread. Refuse rather than fall
                # back to any other number we happen to hold.
                raise HTTPException(
                    status_code=400,
                    detail="That number is not one of the dialable numbers in this thread.",
                )
        else:
            raise HTTPException(status_code=400, detail="No destination was chosen.")

        recipient_name = payload.recipient_name or thread.counterparty
        caller_name = payload.caller_name or settings.caller_name or "the sender"
        masked = mask(phone)

        # The key identifies an operation, so it is derived from everything that
        # defines one: the thread content, which ambiguity, the destination, and
        # the exact request that will be sent.
        #
        # Without the request digest, changing the task text and re-running reuses
        # a key CALL-E has already seen with a different body, and the call is
        # refused with idempotency_conflict. That happened in testing after a
        # server restart reset the in-memory attempt counter. The digest makes a
        # changed request a different operation, which is what it is.
        task_text = build_task(finding, caller_name=caller_name,
                               recipient_name=recipient_name, subject=thread.subject)
        schema = build_schema(finding)
        digest = hashlib.sha256(
            json.dumps({"task": task_text, "schema": schema, "phone": phone,
                        "recipient": region_for(phone)}, sort_keys=True).encode()
        ).hexdigest()[:8]
        base_key = f"cr-{run_id}-{thread.fingerprint()}-{finding.replied_index}-{phone[-4:]}-{digest}"
        attempt = store.attempt_for(base_key)

        proposal = Proposal(
            id=uuid.uuid4().hex,
            finding=finding,
            phone=phone,
            masked=masked,
            recipient_name=recipient_name,
            subject=thread.subject,
            caller_name=caller_name,
            task=task_text,
            schema=schema,
            base_key=base_key,
            # Same thread content + same ambiguity + same destination => same key,
            # so re-analysing an unchanged thread cannot produce a second call.
            # The attempt suffix only moves after the previous one finished.
            idempotency_key=f"{base_key}-a{attempt}",
            # Handed out only with the proposal, so the dial endpoint cannot be
            # driven by a blind POST: a caller must first fetch what the call
            # would be. One click for the user; still not replayable.
            confirm_token=secrets.token_urlsafe(16),
        )
        store.put(proposal)

        return {
            "proposal_id": proposal.id,
            "finding": _for_display(finding.to_dict()),
            "destination_masked": masked,
            "recipient_name": recipient_name,
            "task_preview": mask_text(proposal.task),
            "result_schema": proposal.schema,
            "idempotency_key": proposal.idempotency_key,
            "confirm_token": proposal.confirm_token,
            "attempt": attempt,
            "mode": caller.mode,
            "will_dial_a_real_phone": caller.mode == "live",
        }

    @app.post("/v1/proposals/{proposal_id}/call", dependencies=[Depends(auth)])
    def place(proposal_id: str, body: ConfirmIn) -> dict:
        proposal = store.get(proposal_id)

        if proposal.state != "awaiting_confirmation":
            raise HTTPException(
                status_code=409,
                detail=f"This proposal is already {proposal.state}. It will not be dialled again.",
            )
        if not secrets.compare_digest(body.confirm, proposal.confirm_token):
            raise HTTPException(
                status_code=400,
                detail="Confirmation token does not match this proposal.",
            )
        if not store.claim(proposal.idempotency_key):
            raise HTTPException(
                status_code=409,
                detail="A call for this exact question is already in progress.",
            )

        try:
            proposal.state = "dialing"
            proposal.call_id = caller.place(
                task=proposal.task,
                phone=proposal.phone,
                schema=proposal.schema,
                recipient=region_for(proposal.phone),
                idempotency_key=proposal.idempotency_key,
                metadata={"app": APP_NAME, "finding": proposal.finding.kind},
            )
        except IdempotentReplay as exc:
            # Nothing was dialled, so this is safe to release and retry -- unlike
            # an ambiguous outcome, where a call may be in flight.
            proposal.state = "failed_to_place"
            store.release(proposal.idempotency_key)
            raise HTTPException(status_code=409, detail=str(exc))
        except AmbiguousOutcome as exc:
            proposal.state = "needs_reconciliation"
            raise HTTPException(status_code=409, detail=str(exc))
        except Exception as exc:
            # Report the kind of failure, never the provider's own message: it can
            # echo the request back, destination included.
            proposal.state = "failed_to_place"
            store.release(proposal.idempotency_key)
            # Reached only when CALL-E answered and rejected the request, so
            # "nothing was dialled" is a fact rather than an assumption. Anything
            # that might have been accepted arrives as AmbiguousOutcome above and
            # keeps its claim.
            raise HTTPException(
                status_code=502,
                detail=f"CALL-E rejected the request ({type(exc).__name__}). Nothing was dialled.",
            )

        return {"proposal_id": proposal.id, "call_id": proposal.call_id, "state": proposal.state}

    @app.get("/v1/proposals/{proposal_id}", dependencies=[Depends(auth)])
    def result(proposal_id: str) -> dict:
        proposal = store.get(proposal_id)
        if not proposal.call_id:
            return {"state": proposal.state}

        try:
            call = wait_for_terminal(caller, proposal.call_id, timeout=0.1, interval=0.1)
        except AmbiguousOutcome:
            return {"state": "in_progress", "call_id": proposal.call_id}

        store.release(proposal.idempotency_key)
        verdict = evaluate(
            call,
            answer_field=answer_field(proposal.finding),
            expected_options=proposal.finding.options or None,
        )
        proposal.state = "resolved" if verdict.passed else "unresolved"

        payload = {
            "state": proposal.state,
            "call_id": proposal.call_id,
            "verdict": verdict.to_dict(),
            "transcript": transcript_of(call),
            "call": safe_snapshot(call),
        }
        if verdict.passed:
            payload["draft"] = {
                "drafted": True,
                "subject": f"Re: {proposal.subject}" if proposal.subject else "",
                "body": build_draft(proposal.finding, verdict,
                                    recipient_name=proposal.recipient_name,
                                    caller_name=proposal.caller_name),
            }
        else:
            payload["draft"] = unresolved_note(proposal.finding, verdict)
        return payload

    return app


app = create_app()
