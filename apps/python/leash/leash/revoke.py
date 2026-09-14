"""leash.revoke -- the end of the lease, and the only evidence of it that survives review.

WHAT THIS MODULE IS FOR
    LEASH lets an unattended agent hold a Google OAuth credential on a lease. When the lease
    ends, this module destroys the credential at Google, and then proves -- from Google's own
    servers, over raw HTTP, with the response body printed verbatim -- that it is destroyed.
    After that the agent cannot mint another access token. Only a human at a browser can.

    prove()   forces one round trip to Google's token endpoint and reports what came back.
    release() revokes the refresh token. It is not undoable from this side of the wire.

WHY RAW urllib AND NOT google-auth
    google.oauth2.Credentials only contacts the token endpoint when its cached access token has
    EXPIRED (~3600 s). The two runs in the demo are about 135 s apart, so a Credentials-based
    check would answer both times out of cache, return success twice, and prove exactly nothing.
    Posting the refresh token ourselves has no cache in front of it: every call to prove() is a
    real network round trip whose answer comes from the machine that owns the record. That
    single fact is why this file exists in this shape.

WHY THE TOKEN ENDPOINT AND NOT A DRIVE CALL
    The token endpoint is the same service the revoke endpoint writes to, so it answers from the
    record that revocation destroys. Drive is different: its front end keeps honouring an
    already-minted access token for an unpredictable while after a revoke, and Google guarantees
    no bound on that. A Drive call would sometimes succeed against a dead lease. Never point the
    camera, or a test assertion, at Drive.

THE THREE ANSWERS, AND WHY THE THIRD ONE MATTERS MORE THAN IT LOOKS
    HTTP 200                          -> lease alive. Body carries expires_in.
    HTTP 400 "invalid_grant"          -> lease released. The agent is out of capability.
    HTTP 401 "invalid_client"         -> our own client id/secret pair is broken or rotated.
    The third one renders on screen as a red failure just like the second, and a casual viewer
    cannot tell them apart -- but an OAuth-literate reviewer can, and reads it as a
    misconfiguration dressed up as a result. format_proof() therefore labels it loudly and
    refuses to call it a release. Truthfulness here is a credibility question, not a cosmetic
    one. Anything else at all is UNKNOWN: this module never guesses in either direction.

WHAT THIS MODULE CANNOT TELL YOU, STATED HERE SO NOBODY HAS TO INFER IT
    A 400 "invalid_grant" is the same body whether the phone call ended the lease, the refresh
    token aged out on its own, or someone revoked it in another window. The proof is therefore
    always a PAIR: an ALIVE run and, minutes later, a RELEASED run, with request_body_sha256()
    identical across the two so it is visibly the same credential and the same request. One
    RELEASED block on its own is not evidence, and format_proof() says so on screen.

VOCABULARY
    LEASH's own words for the two outcomes are "continue" and "release". The strings
    "grant_type" and "invalid_grant" in this file are Google's wire vocabulary from RFC 6749,
    quoted verbatim because the protocol requires the first and returns the second. They are the
    protocol's words rather than LEASH's, and that word appears nowhere outside those two
    literals and this note.

SECRECY
    No library function here prints. They return strings and the caller decides where those go;
    the rehearsal entry point at the bottom of the file is the only code that writes to a
    terminal, and the only values it writes are redacted bodies, sha256 fingerprints, file
    paths, status codes and timings. Response bodies are scrubbed twice before they are stored
    on a ProofResult: the two values this run actually holds (the client secret and the refresh
    token) are removed by exact match, and anything Google returns is removed both by JSON key
    and by pattern, over every byte, including bodies that are not JSON at all. No phone number
    ever reaches this module; masking those is the call side's job.

REHEARSAL COMMAND (nothing is sent without an explicit flag)
    python -m leash.revoke --lease ~/leash/token.json            # shows what WOULD be sent
    python -m leash.revoke --lease ~/leash/token.json --prove    # read-only round trip
    python -m leash.revoke --lease ~/leash/token.json --release --yes
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import http.client
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

# --------------------------------------------------------------------------------------------
# CONSTANTS
# --------------------------------------------------------------------------------------------

TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"

FORM_HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}

LEASE_KEYS = ("client_id", "client_secret", "refresh_token")

DEFAULT_LEASE_PATH = "~/leash/token.json"
DEFAULT_TIMEOUT = 45.0

# Revoking an already-revoked token is a no-op that returns 400 invalid_token, so retrying a
# release that failed in transport is safe in the only direction that matters: more revocation,
# never less. prove() deliberately does NOT retry -- a retried proof invites the question of
# which attempt is on screen.
RELEASE_ATTEMPTS = 3
RELEASE_BACKOFF_SECONDS = (1.5, 3.0)

# A response body longer than this is a proxy error page or a captive portal, not Google.
MAX_BODY_CHARS = 4000

# Every masking replacement starts with this, and every truncation note contains that one, so
# "was this text altered" is a substring test over the text itself rather than a second parallel
# flag that could drift out of step with what is on screen. body_is_byte_literal() is the only
# thing standing between a cut-down body and a caption claiming nothing was removed.
_REDACTED_MARK = "<REDACTED"
_TRUNCATION_MARK = "[truncated by leash.revoke"

_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com"

_SENSITIVE_JSON_KEYS = ("access_token", "refresh_token", "id_token", "client_secret", "token")

# Last-resort sweeps. These run over every byte of every body, including bodies that are not
# JSON at all, so that a traceback or an HTML error page cannot leak what the parser missed.
_SWEEPS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"ya29\.[A-Za-z0-9._\-]{20,}"), "<REDACTED:access_token>"),
    (re.compile(r"(?<![A-Za-z0-9])1//[A-Za-z0-9_\-]{20,}"), "<REDACTED:refresh_token>"),
    (re.compile(r"GOCSPX-[A-Za-z0-9._\-]{10,}"), "<REDACTED:client_secret>"),
    (re.compile(r"(?<![A-Za-z0-9])eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+"),
     "<REDACTED:id_token>"),
)

# urllib only wraps failures raised while OPENING the connection in URLError. A timeout or a
# reset during response.read() escapes as a bare TimeoutError/OSError, and an early close as an
# http.client.HTTPException. Observed the hard way: a read timeout used to leave a traceback on
# screen instead of the deliberate "this is not a lease state" message.
_TRANSPORT_ERRORS = (urllib.error.URLError, http.client.HTTPException, OSError)

_RULE = "-" * 92


# --------------------------------------------------------------------------------------------
# ERRORS
# --------------------------------------------------------------------------------------------

class LeaseError(Exception):
    """The lease file is missing, unreadable, or not shaped like a lease.

    Raised before any network call. The message names the exact file and the exact key that is
    wrong, and never contains a value from the file.
    """


class ProofUnavailable(RuntimeError):
    """Google's token endpoint could not be reached at all.

    This is not a lease state. A timeout, a DNS failure or a TLS failure says nothing about
    whether the credential is alive, and callers must not treat it as either answer.
    """


class ReleaseUnconfirmed(RuntimeError):
    """The revoke request never produced an HTTP response, after retries.

    The revocation may or may not have happened. The way to find out is prove(): a released
    lease answers 400 at the token endpoint regardless of what the revoke call looked like.
    """


# --------------------------------------------------------------------------------------------
# REDACTION AND FINGERPRINTS
# --------------------------------------------------------------------------------------------

def fingerprint(value: str) -> str:
    """First 16 hex characters of the sha256 of a value.

    This is how two runs are shown to have used the SAME refresh token without the token ever
    being displayed. Sixteen hex characters of sha256 over a high-entropy secret is not
    reversible and is safe to put on screen.
    """
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _mask_value(value: str) -> str:
    return f"{_REDACTED_MARK} len={len(value)} sha256:{fingerprint(value)}>"


def redact(text: str, extra: Iterable[str] = ()) -> str:
    """Scrub secrets out of arbitrary text. Safe to call on anything, including empty strings.

    `extra` holds values known to this run (the client secret, the refresh token) which are
    removed by exact match first, because a pattern can always be one format change behind
    what Google actually issues.
    """
    if not text:
        return text
    out = text
    for secret in sorted({s for s in extra if isinstance(s, str) and len(s) >= 8},
                         key=len, reverse=True):
        out = out.replace(secret, _mask_value(secret))
    for pattern, replacement in _SWEEPS:
        out = pattern.sub(replacement, out)
    return out


def _json_or_empty(text: str) -> dict:
    try:
        value = json.loads(text)
    except Exception:  # noqa: BLE001 - any parse failure means "treat as opaque text"
        return {}
    return value if isinstance(value, dict) else {}


def _error_code(text: str) -> str | None:
    """Google's machine-readable error code out of a body, JSON or not.

    One implementation, used both by prove() when it decides `misconfigured` and by
    ProofResult.error_code when it renders. Two implementations would eventually disagree, and
    the disagreement would show up as a MISCONFIGURED client being captioned something else.
    """
    value = _json_or_empty(text).get("error")
    if isinstance(value, str) and value:
        return value
    # Fallback for a truncated, wrapped or non-JSON body: the code is still worth recovering,
    # and a missing verdict is worse than a regex.
    match = re.search(r'"error"\s*:\s*"([A-Za-z0-9_\-]+)"', text or "")
    return match.group(1) if match else None


def _body_marks(body: str) -> tuple[bool, bool]:
    """(was anything masked, was anything cut). Both read off markers inside the text."""
    return (_REDACTED_MARK in body, _TRUNCATION_MARK in body)


def _render_body(raw: str, extra_secrets: Iterable[str] = ()) -> str:
    """Turn a raw response body into something printable that is still honest.

    The rule: if nothing needed masking, the text is returned COMPLETELY UNTOUCHED -- not
    re-indented, not re-serialised -- so the 400 that ends the demo is genuinely the bytes
    Google sent. Only a body that actually contains a secret (a 200 carries an access token) is
    parsed, masked and re-indented. Either alteration -- masking, or cutting an absurdly long
    body -- leaves a marker in the text, and _body_marks() reads those markers back so the
    caption on screen always matches what was actually done.
    """
    swept = redact(raw, extra_secrets)
    obj = _json_or_empty(raw)
    needs_mask = any(isinstance(obj.get(k), str) and obj[k] for k in _SENSITIVE_JSON_KEYS)

    if not needs_mask:
        rendered = swept  # equals `raw` byte for byte when the sweeps found nothing
    else:
        masked = {k: (_mask_value(v) if k in _SENSITIVE_JSON_KEYS and isinstance(v, str) and v
                      else v)
                  for k, v in obj.items()}
        # json.loads preserves key order, so the rendering keeps Google's. The sweeps run again
        # over the result in case a key this module does not know about held a token-shaped value.
        rendered = redact(json.dumps(masked, indent=2), extra_secrets)

    if len(rendered) > MAX_BODY_CHARS:
        rendered = (rendered[:MAX_BODY_CHARS]
                    + f"\n... {_TRUNCATION_MARK}, {len(rendered)} characters total]")
    return rendered


# --------------------------------------------------------------------------------------------
# THE RESULT
# --------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class ProofResult:
    """One forced round trip to Google's token endpoint.

    `body` is already redacted; it is the only representation of the response this module keeps.
    `alive` and `misconfigured` are the two facts a caller must never have to derive itself.
    Everything else below is derived from `body` on demand.
    """

    http_status: int
    body: str
    latency_ms: float
    alive: bool
    misconfigured: bool
    observed_at: str

    @property
    def error_code(self) -> str | None:
        """Google's machine-readable error code, or None on a 200 or an unparseable body."""
        return _error_code(self.body)

    @property
    def released(self) -> bool:
        """True only for the exact answer that means the lease is gone."""
        return self.http_status == 400 and self.error_code == "invalid_grant"

    @property
    def expires_in(self) -> int | None:
        value = _json_or_empty(self.body).get("expires_in")
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        match = re.search(r'"expires_in"\s*:\s*(\d+)', self.body)
        return int(match.group(1)) if match else None

    @property
    def body_is_byte_literal(self) -> bool:
        """True when nothing was masked and nothing was cut: `body` is what came off the wire."""
        masked, truncated = _body_marks(self.body)
        return not masked and not truncated

    @property
    def verdict(self) -> str:
        """ALIVE | RELEASED | MISCONFIGURED | UNKNOWN. UNKNOWN is a refusal to guess."""
        if self.misconfigured:
            return "MISCONFIGURED"
        if self.alive:
            return "ALIVE"
        if self.released:
            return "RELEASED"
        return "UNKNOWN"


# --------------------------------------------------------------------------------------------
# THE LEASE FILE
# --------------------------------------------------------------------------------------------

def load_lease(path: str | os.PathLike[str]) -> dict:
    """Read {client_id, client_secret, refresh_token} from a JSON file.

    Accepts two real-world shapes: the three keys flat at the top level (which is what
    google-auth-oauthlib writes into token.json), or a Desktop-app client file whose "installed"
    section supplies the client pair while the refresh token sits at the top level.

    Every failure names the exact file and the exact key. No value from the file is ever put
    into an error message.
    """
    resolved = os.path.abspath(os.path.expanduser(os.fspath(path)))

    if not os.path.exists(resolved):
        raise LeaseError(
            f"lease file not found: {resolved}\n"
            f"  A lease is a JSON file holding client_id, client_secret and refresh_token.\n"
            f"  The refresh token only exists after a human completes consent in a browser;\n"
            f"  the consent flow writes it to token.json. Point --lease at that file, or run\n"
            f"  the consent flow again to mint a new one."
        )
    try:
        with open(resolved, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise LeaseError(
            f"lease file is not valid JSON: {resolved}\n"
            f"  Parser said: {exc.msg} at line {exc.lineno} column {exc.colno}.\n"
            f"  If the file is empty or starts with '<', a download failed and saved an error\n"
            f"  page instead. Replace it and re-run."
        ) from exc
    except OSError as exc:
        raise LeaseError(f"lease file could not be read: {resolved}\n  {exc.strerror}") from exc

    if not isinstance(data, dict):
        raise LeaseError(
            f"lease file does not contain a JSON object: {resolved}\n"
            f"  Expected a single object with client_id, client_secret and refresh_token."
        )

    if "web" in data and "installed" not in data:
        raise LeaseError(
            f"lease file is a WEB application OAuth client: {resolved}\n"
            f"  Its top-level key is \"web\"; LEASH needs a Desktop app client, whose top-level\n"
            f"  key is \"installed\". A web client cannot complete the loopback consent flow,\n"
            f"  because the flow asks the operating system for a random free port and no\n"
            f"  pre-registered redirect URI can ever match it.\n"
            f"  Fix: create a new client with Application type 'Desktop app', download its JSON,\n"
            f"  and run consent again."
        )

    installed = data.get("installed") if isinstance(data.get("installed"), dict) else {}
    picked = {key: (data.get(key) or installed.get(key)) for key in LEASE_KEYS}

    missing = [key for key in LEASE_KEYS
               if not isinstance(picked[key], str) or not picked[key].strip()]
    if missing:
        detail = ", ".join(missing)
        raise LeaseError(
            f"lease file is missing {len(missing)} required key(s): {detail}\n"
            f"  File: {resolved}\n"
            f"  Required keys: {', '.join(LEASE_KEYS)} (top level, or client_id/client_secret\n"
            f"  inside an \"installed\" section).\n"
            f"  A file with client_id and client_secret but no refresh_token is the client\n"
            f"  definition, not a lease. The refresh token is minted by the consent flow and\n"
            f"  needs both access_type=offline and prompt=consent, or it comes back empty."
        )

    lease = {key: picked[key].strip() for key in LEASE_KEYS}

    if _looks_like_access_token(lease["refresh_token"]):
        # Caught here rather than at Google, because sending an access token to the token
        # endpoint returns 400 invalid_grant -- byte-identical to a real release, and therefore
        # a failure that would look like a success on camera. _require_lease() repeats this
        # check for leases built in code rather than read from disk.
        raise LeaseError(
            f"lease file has an ACCESS token where the refresh token belongs: {resolved}\n"
            f"  The value under \"refresh_token\" begins with the access-token prefix.\n"
            f"  Sending it to the token endpoint returns exactly the same 400 as a released\n"
            f"  lease, so this would silently fake the whole proof. Re-run consent."
        )
    return lease


def _looks_like_access_token(value: str) -> bool:
    return value.startswith("ya29.")


def lease_summary(lease: dict) -> str:
    """A one-block description of a lease with nothing secret in it.

    The client id is public by OAuth's design, but only its tail is shown so a paused frame
    cannot be transcribed into a working project reference. The constant
    ".apps.googleusercontent.com" suffix carries no information, so the tail is taken from the
    part before it -- the literal last six characters of the whole string would be identical for
    every client on Earth and would identify nothing between takes.
    """
    _require_lease(lease)
    client_id = lease["client_id"]
    core = (client_id[:-len(_CLIENT_ID_SUFFIX)]
            if client_id.endswith(_CLIENT_ID_SUFFIX) else client_id)
    tail = core[-6:] if core else "(empty)"
    suffix = _CLIENT_ID_SUFFIX if client_id.endswith(_CLIENT_ID_SUFFIX) else ""
    return "\n".join((
        "LEASE (redacted)",
        f"  client_id     : ...{tail}{suffix}",
        f"  client_secret : sha256:{fingerprint(lease['client_secret'])}  "
        f"(len {len(lease['client_secret'])})",
        f"  refresh_token : sha256:{fingerprint(lease['refresh_token'])}  "
        f"(len {len(lease['refresh_token'])})",
        "  The two fingerprints are the proof that a later run used the same credential as an",
        "  earlier one. Compare them across runs; never compare the values.",
    ))


def git_worktree_containing(path: str | os.PathLike[str]) -> str | None:
    """Return the repository root if the lease file sits inside a git worktree, else None.

    A refresh token in a public pull request is a live credential anyone can revoke out from
    under the demo, and deleting the file afterwards does not undo it -- the client has to be
    deleted and recreated. Callers decide how to surface it; this function only reports.

    os.path.exists rather than os.path.isdir, because in a linked worktree or a submodule .git
    is a FILE pointing elsewhere, and an isdir test would quietly declare that checkout safe.
    """
    current = os.path.dirname(os.path.abspath(os.path.expanduser(os.fspath(path))))
    while True:
        if os.path.exists(os.path.join(current, ".git")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def _require_lease(lease: dict) -> dict:
    """Fail loudly on a hand-built lease dict before anything reaches the network.

    Blank fields would reach Google as an empty client secret and come back 401 invalid_client,
    which looks like a broken project rather than a caller bug and costs a take to diagnose.
    The access-token check is the one that matters most: a lease assembled in code (a test, a
    supervisor wiring mistake) with an access token in the refresh_token slot makes prove()
    return 400 invalid_grant against a perfectly live lease, which is the one failure this
    module exists to make impossible.
    """
    if not isinstance(lease, dict):
        raise LeaseError(f"lease must be a dict with {', '.join(LEASE_KEYS)}; got "
                         f"{type(lease).__name__}")
    missing = [key for key in LEASE_KEYS
               if not isinstance(lease.get(key), str) or not lease[key].strip()]
    if missing:
        raise LeaseError(f"lease dict is missing or blank at: {', '.join(missing)}. "
                         f"Required keys: {', '.join(LEASE_KEYS)}.")
    if _looks_like_access_token(lease["refresh_token"].strip()):
        raise LeaseError(
            "lease dict carries an ACCESS token in the refresh_token slot. Refusing to send "
            "it: the token endpoint answers 400 invalid_grant for that, which is byte-identical "
            "to a released lease and would fake the proof."
        )
    return lease


# --------------------------------------------------------------------------------------------
# RAW HTTP
# --------------------------------------------------------------------------------------------

def _post_form(url: str, fields: dict[str, str], *, timeout: float) -> tuple[int, str, float]:
    """One form-encoded POST. Returns (http_status, raw_body_text, latency_ms).

    urllib.parse.urlencode percent-encodes every value. That is not a detail: a refresh token
    starts with '1//' and a client secret contains '-' and '_', and a shell pipeline that does
    not encode them produces a 400 that is indistinguishable on camera from a real release.
    A 4xx or 5xx is an ANSWER here, not an exception -- only a transport failure raises, and
    callers turn that into a named exception rather than a lease state.
    """
    data = urllib.parse.urlencode(fields).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers=dict(FORM_HEADERS))
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read()
    latency_ms = (time.perf_counter() - started) * 1000.0
    return status, raw.decode("utf-8", "replace"), latency_ms


def _transport_reason(exc: BaseException) -> str:
    """A human sentence for a failure that produced no HTTP status at all."""
    reason = getattr(exc, "reason", exc)
    text = str(reason) or type(reason).__name__
    if isinstance(reason, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in text:
        return (f"TLS certificate verification failed ({text}). On macOS this is usually the "
                f"python.org installer's missing root certificates, not a Google problem: run "
                f"/Applications/Python*/Install\\ Certificates.command, or "
                f"python3 -m pip install --upgrade certifi.")
    if isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError):
        return f"the round trip timed out before Google answered ({text})"
    return f"{type(exc).__name__}: {text}"


def _token_request_fields(lease: dict) -> dict[str, str]:
    _require_lease(lease)
    return {
        "client_id": lease["client_id"],
        "client_secret": lease["client_secret"],
        "refresh_token": lease["refresh_token"],
        # RFC 6749 wire vocabulary, quoted verbatim because the protocol demands this exact
        # key and value. See the VOCABULARY note at the top of this file.
        "grant_type": "refresh_token",
    }


def request_body_sha256(lease: dict) -> str:
    """Fingerprint of the exact bytes prove() will send.

    Printed either side of a release to show that the two runs were byte-identical requests --
    same client, same token, same encoding -- so the only thing that changed between a 200 and a
    400 was the phone call. The digest is over a high-entropy body and reveals nothing.
    """
    body = urllib.parse.urlencode(_token_request_fields(lease)).encode("utf-8")
    return hashlib.sha256(body).hexdigest()[:16]


# --------------------------------------------------------------------------------------------
# THE PROOF
# --------------------------------------------------------------------------------------------

def prove(lease: dict, *, timeout: float = DEFAULT_TIMEOUT) -> ProofResult:
    """Force one round trip to Google's token endpoint and report exactly what came back.

    This never reads a cached access token, never inspects an expiry field, and never branches
    on whether a credential "looks" expired. It posts the refresh token every single time, so
    the answer is always current and always Google's, and two runs 135 seconds apart cannot
    both come back green off a cache.

    A successful call mints an access token as a side effect. That token is masked out of the
    stored body and then dropped on the floor -- this module never uses it for anything.
    Spending it against Drive would be the wrong surface entirely, since Drive keeps honouring
    already-minted tokens for an unbounded while after a release.

    Raises ProofUnavailable if Google could not be reached, including a timeout part-way
    through reading the reply. That is not an answer, and callers must not read it as one in
    either direction.
    """
    fields = _token_request_fields(lease)
    # Stamped at dispatch; latency_ms below covers the wait, so dispatch + latency is the
    # instant Google answered.
    observed_at = _utc_now()
    try:
        status, raw, latency_ms = _post_form(TOKEN_ENDPOINT, fields, timeout=timeout)
    except _TRANSPORT_ERRORS as exc:
        raise ProofUnavailable(
            f"could not reach {TOKEN_ENDPOINT}: {_transport_reason(exc)}\n"
            f"  This says nothing about whether the lease is alive. Fix the network and re-run; "
            f"do not record or report a lease state from a failed round trip."
        ) from exc

    parsed = _json_or_empty(raw)
    error_code = _error_code(raw)

    # ALIVE demands both the status and an actual token in the body. A 200 with no access_token
    # is not a live lease, it is an unrecognised response, and it must fall through to UNKNOWN.
    alive = status == 200 and isinstance(parsed.get("access_token"), str) \
        and bool(parsed["access_token"])

    # Google returns invalid_client as 401 in every observation we have. The check is on the
    # error code rather than the status so that a future 400 invalid_client is still called what
    # it is -- a broken configuration -- instead of being mistaken for a release. It reads the
    # code through the same helper the renderer uses, so a body that only the regex can parse
    # still gets labelled MISCONFIGURED rather than silently becoming UNKNOWN.
    misconfigured = error_code == "invalid_client"

    return ProofResult(
        http_status=status,
        body=_render_body(raw, (lease["client_secret"], lease["refresh_token"])),
        latency_ms=latency_ms,
        alive=alive,
        misconfigured=misconfigured,
        observed_at=observed_at,
    )


# --------------------------------------------------------------------------------------------
# THE RELEASE
# --------------------------------------------------------------------------------------------

def release(lease: dict, *, timeout: float = DEFAULT_TIMEOUT) -> tuple[int, str]:
    """Revoke the refresh token. Returns (http_status, redacted_body).

    The REFRESH token is the one sent, not an access token: revoking a refresh token destroys
    the consent record itself, which is what stops the agent minting anything ever again.
    Revoking an access token would only kill that one token and would leave the lease intact,
    while still answering 200 -- which is why _require_lease() refuses a ya29 value outright.

    Success is HTTP 200 with an empty body, or HTTP 400 invalid_token, which means Google has
    already forgotten this token -- an already-released lease is a released lease. Use
    release_is_final() rather than testing the status by hand.

    Transport failures and 5xx replies are retried, because a second revoke is harmless and the
    safe direction of error here is more revocation, never less. The last HTTP reply is returned
    whatever it says; ReleaseUnconfirmed is raised only when no attempt got an HTTP reply at all,
    and prove() is then how you find out what actually happened.

    One revoke ends the consent record for every OAuth client in the same Google Cloud project.
    That is a property of Google's consent model, not of this code.
    """
    _require_lease(lease)
    last_reason = ""
    last_response: tuple[int, str] | None = None
    for attempt in range(RELEASE_ATTEMPTS):
        try:
            status, raw, _ = _post_form(
                REVOKE_ENDPOINT, {"token": lease["refresh_token"]}, timeout=timeout)
        except _TRANSPORT_ERRORS as exc:
            last_reason = _transport_reason(exc)
        else:
            body = _render_body(raw, (lease["client_secret"], lease["refresh_token"]))
            last_response = (status, body)
            if release_is_final(status, body) or status < 500:
                return status, body
            # 5xx: Google did not commit anything, and a repeat costs nothing.
            last_reason = f"HTTP {status} from {REVOKE_ENDPOINT}"
        if attempt < len(RELEASE_BACKOFF_SECONDS):
            time.sleep(RELEASE_BACKOFF_SECONDS[attempt])
    if last_response is not None:
        return last_response  # a persistent 5xx is an answer; format_release calls it unconfirmed
    raise ReleaseUnconfirmed(
        f"{RELEASE_ATTEMPTS} attempts to POST {REVOKE_ENDPOINT} produced no HTTP reply at all. "
        f"Last: {last_reason}\n"
        f"  The revocation may still have happened. Do not assume either way: call prove(). "
        f"A released lease answers HTTP 400 at the token endpoint no matter how the revoke "
        f"request looked."
    )


def release_is_final(http_status: int, body: str) -> bool:
    """True when Google has no usable record of this token left.

    400 invalid_token counts. It means the token was already revoked, which is the same world
    state as a fresh 200 and must not be reported as a failure.
    """
    if http_status == 200:
        return True
    return http_status == 400 and _error_code(body) == "invalid_token"


# --------------------------------------------------------------------------------------------
# RENDERING
# --------------------------------------------------------------------------------------------

def _utc_now() -> str:
    return (datetime.datetime.now(datetime.timezone.utc)
            .isoformat(timespec="milliseconds").replace("+00:00", "Z"))


def _body_block(body: str) -> list[str]:
    """The response body, under a caption that describes exactly what was done to it."""
    masked, truncated = _body_marks(body)
    if not masked and not truncated:
        lines = ["  ---- RESPONSE BODY: BYTE-LITERAL, NOTHING REMOVED, NOTHING ADDED ----"]
    else:
        lines = ["  ---- RESPONSE BODY, ALTERED BY leash.revoke ----"]
        if masked:
            lines.append("       secret values replaced with a length and a sha256; a JSON")
            lines.append("       body that carried one is also re-indented")
        if truncated:
            lines.append(f"       longer than {MAX_BODY_CHARS} characters, so the tail was cut")
        lines.append("       every other byte is exactly what Google sent")
    if not body.strip():
        lines.append("      (empty body)")
    else:
        lines.extend("      " + line for line in body.splitlines())
    lines.append("  ---- end of body ----")
    return lines


def format_proof(p: ProofResult) -> str:
    """The on-camera block for one round trip: request, status, latency, body, verdict.

    Read aloud from top to bottom it answers the three questions a sceptic asks in order --
    what did you ask, who answered, and what did they say -- and then commits to one verdict.
    """
    lines = [
        _RULE,
        f"LEASH PROOF    POST {TOKEN_ENDPOINT}",
        "  form fields : client_id, client_secret, refresh_token, grant_type=refresh_token",
        "                (percent-encoded; secret values are not shown)",
        f"  sent at     : {p.observed_at}",
        f"  status      : HTTP {p.http_status}",
        f"  latency     : {p.latency_ms:.0f} ms",
        "",
    ]
    lines.extend(_body_block(p.body))
    lines.append("")

    if p.verdict == "ALIVE":
        if p.expires_in is not None:
            lines.extend([
                f"  expires_in  : {p.expires_in}",
                "                That is the lifetime in seconds of the access token Google "
                "just minted,",
                "                which this module reads once for this line and then throws "
                "away. It says",
                "                nothing about the refresh token, so do not narrate it as a "
                "countdown on",
                "                the lease.",
                "",
            ])
        else:
            lines.extend([
                "  expires_in  : absent from the body above. Read the raw response before "
                "relying on",
                "                this run; a 200 without expires_in is not the shape we have "
                "observed.",
                "",
            ])
        lines.append("  VERDICT: LEASE ALIVE. Google minted a fresh access token for this "
                     "refresh token,")
        lines.append("           so the agent still holds capability at this instant.")
    elif p.verdict == "RELEASED":
        lines.append("  VERDICT: LEASE RELEASED. Google will not mint for this refresh token "
                     "again. The")
        lines.append("           agent cannot recover it; only a human at a browser can start "
                     "a new one.")
        lines.append("           This block is evidence only as half of a pair. It means "
                     "something because a")
        lines.append("           run minutes earlier sent the same request body sha256 and got "
                     "HTTP 200.")
        lines.append("           Caveat this program cannot check for you: an app left in "
                     "Testing mode issues")
        lines.append("           credentials that die of old age after seven days with a body "
                     "identical to the")
        lines.append("           one above. What rules that out is the minutes-not-days gap "
                     "between the two")
        lines.append("           runs, plus a publishing status of In production on the "
                     "Audience page --")
        lines.append("           read that off the console rather than taking this line's word "
                     "for it.")
    elif p.verdict == "MISCONFIGURED":
        lines.append("  VERDICT: MISCONFIGURED CLIENT. THIS IS NOT A RELEASE.")
        lines.append("           Google says the client id and secret pair is not usable -- "
                     "rotated, deleted,")
        lines.append("           or from a different project. The lease state is UNKNOWN and "
                     "nothing here")
        lines.append("           demonstrates anything. Do not record it and do not report it "
                     "as a release:")
        lines.append("           it looks like one on screen and reads as a broken setup to "
                     "anyone who knows")
        lines.append("           OAuth. Fix the client file, re-run consent, prove ALIVE first, "
                     "then start over.")
    else:
        lines.append("  VERDICT: UNRECOGNISED RESPONSE. Treat as no evidence in either "
                     "direction.")
        lines.append(f"           HTTP {p.http_status}"
                     + (f", error {p.error_code!r}" if p.error_code else "")
                     + ". Read the body above before doing anything else.")
    lines.append(_RULE)
    return "\n".join(lines)


def format_release(http_status: int, body: str) -> str:
    """The on-camera block for the revoke request itself.

    Deliberately understated. The revoke call is the action; it is not the evidence. The
    evidence is the next prove(), and this block says so in its last line.
    """
    final = release_is_final(http_status, body)
    lines = [
        _RULE,
        f"LEASH RELEASE  POST {REVOKE_ENDPOINT}",
        "  form fields : token=<the refresh token, percent-encoded, not shown>",
        f"  sent at     : {_utc_now()}",
        f"  status      : HTTP {http_status}",
        "",
    ]
    lines.extend(_body_block(body))
    lines.append("")
    if http_status == 200:
        lines.append("  RELEASE ACCEPTED. HTTP 200 with an empty body is Google's whole reply "
                     "here.")
    elif final:
        lines.append("  ALREADY RELEASED. HTTP 400 invalid_token means Google has no record of "
                     "this token")
        lines.append("  left to destroy. That is the intended end state, not a failure.")
    else:
        lines.append("  NOT CONFIRMED. This status is neither 200 nor 400 invalid_token, so the "
                     "revoke")
        lines.append("  cannot be assumed to have committed.")
    lines.append("  A release is only proven at the token endpoint. Run prove() next and expect "
                 "HTTP 400.")
    lines.append(_RULE)
    return "\n".join(lines)


# --------------------------------------------------------------------------------------------
# REHEARSAL ENTRY POINT
# --------------------------------------------------------------------------------------------

_DRY_RUN_NOTE = """NOTHING WAS SENT.
  This run only read the lease file. Add --prove for the read-only round trip against
  {endpoint}, which is safe to repeat as often as you like.
  Add --release --yes to destroy the credential, which is not.
  Request body sha256: {digest}  (identical bytes in every run that uses this lease)"""


def _main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m leash.revoke",
        description=("Prove a Google OAuth lease is alive, or release it. No network call "
                     "happens without an explicit flag."),
        epilog=("exit codes: 0 clean, 2 bad lease file or refused, 3 Google unreachable, "
                "4 misconfigured client, 5 unrecognised or unconfirmed"),
    )
    parser.add_argument("--lease", default=DEFAULT_LEASE_PATH,
                        help=f"path to the lease JSON file (default: {DEFAULT_LEASE_PATH})")
    parser.add_argument("--prove", action="store_true",
                        help="contact Google's token endpoint. Read-only, repeatable.")
    parser.add_argument("--release", action="store_true",
                        help=("revoke the refresh token, then prove it. Ends the consent record "
                              "for every client in the Google Cloud project, and only a human "
                              "at a browser can start a new one."))
    parser.add_argument("--yes", action="store_true", help="required alongside --release")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    try:
        lease = load_lease(args.lease)
    except LeaseError as exc:
        print(str(exc))
        return 2

    print(lease_summary(lease))
    repo_root = git_worktree_containing(args.lease)
    if repo_root:
        print(f"\nWARNING: this lease file sits inside the git worktree at {repo_root}.\n"
              f"  It holds a live credential. Confirm it is ignored before any push: a token in "
              f"a public\n  diff can be revoked by a stranger, and deleting the file afterwards "
              f"does not undo that --\n  the OAuth client has to be deleted and recreated.")

    if not (args.prove or args.release):
        print("\n" + _DRY_RUN_NOTE.format(endpoint=TOKEN_ENDPOINT,
                                          digest=request_body_sha256(lease)))
        return 0

    if args.release and not args.yes:
        print("\nRefusing to release without --yes. Re-run with --release --yes once the camera "
              "is rolling.")
        return 2

    # An unconfirmed revoke is not a reason to skip the proof -- it is the reason to run it. The
    # token endpoint answers 400 for a released lease however the revoke request itself looked,
    # so the run continues and the exit code comes from Google rather than from our transport.
    unconfirmed = False
    if args.release:
        try:
            status, body = release(lease, timeout=args.timeout)
        except ReleaseUnconfirmed as exc:
            unconfirmed = True
            print(f"\n{exc}")
        else:
            print("\n" + format_release(status, body))

    try:
        proof = prove(lease, timeout=args.timeout)
    except ProofUnavailable as exc:
        print(f"\n{exc}")
        return 3

    print("\n" + format_proof(proof))
    print(f"\nrequest body sha256: {request_body_sha256(lease)}")

    if proof.verdict == "MISCONFIGURED":
        return 4
    if args.release:
        if not proof.released:
            return 5
        if unconfirmed:
            print("\nThe revoke request never got an HTTP reply, but the token endpoint now "
                  "answers 400\ninvalid_grant for this same request body. That is the only "
                  "evidence that counts, so\nthe lease is recorded as released.")
        return 0
    return 0 if proof.verdict in ("ALIVE", "RELEASED") else 5


if __name__ == "__main__":
    raise SystemExit(_main())
