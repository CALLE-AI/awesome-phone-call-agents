#!/usr/bin/env python3
"""calendar_slots.py — emit free time windows from Google or Apple Calendar.

Computes free slots (the complement of your busy events) within a date range
and prints them as JSON, ready to pipe straight into calle_booking.py
--free-slots (variant A: "book within my free windows").

Usage
-----
    calendar_slots.py --source apple   --from 2026-08-20 --days 3
    calendar_slots.py --source google  --from 2026-08-20 --days 3 --timezone Europe/London

Output (JSON)
-------------
    {
      "source": "google",
      "timezone": "Europe/London",
      "from": "2026-08-20",
      "to": "2026-08-22",
      "free_slots": [ {"start": "2026-08-20T18:30:00+01:00", "end": "..."}, ... ]
    }

Sources
-------
google — reads busy events via the google-workspace (gws) skill. Requires
         Google OAuth to be set up first (google_token.json present).
apple  — reads busy events from Calendar.app via osascript. Requires the
         terminal to have Calendar automation permission (System Settings >
         Privacy & Security > Automation). If Calendar can't be read, it
         degrades to "no events" (all free) and warns on stderr.

Options
-------
--source {apple,google}
--from YYYY-MM-DD     start date (default: today)
--days N              number of days to scan (default: 3)
--day-start HH:MM     earliest bookable time each day (default: 09:00)
--day-end HH:MM       latest bookable time each day (default: 21:00)
--timezone TZ         IANA timezone (default: system local)
--calendars LIST      [apple] comma-separated calendar names to read (default: all)
--pretty
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time as _time
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def resolve_tz(name: str | None):
    if name:
        try:
            return ZoneInfo(name)
        except Exception as exc:
            raise SystemExit(f"unknown timezone: {name!r}") from exc
    return datetime.now().astimezone().tzinfo


def parse_date(s: str) -> date:
    try:
        return date.fromisoformat(s)
    except ValueError as exc:
        raise SystemExit(f"invalid date {s!r} (expected YYYY-MM-DD)") from exc


def parse_hm(s: str) -> time:
    try:
        return time.fromisoformat(s)
    except ValueError as exc:
        raise SystemExit(f"invalid time {s!r} (expected HH:MM)") from exc


def _parse_iso(s: str, tz) -> datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt


# ---------------------------------------------------------------------------
# Google source (via the google-workspace skill)
# ---------------------------------------------------------------------------

def fetch_google_busy(start_dt: datetime, end_dt: datetime, tz) -> list:
    home = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
    gapi = os.path.join(home, "skills", "productivity", "google-workspace",
                        "scripts", "google_api.py")
    if not os.path.exists(gapi):
        raise SystemExit("google-workspace skill not found — install the skill first.")

    cmd = [sys.executable, gapi, "calendar", "list",
           "--start", start_dt.astimezone(tz).isoformat(),
           "--end", end_dt.astimezone(tz).isoformat()]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(
            "gws calendar list failed (is Google OAuth set up?).\n"
            + (r.stderr.strip() or r.stdout.strip())
        )
    try:
        events = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise SystemExit("gws returned non-JSON output:\n" + r.stdout[:400])

    busy = []
    for ev in events:
        s_raw, e_raw = ev.get("start"), ev.get("end")
        if not s_raw or not e_raw:
            continue
        if "T" not in str(s_raw):  # all-day event (date only)
            s = datetime.combine(date.fromisoformat(s_raw), time(0, 0), tzinfo=tz)
            e = datetime.combine(date.fromisoformat(e_raw), time(0, 0), tzinfo=tz)
        else:
            s = _parse_iso(s_raw, tz).astimezone(tz)
            e = _parse_iso(e_raw, tz).astimezone(tz)
        busy.append((s, e))
    return busy


# ---------------------------------------------------------------------------
# Apple source (via osascript)
# ---------------------------------------------------------------------------

def _apple_script(start_off: int, end_off: int) -> str:
    return f'''
on run
  tell application "Calendar"
    set d0 to (current date)
    set time of d0 to 0
    set s to d0 + ({start_off} * days)
    set e to d0 + ({end_off} * days)
    set out to ""
    repeat with ev in (every event whose start date ≥ s and start date < e)
      set sd to start date of ev
      set ed to end date of ev
      set out to out & (name of (calendar of ev)) & "||" & (summary of ev) & "||" & (year of sd) & "-" & ((month of sd) as integer) & "-" & (day of sd) & " " & (hours of sd) & ":" & (minutes of sd) & "||" & (year of ed) & "-" & ((month of ed) as integer) & "-" & (day of ed) & " " & (hours of ed) & ":" & (minutes of ed) & linefeed
    end repeat
    return out
  end tell
end run
'''


def _parse_apple_dt(s: str, tz) -> datetime | None:
    try:
        date_part, _, time_part = s.partition(" ")
        y, mo, d = (int(x) for x in date_part.split("-"))
        h, mi = (int(x) for x in time_part.split(":"))
        return datetime(y, mo, d, h, mi, tzinfo=tz)
    except (ValueError, TypeError):
        return None


def fetch_apple_busy(start_dt: datetime, end_dt: datetime, tz,
                     calendars: list[str] | None) -> list:
    today = datetime.now().date()
    start_off = (start_dt.date() - today).days
    end_off = (end_dt.date() - today).days
    script = _apple_script(start_off, end_off)

    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode != 0:
        # Calendar may not be running or automation may not be permitted.
        subprocess.run(["osascript", "-e", 'tell application "Calendar" to launch'],
                       capture_output=True)
        _time.sleep(1)
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if r.returncode != 0:
            print(
                "warning: cannot read Apple Calendar "
                f"({r.stderr.strip()}); treating as no events. Grant automation "
                "permission (System Settings > Privacy & Security > Automation) "
                "or open Calendar.app.",
                file=sys.stderr,
            )
            return []

    busy = []
    for line in r.stdout.splitlines():
        parts = line.split("||")
        if len(parts) != 4:
            continue
        cal_name, _summary, s_str, e_str = (p.strip() for p in parts)
        if calendars and cal_name not in calendars:
            continue
        s = _parse_apple_dt(s_str, tz)
        e = _parse_apple_dt(e_str, tz)
        if s is None or e is None:
            continue
        busy.append((s, e))
    return busy


# ---------------------------------------------------------------------------
# Free-slot computation
# ---------------------------------------------------------------------------

def compute_free_slots(busy, from_date: date, days: int,
                       day_start: time, day_end: time, tz) -> list:
    free: list[tuple[datetime, datetime]] = []
    for i in range(days):
        day = from_date + timedelta(days=i)
        day_start_dt = datetime.combine(day, day_start, tzinfo=tz)
        day_end_dt = datetime.combine(day, day_end, tzinfo=tz)

        intervals = []
        for s, e in busy:
            s = max(s.astimezone(tz), day_start_dt)
            e = min(e.astimezone(tz), day_end_dt)
            if e > s:
                intervals.append((s, e))
        intervals.sort(key=lambda x: x[0])

        cursor = day_start_dt
        for s, e in intervals:
            if cursor < s:
                free.append((cursor, s))
            if e > cursor:
                cursor = e
        if cursor < day_end_dt:
            free.append((cursor, day_end_dt))
    return free


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="calendar_slots.py",
        description="Emit free time windows from Google or Apple Calendar.",
    )
    p.add_argument("--source", choices=["apple", "google"], required=True)
    p.add_argument("--from", dest="from_", help="Start date YYYY-MM-DD (default: today)")
    p.add_argument("--days", type=int, default=3, help="Number of days to scan (default: 3)")
    p.add_argument("--day-start", default="09:00", help="Earliest bookable time HH:MM (default: 09:00)")
    p.add_argument("--day-end", default="21:00", help="Latest bookable time HH:MM (default: 21:00)")
    p.add_argument("--timezone", help="IANA timezone (default: system local)")
    p.add_argument("--calendars", help="[apple] comma-separated calendar names to read (default: all)")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    tz = resolve_tz(args.timezone)
    from_date = parse_date(args.from_) if args.from_ else datetime.now(tz).date()
    day_start = parse_hm(args.day_start)
    day_end = parse_hm(args.day_end)

    start_dt = datetime.combine(from_date, time(0, 0), tzinfo=tz)
    end_dt = datetime.combine(from_date + timedelta(days=args.days), time(0, 0), tzinfo=tz)

    if args.source == "google":
        busy = fetch_google_busy(start_dt, end_dt, tz)
    else:
        calendars = [c.strip() for c in args.calendars.split(",")] if args.calendars else None
        busy = fetch_apple_busy(start_dt, end_dt, tz, calendars)

    free = compute_free_slots(busy, from_date, args.days, day_start, day_end, tz)

    out = {
        "source": args.source,
        "timezone": str(tz),
        "from": from_date.isoformat(),
        "to": (from_date + timedelta(days=args.days - 1)).isoformat(),
        "free_slots": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in free],
    }
    print(json.dumps(out, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
