#!/usr/bin/env python3
"""Print the plan for one positive-contact call. Places no call, opens no socket.

Standard library only. Reads one JSON object on standard input and writes a masked plan,
the exact words the call would use, and either "OK to call" or the reasons it must not be
placed.

    python3 scripts/preview.py < contact.json

Input shape:

    {
      "event": {
        "event_id": "psps-demo-2026-09",
        "organisation": "Northbay Power",
        "notice": "a possible Public Safety Power Shutoff",
        "window_start": "2026-09-11T18:00:00-07:00",
        "window_end": "2026-09-12T20:00:00-07:00",
        "field_visit_cutoff": "2026-09-11T12:00:00-07:00",
        "resource_center": {
          "location": "the Glen Ellen Community Hall",
          "hours": "8:00 AM to 8:00 PM daily"
        }
      },
      "contact": {
        "contact_id": "pc-001",
        "first_name": "Maria",
        "phone_e164": "+14155550101",
        "alt_phone_e164": null,
        "locale": "en-US",
        "tz": "America/Los_Angeles",
        "service_address_short": "1200 block of Elm St"
      },
      "ladder_step": 1,
      "target": "primary",
      "now": "2026-09-11T08:00:00-07:00"
    }

Exit code is 0 when the call may be placed and 1 when it must not be.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")
E164_IN_TEXT_RE = re.compile(r"\+[1-9]\d{6,14}")
MASK_DOTS = "•••"

DEFAULT_QUIET_START = "21:00"
DEFAULT_QUIET_END = "08:00"
DEFAULT_SUPPORTED_LOCALES = ["en-US"]
DEFAULT_STEP_ALLOWANCE_MINUTES = 15
IDEMPOTENCY_KEY_MAX_LENGTH = 255

TASK_TEMPLATE = """This is an automated safety notification from {organisation} about {notice}. This call may be recorded. Am I speaking with {first_name} or someone in the household?

Power at {service_address_short} may be turned off starting {window_start_local} to reduce wildfire risk, and could stay off until {window_end_local}. Because this account is enrolled in the Medical Baseline program, we are calling to make sure you have received this notice. Can you confirm that you heard it?

Do you need information about the Community Resource Center at {resource_center}, or would you like a callback from our customer support team?

We will never ask for payment or account information on this call. Thank you.

How to handle this call:
- Say the disclosure above first, before anything else. Never skip it.
- If voicemail or an answering machine answers: leave the notice, do not ask questions, and set contact_type to voicemail. A message you leave is never an acknowledgement.
- You may answer only these: repeat the notice, the Community Resource Center location and hours ({resource_center_hours}), take a callback request, note a preferred language, and note whether an alternate contact should also be notified.
- If you are asked anything about medical equipment, health, or what to do medically: say that a team member will call them back about it, set needs_assistance to medical_question, and end the call politely. Give no medical advice and no reassurance about equipment.
- Never discuss account status, billing, payment, or credit. Never ask for an account number, a card number, a date of birth, or any identifying detail beyond confirming you are speaking with someone in the household. Never offer to change the outage timing.
- If the person cannot understand the language of this call: set contact_type to language_barrier and end politely. Do not attempt another language.
- If the person says this is the wrong number: set contact_type to wrong_number and end politely.
- Do not record any medical condition, device, diagnosis, or medication in any field."""


def mask_e164(value):
    """Mask a phone number for display. Never returns a dialable number."""
    if not value or not isinstance(value, str):
        return "(no number)"
    if len(value) >= 10:
        return value[:5] + MASK_DOTS + value[-4:]
    if len(value) >= 7:
        return value[:2] + MASK_DOTS + value[-2:]
    return MASK_DOTS


def mask_text(text):
    return E164_IN_TEXT_RE.sub(lambda match: mask_e164(match.group(0)), text)


def parse_clock(value, label, problems):
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        problems.append("%s is not an ISO 8601 timestamp" % label)
        return None
    if parsed.tzinfo is None:
        problems.append("%s has no timezone offset" % label)
        return None
    return parsed


def parse_hhmm(value, fallback):
    try:
        hour, minute = str(value).split(":")
        return time(int(hour), int(minute))
    except (AttributeError, TypeError, ValueError):
        hour, minute = fallback.split(":")
        return time(int(hour), int(minute))


def in_quiet_hours(local_time, start, end):
    if start == end:
        return False
    if start < end:
        return start <= local_time < end
    return local_time >= start or local_time < end


def spoken_time(moment, zone):
    local = moment.astimezone(zone)
    hour_12 = local.hour % 12 or 12
    meridiem = "AM" if local.hour < 12 else "PM"
    return "%s %s %d at %d:%s %s %s" % (
        local.strftime("%A"),
        local.strftime("%B"),
        local.day,
        hour_12,
        local.strftime("%M"),
        meridiem,
        local.strftime("%Z"),
    )


def build_plan(document):
    """Return (lines, refusals). `refusals` empty means the call may be placed."""
    refusals = []
    lines = []

    event = document.get("event") or {}
    contact = document.get("contact") or {}
    policy = document.get("policy") or {}
    step = document.get("ladder_step", 1)
    target = document.get("target", "primary")

    contact_id = contact.get("contact_id") or "(no contact_id)"
    first_name = contact.get("first_name") or ""
    locale = contact.get("locale") or ""
    tz_name = contact.get("tz") or event.get("default_tz") or ""
    number = contact.get("alt_phone_e164") if target == "alternate" else contact.get("phone_e164")

    if not first_name:
        refusals.append("the contact has no first name to address")
    if not number:
        refusals.append("there is no %s number on file for this contact" % target)
    elif not E164_RE.match(str(number)):
        refusals.append(
            "the %s number is not in E.164 form; PositiveContact rejects malformed "
            "numbers instead of repairing them" % target
        )

    zone = None
    if not tz_name:
        refusals.append(
            "no IANA timezone for this contact; a timezone is never inferred from a "
            "phone number, country code, or locale"
        )
    else:
        try:
            zone = ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            refusals.append("unknown IANA timezone %r" % tz_name)

    supported = policy.get("supported_locales", DEFAULT_SUPPORTED_LOCALES)
    if not locale:
        refusals.append("the contact has no locale")
    elif locale not in supported:
        refusals.append(
            "locale %r is not supported on the destination line; open a bilingual human "
            "callback rather than calling in a language the customer did not ask for"
            % locale
        )

    problems = []
    now = parse_clock(document.get("now") or datetime.now(timezone.utc).isoformat(),
                      "now", problems)
    window_start = parse_clock(event.get("window_start"), "event.window_start", problems)
    window_end = parse_clock(event.get("window_end"), "event.window_end", problems)
    cutoff = parse_clock(event.get("field_visit_cutoff"), "event.field_visit_cutoff", problems)
    refusals.extend(problems)

    quiet_start = parse_hhmm(
        (policy.get("quiet_hours_local") or {}).get("start"), DEFAULT_QUIET_START
    )
    quiet_end = parse_hhmm(
        (policy.get("quiet_hours_local") or {}).get("end"), DEFAULT_QUIET_END
    )
    override = bool(policy.get("quiet_hours_emergency_override", False))
    allowance = int(policy.get("step_allowance_minutes", DEFAULT_STEP_ALLOWANCE_MINUTES))

    quiet_note = "not evaluated"
    if zone is not None and now is not None:
        local_now = now.astimezone(zone)
        quiet = in_quiet_hours(local_now.time(), quiet_start, quiet_end)
        if quiet and not override:
            refusals.append(
                "local time %s is inside quiet hours %s to %s; schedule for the first "
                "callable minute instead"
                % (local_now.strftime("%H:%M"), quiet_start.strftime("%H:%M"),
                   quiet_end.strftime("%H:%M"))
            )
        quiet_note = "%s (%s, quiet hours are %s to %s%s)" % (
            local_now.strftime("%H:%M"),
            "inside quiet hours" if quiet else "callable",
            quiet_start.strftime("%H:%M"),
            quiet_end.strftime("%H:%M"),
            ", override ON" if override else "",
        )

    cutoff_note = "not evaluated"
    if cutoff is not None and now is not None:
        remaining = cutoff - now
        if remaining <= timedelta(0):
            refusals.append("the field-visit cutoff has already passed")
        elif remaining < timedelta(minutes=allowance):
            refusals.append(
                "this step cannot complete before the field-visit cutoff; send it "
                "straight to the field-visit queue"
            )
        total_minutes = int(remaining.total_seconds() // 60)
        cutoff_note = "%s (%dh %dm from now)" % (
            cutoff.isoformat(), total_minutes // 60, total_minutes % 60
        )

    key = "pc:%s:%s:%s:%s" % (event.get("event_id", ""), contact_id, step, target)
    if len(key) > IDEMPOTENCY_KEY_MAX_LENGTH:
        refusals.append(
            "the derived idempotency key is %d characters, over the %d character limit"
            % (len(key), IDEMPOTENCY_KEY_MAX_LENGTH)
        )

    lines.append("PositiveContact preview")
    lines.append("  contact            %s (%s)" % (contact_id, first_name or "no name"))
    lines.append("  number             %s" % mask_e164(number))
    lines.append("  timezone           %s" % (tz_name or "(missing)"))
    lines.append("  local time now     %s" % quiet_note)
    lines.append(
        "  locale             %s (%s)"
        % (locale or "(missing)", "supported" if locale in supported else "not supported")
    )
    lines.append("  step               %s, target %s" % (step, target))
    lines.append("  idempotency key    %s" % key)
    lines.append("  field-visit cutoff %s" % cutoff_note)
    lines.append(
        "  decision           %s"
        % ("OK to call" if not refusals else "DO NOT CALL")
    )
    lines.append("")

    if refusals:
        lines.append("Reasons this call must not be placed:")
        for reason in refusals:
            lines.append("  - %s" % mask_text(reason))
        lines.append("")

    locale_supported = locale in supported
    if not locale_supported:
        # There is no approved script for an unsupported locale, and printing the
        # English one would invite somebody to place the call anyway.
        lines.append(
            "No call text is rendered: there is no approved script for locale %r. "
            "Open a bilingual human callback instead." % locale
        )
        lines.append("")
    elif zone is not None and window_start is not None and window_end is not None:
        resource_center = event.get("resource_center") or {}
        task_text = TASK_TEMPLATE.format(
            organisation=event.get("organisation") or event.get("utility_name") or "the utility",
            notice=event.get("notice") or "a possible Public Safety Power Shutoff",
            first_name=first_name or "the customer",
            service_address_short=contact.get("service_address_short") or "your service address",
            window_start_local=spoken_time(window_start, zone),
            window_end_local=spoken_time(window_end, zone),
            resource_center=resource_center.get("location")
            or "the location listed on our website",
            resource_center_hours=resource_center.get("hours") or "posted at the center",
        )
        lines.append("Exact call text:")
        lines.append("-" * 72)
        for line in task_text.splitlines():
            lines.append(("  %s" % line).rstrip())
        lines.append("-" * 72)
        lines.append("")

    lines.append("This preview placed no call and opened no network connection.")
    lines.append("A real call needs an explicit, typed confirmation from a person first.")
    return lines, refusals


def main():
    try:
        document = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        sys.stderr.write("error: could not read JSON on standard input: %s\n" % exc)
        return 2
    if not isinstance(document, dict):
        sys.stderr.write("error: expected a JSON object on standard input\n")
        return 2

    lines, refusals = build_plan(document)
    rendered = "\n".join(lines)

    leaked = E164_IN_TEXT_RE.findall(rendered)
    if leaked:
        sys.stderr.write(
            "error: the preview would have printed %d unmasked phone number(s); "
            "refusing to print\n" % len(leaked)
        )
        return 2

    sys.stdout.write(rendered + "\n")
    return 1 if refusals else 0


if __name__ == "__main__":
    raise SystemExit(main())
