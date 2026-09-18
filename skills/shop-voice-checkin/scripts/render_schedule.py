#!/usr/bin/env python3
"""Render scheduler entries for a shop's morning and evening check-ins.

Prints the exact lines to install, verify, disable, and remove. It never
installs anything itself — creating a recurring real-world side effect stays a
deliberate human action.

    python3 render_schedule.py --profile shop-profile.json --app-dir /srv/vsm
    python3 render_schedule.py --profile shop-profile.json --app-dir C:\\vsm --platform windows

Refs #20. Recipe and cancellation rules: ../references/scheduling.md
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PureWindowsPath

TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
JOBS = ("inventory", "sales")
LIVE_FLAGS = "--execute --confirm-recipient-opt-in"


def parse_time(value: str, label: str) -> tuple[int, int]:
    match = TIME_RE.match(value)
    if not match:
        raise SystemExit(f"{label} must be 24-hour HH:MM, got {value!r}")
    return int(match.group(1)), int(match.group(2))


def load_profile(path: Path) -> dict:
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"No shop profile at {path}") from None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from None

    for field in ("shop_id", "timezone"):
        if not profile.get(field):
            raise SystemExit(f"Shop profile is missing required field {field!r}")

    if not profile.get("recipient_consented"):
        raise SystemExit(
            "recipient_consented is not true in this profile.\n"
            "Recurring calls need recurring consent. Confirm with the owner first."
        )
    return profile


def task_name(shop_id: str, job: str) -> str:
    return f"ShopVoice-{shop_id}-{job}"


def render_cron(profile: dict, app_dir: str, python_bin: str, times: dict[str, tuple[int, int]]) -> str:
    shop_id = profile["shop_id"]
    lines = [f"CRON_TZ={profile['timezone']}"]
    for job in JOBS:
        hour, minute = times[job]
        request = f"{app_dir}/shops/{shop_id}-{job}.json"
        # The trailing marker is a shell comment. It is what makes the verify and
        # remove commands below able to find these lines.
        lines.append(
            f"{minute:2d} {hour:2d} * * * cd {app_dir} && {python_bin} client.py "
            f"--request {request} {LIVE_FLAGS} >> {app_dir}/logs/checkin.log 2>&1 "
            f"# {task_name(shop_id, job)}"
        )

    marker = f"ShopVoice-{shop_id}"
    return "\n".join([
        "# --- install: `crontab -e`, paste this block at the END ---",
        "# CRON_TZ applies to every line after it. Putting this block last keeps",
        "# it from moving your other cron jobs into the shop's timezone.",
        *lines,
        "",
        "# --- verify ---",
        f"crontab -l | grep {marker}",
        "",
        "# --- disable one job: prefix its line with # in `crontab -e` ---",
        "",
        "# --- remove both jobs for this shop (also drop CRON_TZ if no shops remain) ---",
        f"crontab -l | grep -v {marker} | crontab -",
        "",
        "# --- confirm a run happened ---",
        f"tail {app_dir}/logs/checkin.log",
    ])


def render_windows(profile: dict, app_dir: str, python_bin: str, times: dict[str, tuple[int, int]]) -> str:
    shop_id = profile["shop_id"]
    base = PureWindowsPath(app_dir)
    out = ["REM --- install ---"]

    for job in JOBS:
        hour, minute = times[job]
        name = task_name(shop_id, job)
        request = base / "shops" / f"{shop_id}-{job}.json"
        out.append(
            f'schtasks /Create /TN "{name}" /SC DAILY /ST {hour:02d}:{minute:02d} '
            f'/TR "{python_bin} {base / "client.py"} --request {request} {LIVE_FLAGS}"'
        )

    out += ["", "REM --- verify / disable / re-enable / delete ---"]
    for job in JOBS:
        name = task_name(shop_id, job)
        out += [
            f'schtasks /Query  /TN "{name}"',
            f'schtasks /Change /TN "{name}" /DISABLE',
            f'schtasks /Change /TN "{name}" /ENABLE',
            f'schtasks /Delete /TN "{name}" /F',
            "",
        ]
    return "\n".join(out).rstrip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Render check-in scheduler entries for one shop")
    parser.add_argument("--profile", type=Path, required=True, help="Shop profile JSON")
    parser.add_argument("--app-dir", required=True, help="Absolute path to the deployed app")
    parser.add_argument("--platform", choices=("cron", "windows"), default="cron")
    parser.add_argument("--python-bin", help="Absolute path to the interpreter (defaults per platform)")
    parser.add_argument("--morning", default="07:15", help="Local time of the inventory check-in")
    parser.add_argument("--evening", default="19:30", help="Local time of the sales recap")
    args = parser.parse_args()

    profile = load_profile(args.profile)
    times = {
        "inventory": parse_time(args.morning, "--morning"),
        "sales": parse_time(args.evening, "--evening"),
    }
    if times["inventory"] == times["sales"]:
        raise SystemExit("--morning and --evening must differ")

    app_dir = args.app_dir.rstrip("/\\")
    if args.platform == "cron":
        python_bin = args.python_bin or f"{app_dir}/.venv/bin/python"
        body = render_cron(profile, app_dir, python_bin, times)
    else:
        python_bin = args.python_bin or str(PureWindowsPath(app_dir) / ".venv" / "Scripts" / "python.exe")
        body = render_windows(profile, app_dir, python_bin, times)

    print(f"# Check-in schedule for {profile.get('display_name') or profile['shop_id']}")
    print(f"# Timezone {profile['timezone']} — times below are local to the shop")
    print(f"# Morning {args.morning} inventory, evening {args.evening} sales\n")
    print(body)
    print("\n# Nothing was installed. Review the lines above, then run them yourself.")
    print("# Cancellation rules: skills/shop-voice-checkin/references/scheduling.md")

    if args.platform == "windows":
        print(
            "Task Scheduler has no per-task timezone. If this machine is not in "
            f"{profile['timezone']}, convert the times before installing.",
            file=sys.stderr,
        )
    else:
        print(
            "CRON_TZ is a Linux extension. macOS ships BSD cron, which ignores it and "
            "uses system local time — convert the times yourself or use launchd.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
