"""Ladder, quiet hours, and cutoff arithmetic.

Every time in here is computed in the contact's own IANA timezone, taken from the roster
or from the event default. A timezone is never inferred from a phone number, a country
code, or a locale (repository design principle 4).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .models import ContactType, LadderTarget

# How long after dialling a step needs before its outcome can be adjudicated. Used to
# decide whether a planned step can still finish before the field-visit cutoff.
DEFAULT_STEP_ALLOWANCE_MINUTES = 15

DEFAULT_POLICY: dict = {
    "ladder": [
        {"step": 1, "target": "primary", "delay_minutes": 0},
        {
            "step": 2,
            "target": "primary",
            "delay_minutes": 45,
            "only_if": ["no_answer", "busy", "voicemail"],
        },
        {"step": 3, "target": "alternate", "delay_minutes": 0, "only_if_alt_present": True},
        {
            "step": 4,
            "target": "primary",
            "delay_minutes": 180,
            "only_if": ["no_answer", "busy", "voicemail"],
        },
    ],
    "max_calls_per_contact": 4,
    "quiet_hours_local": {"start": "21:00", "end": "08:00"},
    "quiet_hours_emergency_override": False,
    "field_visit_cutoff_hours_before_window_start": 6,
    "confidence_threshold": 0.80,
    "supported_locales": ["en-US"],
    "unsupported_locale_action": "needs_human_bilingual_callback",
}


class PolicyError(ValueError):
    """Raised when a policy document cannot be trusted to schedule calls."""


@dataclass(frozen=True)
class LadderStep:
    step: int
    target: LadderTarget
    delay_minutes: int
    only_if: frozenset[ContactType] | None = None
    only_if_alt_present: bool = False


@dataclass(frozen=True)
class QuietHours:
    start: time
    end: time

    def contains(self, local_time: time) -> bool:
        if self.start == self.end:
            return False
        if self.start < self.end:
            return self.start <= local_time < self.end
        # Wraps midnight, for example 21:00 to 08:00.
        return local_time >= self.start or local_time < self.end


@dataclass(frozen=True)
class Policy:
    ladder: tuple[LadderStep, ...]
    max_calls_per_contact: int
    quiet_hours: QuietHours
    quiet_hours_emergency_override: bool
    field_visit_cutoff_hours_before_window_start: int
    confidence_threshold: float
    supported_locales: frozenset[str]
    unsupported_locale_action: str
    step_allowance_minutes: int = DEFAULT_STEP_ALLOWANCE_MINUTES
    raw: dict = field(default_factory=dict, compare=False, repr=False)

    def step(self, number: int) -> LadderStep | None:
        for entry in self.ladder:
            if entry.step == number:
                return entry
        return None

    @property
    def last_step_number(self) -> int:
        return max(entry.step for entry in self.ladder) if self.ladder else 0


def _parse_time(value: str, label: str) -> time:
    try:
        hour, minute = value.split(":")
        return time(int(hour), int(minute))
    except (ValueError, AttributeError) as exc:
        raise PolicyError(f"{label} must be HH:MM, got {value!r}") from exc


def load_policy(raw: dict | None) -> Policy:
    """Parse a `policy_json` document. Unknown ladder targets and contact types raise."""
    document = dict(DEFAULT_POLICY if not raw else raw)
    ladder_entries: list[LadderStep] = []
    for entry in document.get("ladder", []):
        try:
            target = LadderTarget(entry["target"])
        except (KeyError, ValueError) as exc:
            raise PolicyError(f"ladder step has an unknown target: {entry!r}") from exc
        only_if_raw = entry.get("only_if")
        only_if: frozenset[ContactType] | None = None
        if only_if_raw is not None:
            try:
                only_if = frozenset(ContactType(value) for value in only_if_raw)
            except ValueError as exc:
                raise PolicyError(f"ladder step has an unknown only_if value: {entry!r}") from exc
        ladder_entries.append(
            LadderStep(
                step=int(entry["step"]),
                target=target,
                delay_minutes=int(entry.get("delay_minutes", 0)),
                only_if=only_if,
                only_if_alt_present=bool(entry.get("only_if_alt_present", False)),
            )
        )
    ladder_entries.sort(key=lambda item: item.step)
    if not ladder_entries:
        raise PolicyError("policy must define at least one ladder step")

    quiet = document.get("quiet_hours_local", DEFAULT_POLICY["quiet_hours_local"])
    threshold = float(document.get("confidence_threshold", 0.80))
    if not 0.0 <= threshold <= 1.0:
        raise PolicyError("confidence_threshold must be between 0 and 1")

    return Policy(
        ladder=tuple(ladder_entries),
        max_calls_per_contact=int(document.get("max_calls_per_contact", len(ladder_entries))),
        quiet_hours=QuietHours(
            start=_parse_time(quiet["start"], "quiet_hours_local.start"),
            end=_parse_time(quiet["end"], "quiet_hours_local.end"),
        ),
        quiet_hours_emergency_override=bool(document.get("quiet_hours_emergency_override", False)),
        field_visit_cutoff_hours_before_window_start=int(
            document.get("field_visit_cutoff_hours_before_window_start", 6)
        ),
        confidence_threshold=threshold,
        supported_locales=frozenset(document.get("supported_locales", ["en-US"])),
        unsupported_locale_action=str(
            document.get("unsupported_locale_action", "needs_human_bilingual_callback")
        ),
        step_allowance_minutes=int(
            document.get("step_allowance_minutes", DEFAULT_STEP_ALLOWANCE_MINUTES)
        ),
        raw=document,
    )


def resolve_zone(tz_name: str) -> ZoneInfo:
    """Return the IANA zone or raise. Never falls back to a guessed zone."""
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        raise PolicyError(
            f"unknown IANA timezone {tz_name!r}; PositiveContact will not guess a timezone"
        ) from exc


def in_quiet_hours(moment: datetime, tz_name: str, policy: Policy) -> bool:
    """True when `moment` falls inside the contact's local quiet hours."""
    if policy.quiet_hours_emergency_override:
        return False
    local = moment.astimezone(resolve_zone(tz_name))
    return policy.quiet_hours.contains(local.time())


def next_callable_time(moment: datetime, tz_name: str, policy: Policy) -> datetime:
    """Move `moment` forward to the first instant outside quiet hours.

    Returns `moment` unchanged when it is already callable.
    """
    if not in_quiet_hours(moment, tz_name, policy):
        return moment
    zone = resolve_zone(tz_name)
    local = moment.astimezone(zone)
    end = policy.quiet_hours.end
    candidate = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    if candidate <= local:
        candidate = candidate + timedelta(days=1)
    return candidate.astimezone(moment.tzinfo)


def compute_field_visit_cutoff(window_start: datetime, policy: Policy) -> datetime:
    return window_start - timedelta(hours=policy.field_visit_cutoff_hours_before_window_start)


def step_can_finish_before_cutoff(
    scheduled_for: datetime, cutoff: datetime, policy: Policy
) -> bool:
    """Can a call placed at `scheduled_for` be adjudicated before the field-visit cutoff?"""
    return scheduled_for + timedelta(minutes=policy.step_allowance_minutes) <= cutoff


def locale_supported(locale: str, policy: Policy) -> bool:
    return locale in policy.supported_locales


def select_next_step(
    policy: Policy,
    *,
    current_step: int,
    last_contact_type: ContactType,
    has_alternate: bool,
) -> LadderStep | None:
    """Return the next ladder step to run, or None when the ladder is exhausted.

    Steps whose `only_if` does not include the last outcome are skipped rather than
    ending the ladder, so a voicemail can still fall through to the alternate contact.
    """
    for entry in policy.ladder:
        if entry.step <= current_step:
            continue
        if entry.only_if is not None and last_contact_type not in entry.only_if:
            continue
        if entry.only_if_alt_present and not has_alternate:
            continue
        if entry.target is LadderTarget.ALTERNATE and not has_alternate:
            continue
        return entry
    return None


def schedule_step(
    step: LadderStep,
    *,
    after: datetime,
    tz_name: str,
    policy: Policy,
) -> datetime:
    """When may this step actually be dialled, given its delay and quiet hours?"""
    planned = after + timedelta(minutes=step.delay_minutes)
    return next_callable_time(planned, tz_name, policy)
