#!/usr/bin/env python3
"""Provider-agnostic phone-call adapter. plan -> approve -> run.

Calls businesses to retrieve facts that are only available by asking. Planning
is free and does not dial; only `run` places a call, and only with a
confirmation token issued by a plan a human has seen.

Set CALL_PROVIDER=fake for a no-call path that needs no credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

__version__ = "1.0.0"

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

# "calle" places real calls. "fake" places none and needs no credentials.
PROVIDER = os.environ.get("CALL_PROVIDER", "calle")

# Where the CALLEE is. Unset by default: the provider's plan_call schema says
# to leave it unset rather than guess, and it resolves the region from the
# E.164 prefix. Format is validated here; the value is not checked against a
# local list, because a stale copy of the provider's table fails by refusing
# a call that would have worked.
REGION = os.environ.get("CALL_REGION") or None

# Spoken language. A choice, never inferred from the number: a +91 recipient
# does not imply Hindi. The provider constrains language by region.
LANGUAGE = os.environ.get("CALL_LANGUAGE", "English")

# Timezone the provider renders stored timestamps in. UTC by default: the
# sidecar is an audit artefact and should not depend on who reads it.
DISPLAY_TZ = os.environ.get("CALL_DISPLAY_TZ", "UTC")

CALLE_BIN = os.environ.get(
    "CALLE_BIN", "node_modules/@call-e/cli/bin/calle.js"
)
CALLE_CACHE_ROOT = os.environ.get("CALLE_CACHE_ROOT", ".calle")

STATE_DIR = Path(os.environ.get("CALL_STATE_DIR", ".calle-runs"))

# Subprocess ceiling enforced by this script.
CLI_TIMEOUT_S = int(os.environ.get("CALL_CLI_TIMEOUT", "60"))

# The CLI's own per-request network timeout -- a different layer. It MUST stay
# strictly below the subprocess ceiling: if the ceiling fires first, the CLI is
# killed before it can emit its structured JSON error and the failure arrives
# as a bare timeout carrying no provider detail.
CALLE_REQUEST_TIMEOUT_S = int(os.environ.get("CALL_REQUEST_TIMEOUT", "30"))
if CALLE_REQUEST_TIMEOUT_S >= CLI_TIMEOUT_S:
    raise SystemExit(
        f"config error: CALL_REQUEST_TIMEOUT ({CALLE_REQUEST_TIMEOUT_S}s) must "
        f"be strictly less than CALL_CLI_TIMEOUT ({CLI_TIMEOUT_S}s). The CLI's "
        "own request timeout has to fire first, or its structured error is "
        "lost and failures become undiagnosable."
    )

DEFAULT_MAX_WAIT_S = int(os.environ.get("CALL_MAX_WAIT", "360"))

POLL_FLOOR_S = 5
POLL_CEILING_S = 30


class CallAgentError(Exception):
    """Anything the caller should see as a failed operation, not a crash."""


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------


class Provider:
    """The swap surface. Each method returns the provider's own structured
    response -- not a normalised envelope, which `to_envelope` produces
    separately."""

    name = "abstract"

    def plan(
        self,
        to_phones: list[str],
        goal: str,
        *,
        region: str | None = None,
        language: str | None = None,
    ) -> dict:
        raise NotImplementedError

    def run(self, plan_id: str, confirm_token: str) -> dict:
        raise NotImplementedError

    def status(self, run_id: str) -> dict:
        raise NotImplementedError


class CalleProvider(Provider):
    name = "calle"

    TRANSCRIPT_LINE = re.compile(
        r"^\[(?P<ts>\d{2}:\d{2}:\d{2})\]\s+(?P<who>[A-Z]+):\s?(?P<text>.*)$"
    )
    SPEAKER_MAP = {"BOT": "agent", "USER": "callee"}

    STATE_MAP = {
        "PREPARING": "in_progress",
        "RUNNING": "in_progress",
        "IN_PROGRESS": "in_progress",
        "COMPLETED": "completed",
        "FAILED": "failed",
        "CANCELLED": "cancelled",
        "EXPIRED": "expired",
    }

    def __init__(self) -> None:
        self.last_argv: list[str] = ["<none>"]

    # -- CLI plumbing ------------------------------------------------------

    def _exec(self, subcommand: list[str], flags: list[str]) -> dict:
        """Subcommand first, flags after. Reversing this yields
        `Unknown command: --flag value` with the flag and value glued into one
        token, which reads like a broken CLI rather than a bad argument order.
        """
        argv = (
            ["node", CALLE_BIN]
            + subcommand
            + ["--cache-root", CALLE_CACHE_ROOT]
            + flags
            + ["--timeout-seconds", str(CALLE_REQUEST_TIMEOUT_S)]
            + ["--no-telemetry", "--json"]
        )
        # What was sent, not what was meant to be sent.
        self.last_argv = _redact_argv(argv)
        env = dict(os.environ, DO_NOT_TRACK="1")
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=CLI_TIMEOUT_S,
                env=env,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise CallAgentError(
                f"calle {' '.join(subcommand)} timed out after {CLI_TIMEOUT_S}s"
            ) from exc

        out = proc.stdout.strip()
        # An unrecognised command prints usage text and does not mark itself as
        # an error. Detect it rather than letting a JSON decode failure stand
        # in for it.
        if out.startswith("Usage: calle"):
            raise CallAgentError(
                f"calle rejected the invocation and printed usage (argument "
                f"error, not a call failure): {' '.join(subcommand)}"
            )
        if not out:
            raise CallAgentError(
                f"calle {' '.join(subcommand)} produced no stdout "
                f"(exit {proc.returncode}): {proc.stderr.strip()[:400]}"
            )
        try:
            payload = json.loads(out)
        except json.JSONDecodeError as exc:
            raise CallAgentError(
                f"calle {' '.join(subcommand)} returned non-JSON: {out[:400]}"
            ) from exc
        if not payload.get("ok", False):
            raise CallAgentError(
                f"calle reported failure: {json.dumps(payload)[:400]}"
            )
        result = payload.get("result", {})
        if result.get("isError"):
            raise CallAgentError(
                f"provider returned isError: {json.dumps(result)[:400]}"
            )
        # structuredContent only. content[0].text carries the same payload with
        # different timestamp localisation.
        structured = result.get("structuredContent")
        if not isinstance(structured, dict):
            raise CallAgentError(
                "provider response had no structuredContent object"
            )
        return structured

    # -- verbs -------------------------------------------------------------

    def plan(
        self,
        to_phones: list[str],
        goal: str,
        *,
        region: str | None = None,
        language: str | None = None,
    ) -> dict:
        flags: list[str] = []
        for phone in to_phones:
            flags += ["--to-phone", phone]
        flags += ["--goal", goal, "--language", language or LANGUAGE]
        # --region omitted entirely when unset. Do not substitute a default: an
        # absent hint lets the provider resolve from the number; a wrong one
        # asserts the callee is somewhere they are not.
        effective_region = region or REGION
        if effective_region:
            flags += ["--region", effective_region]
        return self._exec(["call", "plan"], flags)

    def run(self, plan_id: str, confirm_token: str) -> dict:
        return self._exec(
            ["call", "run"],
            [
                "--plan-id", plan_id,
                "--confirm-token", confirm_token,
                "--timezone", DISPLAY_TZ,
            ],
        )

    def status(self, run_id: str) -> dict:
        return self._exec(
            ["call", "status"],
            ["--run-id", run_id, "--timezone", DISPLAY_TZ],
        )

    # -- normalisation -----------------------------------------------------

    @classmethod
    def normalize_transcript(cls, raw: str | None) -> list[dict]:
        """The provider ships the transcript as one newline-joined string.
        A second provider will ship something else; this is the swap surface.
        """
        if not raw:
            return []
        turns: list[dict] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            m = cls.TRANSCRIPT_LINE.match(line)
            if not m:
                # A wrapped line belongs to the turn above it, not to nothing.
                if turns:
                    turns[-1]["text"] += " " + line
                continue
            turns.append(
                {
                    "t": m.group("ts"),
                    "speaker": cls.SPEAKER_MAP.get(
                        m.group("who"), m.group("who").lower()
                    ),
                    "text": m.group("text").strip(),
                }
            )
        return turns

    @classmethod
    def to_envelope(cls, structured: dict) -> dict:
        result = structured.get("result") or {}
        calling = structured.get("calling") or {}
        extracted = structured.get("extracted") or {}

        action = structured.get("next_action")
        poll_after = structured.get("poll_after_seconds")
        if isinstance(action, dict):
            action = action.get("type")

        raw_status = (structured.get("status") or "").upper()
        # Unmapped statuses become "unknown", never raw_status.lower(): a new
        # provider status passed through verbatim becomes a state string no
        # caller knows how to branch on. provider_state carries the raw value.
        state = cls.STATE_MAP.get(raw_status, "unknown")

        return {
            "provider": cls.name,
            "run_id": structured.get("run_id"),
            "state": state,
            "provider_state": raw_status or None,
            "next_action": action,
            "poll_after_seconds": poll_after,
            "summary": result.get("summary"),
            "evidence": ((result.get("outcome") or {}).get("evidence") or []),
            "transcript": cls.normalize_transcript(result.get("transcript")),
            "telephony": {
                "duration_s": calling.get("duration_seconds"),
                "callee_count": calling.get("callee_count"),
                "hangup_by": (calling.get("calls") or [{}])[0].get("hangup_type"),
                "started_at": (calling.get("calls") or [{}])[0].get(
                    "call_start_time"
                ),
                "ended_at": (calling.get("calls") or [{}])[0].get("call_end_time"),
            },
            "to_phones": extracted.get("to_phones") or [],
            "raw": structured,
        }


def _redact_argv(argv: list[str]) -> list[str]:
    """Copy of argv with the confirm-token VALUE replaced.

    The token authorises a real, charged call and cannot be revoked early, so
    it must not reach a sidecar, a log, or a terminal scrollback.
    """
    out = list(argv)
    for i, item in enumerate(out):
        if item == "--confirm-token" and i + 1 < len(out):
            out[i + 1] = "<redacted>"
    return out


PROVIDERS: dict[str, type[Provider]] = {"calle": CalleProvider}


def get_provider() -> Provider:
    # The fake is imported only when asked for, so the adapter does not depend
    # on the file being present in a deployment that never uses it.
    if PROVIDER == "fake" and "fake" not in PROVIDERS:
        try:
            from fake_provider import FakeProvider
        except ImportError:
            try:
                from .fake_provider import FakeProvider  # type: ignore
            except ImportError as exc:
                raise CallAgentError(
                    "CALL_PROVIDER=fake needs fake_provider.py beside "
                    f"call_agent.py, and it could not be imported: {exc}"
                ) from exc
        PROVIDERS["fake"] = FakeProvider

    try:
        return PROVIDERS[PROVIDER]()
    except KeyError:
        raise CallAgentError(
            f"unknown CALL_PROVIDER={PROVIDER!r}; known: {sorted(PROVIDERS)}"
        )


# --------------------------------------------------------------------------
# Goal text
#
# These strings are spoken to a real person. The provider rewrites them before
# they are said -- see references/goal-inspection.md -- so read the returned
# plan text rather than assuming this is what will be uttered.
# --------------------------------------------------------------------------

IDENTITY_CHECK = (
    "You are calling {name}. Ask whether you have reached {name} before "
    "asking anything else -- unless they have already named the place "
    "themselves in their greeting. If they greet you without naming it, "
    "however they phrase it, you must ask. If they name it themselves and it "
    "is {name}, that is your confirmation: thank them and go straight to your "
    "questions, and do not ask them to confirm what they have just told you. "
    "If they confirm when asked, continue. If they will not say either way, "
    "ask the questions anyway and report that identity was never confirmed. "
    "If what they name is a different place, or they say you have reached "
    "somewhere else, do not ask the questions; report what they said and end "
    "the call."
)

# Fires only if the callee asks. The caller reference below is unprompted.
# Both give the words to SAY rather than describing them: an instruction
# phrased as a description gets recited as one.
DISCLOSURE = (
    "If asked who is calling or whether this is a recording, say exactly: "
    "\"I'm an AI assistant calling on behalf of a client.\" Then continue."
)

CALLER_REFERENCE = (
    "When you say why you are calling, say exactly: \"I'm calling on behalf "
    "of a client.\" Never give the client's name."
)

# Fields are a flat list; some are only meaningful if an earlier one came back
# positive. Without this the agent asks what a price "would have been".
CONDITIONAL_FIELD = (
    "If an answer makes a later question pointless -- they do not stock the "
    "item, they do not offer the service -- do not ask it, and do not ask what "
    "the answer would have been. Report it as not applicable and say why. "
    "That is a complete answer, not a gap."
)

IMPLAUSIBLE_ANSWER = (
    "If an answer cannot be the kind of thing you asked for -- a way of "
    "travelling that is not a way of travelling, a time that is not a time, "
    "a price that is not a number -- say what you heard and ask them to "
    "confirm it. Do this once for each question. If what they say is still "
    "not that kind of thing, report exactly what they said and move on."
)

REPORT_FAITHFULLY = (
    "Report exactly what they say, including when they are unsure or decline "
    "to answer; do not fill in gaps with assumptions."
)

PROHIBITIONS = (
    "Do not negotiate. Do not place an order, hold, or reservation. Do not "
    "agree to anything on the caller's behalf. Do not leave a voicemail; if "
    "you reach voicemail or an automated system, end the call without leaving "
    "a message. If nobody answers, end the call and report that nobody "
    "answered."
)

# Script-aware: a goal may not be in English, and a danda is a terminator.
_TERMINATORS = ".!?।॥"

_FIELD_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def _as_sentence(text: str) -> str:
    """Strip any existing terminator so exactly one can be appended."""
    return text.strip().rstrip(_TERMINATORS).strip()


def build_goal(
    purpose: str,
    fields: list[str],
    callee_name: str,
    field_keys: list[str | None] | None = None,
) -> str:
    """Assemble the goal as clean, atomic sentences.

    Field numbering is parenthesised -- "(1)" not "1." -- because a period
    after a digit reads as a sentence boundary to anything parsing this text,
    including the provider's planner and any later diff. The list is one
    sentence so a changed field list reads as one change.
    """
    opening = _as_sentence(purpose)
    if opening:
        opening = opening[0].upper() + opening[1:]

    keys = list(field_keys or [None] * len(fields))
    keys += [None] * (len(fields) - len(keys))

    # A named field carries its key in the goal text: that is what makes the
    # provider echo the key back in result.summary.
    numbered = "; ".join(
        f"({i}) {k} -- {_as_sentence(f)}" if k else f"({i}) {_as_sentence(f)}"
        for i, (f, k) in enumerate(zip(fields, keys), 1)
    )

    named = [k for k in keys if k]
    key_clause = (
        f"Report the answers using the key names {', '.join(named)}. "
        if named
        else ""
    )

    # IDENTITY_CHECK governs how the call opens and self-positions, but the
    # purpose is stated first so the callee knows why the phone rang.
    return (
        f"{opening}. "
        f"{IDENTITY_CHECK.format(name=callee_name)} "
        f"{CALLER_REFERENCE} "
        f"Find out, in order: {numbered}. "
        f"{CONDITIONAL_FIELD} "
        f"{key_clause}"
        f"{IMPLAUSIBLE_ANSWER} "
        f"{REPORT_FAITHFULLY} "
        f"{DISCLOSURE} {PROHIBITIONS}"
    )


def _parse_field(spec: str) -> tuple[str | None, str]:
    """Split an optional "key=text" field spec into (key, text).

    Split on the FIRST "=" only, and only when what precedes it is a plain
    lowercase identifier. Anything else returns (None, spec) with the string
    intact -- a field that legitimately contains an equals sign, such as
    "is the price = list price", must not be silently turned into a key.

    The unnamed path returns the spec unmodified, not stripped: the stored
    record of a question has to be the question as it was given.
    """
    if "=" not in spec:
        return None, spec
    head, _, tail = spec.partition("=")
    head = head.strip()
    if not _FIELD_KEY_RE.match(head) or not tail.strip():
        return None, spec
    return head, tail.strip()


_TRAILING_NOTE = re.compile(r"[.;]\s+(?=[A-Za-z][A-Za-z0-9_]*\s*[:=])")


def _extract_fields(summary: str | None, keys: list[str]) -> dict[str, str]:
    """Recover key: value pairs from the provider's prose summary.

    Splits on the KNOWN KEY NAMES, never on punctuation: the delimiter is not
    stable across surfaces or runs -- colon and equals, comma and semicolon
    have all been observed, and nothing guarantees either. Keys are matched
    longest-first so a key that is a prefix of another ("price" inside
    "unit_price") cannot claim the longer one's match.

    Returns {} when nothing matches. The caller decides what absence means.
    """
    if not summary or not keys:
        return {}
    ordered = sorted({k for k in keys if k}, key=len, reverse=True)
    if not ordered:
        return {}
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(k) for k in ordered) + r")\s*[:=]\s*",
        re.IGNORECASE,
    )
    matches = list(pattern.finditer(summary))
    if not matches:
        return {}

    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        if i + 1 < len(matches):
            end = matches[i + 1].start()
        else:
            # The last value has no following key to stop it, so without this
            # it runs to the end of the summary and swallows the trailing note
            # that provider summaries commonly append. Cut at a sentence break
            # followed by a key-shaped token, requiring BOTH: that leaves
            # "6:30PM" and "Yes. They open at nine" alone. Under-trims when a
            # note is appended with no separator, which is the safe direction.
            end = len(summary)
            note = _TRAILING_NOTE.search(summary, m.end())
            if note:
                end = note.start()
        value = summary[m.end():end].strip()
        # Trim a trailing separator only, never punctuation inside the value.
        value = value.rstrip().rstrip(";,").strip()
        if value:
            out[m.group(1).lower()] = value
    return out


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

MAX_RECIPIENTS = 5

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def _validate_e164(phone: str) -> str:
    """Reject a malformed number locally rather than at call time.

    Format only: no country list, no length table per region. A number with
    formatting in it is rejected rather than silently repaired, because a
    repaired number is a number nobody approved.
    """
    p = phone.strip()
    if not _E164_RE.match(p):
        raise CallAgentError(
            f"{phone!r} is not E.164. Expected a leading + and digits only, "
            "e.g. +15550101234. Remove spaces, dashes and brackets."
        )
    return p


def _validate_region(region: str | None) -> str | None:
    """Format check only.

    No local copy of the provider's supported-region table: a stale copy fails
    by refusing a call that would have worked. An unsupported region is the
    provider's to reject. Note GB, not UK.
    """
    if region is None:
        return None
    r = region.strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", r):
        raise CallAgentError(
            f"region {region!r} should be a two-letter code (US, SG, IN, GB). "
            "Note GB, not UK. Omit --region entirely to let the provider "
            "resolve it from the phone number."
        )
    return r


def _check_cap(phones: list[str]) -> None:
    """Blast radius under a single approval gate.

    One confirm_token authorises the whole plan, and an in-flight call cannot
    be cancelled. So the recipient count is the number of irrevocable actions
    that one human decision commits to. Bounded here, locally and free,
    rather than discovered mid-run.
    """
    if len(phones) > MAX_RECIPIENTS:
        raise CallAgentError(
            f"{len(phones)} recipients exceeds the cap of {MAX_RECIPIENTS}. "
            "One plan carries one confirm_token, so every recipient on it is "
            "authorised by a single human approval -- and an in-flight call "
            "cannot be cancelled. Split into separate plans, each approved "
            "on its own."
        )


# --------------------------------------------------------------------------
# Run-state sidecar
#
# The provider does not echo back what was asked for, so the field list would
# be lost between plan and status. Without it there is nothing to score
# completeness against, and reporting degrades to "read the summary".
#
# It is also the only durable copy of a result: the provider ages runs out,
# and a deleted run reports FAILED rather than "gone".
# --------------------------------------------------------------------------


def _safe_key(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", key)


def _state_path(key: str) -> Path:
    return STATE_DIR / f"{_safe_key(key)}.json"


def _result_path(key: str) -> Path:
    """Sibling of _state_path, distinct suffix.

    Deliberately NOT the plan sidecar: anything that globs *.json in this
    directory and rewrites what it touches would parse and rewrite a result
    blob without knowing it was there.
    """
    return STATE_DIR / f"{_safe_key(key)}.result.json"


def _write_json(path: Path, data: dict) -> None:
    """Write 0600 at creation, then rename.

    chmod after rename leaves a window in which the file exists at the
    process umask. mkstemp creates 0600 and never widens.
    """
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        STATE_DIR.chmod(0o700)
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(dir=str(STATE_DIR), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def save_state(key: str, data: dict) -> None:
    _write_json(_state_path(key), data)


def load_state(key: str) -> dict:
    p = _state_path(key)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


RESULT_KEYS = (
    "extracted_fields",
    "extraction_status",
    "extraction_missing_keys",
    "extraction_note",
    "run_id",
    "state",
    "provider_state",
    "next_action",
    "summary",
    "evidence",
    "transcript",
    "telephony",
    "to_phones",
    "fields_requested",
    "purpose",
    "raw",
)


def _attach_extracted(envelope: dict, state: dict) -> None:
    """Parse result.summary into extracted_fields, in place.

    The keys come from the plan sidecar rather than the provider payload,
    which is why this cannot live in to_envelope.

    extracted_fields is ABSENT when nothing parses, never an empty dict: a
    summary that could not be parsed and a summary with no fields in it are
    different, and a caller has to be able to tell.

    When keys were requested and none matched, extraction_status says so.
    Observed live: a call that answered both questions came back with the
    answers in prose and no key=value pairs at all, despite the instruction
    to use the key names surviving into the plan text verbatim. Without a
    status the caller sees the same empty result as a call where nothing was
    said, and silently degrades to reading the summary.

    Nothing here tries to recover fields from prose. Inventing structure from
    a sentence is how an answer nobody gave ends up in a report.
    """
    keys = [k for k in (state.get("field_keys") or []) if k]
    if not keys:
        return

    found = _extract_fields(envelope.get("summary"), keys)
    if found:
        envelope["extracted_fields"] = found
        missing = [k for k in keys if k not in found]
        envelope["extraction_status"] = (
            "partial" if missing else "parsed"
        )
        if missing:
            envelope["extraction_missing_keys"] = missing
        return

    if envelope.get("summary"):
        # A summary exists and not one requested key appeared in it. The
        # answers may still be in the summary or the transcript, in prose.
        envelope["extraction_status"] = "no_keys_in_summary"
        envelope["extraction_note"] = (
            "The provider did not report answers under the requested key "
            "names. Read the summary and the transcript; do not treat this "
            "as an unanswered call."
        )
    else:
        envelope["extraction_status"] = "no_summary"


def _load_result(run_id: str) -> dict:
    p = _result_path(run_id)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_result(envelope: dict) -> None:
    """Persist a TERMINAL call outcome beside its plan sidecar.

    Never raises: a failed write must not cost the caller the result they are
    holding in memory. The report matters more than the record of it.

    `raw` is kept in full despite being most of the payload -- activity[]
    lives nowhere else, and this is the only local copy once the provider
    ages the run out.
    """
    state = envelope.get("state")
    if not state or state == "in_progress":
        return
    run_id = envelope.get("run_id")
    if not run_id:
        return

    rec = {k: envelope.get(k) for k in RESULT_KEYS if k in envelope}
    rec["written_at"] = _now()

    # A terminal run whose payload is empty. Marked because the file is
    # structurally complete and substantively hollow, and on disk that is
    # indistinguishable from a call where nothing was said -- a no-answer, a
    # dead-air call, a callee who hung up at once. All are real outcomes.
    #
    # Deliberately does not try to say WHY it is empty: aged-out and
    # genuinely-silent are not separable from this payload, and guessing
    # would be worse than naming the ambiguity.
    hollow = not (
        rec.get("summary") or rec.get("evidence") or rec.get("transcript")
    )
    if hollow:
        rec["content_empty"] = True
        # A hollow read must never replace a record that has content. The
        # provider deletes runs without notice, and a deleted run reports
        # FAILED rather than "gone". The hollow read is itself dated evidence,
        # so it is appended to the surviving record instead of discarded:
        # keeping both is the point -- the content, and the fact that the
        # provider later denied the run.
        prior = _load_result(run_id)
        if prior and (
            prior.get("summary")
            or prior.get("evidence")
            or prior.get("transcript")
        ):
            prior.setdefault("hollow_reads", []).append(
                {
                    "read_at": rec["written_at"],
                    "state": rec.get("state"),
                    "provider_state": rec.get("provider_state"),
                    "message": (envelope.get("raw") or {}).get("message"),
                }
            )
            rec = prior

    # The envelope should never carry a spend credential. Refuse rather than
    # trust. NOTE: this checks the ENVELOPE, not `rec` -- rec is filtered
    # through RESULT_KEYS, which never contains confirm_token, so a check
    # against rec could not fire.
    if "confirm_token" in envelope or "confirm_token" in (
        envelope.get("raw") or {}
    ):
        print(
            "call_agent: refusing to write result sidecar -- confirm_token "
            "present in envelope",
            file=sys.stderr,
        )
        return

    try:
        _write_json(_result_path(run_id), rec)
    except Exception as exc:  # noqa: BLE001 -- never fatal, see docstring
        print(f"call_agent: result sidecar write failed: {exc}", file=sys.stderr)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_window(state: dict) -> None:
    """An approval does not outlive its confirmation window."""
    expiry = state.get("confirm_expires_at")
    if not expiry:
        return
    try:
        exp = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
    except ValueError:
        return
    if datetime.now(timezone.utc) >= exp:
        raise CallAgentError(
            f"confirm window expired at {expiry}. The approval no longer "
            "authorises this call -- re-plan, do not resume."
        )


# --------------------------------------------------------------------------
# Verbs
# --------------------------------------------------------------------------


def cmd_plan(args: argparse.Namespace) -> dict:
    provider = get_provider()

    callee_name = (args.callee_name or "").strip()
    if not callee_name:
        raise CallAgentError("--callee-name is required.")

    phones = [_validate_e164(p) for p in args.to]
    _check_cap(phones)

    # Parse once, here. The clean question text is what gets stored, so the
    # record of what was asked is the question rather than the "key=text" spec.
    parsed = [_parse_field(f) for f in args.field]
    field_keys = [k for k, _ in parsed]
    field_texts = [t for _, t in parsed]

    goal = build_goal(args.purpose, field_texts, callee_name, field_keys)
    region = _validate_region(args.region or REGION)
    language = args.language or LANGUAGE

    structured = provider.plan(phones, goal, region=region, language=language)

    plan_id = structured.get("plan_id")
    if not plan_id:
        raise CallAgentError(
            f"provider returned no plan_id: {json.dumps(structured)[:300]}"
        )

    display_goal = structured.get("display_goal") or ""
    goal_modified = display_goal.strip() != goal.strip()

    ready = structured.get("ready_to_run")
    record = {
        "plan_id": plan_id,
        "confirm_token": structured.get("confirm_token"),
        "confirm_expires_at": structured.get("confirm_expires_at"),
        "ready_to_run": ready,
        "to_phones": phones,
        "callee_name": callee_name,
        "purpose": args.purpose,
        "fields_requested": field_texts,
        "field_keys": field_keys,
        "goal_sent": goal,
        "display_goal": display_goal,
        "goal_modified_by_provider": goal_modified,
        "planned_at": _now(),
        "argv": provider.last_argv,
    }

    # A plan the provider will not run yet. It answers with questions rather
    # than a token, and those questions are answerable -- which region a +1
    # number belongs to, for instance. Dropping them leaves the caller with a
    # plan that looks fine here and fails at run time with "no confirm_token",
    # which says nothing about what was actually needed.
    questions = structured.get("clarifying_questions") or []
    if questions:
        record["clarifying_questions"] = list(questions)

    save_state(plan_id, record)

    # The token is never returned to the caller: it is a spend credential and
    # belongs in the sidecar, not in stdout or a scrollback.
    out = {k: v for k, v in record.items() if k != "confirm_token"}
    if ready is False or not structured.get("confirm_token"):
        out["next"] = (
            "NOT READY TO RUN. The provider needs more information before it "
            "will issue a confirmation token. Answer the questions above and "
            "plan again."
        )
    else:
        out["next"] = f"review display_goal, then: run --plan-id {plan_id}"
    return out


def cmd_run(args: argparse.Namespace) -> dict:
    provider = get_provider()
    state = load_state(args.plan_id)
    if not state:
        raise CallAgentError(
            f"no local state for plan_id {args.plan_id}; it was not created "
            "by this tool, or state was lost. Re-plan."
        )
    _check_window(state)
    token = state.get("confirm_token")
    if not token:
        raise CallAgentError(f"no confirm_token stored for {args.plan_id}")

    structured = provider.run(args.plan_id, token)
    envelope = CalleProvider.to_envelope(structured)
    run_id = envelope.get("run_id")

    if run_id:
        # The token stays under the plan id only. Writing the whole plan
        # record under the run id too would put a second copy of a spend
        # credential in a second file, which anything pruning by plan id
        # would miss.
        carry = {k: v for k, v in state.items() if k != "confirm_token"}
        carry["run_id"] = run_id
        carry["ran_at"] = _now()
        save_state(run_id, carry)

        state["run_id"] = run_id
        state["ran_at"] = carry["ran_at"]
        save_state(args.plan_id, state)

    envelope["fields_requested"] = state.get("fields_requested", [])
    envelope["purpose"] = state.get("purpose")

    if not args.wait:
        return envelope
    return _poll(provider, run_id, state, args.max_wait)


def _poll(
    provider: Provider, run_id: str, state: dict, max_wait: int
) -> dict:
    """Bounded. Returns control rather than hanging the caller's session."""
    deadline = time.monotonic() + max_wait
    envelope: dict[str, Any] = {}
    delay = POLL_FLOOR_S

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            envelope = envelope or {}
            envelope["state"] = envelope.get("state") or "in_progress"
            envelope["timed_out_waiting"] = True
            envelope["note"] = (
                f"stopped waiting after {max_wait}s; the call may still be "
                f"running. Poll again: status --run-id {run_id}"
            )
            break
        time.sleep(min(delay, max(remaining, 0)))
        structured = provider.status(run_id)
        envelope = CalleProvider.to_envelope(structured)
        if envelope["state"] != "in_progress":
            break
        if envelope.get("next_action") == "report_result":
            break
        # Server-supplied cadence, clamped.
        suggested = envelope.get("poll_after_seconds")
        delay = (
            min(max(int(suggested), POLL_FLOOR_S), POLL_CEILING_S)
            if isinstance(suggested, (int, float))
            else POLL_FLOOR_S
        )

    envelope["fields_requested"] = state.get("fields_requested", [])
    envelope["purpose"] = state.get("purpose")
    _attach_extracted(envelope, state)
    save_result(envelope)
    return envelope


def cmd_status(args: argparse.Namespace) -> dict:
    provider = get_provider()
    state = load_state(args.run_id)
    if not state:
        # Not fatal -- a status read still works -- but the field list and
        # purpose are gone, so say so rather than returning a result that
        # looks complete and has nothing to score against.
        print(
            f"call_agent: no local state for {args.run_id}; reporting without "
            "the requested-field list",
            file=sys.stderr,
        )
    if args.wait:
        return _poll(provider, args.run_id, state, args.max_wait)

    envelope = CalleProvider.to_envelope(provider.status(args.run_id))
    envelope["fields_requested"] = state.get("fields_requested", [])
    envelope["purpose"] = state.get("purpose")
    _attach_extracted(envelope, state)
    save_result(envelope)
    return envelope


def cmd_show(args: argparse.Namespace) -> dict:
    """Local state for a plan or a run, plus the result if one exists.

    A plan id is followed to its run, so `show <plan_id>` after a call
    returns the outcome rather than only what was planned.
    """
    state = load_state(args.id)
    if not state:
        raise CallAgentError(f"no local state for {args.id}")
    state.pop("confirm_token", None)

    run_id = state.get("run_id") or args.id
    result = _load_result(run_id)
    if result:
        state["result"] = result
    return state


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser(
        prog="call_agent.py",
        description="Phone-call adapter. plan -> approve -> run.",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="verb", required=True)

    sp = sub.add_parser("plan", help="Build a call. Does not dial. Free.")
    sp.add_argument("--to", action="append", required=True, metavar="E164")
    sp.add_argument("--purpose", required=True)
    sp.add_argument(
        "--field",
        action="append",
        required=True,
        help=(
            "A single fact to retrieve. Repeat. Order is asked order. "
            "Optionally 'key=text' to have the answer reported under that "
            "key, e.g. unit_price=What does it cost. The key must be a plain "
            "lowercase identifier; anything else is treated as part of the "
            "question."
        ),
    )
    sp.add_argument(
        "--callee-name",
        required=True,
        metavar="NAME",
        help=(
            "The business name, said aloud at the open -- \"have I reached "
            "Miller Hardware?\" Give it as a person would say it, not as a "
            "directory listing. Without it the identity clause has nothing "
            "to substitute."
        ),
    )
    sp.add_argument(
        "--region",
        default=None,
        metavar="CODE",
        help=(
            "Recipient region code (US, SG, IN, GB...). Omit to let the "
            "provider resolve it from the number -- that is the default and "
            "usually correct. Note GB, not UK."
        ),
    )
    sp.add_argument(
        "--language",
        default=None,
        help=f"Spoken language. Default: {LANGUAGE}. Constrained by region.",
    )
    sp.set_defaults(func=cmd_plan)

    sr = sub.add_parser("run", help="Place an approved call.")
    sr.add_argument("--plan-id", required=True)
    sr.add_argument("--wait", action="store_true")
    sr.add_argument("--max-wait", type=int, default=DEFAULT_MAX_WAIT_S)
    sr.set_defaults(func=cmd_run)

    ss = sub.add_parser("status", help="Poll a run.")
    ss.add_argument("--run-id", required=True)
    ss.add_argument("--wait", action="store_true")
    ss.add_argument("--max-wait", type=int, default=DEFAULT_MAX_WAIT_S)
    ss.set_defaults(func=cmd_status)

    sh = sub.add_parser("show", help="Local state for a plan or run.")
    sh.add_argument("id")
    sh.set_defaults(func=cmd_show)

    args = p.parse_args()
    try:
        print(json.dumps(args.func(args), indent=2))
        return 0
    except CallAgentError as exc:
        print(json.dumps({"error": str(exc), "verb": args.verb}, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
