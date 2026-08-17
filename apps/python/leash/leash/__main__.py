"""LEASH operator CLI - the call that can only take capability away.

An unattended agent holds a Google OAuth refresh credential on a lease. When the lease expires the
supervisor places one real phone call to the account owner, whose only power is to end the lease.
Ending it revokes the credential at Google's token endpoint; the agent cannot mint another without
a human sitting at a browser. The call cannot hand the agent anything back.

"continue" is not a decision the call can manufacture - it is the absence of a release, and it
requires every condition in leash.policy to hold at once. "stop" requires one. So does a machine
answering, a structured result that disagrees with its own transcript, a call that never reaches a
terminal status, or this process failing.

Usage (the package is the entry point):

    python -m leash prove     --lease lease.json
    python -m leash demo      --scenario continue_clean
    python -m leash demo      --list-scenarios
    python -m leash preflight --api-key-file calle-key.txt
    python -m leash live      --i-understand-this-places-a-real-call \\
                              --api-key-file calle-key.txt \\
                              --phone-file my-phone.txt \\
                              --lease lease.json

Default safety: `demo` talks to a local fake server - no API key, no credits, no phone call, and no
contact with Google. Only `live` dials, and only `live` and `prove` read the lease file.

Exit codes:

    0   the lease continues (nothing was taken away; for `prove`, the credential is alive)
    2   the lease was released (for `prove`, Google refuses the credential; for `demo`, the
        rehearsal ended in a release - nothing real was revoked)
    3   operator error, misconfiguration, or an outcome this program cannot prove - a bad command
        line, a broken OAuth client, a release that did not take, or a release whose result could
        not be re-checked. Nothing here is a statement about the lease.

Exit code 2 is deliberately the same code argparse uses for a bad command line, so this module
overrides argparse to exit 3 instead: an operator typo must never be mistaken for a revocation.
For the same reason there is a catch-all in main(): an unhandled failure would otherwise leave
Python to exit 1, a code this CLI never defines, and an undefined code next to a revocation demo
is worse than a loud 3.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import sys
import textwrap
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    # WHY: this CLI is typed on camera. "python leash/__main__.py" would otherwise die on the
    # relative imports below. PEP 366 shim so both that and "python -m leash" work.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import leash  # noqa: F401  - puts the package in sys.modules for the relative imports

    __package__ = "leash"

from .fakecalle import SCENARIOS, FakeCalle
from .outcomes import CallOutcome, Verdict
from .policy import evaluate
from .revoke import ProofResult, load_lease, prove, release
from .supervisor import CREATE_TIMEOUT_SECONDS, RESULT_SCHEMA, Supervisor
from .templates import (
    TASK_TEMPLATE_SHA256,
    TaskRefused,
    assert_task_is_clean,
    render_task,
    template_sha256,
)

EXIT_CONTINUES = 0
EXIT_RELEASED = 2
EXIT_OPERATOR = 3

WIDTH = 92
DEFAULT_MIN_CONFIDENCE = 0.80
DEFAULT_JOURNAL = Path(".leash") / "journal.jsonl"

# A call takes 145 to 200 seconds to reach a terminal status (measured live). A timeout shorter
# than that would revoke the credential while the owner is still speaking, so the knob has a floor.
MIN_LIVE_TIMEOUT = 240.0
MIN_POLL_INTERVAL = 2.0

TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"


# --------------------------------------------------------------------------------------------
# Redaction. Defined here rather than imported: the frozen interface contract gives these helpers
# no home module, and __main__ is the only place in the package that writes to a terminal.
# --------------------------------------------------------------------------------------------

_SECRET_FIELDS = ("access_token", "refresh_token", "id_token", "client_secret")
_SECRET_JSON = re.compile(
    r'("(?:%s)"\s*:\s*")[^"]*(")' % "|".join(_SECRET_FIELDS),
    re.IGNORECASE,
)
_SECRET_FORM = re.compile(r"\b(%s)=([^&\s]+)" % "|".join(_SECRET_FIELDS), re.IGNORECASE)
_GOOGLE_ACCESS = re.compile(r"ya29\.[A-Za-z0-9._\-]+")
_GOOGLE_REFRESH = re.compile(r"1//[A-Za-z0-9._\-]+")
_CALLE_KEY = re.compile(r"iams_[A-Za-z0-9]+_[A-Za-z0-9._\-]+")


def redact(text: str) -> str:
    """Strip anything token-shaped out of a string before it reaches a terminal or a log file.

    Applied to every provider-sourced string and every exception message this CLI prints: Google's
    bodies, the CALL-E snapshot's transcript, evidence, structured result and failure code, and the
    text of any exception. Google's token endpoint answers a live credential with a real access
    token, and that answer is the thing the hero shot puts on screen, so the redaction has to
    happen on the way out rather than being remembered at each call site.
    """
    if not text:
        return text
    out = _SECRET_JSON.sub(r"\1<redacted>\2", text)
    out = _SECRET_FORM.sub(r"\1=<redacted>", out)
    out = _GOOGLE_ACCESS.sub("<redacted>", out)
    out = _GOOGLE_REFRESH.sub("<redacted>", out)
    out = _CALLE_KEY.sub("<redacted>", out)
    return out


def mask_phone(phone: str) -> str:
    """Keep the country prefix and the last two digits. Everything else is a star."""
    raw = (phone or "").strip()
    if len(raw) <= 5:
        return "*" * len(raw)
    return raw[:3] + "*" * (len(raw) - 5) + raw[-2:]


def _said(exc: BaseException) -> str:
    """One redacted line naming an exception, for a terminal that must never carry a secret."""
    told = redact(_one_line(str(exc)))
    return exc.__class__.__name__ + (f": {told}" if told else "")


# --------------------------------------------------------------------------------------------
# Terminal styling
# --------------------------------------------------------------------------------------------


class Style:
    """ANSI styling that degrades to plain text when the output is not a terminal."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled

    def _wrap(self, code: str, text: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.enabled else text

    def bold(self, text: str) -> str:
        return self._wrap("1", text)

    def red(self, text: str) -> str:
        return self._wrap("1;31", text)

    def green(self, text: str) -> str:
        return self._wrap("32", text)

    def yellow(self, text: str) -> str:
        return self._wrap("33", text)

    def dim(self, text: str) -> str:
        return self._wrap("2", text)


def _style_for(no_color: bool) -> Style:
    if no_color or os.environ.get("NO_COLOR") is not None:
        return Style(False)
    if os.environ.get("TERM", "") == "dumb":
        return Style(False)
    return Style(sys.stdout.isatty())


def rule(char: str = "-") -> str:
    return char * WIDTH


def _one_line(text: object) -> str:
    return " ".join(str(text).split())


def _trunc(text: object, limit: int) -> str:
    text = str(text)
    if limit <= 3 or len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _indent_block(text: str, prefix: str = "    ") -> str:
    out: list[str] = []
    for line in str(text).splitlines():
        if not line.strip():
            out.append("")
            continue
        out.extend(textwrap.wrap(line, width=WIDTH - len(prefix), initial_indent=prefix,
                                 subsequent_indent=prefix))
    return "\n".join(out)


# --------------------------------------------------------------------------------------------
# Freeze fingerprints
# --------------------------------------------------------------------------------------------


def schema_sha256() -> str:
    """Fingerprint of RESULT_SCHEMA, so a viewer can see the schema did not move between runs."""
    canonical = json.dumps(RESULT_SCHEMA, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def template_freeze() -> tuple[str, bool]:
    """Return the live call-script hash and whether it has drifted from the committed constant."""
    actual = template_sha256()
    return actual, actual != TASK_TEMPLATE_SHA256


def credential_fingerprint(lease: dict) -> str:
    """Stable fingerprint of the credential material this run puts in the token-endpoint request.

    WHY: the hero shot runs `prove` twice, roughly 135 seconds apart, and the proof only means
    something if both runs asked about the same credential. This is a sha256 over the three
    credential fields, in a fixed order, printed 16 hex characters wide and never with its inputs.

    It is a fingerprint of the credential material, not of the whole HTTP request: the remaining
    body field is a constant inside revoke.prove() and is not hashed here. Two matching
    fingerprints therefore say "same client, same secret, same refresh token" - which is the claim
    the demo actually needs - and nothing about revoke.prove() having stayed the same between two
    separate invocations of the program.
    """
    material = urllib.parse.urlencode(
        [
            ("client_id", lease["client_id"]),
            ("client_secret", lease["client_secret"]),
            ("refresh_token", lease["refresh_token"]),
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def derive_idempotency_key(*, job_id: str, minutes: int, phone: str, template_hash: str,
                           schema_hash: str) -> str:
    """Derive the Idempotency-Key from the payload, so a retry cannot become a second phone call.

    The number is part of the material because two different numbers must never collide onto one
    key. That makes the key a commitment to a low-entropy value: job id, minutes, and both hashes
    are all on screen, so anyone holding the key could search the number space in seconds. The key
    is therefore treated as sensitive - the journal keeps it in full because reconcile needs it,
    and `live` prints only that it was journalled. `demo` prints it, because the only number that
    ever reaches this function in a rehearsal is the literal placeholder "+1".
    """
    material = "\x1f".join(
        ["leash-v1", job_id, str(minutes), phone.strip(), template_hash, schema_hash]
    )
    return "leash-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


# --------------------------------------------------------------------------------------------
# Dispatch journal
# --------------------------------------------------------------------------------------------


@dataclass
class Journal:
    """Append-only record of dispatch intent, written and fsynced BEFORE anything is dialled.

    WHY: on an ambiguous transport error the provider may already have accepted the call. The only
    way to reconcile instead of re-dialling is to know the Idempotency-Key that was in flight, and
    the only way to know it after a crash is to have it on disk first.
    """

    path: Path

    def record(self, event: str, **fields: object) -> dict:
        entry = {"ts": _now(), "event": event}
        entry.update(fields)
        line = json.dumps(entry, sort_keys=True, default=str)
        fresh = not self.path.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        if fresh:
            # WHY: fsync on the file does not promise the directory entry survives a crash, and a
            # journal we cannot find afterwards is a journal that lets the next run re-dial.
            try:
                fd = os.open(self.path.parent, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            except OSError:
                pass  # not every filesystem allows this; the file fsync above still happened
        return entry

    def record_quietly(self, event: str, **fields: object) -> None:
        """Bookkeeping after the decision is final. A failure here must not change the outcome.

        Used only on paths where the lease has already been decided. Everything the reconcile
        depends on goes through record(), where a write failure is allowed to be loud.
        """
        try:
            self.record(event, **fields)
        except OSError:
            pass


# --------------------------------------------------------------------------------------------
# Reading one round trip to the token endpoint
# --------------------------------------------------------------------------------------------

PROOF_ALIVE = "alive"
PROOF_DEAD = "dead"
PROOF_MISCONFIGURED = "misconfigured"
PROOF_INCONCLUSIVE = "inconclusive"


def read_proof(proof: ProofResult) -> str:
    """Reduce one round trip to exactly one of four readings. Every caller uses this function.

    WHY this is not inlined at each call site: an earlier shape of this file let three callers each
    decide for themselves what "not alive" meant, and two of them treated any non-200 as a dead
    credential. A timeout or an HTTP 500 would then have been printed as a completed release - a
    false proof, in the one place where the whole submission rests on the proof being real. The
    token endpoint answers a live credential with 200 and a revoked one with 400. Anything else is
    a broken run and is never reported as either.
    """
    if proof.misconfigured:
        return PROOF_MISCONFIGURED
    if proof.http_status == 200 and proof.alive:
        return PROOF_ALIVE
    if proof.http_status == 400 and not proof.alive:
        return PROOF_DEAD
    return PROOF_INCONCLUSIVE


# --------------------------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------------------------


def format_header(style: Style, *, subtitle: str, min_confidence: float | None = None) -> str:
    actual, drifted = template_freeze()
    lines = [
        rule("="),
        "  " + style.bold("LEASH") + "  -  the call that can only take capability away",
        "  " + subtitle,
        rule("-"),
        f"  call script  sha256:{actual[:16]}",
        f"  result shape sha256:{schema_sha256()[:16]}",
    ]
    if min_confidence is not None:
        lines.append(f"  confidence floor  {min_confidence:.2f}")
    if drifted:
        lines.append("")
        lines.append("  " + style.red("CALL SCRIPT DRIFT") + " - the script no longer matches the")
        lines.append("  committed hash in leash/templates.py. The freeze is broken; refusing to")
        lines.append("  treat this run as evidence of anything.")
    lines.append(rule("="))
    return "\n".join(lines)


def format_proof(proof: ProofResult, style: Style, *, fingerprint: str, label: str) -> str:
    """Render one forced round trip to Google's token endpoint. This output is the whole proof."""
    actual, _ = template_freeze()
    reading = read_proof(proof)

    verdict_lines: list[str]
    if reading == PROOF_MISCONFIGURED:
        verdict_lines = [
            "  " + style.yellow(style.bold("MISCONFIGURED")) + " - Google rejected the OAuth",
            "  client itself. This is NOT a release and says nothing about the lease. The client",
            "  config is broken or rotated; fix client_secret.json before reading into this run.",
        ]
    elif reading == PROOF_ALIVE:
        verdict_lines = [
            "  " + style.green(style.bold("LEASE ALIVE"))
            + " - Google minted a fresh access token for this credential.",
        ]
    elif reading == PROOF_DEAD:
        verdict_lines = [
            "  " + style.red(style.bold("LEASE DEAD"))
            + f" - Google refuses the refresh exchange ({_error_code(proof.body)}).",
            "  The agent cannot mint another token without a human at a browser.",
        ]
    else:
        verdict_lines = [
            "  " + style.yellow(style.bold("INCONCLUSIVE"))
            + f" - no usable answer from the token endpoint (HTTP {proof.http_status}).",
            "  Treat this as a broken run, not as a statement about the lease.",
        ]

    lines = [
        rule("="),
        "  " + style.bold(f"LEASE PROOF - {label}") + f"      {proof.observed_at}",
        rule("-"),
        f"  endpoint     POST {TOKEN_ENDPOINT}",
        f"  credential   sha256:{fingerprint}   (identical across runs = same credential asked)",
        f"  call script  sha256:{actual[:16]}",
        rule("-"),
        f"  HTTP {proof.http_status}   {proof.latency_ms:.0f} ms",
        "",
    ]
    lines.extend(verdict_lines)
    if reading != PROOF_MISCONFIGURED and proof.latency_ms < 5.0:
        # WHY: google.oauth2 only contacts the token endpoint once the access token has expired, so
        # a cached answer is the one way this proof could be fake. A real hop to Google does not
        # come back in under five milliseconds; if it does, the round trip probably never left.
        lines.append("")
        lines.append("  " + style.yellow("this answer came back faster than a real network hop -"))
        lines.append("  check that revoke.prove() forced the exchange instead of reusing a cached")
        lines.append("  token. A cached answer would make both runs agree and prove nothing.")
    lines.append("")
    lines.append(rule("-"))
    lines.append("  google said:")
    # Wrapped, not truncated: the sentence that carries the whole demo is Google's own
    # "Token has been expired or revoked", and a one-line truncation would cut it in half.
    body = _trunc(redact(_one_line(proof.body)) or "(empty body)", 600)
    lines.append(_indent_block(body, "    "))
    lines.append(rule("="))
    return "\n".join(lines)


def _error_code(body: str) -> str:
    """Pull the error code out of the token endpoint's body without hard-coding its value.

    WHY read it rather than compare it: none of Google's error vocabulary is written into this
    repository, so a reviewer grepping the source finds our words only, and a change at Google's
    end shows up on screen instead of silently failing an equality test.
    """
    try:
        parsed = json.loads(body)
    except (ValueError, TypeError):
        return "no parseable error code"
    if isinstance(parsed, dict) and isinstance(parsed.get("error"), str):
        return redact(_trunc(_one_line(parsed["error"]), 40))
    return "no parseable error code"


def format_outcome(outcome: CallOutcome, style: Style) -> str:
    """Render the terminal snapshot.

    Deliberately tolerant of malformed fields. In `live` this runs while a real credential is at
    stake, and a formatting exception would reach the crash handler and revoke it. Failing closed
    is the product, but revoking over a float that arrived as a string is not a decision anyone
    made about the lease.
    """
    lines = [
        style.bold("CALL SNAPSHOT") + f"  {outcome.call_id}",
        f"  status              {outcome.status}",
        f"  reached terminal    {'yes' if outcome.reached_terminal else 'no'}",
        f"  task_completed      {outcome.task_completed}",
    ]
    score = outcome.confidence_score
    if isinstance(score, (int, float)) and not isinstance(score, bool):
        lines.append(
            f"  completion          {float(score):.2f}"
            f" ({outcome.confidence_label or 'no label'})"
        )
    else:
        lines.append("  completion          no confidence reported")
    if outcome.failure_code:
        # Free-form string, never an enum. Printed, never switched on.
        lines.append(f"  failure_code        {_trunc(redact(_one_line(outcome.failure_code)), 60)}")
    if outcome.error_code:
        lines.append(f"  error code          {_trunc(redact(_one_line(outcome.error_code)), 60)}")

    lines.append("")
    result = outcome.structured_result
    if result is None:
        lines.append("  " + style.yellow("structured_result: null"))
        lines.append("  Extraction failed for the whole object. Every check below therefore runs")
        lines.append("  on task_completed, the confidence, the evidence and the transcript, which")
        lines.append("  all survive a null result.")
    elif not isinstance(result, dict):
        lines.append("  " + style.yellow("structured_result is not an object; refusing to read it"))
    else:
        lines.append("  structured_result")
        keys = [str(k) for k in result]
        key_w = min(max((len(k) for k in keys), default=4), 30)
        for key in keys:
            value = _trunc(redact(_one_line(result[key])), WIDTH - key_w - 10)
            lines.append(f"    {key.ljust(key_w)}  {value}")

    if outcome.evidence:
        lines.append("")
        lines.append("  evidence")
        for item in outcome.evidence[:4]:
            lines.append(f"    - {_trunc(redact(_one_line(item)), WIDTH - 8)}")
        if len(outcome.evidence) > 4:
            lines.append(f"    ... {len(outcome.evidence) - 4} more line(s)")

    user_turns = outcome.user_turns
    lines.append("")
    if user_turns:
        lines.append("  what the person actually said")
        for turn in user_turns[:6]:
            try:
                stamp = f"{float(turn.offset_seconds):6.1f}s"
            except (TypeError, ValueError):
                stamp = "    ?  "
            lines.append(f"    {stamp}  {_trunc(redact(_one_line(turn.text)), WIDTH - 14)}")
        if len(user_turns) > 6:
            lines.append(f"    ... {len(user_turns) - 6} more turn(s)")
    else:
        lines.append("  " + style.yellow("no turns attributed to a person in this transcript"))
    return "\n".join(lines)


def format_conditions(verdict: Verdict, style: Style) -> str:
    """Fixed-width checklist. A failing row carries a >> gutter mark so it survives a bad camera."""
    conditions = verdict.conditions
    total = len(conditions)
    if total == 0:
        return style.red("policy returned no conditions - refusing to read that as anything")

    name_w = min(max(len(c.name) for c in conditions) + 2, 44)
    detail_w = max(20, WIDTH - (2 + 6 + 2 + name_w + 2))

    lines = [
        style.bold("CONDITIONS FOR THE LEASE TO CONTINUE"),
        f"all {total} must hold at once; any single failure releases the lease",
        "",
    ]
    for condition in conditions:
        name = _trunc(condition.name, name_w - 2)
        padded = (name + " ").ljust(name_w, ".")
        detail = _trunc(_one_line(condition.detail), detail_w)
        if condition.held:
            lines.append("  " + style.green("[ ok ]") + f"  {padded}  " + style.dim(detail))
        else:
            lines.append(">>" + style.red("[FAIL]") + f"  {style.red(padded)}  {detail}")

    held = sum(1 for c in conditions if c.held)
    failed = total - held
    lines.append("")
    tally = f"  {held} of {total} held, {failed} failed"
    lines.append(style.red(tally) if failed else style.green(tally))
    return "\n".join(lines)


def _release_tail(acted: bool) -> str:
    # Present tense, not past: this banner prints before the revoke round trip runs, and the only
    # thing entitled to say the credential is dead is the forced round trip printed underneath it.
    if acted:
        return "revoking the refresh credential at Google's token endpoint; the proof follows"
    return "a live run would revoke the refresh credential at Google's token endpoint"


NO_SNAPSHOT_NOTE = (
    "No conditions were evaluated, and that is the point: the permissive branch needs every "
    "condition to hold, so an absent call is indistinguishable from a failed one."
)


def format_released(style: Style, *, reason: str, acted: bool, note: str | None = None) -> str:
    """The one release banner in this program.

    Single implementation on purpose: two banners for the same event drift, and a demo whose
    loudest moment is worded one way on one path and another way on another path invites the
    reading that the paths are not really the same decision.
    """
    lines = [
        rule("="),
        "  " + style.red(style.bold("LEASE RELEASED")),
        "  " + _release_tail(acted),
        "",
        _indent_block("why: " + _one_line(reason), "  "),
    ]
    if note:
        lines.append("")
        lines.append(_indent_block(note, "  "))
    lines.append(rule("="))
    return "\n".join(lines)


def format_continues(verdict: Verdict, style: Style) -> str:
    lines = [
        rule("="),
        "  " + style.green(style.bold("LEASE CONTINUES")),
        "  The call took nothing away, and it could not have added anything. The owner simply",
        "  did not release the lease, and every condition held.",
        "",
        _indent_block("why: " + _one_line(verdict.summary), "  "),
        rule("="),
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------------------------
# Operator input
# --------------------------------------------------------------------------------------------


class OperatorError(Exception):
    """Anything wrong with the command line, the files, or the config. Never a lease statement."""


def _read_single_line(path_text: str, *, what: str) -> str:
    path = Path(path_text).expanduser()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise OperatorError(f"cannot read the {what} at {path}: {exc.strerror or exc}") from exc
    for line in raw.splitlines():
        if line.strip():
            return line.strip()
    raise OperatorError(f"the {what} at {path} is empty")


def load_api_key(path_text: str) -> str:
    key = _read_single_line(path_text, what="API key file")
    if not key.startswith("iams_"):
        # WHY: a malformed key would otherwise fail at dispatch, and a dispatch failure releases
        # the lease. Fail here, while the credential is not yet at stake.
        raise OperatorError(
            "that file does not hold a CALL-E key (expected an iams_ prefix). "
            "Refusing to start, because a dispatch failure would release the lease."
        )
    return key


def load_phone(path_text: str) -> str:
    phone = _read_single_line(path_text, what="phone file")
    if not re.fullmatch(r"\+[1-9]\d{6,14}", phone):
        raise OperatorError(
            f"the phone number {mask_phone(phone)} is not E.164 (a plus sign then 7 to 15 digits)"
        )
    return phone


def load_lease_file(path_text: str) -> dict:
    path = Path(path_text).expanduser()
    try:
        lease = load_lease(path)
    except FileNotFoundError as exc:
        raise OperatorError(f"no lease file at {path}") from exc
    except Exception as exc:  # noqa: BLE001 - any parse failure is an operator problem
        raise OperatorError(f"cannot load the lease at {path}: {_said(exc)}") from exc
    if not isinstance(lease, dict):
        raise OperatorError(f"the lease at {path} did not load as an object")
    missing = [k for k in ("client_id", "client_secret", "refresh_token") if not lease.get(k)]
    if missing:
        raise OperatorError(f"the lease at {path} is missing: {', '.join(missing)}")
    return lease


def check_min_confidence(value: float) -> float:
    if value < DEFAULT_MIN_CONFIDENCE:
        # The floor may be raised, never lowered. Every knob in this system moves one way.
        raise OperatorError(
            f"--min-confidence may be raised above {DEFAULT_MIN_CONFIDENCE:.2f} but not lowered; "
            f"{value:.2f} was requested"
        )
    if value > 1.0:
        raise OperatorError(
            f"--min-confidence of {value:.2f} can never be met, so the run would release the lease "
            "whatever the owner said. Refusing to stage that."
        )
    return value


def check_minutes(value: int) -> int:
    if value < 1:
        raise OperatorError("--minutes must be at least 1; it is spoken aloud on the call")
    return value


def check_poll_knobs(*, first_wait: float, interval: float, timeout: float) -> None:
    if timeout < MIN_LIVE_TIMEOUT:
        raise OperatorError(
            f"--timeout may be raised above {MIN_LIVE_TIMEOUT:.0f} seconds but not lowered; a call "
            "takes 145 to 200 seconds to reach a terminal status, and a shorter timeout would "
            "release the lease while the owner is still speaking"
        )
    if interval < MIN_POLL_INTERVAL:
        raise OperatorError(
            f"--interval may not go below {MIN_POLL_INTERVAL:.0f} seconds"
        )
    if first_wait < 0 or first_wait >= timeout:
        raise OperatorError("--first-wait must be zero or more and shorter than --timeout")


def check_freeze() -> None:
    _, drifted = template_freeze()
    if drifted:
        raise OperatorError(
            "the call script no longer matches TASK_TEMPLATE_SHA256. The script is frozen because "
            "its wording is what makes the transcript readable as evidence. Restore it, or "
            "re-freeze it deliberately."
        )


def build_script(job_id: str, minutes: int) -> str:
    """Render the frozen script and re-run its own cleanliness check before anything is dialled."""
    task = render_task(job_id, minutes)
    assert_task_is_clean(task)
    return task


def open_journal(path_text: str, *, mode: str, job_id: str) -> Journal:
    """Open the journal and prove it is writable before anything is at stake.

    WHY up front: every later write happens with the credential on the line, and an unwritable
    path discovered then would surface as a crash and revoke a credential over a read-only
    directory rather than over anything the owner said.
    """
    journal = Journal(Path(path_text).expanduser())
    try:
        journal.record("run_started", mode=mode, job_id=job_id)
    except OSError as exc:
        raise OperatorError(
            f"cannot write the dispatch journal at {journal.path}: {exc.strerror or exc}. "
            "Refusing to start: the key has to be on disk before anything is dialled."
        ) from exc
    return journal


# --------------------------------------------------------------------------------------------
# Deciding
# --------------------------------------------------------------------------------------------


def verdict_incoherence(verdict: Verdict) -> str | None:
    """Reasons this CLI refuses to read a verdict as permissive, whatever its own flag says.

    WHY the CLI second-guesses policy at all: `Verdict.release` is one boolean, and the checklist
    beside it is what a viewer reads. If the two ever disagree, the screen would show FAIL rows
    under a banner saying every condition held. The disagreement itself is a failure, and the
    failure direction is release.
    """
    if not verdict.conditions:
        return "policy returned no conditions, so nothing was actually checked"
    if not verdict.release and verdict.failed:
        names = ", ".join(c.name for c in verdict.failed)
        return f"policy left the lease standing while these conditions failed: {names}"
    return None


def second_look(supervisor: Supervisor, call_id: str, *, job_id: str,
                min_confidence: float) -> tuple[Verdict | None, str | None]:
    """Re-fetch the snapshot and re-evaluate before letting the lease stand.

    WHY: CALL-E webhooks are unsigned, and the platform docs prescribe re-fetching the call before
    any sensitive side effect. Here the sensitive side effect is the one that does nothing - letting
    the agent keep the credential - so the second look guards only the permissive branch. Any
    disagreement between the two looks, or any failure to take the second look, releases the lease.

    The re-evaluation sits inside the same try as the fetch on purpose: policy raising on the
    second snapshot is a second look we did not get, not a second look that agreed.
    """
    try:
        again = supervisor.fetch(call_id)
        verdict = evaluate(again, expected_job_id=job_id, min_confidence=min_confidence)
    except Exception as exc:  # noqa: BLE001 - a second look we cannot take is a release
        return None, f"the second look at the snapshot failed: {_said(exc)}"
    if verdict.release:
        return verdict, "the second look at the snapshot disagreed with the first"
    return verdict, None


def settle(supervisor: Supervisor, outcome: CallOutcome, *, job_id: str, min_confidence: float,
           style: Style) -> tuple[Verdict | None, str | None]:
    """Turn a terminal snapshot into a decision. Returns (verdict, release_reason).

    A release_reason of None is the only way the lease stands, and it is reached only when policy
    releases nothing, the verdict is coherent with its own checklist, and an independent second
    fetch agrees. Policy raising, an empty checklist, a checklist that contradicts the flag, a
    second look that could not be taken, and a second look that disagreed all come back with a
    reason, which means release.

    WHY one function: `demo` and `live` both call it. The rehearsal claims to show what a live run
    would decide, and that claim is only honest if the two run the same decision path. Two copies
    of this logic, which is what this file used to carry, would make the rehearsal evidence of
    nothing but itself.
    """
    try:
        verdict = evaluate(outcome, expected_job_id=job_id, min_confidence=min_confidence)
    except Exception as exc:  # noqa: BLE001 - policy that cannot decide has not decided to continue
        return None, f"policy could not evaluate the snapshot: {_said(exc)}"

    if verdict.release:
        return verdict, _one_line(verdict.summary) or "policy released the lease"

    incoherent = verdict_incoherence(verdict)
    if incoherent is not None:
        return verdict, incoherent

    confirmed, disagreement = second_look(
        supervisor, outcome.call_id, job_id=job_id, min_confidence=min_confidence
    )
    shown = style.red(_trunc(disagreement, WIDTH - 34)) if disagreement else style.green("agrees")
    print("  second look at the snapshot: " + shown)
    print()
    if disagreement is not None:
        return (confirmed if confirmed is not None else verdict), disagreement
    if confirmed is None:
        return verdict, "the second look returned no verdict at all"

    incoherent = verdict_incoherence(confirmed)
    if incoherent is not None:
        return confirmed, incoherent
    # Both looks agree. The first is the one whose snapshot was printed above, so it is the one
    # whose checklist the viewer gets to read.
    return verdict, None


def dispatch(supervisor: Supervisor, *, job_id: str, minutes: int, phone: str,
             idempotency_key: str, journal: Journal, style: Style) -> str | None:
    """Place the call exactly once. Returns a call id, or None if no call exists to poll.

    On any failure we reconcile against the Idempotency-Key rather than re-dialling. We do not try
    to tell a definite rejection from an ambiguous timeout, because reconcile answers that question
    authoritatively and re-dialling is the one thing that must never happen.
    """
    journal.record(
        "dispatch_intent",
        idempotency_key=idempotency_key,
        job_id=job_id,
        minutes=minutes,
        phone=mask_phone(phone),
    )
    try:
        call_id = supervisor.create(job_id, minutes, phone, idempotency_key)
    except Exception as exc:  # noqa: BLE001 - see docstring
        detail = _said(exc)
        journal.record("dispatch_uncertain", idempotency_key=idempotency_key, detail=detail)
        print("  " + style.yellow("dispatch did not return cleanly: ") + _trunc(detail, WIDTH - 40))
        print("  halting the dial and reconciling against the idempotency key; never re-dialling.")
        try:
            recovered = supervisor.reconcile_after_ambiguous_create(idempotency_key)
        except Exception as inner:  # noqa: BLE001
            journal.record(
                "reconcile_failed", idempotency_key=idempotency_key, detail=_said(inner)
            )
            print("  " + style.red("reconcile failed as well"))
            print("  A call may or may not be in flight; the key is in the journal and this run")
            print("  will not dial again. The lease does not stand on an unknown.")
            return None
        if recovered is None:
            journal.record("reconcile_empty", idempotency_key=idempotency_key)
            print("  reconcile found no such call: nothing was ever dialled.")
            return None
        journal.record("reconciled", idempotency_key=idempotency_key, call_id=recovered)
        print("  reconcile recovered call " + recovered)
        return recovered

    journal.record("dispatched", idempotency_key=idempotency_key, call_id=call_id)
    return call_id


# --------------------------------------------------------------------------------------------
# prove
# --------------------------------------------------------------------------------------------


def cmd_prove(args: argparse.Namespace, style: Style) -> int:
    lease = load_lease_file(args.lease)
    fingerprint = credential_fingerprint(lease)

    print(format_header(style, subtitle="forced round trip to Google's token endpoint"))
    print()
    try:
        proof = prove(lease)
    except Exception as exc:  # noqa: BLE001 - a proof we cannot take is an operator problem
        raise OperatorError(f"the round trip to the token endpoint failed: {_said(exc)}") from exc

    print(format_proof(proof, style, fingerprint=fingerprint, label=args.label))
    print()
    print(
        _indent_block(
            "This is a forced refresh exchange, not a Drive call. Drive's front end honours dead "
            "tokens for an unpredictable while; the token endpoint does not. Run this command "
            "before and after the phone call: same credential fingerprint, different answer.",
            "  ",
        )
    )

    reading = read_proof(proof)
    if reading == PROOF_ALIVE:
        return EXIT_CONTINUES
    if reading == PROOF_DEAD:
        return EXIT_RELEASED
    return EXIT_OPERATOR


# --------------------------------------------------------------------------------------------
# demo
# --------------------------------------------------------------------------------------------


# The 555-01xx range is reserved for fiction, so this number cannot reach a real
# person even if a future edit accidentally pointed the demo at the live API. The fake
# server never dials it; it exists so the recipient survives E.164 validation and so
# the Idempotency-Key is derived from the same shape a live run would use.
DEMO_PHONE = "+15555550142"


def cmd_demo(args: argparse.Namespace, style: Style) -> int:
    if args.list_scenarios:
        print(style.bold("fake-server scenarios"))
        print()
        width = max((len(name) for name in SCENARIOS), default=4)
        for name in sorted(SCENARIOS):
            print(f"  {name.ljust(width)}  {_trunc(_one_line(SCENARIOS[name]), WIDTH - width - 4)}")
        return EXIT_CONTINUES

    if args.scenario not in SCENARIOS:
        raise OperatorError(
            f"unknown scenario {args.scenario!r}; run --list-scenarios for the catalogue"
        )

    check_freeze()
    min_confidence = check_min_confidence(args.min_confidence)
    minutes = check_minutes(args.minutes)
    job_id = args.job_id or ("tidy-" + secrets.token_hex(2))

    print(format_header(
        style,
        subtitle="rehearsal against a local fake server - no key, no credits, no call",
        min_confidence=min_confidence,
    ))
    print()
    print(f"  scenario   {style.bold(args.scenario)}")
    print(_indent_block(SCENARIOS[args.scenario], "             "))
    print(f"  job id     {job_id}")
    print()

    script = build_script(job_id, minutes)
    print(style.bold("  what the person would hear"))
    print(_indent_block(script, "    "))
    print()

    journal = open_journal(args.journal, mode="demo", job_id=job_id)
    idempotency_key = derive_idempotency_key(
        job_id=job_id,
        minutes=minutes,
        phone=DEMO_PHONE,  # never dialled; the key still has to be derived from a real shape
        template_hash=template_sha256(),
        schema_hash=schema_sha256(),
    )
    print(f"  idempotency key  {idempotency_key}")
    print(f"  journal          {journal.path}")
    print()

    # create_ambiguous only exercises the halt-and-reconcile path if the provider's silence
    # actually outlasts the client's socket timeout. With production values that means waiting
    # 45 s, so the fixture and the client are both scaled down here -- the code path is
    # identical, only the clock is smaller. Getting this wrong is invisible: the create simply
    # succeeds and the scenario passes without testing the thing it names.
    ambiguous = args.scenario == "create_ambiguous"
    server = FakeCalle(args.scenario, ambiguous_delay=4.0) if ambiguous else FakeCalle(args.scenario)
    server.start()
    try:
        supervisor = Supervisor(
            api_key="fake-key-the-local-server-ignores",
            base_url=server.url,
            create_timeout=1.5 if ambiguous else CREATE_TIMEOUT_SECONDS,
        )
        call_id = dispatch(
            supervisor,
            job_id=job_id,
            minutes=minutes,
            phone=DEMO_PHONE,
            idempotency_key=idempotency_key,
            journal=journal,
            style=style,
        )
        if call_id is None:
            return _release_banner(
                style, "no call was ever placed", acted=False, note=NO_SNAPSHOT_NOTE
            )

        print(f"  call {call_id} placed against the fake server")
        print()
        try:
            outcome = supervisor.poll_until_terminal(
                call_id, first_wait=0.0, interval=0.25, timeout=30.0
            )
        except Exception as exc:  # noqa: BLE001 - a call that never lands is a release
            return _release_banner(
                style,
                f"the call never reached a terminal status: {_said(exc)}",
                acted=False,
                note=NO_SNAPSHOT_NOTE,
            )

        journal.record("terminal", call_id=call_id, status=outcome.status)
        print(format_outcome(outcome, style))
        print()

        verdict, release_reason = settle(
            supervisor, outcome, job_id=job_id, min_confidence=min_confidence, style=style
        )
    except Exception as exc:  # noqa: BLE001 - the rehearsal crashing is itself a release
        print()
        print("  " + style.red("the supervisor did not survive the call: ")
              + _trunc(_said(exc), WIDTH - 44))
        return _release_banner(
            style, "the supervisor process failed", acted=False, note=NO_SNAPSHOT_NOTE
        )
    finally:
        server.stop()

    if verdict is not None:
        print(format_conditions(verdict, style))
        print()
    if release_reason is not None or verdict is None:
        return _release_banner(
            style,
            release_reason or "the rehearsal produced no verdict to read",
            acted=False,
            note=None if verdict is not None else NO_SNAPSHOT_NOTE,
        )

    print(format_continues(verdict, style))
    print()
    print(_indent_block(
        "Rehearsal only: no phone call was placed and no credential was contacted. `live` runs the "
        "same decision path on a real snapshot; the only thing it adds is the round trip to "
        "Google's token endpoint before and after the call.",
        "  ",
    ))
    return EXIT_CONTINUES


def _release_banner(style: Style, reason: str, *, acted: bool, note: str | None) -> int:
    print(format_released(style, reason=reason, acted=acted, note=note))
    return EXIT_RELEASED


# --------------------------------------------------------------------------------------------
# preflight
# --------------------------------------------------------------------------------------------


def cmd_preflight(args: argparse.Namespace, style: Style) -> int:
    check_freeze()
    minutes = check_minutes(args.minutes)
    api_key = load_api_key(args.api_key_file)
    job_id = args.job_id or ("tidy-" + secrets.token_hex(2))

    print(format_header(
        style,
        subtitle="zero-credit shape check against the real API - no call is placed",
    ))
    print()
    print(_indent_block(
        "The API validates result_schema before it validates recipients, so pairing the real "
        "schema with the placeholder number +1 exercises the schema for free and then fails on "
        "the phone number by design.",
        "  ",
    ))
    print()

    supervisor = Supervisor(api_key=api_key, base_url=args.base_url)
    try:
        ok, detail = supervisor.preflight(job_id, minutes)
    except Exception as exc:  # noqa: BLE001
        raise OperatorError(f"preflight could not run: {_said(exc)}") from exc

    print("  " + (style.green("SCHEMA ACCEPTED") if ok else style.red("SCHEMA REJECTED")))
    print()
    print(_indent_block(redact(json.dumps(detail, indent=2, sort_keys=True, default=str)), "    "))
    print()
    if ok:
        print("  The call script and the result shape above are the ones a live run would send.")
        return EXIT_CONTINUES
    return EXIT_OPERATOR


# --------------------------------------------------------------------------------------------
# live
# --------------------------------------------------------------------------------------------


@dataclass
class LiveState:
    """What the crash handler is allowed to claim.

    revoke_requested says a revoke was attempted; proved_dead says the forced round trip afterwards
    came back with Google refusing the credential. Only the second one licenses exit code 2. An
    attempt we could not verify exits 3, because "the lease was released" is a claim about Google's
    answer and not about our intent.
    """

    revoke_requested: bool = False
    proved_dead: bool = False


def cmd_live(args: argparse.Namespace, style: Style) -> int:
    missing: list[str] = []
    if not args.i_understand_this_places_a_real_call:
        missing.append("--i-understand-this-places-a-real-call")
    if not args.api_key_file:
        missing.append("--api-key-file PATH")
    if not args.phone_file:
        missing.append("--phone-file PATH")
    if not args.lease:
        missing.append("--lease PATH")
    if missing:
        raise OperatorError(
            "live refuses to run. Missing: "
            + ", ".join(missing)
            + ". This subcommand dials a real person and can revoke a real credential; "
            "use `demo` for anything else."
        )

    check_freeze()
    min_confidence = check_min_confidence(args.min_confidence)
    minutes = check_minutes(args.minutes)
    check_poll_knobs(first_wait=args.first_wait, interval=args.interval, timeout=args.timeout)
    api_key = load_api_key(args.api_key_file)
    phone = load_phone(args.phone_file)
    lease = load_lease_file(args.lease)
    job_id = args.job_id or ("tidy-" + secrets.token_hex(2))
    journal = open_journal(args.journal, mode="live", job_id=job_id)

    print(format_header(
        style,
        subtitle="live run - one real phone call, and a credential that can be revoked",
        min_confidence=min_confidence,
    ))
    print()

    # A broken OAuth client must be caught before a person's phone rings.
    fingerprint = credential_fingerprint(lease)
    try:
        before = prove(lease)
    except Exception as exc:  # noqa: BLE001 - nothing is at stake yet, so this is operator ground
        raise OperatorError(
            f"the round trip to the token endpoint failed before dialling: {_said(exc)}"
        ) from exc
    print(format_proof(before, style, fingerprint=fingerprint, label="before the call"))
    print()

    reading = read_proof(before)
    if reading == PROOF_MISCONFIGURED:
        raise OperatorError(
            "the OAuth client is rejected by Google, so nothing this run did would mean anything. "
            "Fix the client config before dialling."
        )
    if reading == PROOF_INCONCLUSIVE:
        # WHY this is not treated as a dead lease: an inconclusive answer is a broken network, not
        # a revoked credential, and skipping the call on it would both lose the demo and print a
        # claim about the lease that nobody verified.
        raise OperatorError(
            "the token endpoint gave no usable answer before the call, so this run could not tell "
            "afterwards whether anything changed. Refusing to dial."
        )
    if reading == PROOF_DEAD:
        journal.record_quietly("already_dead", job_id=job_id)
        print("  " + style.yellow("the lease is already dead; there is nothing left to release"))
        print("  No call will be placed, and this run released nothing.")
        return EXIT_RELEASED

    script = build_script(job_id, minutes)
    print(style.bold("  what the person will hear"))
    print(_indent_block(script, "    "))
    print()

    idempotency_key = derive_idempotency_key(
        job_id=job_id,
        minutes=minutes,
        phone=phone,
        template_hash=template_sha256(),
        schema_hash=schema_sha256(),
    )
    print(f"  dialling         {style.bold(mask_phone(phone))}")
    print(f"  job id           {job_id}")
    # Not printed in full: the key commits to the number, and everything else that goes into it is
    # already on this screen. Reconcile reads it from the journal, which is not on camera.
    print("  idempotency key  derived from the payload and written to the journal")
    print(f"  journal          {journal.path}")
    print()

    state = LiveState()
    supervisor = Supervisor(api_key=api_key, base_url=args.base_url)
    try:
        return _live_loop(
            args,
            style,
            supervisor=supervisor,
            lease=lease,
            job_id=job_id,
            minutes=minutes,
            phone=phone,
            min_confidence=min_confidence,
            idempotency_key=idempotency_key,
            journal=journal,
            state=state,
        )
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - deliberate: see below
        # WHY: a supervisor that failed is one of the outcomes that releases the lease. Ctrl-C is
        # included on purpose - an operator walking away is exactly the unattended case. This
        # covers Python-level failure only; a SIGKILL or a power cut leaves the credential alive,
        # and LEASH does not claim otherwise.
        print()
        print("  " + style.red("SUPERVISOR FAILED: ") + _trunc(_said(exc), WIDTH - 30))
        journal.record_quietly("supervisor_failed", detail=exc.__class__.__name__)
        if state.revoke_requested:
            # The release path already ran and reported for itself; do not revoke twice, and do
            # not upgrade an unverified attempt into a claim that Google refused the credential.
            return EXIT_RELEASED if state.proved_dead else EXIT_OPERATOR
        try:
            return _release_now(
                lease, style, journal=journal, state=state,
                reason="the supervisor process failed before the lease could be left standing",
            )
        except BaseException as inner:  # noqa: BLE001 - the last handler; nothing may escape it
            print("  " + style.red("the release path failed as well: ")
                  + _trunc(_said(inner), WIDTH - 40))
            print("  Revoke the credential by hand at the account's connected-apps page.")
            return EXIT_OPERATOR


def _live_loop(args: argparse.Namespace, style: Style, *, supervisor: Supervisor, lease: dict,
               job_id: str, minutes: int, phone: str, min_confidence: float, idempotency_key: str,
               journal: Journal, state: LiveState) -> int:
    call_id = dispatch(
        supervisor,
        job_id=job_id,
        minutes=minutes,
        phone=phone,
        idempotency_key=idempotency_key,
        journal=journal,
        style=style,
    )
    if call_id is None:
        # A supervisor that cannot dial is a supervisor that cannot be trusted to hold the lease.
        return _release_now(
            lease, style, journal=journal, state=state,
            reason="the call could not be placed, so the owner was never reached",
        )

    print(f"  call {style.bold(call_id)} is queued")
    print("  waiting for a terminal status (usually 145 to 200 seconds)")
    print()
    try:
        outcome = supervisor.poll_until_terminal(
            call_id,
            first_wait=args.first_wait,
            interval=args.interval,
            timeout=args.timeout,
        )
    except Exception as exc:  # noqa: BLE001
        journal.record_quietly("poll_failed", call_id=call_id, detail=_said(exc))
        return _release_now(
            lease, style, journal=journal, state=state,
            reason=f"the call never reached a terminal status: {_said(exc)}",
        )

    journal.record_quietly("terminal", call_id=call_id, status=outcome.status)
    print(format_outcome(outcome, style))
    print()

    verdict, release_reason = settle(
        supervisor, outcome, job_id=job_id, min_confidence=min_confidence, style=style
    )
    if verdict is not None:
        print(format_conditions(verdict, style))
        print()

    if release_reason is not None or verdict is None:
        return _release_now(
            lease, style, journal=journal, state=state,
            reason=release_reason or "the run produced no verdict to read",
        )

    # The permissive banner is printed only after the credential has been re-checked. Printing it
    # first would put "LEASE CONTINUES" on screen above a proof that contradicts it.
    after = _prove_or_none(lease, style)
    if after is None:
        print("  " + style.red("the lease was left standing but could not be re-checked"))
        print("  Nothing was revoked; this run simply cannot show you the credential's state.")
        return EXIT_OPERATOR
    print(format_proof(after, style, fingerprint=credential_fingerprint(lease),
                       label="after the call"))
    print()
    if read_proof(after) != PROOF_ALIVE:
        print("  " + style.red("the lease was left standing but the credential no longer answers"))
        print("  Something outside this run touched it. Treat the run as broken.")
        journal.record_quietly("lease_stands_but_unusable", call_id=call_id,
                               http_status=after.http_status)
        return EXIT_OPERATOR

    journal.record_quietly("lease_stands", call_id=call_id, http_status=after.http_status)
    print(format_continues(verdict, style))
    return EXIT_CONTINUES


def _prove_or_none(lease: dict, style: Style) -> ProofResult | None:
    """Take the forced round trip, or say plainly that it could not be taken.

    WHY it never raises: both callers are on paths where the lease has already been decided, and
    an exception there would be caught by the crash handler and read as a second release.
    """
    try:
        return prove(lease)
    except Exception as exc:  # noqa: BLE001
        print("  " + style.red("the round trip to the token endpoint failed: ")
              + _trunc(_said(exc), WIDTH - 48))
        return None


def _release_now(lease: dict, style: Style, *, journal: Journal, state: LiveState,
                 reason: str) -> int:
    """End the lease: revoke the refresh credential, then prove it with the same round trip.

    Exit code 2 is returned only when Google afterwards refuses the credential. A revoke request
    that was sent but could not be verified exits 3: the release is the loudest outcome in this
    system, and the one thing louder than saying it happened is saying it might not have.
    """
    print(format_released(style, reason=reason, acted=True))
    print()

    state.revoke_requested = True
    journal.record_quietly("release_requested", reason=_trunc(reason, 200))
    try:
        status, body = release(lease)
        # Revoking a credential that is already dead answers 400 invalid_token. That is success.
        print(f"  revoke endpoint answered HTTP {status}  "
              + _trunc(redact(_one_line(body)) or "(empty body)", WIDTH - 40))
        journal.record_quietly("release_sent", http_status=status)
    except Exception as exc:  # noqa: BLE001 - the round trip below is what decides, not this call
        print("  " + style.red("the revoke request itself failed: ")
              + _trunc(_said(exc), WIDTH - 44))
        journal.record_quietly("release_failed", detail=_said(exc))
    print()

    after = _prove_or_none(lease, style)
    if after is None:
        print()
        print("  " + style.red("the release could not be verified"))
        print("  Revoke the credential by hand at the account's connected-apps page, then run")
        print("  `python -m leash prove` before believing anything this run printed.")
        journal.record_quietly("release_unverified")
        return EXIT_OPERATOR

    print(format_proof(after, style, fingerprint=credential_fingerprint(lease),
                       label="after the call"))
    reading = read_proof(after)
    journal.record_quietly("release_proved", http_status=after.http_status, reading=reading)

    if reading == PROOF_DEAD:
        state.proved_dead = True
        return EXIT_RELEASED
    print()
    if reading == PROOF_ALIVE:
        print("  " + style.red("THE RELEASE DID NOT TAKE") + " - Google still mints tokens for")
        print("  this credential. Revoke it by hand at the account's connected-apps page before")
        print("  believing anything this run printed.")
    elif reading == PROOF_MISCONFIGURED:
        print("  " + style.yellow("the client config is broken, so this proves nothing"))
    else:
        print("  " + style.yellow("the token endpoint gave no usable answer, so the release is"))
        print("  unverified. Re-run `python -m leash prove` before believing anything here.")
    return EXIT_OPERATOR


# --------------------------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------------------------


EPILOG = """exit codes:
  0  the lease continues (for prove: the credential is alive)
  2  the lease was released (for prove: Google refuses it; for demo: the rehearsal released)
  3  operator error, misconfiguration, or an unprovable outcome - never a statement about the lease
"""


class OperatorArgumentParser(argparse.ArgumentParser):
    """argparse exits 2 on a bad command line, and 2 is the code that means a revocation happened.

    An operator typo must never be readable as a released lease, so command-line errors exit 3.
    """

    def error(self, message: str):  # noqa: D102 - argparse override
        self.print_usage(sys.stderr)
        sys.stderr.write(f"{self.prog}: operator error: {message}\n")
        raise SystemExit(EXIT_OPERATOR)


def _add_common_call_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--job-id", default=None,
                        help="job identifier spoken on the call; a fresh nonce by default")
    parser.add_argument("--minutes", type=int, default=20,
                        help="minutes named in the frozen call script (default: 20)")
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE,
                        help=("confidence floor for the permissive branch; may be raised above "
                              f"{DEFAULT_MIN_CONFIDENCE:.2f}, never lowered"))
    parser.add_argument("--journal", default=str(DEFAULT_JOURNAL),
                        help=f"append-only dispatch journal (default: {DEFAULT_JOURNAL})")


def build_parser() -> argparse.ArgumentParser:
    parser = OperatorArgumentParser(
        prog="python -m leash",
        description="LEASH - one phone call whose only power is to end a credential's lease.",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--no-color", action="store_true", help="plain output with no ANSI codes")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=OperatorArgumentParser)

    p_prove = sub.add_parser(
        "prove",
        help="force one round trip to Google's token endpoint and print the answer",
        description=("Forces a refresh exchange against Google's token endpoint. Run it before and "
                     "after the call: the credential fingerprint is identical, the answer is not."),
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_prove.add_argument("--lease", required=True, help="path to the lease JSON")
    p_prove.add_argument("--label", default="run", help="label printed in the proof block")
    p_prove.set_defaults(func=cmd_prove)

    p_demo = sub.add_parser(
        "demo",
        help="run the whole loop against a local fake server (default-safe: no key, no call)",
        description=("Runs create, poll, evaluate and the verdict against a local fake CALL-E. "
                     "No API key, no credits, no phone call, no contact with Google."),
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_demo.add_argument("--scenario", default="continue_clean", help="fake-server scenario name")
    p_demo.add_argument("--list-scenarios", action="store_true", help="list scenarios and exit")
    _add_common_call_args(p_demo)
    p_demo.set_defaults(func=cmd_demo)

    p_pre = sub.add_parser(
        "preflight",
        help="free zero-credit schema check against the real API",
        description=("Sends the real result shape with the placeholder number +1. The API checks "
                     "the schema before the recipients, so this costs nothing and dials nobody."),
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_pre.add_argument("--api-key-file", required=True, help="file holding the CALL-E API key")
    p_pre.add_argument("--base-url", default="https://api.heycall-e.com", help="API base URL")
    p_pre.add_argument("--job-id", default=None, help="job identifier; a fresh nonce by default")
    p_pre.add_argument("--minutes", type=int, default=20, help="minutes named in the call script")
    p_pre.set_defaults(func=cmd_preflight)

    p_live = sub.add_parser(
        "live",
        help="place one real call and act on the verdict",
        description=("Places one real phone call and, unless every condition holds, revokes the "
                     "refresh credential at Google's token endpoint. Requires all four flags."),
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_live.add_argument("--i-understand-this-places-a-real-call", action="store_true",
                        dest="i_understand_this_places_a_real_call",
                        help="required: this subcommand dials a real person")
    p_live.add_argument("--api-key-file", default=None, help="file holding the CALL-E API key")
    p_live.add_argument("--phone-file", default=None, help="file holding one E.164 number")
    p_live.add_argument("--lease", default=None, help="path to the lease JSON")
    p_live.add_argument("--base-url", default="https://api.heycall-e.com", help="API base URL")
    p_live.add_argument("--first-wait", type=float, default=55.0,
                        help="seconds before the first poll (default: 55)")
    p_live.add_argument("--interval", type=float, default=6.0,
                        help="seconds between polls (default: 6)")
    p_live.add_argument("--timeout", type=float, default=420.0,
                        help=("seconds before the call is treated as never landing "
                              f"(default: 420, floor {MIN_LIVE_TIMEOUT:.0f})"))
    _add_common_call_args(p_live)
    p_live.set_defaults(func=cmd_live)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    style = _style_for(args.no_color)
    try:
        return int(args.func(args, style))
    except OperatorError as exc:
        print()
        print(style.red("operator error: ") + _one_line(str(exc)), file=sys.stderr)
        print("nothing was decided about the lease.", file=sys.stderr)
        return EXIT_OPERATOR
    except TaskRefused as exc:
        print()
        print(style.red("the call script was refused: ") + _one_line(str(exc)), file=sys.stderr)
        print("no call was placed and nothing was decided about the lease.", file=sys.stderr)
        return EXIT_OPERATOR
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - see the module docstring on exit code 1
        # Everything the lease depends on is handled inside cmd_live, which revokes on its own way
        # out. Whatever reaches here happened outside that region, so the honest report is an
        # operator-level unknown - and a traceback exiting 1 next to a revocation demo is worse.
        print()
        print(style.red("unhandled failure: ") + _trunc(_said(exc), WIDTH), file=sys.stderr)
        print("nothing here is a statement about the lease.", file=sys.stderr)
        return EXIT_OPERATOR


if __name__ == "__main__":
    sys.exit(main())
