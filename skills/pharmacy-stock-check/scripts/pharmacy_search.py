#!/usr/bin/env python3
"""
Pharmacy stock check — reference implementation for the pharmacy-stock-check
Agent Skill.

Dry run is FULLY OFFLINE. It loads no credentials, opens no socket, and sends
no phone number or medication context anywhere. It validates the input and
prints the exact payload it would send. Only --live touches the network.

    python3 pharmacy_search.py --pharmacies pharmacies.csv           # offline
    python3 pharmacy_search.py --pharmacies pharmacies.csv --live    # calls

Live mode requires the CALL-E CLI to be authenticated and fastmcp installed:

    npm install -g @call-e/cli && calle auth login
    pip install fastmcp

Sample numbers use the reserved fictional range +1 555 0100–0199. Replace them
with real E.164 numbers you have permission to call.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import csv
import fcntl
import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("pharmacy-stock-check")

SERVER_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"
TOKEN_CACHE = Path.home() / ".calle-mcp" / "cli"

# Terminal responses include call transcripts. Keep them out of the working
# directory so they are neither committed by accident nor world-readable.
RUN_DIR = Path(os.environ.get("PHARMACY_RUN_DIR", "call_runs"))

# Bump when the run-identity scheme changes. An older ledger's keys won't match
# anything we compute, so unfinished entries must be refused rather than read as
# absent — "absent" means "dial them again".
LEDGER_SCHEMA = 3

TERMINAL_STATUSES = {"COMPLETED", "NO ANSWER", "DECLINED", "FAILED", "CANCELLED"}
TERMINAL_ACTIONS = {"report_result", "report_blocked", "none"}
BLOCKED_ACTIONS = {"ask_user_for_missing_info", "ask_user_for_retry_confirmation"}

# E.164: a plus, a non-zero country code digit, then 7-14 more digits.
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")

# Below this, a result is reported but never allowed to outrank a verified one.
MIN_CONFIDENCE = 0.6

FIELDS = [
    "in_stock", "form_available", "quantity_available", "unit_price", "currency",
    "requires_prescription", "can_hold", "hold_duration_hours",
    "alternative_suggested", "pharmacist_notes",
]
ENUMS = {
    "in_stock": {"yes", "no", "partial", "unknown"},
    "form_available": {"brand", "generic", "both", "unknown"},
    "requires_prescription": {"yes", "no", "unknown"},
    "can_hold": {"yes", "no", "unknown"},
}
NUMERIC = {"quantity_available", "unit_price", "hold_duration_hours"}
NULLISH = {"", "unknown", "unclear", "n/a", "na", "none", "not stated"}


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


class InvalidPhoneNumber(ValueError):
    pass


def validate_e164(phone: str) -> str:
    """Reject anything that isn't E.164 before it can be dialled.

    Documenting the requirement isn't enough — a local-format number silently
    reaching the planner is how the wrong person gets called.
    """
    cleaned = (phone or "").strip().replace(" ", "").replace("-", "")
    if not E164_RE.match(cleaned):
        raise InvalidPhoneNumber(
            f"{phone!r} is not E.164. Expected + followed by country code and "
            f"number, 8-15 digits total, e.g. +15550100. Do not guess a "
            f"country code — ask the user."
        )
    return cleaned


def mask(phone: str) -> str:
    """Never print a full number in a summary or log."""
    return f"…{phone[-4:]}" if len(phone) >= 4 else "…"


# --------------------------------------------------------------------------
# Budget
# --------------------------------------------------------------------------


class BudgetExceeded(RuntimeError):
    pass


@contextmanager
def _file_lock(path: Path):
    """Exclusive lock keyed on a sidecar file next to `path`."""
    lock_path = path.with_name(path.name + ".lock")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _write_private(path: Path, payload: str) -> None:
    """Atomic write, owner-readable only.

    These files hold confirm_tokens and call transcripts. Default umask would
    leave them world-readable on a shared machine.
    """
    fd, tmp = tempfile.mkstemp(dir=str(path.parent or "."), suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


@dataclass
class CallBudget:
    """Hard ceiling on outbound calls, enforced across processes.

    `to_phones` is an array, so ONE plan can spend N calls. The ledger is read,
    checked and incremented inside a single lock — an unlocked
    read/modify/write lets two processes both observe the same `spent`, both
    pass the ceiling check, and both dial.

    `check()` is only a fast pre-flight so a batch fails before the first call
    rather than halfway. `reserve()` is what actually enforces the ceiling.
    """

    max_calls: int
    ledger: Path = field(default=Path(".pharmacy_budget.json"))

    def _read(self) -> int:
        if not self.ledger.exists():
            return 0
        text = self.ledger.read_text()
        if not text.strip():
            return 0
        try:
            return int(json.loads(text).get("spent", 0))
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise BudgetExceeded(
                f"Budget ledger {self.ledger} is unreadable. Refusing to dial: "
                f"assuming zero spent would ignore the ceiling entirely."
            ) from exc

    @property
    def spent(self) -> int:
        with _file_lock(self.ledger):
            return self._read()

    @property
    def remaining(self) -> int:
        return max(0, self.max_calls - self.spent)

    def check(self, n: int) -> None:
        """Advisory pre-flight. Not a guarantee — see reserve()."""
        remaining = self.remaining
        if n > remaining:
            raise BudgetExceeded(
                f"{n} call(s) needed, {remaining} left of {self.max_calls}."
            )

    def reserve(self, n: int = 1) -> int:
        """Atomically claim n calls. This is the ceiling's real enforcement."""
        with _file_lock(self.ledger):
            spent = self._read()
            if spent + n > self.max_calls:
                raise BudgetExceeded(
                    f"{n} call(s) needed, {max(0, self.max_calls - spent)} left "
                    f"of {self.max_calls}."
                )
            spent += n
            _write_private(self.ledger, json.dumps({"spent": spent}))
            log.warning("Placed %s call(s) — %s/%s used", n, spent, self.max_calls)
            return spent


# --------------------------------------------------------------------------
# Durable run state
# --------------------------------------------------------------------------


class StateCorrupted(RuntimeError):
    """The run ledger could not be read. Refuse to proceed rather than
    starting from a blank slate, which would redial everything."""


class RunLocked(RuntimeError):
    """Another live process holds this recipient."""


class ConfigurationMismatch(RuntimeError):
    """An unresolved call exists under provider configuration we can't
    reconcile against. Neither resumable nor safe to redial."""


class AmbiguousRun(RuntimeError):
    """run_call was sent but no run_id was recorded. Whether a call was
    placed is unknown, so it must not be retried automatically."""


@dataclass
class RunStore:
    """Crash-safe, concurrency-safe ledger of in-flight calls.

    Two different keys, doing two different jobs — conflating them was a bug:

    * **The claim key is coarse**: recipient + purpose, nothing else. It is the
      exclusion lock, and it must span every provider configuration. If it
      included endpoint, account or region, changing any of those would make an
      unresolved call look absent and permit a second dial to the same person.

    * **The attempt record is specific**: endpoint, principal, region, plan and
      run ids, nested under the claim. It is what reconciliation is checked
      against. A stored attempt whose configuration differs from the current one
      is neither resumed nor redialled — it's surfaced for a human, because we
      can't act on another configuration's plan and can't assume the call never
      happened.

    Everything else is about surviving a crash without redialling: locked
    read-modify-write, atomic private writes, loud failure on corruption,
    terminal result recorded before the entry is retired, and an ambiguous
    create that is never retried automatically.

    States: planned -> dialing -> running -> done
    """

    path: Path = field(default=Path(".pharmacy_runs.json"))

    # Current provider configuration. Recorded on the attempt, compared on
    # resume — never mixed into the claim key.
    server_url: str = SERVER_URL
    principal: str | None = None

    # Claims held by THIS process. The file lock stops two processes racing; it
    # does nothing about two coroutines in one process, because they share a
    # pid.
    _active: set[str] = field(default_factory=set, repr=False)

    # -- locking ------------------------------------------------------------

    @contextmanager
    def _locked(self):
        with _file_lock(self.path):
            yield

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        text = self.path.read_text()
        if not text.strip():
            return {}
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            quarantine = self.path.with_name(
                f"{self.path.name}.corrupt.{int(time.time())}"
            )
            self.path.rename(quarantine)
            raise StateCorrupted(
                f"Run ledger {self.path} is unreadable and has been moved to "
                f"{quarantine}. Refusing to continue: treating a corrupt ledger "
                f"as empty would redial every in-flight recipient."
            ) from exc

        schema = raw.get("schema")
        entries = raw.get("entries")
        if schema == LEDGER_SCHEMA and isinstance(entries, dict):
            return entries

        legacy = entries if isinstance(entries, dict) else raw
        pending = {
            k: v for k, v in legacy.items()
            if isinstance(v, dict) and v.get("state") != "done"
        }
        if pending:
            raise StateCorrupted(
                f"Run ledger {self.path} uses schema {schema!r} (now "
                f"{LEDGER_SCHEMA}) and still holds {len(pending)} unfinished "
                f"entr{'y' if len(pending) == 1 else 'ies'}. Claim keys changed, "
                f"so those entries would not be found and their recipients would "
                f"be dialled again. Let the in-flight calls finish, or remove the "
                f"file deliberately:\n  {self.path}"
            )
        return {}

    def _write(self, entries: dict[str, Any]) -> None:
        _write_private(self.path, json.dumps(
            {"schema": LEDGER_SCHEMA, "entries": entries}, indent=2
        ))

    # -- keys ---------------------------------------------------------------

    @staticmethod
    def claim_key(phone: str, goal: str) -> str:
        """Exclusion identity: who we are calling, and what about.

        Deliberately free of provider configuration. This key answers "is there
        an unresolved call to this person about this thing?", and that question
        must have the same answer regardless of which endpoint, account or
        region a previous attempt used.
        """
        return hashlib.sha256(f"{phone}|{goal}".encode()).hexdigest()[:32]

    def attempt_config(self, region: str) -> dict[str, Any]:
        """The provider configuration a call is made under."""
        return {
            "endpoint": self.server_url,
            "principal": self.principal,
            "region": region.upper(),
        }

    # -- api ----------------------------------------------------------------

    @staticmethod
    def _alive(pid: int | None) -> bool:
        if not pid or pid == os.getpid():
            return pid == os.getpid()
        try:
            os.kill(pid, 0)
        except (ProcessLookupError, PermissionError, OSError):
            return False
        return True

    def claim(self, key: str, phone_masked: str, region: str) -> dict[str, Any]:
        """Take the exclusion claim for a recipient, or explain why we can't.

        Raises rather than returning on every path where dialling would be
        unsafe: another live process holds it, a previous create's outcome is
        unknown, or the pending attempt was made under a configuration we
        cannot reconcile against.
        """
        if key in self._active:
            raise RunLocked(
                f"{phone_masked}: already in flight in this process. Duplicate "
                f"entries for the same recipient and goal are not dialled twice."
            )

        wanted = self.attempt_config(region)

        with self._locked():
            data = self._read()
            entry = data.get(key)

            if entry is None:
                entry = {
                    "state": "planned",
                    "pid": os.getpid(),
                    "phone_masked": phone_masked,
                    "attempt": wanted,
                    "claimed_at": datetime.now(timezone.utc).isoformat(),
                }
                data[key] = entry
                self._write(data)
                self._active.add(key)
                return entry

            if entry.get("state") == "dialing":
                raise AmbiguousRun(
                    f"{phone_masked}: a call was submitted but no run id was "
                    f"recorded, so whether the phone rang is unknown. Not "
                    f"retrying automatically. Check plan "
                    f"{(entry.get('attempt') or {}).get('plan_id')}, then record "
                    f"the run id or remove this entry to allow a redial."
                )

            stored = entry.get("attempt") or {}
            mismatch = {
                field_name: (stored.get(field_name), wanted.get(field_name))
                for field_name in ("endpoint", "principal", "region")
                if stored.get(field_name) != wanted.get(field_name)
            }
            if mismatch:
                detail = "; ".join(
                    f"{k}: pending={was!r} now={now!r}"
                    for k, (was, now) in mismatch.items()
                )
                raise ConfigurationMismatch(
                    f"{phone_masked}: an unresolved call exists for this "
                    f"recipient and goal, but it was made under a different "
                    f"configuration ({detail}).\n"
                    f"Not resuming — a plan or run id from one endpoint or "
                    f"account is meaningless under another. Not redialling "
                    f"either — the earlier call may still be live, and this "
                    f"person should not be rung twice.\n"
                    f"Resolve it under the original configuration, or remove "
                    f"the entry deliberately once you know what happened."
                )

            if self.principal is None:
                raise ConfigurationMismatch(
                    f"{phone_masked}: an unresolved call exists, but the "
                    f"authenticated account could not be identified, so it "
                    f"cannot be confirmed as ours. Failing closed rather than "
                    f"resuming another account's run or redialling. Set "
                    f"CALLE_ACCOUNT_ID, or resolve the entry deliberately."
                )

            owner = entry.get("pid")
            if (
                entry.get("state") in {"planned", "running"}
                and owner != os.getpid()
                and self._alive(owner)
            ):
                raise RunLocked(
                    f"{phone_masked}: held by live process {owner}. "
                    f"Not dialling concurrently."
                )

            entry["pid"] = os.getpid()
            data[key] = entry
            self._write(data)
            self._active.add(key)
            return entry

    def update(self, key: str, **fields: Any) -> None:
        """Update the entry. Keys in `attempt` are nested, not flattened."""
        attempt_fields = {
            k: fields.pop(k) for k in list(fields)
            if k in {"plan_id", "confirm_token", "confirm_expires_at", "run_id"}
        }
        with self._locked():
            data = self._read()
            entry = data.setdefault(key, {})
            if attempt_fields:
                entry.setdefault("attempt", {}).update(attempt_fields)
            entry.update(fields)
            entry["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._write(data)

    def mark_done(self, key: str, result_path: str | None = None) -> None:
        """Record completion — only after the terminal result is durable."""
        self.update(key, state="done", result_path=result_path,
                    completed_at=datetime.now(timezone.utc).isoformat())
        self._active.discard(key)

    def prune_done(self) -> int:
        with self._locked():
            data = self._read()
            stale = [k for k, v in data.items() if v.get("state") == "done"]
            for k in stale:
                data.pop(k)
            if stale:
                self._write(data)
            return len(stale)

    def get(self, key: str) -> dict[str, Any]:
        with self._locked():
            return self._read().get(key, {})

    def release(self, key: str) -> None:
        """Drop a claim that never reached `dialing`. Safe: no call was sent."""
        with self._locked():
            data = self._read()
            entry = data.get(key)
            attempt = (entry or {}).get("attempt") or {}
            if entry and entry.get("state") == "planned" and not attempt.get("run_id"):
                data.pop(key)
                self._write(data)
        self._active.discard(key)



# --------------------------------------------------------------------------
# Goal and parsing
# --------------------------------------------------------------------------


def build_goal(drug: str, dosage: str, quantity: str) -> str:
    """MCP has no result_schema, so the field list lives in the prose.
    CALL-E honours these key names and emits them into result.summary."""
    return (
        "You are calling a pharmacy on behalf of a patient looking for a "
        "medication. Identify yourself as an automated assistant immediately, "
        "and keep the call brief and polite.\n\n"
        f"Find out whether they currently have {drug} {dosage} in stock. The "
        f"patient needs {quantity}.\n\n"
        "Capture these fields in the structured result, using exactly these key names:\n"
        "- in_stock: yes, no, partial, or unknown. Use partial if they have some "
        "but fewer than the patient needs.\n"
        "- form_available: brand, generic, both, or unknown\n"
        "- quantity_available: integer units they have\n"
        "- unit_price: number, price per unit\n"
        "- currency: three-letter currency code\n"
        "- requires_prescription: yes, no, or unknown\n"
        "- can_hold: yes, no, or unknown\n"
        "- hold_duration_hours: number of hours they will hold it\n"
        "- alternative_suggested: any alternative or other branch they mention\n"
        "- pharmacist_notes: anything else useful, one short sentence\n\n"
        "If they do not have it, still ask about alternatives or another branch. "
        "Do not place an order or commit to anything on the patient's behalf. "
        "Thank them and end the call. If nobody answers, report that the pharmacy "
        "could not be reached; do not treat that as a successful stock check."
    )


_FIELD_RE = re.compile(
    r"\b(" + "|".join(sorted(FIELDS, key=len, reverse=True)) + r")\s*=\s*", re.I
)


def parse_summary(summary: str) -> dict[str, str]:
    """Extraction arrives in result.summary as key=value pairs, not in
    result.extracted. Values contain commas, so split on key= boundaries.

    The separator between fields is not stable — both ", " and "; " observed.
    """
    if not summary:
        return {}
    matches = list(_FIELD_RE.finditer(summary))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(summary)
        value = summary[m.end():end].strip().strip(",;").strip()
        out[m.group(1).lower()] = value.rstrip(".;,") if len(value) < 40 else value
    return out


def normalise(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in FIELDS:
        value = raw.get(name)
        text = str(value).strip().lower() if value is not None else ""
        if name in ENUMS:
            out[name] = text if text in ENUMS[name] else "unknown"
        elif name in NUMERIC:
            match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
            out[name] = float(match.group()) if match else None
        else:
            out[name] = None if text in NULLISH else str(value).strip()
    return out


def to_record(final: dict[str, Any], pharmacy: dict[str, str]) -> dict[str, Any]:
    """Build a record, refusing to report stock fields from an incomplete call.

    A call that failed, went to voicemail, or was cut off can still carry a
    partially filled summary. Treating that as a stock check is how a patient
    gets sent somewhere on the strength of a sentence nobody finished.
    """
    result = final.get("result") or {}
    outcome = result.get("outcome") or {}
    confidence = (outcome.get("completion_confidence") or {}).get("score")
    completed = outcome.get("task_completed") is True
    status = (final.get("status") or "").upper()

    reached = completed and status == "COMPLETED"
    verified = reached and (confidence is not None and confidence >= MIN_CONFIDENCE)

    if reached:
        summary = result.get("summary") or result.get("post_summary") or ""
        record = normalise(parse_summary(summary))
    else:
        # Not a stock check. Say so rather than reporting whatever was scraped.
        record = {name: ("unknown" if name in ENUMS else None) for name in FIELDS}
        record["pharmacist_notes"] = (
            f"Call did not complete ({status.lower() or 'unknown status'}). "
            f"No stock information obtained."
        )

    record.update(
        pharmacy=pharmacy.get("name"),
        phone_masked=mask(pharmacy.get("phone", "")),
        run_status=final.get("status"),
        task_completed=completed,
        confidence=confidence,
        reached=reached,
        verified=verified,
        evidence=outcome.get("evidence") or [],
        transcript=result.get("transcript"),
    )
    return record


def rank(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Verified results first, then stock, then price, then hold.

    Verification outranks stock status deliberately. A confident "no" is more
    useful than an unreliable "yes" that sends someone across town while
    unwell — so a low-confidence yes must never outrank a high-confidence no.
    """
    order = {"yes": 0, "partial": 1, "unknown": 2, "no": 3}

    def key(r: dict[str, Any]):
        return (
            0 if r.get("verified") else 1,          # verified beats everything
            order.get(r.get("in_stock"), 3),
            r["unit_price"] if r.get("unit_price") is not None else float("inf"),
            0 if r.get("can_hold") == "yes" else 1,
        )

    return sorted(records, key=key)


# --------------------------------------------------------------------------
# CALL-E — live only. Nothing here is imported or touched in dry run.
# --------------------------------------------------------------------------


def _extract_token(data: dict[str, Any]) -> str | None:
    for key in ("access_token", "accessToken", "token", "bearer"):
        value = data.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            for inner in ("access_token", "accessToken", "token"):
                if isinstance(value.get(inner), str):
                    return value[inner]
    return None


def _endpoint_of(data: dict[str, Any]) -> str | None:
    for key in ("server_url", "serverUrl", "endpoint", "audience", "mcp_url"):
        value = data.get(key)
        if isinstance(value, str):
            return value
    return None


def _jwt_claims(token: str) -> dict[str, Any]:
    """Read a JWT payload without verifying it.

    Verification is the server's job — we only want a stable identifier for the
    account, so an unverified claim is fine for namespacing. It is NOT used for
    any authorisation decision.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return {}


def _principal_of(token: str, cache: dict[str, Any]) -> str | None:
    """A stable identity for the authenticated account, or None.

    Deliberately NOT the token-cache directory: CALL-E derives that from the
    server URL, so re-authenticating as a different account on the same
    endpoint reuses the same directory. Namespacing on it would let an
    account-A run be resumed with account-B credentials.

    Order: explicit override, an id recorded in the cache, then a JWT subject.
    """
    override = os.environ.get("CALLE_ACCOUNT_ID")
    if override:
        return override.strip()

    for key in ("account_id", "accountId", "user_id", "userId", "sub",
                "principal", "email", "account"):
        value = cache.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            for inner in ("id", "sub", "email"):
                if isinstance(value.get(inner), str):
                    return value[inner].strip()

    claims = _jwt_claims(token)
    for key in ("sub", "account_id", "uid", "email", "client_id"):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _cli_auth_status() -> dict[str, Any] | None:
    """Ask the CALL-E CLI which cache belongs to which endpoint.

    This is the authoritative binding. The cache directory is a hash we don't
    control and shouldn't reverse-engineer, so rather than infer the mapping we
    ask the tool that created it.
    """
    try:
        result = subprocess.run(
            ["calle", "auth", "status"],
            capture_output=True, text=True, timeout=15, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def resolve_credential(server_url: str = SERVER_URL) -> tuple[str, str | None]:
    """Return (access_token, account_namespace) for `server_url`, or refuse.

    A bearer token is issued for one origin. Sending it anywhere else hands a
    working credential to a party it was never meant for — so an unbound cache
    is not "probably fine", it's an unknown recipient.

    Resolution order:
      1. CALLE_TOKEN_CACHE — explicit operator intent, trusted.
      2. `calle auth status` — the CLI states its own endpoint and cache path.
      3. A cache file that records the endpoint itself.
    If none of those bind the credential to `server_url`, refuse. A single
    cache with no endpoint recorded is NOT accepted: "only one" is not evidence
    that it belongs to this provider.
    """
    override = os.environ.get("CALLE_TOKEN_CACHE")
    if override:
        path = Path(override).expanduser()
        token = _extract_token(json.loads(path.read_text()))
        if not token:
            raise SystemExit(f"No access token found in {path}")
        return token, _principal_of(token, json.loads(path.read_text()))

    status = _cli_auth_status()
    if status:
        cli_endpoint = status.get("server_url")
        cache_path = status.get("cache_path")
        if cli_endpoint and cli_endpoint != server_url:
            raise SystemExit(
                f"The CALL-E CLI is authenticated against {cli_endpoint}, but "
                f"this skill is configured to call {server_url}. Refusing to "
                f"send that credential to a different origin. Re-run "
                f"`calle auth login` against the intended endpoint, or set "
                f"CALLE_TOKEN_CACHE deliberately."
            )
        if cli_endpoint == server_url and cache_path:
            path = Path(cache_path).expanduser()
            if not status.get("usable", True):
                raise SystemExit(
                    f"CALL-E CLI reports its cached credential is not usable "
                    f"({path}). Run: calle auth login"
                )
            cache = json.loads(path.read_text())
            token = _extract_token(cache)
            if not token:
                raise SystemExit(f"No access token found in {path}")
            return token, _principal_of(token, cache)

    candidates = sorted(TOKEN_CACHE.glob("*/token.json"))
    if not candidates:
        raise SystemExit(
            f"No CALL-E token under {TOKEN_CACHE}. Run: calle auth login"
        )

    parsed: list[tuple[Path, dict[str, Any]]] = []
    for path in candidates:
        try:
            parsed.append((path, json.loads(path.read_text())))
        except json.JSONDecodeError:
            log.warning("Skipping unreadable token cache %s", path)

    bound = [(p, d) for p, d in parsed if _endpoint_of(d) == server_url]
    if len(bound) == 1:
        token = _extract_token(bound[0][1])
        if not token:
            raise SystemExit(f"No access token found in {bound[0][0]}")
        return token, _principal_of(token, bound[0][1])
    if len(bound) > 1:
        raise SystemExit(
            f"{len(bound)} cached tokens claim endpoint {server_url}. Set "
            f"CALLE_TOKEN_CACHE to the one you intend to use:\n  " +
            "\n  ".join(str(p) for p, _ in bound)
        )

    raise SystemExit(
        f"Found {len(parsed)} cached CALL-E credential(s), none of which can be "
        f"bound to {server_url}.\n\n"
        f"`calle auth status` did not report a matching endpoint, and no cache "
        f"records one. A bearer token is issued for a single origin, so sending "
        f"one that might belong to a different provider is a credential "
        f"disclosure, not a routing mistake — refusing rather than assuming.\n\n"
        f"Either run `calle auth login` against {server_url}, or set "
        f"CALLE_TOKEN_CACHE explicitly:\n  " +
        "\n  ".join(str(p) for p, _ in parsed)
    )


def load_token(server_url: str = SERVER_URL) -> str:
    return resolve_credential(server_url)[0]


class Caller:
    """Live caller. Constructing this loads credentials, so it is only ever
    instantiated under --live."""

    def __init__(self, budget: CallBudget, store: RunStore) -> None:
        from fastmcp import Client
        from fastmcp.client.transports import StreamableHttpTransport

        self._Client = Client
        self._Transport = StreamableHttpTransport
        self.budget = budget
        self.store = store
        # Resolving the credential also tells us which account we're acting as,
        # which is part of a call's identity.
        self._token, principal = resolve_credential(SERVER_URL)
        self.store.server_url = SERVER_URL
        self.store.principal = principal
        if principal is None:
            log.warning(
                "Could not identify the authenticated account. New calls will "
                "proceed, but an unresolved call cannot later be confirmed as "
                "ours and will fail closed. Set CALLE_ACCOUNT_ID to avoid this."
            )

    def _client(self):
        return self._Client(self._Transport(
            SERVER_URL, headers={"Authorization": f"Bearer {self._token}"}
        ))

    @staticmethod
    def _unwrap(result: Any) -> dict[str, Any]:
        if getattr(result, "structured_content", None):
            return result.structured_content
        if getattr(result, "data", None):
            return result.data
        blocks = getattr(result, "content", None) or []
        if blocks and hasattr(blocks[0], "text"):
            return json.loads(blocks[0].text)
        return {}

    @staticmethod
    def _token_live(expires_at: str | None) -> bool:
        if not expires_at:
            return True
        return datetime.fromisoformat(
            expires_at.replace("Z", "+00:00")
        ) > datetime.now(timezone.utc)

    async def _poll(self, client, run_id: str, phone: str) -> dict[str, Any] | None:
        seen: set[str] = set()
        deadline = time.time() + 900
        delay = 2.0
        while time.time() < deadline:
            final = self._unwrap(
                await client.call_tool("get_call_run", {"run_id": run_id})
            )
            status = (final.get("status") or "").upper()
            nxt = final.get("next_step")
            nxt = nxt if isinstance(nxt, dict) else {}

            # The activity feed is cumulative on every poll — dedupe.
            for entry in final.get("activity", []):
                key = f"{entry.get('ts')}|{entry.get('message')}"
                if key not in seen:
                    seen.add(key)
                    log.info("    %s", entry.get("message"))

            action = nxt.get("action")
            if status in TERMINAL_STATUSES or action in TERMINAL_ACTIONS:
                return final
            if action in BLOCKED_ACTIONS:
                log.warning("  %s: needs user input — %s",
                            mask(phone), nxt.get("instruction"))
                return final

            delay = float(nxt.get("poll_after_seconds") or delay)
            await asyncio.sleep(min(delay, 15.0))
        return None

    def _record_terminal(self, key: str, phone: str, final: dict[str, Any]) -> str:
        """Write the terminal response to disk BEFORE the ledger is retired.

        If the ledger entry were cleared first, a crash in between would lose
        the result and the claim together — and the next invocation would
        redial.

        These files contain a third party's voice: the full transcript of a
        call with a pharmacist. They go in a dedicated directory, owner-only,
        never scattered next to the script where they get committed by
        accident. Override the location with PHARMACY_RUN_DIR.
        """
        RUN_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = RUN_DIR / f"run_{key[:12]}_{int(time.time())}.json"
        _write_private(path, json.dumps(final, indent=2, default=str))
        return str(path)

    async def call(self, pharmacy: dict[str, str], goal: str, region: str
                   ) -> dict[str, Any] | None:
        phone = validate_e164(pharmacy["phone"])
        key = self.store.claim_key(phone, goal)

        # Atomic claim. Raises if another live process holds this recipient, or
        # if a previous attempt left an ambiguous create.
        saved = self.store.claim(key, mask(phone), region)

        async with self._client() as client:
            # Resume an in-flight run rather than planning again.
            if saved.get("run_id"):
                log.info("  %s: resuming run %s", mask(phone), saved["run_id"][:12])
                final = await self._poll(client, saved["run_id"], phone)
                if final is None:
                    return None
                self.store.mark_done(
                    key, self._record_terminal(key, phone, final)
                )
                return to_record(final, pharmacy)

            # Reuse a stored plan if its confirm_token is still valid.
            plan = None
            if saved.get("plan_id") and self._token_live(saved.get("confirm_expires_at")):
                plan = {
                    "plan_id": saved["plan_id"],
                    "confirm_token": saved["confirm_token"],
                    "ready_to_run": True,
                }
                log.info("  %s: reusing plan %s", mask(phone), saved["plan_id"])

            if plan is None:
                plan = self._unwrap(await client.call_tool("plan_call", {
                    "goal": goal, "to_phones": [phone], "region": region,
                    "language": "English", "ttl_seconds": 0, "user_input": goal,
                }))
                if not plan.get("ready_to_run"):
                    log.warning("  %s: planner needs more detail — %s",
                                mask(phone), plan.get("clarifying_questions"))
                    self.store.release(key)   # nothing was dialled
                    return None
                self.store.update(
                    key,
                    plan_id=plan["plan_id"],
                    confirm_token=plan["confirm_token"],
                    confirm_expires_at=plan.get("confirm_expires_at"),
                )

            # Mark "dialing" BEFORE run_call. If the response is lost, the
            # ledger already says a call may have been placed — and claim()
            # will refuse to retry it rather than risk a second ring.
            self.store.update(key, state="dialing")
            self.budget.reserve(1)   # atomic; the ceiling's real enforcement

            run = self._unwrap(await client.call_tool("run_call", {
                "plan_id": plan["plan_id"], "confirm_token": plan["confirm_token"],
            }))
            run_id = run.get("run_id")
            if not run_id:
                log.error("  %s: no run id returned — left as ambiguous, "
                          "will not auto-retry", mask(phone))
                return None
            self.store.update(key, state="running", run_id=run_id)

            final = await self._poll(client, run_id, phone)
            if final is None:
                log.error("  %s: poll timed out — rerun to resume, not redial",
                          mask(phone))
                return None

            self.store.mark_done(key, self._record_terminal(key, phone, final))
            return to_record(final, pharmacy)


# --------------------------------------------------------------------------
# Dry run — fully offline
# --------------------------------------------------------------------------


def dry_run(pharmacies: list[dict[str, str]], goal: str, region: str) -> None:
    """Validate and print. No credentials read, no socket opened, no data sent.

    The point of a dry run in a workflow that calls real people is to be able
    to inspect exactly what would happen without anything leaving the machine.
    A dry run that still transmits the recipient's number and the medication
    being sought is not a dry run.
    """
    print(f"\nDRY RUN — offline. No credentials read, nothing sent.\n")
    for pharmacy in pharmacies:
        phone = validate_e164(pharmacy["phone"])
        # Numbers are masked here too. The masking rule covers anything
        # printed or logged — a dry run that echoes full E.164 numbers to the
        # terminal puts them in scrollback, CI logs and screen recordings.
        payload = {
            "tool": "plan_call",
            "goal": goal,
            "to_phones": [mask(phone)],
            "region": region,
            "language": "English",
            "ttl_seconds": 0,
        }
        print(f"  {pharmacy.get('name', '?')} ({mask(phone)}) — would send:")
        print("  " + json.dumps(payload, indent=2)[:400].replace("\n", "\n  "))
        print()
    print(f"  {len(pharmacies)} call(s) would be placed. Add --live to dial.")
    print(f"  Numbers shown masked; the real E.164 values are sent only "
          f"under --live.\n")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def render(records: list[dict[str, Any]]) -> None:
    print(f"\n{'Pharmacy':<24} {'Stock':<9} {'Qty':>5} {'Price':>10} "
          f"{'Rx':<8} {'Hold':>6} {'Conf':>6}")
    print("-" * 74)
    for r in rank(records):
        hold = f"{r['hold_duration_hours']:.0f}h" if r.get("hold_duration_hours") else "—"
        price = (f"{r['unit_price']:g} {r.get('currency') or ''}".strip()
                 if r.get("unit_price") is not None else "—")
        conf = f"{r['confidence']:.2f}" if r.get("confidence") is not None else "—"
        flag = "" if r.get("verified") else "  ⚠ unverified"
        print(f"{(r['pharmacy'] or '?')[:24]:<24} {r['in_stock']:<9} "
              f"{r['quantity_available'] or '—':>5} {price:>10} "
              f"{r['requires_prescription']:<8} {hold:>6} {conf:>6}{flag}")
        if r.get("pharmacist_notes"):
            print(f"    {r['pharmacist_notes']}")
    print()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Pharmacy stock check")
    parser.add_argument("--pharmacies", type=Path, default=Path("pharmacies.csv"))
    parser.add_argument("--drug", default="amoxicillin")
    parser.add_argument("--dosage", default="500mg")
    parser.add_argument("--quantity", default="21 capsules")
    parser.add_argument("--region", default="US")
    parser.add_argument("--max-calls", type=int, default=3)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--live", action="store_true",
                        help="ACTUALLY PLACE CALLS. Without this the run is "
                             "fully offline: no credentials, no network.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if not args.pharmacies.exists():
        raise SystemExit(f"No such file: {args.pharmacies}")
    with args.pharmacies.open() as fh:
        pharmacies = [row for row in csv.DictReader(fh) if row.get("phone")]

    # Validate every number before anything else happens, in either mode.
    try:
        for pharmacy in pharmacies:
            pharmacy["phone"] = validate_e164(pharmacy["phone"])
    except InvalidPhoneNumber as exc:
        raise SystemExit(f"Invalid phone number: {exc}")

    goal = build_goal(args.drug, args.dosage, args.quantity)

    # Collapse duplicate rows before dispatch. The same recipient listed twice
    # is a data-entry mistake, not a request to ring someone twice — and the
    # rows are launched concurrently, so nothing downstream would space them
    # out.
    seen: dict[str, dict[str, str]] = {}
    duplicates: list[str] = []
    for pharmacy in pharmacies:
        dedupe_key = f"{args.region.upper()}|{pharmacy['phone']}"
        if dedupe_key in seen:
            duplicates.append(f"{pharmacy.get('name', '?')} ({mask(pharmacy['phone'])})")
            continue
        seen[dedupe_key] = pharmacy
    if duplicates:
        log.warning(
            "Skipping %s duplicate row(s) for recipients already in this batch: %s",
            len(duplicates), ", ".join(duplicates),
        )
    pharmacies = list(seen.values())

    if not args.live:
        dry_run(pharmacies, goal, args.region)
        return

    budget = CallBudget(max_calls=args.max_calls)
    store = RunStore()
    budget.check(len(pharmacies))     # fail before dialling, not halfway

    caller = Caller(budget, store)
    print(f"\n{args.drug} {args.dosage} — {args.quantity} · "
          f"{len(pharmacies)} pharmacies · LIVE\n")

    semaphore = asyncio.Semaphore(args.concurrency)

    async def one(pharmacy: dict[str, str]):
        async with semaphore:
            try:
                return await caller.call(pharmacy, goal, args.region)
            except (AmbiguousRun, RunLocked, ConfigurationMismatch) as exc:
                # Not failures to retry past — these exist to stop a redial.
                log.error("  %s", exc)
                return None
            except Exception as exc:
                log.error("  %s failed: %s", pharmacy.get("name"), exc)
                return None

    results = [r for r in await asyncio.gather(*(one(p) for p in pharmacies)) if r]
    if results:
        render(results)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # A stack trace here is worse than unhelpful: the operator has just
        # interrupted a live call and needs to know that rerunning resumes it
        # rather than dialling the recipient a second time.
        print(
            "\nInterrupted. Any call already placed is still running on "
            "CALL-E's side.\nRerun the same command to resume polling — the "
            "ledger holds the run id, so it will not redial.\n"
            "  cat .pharmacy_runs.json    # inspect what's in flight"
        )
        raise SystemExit(130)
