"""The local attempt ledger: the primary duplicate-call control.

A retried workflow run must not become a second telephone call. The
idempotency key is still derived deterministically and still sent to CALL-E,
but this project has never exercised the vendor's replay behaviour at
runtime, so the vendor's guarantee is treated as UNKNOWN and nothing depends
on it. What depends on nothing outside this process is the ledger: the key
and a fingerprint of the exact request are reserved atomically *before* the
provider is invoked, and only a reservation this run created may proceed.

What the ledger stores is deliberately minimal — the key (already a digest),
the request fingerprint (a digest), a state, timestamps, and the vendor call
id once creation succeeds. No phone number, no transcript, no claim text,
no credentials ever enter it.

States a reservation can hold:

* ``RESERVED`` — reserved, provider interaction started, outcome not yet
  recorded. A crash after reservation leaves this row behind, which is the
  point: the durable record itself suppresses the retry.
* ``COMPLETED`` — the provider returned a terminal, interpretable result
  (``completed``, ``failed`` or ``canceled``). The business content may still
  be empty; the *attempt* is settled and will never be retried under this key.
* ``UNKNOWN`` — the provider raised, or returned a result whose outcome could
  not be determined (still in flight). An ``UNKNOWN`` attempt is never
  retried automatically: whether a call happened has to be reconciled by a
  human against the vendor's records before any new attempt is considered,
  and a new attempt requires a new source version and therefore a new key.

An unavailable ledger fails closed: no reservation, no provider call.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from .audit import (
    GENESIS_HASH,
    AttemptEvent,
    AuditActor,
    AuditReason,
    EventChain,
    build_event,
    verify_chain,
)
from .config import find_repository_root
from .providers.base import CallRequest

#: Ledger schema version, stored in ``PRAGMA user_version``. Forward-only:
#: a database written by a newer schema version than this code knows is
#: refused rather than best-effort read.
SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS attempt_ledger (
    idempotency_key     TEXT PRIMARY KEY,
    request_fingerprint TEXT NOT NULL,
    state               TEXT NOT NULL,
    reserved_at         TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    call_id             TEXT
)
"""

_EVENTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS attempt_events (
    seq              INTEGER PRIMARY KEY,
    timestamp        TEXT NOT NULL,
    actor            TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL,
    from_state       TEXT,
    to_state         TEXT NOT NULL,
    reason           TEXT NOT NULL,
    prior_hash       TEXT NOT NULL,
    row_hash         TEXT NOT NULL UNIQUE
)
"""


class LedgerRefusal(str, Enum):
    """Named reasons an attempt never reached the provider."""

    #: No ledger was supplied, or the ledger raised / could not be opened.
    #: The reservation is mandatory, so this fails closed.
    ATTEMPT_LEDGER_UNAVAILABLE = "ATTEMPT_LEDGER_UNAVAILABLE"
    #: The key was already reserved with the same request fingerprint.
    DUPLICATE_CALL_SUPPRESSED = "DUPLICATE_CALL_SUPPRESSED"
    #: The key was already reserved for a different request body.
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    #: A provider that can reach a real network was paired with a ledger that
    #: is not durable. Live-capable paths require a durable ledger.
    LEDGER_NOT_DURABLE = "LEDGER_NOT_DURABLE"
    #: The SQLite ledger path is missing or resolves inside the repository.
    LEDGER_PATH_MISSING = "LEDGER_PATH_MISSING"
    LEDGER_PATH_INSIDE_REPOSITORY = "LEDGER_PATH_INSIDE_REPOSITORY"


class AttemptState(str, Enum):
    """The lifecycle of one reserved attempt."""

    RESERVED = "RESERVED"
    COMPLETED = "COMPLETED"
    UNKNOWN = "UNKNOWN"


class AttemptLedgerUnavailable(RuntimeError):
    """The ledger could not be read, written or opened. Always fail closed."""


class AttemptReconciliationRequired(RuntimeError):
    """An attempt ended in a state only a human can settle.

    Raised when a call was created (or may have been) and the attempt could
    not be cleanly recorded — the provider failed ambiguously, or the
    call-id persistence after a successful creation failed. The durable
    reservation is retained and suppresses every retry under that key;
    reconciling what actually happened at the vendor is a human task.
    """


@dataclass(frozen=True)
class ReservationVerdict:
    """What one atomic ``reserve`` found. Safe metadata only."""

    created: bool
    state: AttemptState
    request_fingerprint: str | None = None
    reserved_at: str | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "created": self.created,
            "reservation_state": self.state.value,
            "reserved_at": self.reserved_at,
            "updated_at": self.updated_at,
        }


def request_fingerprint(request: CallRequest) -> str:
    """A digest of everything the provider would be asked to send.

    Covers the whole request body the vendor would see — task, recipient,
    schema, metadata, locale, region — so the same key paired with any change
    in the body is a conflict, not a silent replay. The digest is the only
    thing stored; the request itself never enters the ledger.
    """

    payload = json.dumps(
        {
            "task": request.task,
            "recipient_e164": request.recipient_e164,
            "result_schema": request.result_schema,
            "metadata": request.metadata,
            "locale": request.locale,
            "region": request.region,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ledger_path_refusals(path: Path | None) -> tuple[LedgerRefusal, ...]:
    """Refuse a ledger database path that would put call data into git."""

    if path is None:
        return (LedgerRefusal.LEDGER_PATH_MISSING,)
    resolved = path.expanduser().resolve()
    repo_root = find_repository_root()
    if repo_root is not None:
        try:
            resolved.relative_to(repo_root)
        except ValueError:
            return ()
        return (LedgerRefusal.LEDGER_PATH_INSIDE_REPOSITORY,)
    return ()


class AttemptLedger(Protocol):
    """Reserve attempts atomically and record how they ended."""

    #: True when the reservation survives the process that made it. A
    #: provider that can reach a real network must be paired with a durable
    #: ledger; the workflow refuses the pairing otherwise.
    durable: bool

    def reserve(
        self, idempotency_key: str, request_fingerprint: str
    ) -> ReservationVerdict:
        """Atomically create or find the reservation for this key.

        Creating it and finding it are one atomic step: two concurrent
        reservations of the same key cannot both report ``created``. Any
        failure to read or write raises
        :class:`AttemptLedgerUnavailable` — never a silent pass.
        """
        ...  # pragma: no cover - a Protocol declaration

    def mark_completed(self, idempotency_key: str) -> None:
        """The provider returned a terminal, interpretable result."""
        ...  # pragma: no cover - a Protocol declaration

    def mark_unknown(self, idempotency_key: str) -> None:
        """The attempt's outcome could not be determined. Never retried."""
        ...  # pragma: no cover - a Protocol declaration

    def attach_call_id(self, idempotency_key: str, call_id: str) -> None:
        """Record the vendor's call id against the reservation.

        Called by the provider immediately after creation succeeds and
        before the first status read, so a crash in between still leaves the
        correlation a human needs to reconcile the attempt. The call id is
        the only vendor identifier stored; it lives outside the repository
        with the rest of the ledger.
        """
        ...  # pragma: no cover - a Protocol declaration


class InMemoryAttemptLedger:
    """A non-durable ledger for fake-only demonstrations and tests.

    Atomic under threads (a lock serializes reservations) but deliberately
    not durable: it exists so the fake provider path can be exercised without
    a database. It cannot suppress anything across process restarts, which is
    exactly why a live-capable provider refuses to be paired with it. The
    hash-chained event log is kept with the same rules as the durable one,
    so audit behaviour is identical on every path.
    """

    durable = False

    def __init__(self) -> None:
        self._records: dict[str, dict[str, Any]] = {}
        self._chain = EventChain()
        self._lock = threading.Lock()

    def reserve(
        self, idempotency_key: str, request_fingerprint: str
    ) -> ReservationVerdict:
        with self._lock:
            record = self._records.get(idempotency_key)
            if record is None:
                now = _utc_now()
                self._records[idempotency_key] = {
                    "request_fingerprint": request_fingerprint,
                    "state": AttemptState.RESERVED,
                    "reserved_at": now,
                    "updated_at": now,
                }
                self._chain.append(
                    actor=AuditActor.WORKFLOW,
                    idempotency_key=idempotency_key,
                    from_state=None,
                    to_state=AttemptState.RESERVED.value,
                    reason=AuditReason.RESERVED,
                )
                return ReservationVerdict(
                    created=True,
                    state=AttemptState.RESERVED,
                    request_fingerprint=request_fingerprint,
                    reserved_at=now,
                    updated_at=now,
                )
            return ReservationVerdict(
                created=False,
                state=record["state"],
                request_fingerprint=record["request_fingerprint"],
                reserved_at=record["reserved_at"],
                updated_at=record["updated_at"],
            )

    def _mark(self, idempotency_key: str, state: AttemptState) -> None:
        with self._lock:
            record = self._records.get(idempotency_key)
            if record is None:
                raise AttemptLedgerUnavailable(
                    f"no reservation exists for {idempotency_key!r}"
                )
            from_state = record["state"]
            record["state"] = state
            record["updated_at"] = _utc_now()
            self._chain.append(
                actor=AuditActor.PROVIDER,
                idempotency_key=idempotency_key,
                from_state=from_state,
                to_state=state.value,
                reason=(
                    AuditReason.COMPLETED
                    if state is AttemptState.COMPLETED
                    else AuditReason.UNKNOWN
                ),
            )

    def mark_completed(self, idempotency_key: str) -> None:
        self._mark(idempotency_key, AttemptState.COMPLETED)

    def mark_unknown(self, idempotency_key: str) -> None:
        self._mark(idempotency_key, AttemptState.UNKNOWN)

    def attach_call_id(self, idempotency_key: str, call_id: str) -> None:
        with self._lock:
            record = self._records.get(idempotency_key)
            if record is None:
                raise AttemptLedgerUnavailable(
                    f"no reservation exists for {idempotency_key!r}"
                )
            record["call_id"] = call_id
            record["updated_at"] = _utc_now()
            self._chain.append(
                actor=AuditActor.PROVIDER,
                idempotency_key=idempotency_key,
                from_state=record["state"],
                to_state=record["state"],
                reason=AuditReason.CALL_ID_PERSISTED,
            )

    def find(self, idempotency_key: str) -> dict[str, Any] | None:
        """Inspect one reservation without creating or changing anything."""

        with self._lock:
            record = self._records.get(idempotency_key)
            return dict(record) if record is not None else None

    def audit_events(self) -> tuple[AttemptEvent, ...]:
        """The hash-chained transition log, oldest first."""

        with self._lock:
            return self._chain.events()

    def audit_chain_head(self, idempotency_key: str) -> str | None:
        """The chain head of the last event for one attempt."""

        with self._lock:
            return self._chain.head_for_key(idempotency_key)

    def audit_problems(self) -> list[str]:
        """Every way the in-memory chain has been tampered with."""

        with self._lock:
            return verify_chain(self._chain.events())


class SqliteAttemptLedger:
    """A durable ledger. One SQLite file, explicit path, never inside the repo.

    Every operation opens its own connection and wraps the read-modify-write
    in ``BEGIN IMMEDIATE``, so the check-then-insert of a reservation is a
    single atomic transaction against the database file: two processes (or
    one process restarted) cannot both reserve the same key. The commit
    happens before the provider is invoked, so a crash after reservation
    leaves a committed ``RESERVED`` (or ``UNKNOWN``) row that suppresses every
    later attempt under that key.

    Concurrency configuration, per platform: the database runs in WAL
    journal mode with a 5-second busy timeout. WAL lets a reader reconcile
    an attempt while another process writes, and the timeout covers the
    short window a writer holds the lock; a still-busy database raises and
    fails closed through :class:`AttemptLedgerUnavailable` exactly like any
    other unavailable ledger. On Windows the same settings apply and the
    test suite spawns worker processes with ``spawn`` (the default there),
    never ``fork``.

    Every mutation appends its transition to the hash-chained
    ``attempt_events`` table **in the same transaction**: the state row and
    its audit record commit or roll back together, so the event log can
    never disagree with the projection it was written beside.
    """

    durable = True

    def __init__(self, path: Path) -> None:
        refusals = ledger_path_refusals(path)
        if refusals:
            raise AttemptLedgerUnavailable(
                "ledger path refused: " + ", ".join(r.value for r in refusals)
            )
        self._path = path
        try:
            connection = self._connect()
            try:
                connection.execute(_SCHEMA)
                connection.execute(_EVENTS_SCHEMA)
                # Forward-only schema versioning: a database written by a
                # newer schema than this code knows is refused, never read
                # on a best-effort basis.
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                if version > SCHEMA_VERSION:
                    raise AttemptLedgerUnavailable(
                        f"attempt ledger at {path} uses schema version "
                        f"{version}, newer than the supported version "
                        f"{SCHEMA_VERSION}; refusing to touch it"
                    )
                # Databases created before call-id persistence existed lack
                # the column; add it in place so an existing suppression
                # record never has to be discarded.
                columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(attempt_ledger)")
                }
                if "call_id" not in columns:
                    connection.execute(
                        "ALTER TABLE attempt_ledger ADD COLUMN call_id TEXT"
                    )
                connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                connection.commit()
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {path} is unavailable: {error}"
            ) from error

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self._path), timeout=5.0)
        connection.row_factory = sqlite3.Row
        # WAL persists in the database file, so once the first creator set
        # it every later connection runs in WAL automatically. Re-asserting
        # the mode needs a brief exclusive moment and can report busy while
        # another process is mid-write — a failure there changes nothing
        # (the file is already WAL), so it is tolerated. Real reads and
        # writes behind it stay covered by the busy timeout.
        with contextlib.suppress(sqlite3.OperationalError):
            connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _append_event(
        self,
        connection: sqlite3.Connection,
        *,
        actor: str,
        idempotency_key: str,
        from_state: str | None,
        to_state: str,
        reason: str,
    ) -> None:
        """Append one chain row inside the caller's open transaction."""

        head = connection.execute(
            "SELECT seq, row_hash FROM attempt_events ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        prior_hash = head["row_hash"] if head is not None else GENESIS_HASH
        seq = (head["seq"] + 1) if head is not None else 1
        event = build_event(
            seq=seq,
            timestamp=_utc_now(),
            actor=actor,
            idempotency_key=idempotency_key,
            from_state=from_state,
            to_state=to_state,
            reason=reason,
            prior_hash=prior_hash,
        )
        connection.execute(
            "INSERT INTO attempt_events (seq, timestamp, actor, idempotency_key, "
            "from_state, to_state, reason, prior_hash, row_hash) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event.seq,
                event.timestamp,
                event.actor,
                event.idempotency_key,
                event.from_state,
                event.to_state,
                event.reason,
                event.prior_hash,
                event.row_hash,
            ),
        )

    def reserve(
        self, idempotency_key: str, request_fingerprint: str
    ) -> ReservationVerdict:
        now = _utc_now()
        try:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT request_fingerprint, state, reserved_at, updated_at "
                    "FROM attempt_ledger WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                if row is None:
                    connection.execute(
                        "INSERT INTO attempt_ledger "
                        "(idempotency_key, request_fingerprint, state, "
                        "reserved_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (
                            idempotency_key,
                            request_fingerprint,
                            AttemptState.RESERVED.value,
                            now,
                            now,
                        ),
                    )
                    self._append_event(
                        connection,
                        actor=AuditActor.WORKFLOW,
                        idempotency_key=idempotency_key,
                        from_state=None,
                        to_state=AttemptState.RESERVED.value,
                        reason=AuditReason.RESERVED,
                    )
                    connection.commit()
                    return ReservationVerdict(
                        created=True,
                        state=AttemptState.RESERVED,
                        request_fingerprint=request_fingerprint,
                        reserved_at=now,
                        updated_at=now,
                    )
                connection.commit()
                return ReservationVerdict(
                    created=False,
                    state=AttemptState(row["state"]),
                    request_fingerprint=row["request_fingerprint"],
                    reserved_at=row["reserved_at"],
                    updated_at=row["updated_at"],
                )
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {self._path} is unavailable: {error}"
            ) from error

    def _mark(self, idempotency_key: str, state: AttemptState) -> None:
        try:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT state FROM attempt_ledger WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                cursor = connection.execute(
                    "UPDATE attempt_ledger SET state = ?, updated_at = ? "
                    "WHERE idempotency_key = ?",
                    (state.value, _utc_now(), idempotency_key),
                )
                if cursor.rowcount != 1:
                    connection.rollback()
                    raise AttemptLedgerUnavailable(
                        f"no reservation exists for {idempotency_key!r}"
                    )
                self._append_event(
                    connection,
                    actor=AuditActor.PROVIDER,
                    idempotency_key=idempotency_key,
                    from_state=row["state"] if row is not None else None,
                    to_state=state.value,
                    reason=(
                        AuditReason.COMPLETED
                        if state is AttemptState.COMPLETED
                        else AuditReason.UNKNOWN
                    ),
                )
                connection.commit()
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {self._path} is unavailable: {error}"
            ) from error

    def mark_completed(self, idempotency_key: str) -> None:
        self._mark(idempotency_key, AttemptState.COMPLETED)

    def mark_unknown(self, idempotency_key: str) -> None:
        self._mark(idempotency_key, AttemptState.UNKNOWN)

    def attach_call_id(self, idempotency_key: str, call_id: str) -> None:
        try:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT state FROM attempt_ledger WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                cursor = connection.execute(
                    "UPDATE attempt_ledger SET call_id = ?, updated_at = ? "
                    "WHERE idempotency_key = ?",
                    (call_id, _utc_now(), idempotency_key),
                )
                if cursor.rowcount != 1:
                    connection.rollback()
                    raise AttemptLedgerUnavailable(
                        f"no reservation exists for {idempotency_key!r}"
                    )
                self._append_event(
                    connection,
                    actor=AuditActor.PROVIDER,
                    idempotency_key=idempotency_key,
                    from_state=row["state"] if row is not None else None,
                    to_state=row["state"] if row is not None else "",
                    reason=AuditReason.CALL_ID_PERSISTED,
                )
                connection.commit()
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {self._path} is unavailable: {error}"
            ) from error

    def find(self, idempotency_key: str) -> dict[str, Any] | None:
        """Inspect one reservation without creating or changing anything."""

        try:
            connection = self._connect()
            try:
                row = connection.execute(
                    "SELECT idempotency_key, request_fingerprint, state, "
                    "reserved_at, updated_at, call_id FROM attempt_ledger "
                    "WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                return dict(row) if row is not None else None
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {self._path} is unavailable: {error}"
            ) from error

    def rows(self) -> list[dict[str, Any]]:
        """Every stored record, for audits and tests. Safe metadata only."""

        try:
            connection = self._connect()
            try:
                selection = connection.execute(
                    "SELECT idempotency_key, request_fingerprint, state, "
                    "reserved_at, updated_at, call_id FROM attempt_ledger"
                )
                return [dict(row) for row in selection.fetchall()]
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {self._path} is unavailable: {error}"
            ) from error

    def audit_events(self) -> tuple[AttemptEvent, ...]:
        """The hash-chained transition log, oldest first."""

        try:
            connection = self._connect()
            try:
                selection = connection.execute(
                    "SELECT seq, timestamp, actor, idempotency_key, from_state, "
                    "to_state, reason, prior_hash, row_hash FROM attempt_events "
                    "ORDER BY seq"
                )
                return tuple(
                    AttemptEvent(
                        seq=row["seq"],
                        timestamp=row["timestamp"],
                        actor=row["actor"],
                        idempotency_key=row["idempotency_key"],
                        from_state=row["from_state"],
                        to_state=row["to_state"],
                        reason=row["reason"],
                        prior_hash=row["prior_hash"],
                        row_hash=row["row_hash"],
                    )
                    for row in selection.fetchall()
                )
            finally:
                connection.close()
        except sqlite3.Error as error:
            raise AttemptLedgerUnavailable(
                f"attempt ledger at {self._path} is unavailable: {error}"
            ) from error

    def audit_chain_head(self, idempotency_key: str) -> str | None:
        """The chain head of the last event recorded for one attempt."""

        events = [
            event for event in self.audit_events()
            if event.idempotency_key == idempotency_key
        ]
        return events[-1].row_hash if events else None

    def audit_problems(self) -> list[str]:
        """Every way the durable chain has been tampered with. Empty = intact."""

        return verify_chain(self.audit_events())

    def replay_projection(self) -> dict[str, str]:
        """Attempt states reconstructed from the event chain alone."""

        states: dict[str, str] = {}
        for event in self.audit_events():
            states[event.idempotency_key] = event.to_state
        return states
