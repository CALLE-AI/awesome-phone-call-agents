"""CSV exports and the contact-health report.

Three outputs, all sanitised and masked:

* **suggested contact changes** -- what the office should fix in their own system;
* **suggested register reasons** -- for staff to approve, never applied by us;
* **contact-health report** -- reachability per pupil and per contact.

Reachable suggests; the office decides. Nothing here writes to a school system
and nothing here records an official attendance code.

Every cell goes through :func:`reachable.sanitize.clean_for_csv`, which also
neutralises leading ``=``, ``+``, ``-`` and ``@`` -- a school office opens these
in Excel.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

from .models import FLAGGED_HEALTH, HEALTH_TEXT, ContactHealth, Dataset, Workflow
from .phone import mask
from .sanitize import clean_for_csv
from .store import Store, from_json

SUGGESTED_CHANGES_HEADER = [
    "pupil_id",
    "pupil_first_name",
    "contact_id",
    "contact_name",
    "contact_order",
    "masked_number",
    "current_status",
    "suggested_action",
    "evidence",
    "last_checked",
]

SUGGESTED_REASONS_HEADER = [
    "case_id",
    "pupil_id",
    "pupil_first_name",
    "trigger_sessions",
    "code_n_deadline",
    "suggested_reason_category",
    "reason_note",
    "quote",
    "status",
    "approved_by_staff",
]

CONTACT_HEALTH_HEADER = [
    "pupil_id",
    "pupil_first_name",
    "contacts_total",
    "contacts_verified",
    "contacts_flagged",
    "reachability",
    "detail",
]

SUGGESTED_ACTION = {
    ContactHealth.WRONG_PERSON: "Number belongs to somebody else - confirm and replace",
    ContactHealth.NUMBER_NOT_WORKING: "Number not working - confirm and replace",
    ContactHealth.NO_LONGER_A_CONTACT: "Person declined the role - remove or replace",
    ContactHealth.UPDATE_REQUESTED: "Contact asked for an update - confirm through a known channel",
    ContactHealth.INVALID_NUMBER: "Stored number is not valid E.164 - correct the record",
    ContactHealth.LANGUAGE_UNSUPPORTED: "Needs another language - call by hand",
    ContactHealth.UNREACHED: "Could not be reached - try again or confirm another way",
}


def _writer(header: list[str]) -> tuple[io.StringIO, csv.writer]:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    return buffer, writer


def suggested_contact_changes(store: Store, dataset: Dataset) -> str:
    """Rows the office should act on. No full numbers, ever."""
    buffer, writer = _writer(SUGGESTED_CHANGES_HEADER)
    by_id = {c.contact_id: c for c in dataset.contacts}

    for row in store.contact_health():
        try:
            status = ContactHealth(row["status"])
        except ValueError:
            continue
        if status not in FLAGGED_HEALTH and status is not ContactHealth.UPDATE_REQUESTED:
            continue
        contact = by_id.get(row["contact_id"])
        pupil = dataset.pupils.get(row["pupil_id"])
        writer.writerow(
            [
                clean_for_csv(row["pupil_id"]),
                clean_for_csv(pupil.first_name if pupil else ""),
                clean_for_csv(row["contact_id"]),
                clean_for_csv(contact.contact_name if contact else ""),
                clean_for_csv(contact.contact_order if contact else ""),
                # Masked. A suggested-changes file is emailed around an office.
                clean_for_csv(mask(contact.phone_e164) if contact else ""),
                clean_for_csv(HEALTH_TEXT.get(status, status.value)),
                clean_for_csv(SUGGESTED_ACTION.get(status, "Review")),
                clean_for_csv(row["reason"]),
                clean_for_csv(row["last_checked"] or ""),
            ]
        )
    return buffer.getvalue()


def suggested_register_reasons(store: Store, dataset: Dataset) -> str:
    """Suggestions for staff to approve. Reachable records no attendance code."""
    buffer, writer = _writer(SUGGESTED_REASONS_HEADER)

    for case in store.cases(Workflow.PATTERN_FOLLOWUP):
        detail = from_json(case["detail"], {}) or {}
        attempt = store.one(
            """
            SELECT * FROM call_attempts
             WHERE case_id = ? AND structured_result IS NOT NULL
             ORDER BY id DESC LIMIT 1
            """,
            (case["case_id"],),
        )
        if attempt is None:
            continue
        result = from_json(attempt["structured_result"], {}) or {}
        category = result.get("reason_category", "")
        if not category or category == "unknown":
            continue

        pupil = dataset.pupils.get(case["pupil_id"])
        quotes = result.get("verbatim_quotes") or []
        approved = store.one(
            "SELECT 1 FROM events WHERE case_id = ? AND kind = 'staff.approved_reason' LIMIT 1",
            (case["case_id"],),
        )
        writer.writerow(
            [
                clean_for_csv(case["case_id"]),
                clean_for_csv(case["pupil_id"]),
                clean_for_csv(pupil.first_name if pupil else ""),
                clean_for_csv(detail.get("sessions", "")),
                clean_for_csv(detail.get("code_n_deadline", "")),
                clean_for_csv(category),
                clean_for_csv(result.get("reason_note", "")),
                clean_for_csv(quotes[0] if quotes else ""),
                clean_for_csv(case["state"]),
                "yes" if approved else "no",
            ]
        )
    return buffer.getvalue()


@dataclass
class Reachability:
    pupil_id: str
    first_name: str
    total: int
    verified: int
    flagged: int

    @property
    def summary(self) -> str:
        return f"{self.verified} of {self.total} contacts verified"

    @property
    def at_risk(self) -> bool:
        """No verified contact at all is the finding the office needs."""
        return self.verified == 0


def reachability(store: Store, dataset: Dataset) -> list[Reachability]:
    health = {row["contact_id"]: row["status"] for row in store.contact_health()}
    rows: list[Reachability] = []
    for pupil_id, pupil in sorted(dataset.pupils.items()):
        contacts = dataset.contacts_for(pupil_id)
        verified = sum(
            1 for c in contacts if health.get(c.contact_id) == ContactHealth.VERIFIED.value
        )
        flagged = sum(
            1
            for c in contacts
            if health.get(c.contact_id) in {h.value for h in FLAGGED_HEALTH}
        )
        rows.append(
            Reachability(pupil_id, pupil.first_name, len(contacts), verified, flagged)
        )
    return rows


def contact_health_report(store: Store, dataset: Dataset) -> str:
    buffer, writer = _writer(CONTACT_HEALTH_HEADER)
    health = {row["contact_id"]: row for row in store.contact_health()}

    for row in reachability(store, dataset):
        details = []
        for contact in dataset.contacts_for(row.pupil_id):
            entry = health.get(contact.contact_id)
            status = entry["status"] if entry else ContactHealth.NOT_CHECKED.value
            details.append(f"{contact.contact_name} ({mask(contact.phone_e164)}): {status}")
        writer.writerow(
            [
                clean_for_csv(row.pupil_id),
                clean_for_csv(row.first_name),
                row.total,
                row.verified,
                row.flagged,
                clean_for_csv(row.summary),
                clean_for_csv("; ".join(details)),
            ]
        )
    return buffer.getvalue()


def counters(store: Store, dataset: Dataset) -> dict[str, int]:
    """Honest counters for the dashboard. Counts of what happened, nothing else."""
    health = [row["status"] for row in store.contact_health()]
    tasks = store.tasks()
    return {
        "calls_placed": len(store.rows("SELECT 1 FROM call_attempts WHERE call_id IS NOT NULL")),
        "contacts_verified": sum(1 for s in health if s == ContactHealth.VERIFIED.value),
        "contacts_flagged": sum(1 for s in health if s in {h.value for h in FLAGGED_HEALTH}),
        "contacts_not_checked": sum(
            1 for s in health if s == ContactHealth.NOT_CHECKED.value
        ),
        "open_staff_tasks": len(tasks),
        # Counted separately on purpose. A safeguarding escalation came out of a
        # call; a vulnerable-pupil task means no call was ever placed. Adding
        # them together would overstate how often a call raised an alarm.
        "escalations_from_calls": sum(1 for t in tasks if t["kind"] == "safeguarding"),
        "vulnerable_pupils_not_called": sum(
            1 for t in tasks if t["kind"] == "vulnerable_pupil"
        ),
        "decisions_not_to_call": len(store.decisions()),
        "pupils_with_no_verified_contact": sum(
            1 for r in reachability(store, dataset) if r.at_risk
        ),
    }
