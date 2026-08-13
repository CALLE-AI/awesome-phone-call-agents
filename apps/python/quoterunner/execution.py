"""QuoteRunner execution layer — place the planned calls through CALL-E.

`quoterunner.py` decides *who* is callable. This module places the calls and
turns what the businesses said into one comparable table.

Three modes, and only the third one dials:

    preview     the plan, masked, no credentials, no network      (default)
    simulate    the full pipeline against canned answers          (--simulate)
    execute     real calls through CALL-E                         (--execute)

`--execute` is gated four ways, deliberately:

    1. CALLE_LIVE_CALLS_ENABLED=true   in the environment
    2. CALLE_API_KEY                   in the environment
    3. --confirm <token>               a token bound to this exact batch
    4. every candidate still open      re-checked at dial time, not at plan time

Gate 3 is the interesting one. The token is a hash of the job plus the sorted
list of numbers, so a token you obtained by reviewing one list will not
authorise a different list. Re-run the plan an hour later, get different
candidates because a shop closed, and the old token stops working. That is the
point: a confirmation that survives a change in what it confirms is not a
confirmation.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time as _time
from datetime import datetime
from typing import Any, Callable, Protocol

from quoterunner import (
    Candidate,
    PlanError,
    build_script,
    is_open,
    local_now,
    mask,
    window_text,
)

DEFAULT_BASE_URL = "https://api.heycall-e.com"

# What CALL-E reports when a call is over. Nothing is retried automatically:
# a redial the operator did not ask for is a second call to a real business.
TERMINAL = {"completed", "failed", "canceled", "cancelled", "succeeded"}
NO_ANSWER = {"busy", "no_answer", "voicemail"}

# Terminal is not the same as successful. A `failed` or `canceled` call is over,
# but whatever it returned is the wreckage of a call that did not happen the way
# it was meant to -- and a partially populated structured_result from one of
# those can still satisfy the schema. Ranking it next to a real quote puts a
# price in the table that nobody actually said.
SUCCESSFUL = {"completed", "succeeded"}

MAX_WAIT_SECONDS = 900
POLL_SECONDS = 5


class QuoteError(Exception):
    """Never carries a full phone number. Tests assert this."""


class CallsAPI(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def wait_for_result(
        self, call_id: str, *, timeout_seconds: int, interval_seconds: int
    ) -> dict[str, Any]: ...


# ---------------------------------------------------------------------------
# What we ask CALL-E to bring back
# ---------------------------------------------------------------------------
# Every field is a string with an explicit "unknown", including the price. A
# receptionist who says "depends on the glass, call back Tuesday" is a normal
# outcome, not an error, and a numeric field would force the model to invent a
# number to satisfy the type.
QUOTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "does_this_job",
        "quoted_price",
        "currency",
        "price_covers",
        "earliest_date",
        "job_duration",
        "warranty_months",
        "callback_required",
        "evidence_summary",
    ],
    "properties": {
        "does_this_job": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Whether this business does the job at all.",
        },
        "quoted_price": {
            "type": "string",
            "description": (
                "The amount only, digits and an optional decimal point, e.g. "
                "'245' or '245.50'. A range becomes 'low-high', e.g. '200-260'. "
                "Use 'unknown' if no price was given. Never guess a price."
            ),
        },
        "currency": {
            "type": "string",
            "description": "ISO 4217 code such as USD, EUR, MXN, or 'unknown'.",
        },
        "price_covers": {
            "type": "string",
            "enum": ["parts_and_labour", "labour_only", "parts_only", "unknown"],
        },
        "earliest_date": {
            "type": "string",
            "description": "YYYY-MM-DD if a date was given, otherwise 'unknown'.",
        },
        "job_duration": {
            "type": "string",
            "description": "How long the work takes, in their words, or 'unknown'.",
        },
        "warranty_months": {
            "type": "string",
            "description": "Number of months as digits, '0' if none, or 'unknown'.",
        },
        "callback_required": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Whether they asked to be called back to quote properly.",
        },
        "evidence_summary": {
            "type": "string",
            "description": (
                "One or two sentences on what was actually said. No phone "
                "numbers, no names of individuals, no personal data."
            ),
        },
    },
    "additionalProperties": False,
}

REQUIRED_FIELDS = tuple(QUOTE_SCHEMA["required"])


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------
# `evidence_summary` is model-written prose repeating what a person said out
# loud, so it can contain anything they read out: a mobile number, an email, an
# order reference. Masking the phone column and then writing that sentence
# verbatim leaks the same class of data one field over.
_PHONE_IN_TEXT = re.compile(r"\+?\d[\d\s\-().]{7,}\d")
_EMAIL_IN_TEXT = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def redact(value: Any) -> Any:
    if isinstance(value, str):
        out = _EMAIL_IN_TEXT.sub("[email redacted]", value)
        return _PHONE_IN_TEXT.sub("[number redacted]", out)
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


# The narrow fields are not prose and must not go through `redact`: an ISO date
# like 2026-08-11 is eight digits with separators, which is exactly what a
# phone-number pattern matches, and the first version of this file quietly
# turned every availability date into "[number redacted]".
#
# So each narrow field is checked against the shape it is supposed to have, and
# anything else becomes "unknown". That covers the leak too -- a phone number
# smuggled into `earliest_date` does not match a date and never survives.
_SHAPES = {
    "quoted_price": re.compile(r"^\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?$"),
    "currency": re.compile(r"^[A-Za-z]{3}$"),
    "earliest_date": re.compile(r"^\d{4}-\d{2}-\d{2}$"),
    "warranty_months": re.compile(r"^\d{1,3}$"),
}

# Free text. Whatever the person said out loud can end up in here.
_PROSE = ("evidence_summary", "job_duration")


def sanitise_quote(quote: dict[str, Any]) -> dict[str, Any]:
    """Constrain the narrow fields, redact the prose ones."""
    clean: dict[str, Any] = {}
    for field, value in quote.items():
        if field in _SHAPES:
            clean[field] = value if _SHAPES[field].match(str(value).strip()) else "unknown"
        elif field in _PROSE:
            clean[field] = redact(value)
        else:
            clean[field] = value
    return clean


# ---------------------------------------------------------------------------
# The confirmation token
# ---------------------------------------------------------------------------
def confirmation_token(
    candidates: list[Candidate], job: str, requester: str = "", locale: str = "en-US"
) -> str:
    """Fingerprint of this exact batch. One different number, different token.

    It covers everything that changes what will actually be said or dialled:
    the numbers, the job, who the call is on behalf of, and the language it is
    made in. Binding it to the numbers and the job alone left an approval valid
    across a rewritten script -- you could review a batch of English calls on
    behalf of one person and use that same token to place Spanish calls on
    behalf of another.

    This implements the gap we reported to CALL-E in the Most Valuable Feedback
    submission: `call start` has no machine-enforced confirmation, so the only
    thing between an agent and a live call is a sentence in a markdown file that
    a model is free to skip. A hash the operator has to paste back cannot be
    skipped by a model that is feeling confident.
    """
    payload = json.dumps(
        {
            "job": job.strip(),
            "requester": requester.strip(),
            "locale": locale,
            "phones": sorted(c.phone for c in candidates),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def check_confirmation(
    candidates: list[Candidate], job: str, token: str | None,
    requester: str = "", locale: str = "en-US",
) -> None:
    expected = confirmation_token(candidates, job, requester, locale)
    if not token:
        raise QuoteError(
            "--execute needs --confirm. Read the plan above, then re-run with:\n"
            f"    --confirm {expected}"
        )
    if token.strip().lower() != expected:
        raise QuoteError(
            "The confirmation token does not match this batch.\n"
            "That happens when the candidate list changed after you reviewed "
            "it -- a shop closed, the search returned something else. Review "
            "the plan again.\n"
            f"Token for the batch above: {expected}"
        )


# ---------------------------------------------------------------------------
# Call arguments
# ---------------------------------------------------------------------------
def idempotency_key(
    candidate: Candidate, job: str, requester: str = "", locale: str = "en-US"
) -> str:
    """Stable per business and per *script*, so a re-run cannot dial twice.

    Derived from the call content rather than from a timestamp: two runs of the
    same batch are the same intent and must collapse into one call.

    It covers the whole spoken script, not just the job line. Keying on the job
    alone meant that changing the requester's name, or the language the call is
    made in, still produced the same key -- so a genuinely different call would
    be deduplicated against the earlier one and CALL-E would replay the old
    result instead of placing the new call.
    """
    seed = json.dumps(
        {
            "phone": candidate.phone,
            "task": build_script(candidate, job, requester),
            "locale": locale,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return "quoterunner-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]


def call_arguments(
    candidate: Candidate, job: str, requester: str, locale: str = "en-US"
) -> dict[str, Any]:
    return {
        "task": build_script(candidate, job, requester),
        "recipients": [{"phones": [candidate.phone], "locale": locale}],
        "result_schema": QUOTE_SCHEMA,
        "metadata": {
            "call-e/customerMetadata": {
                "app": "quoterunner",
                "source_id": candidate.source_id or "",
            }
        },
        "idempotency_key": idempotency_key(candidate, job, requester, locale),
    }


def validate_base_url(value: str) -> str:
    """Only the official origin, or an explicit loopback test server.

    A base URL read from the environment is a place where a live call can be
    silently redirected to somebody else's server, so it is pinned rather than
    trusted.
    """
    from urllib.parse import urlparse

    parsed = urlparse(value)
    official = (
        parsed.scheme == "https"
        and parsed.hostname == "api.heycall-e.com"
        and parsed.port in (None, 443)
    )
    loopback = (
        parsed.scheme == "http"
        and parsed.hostname in ("127.0.0.1", "localhost")
        and parsed.port is not None
    )
    clean = (
        parsed.path in ("", "/")
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    )
    if official and clean:
        return DEFAULT_BASE_URL
    if loopback and clean:
        return value.rstrip("/")
    raise QuoteError(
        "CALLE_BASE_URL must be https://api.heycall-e.com, or an exact "
        "loopback address with a port for a fake server in tests"
    )


def build_calls_api(base_url: str | None = None) -> CallsAPI:
    """Import and construct the SDK client. Only ever called by --execute."""
    if os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").strip().lower() != "true":
        raise QuoteError("--execute requires CALLE_LIVE_CALLS_ENABLED=true")

    api_key = os.environ.get("CALLE_API_KEY", "").strip()
    if not api_key:
        raise QuoteError("--execute requires CALLE_API_KEY")

    try:
        from calle import CalleClient
    except ImportError:  # pragma: no cover - dependency guidance
        raise QuoteError(
            "Missing dependency. Install with:  pip install calle-ai"
        ) from None

    url = validate_base_url(base_url or os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL))
    return CalleClient(api_key=api_key, base_url=url).calls


# ---------------------------------------------------------------------------
# Running the batch
# ---------------------------------------------------------------------------
def outcome_unknown(error: Exception) -> bool:
    """Did this failure leave a call possibly in flight?

    A rejected request never rang anybody: a bad key, a rate limit, a malformed
    payload all fail before dialling. A timeout, a dropped connection or a 5xx
    are different — the provider may have accepted the request and be dialling
    while we read the exception.

    Matched on the exception name and status code rather than on imported SDK
    classes, so this module keeps working when `calle-ai` is absent, which is
    the case for every default test run.
    """
    name = type(error).__name__
    if any(s in name for s in ("Timeout", "Connection", "Unavailable")):
        return True
    code = getattr(error, "status_code", None)
    if code is None:
        code = getattr(error, "status", None)
    return isinstance(code, int) and code >= 500


def _valid_result(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    for field in REQUIRED_FIELDS:
        item = value.get(field)
        if not isinstance(item, str):
            return False
        allowed = QUOTE_SCHEMA["properties"][field].get("enum")
        if allowed is not None and item not in allowed:
            return False
    return True


def run_batch(
    candidates: list[Candidate],
    job: str,
    requester: str,
    calls: CallsAPI,
    *,
    moment: datetime | None = None,
    locale: str = "en-US",
    timeout_seconds: int = MAX_WAIT_SECONDS,
    on_event: Callable[[str], None] | None = None,
    on_accepted: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Place one call per candidate, in sequence, and collect the answers.

    Sequential on purpose. Twelve simultaneous calls from one number is what an
    autodialer looks like from the receiving end, and the whole premise here is
    that these are calls the business wants: a customer asking for a price.
    """
    say = on_event or (lambda _m: None)
    results: list[dict[str, Any]] = []

    for index, candidate in enumerate(candidates, 1):
        # Re-checked here rather than trusted from planning time. A batch of
        # twelve calls takes minutes, and a shop that closes at 18:00 must not
        # be dialled at 18:04 because it was open when the plan was written.
        #
        # And checked in the shop's own zone, not the host's. This loop is the
        # last thing that runs before a real telephone rings, so it is the one
        # place that must not be reading a Texas shop's hours off a clock in
        # Mexico City.
        if not candidate.timezone:
            say(f"[{index}/{len(candidates)}] {candidate.name}: no timezone, skipped")
            results.append({
                "name": candidate.name,
                "phone_masked": candidate.masked,
                "status": "not_called",
                "reason": "no timezone published -- cannot tell what time it is there",
                "quote": None,
            })
            continue

        try:
            here = local_now(candidate, moment)
        except PlanError as error:
            say(f"[{index}/{len(candidates)}] {candidate.name}: {error}")
            results.append({
                "name": candidate.name, "phone_masked": candidate.masked,
                "status": "not_called", "reason": str(error), "quote": None,
            })
            continue

        if not is_open(candidate.opening_hours, here):
            say(f"[{index}/{len(candidates)}] {candidate.name}: closed now, skipped")
            results.append({
                "name": candidate.name,
                "phone_masked": candidate.masked,
                "status": "not_called",
                "reason": (f"closed at dial time in {candidate.timezone} "
                           f"(today {window_text(candidate.opening_hours, here)})"),
                "quote": None,
            })
            continue

        say(f"[{index}/{len(candidates)}] {candidate.name}  {candidate.masked}  calling")
        key = idempotency_key(candidate, job, requester, locale)
        try:
            created = calls.create(**call_arguments(candidate, job, requester, locale))
        except Exception as error:  # noqa: BLE001 - one failure must not kill the batch
            # A refusal and a lost answer are different facts. A rejected
            # request never rang anybody; a timeout may have been accepted and
            # the phone may be ringing right now. Filing the second as
            # "refused" invites a retry, and a retry here is a second call to a
            # real business.
            if outcome_unknown(error):
                say(f"      no answer from CALL-E: {type(error).__name__} -- outcome unknown")
                results.append({
                    "name": candidate.name,
                    "phone_masked": candidate.masked,
                    "status": "unknown",
                    "reason": (
                        f"CALL-E did not answer ({type(error).__name__}); the call "
                        "may have been accepted. Reconcile before retrying"
                    ),
                    "idempotency_key": key,
                    "quote": None,
                })
            else:
                say(f"      refused: {type(error).__name__}")
                results.append({
                    "name": candidate.name,
                    "phone_masked": candidate.masked,
                    "status": "error",
                    "reason": f"CALL-E refused the call ({type(error).__name__})",
                    "idempotency_key": key,
                    "quote": None,
                })
            continue

        call_id = created.get("id") if isinstance(created, dict) else None
        if not isinstance(call_id, str) or not call_id:
            # The dangerous case: the call may have been accepted but there is
            # no id to reconcile it by. The idempotency key is the only handle
            # left, so it is recorded rather than dropped. Never retried.
            say("      no call id returned -- not retrying")
            results.append({
                "name": candidate.name,
                "phone_masked": candidate.masked,
                "status": "unknown",
                "reason": "CALL-E accepted the request without returning a call id",
                "idempotency_key": key,
                "quote": None,
            })
            continue

        # The call is accepted and the phone is ringing. Everything from here on
        # can be interrupted -- Ctrl+C, a crash, the machine losing power -- and
        # the call keeps going regardless, because it lives on CALL-E's side and
        # not in this loop.
        #
        # So the row goes into the results BEFORE the wait, not after. An
        # interrupted run then still hands back the call id and the idempotency
        # key of every call it started, which is the only way to reconcile them
        # afterwards. Writing the row after the wait meant that killing the
        # process during a five-minute call erased the only record that it had
        # ever been placed.
        fila = {
            "name": candidate.name,
            "phone_masked": candidate.masked,
            "call_id": call_id,
            "idempotency_key": key,
            "status": "in_flight",
            "reason": "call accepted by CALL-E; waiting for the outcome",
            "quote": None,
        }
        results.append(fila)
        say(f"      accepted, call_id={call_id}")
        if on_accepted is not None:
            # Hook for a caller that wants to persist this somewhere durable
            # before the wait. The in-memory list survives an exception; it does
            # not survive the process dying.
            on_accepted(dict(fila))

        try:
            final = calls.wait_for_result(
                call_id, timeout_seconds=timeout_seconds, interval_seconds=POLL_SECONDS
            )
        except Exception as error:  # noqa: BLE001
            say(f"      result unavailable: {type(error).__name__}")
            fila["status"] = "unknown"
            fila["reason"] = (
                f"call placed, outcome not retrieved ({type(error).__name__})")
            continue

        status = str((final or {}).get("status", "unknown")).strip().lower() or "unknown"
        structured = (final or {}).get("structured_result")
        fila["status"] = status

        if status in NO_ANSWER:
            say(f"      {status}")
            fila["reason"] = "nobody picked up; not redialled automatically"
            continue

        # `task_completed` is CALL-E attesting that the agent finished what it
        # was sent to do. Absent is not the same as true: it means nobody
        # attested anything, and an unattested call is exactly the one whose
        # structured_result you should not put a price on. Only an explicit
        # True passes.
        task_done = (final or {}).get("task_completed")

        if status not in SUCCESSFUL or task_done is not True or not _valid_result(structured):
            if status not in SUCCESSFUL:
                fila["reason"] = f"the call ended as {status}, not as a completed call"
            elif task_done is False:
                fila["reason"] = "CALL-E reported the task was not completed"
            elif task_done is None:
                fila["reason"] = ("CALL-E did not attest that the task completed; "
                                  "treated as unfinished")
            else:
                fila["reason"] = "the call did not return the full quote schema"
            say(f"      {status}, no usable answer")
            continue

        quote = sanitise_quote(structured)
        say(f"      {quote['quoted_price']} {quote['currency']}")
        fila["reason"] = ""
        fila["quote"] = quote

    return results


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------
class SimulatedCalls:
    """A CallsAPI that answers without a telephone.

    Deterministic: the same candidate always produces the same answer, so the
    comparison table in the README is reproducible and a test can assert on it.
    The point is to exercise the real code path -- create, wait, validate,
    redact, compare -- with the transport removed.
    """

    SCENARIOS = [
        {
            "does_this_job": "yes", "quoted_price": "245", "currency": "USD",
            "price_covers": "parts_and_labour", "earliest_date": "2026-08-11",
            "job_duration": "about 2 hours", "warranty_months": "12",
            "callback_required": "no",
            "evidence_summary": "Quoted for an OEM-equivalent screen, fitted in the workshop.",
        },
        {
            "does_this_job": "yes", "quoted_price": "199.50", "currency": "USD",
            "price_covers": "parts_and_labour", "earliest_date": "2026-08-14",
            "job_duration": "half a day", "warranty_months": "6",
            "callback_required": "no",
            "evidence_summary": "Cheaper aftermarket glass, next available slot is Friday.",
        },
        {
            "does_this_job": "yes", "quoted_price": "280-320", "currency": "USD",
            "price_covers": "parts_and_labour", "earliest_date": "2026-08-10",
            "job_duration": "90 minutes", "warranty_months": "24",
            "callback_required": "no",
            "evidence_summary": "Range depends on whether the rain sensor needs recalibrating.",
        },
        {
            "does_this_job": "yes", "quoted_price": "unknown", "currency": "unknown",
            "price_covers": "unknown", "earliest_date": "unknown",
            "job_duration": "unknown", "warranty_months": "unknown",
            "callback_required": "yes",
            "evidence_summary": "Service manager was out; asked to be called back tomorrow morning.",
        },
    ]

    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self._by_id: dict[str, dict[str, Any]] = {}

    def create(self, **kwargs: Any) -> dict[str, Any]:
        self.created.append(kwargs)
        index = len(self.created) - 1
        call_id = f"sim-{index:04d}"
        self._by_id[call_id] = self.SCENARIOS[index % len(self.SCENARIOS)]
        return {"id": call_id, "status": "queued"}

    def wait_for_result(
        self, call_id: str, *, timeout_seconds: int, interval_seconds: int
    ) -> dict[str, Any]:
        return {
            "id": call_id,
            "status": "completed",
            "task_completed": True,
            "structured_result": dict(self._by_id[call_id]),
        }


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------
def parse_amount(quoted_price: str) -> float | None:
    """Lowest number in the string, or None. '280-320' sorts as 280.

    Defensive on purpose: this value came out of a spoken sentence through a
    language model. Anything that is not clearly a number becomes None and
    sorts last, rather than becoming a zero that wins the comparison.
    """
    if not isinstance(quoted_price, str):
        return None
    found = re.findall(r"\d+(?:\.\d+)?", quoted_price.replace(",", ""))
    if not found:
        return None
    try:
        return min(float(n) for n in found)
    except ValueError:  # pragma: no cover - findall already guarantees digits
        return None


def compare(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Sort the answers into a table. Never compares across currencies."""
    quoted, no_price, not_reached = [], [], []
    for row in results:
        quote = row.get("quote")
        if not quote:
            not_reached.append(row)
        elif parse_amount(quote.get("quoted_price", "")) is None:
            no_price.append(row)
        else:
            quoted.append(row)

    currencies = {r["quote"]["currency"] for r in quoted}
    quoted.sort(key=lambda r: parse_amount(r["quote"]["quoted_price"]) or 0.0)

    return {
        "quoted": quoted,
        "no_price": no_price,
        "not_reached": not_reached,
        "currencies": sorted(currencies),
        "mixed_currencies": len(currencies) > 1,
        "cheapest": quoted[0]["name"] if quoted and len(currencies) <= 1 else None,
    }


def render_comparison(job: str, table: dict[str, Any], simulated: bool) -> str:
    head = "SIMULATED -- no call was placed" if simulated else "LIVE CALL RESULTS"
    lines = [head, "", f"Job: {job}", ""]

    if table["quoted"]:
        lines.append(f"{'price':>12}  {'available':<12} {'warranty':<10} business")
        lines.append(f"{'-' * 12}  {'-' * 12} {'-' * 10} {'-' * 28}")
        for row in table["quoted"]:
            q = row["quote"]
            warranty = q["warranty_months"]
            warranty = f"{warranty} mo" if warranty.isdigit() and warranty != "0" else (
                "none" if warranty == "0" else "unknown"
            )
            lines.append(
                f"{q['quoted_price']:>8} {q['currency']:<3}  "
                f"{q['earliest_date']:<12} {warranty:<10} {row['name']}"
            )

    if table["mixed_currencies"]:
        lines += ["", "Quotes came back in more than one currency "
                  f"({', '.join(table['currencies'])}). Not ranked -- converting "
                  "them here would invent an exchange rate nobody quoted."]
    elif table["cheapest"]:
        lines += ["", f"Cheapest: {table['cheapest']}"]

    if table["no_price"]:
        lines += ["", "Answered, no price given:"]
        for row in table["no_price"]:
            lines.append(f"   - {row['name']}  ->  {row['quote']['evidence_summary']}")

    if table["not_reached"]:
        lines += ["", "No quote:"]
        for row in table["not_reached"]:
            lines.append(f"   - {row['name']}  {row['phone_masked']}  ->  {row['reason']}")

    return "\n".join(lines)


def progress(message: str) -> None:
    sys.stdout.write(message + "\n")
    sys.stdout.flush()
