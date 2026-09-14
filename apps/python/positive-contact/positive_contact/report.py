"""The report: every count carries the denominator it was measured against.

The number that matters to a regulator is not "calls completed". It is how many enrolled
customers a human being confirmed hearing the notice, out of how many the utility was
required to reach. A report that prints the first and implies the second is the failure
mode this module exists to prevent.

`confirmed` is never inferred from call completion. It comes from a `CONFIRMED`
disposition, or from an operator confirmation that cited evidence, and the two are counted
separately so nobody has to take the total on trust.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from datetime import datetime

from .ledger import Ledger
from .models import ContactType, DispositionKind, Event, IntentState

UNSUPPORTED_LOCALE_REASON = "unsupported_locale_bilingual_callback"
WRONG_NUMBER_REASON = "wrong_number_reported_on_call"


@dataclass
class Metric:
    label: str
    value: str
    denominator: str

    def as_row(self) -> list[str]:
        return [self.label, self.value, self.denominator]


@dataclass
class Report:
    event_id: str
    generated_at: datetime
    metrics: list[Metric] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_markdown(self) -> str:
        lines = [
            f"# PositiveContact report for {self.event_id}",
            "",
            f"Generated {self.generated_at.isoformat()}",
            "",
            "| Metric | Value | Denominator |",
            "| --- | --- | --- |",
        ]
        lines.extend(
            f"| {metric.label} | {metric.value} | {metric.denominator} |"
            for metric in self.metrics
        )
        if self.notes:
            lines.extend(["", "## Notes", ""])
            lines.extend(f"- {note}" for note in self.notes)
        return "\n".join(lines) + "\n"

    def to_csv(self) -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(["metric", "value", "denominator"])
        for metric in self.metrics:
            writer.writerow(metric.as_row())
        return buffer.getvalue()

    def to_json(self) -> str:
        return (
            json.dumps(
                {
                    "event_id": self.event_id,
                    "generated_at": self.generated_at.isoformat(),
                    "metrics": [
                        {
                            "label": metric.label,
                            "value": metric.value,
                            "denominator": metric.denominator,
                        }
                        for metric in self.metrics
                    ],
                    "counts": self.counts,
                    "notes": self.notes,
                },
                indent=2,
            )
            + "\n"
        )


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = fraction * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def _median(values: list[float]) -> float | None:
    return _percentile(values, 0.5)


def _format_minutes(value: float | None) -> str:
    if value is None:
        return "n/a"
    if value < 60:
        return f"{value:.0f} min"
    return f"{value / 60:.1f} h"


def build_report(ledger: Ledger, event: Event, *, now: datetime) -> Report:
    """Compute every metric in ARCHITECTURE.md section 12 with its denominator."""
    contacts = ledger.list_contacts(event.event_id)
    in_scope = len(contacts)

    routed_locale = [
        contact
        for contact in contacts
        if _retired_reason(ledger, contact.contact_id) == UNSUPPORTED_LOCALE_REASON
    ]

    intents = ledger.list_intents(event.event_id)
    intents_by_contact: dict[str, list] = {}
    for intent in intents:
        intents_by_contact.setdefault(intent.contact_id, []).append(intent)

    dispositions = {item.intent_id: item for item in ledger.list_dispositions(event.event_id)}

    attempted_contacts: set[str] = set()
    for intent in intents:
        if ledger.get_attempt(intent.intent_id) is not None:
            attempted_contacts.add(intent.contact_id)

    contact_types: dict[str, set[ContactType]] = {}
    for intent in intents:
        disposition = dispositions.get(intent.intent_id)
        if disposition is not None:
            contact_types.setdefault(intent.contact_id, set()).add(disposition.contact_type)

    final_states: dict[str, set[IntentState]] = {}
    for intent in intents:
        final_states.setdefault(intent.contact_id, set()).add(
            ledger.reconstruct(intent.intent_id)
        )

    # A person who refused, or who could not understand the language, is still a person
    # who answered. A wrong number is not: that reached somebody, but not the enrolled
    # customer. Keeping these consistent is what makes "refused of live reached" mean
    # anything.
    live_contact_types = {
        ContactType.LIVE_PERSON,
        ContactType.REFUSED,
        ContactType.LANGUAGE_BARRIER,
    }
    live_reached = {
        contact_id
        for contact_id, types in contact_types.items()
        if types & live_contact_types
    }

    confirmed_by_judges = {
        intent.contact_id
        for intent in intents
        if (item := dispositions.get(intent.intent_id))
        and item.disposition is DispositionKind.CONFIRMED
    }
    confirmed_contacts = {
        contact_id
        for contact_id, states in final_states.items()
        if IntentState.CONFIRMED in states
    }
    confirmed_by_operator = confirmed_contacts - confirmed_by_judges

    voicemail_only = {
        contact_id
        for contact_id, types in contact_types.items()
        if ContactType.VOICEMAIL in types and ContactType.LIVE_PERSON not in types
    }
    unreached = {
        contact_id
        for contact_id, types in contact_types.items()
        if types <= {ContactType.NO_ANSWER, ContactType.BUSY} and types
    }
    wrong_number = {
        contact_id
        for contact_id, types in contact_types.items()
        if ContactType.WRONG_NUMBER in types
    }
    refused = {
        contact_id for contact_id, types in contact_types.items() if ContactType.REFUSED in types
    }
    language_barrier_on_call = {
        contact_id
        for contact_id, types in contact_types.items()
        if ContactType.LANGUAGE_BARRIER in types
    }

    needs_human_open = [
        intent
        for intent in intents
        if ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN
    ]
    work_orders = ledger.list_work_orders(event.event_id)
    pending_visits = [order for order in work_orders if order.approved_at is None]
    issued_visits = [order for order in work_orders if order.approved_at is not None]

    calls_placed = ledger.count_calls_for_event(event.event_id)

    attempts_per_confirmed = [
        float(ledger.count_calls_for_contact(contact_id)) for contact_id in confirmed_contacts
    ]

    durations: list[float] = []
    for contact_id in confirmed_contacts:
        started: datetime | None = None
        finished: datetime | None = None
        for intent in sorted(
            intents_by_contact.get(contact_id, []), key=lambda item: item.created_at
        ):
            for row in ledger.list_transitions(intent.intent_id):
                if started is None:
                    started = row.at
                if row.to_state is IntentState.CONFIRMED:
                    finished = row.at
        if started and finished and finished >= started:
            durations.append((finished - started).total_seconds() / 60.0)

    def of(count: int, total: int, noun: str) -> str:
        return f"of {total} {noun}"

    report = Report(event_id=event.event_id, generated_at=now)
    report.metrics = [
        Metric("Enrolled contacts in scope", str(in_scope), "-"),
        Metric(
            "Contacts attempted",
            str(len(attempted_contacts)),
            of(len(attempted_contacts), in_scope, "in scope"),
        ),
        Metric(
            "Live human reached",
            str(len(live_reached)),
            of(len(live_reached), len(attempted_contacts), "attempted"),
        ),
        Metric(
            "Positive contact confirmed",
            str(len(confirmed_contacts)),
            of(len(confirmed_contacts), len(live_reached), "live reached"),
        ),
        Metric(
            "  confirmed by the adjudicator",
            str(len(confirmed_by_judges)),
            of(len(confirmed_by_judges), len(confirmed_contacts), "confirmed"),
        ),
        Metric(
            "  confirmed by an operator with evidence",
            str(len(confirmed_by_operator)),
            of(len(confirmed_by_operator), len(confirmed_contacts), "confirmed"),
        ),
        Metric(
            "Voicemail only",
            str(len(voicemail_only)),
            of(len(voicemail_only), len(attempted_contacts), "attempted"),
        ),
        Metric(
            "Unreached (no answer / busy after ladder)",
            str(len(unreached)),
            of(len(unreached), len(attempted_contacts), "attempted"),
        ),
        Metric(
            "Wrong number",
            str(len(wrong_number)),
            of(len(wrong_number), len(attempted_contacts), "attempted"),
        ),
        Metric(
            "Refused",
            str(len(refused)),
            of(len(refused), len(live_reached), "live reached"),
        ),
        Metric(
            "Language not supported, bilingual callback opened",
            str(len(routed_locale)),
            of(len(routed_locale), in_scope, "in scope, never dialled"),
        ),
        Metric(
            "Language barrier discovered on the call",
            str(len(language_barrier_on_call)),
            of(len(language_barrier_on_call), len(attempted_contacts), "attempted"),
        ),
        Metric("Needs-human items open", str(len(needs_human_open)), "-"),
        Metric(
            "Field visits pending approval / issued",
            f"{len(pending_visits)} / {len(issued_visits)}",
            "-",
        ),
        Metric("Calls placed", str(calls_placed), "-"),
        Metric(
            "Median attempts per confirmed contact",
            f"{_median(attempts_per_confirmed):.0f}" if attempts_per_confirmed else "n/a",
            f"over {len(confirmed_contacts)} confirmed" if confirmed_contacts else "-",
        ),
        Metric(
            "Time to confirmation p50 / p90",
            f"{_format_minutes(_percentile(durations, 0.5))} / "
            f"{_format_minutes(_percentile(durations, 0.9))}",
            f"over {len(durations)} confirmed" if durations else "-",
        ),
    ]

    report.counts = {
        "in_scope": in_scope,
        "attempted": len(attempted_contacts),
        "live_reached": len(live_reached),
        "confirmed": len(confirmed_contacts),
        "confirmed_by_adjudicator": len(confirmed_by_judges),
        "confirmed_by_operator": len(confirmed_by_operator),
        "voicemail_only": len(voicemail_only),
        "unreached": len(unreached),
        "wrong_number": len(wrong_number),
        "refused": len(refused),
        "unsupported_locale_routed": len(routed_locale),
        "language_barrier_on_call": len(language_barrier_on_call),
        "needs_human_open": len(needs_human_open),
        "field_visits_pending": len(pending_visits),
        "field_visits_issued": len(issued_visits),
        "calls_placed": calls_placed,
    }

    report.notes = [
        "Confirmed counts a contact only when a disposition of CONFIRMED was recorded, or "
        "an operator confirmed it and cited evidence. It is never inferred from a "
        "completed call.",
        "Contacts routed for an unsupported locale were never dialled, so they are "
        "reported against contacts in scope rather than against contacts attempted.",
        "Live human reached counts a live person, a refusal, and a language barrier "
        "discovered on the call, because each of those means somebody answered. A wrong "
        "number is excluded: it reached somebody, but not the enrolled customer.",
        f"{len(needs_human_open)} needs-human item(s) remain open. Open items still count "
        "against the field-visit cutoff.",
    ]
    return report


def _retired_reason(ledger: Ledger, contact_id: str) -> str | None:
    row = ledger.conn.execute(
        "SELECT retired_reason FROM contacts WHERE contact_id = ?", (contact_id,)
    ).fetchone()
    return row["retired_reason"] if row else None


def work_orders_csv(ledger: Ledger, event: Event, *, approved_only: bool = True) -> str:
    """Export field visits with masked numbers and the contact id, never a raw number."""
    from .redact import mask_e164

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        [
            "work_order_id",
            "event_id",
            "contact_id",
            "first_name",
            "service_address_short",
            "phone_masked",
            "reason_code",
            "created_at",
            "approved_by",
            "approved_at",
        ]
    )
    for order in ledger.list_work_orders(event.event_id):
        if approved_only and order.approved_at is None:
            continue
        contact = ledger.get_contact(order.contact_id)
        writer.writerow(
            [
                order.work_order_id,
                order.event_id,
                order.contact_id,
                contact.first_name if contact else "",
                contact.service_address_short if contact else "",
                mask_e164(contact.phone_e164) if contact else "",
                order.reason_code,
                order.created_at.isoformat(),
                order.approved_by or "",
                order.approved_at.isoformat() if order.approved_at else "",
            ]
        )
    return buffer.getvalue()


def work_orders_json(ledger: Ledger, event: Event, *, approved_only: bool = True) -> str:
    from .redact import mask_e164

    rows = []
    for order in ledger.list_work_orders(event.event_id):
        if approved_only and order.approved_at is None:
            continue
        contact = ledger.get_contact(order.contact_id)
        rows.append(
            {
                "work_order_id": order.work_order_id,
                "event_id": order.event_id,
                "contact_id": order.contact_id,
                "first_name": contact.first_name if contact else None,
                "service_address_short": contact.service_address_short if contact else None,
                "phone_masked": mask_e164(contact.phone_e164) if contact else None,
                "reason_code": order.reason_code,
                "created_at": order.created_at.isoformat(),
                "approved_by": order.approved_by,
                "approved_at": order.approved_at.isoformat() if order.approved_at else None,
            }
        )
    return json.dumps({"event_id": event.event_id, "work_orders": rows}, indent=2) + "\n"
