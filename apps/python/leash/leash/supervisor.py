"""LEASH supervisor — the CALL-E transport for the one call a lease expiry produces.

This module is the only path from LEASH to the CALL-E wire. It places the call and reads
back what happened. It is deliberately dumb about meaning: it decides nothing about the
lease. Deciding lives in ``leash.policy``, which is handed the
:class:`~leash.outcomes.CallOutcome` this module builds and which starts from "release the
lease", walking back from there only if twelve independent conditions all hold.

Three properties of that split matter enough to state here, because they explain most of the
defensive code below:

1.  **The call can only subtract.** The person on the phone has exactly one power: end the
    lease. Nothing said on the call can hand the agent a capability it does not already
    hold. So every ambiguity in this file resolves toward "we did not observe a clean
    continue", and that is a safe direction to fail in.
2.  **A failed call is the loudest outcome in the system.** A no-answer, a machine, a
    timeout, a crash — each of those ends the lease. That inverts the usual reliability
    engineering: this module never papers over a bad read, and ``poll_until_terminal``
    deliberately does *not* raise on a timeout, because raising would strand the lease
    instead of ending it.
3.  **A second real phone call to a human cannot be taken back.** Everything about the
    idempotency handling exists for that one sentence.

This class is transport, not a safety default. Constructing a :class:`Supervisor` does
nothing, but :meth:`Supervisor.create` dials the moment it is called, and its ``base_url``
defaults to production. The no-call default the repo requires is enforced at the entry
point, which must not reach ``create`` without an explicit live opt-in.

Transport is ``urllib.request`` only — no third-party HTTP dependency.

Live-observed platform behaviour this module is written against (each of these cost a real
call or a real probe to learn; see ``work/PLATFORM_NOTES.md`` and ``work/REFUSAL-HISTORY.md``):

*   ``CallStatus`` is exactly ``queued | in_progress | completed | failed | canceled``.
    There is no no-answer, voicemail, busy or declined status. A no-answer arrives as
    ``failed`` carrying a **free-form** ``failure_code`` string with no enum, so nothing
    here switches on failure-code constants.
*   A voicemail can arrive as ``completed`` with a machine transcript. ``status`` alone is
    therefore never load-bearing; the surviving fields are.
*   Extraction failure is silent and total: ``structured_result`` becomes ``null`` for the
    whole object. ``task_completed``, ``completion_confidence``, ``evidence`` and
    ``transcript_turns`` survive it, so the mapper below preserves all four with care.
*   In both live terminal snapshots the *per-recipient* ``structured_result`` was ``null``
    while the top-level one was populated. The mapper reads the top-level object only:
    treating the per-recipient copy as a fallback would loosen the gate on a degraded read,
    which is the wrong direction for this system.
*   Attempt records carry the recipient's full phone number
    (``recipients[].attempts[].phone``), so a raw snapshot is not safe to print. Nothing in
    this module logs ``CallOutcome.raw`` or ``ApiError.body``; anything that displays them
    must pass them through :func:`redact` first.
*   ``result_schema`` is validated *before* ``recipients``, which buys a free pre-flight
    that never dials (see :meth:`Supervisor.preflight`).
*   Create → terminal measured at roughly 145–200 s, still ``queued`` at 56 s. Hence the
    late first poll.
"""

import hashlib
import json
import logging
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Protocol

from leash.outcomes import CallOutcome, Turn
from leash.templates import assert_task_is_clean, render_task, template_sha256

__all__ = [
    "RESULT_SCHEMA",
    "Supervisor",
    "HttpSession",
    "UrllibSession",
    "SupervisorError",
    "ApiError",
    "CreateRejected",
    "ContentScreenRefused",
    "TransportError",
    "AmbiguousCreate",
    "mask_phone",
    "redact",
    "build_create_payload",
    "derive_idempotency_key",
    "outcome_from_snapshot",
]

LOG = logging.getLogger("leash.supervisor")

DEFAULT_BASE_URL = "https://api.heycall-e.com"

# Region and locale are fixed. CALL-E enforces region support at plan time, and Malaysia is
# English-only on the platform's region table, so there is nothing here to configure.
REGION = "MY"
LOCALE = "en-US"

TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})

CREATE_TIMEOUT_SECONDS = 45.0
FETCH_TIMEOUT_SECONDS = 30.0

# Deliberately un-dialable. It fails E.164 validation, which is exactly what the free
# pre-flight and the reconcile probe rely on: the request dies on the recipient, after the
# schema has already been judged, without dialling.
UNDIALABLE_PHONE = "+1"

# Slot values for the probe payloads. They must satisfy leash.templates.SLOTS; if that regex
# is ever tightened these stop rendering, which is why both probe paths treat a render
# failure as an ordinary failure rather than letting it escape (see reconcile).
PROBE_JOB_ID = "probe-0000"
PROBE_MINUTES = "1"

# E.164: leading '+', no leading zero, 8-15 digits total (15 is the standard's maximum).
#
# The floor is 8 and not 7. An earlier revision of this file wrote {6,14}, which admits a
# seven-digit destination -- shorter than any real international number, and the kind of
# value that reaches a dialler as a typo rather than as a subscriber. Nothing downstream
# would have caught it, and the cost of being wrong here is a call to a stranger. Used only
# on the real create path; the probe paths bypass it on purpose.
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")

#: The only origin the CALL-E bearer key may ever be sent to.
#:
#: This is an allowlist rather than a default because the two are not the same thing under
#: attack. A default is a suggestion: anything that can influence a base URL -- a flag, an
#: environment variable, a config file, a mis-set variable in a wrapper script -- redirects
#: a live credential to a host of someone else's choosing, and the request still looks
#: perfectly ordinary. Pinning the origin means the key has exactly one place it can go.
CALLE_ORIGIN = "https://api.heycall-e.com"

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _origin_of(url: str) -> str:
    parts = urllib.parse.urlsplit(str(url or ""))
    return "%s://%s" % (parts.scheme, parts.netloc)


class UntrustedOrigin(ValueError):
    """Raised when a base URL is neither CALL-E nor a local fake server."""


def assert_origin_allowed(base_url: str, *, allow_loopback: bool = False) -> str:
    """Return base_url, or refuse to let the bearer key leave for an unknown host.

    Loopback is permitted only when the caller explicitly asks for it, which in this
    package is the bundled fake server and nothing else. The fake server is handed a
    placeholder key, so even that path carries no real credential.
    """
    parts = urllib.parse.urlsplit(str(base_url or ""))
    origin = _origin_of(base_url)
    if origin == CALLE_ORIGIN:
        return str(base_url).rstrip("/")
    if allow_loopback and parts.scheme == "http" and parts.hostname in _LOOPBACK_HOSTS:
        return str(base_url).rstrip("/")
    raise UntrustedOrigin(
        "refusing to send the CALL-E key to %r.\n"
        "  The only permitted origin is %s.\n"
        "  A local fake server on http://127.0.0.1 is permitted for the offline demo,\n"
        "  which never carries a real key." % (origin or base_url, CALLE_ORIGIN)
    )


_MAX_IDEMPOTENCY_KEY_LEN = 255

# HTTP statuses that cannot become a different answer inside one polling window: a wrong or
# revoked key stays wrong for the whole window. Everything else — 404, 429, 5xx — is treated
# as transient and retried to the deadline.
_UNRECOVERABLE_READ_STATUSES = frozenset({401, 403})


# ----------------------------------------------------------------------------------------
# The result schema. Flat scalars only.
# ----------------------------------------------------------------------------------------
# Every field carries an in-band escape value ("unclear", the literal word NONE) because a
# null is total: if CALL-E cannot produce a schema-valid object it returns null for the
# WHOLE object, not for the offending field. An optional-looking field would therefore not
# degrade gracefully — it would take the other three down with it. No arrays, no nested
# objects, no nullable unions: nested and array shapes pass create-time validation but have
# never been observed surviving extraction, and a nullable union is rejected outright.
RESULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "job_decision",
        "choice_readback_confirmed",
        "reason_sentence",
        "spoke_with_person",
    ],
    "properties": {
        "job_decision": {
            "type": "string",
            "enum": ["continue_job", "stop_job", "unclear"],
            "description": (
                "The word the person chose. Use \"continue_job\" only if they clearly said "
                "the job should continue. Use \"stop_job\" if they said stop, or otherwise "
                "asked for the job to be stopped. Use \"unclear\" for anything else, "
                "including silence, hesitation, a recording or answering machine, or a "
                "person who did not choose."
            ),
        },
        "choice_readback_confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unclear"],
            "description": (
                "yes only if you repeated their choice back to them and they explicitly "
                "confirmed it was correct. no if they corrected you. unclear if they did "
                "not respond to the confirmation."
            ),
        },
        "reason_sentence": {
            "type": "string",
            "description": (
                "The one sentence the person gave explaining their choice, in their own "
                "words, word for word. Use the word NONE if they gave no reason."
            ),
        },
        "spoke_with_person": {
            "type": "string",
            "enum": ["yes", "no", "unclear"],
            "description": (
                "yes only if a live person answered and responded to your questions. no for "
                "silence, a recording, or an answering machine."
            ),
        },
    },
}


# ----------------------------------------------------------------------------------------
# Redaction. Nothing in this module ever emits a key, a token or a full phone number.
# ----------------------------------------------------------------------------------------
_SECRET_PATTERNS = (
    (re.compile(r"(?i)\bbearer\s+\S+"), "Bearer <redacted>"),
    (re.compile(r"\biams_[a-z]+_[A-Za-z0-9_\-]+"), "iams_<redacted>"),
    (re.compile(r"1//[A-Za-z0-9_\-]{10,}"), "1//<redacted>"),
    (re.compile(r"\bya29\.[A-Za-z0-9_\-\.]+"), "ya29.<redacted>"),
)

# Either a '+'-led run (how E.164 numbers appear on the wire) or a bare run of 9-15 digits
# (how a number appears once someone strips the plus). The bare-run floor is 9 so that ISO
# dates and short ids are not mangled into fake phone numbers in logs; over-masking is still
# preferred to under-masking, so the '+'-led alternative stays deliberately loose.
_PHONE_LIKE = re.compile(r"\+\d[\d\-\s]{5,20}\d|(?<!\d)\d{9,15}(?!\d)")


def mask_phone(phone: str | None) -> str:
    """Render a phone number safe to print: keeps the first three characters and the last two.

    On an E.164 number those three characters are the plus and the country code. Two trailing
    digits are enough for a human operator to confirm they are looking at the right lease, and
    not enough to be a phone number in a log file or on camera.
    """
    if phone is None:
        return "<no recipient>"
    digits = "".join(ch for ch in str(phone) if ch in "0123456789+")
    if not digits:
        return "<no recipient>"
    if len(digits) <= 5:
        return "•" * len(digits)
    return digits[:3] + "•" * (len(digits) - 5) + digits[-2:]


def redact(text: object) -> str:
    """Scrub API keys, OAuth tokens and phone-shaped digit runs out of arbitrary text.

    Provider error bodies are echoed into exceptions and logs, and a provider is free to
    quote our own request back at us. Everything that leaves this module goes through here
    first.
    """
    if text is None:
        return ""
    out = str(text)
    for pattern, replacement in _SECRET_PATTERNS:
        out = pattern.sub(replacement, out)
    return _PHONE_LIKE.sub(lambda m: mask_phone(m.group(0)), out)


# ----------------------------------------------------------------------------------------
# Exceptions
# ----------------------------------------------------------------------------------------
class SupervisorError(Exception):
    """Base for every failure this module raises."""


class ApiError(SupervisorError):
    """CALL-E answered, and the answer was an error.

    ``body`` is the provider's parsed body, kept **unredacted** for programmatic use — it can
    echo our own request, including the recipient. Only ``str(exc)`` is safe to print as is;
    pass ``body`` through :func:`redact` before it reaches a log or a screen.
    """

    def __init__(self, status: int, code: str | None, message: str, body: dict | None = None) -> None:
        self.status = status
        self.code = code
        self.provider_message = redact(message)
        self.body = body if isinstance(body, dict) else {}
        super().__init__(
            "CALL-E returned HTTP %s (%s): %s" % (status, code or "no code", self.provider_message)
        )


class CreateRejected(ApiError):
    """POST /v1/calls was refused. No call was placed."""


class ContentScreenRefused(SupervisorError):
    """CALL-E's content screen refused the task text at create time. Hard stop.

    Raised by :meth:`Supervisor.create` only. :meth:`Supervisor.preflight` reports the same
    condition through its return value instead, because a check that raises on its most
    interesting branch is a check every caller has to wrap in try/except to use.

    This is not a retryable error and it must never be handled by mutating the task text at
    run time. The template is frozen by SHA-256 in ``leash.templates`` precisely because it
    survived the screen on a real call; editing a character re-rolls a screen we cannot
    re-test without another live call.
    """

    def __init__(self, provider_message: str, body: dict | None = None, where: str = "create") -> None:
        self.provider_message = redact(provider_message)
        self.body = body if isinstance(body, dict) else {}
        self.where = where
        super().__init__(
            "CONTENT SCREEN REFUSED THE CALL SCRIPT at %s (HTTP 422 call_not_ready).\n"
            "  Provider said: %s\n  %s" % (where, self.provider_message, content_screen_guidance())
        )


class TransportError(SupervisorError):
    """The request did not complete. ``undelivered`` says whether that is knowable."""

    def __init__(self, message: str, cause: BaseException | None = None,
                 undelivered: bool = False) -> None:
        self.cause = cause
        self.undelivered = bool(undelivered)
        super().__init__(redact(message))


class AmbiguousCreate(SupervisorError):
    """The create request may or may not have been accepted, and we cannot tell.

    Raised when the connection failed at a point where CALL-E may already have taken the
    request, and also when the provider answered with something that is not identifiably this
    lease's call. The only forbidden response is to dial again: the provider may already be
    ringing a human, and a second ring is not undoable. Reconcile with the persisted
    Idempotency-Key instead.
    """

    def __init__(self, idempotency_key: str, cause: BaseException | None = None,
                 note: str | None = None) -> None:
        self.idempotency_key = idempotency_key
        self.cause = cause
        self.note = note
        detail = note or (redact(repr(cause)) if cause is not None else "no detail")
        super().__init__(
            "AMBIGUOUS CREATE — the provider may already have accepted this call.\n"
            "  Detail: %s\n"
            "  Idempotency-Key: %s\n"
            "  DO NOT re-dial. Call Supervisor.reconcile_after_ambiguous_create() with that\n"
            "  key. If it returns a call id, poll that call. If it returns None the situation\n"
            "  is unresolved: end the lease (the safe branch) and have a person read the\n"
            "  dashboard. A duplicate call is the one failure mode this system cannot undo."
            % (redact(detail), idempotency_key)
        )


def content_screen_guidance() -> str:
    """The single wording for what a content-screen refusal means, shared by both report paths."""
    return (
        "The task template is FROZEN at sha256 %s and must not be edited at run time.\n"
        "  A refusal costs no dial, but it is a HARD STOP: the screen is an LLM review of the\n"
        "  task text, so an edited script is an untested script, and the only way to test it is\n"
        "  to spend another real call on a human being.\n"
        "  Required response: halt this run, end the lease by the normal release path, and have\n"
        "  a person rewrite and re-freeze the template out of band. Do not retry, do not\n"
        "  rephrase, do not fall back to a second script." % template_sha256()
    )


# ----------------------------------------------------------------------------------------
# Transport
# ----------------------------------------------------------------------------------------
class HttpSession(Protocol):
    """What :class:`Supervisor` needs from a transport.

    An implementation must **return** HTTP error responses as ``(status, body)`` and may
    **raise** ``OSError`` for genuine transport failures. The distinction is not cosmetic:
    a returned 4xx means CALL-E answered and no call was placed, while a raised OSError may
    mean the request was accepted and is ringing someone. This seam exists because the
    ambiguous-create path is unreachable against a healthy server: injecting a session that
    raises on demand is the only way to exercise it anywhere other than production.
    """

    def request(self, method: str, url: str, *, body: bytes | None = None,
                headers: dict[str, str] | None = None,
                timeout: float = 30.0) -> tuple[int, bytes]:
        ...


class UrllibSession:
    """Default transport: stdlib only, no third-party HTTP dependency."""

    def request(self, method: str, url: str, *, body: bytes | None = None,
                headers: dict[str, str] | None = None,
                timeout: float = 30.0) -> tuple[int, bytes]:
        request = urllib.request.Request(url, data=body, method=method)
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return int(response.status), response.read()
        except urllib.error.HTTPError as exc:
            # An HTTP error is an answer, not a transport failure: 4xx bodies carry the
            # error code this module routes on.
            try:
                payload = exc.read()
            except Exception:  # noqa: BLE001 - the body is best-effort only
                payload = b""
            return int(exc.code), payload


def _definitely_undelivered(exc: BaseException) -> bool:
    """True only when the request provably never reached CALL-E.

    Defaults to False. Every unclassified failure is treated as ambiguous, because the cost
    of a wrong "ambiguous" is a halt, and the cost of a wrong "undelivered" is a second real
    phone call to a person.

    Only two families qualify, and both fail strictly before any request byte can be written:
    name resolution, and a refused or certificate-rejected connection. Every other TLS or
    socket error — including SSLEOFError, SSLZeroReturnError and a plain reset — can also
    happen while the *response* is being read, which is to say after the provider already
    took the request, so none of them may be classified here.
    """
    reason = getattr(exc, "reason", None)
    if reason is None or isinstance(reason, str):
        reason = exc
    if isinstance(reason, socket.gaierror):
        return True  # name resolution never got as far as a socket
    if isinstance(reason, ConnectionRefusedError):
        return True  # nothing was listening; no bytes were sent
    if isinstance(reason, ssl.SSLCertVerificationError):
        return True  # verification is part of the handshake, before the request is written
    return False


def _parse_json(payload: bytes | str | None) -> dict[str, Any]:
    if not payload:
        return {}
    if isinstance(payload, (bytes, bytearray)):
        text = payload.decode("utf-8", "replace")
    else:
        text = str(payload)
    try:
        parsed = json.loads(text)
    except ValueError:
        return {"_unparsed_body": redact(text[:400])}
    if isinstance(parsed, dict):
        return parsed
    return {"_non_object_body": parsed}


def _error_code(body: object) -> str | None:
    """Pull the provider error code out of a response body, defensively."""
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        if isinstance(code, str) and code:
            return code
    if isinstance(error, str) and error:
        return error
    code = body.get("code")
    if isinstance(code, str) and code:
        return code
    return None


def _error_message(body: object) -> str:
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message
    message = body.get("message")
    if isinstance(message, str):
        return message
    return json.dumps(body)[:400]


# ----------------------------------------------------------------------------------------
# Payload construction and the idempotency key
# ----------------------------------------------------------------------------------------
def _render_task_checked(job_id: str, minutes: int | str) -> str:
    """Render the frozen template and re-assert the banned-register guard at the wire boundary.

    ``leash.templates.render_task`` already asserts, and raises ``TaskRefused`` if it fails.
    Asserting again here is deliberate duplication: this function is the only place a string
    becomes a spoken sentence, so the guard the submission claims is checked at exactly the
    point the claim is about, not one call frame away from it.
    """
    task = render_task(job_id, minutes)
    assert_task_is_clean(task)
    return task


def build_create_payload(job_id: str, minutes: int | str, phone: str) -> dict[str, Any]:
    """Build the exact POST /v1/calls body.

    Task text comes from ``leash.templates`` and from nowhere else. This module has no string
    that could become a spoken sentence, by construction: there is no other path from here to
    the ``task`` field.

    ``metadata.job_id`` is what lets the policy bind a terminal snapshot to the lease the
    call was placed for. A snapshot that belongs to some other job is not evidence about
    this one.
    """
    return {
        "task": _render_task_checked(job_id, minutes),
        "recipients": [{"phones": [str(phone)], "region": REGION, "locale": LOCALE}],
        "result_schema": RESULT_SCHEMA,
        "metadata": {
            "project": "leash",
            "job_id": str(job_id),
            "lease_minutes": str(minutes),
            "task_template_sha256": template_sha256(),
        },
    }


def _probe_payload(job_id: str = PROBE_JOB_ID,
                   minutes: int | str = PROBE_MINUTES) -> dict[str, Any]:
    """A payload that cannot dial anyone, whatever the provider does with it.

    Used by both no-dial paths. It carries no ``metadata``, so a record created from it is
    distinguishable from a real lease call in the dashboard by the absence of a job id. The
    pre-flight passes the real lease's slot values, because the point there is to have the
    provider judge the text that would actually be spoken.
    """
    return {
        "task": _render_task_checked(job_id, minutes),
        "recipients": [{"phones": [UNDIALABLE_PHONE], "region": REGION, "locale": LOCALE}],
        "result_schema": RESULT_SCHEMA,
    }


def derive_idempotency_key(job_id: str, minutes: int | str, phone: str,
                           lease_epoch: object) -> str:
    """Derive the Idempotency-Key from the payload plus the lease epoch.

    Payload-derived, so a retry of *this* lease's call presents the same key rather than a
    new one. Epoch-salted, so a genuinely new lease over the same job, the same duration and
    the same person gets a different key and is allowed to ring. Without the epoch a
    legitimate second lease could be swallowed as a duplicate; without the payload a retry
    could become a second call.

    Whether CALL-E actually dedupes on this header is UNVERIFIED — the documentation does not
    describe its replay semantics and we have not spent a live call to find out. The key is
    therefore a discipline we impose on ourselves (one key per lease, persisted before
    dispatch, never reused across leases) rather than a guarantee we are relying on; see
    :meth:`Supervisor.reconcile_after_ambiguous_create`.

    The caller MUST persist the returned key (and ideally the payload) to durable storage
    BEFORE calling :meth:`Supervisor.create`. This function cannot do that for you, and a
    key that exists only in memory is worthless in exactly the crash that needs it.
    """
    blob = json.dumps(
        {
            "payload": build_create_payload(job_id, minutes, phone),
            "lease_epoch": str(lease_epoch),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "leash-" + hashlib.sha256(blob).hexdigest()[:32]


def _normalise_phone(phone: object) -> str:
    return "".join(str(phone or "").split()).replace("-", "").replace("(", "").replace(")", "")


def _validate_idempotency_key(key: object) -> str:
    key = str(key or "").strip()
    if not key:
        raise ValueError(
            "an Idempotency-Key is required and must have been persisted before dispatch; "
            "see derive_idempotency_key()"
        )
    if len(key) > _MAX_IDEMPOTENCY_KEY_LEN:
        raise ValueError("Idempotency-Key is longer than %d characters" % _MAX_IDEMPOTENCY_KEY_LEN)
    if any(ch < " " or ch > "~" for ch in key):
        raise ValueError("Idempotency-Key must be printable ASCII (it is an HTTP header value)")
    return key


# ----------------------------------------------------------------------------------------
# Snapshot -> CallOutcome
# ----------------------------------------------------------------------------------------
def _as_float(value: object) -> float | None:
    try:
        if isinstance(value, bool) or value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_turns(snapshot: dict) -> tuple[Turn, ...]:
    """Walk recipients[].attempts[].transcript_turns[] and flatten, in wire order.

    Transcript turns survive a null ``structured_result``, so this is the deepest fallback
    the policy has. It is also the only place the system can see a person say "stop" when
    extraction says otherwise, which has been observed live, so nothing here silently drops
    a malformed turn: a turn with a broken offset still carries its text.
    """
    turns = []
    recipients = snapshot.get("recipients")
    if not isinstance(recipients, list):
        return ()
    for recipient in recipients:
        if not isinstance(recipient, dict):
            continue
        attempts = recipient.get("attempts")
        if not isinstance(attempts, list):
            continue
        for attempt in attempts:
            if not isinstance(attempt, dict):
                continue
            raw_turns = attempt.get("transcript_turns")
            if not isinstance(raw_turns, list):
                continue
            for raw_turn in raw_turns:
                if not isinstance(raw_turn, dict):
                    continue
                speaker = raw_turn.get("speaker")
                speaker = speaker.strip().lower() if isinstance(speaker, str) else ""
                if speaker not in ("bot", "user", "unknown"):
                    # An unrecognised speaker must never be counted as the person: the
                    # voicemail guard counts user turns, and mislabelling a bot turn as a
                    # user turn would let a recording look like a conversation.
                    speaker = "unknown"
                text = raw_turn.get("text")
                offset = _as_float(raw_turn.get("offset_seconds"))
                turns.append(
                    Turn(
                        offset_seconds=0.0 if offset is None else offset,
                        speaker=speaker,
                        text=text if isinstance(text, str) else ("" if text is None else str(text)),
                    )
                )
    return tuple(turns)


def _coerce_failure_code(snapshot: dict) -> str | None:
    """Last non-empty attempt-level failure_code, else the top-level one.

    Free-form string with no enum: a no-answer, a busy line and a carrier reject all arrive
    here as prose that the provider is free to change. It is recorded and shown to humans,
    never compared against a constant.
    """
    found = []
    recipients = snapshot.get("recipients")
    if isinstance(recipients, list):
        for recipient in recipients:
            if not isinstance(recipient, dict):
                continue
            attempts = recipient.get("attempts")
            if not isinstance(attempts, list):
                continue
            for attempt in attempts:
                if not isinstance(attempt, dict):
                    continue
                code = attempt.get("failure_code")
                if isinstance(code, str) and code.strip():
                    found.append(code.strip())
    if found:
        return found[-1]
    top = snapshot.get("failure_code")
    if isinstance(top, str) and top.strip():
        return top.strip()
    return None


def outcome_from_snapshot(snapshot: object, fallback_call_id: str = "") -> CallOutcome:
    """Map a terminal (or partial) snapshot into a :class:`CallOutcome`.

    Public so the unsigned-webhook path can map an event payload with exactly this code
    before comparing it against a re-fetched snapshot. Two mappers would mean the comparison
    could pass on a difference that only one of them normalised away.

    Every field is treated as absent-or-null-capable, and every unrecognised shape maps to
    ``None`` rather than to a guess. ``task_completed`` is accepted only as a real bool and
    ``completion_confidence`` only as an object carrying a numeric ``score`` — the shapes
    actually observed. ``None`` reads as not-held in the policy, which ends the lease, so an
    unfamiliar payload can never satisfy a condition it was not observed to satisfy.
    """
    if not isinstance(snapshot, dict):
        snapshot = {}

    call_id = snapshot.get("id") or snapshot.get("call_id") or fallback_call_id or ""
    if not isinstance(call_id, str):
        call_id = str(call_id)

    status = snapshot.get("status")
    status = status.strip().lower() if isinstance(status, str) else ""

    raw_completed = snapshot.get("task_completed")
    task_completed = raw_completed if isinstance(raw_completed, bool) else None

    confidence = snapshot.get("completion_confidence")
    confidence_score = None
    confidence_label = None
    if isinstance(confidence, dict):
        confidence_score = _as_float(confidence.get("score"))
        label = confidence.get("label")
        confidence_label = label.strip().lower() if isinstance(label, str) else None

    # Read the top-level structured_result only. Live, the per-recipient copy was null on
    # both successful calls while this one was populated, so it is not a mirror worth
    # falling back to — and a fallback there would make a degraded read MORE permissive,
    # which is the one direction this system may not fail in.
    structured = snapshot.get("structured_result")
    structured_result = structured if isinstance(structured, dict) else None

    raw_evidence = snapshot.get("evidence")
    if isinstance(raw_evidence, str):
        raw_evidence = [raw_evidence]
    evidence: tuple[str, ...] = ()
    if isinstance(raw_evidence, list):
        evidence = tuple(
            item.strip() if isinstance(item, str) else str(item)
            for item in raw_evidence
            if item is not None and str(item).strip()
        )

    error = snapshot.get("error")
    error_code = None
    if isinstance(error, dict):
        code = error.get("code")
        if isinstance(code, str) and code.strip():
            error_code = code.strip()
    elif isinstance(error, str) and error.strip():
        error_code = error.strip()

    return CallOutcome(
        call_id=call_id,
        status=status,
        task_completed=task_completed,
        confidence_score=confidence_score,
        confidence_label=confidence_label,
        structured_result=structured_result,
        evidence=evidence,
        turns=_coerce_turns(snapshot),
        failure_code=_coerce_failure_code(snapshot),
        error_code=error_code,
        raw=snapshot,
        reached_terminal=status in TERMINAL_STATUSES,
    )


def _unreached_outcome(call_id: str, note: str) -> CallOutcome:
    """An outcome for a call we could not read at all.

    ``status`` is "unknown", which is not one of the five wire statuses on purpose: it says
    we never observed one. The policy fails every condition against it and ends the lease,
    which is the correct reading of "the supervisor could not see the call". ``raw`` carries
    only the note — a body we could not trust is not a body the policy should be able to
    read around.
    """
    return CallOutcome(
        call_id=call_id,
        status="unknown",
        task_completed=None,
        confidence_score=None,
        confidence_label=None,
        structured_result=None,
        evidence=(),
        turns=(),
        failure_code=None,
        error_code=None,
        raw={"leash_note": redact(note)},
        reached_terminal=False,
    )


# ----------------------------------------------------------------------------------------
# The supervisor
# ----------------------------------------------------------------------------------------
class Supervisor:
    """Thin, defensive client for the one call LEASH ever places."""

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL,
                 session: HttpSession | None = None,
                 create_timeout: float = CREATE_TIMEOUT_SECONDS,
                 allow_loopback: bool = False) -> None:
        # Injectable only so a fixture can force the ambiguous-create path in seconds
        # instead of the 45 s a real socket would take. Production callers never pass it.
        self._create_timeout = float(create_timeout)
        key = str(api_key or "").strip()
        if not key:
            raise ValueError("api_key is required (CALL-E bearer key)")
        self._api_key = key
        # Validated before the key is used for anything. An untrusted origin is a
        # construction-time error, not a request-time one.
        self.base_url = assert_origin_allowed(base_url or DEFAULT_BASE_URL,
                                              allow_loopback=allow_loopback)
        self._session = session if session is not None else UrllibSession()

    def __repr__(self) -> str:
        # The key must not reach a traceback, a log line or a screen recording.
        return "Supervisor(base_url=%r, api_key=<redacted>)" % (self.base_url,)

    # -- internals -----------------------------------------------------------------------
    def _headers(self, idempotency_key: str | None = None,
                 has_body: bool = False) -> dict[str, str]:
        headers = {
            # RFC 7235 header name, fixed by CALL-E's bearer scheme. It names our API key to
            # the provider and has nothing to do with what the person on the phone can do:
            # their only power is to end the lease, and no header carries that either way.
            "Authorization": "Bearer " + self._api_key,
            "Accept": "application/json",
            "User-Agent": "leash/1.0",
        }
        if has_body:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _call(self, method: str, path: str, body: dict | None = None,
              idempotency_key: str | None = None,
              timeout: float = FETCH_TIMEOUT_SECONDS) -> tuple[int, dict[str, Any]]:
        """One request. Returns ``(status, parsed_body)``; raises TransportError otherwise."""
        url = self.base_url + path
        raw_body = None
        if body is not None:
            raw_body = json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
        try:
            status, payload = self._session.request(
                method,
                url,
                body=raw_body,
                headers=self._headers(idempotency_key, has_body=raw_body is not None),
                timeout=timeout,
            )
        except urllib.error.HTTPError as exc:  # an injected session may raise instead
            try:
                payload = exc.read()
            except Exception:  # noqa: BLE001
                payload = b""
            return int(exc.code), _parse_json(payload)
        except OSError as exc:  # URLError and TimeoutError are both OSError subclasses
            raise TransportError(
                "%s %s failed at the transport layer: %r" % (method, path, exc),
                cause=exc,
                undelivered=_definitely_undelivered(exc),
            ) from exc
        return int(status), _parse_json(payload)

    # -- pre-flight ----------------------------------------------------------------------
    def preflight(self, job_id: str, minutes: int | str) -> tuple[bool, dict[str, Any]]:
        """Schema check that cannot dial. Returns ``(schema_ok, report)``.

        CALL-E validates ``result_schema`` BEFORE it validates ``recipients`` (undocumented,
        confirmed live). Pairing the real schema with the un-dialable "+1" therefore gets
        the schema judged without a dial:

          * ``invalid_phone``         -> the schema was accepted; the request died on the
                                         recipient, which is the intended outcome.
          * ``result_schema_invalid`` -> the schema was rejected. Do not dial.
          * ``call_not_ready``        -> the content screen refused the script: hard stop,
                                         reported as ``(False, report)`` with
                                         ``report["content_screen_refused"]`` set.

        No dial happens on any branch, so no billable call is created — billing is per placed
        call and there is no balance endpoint to read, so that is an inference from the
        pricing page rather than something this code can verify.

        This method does not raise on any answer CALL-E gives; every branch returns a tuple.
        It can still raise before any request is made, if ``leash.templates`` refuses to
        render the task at all (``TaskRefused``), and it propagates ``TransportError`` when
        the request never completed — neither of those is a provider verdict.

        IMPORTANT — WHAT THIS CANNOT TELL YOU. A pass here does NOT prove the content screen
        passed. CALL-E parses the recipients alongside the screen, so ``invalid_phone`` may
        simply mean the screen never ran on this request at all. The screen is only proven
        by a create that reaches ``queued`` — which costs a real call. Treat a clean
        pre-flight as "the schema will not null the result", never as "the script is safe".
        """
        # Deliberately no Idempotency-Key: if the pre-flight shared the real call's key, a
        # provider that stores responses per key could replay this rejection as the answer to
        # the create, and the one call that matters would never be placed.
        payload = _probe_payload(job_id, minutes)
        status, body = self._call(
            "POST", "/v1/calls", body=payload, timeout=self._create_timeout
        )
        code = _error_code(body)
        report: dict[str, Any] = {
            "http_status": status,
            "error_code": code,
            "provider_message": redact(_error_message(body)),
            "template_sha256": template_sha256(),
            "proves_content_screen_passed": False,
            "content_screen_refused": False,
            "body": body,
        }

        if code == "call_not_ready":
            report["content_screen_refused"] = True
            report["verdict"] = (
                "CONTENT SCREEN REFUSED THE CALL SCRIPT at preflight (HTTP 422 "
                "call_not_ready). " + content_screen_guidance()
            )
            LOG.error("preflight: %s", report["verdict"])
            return False, report

        if code == "invalid_phone":
            report["verdict"] = (
                "schema accepted; the request died on the un-dialable recipient, which is "
                "what this probe is for"
            )
            LOG.info("preflight: schema accepted (rejected on recipient, nothing was dialled)")
            return True, report

        if code == "result_schema_invalid":
            report["verdict"] = "schema rejected; extraction would have nulled the whole object"
            LOG.error("preflight: schema rejected: %s", report["provider_message"])
            return False, report

        if 200 <= status < 300:
            # Should be unreachable: "+1" is not dialable. If it ever happens, something
            # accepted a call we did not intend to place, and the only correct move is to
            # stop and have a person read the dashboard.
            report["verdict"] = (
                "UNEXPECTED HTTP %s — the un-dialable pre-flight was ACCEPTED. Halt and "
                "inspect the dashboard before placing anything." % status
            )
            LOG.error("preflight: %s", report["verdict"])
            return False, report

        report["verdict"] = "unexpected error %r; halting rather than guessing" % (code,)
        LOG.error("preflight: %s (HTTP %s)", report["verdict"], status)
        return False, report

    # -- create --------------------------------------------------------------------------
    def create(self, job_id: str, minutes: int | str, phone: str,
               idempotency_key: str) -> str:
        """Place the call. Returns the call id.

        The caller must have written ``idempotency_key`` to durable storage BEFORE calling
        this. That ordering is the whole safety property: if this process dies between the
        socket write and the response, the key on disk is the only thing that can tell the
        next process what was already in flight.

        Raises :class:`AmbiguousCreate` when the transport failed at a point where CALL-E may
        already have accepted the request, when a 2xx carries no call id, or when the answer
        identifies a call belonging to a different job. Do not catch any of those and retry.
        """
        key = _validate_idempotency_key(idempotency_key)
        number = _normalise_phone(phone)
        if not _E164.match(number):
            raise ValueError(
                "recipient %s is not a valid E.164 number; refusing to dispatch"
                % mask_phone(number)
            )

        payload = build_create_payload(job_id, minutes, number)
        LOG.info(
            "creating call job_id=%s minutes=%s recipient=%s idempotency_key=%s template=%s",
            job_id,
            minutes,
            mask_phone(number),
            key,
            template_sha256()[:12],
        )

        try:
            status, body = self._call(
                "POST",
                "/v1/calls",
                body=payload,
                idempotency_key=key,
                timeout=self._create_timeout,
            )
        except TransportError as exc:
            if exc.undelivered:
                # Provably nothing was sent: safe to surface as an ordinary failure. The
                # caller may retry with the SAME key.
                LOG.error("create failed before dispatch: %s", exc)
                raise
            # Everything else — timeout, reset, half-open socket — is ambiguous. CALL-E may
            # be dialling a person right now.
            raise AmbiguousCreate(key, cause=exc) from exc

        code = _error_code(body)
        if code == "call_not_ready":
            raise ContentScreenRefused(_error_message(body), body=body, where="create")
        # An error field on a 2xx is a contradiction; treat it as the error it claims to be
        # rather than reading an id out of a body that says something went wrong.
        if status >= 400 or body.get("error"):
            raise CreateRejected(status, code, _error_message(body), body)

        call_id = body.get("id") or body.get("call_id")
        if not isinstance(call_id, str) or not call_id.strip():
            # A 2xx without an id is the ambiguous case in a different costume: the call may
            # exist and we have no handle on it.
            raise AmbiguousCreate(
                key,
                note="provider answered HTTP %s with no call id in the body" % status,
            )

        call_id = call_id.strip()

        # If the provider replayed a record stored under this key, that record must belong to
        # this job. A key reused across jobs would otherwise hand back a finished call whose
        # transcript no layer below can tell apart from this lease's: the policy binds on
        # metadata.job_id, and a foreign call would fail that check only by luck. This is the
        # one place the mismatch is visible, so it is checked here.
        echoed = body.get("metadata")
        if isinstance(echoed, dict):
            echoed_job_id = echoed.get("job_id")
            if isinstance(echoed_job_id, str) and echoed_job_id.strip() != str(job_id):
                raise AmbiguousCreate(
                    key,
                    note=(
                        "provider answered with call %s whose metadata.job_id is %r, not %r; "
                        "this key is bound to a different job and the id returned is not this "
                        "lease's call" % (call_id, echoed_job_id.strip(), str(job_id))
                    ),
                )

        wire_status = body.get("status")
        wire_status = wire_status.strip().lower() if isinstance(wire_status, str) else ""
        if wire_status in TERMINAL_STATUSES:
            # A fresh create answers "queued". A terminal status here means the provider
            # replayed a record already stored under this key — legitimate in crash recovery
            # (same lease, same key), but it means nobody's phone is ringing now, and the
            # snapshot that follows describes an earlier attempt.
            LOG.warning(
                "create returned call %s already in terminal status %s: this is a replay of a "
                "record stored under this key, not a new dial",
                call_id,
                wire_status,
            )
        # Reaching "queued" is the only evidence that the content screen passed this text;
        # the status is logged rather than asserted, because a provider that reports the
        # queue differently must not stop a call we have already been given an id for.
        LOG.info("call accepted id=%s status=%s", call_id, wire_status or "<unstated>")
        return call_id

    # -- read ----------------------------------------------------------------------------
    def fetch(self, call_id: str) -> CallOutcome:
        """GET the snapshot and map it into a :class:`CallOutcome`.

        Raises :class:`ApiError` on an HTTP error and :class:`TransportError` when the request
        did not complete; both are read failures, and every caller must treat a read failure
        as a release. A snapshot whose own id is not the id we asked for is discarded and
        reported as unread, because nothing below this layer can catch that substitution.
        """
        cid = str(call_id or "").strip()
        if not cid:
            raise ValueError("call_id is required")
        status, body = self._call(
            "GET",
            "/v1/calls/" + urllib.parse.quote(cid, safe=""),
            timeout=FETCH_TIMEOUT_SECONDS,
        )
        if status >= 400:
            raise ApiError(status, _error_code(body), _error_message(body), body)

        outcome = outcome_from_snapshot(body, fallback_call_id=cid)
        if outcome.call_id != cid:
            LOG.error(
                "fetch of %s returned a snapshot identifying itself as %s; discarding it",
                cid,
                outcome.call_id,
            )
            return _unreached_outcome(
                cid,
                "snapshot identity mismatch: asked for %s, body said %s" % (cid, outcome.call_id),
            )
        return outcome

    def poll_until_terminal(self, call_id: str, first_wait: float = 55.0,
                            interval: float = 6.0,
                            timeout: float = 420.0) -> CallOutcome:
        """Wait, then poll until the call reaches a terminal status or the window closes.

        The first wait is long because it was measured: create → terminal runs about
        145–200 s and the snapshot was still ``queued`` at 56 s, so polling earlier only
        spends requests to learn nothing. ``timeout`` is measured from entry and includes
        ``first_wait``.

        On timeout this returns the last outcome it managed to read, with
        ``reached_terminal`` False, and does NOT raise. That is deliberate. A call that
        never reached terminal is a release condition; raising here would turn a decidable
        situation into an exception that some caller could swallow, leaving the lease alive
        because the supervisor got confused. Silence ends the lease.

        The same reasoning covers the broad except below: every path out of this loop
        produces an outcome the policy can only read as "no clean continue was observed", so
        swallowing a read failure here cannot make the system more permissive — it can only
        end the lease slightly earlier than an unhandled traceback would have.
        """
        cid = str(call_id or "").strip()
        if not cid:
            raise ValueError("call_id is required")

        deadline = time.monotonic() + max(0.0, float(timeout))
        last_outcome = None
        last_error = None
        last_status = None

        initial = min(max(0.0, float(first_wait)), max(0.0, deadline - time.monotonic()))
        if initial > 0:
            time.sleep(initial)

        while True:
            try:
                outcome = self.fetch(cid)
                last_outcome = outcome
                if outcome.status != last_status:
                    LOG.info("call %s status=%s", cid, outcome.status or "<unstated>")
                    last_status = outcome.status
                if outcome.reached_terminal:
                    LOG.info(
                        "call %s reached terminal status=%s failure_code=%r",
                        cid,
                        outcome.status,
                        outcome.failure_code,
                    )
                    return outcome
            except ApiError as exc:
                last_error = exc
                if exc.status in _UNRECOVERABLE_READ_STATUSES:
                    # A rejected key will still be rejected at the deadline. Stop early and
                    # let the caller end the lease now rather than after a silent window.
                    LOG.error("poll of %s cannot succeed with this key: %s", cid, redact(str(exc)))
                    break
                LOG.warning("poll of %s failed, will retry: %s", cid, redact(str(exc)))
            except Exception as exc:  # noqa: BLE001 - see the docstring: every exit releases
                last_error = exc
                LOG.warning(
                    "poll of %s failed (%s), will retry: %s",
                    cid,
                    type(exc).__name__,
                    redact(str(exc)),
                )

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(max(0.0, float(interval)), remaining))

        if last_outcome is not None:
            LOG.error(
                "call %s did not reach terminal within %.0fs (last status=%s)",
                cid,
                timeout,
                last_outcome.status,
            )
            return last_outcome

        note = "no snapshot could be read within %.0fs" % timeout
        if last_error is not None:
            note += "; last error: %s" % redact(str(last_error))
        LOG.error("call %s: %s", cid, note)
        return _unreached_outcome(cid, note)

    # -- reconcile -----------------------------------------------------------------------
    def reconcile_after_ambiguous_create(self, idempotency_key: str) -> str | None:
        """Resolve an ambiguous create WITHOUT dialling. Returns a call id, or None.

        There is no list endpoint on this API (``GET /v1/calls`` is 405) and no lookup by
        idempotency key, so the only available probe is a replay of the create under the same
        key — and a replay is exactly the thing that must not be allowed to ring a person.
        The probe is therefore built so that it cannot ring anyone under ANY provider
        behaviour: it replays the key against the un-dialable "+1" recipient.

          * If the provider replays on the key alone and returns the stored response, we get
            the original call id back. That is the only branch that resolves anything, and
            even it is inference rather than proof (see the 2xx handling below).
          * If the provider does not dedupe at all, the request is processed fresh and dies
            on the recipient (``invalid_phone``): nothing is dialled.
          * If the provider fingerprints the payload as well as the key — the more common
            design, and one this probe's payload will not match — the replay is rejected and
            we learn nothing. Nothing is dialled in that branch either.

        Replay semantics are UNVERIFIED against CALL-E; the documentation does not describe
        them and we have not spent a live call to find out. The probe is therefore designed to
        be safe in every branch rather than informative in one, and the branch that identifies
        the original call is a bonus, not the plan.

        This method never raises: it is called when something has already gone wrong, and an
        exception here would strand the lease that its None return is meant to end.

        A None return means UNRESOLVED, not "no call was placed". The correct response to
        None is to end the lease and have a person read the dashboard. Do not create again
        under this key: the probe may have consumed it, so any later call for this job needs
        a fresh lease epoch.
        """
        try:
            key = _validate_idempotency_key(idempotency_key)
        except Exception as exc:  # noqa: BLE001 - a bad key is still an unresolved situation
            LOG.error("reconcile: unusable Idempotency-Key (%s); UNRESOLVED", redact(str(exc)))
            return None

        try:
            payload = _probe_payload()
        except Exception as exc:  # noqa: BLE001 - a template/slot change must not strand this
            LOG.error(
                "reconcile: could not build the no-dial probe payload (%s: %s); UNRESOLVED",
                type(exc).__name__,
                redact(str(exc)),
            )
            return None

        LOG.warning("reconciling ambiguous create under key %s (no dial is possible)", key)

        try:
            status, body = self._call(
                "POST",
                "/v1/calls",
                body=payload,
                idempotency_key=key,
                timeout=self._create_timeout,
            )
        except Exception as exc:  # noqa: BLE001 - includes TransportError; all are unresolved
            LOG.error("reconcile probe failed (%s): %s", type(exc).__name__, redact(str(exc)))
            return None

        if 200 <= status < 300:
            call_id = body.get("id") or body.get("call_id")
            if isinstance(call_id, str) and call_id.strip():
                # A 2xx on an un-dialable recipient should only be reachable as a replay of a
                # response stored under this key, which makes this very probably the original
                # call. It is not proof: if the provider ever accepted the probe itself, this
                # id would be the probe's. Polling settles it — a probe record cannot carry a
                # conversation, so it can only read as "no clean continue was observed".
                LOG.warning(
                    "reconcile: a 2xx under this key returned call %s, which should mean the "
                    "original create landed and is stored under the key. Poll that call, do "
                    "not dial, and confirm it in the dashboard by eye",
                    call_id.strip(),
                )
                return call_id.strip()
            LOG.error("reconcile: HTTP %s with no call id; UNRESOLVED", status)
            return None

        code = _error_code(body)
        if code == "invalid_phone":
            LOG.error(
                "reconcile: the probe was processed as a fresh request, which suggests the key "
                "held no stored response — but it does not prove the create never landed, since "
                "the payload differs and a provider may reject a replay for that alone. "
                "UNRESOLVED: end the lease and check the dashboard by eye."
            )
        else:
            LOG.error(
                "reconcile: UNRESOLVED (HTTP %s, code %r): %s",
                status,
                code,
                redact(_error_message(body)),
            )
        return None
