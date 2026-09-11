"""Preflight: everything that must be true before a single call is placed.

Preflight refuses rather than repairs. A malformed E.164 is a blocking issue, not
something to fix by adding a country code. An unknown timezone is a blocking issue, not a
reason to fall back to the event default. An unsupported locale is not a reason to call in
English anyway; it routes to a bilingual human callback.

Every line preflight prints is masked. `tests/test_masking.py` asserts that the rendered
preview contains no raw E.164 from the roster.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .models import (
    Contact,
    Event,
    IDEMPOTENCY_KEY_MAX_LENGTH,
    LadderTarget,
    derive_idempotency_key,
    validate_e164,
)
from .policy import (
    Policy,
    PolicyError,
    compute_field_visit_cutoff,
    load_policy,
    resolve_zone,
    schedule_step,
    step_can_finish_before_cutoff,
)
from .redact import find_raw_e164, mask_e164, mask_numbers_in_text
from .script import render_task_text

ROSTER_COLUMNS = (
    "contact_id",
    "first_name",
    "phone_e164",
    "alt_phone_e164",
    "locale",
    "tz",
    "service_address_short",
)

REQUIRED_ROSTER_COLUMNS = (
    "contact_id",
    "first_name",
    "phone_e164",
    "locale",
    "service_address_short",
)


class PreflightError(RuntimeError):
    """Raised when the event or roster file itself cannot be read."""


@dataclass
class Issue:
    contact_id: str | None
    code: str
    detail: str


@dataclass
class RoutedContact:
    contact_id: str
    locale: str
    action: str
    detail: str
    contact: Contact | None = None


@dataclass
class PreflightResult:
    event: Event
    policy: Policy
    callable_contacts: list[Contact] = field(default_factory=list)
    routed: list[RoutedContact] = field(default_factory=list)
    blocking: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    roster_size: int = 0

    @property
    def ok(self) -> bool:
        return not self.blocking

    @property
    def exit_code(self) -> int:
        return 1 if self.blocking else 0


def load_event(path: Path | str) -> tuple[Event, Policy]:
    """Read an event definition and its policy. Computes the cutoff when absent."""
    raw_path = Path(path)
    try:
        document = json.loads(raw_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PreflightError(f"could not read event definition {raw_path}: {exc}") from exc

    try:
        policy = load_policy(document.get("policy"))
    except PolicyError as exc:
        raise PreflightError(f"event policy is not usable: {exc}") from exc

    try:
        window_start = datetime.fromisoformat(document["window_start"])
        window_end = datetime.fromisoformat(document["window_end"])
    except (KeyError, ValueError) as exc:
        raise PreflightError(
            "event needs ISO 8601 window_start and window_end with a timezone offset"
        ) from exc

    cutoff_raw = document.get("field_visit_cutoff")
    cutoff = (
        datetime.fromisoformat(cutoff_raw)
        if cutoff_raw
        else compute_field_visit_cutoff(window_start, policy)
    )

    try:
        event = Event(
            event_id=document["event_id"],
            utility_name=document["utility_name"],
            window_start=window_start,
            window_end=window_end,
            field_visit_cutoff=cutoff,
            default_tz=document.get("default_tz", "America/Los_Angeles"),
            crc_info=document.get("crc_info", {}),
            policy=policy.raw,
            support_providers=document.get("support_providers", []),
        )
    except (KeyError, ValueError) as exc:
        raise PreflightError(f"event definition is incomplete: {exc}") from exc
    return event, policy


def load_roster_rows(path: Path | str) -> list[dict[str, str]]:
    raw_path = Path(path)
    try:
        with raw_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None:
                raise PreflightError(f"roster {raw_path} has no header row")
            missing = [
                column for column in REQUIRED_ROSTER_COLUMNS if column not in reader.fieldnames
            ]
            if missing:
                raise PreflightError(
                    f"roster {raw_path} is missing required column(s): {', '.join(missing)}"
                )
            return [dict(row) for row in reader]
    except OSError as exc:
        raise PreflightError(f"could not read roster {raw_path}: {exc}") from exc


def run_preflight(
    event: Event, policy: Policy, rows: list[dict[str, str]], *, now: datetime
) -> PreflightResult:
    """Validate a roster against an event. Never repairs a value; records issues instead."""
    result = PreflightResult(event=event, policy=policy, roster_size=len(rows))
    seen: set[str] = set()

    if event.field_visit_cutoff >= event.window_start:
        result.blocking.append(
            Issue(
                None,
                "cutoff_after_window_start",
                "field_visit_cutoff must fall before window_start; a truck cannot be sent "
                "after the power is already off",
            )
        )
    if event.window_end <= event.window_start:
        result.blocking.append(
            Issue(None, "window_inverted", "window_end must be after window_start")
        )

    for index, row in enumerate(rows, start=2):  # line 1 is the header
        contact_id = (row.get("contact_id") or "").strip()
        if not contact_id:
            result.blocking.append(
                Issue(None, "missing_contact_id", f"roster line {index} has no contact_id")
            )
            continue
        if contact_id in seen:
            result.blocking.append(
                Issue(contact_id, "duplicate_contact_id", f"contact_id repeats on line {index}")
            )
            continue
        seen.add(contact_id)

        locale = (row.get("locale") or "").strip()
        tz_name = (row.get("tz") or "").strip() or event.default_tz
        try:
            resolve_zone(tz_name)
        except PolicyError as exc:
            result.blocking.append(Issue(contact_id, "unknown_timezone", str(exc)))
            continue

        phone = (row.get("phone_e164") or "").strip()
        alt_phone = (row.get("alt_phone_e164") or "").strip() or None
        try:
            validate_e164(phone)
            if alt_phone:
                validate_e164(alt_phone)
        except ValueError as exc:
            result.blocking.append(Issue(contact_id, "invalid_e164", str(exc)))
            continue

        try:
            # `derive_idempotency_key` raises rather than returning an over-long key, so
            # this has to be caught. Letting it propagate turned a roster defect into a
            # traceback and made the blocking-issue branch below unreachable.
            derive_idempotency_key(event.event_id, contact_id, 1, LadderTarget.PRIMARY)
        except ValueError as exc:
            result.blocking.append(Issue(contact_id, "idempotency_key_too_long", str(exc)))
            continue

        try:
            contact = Contact(
                contact_id=contact_id,
                event_id=event.event_id,
                first_name=(row.get("first_name") or "").strip(),
                phone_e164=phone,
                alt_phone_e164=alt_phone,
                locale=locale,
                tz=tz_name,
                service_address_short=(row.get("service_address_short") or "").strip(),
            )
        except ValueError as exc:
            result.blocking.append(Issue(contact_id, "invalid_contact", str(exc)))
            continue

        if locale not in policy.supported_locales:
            result.routed.append(
                RoutedContact(
                    contact_id=contact_id,
                    locale=locale,
                    contact=contact,
                    action=policy.unsupported_locale_action,
                    detail=(
                        f"locale {locale!r} is not on the supported CALL-E line for this "
                        "destination; routed to a bilingual human callback instead of being "
                        "called in a language the customer did not ask for"
                    ),
                )
            )
            continue

        first_step = policy.ladder[0]
        planned = schedule_step(first_step, after=now, tz_name=tz_name, policy=policy)
        if not step_can_finish_before_cutoff(planned, event.field_visit_cutoff, policy):
            result.warnings.append(
                Issue(
                    contact_id,
                    "cannot_finish_before_cutoff",
                    "the first ladder step cannot complete before the field-visit cutoff; "
                    "this contact goes straight to the field-visit queue",
                )
            )
        elif planned > now:
            result.warnings.append(
                Issue(
                    contact_id,
                    "deferred_for_quiet_hours",
                    f"first call deferred to {planned.astimezone(resolve_zone(tz_name)).isoformat()} "
                    "local, outside quiet hours",
                )
            )

        result.callable_contacts.append(contact)

    return result


def render_preview(result: PreflightResult, *, now: datetime, include_script: bool = True) -> str:
    """Render the masked operator preview. Contains no raw phone number, by construction."""
    event = result.event
    policy = result.policy
    lines: list[str] = []
    lines.append(f"PositiveContact preflight for event {event.event_id}")
    lines.append(f"  utility            {event.utility_name}")
    lines.append(f"  shutoff window     {event.window_start.isoformat()} to {event.window_end.isoformat()}")
    lines.append(f"  field-visit cutoff {event.field_visit_cutoff.isoformat()}")
    lines.append(f"  default timezone   {event.default_tz}")
    lines.append(f"  supported locales  {', '.join(sorted(policy.supported_locales))}")
    lines.append(
        f"  ladder             "
        + " -> ".join(
            f"step {step.step} ({step.target.value}, +{step.delay_minutes}m)"
            for step in policy.ladder
        )
    )
    lines.append(
        f"  quiet hours        {policy.quiet_hours.start.strftime('%H:%M')} to "
        f"{policy.quiet_hours.end.strftime('%H:%M')} local"
        + (" (override ON)" if policy.quiet_hours_emergency_override else "")
    )
    lines.append(f"  confidence gate    >= {policy.confidence_threshold:.2f} or label 'high'")
    lines.append("")

    lines.append(f"Roster: {result.roster_size} row(s)")
    lines.append(
        f"  callable now       {len(result.callable_contacts)}"
    )
    lines.append(f"  routed to a human  {len(result.routed)}")
    lines.append(f"  blocking issues    {len(result.blocking)}")
    lines.append(f"  warnings           {len(result.warnings)}")
    lines.append("")

    if result.callable_contacts:
        lines.append("Contacts to call (numbers masked):")
        header = f"  {'contact_id':<14} {'name':<10} {'primary':<16} {'alternate':<16} {'locale':<8} timezone"
        lines.append(header)
        for contact in result.callable_contacts:
            lines.append(
                f"  {contact.contact_id:<14} {contact.first_name:<10} "
                f"{mask_e164(contact.phone_e164):<16} "
                f"{(mask_e164(contact.alt_phone_e164) if contact.alt_phone_e164 else '-'):<16} "
                f"{contact.locale:<8} {contact.tz}"
            )
        lines.append("")

    if result.routed:
        lines.append("Routed without a call:")
        for routed in result.routed:
            lines.append(f"  {routed.contact_id:<14} {routed.action}")
            lines.append(f"                 {routed.detail}")
        lines.append("")

    if result.warnings:
        lines.append("Warnings:")
        for issue in result.warnings:
            lines.append(
                f"  [{issue.code}] {issue.contact_id or '-'}: "
                f"{mask_numbers_in_text(issue.detail)}"
            )
        lines.append("")

    if result.blocking:
        lines.append("Blocking issues (no call will be placed):")
        for issue in result.blocking:
            lines.append(
                f"  [{issue.code}] {issue.contact_id or '-'}: "
                f"{mask_numbers_in_text(issue.detail)}"
            )
        lines.append("")

    if include_script and result.callable_contacts:
        sample = result.callable_contacts[0]
        lines.append(f"Exact call script for {sample.contact_id} (locale {sample.locale}):")
        lines.append("-" * 72)
        task_text = render_task_text(
            event,
            first_name=sample.first_name,
            service_address_short=sample.service_address_short,
            locale=sample.locale,
            tz_name=sample.tz,
        )
        lines.extend(f"  {line}" for line in task_text.splitlines())
        lines.append("-" * 72)

    rendered = "\n".join(lines)
    leaked = find_raw_e164(rendered)
    if leaked:
        raise PreflightError(
            f"preview would have exposed {len(leaked)} unmasked phone number(s); refusing to print"
        )
    return rendered
