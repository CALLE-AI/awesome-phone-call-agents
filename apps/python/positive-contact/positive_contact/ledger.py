"""Durable SQLite ledger.

Every state change is an appended row. `transitions` is append-only, enforced by database
triggers rather than by convention, so `reconstruct()` can rebuild an intent's state from
the audit trail alone and a crash between two writes leaves something readable.

The raw E.164 for a contact exists in exactly one place: `contacts.phone_e164` and
`contacts.alt_phone_e164`. Nothing else in this schema stores an unmasked number.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import (
    Attempt,
    Contact,
    Disposition,
    Event,
    Intent,
    IntentState,
    LadderTarget,
    Transition,
    WorkOrder,
)
from .redact import redact_snapshot

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS events (
    event_id            TEXT PRIMARY KEY,
    utility_name        TEXT NOT NULL,
    window_start        TEXT NOT NULL,
    window_end          TEXT NOT NULL,
    field_visit_cutoff  TEXT NOT NULL,
    default_tz          TEXT NOT NULL,
    crc_info_json       TEXT NOT NULL,
    policy_json         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    contact_id            TEXT PRIMARY KEY,
    event_id              TEXT NOT NULL REFERENCES events(event_id),
    first_name            TEXT NOT NULL,
    phone_e164            TEXT NOT NULL,
    alt_phone_e164        TEXT,
    locale                TEXT NOT NULL,
    tz                    TEXT NOT NULL,
    service_address_short TEXT NOT NULL,
    retired_at            TEXT,
    retired_reason        TEXT
);

CREATE TABLE IF NOT EXISTS intents (
    intent_id       TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(event_id),
    contact_id      TEXT NOT NULL REFERENCES contacts(contact_id),
    ladder_step     INTEGER NOT NULL,
    target          TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    task_version    TEXT NOT NULL,
    schema_version  TEXT NOT NULL,
    state           TEXT NOT NULL,
    not_before      TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
    intent_id                  TEXT PRIMARY KEY REFERENCES intents(intent_id),
    call_id                    TEXT NOT NULL UNIQUE,
    submitted_at               TEXT NOT NULL,
    terminal_status            TEXT,
    raw_snapshot_redacted_json TEXT
);

CREATE TABLE IF NOT EXISTS inbox (
    event_uid        TEXT PRIMARY KEY,
    call_id          TEXT NOT NULL,
    received_at      TEXT NOT NULL,
    payload_json     TEXT NOT NULL,
    payload_digest   TEXT NOT NULL,
    processed_at     TEXT,
    quarantined      INTEGER NOT NULL DEFAULT 0,
    quarantine_reason TEXT
);

CREATE TABLE IF NOT EXISTS transitions (
    seq                INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id          TEXT NOT NULL,
    from_state         TEXT,
    to_state           TEXT NOT NULL,
    reason_code        TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    actor              TEXT NOT NULL,
    at                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispositions (
    intent_id           TEXT PRIMARY KEY REFERENCES intents(intent_id),
    contact_type        TEXT NOT NULL,
    acknowledged        TEXT NOT NULL,
    needs_assistance    TEXT NOT NULL,
    confidence_score    REAL,
    confidence_label    TEXT,
    judge_a             TEXT NOT NULL,
    judge_b             TEXT NOT NULL,
    judge_c             TEXT,
    judges_agree        INTEGER NOT NULL,
    disposition         TEXT NOT NULL,
    reason_code         TEXT NOT NULL,
    evidence_spans_json TEXT NOT NULL,
    notes_for_human     TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
    work_order_id TEXT PRIMARY KEY,
    contact_id    TEXT NOT NULL REFERENCES contacts(contact_id),
    event_id      TEXT NOT NULL REFERENCES events(event_id),
    reason_code   TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    approved_by   TEXT,
    approved_at   TEXT,
    exported_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_transitions_intent ON transitions(intent_id, seq);
CREATE INDEX IF NOT EXISTS idx_intents_contact ON intents(contact_id, ladder_step);
CREATE INDEX IF NOT EXISTS idx_intents_state ON intents(state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_contact
    ON work_orders(event_id, contact_id);

CREATE TRIGGER IF NOT EXISTS transitions_append_only_update
BEFORE UPDATE ON transitions
BEGIN
    SELECT RAISE(ABORT, 'transitions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS transitions_append_only_delete
BEFORE DELETE ON transitions
BEGIN
    SELECT RAISE(ABORT, 'transitions is append-only');
END;
"""


class LedgerError(RuntimeError):
    """Raised when the ledger is asked for something that would corrupt the audit trail."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise LedgerError("refusing to store a naive timestamp")
    return value.astimezone(timezone.utc).isoformat()


def from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _digest(payload: Any) -> str:
    """Stable digest of a webhook payload, used to spot a conflicting redelivery."""
    import hashlib

    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class Ledger:
    """The application's own record of what it authorized and what came back."""

    def __init__(self, db_path: Path | str = ":memory:") -> None:
        self.db_path = str(db_path)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> Ledger:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self.conn
        except Exception:
            self.conn.rollback()
            raise
        else:
            self.conn.commit()

    # -- events -----------------------------------------------------------------

    def put_event(self, event: Event) -> None:
        with self.tx() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO events (event_id, utility_name, window_start, "
                "window_end, field_visit_cutoff, default_tz, crc_info_json, policy_json) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    event.event_id,
                    event.utility_name,
                    to_iso(event.window_start),
                    to_iso(event.window_end),
                    to_iso(event.field_visit_cutoff),
                    event.default_tz,
                    json.dumps(event.crc_info),
                    json.dumps(event.policy),
                ),
            )

    def get_event(self, event_id: str) -> Event | None:
        row = self.conn.execute(
            "SELECT * FROM events WHERE event_id = ?", (event_id,)
        ).fetchone()
        if row is None:
            return None
        return Event(
            event_id=row["event_id"],
            utility_name=row["utility_name"],
            window_start=from_iso(row["window_start"]),
            window_end=from_iso(row["window_end"]),
            field_visit_cutoff=from_iso(row["field_visit_cutoff"]),
            default_tz=row["default_tz"],
            crc_info=json.loads(row["crc_info_json"]),
            policy=json.loads(row["policy_json"]),
        )

    # -- contacts ---------------------------------------------------------------

    def put_contact(self, contact: Contact) -> None:
        with self.tx() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO contacts (contact_id, event_id, first_name, "
                "phone_e164, alt_phone_e164, locale, tz, service_address_short) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    contact.contact_id,
                    contact.event_id,
                    contact.first_name,
                    contact.phone_e164,
                    contact.alt_phone_e164,
                    contact.locale,
                    contact.tz,
                    contact.service_address_short,
                ),
            )

    def get_contact(self, contact_id: str) -> Contact | None:
        row = self.conn.execute(
            "SELECT * FROM contacts WHERE contact_id = ?", (contact_id,)
        ).fetchone()
        return self._contact_from_row(row) if row else None

    def list_contacts(self, event_id: str) -> list[Contact]:
        rows = self.conn.execute(
            "SELECT * FROM contacts WHERE event_id = ? ORDER BY contact_id", (event_id,)
        ).fetchall()
        return [self._contact_from_row(row) for row in rows]

    @staticmethod
    def _contact_from_row(row: sqlite3.Row) -> Contact:
        return Contact(
            contact_id=row["contact_id"],
            event_id=row["event_id"],
            first_name=row["first_name"],
            phone_e164=row["phone_e164"],
            alt_phone_e164=row["alt_phone_e164"],
            locale=row["locale"],
            tz=row["tz"],
            service_address_short=row["service_address_short"],
        )

    def retire_number(self, contact_id: str, reason: str, at: datetime | None = None) -> None:
        """Mark a contact's number unusable for this event after a wrong-number outcome."""
        with self.tx() as conn:
            conn.execute(
                "UPDATE contacts SET retired_at = ?, retired_reason = ? WHERE contact_id = ?",
                (to_iso(at or utcnow()), reason, contact_id),
            )

    def is_retired(self, contact_id: str) -> bool:
        row = self.conn.execute(
            "SELECT retired_at FROM contacts WHERE contact_id = ?", (contact_id,)
        ).fetchone()
        return bool(row and row["retired_at"])

    # -- intents ----------------------------------------------------------------

    def reserve_intent(
        self,
        intent: Intent,
        *,
        opening_from_state: IntentState | None = None,
        reason_code: str = "intent_reserved",
        evidence_refs: dict | None = None,
    ) -> Intent:
        """Persist an intent before anything is submitted.

        Reserving the same idempotency key twice returns the existing intent instead of
        creating a second one, so a restart mid-dispatch cannot double-dial.

        `opening_from_state` is the state this intent's chain continues from. It is
        `None` for the first step of a contact's ladder, and `UNCONFIRMED_WAITING` when
        the escalation engine advances the ladder onto a new step, which is what makes
        the `UNCONFIRMED_WAITING -> RESERVED` edge visible in the audit trail.
        """
        existing = self.get_intent_by_key(intent.idempotency_key)
        if existing is not None:
            return existing
        refs = dict(evidence_refs or {})
        refs.setdefault("ladder_step", intent.ladder_step)
        refs.setdefault("target", intent.target.value)
        with self.tx() as conn:
            conn.execute(
                "INSERT INTO intents (intent_id, event_id, contact_id, ladder_step, target, "
                "idempotency_key, task_version, schema_version, state, not_before, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    intent.intent_id,
                    intent.event_id,
                    intent.contact_id,
                    intent.ladder_step,
                    intent.target.value,
                    intent.idempotency_key,
                    intent.task_version,
                    intent.schema_version,
                    intent.state.value,
                    to_iso(intent.not_before),
                    to_iso(intent.created_at),
                ),
            )
            conn.execute(
                "INSERT INTO transitions (intent_id, from_state, to_state, reason_code, "
                "evidence_refs_json, actor, at) VALUES (?,?,?,?,?,?,?)",
                (
                    intent.intent_id,
                    opening_from_state.value if opening_from_state else None,
                    IntentState.RESERVED.value,
                    reason_code,
                    json.dumps(refs),
                    "system",
                    to_iso(intent.created_at),
                ),
            )
        return intent

    def get_intent(self, intent_id: str) -> Intent | None:
        row = self.conn.execute(
            "SELECT * FROM intents WHERE intent_id = ?", (intent_id,)
        ).fetchone()
        return self._intent_from_row(row) if row else None

    def get_intent_by_key(self, idempotency_key: str) -> Intent | None:
        row = self.conn.execute(
            "SELECT * FROM intents WHERE idempotency_key = ?", (idempotency_key,)
        ).fetchone()
        return self._intent_from_row(row) if row else None

    def get_intent_by_call_id(self, call_id: str) -> Intent | None:
        row = self.conn.execute(
            "SELECT i.* FROM intents i JOIN attempts a ON a.intent_id = i.intent_id "
            "WHERE a.call_id = ?",
            (call_id,),
        ).fetchone()
        return self._intent_from_row(row) if row else None

    def list_intents(
        self, event_id: str, states: list[IntentState] | None = None
    ) -> list[Intent]:
        if states:
            placeholders = ",".join("?" for _ in states)
            rows = self.conn.execute(
                f"SELECT * FROM intents WHERE event_id = ? AND state IN ({placeholders}) "
                "ORDER BY contact_id, ladder_step",
                (event_id, *[state.value for state in states]),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM intents WHERE event_id = ? ORDER BY contact_id, ladder_step",
                (event_id,),
            ).fetchall()
        return [self._intent_from_row(row) for row in rows]

    def list_intents_for_contact(self, contact_id: str) -> list[Intent]:
        rows = self.conn.execute(
            "SELECT * FROM intents WHERE contact_id = ? ORDER BY ladder_step, created_at",
            (contact_id,),
        ).fetchall()
        return [self._intent_from_row(row) for row in rows]

    def count_calls_for_contact(self, contact_id: str) -> int:
        """Calls actually submitted for this contact, used for `max_calls_per_contact`."""
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM attempts a JOIN intents i ON i.intent_id = a.intent_id "
            "WHERE i.contact_id = ?",
            (contact_id,),
        ).fetchone()
        return int(row["n"])

    def count_calls_for_event(self, event_id: str) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM attempts a JOIN intents i ON i.intent_id = a.intent_id "
            "WHERE i.event_id = ?",
            (event_id,),
        ).fetchone()
        return int(row["n"])

    @staticmethod
    def _intent_from_row(row: sqlite3.Row) -> Intent:
        return Intent(
            intent_id=row["intent_id"],
            event_id=row["event_id"],
            contact_id=row["contact_id"],
            ladder_step=row["ladder_step"],
            target=LadderTarget(row["target"]),
            idempotency_key=row["idempotency_key"],
            task_version=row["task_version"],
            schema_version=row["schema_version"],
            state=IntentState(row["state"]),
            not_before=from_iso(row["not_before"]),
            created_at=from_iso(row["created_at"]),
        )

    # -- transitions ------------------------------------------------------------

    def append_transition(
        self,
        intent_id: str,
        from_state: IntentState | None,
        to_state: IntentState,
        reason_code: str,
        *,
        evidence_refs: dict | None = None,
        actor: str = "system",
        at: datetime | None = None,
    ) -> None:
        """Append one audit row and move the intent's cached state to match.

        `intents.state` is a cache. `transitions` is the truth; `reconstruct()` replays it.
        """
        stamp = to_iso(at or utcnow())
        with self.tx() as conn:
            conn.execute(
                "INSERT INTO transitions (intent_id, from_state, to_state, reason_code, "
                "evidence_refs_json, actor, at) VALUES (?,?,?,?,?,?,?)",
                (
                    intent_id,
                    from_state.value if from_state else None,
                    to_state.value,
                    reason_code,
                    json.dumps(evidence_refs or {}),
                    actor,
                    stamp,
                ),
            )
            conn.execute(
                "UPDATE intents SET state = ? WHERE intent_id = ?",
                (to_state.value, intent_id),
            )

    def list_transitions(self, intent_id: str) -> list[Transition]:
        rows = self.conn.execute(
            "SELECT * FROM transitions WHERE intent_id = ? ORDER BY seq", (intent_id,)
        ).fetchall()
        return [
            Transition(
                intent_id=row["intent_id"],
                from_state=IntentState(row["from_state"]) if row["from_state"] else None,
                to_state=IntentState(row["to_state"]),
                reason_code=row["reason_code"],
                evidence_refs=json.loads(row["evidence_refs_json"]),
                actor=row["actor"],
                at=from_iso(row["at"]),
            )
            for row in rows
        ]

    def all_transitions(self, event_id: str) -> list[Transition]:
        rows = self.conn.execute(
            "SELECT t.* FROM transitions t JOIN intents i ON i.intent_id = t.intent_id "
            "WHERE i.event_id = ? ORDER BY t.seq",
            (event_id,),
        ).fetchall()
        return [
            Transition(
                intent_id=row["intent_id"],
                from_state=IntentState(row["from_state"]) if row["from_state"] else None,
                to_state=IntentState(row["to_state"]),
                reason_code=row["reason_code"],
                evidence_refs=json.loads(row["evidence_refs_json"]),
                actor=row["actor"],
                at=from_iso(row["at"]),
            )
            for row in rows
        ]

    def reconstruct(self, intent_id: str) -> IntentState:
        """Rebuild an intent's current state by replaying its transitions.

        Every replayed edge is checked against the same allowed-transition table the
        engine uses, so a corrupted or hand-edited audit trail is detected here rather
        than silently trusted.
        """
        from .escalate import replay_edge

        rows = self.list_transitions(intent_id)
        if not rows:
            raise LedgerError(f"no transitions recorded for intent {intent_id}")
        # The chain starts where its first row says it starts: `None` for a contact's
        # first ladder step, or the predecessor's state when the ladder advanced.
        state: IntentState | None = rows[0].from_state
        for row in rows:
            if row.from_state != state:
                raise LedgerError(
                    f"transition log for {intent_id} is not contiguous: "
                    f"expected from_state {state}, found {row.from_state}"
                )
            state = replay_edge(state, row.to_state)
        assert state is not None
        return state

    # -- attempts ---------------------------------------------------------------

    def bind_attempt(self, attempt: Attempt) -> None:
        with self.tx() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO attempts (intent_id, call_id, submitted_at, "
                "terminal_status, raw_snapshot_redacted_json) VALUES (?,?,?,?,?)",
                (
                    attempt.intent_id,
                    attempt.call_id,
                    to_iso(attempt.submitted_at),
                    attempt.terminal_status,
                    json.dumps(attempt.raw_snapshot_redacted)
                    if attempt.raw_snapshot_redacted is not None
                    else None,
                ),
            )

    def record_terminal_snapshot(
        self, intent_id: str, terminal_status: str, raw_snapshot: dict
    ) -> None:
        """Store the authoritative snapshot, redacted, against the attempt."""
        with self.tx() as conn:
            conn.execute(
                "UPDATE attempts SET terminal_status = ?, raw_snapshot_redacted_json = ? "
                "WHERE intent_id = ?",
                (terminal_status, json.dumps(redact_snapshot(raw_snapshot)), intent_id),
            )

    def get_attempt(self, intent_id: str) -> Attempt | None:
        row = self.conn.execute(
            "SELECT * FROM attempts WHERE intent_id = ?", (intent_id,)
        ).fetchone()
        if row is None:
            return None
        return Attempt(
            intent_id=row["intent_id"],
            call_id=row["call_id"],
            submitted_at=from_iso(row["submitted_at"]),
            terminal_status=row["terminal_status"],
            raw_snapshot_redacted=json.loads(row["raw_snapshot_redacted_json"])
            if row["raw_snapshot_redacted_json"]
            else None,
        )

    # -- inbox ------------------------------------------------------------------

    def record_webhook(
        self, event_uid: str, call_id: str, payload: dict, at: datetime | None = None
    ) -> str:
        """Insert one inbox row per webhook event id.

        Returns `"inserted"` for a first delivery, `"duplicate"` for an exact replay, and
        `"quarantined"` when the same event id arrives with a different payload.
        """
        stamp = to_iso(at or utcnow())
        # The digest is taken over what arrived, so a conflicting redelivery is still
        # detected, but only the redacted body is stored. A webhook payload is a full
        # call task and carries the dialled number.
        digest = _digest(payload)
        stored = redact_snapshot(payload)
        existing = self.conn.execute(
            "SELECT payload_digest, quarantined FROM inbox WHERE event_uid = ?", (event_uid,)
        ).fetchone()
        if existing is not None:
            if existing["payload_digest"] == digest:
                return "duplicate"
            with self.tx() as conn:
                conn.execute(
                    "UPDATE inbox SET quarantined = 1, quarantine_reason = ? WHERE event_uid = ?",
                    ("conflicting payload under an already-seen event id", event_uid),
                )
            return "quarantined"
        with self.tx() as conn:
            conn.execute(
                "INSERT INTO inbox (event_uid, call_id, received_at, payload_json, "
                "payload_digest, processed_at, quarantined, quarantine_reason) "
                "VALUES (?,?,?,?,?,NULL,0,NULL)",
                (event_uid, call_id, stamp, json.dumps(stored), digest),
            )
        return "inserted"

    def quarantine_webhook(
        self, event_uid: str, call_id: str, payload: dict, reason: str,
        at: datetime | None = None,
    ) -> None:
        """Store a rejected delivery so it is visible rather than dropped."""
        stamp = to_iso(at or utcnow())
        with self.tx() as conn:
            # Never REPLACE. The event id on a quarantined delivery is attacker-supplied
            # and unauthenticated; an INSERT OR REPLACE here let a forged request delete a
            # real inbox row and reset its `processed_at`, which would make an
            # already-handled terminal event look unhandled. An existing row is marked
            # quarantined in place and its first payload is kept.
            updated = conn.execute(
                "UPDATE inbox SET quarantined = 1, quarantine_reason = ? "
                "WHERE event_uid = ? AND quarantined = 0",
                (reason, event_uid),
            ).rowcount
            if updated == 0:
                conn.execute(
                    "INSERT OR IGNORE INTO inbox (event_uid, call_id, received_at, "
                    "payload_json, payload_digest, processed_at, quarantined, "
                    "quarantine_reason) VALUES (?,?,?,?,?,NULL,1,?)",
                    (
                        event_uid, call_id, stamp,
                        json.dumps(redact_snapshot(payload)), _digest(payload), reason,
                    ),
                )

    def claim_unprocessed_webhooks(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM inbox WHERE processed_at IS NULL AND quarantined = 0 "
            "ORDER BY received_at"
        ).fetchall()
        return [
            {
                "event_uid": row["event_uid"],
                "call_id": row["call_id"],
                "payload": json.loads(row["payload_json"]),
                "received_at": from_iso(row["received_at"]),
            }
            for row in rows
        ]

    def mark_webhook_processed(self, event_uid: str, at: datetime | None = None) -> None:
        with self.tx() as conn:
            conn.execute(
                "UPDATE inbox SET processed_at = ? WHERE event_uid = ?",
                (to_iso(at or utcnow()), event_uid),
            )

    def count_inbox_rows(self, event_uid: str | None = None) -> int:
        if event_uid is None:
            row = self.conn.execute("SELECT COUNT(*) AS n FROM inbox").fetchone()
        else:
            row = self.conn.execute(
                "SELECT COUNT(*) AS n FROM inbox WHERE event_uid = ?", (event_uid,)
            ).fetchone()
        return int(row["n"])

    def is_quarantined(self, event_uid: str) -> bool:
        row = self.conn.execute(
            "SELECT quarantined FROM inbox WHERE event_uid = ?", (event_uid,)
        ).fetchone()
        return bool(row and row["quarantined"])

    # -- dispositions -----------------------------------------------------------

    def put_disposition(self, disposition: Disposition) -> None:
        with self.tx() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO dispositions (intent_id, contact_type, acknowledged, "
                "needs_assistance, confidence_score, confidence_label, judge_a, judge_b, "
                "judge_c, judges_agree, disposition, reason_code, evidence_spans_json, "
                "notes_for_human) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    disposition.intent_id,
                    disposition.contact_type.value,
                    disposition.acknowledged.value,
                    disposition.needs_assistance.value,
                    disposition.confidence_score,
                    disposition.confidence_label,
                    disposition.judge_a,
                    disposition.judge_b,
                    disposition.judge_c,
                    int(disposition.judges_agree),
                    disposition.disposition.value,
                    disposition.reason_code,
                    json.dumps([span.model_dump() for span in disposition.evidence_spans]),
                    disposition.notes_for_human,
                ),
            )

    def get_disposition(self, intent_id: str) -> Disposition | None:
        row = self.conn.execute(
            "SELECT * FROM dispositions WHERE intent_id = ?", (intent_id,)
        ).fetchone()
        return self._disposition_from_row(row) if row else None

    def list_dispositions(self, event_id: str) -> list[Disposition]:
        rows = self.conn.execute(
            "SELECT d.* FROM dispositions d JOIN intents i ON i.intent_id = d.intent_id "
            "WHERE i.event_id = ? ORDER BY d.intent_id",
            (event_id,),
        ).fetchall()
        return [self._disposition_from_row(row) for row in rows]

    @staticmethod
    def _disposition_from_row(row: sqlite3.Row) -> Disposition:
        from .models import (
            Acknowledged,
            ContactType,
            DispositionKind,
            EvidenceSpan,
            NeedsAssistance,
        )

        return Disposition(
            intent_id=row["intent_id"],
            contact_type=ContactType(row["contact_type"]),
            acknowledged=Acknowledged(row["acknowledged"]),
            needs_assistance=NeedsAssistance(row["needs_assistance"]),
            confidence_score=row["confidence_score"],
            confidence_label=row["confidence_label"],
            judge_a=row["judge_a"],
            judge_b=row["judge_b"],
            judge_c=row["judge_c"],
            judges_agree=bool(row["judges_agree"]),
            disposition=DispositionKind(row["disposition"]),
            reason_code=row["reason_code"],
            evidence_spans=[EvidenceSpan(**span) for span in json.loads(row["evidence_spans_json"])],
            notes_for_human=row["notes_for_human"],
        )

    # -- work orders ------------------------------------------------------------

    def create_work_order(self, work_order: WorkOrder) -> bool:
        """Create one field-visit work order per contact per event. Returns False if it exists."""
        try:
            with self.tx() as conn:
                conn.execute(
                    "INSERT INTO work_orders (work_order_id, contact_id, event_id, reason_code, "
                    "created_at, approved_by, approved_at, exported_at) VALUES (?,?,?,?,?,?,?,?)",
                    (
                        work_order.work_order_id,
                        work_order.contact_id,
                        work_order.event_id,
                        work_order.reason_code,
                        to_iso(work_order.created_at),
                        work_order.approved_by,
                        to_iso(work_order.approved_at) if work_order.approved_at else None,
                        to_iso(work_order.exported_at) if work_order.exported_at else None,
                    ),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def approve_work_order(
        self, work_order_id: str, approved_by: str, at: datetime | None = None
    ) -> None:
        if not approved_by.strip():
            raise LedgerError("a field visit needs a named approver")
        with self.tx() as conn:
            conn.execute(
                "UPDATE work_orders SET approved_by = ?, approved_at = ? WHERE work_order_id = ?",
                (approved_by, to_iso(at or utcnow()), work_order_id),
            )

    def mark_work_order_exported(self, work_order_id: str, at: datetime | None = None) -> None:
        with self.tx() as conn:
            conn.execute(
                "UPDATE work_orders SET exported_at = ? WHERE work_order_id = ? "
                "AND approved_at IS NOT NULL",
                (to_iso(at or utcnow()), work_order_id),
            )

    def list_work_orders(self, event_id: str) -> list[WorkOrder]:
        rows = self.conn.execute(
            "SELECT * FROM work_orders WHERE event_id = ? ORDER BY created_at, work_order_id",
            (event_id,),
        ).fetchall()
        return [
            WorkOrder(
                work_order_id=row["work_order_id"],
                contact_id=row["contact_id"],
                event_id=row["event_id"],
                reason_code=row["reason_code"],
                created_at=from_iso(row["created_at"]),
                approved_by=row["approved_by"],
                approved_at=from_iso(row["approved_at"]) if row["approved_at"] else None,
                exported_at=from_iso(row["exported_at"]) if row["exported_at"] else None,
            )
            for row in rows
        ]
