from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
from typing import TYPE_CHECKING, Sequence

from ringdown.canonical import canonical_json, digest
from ringdown.checks import Check, all_ok, labels, passed, unresolved
from ringdown.incident import IncidentError, Rung, clean_text, mask_phone

if TYPE_CHECKING:
    from ringdown.escalate import Attempt, LadderResult

DETAIL_LIMIT = 200
GENESIS = "sha256:" + "0" * 64


class LedgerError(IncidentError):
    pass


def read_ledger(path: Path) -> str:
    try:
        return path.read_text()
    except (OSError, UnicodeDecodeError) as exc:
        raise LedgerError(f"the ledger at {path} cannot be read: {exc}") from exc


def verdict_v1(verdicts: Sequence[str]) -> str:
    return next((v for v in verdicts if v != "not_acknowledged"), "unacknowledged")


VERDICT_RULES = {1: verdict_v1}
SCHEMA = max(VERDICT_RULES)


def sealed(record: dict) -> dict:
    body = {name: value for name, value in record.items() if name != "hash"}
    return {**body, "hash": digest(body)}


def intent_record(incident_id: str, attempt_id: str, key: str, rung: Rung) -> dict:
    return {
        "type": "intent",
        "incident": incident_id,
        "attempt_id": attempt_id,
        "contact": rung.contact.id,
        "phone": mask_phone(rung.contact.phone),
        "key": key,
    }


def attempt_record(attempt: Attempt, incident_id: str) -> dict:
    extraction = attempt.extraction
    spans: dict[str, str] = {}
    if extraction is not None:
        spans = {
            name: span
            for name, span in (
                ("disposition", extraction.disposition_span),
                ("owner", extraction.owner_span),
                ("eta", extraction.eta_span),
                ("callback", extraction.callback_span),
                ("hedge", extraction.hedge_span),
            )
            if span
        }
    record = {
        "type": "attempt",
        "incident": incident_id,
        "attempt_id": attempt.attempt_id,
        "contact": attempt.rung.contact.id,
        "phone": mask_phone(attempt.rung.contact.phone),
        "key": attempt.key,
        "call_id": attempt.call_id,
        "verdict": attempt.verdict,
        "reason": attempt.reason,
        "spans": spans,
        "eta_minutes": extraction.eta_minutes if extraction else None,
        "instructed": attempt.instructed,
    }
    if extraction is not None and extraction.callback_minutes is not None:
        record["callback_minutes"] = extraction.callback_minutes
    return record


def verdict_record(incident_id: str, result: LadderResult) -> dict:
    last = result.attempts[-1] if result.attempts else None
    settled = last is not None and result.verdict in ("acknowledged", "declined")
    return {
        "type": "verdict",
        "incident": incident_id,
        "verdict": result.verdict,
        "owner": last.rung.contact.id if settled else None,
        "eta_minutes": last.extraction.eta_minutes if settled and last.extraction else None,
    }


def notified_record(incident_id: str, *, host: str, delivered: bool, detail: str) -> dict:
    return {
        "type": "notified",
        "incident": incident_id,
        "host": host,
        "delivered": delivered,
        "detail": clean_text(detail or "no detail", "the notification detail", DETAIL_LIMIT),
    }


def verification_record(
    incident_id: str, checks: Sequence[Check], *, rest_host: str, mcp_host: str
) -> dict:
    return {
        "type": "verification",
        "incident": incident_id,
        "rest_host": rest_host,
        "mcp_host": mcp_host,
        "verified": all_ok(checks),
        "passed": passed(checks),
        "unresolved": unresolved(checks),
        "total": len(checks),
        "contradicted": labels(checks, False),
        "unanswered": labels(checks, None),
    }


def records_in(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.strip()]


def _last_record(lines: list[str], path: Path) -> dict:
    if not lines:
        return {}
    try:
        last = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise LedgerError(
            f"the ledger at {path} ends with a record that is not readable JSON"
        ) from exc
    if not isinstance(last, dict):
        raise LedgerError(f"the ledger at {path} ends with a record that is not a JSON object")
    return last


def append_record(path: Path, record: dict) -> None:
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError as exc:
        raise LedgerError(f"cannot open the ledger at {path}: {exc.strerror}") from exc
    try:
        with os.fdopen(fd, "r+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            text = handle.read()
            written = records_in(text)
            last = _last_record(written, path)
            prev = last.get("hash", GENESIS)
            position = last.get("seq")
            seq = position + 1 if isinstance(position, int) else len(written) + 1
            gap = "" if not text or text.endswith("\n") else "\n"
            stamped = {**record, "schema": SCHEMA, "seq": seq, "prev": prev}
            handle.write(gap + canonical_json(sealed(stamped)) + "\n")
    except (OSError, UnicodeDecodeError) as exc:
        raise LedgerError(f"cannot write the ledger at {path}: {exc}") from exc


def head(path: Path) -> tuple[int, str]:
    lines = records_in(read_ledger(path)) if path.exists() else []
    return len(lines), _last_record(lines, path).get("hash", GENESIS)


def incident_of(record: dict) -> str:
    named = record.get("incident")
    if named is not None:
        return str(named)
    return str(record.get("attempt_id", "")).rsplit("/", 2)[0]


def corroboration_check(number: int, record: dict) -> Check:
    where = f"record {number} reports the verdict was"
    if record.get("verified") is True:
        return (True, f"{where} corroborated on the second channel")
    counts = [record.get(field, 0) for field in ("total", "passed", "unresolved")]
    if not all(isinstance(count, int) for count in counts):
        return (False, f"record {number} reports check counts that are not numbers")
    contradicted = counts[0] - counts[1] - counts[2]
    if contradicted > 0:
        return (False, f"{where} contradicted on the second channel")
    return (None, f"{where} never confirmed on the second channel")


def chain_checks(path: Path) -> list[Check]:
    try:
        text = read_ledger(path)
    except LedgerError as error:
        return [(False, str(error))]
    records: list[dict] = []
    for number, line in enumerate(text.splitlines(), 1):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            return [(False, f"record {number} is not readable JSON")]
        if not isinstance(record, dict):
            return [(False, f"record {number} is not a JSON object")]
        records.append(record)

    checks: list[Check] = []
    prev = GENESIS
    for number, record in enumerate(records, 1):
        target = "the genesis hash" if number == 1 else f"record {number - 1}"
        checks.append((record.get("prev") == prev, f"record {number} links to {target}"))
        prev = record.get("hash", "")
    checks += [
        (record.get("hash") == sealed(record)["hash"], f"record {number} hash matches its content")
        for number, record in enumerate(records, 1)
    ]
    checks += [
        (record.get("seq") == number, f"record {number} carries its position in the chain")
        for number, record in enumerate(records, 1)
        if "seq" in record
    ]
    placed = {record.get("attempt_id") for record in records if record.get("type") == "attempt"}
    checks += [
        (None, f"record {number} announced {record.get('key')} and has no attempt")
        for number, record in enumerate(records, 1)
        if record.get("type") == "intent" and record.get("attempt_id") not in placed
    ]
    checks += [
        corroboration_check(number, record)
        for number, record in enumerate(records, 1)
        if record.get("type") == "verification"
    ]
    checks += [
        (None, f"record {number} note to {record.get('host')} was not delivered")
        for number, record in enumerate(records, 1)
        if record.get("type") == "notified" and not record.get("delivered")
    ]
    verdicts: dict[str, list[str]] = {}
    for number, record in enumerate(records, 1):
        incident = incident_of(record)
        if record.get("type") == "attempt":
            verdicts.setdefault(incident, []).append(str(record.get("verdict")))
        if record.get("type") != "verdict":
            continue
        recorded = str(record.get("verdict"))
        schema = record.get("schema", 1)
        rule = VERDICT_RULES.get(schema) if isinstance(schema, int) else None
        if rule is None:
            verdicts.pop(incident, None)
            checks.append(
                (None, f"record {number} was written by schema {schema}, which this build cannot read")
            )
            continue
        derived = rule(verdicts.pop(incident, []))
        tail = (
            "follows from the recorded attempts"
            if recorded == derived
            else f"does not follow from the recorded attempts ({derived})"
        )
        checks.append((recorded == derived, f"record {number} verdict {recorded} {tail}"))
    return checks
