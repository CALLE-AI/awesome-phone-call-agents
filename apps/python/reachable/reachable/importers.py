"""CSV import, with a row-level validation report.

Five files, per docs/SPEC.md §6: pupils, contacts, register, school_calendar and
school. There is no live link to any school management information system, and
there never will be: CSV export is universal and needs no vendor's credentials.

A structural problem fails the whole import. A bad *row* is rejected with a
reason and reported, because a partial contact list is worse than none and an
office needs to know which rows to fix.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Iterable, Iterator

from .config import ConfigError, parse_clock, validate_zone
from .models import (
    CalendarDay,
    Contact,
    Dataset,
    DayType,
    Pupil,
    RegisterSession,
    School,
    SessionSlot,
)
from .phone import InvalidPhoneNumber, mask, validate_e164
from .sanitize import clean_text
from .sessions import CalendarCoverageError, missing_calendar_dates

REQUIRED_FILES = (
    "pupils.csv",
    "contacts.csv",
    "register.csv",
    "school_calendar.csv",
    "school.csv",
)

ENGLISH_LANGUAGES = frozenset({"", "en", "en-gb", "en-us", "english", "eng"})

#: National attendance marks that are not letters. "/" is present in the morning
#: session, "\" is present in the afternoon, "#" is a planned whole-school
#: closure.
VALID_NON_ALPHA_CODES = frozenset({"/", "\\", "#"})


@dataclass
class RowProblem:
    file: str
    row_number: int
    reason: str
    #: Never the offending value itself when it is a phone number: the report is
    #: shown on screen and exported.
    detail: str = ""


@dataclass
class ImportReport:
    files_read: list[str] = field(default_factory=list)
    accepted: dict[str, int] = field(default_factory=dict)
    rejected: list[RowProblem] = field(default_factory=list)
    fatal: str = ""

    @property
    def ok(self) -> bool:
        return not self.fatal

    @property
    def rejected_count(self) -> int:
        return len(self.rejected)

    def reject(self, file: str, row_number: int, reason: str, detail: str = "") -> None:
        self.rejected.append(RowProblem(file, row_number, reason, detail))

    def summary(self) -> str:
        counts = ", ".join(f"{name}: {n}" for name, n in sorted(self.accepted.items()))
        if self.fatal:
            return f"Import failed: {self.fatal}"
        tail = f"; {self.rejected_count} row(s) rejected" if self.rejected else ""
        return f"Imported {counts}{tail}"


class ImportError_(ValueError):
    """A structural problem that fails the whole import."""


def _yes(value: str | None) -> bool:
    """Anything not exactly N/NO/FALSE/0/blank is treated as yes.

    Deliberately asymmetric for the vulnerable flag: a typo must fail safe
    towards "vulnerable", never away from it.
    """
    return (value or "").strip().upper() not in {"", "N", "NO", "FALSE", "0"}


def _no(value: str | None) -> bool:
    return (value or "").strip().upper() in {"", "N", "NO", "FALSE", "0"}


def _rows(path: Path, required: Iterable[str]) -> Iterator[tuple[int, dict[str, str]]]:
    if not path.exists():
        raise ImportError_(f"missing required file: {path.name}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ImportError_(f"{path.name} has no header row")
        header = {name.strip() for name in reader.fieldnames}
        missing = [name for name in required if name not in header]
        if missing:
            raise ImportError_(f"{path.name} is missing column(s): {', '.join(missing)}")
        # Row 1 is the header, so data starts at 2 -- which is what the office
        # will see in their spreadsheet.
        for number, row in enumerate(reader, start=2):
            yield number, {(k or "").strip(): (v or "").strip() for k, v in row.items()}


def _parse_date(raw: str) -> date:
    return date.fromisoformat(raw)


def load_school(path: Path, report: ImportReport) -> School | None:
    rows = list(_rows(path, ["school_name", "timezone", "call_window_start", "call_window_end"]))
    if not rows:
        raise ImportError_("school.csv has no data row")
    if len(rows) > 1:
        raise ImportError_("school.csv must contain exactly one row; this app is single-school")
    _, row = rows[0]

    try:
        validate_zone(row["timezone"], "school.csv timezone")
        start = parse_clock(row["call_window_start"], "school.csv call_window_start")
        end = parse_clock(row["call_window_end"], "school.csv call_window_end")
    except ConfigError as exc:
        raise ImportError_(str(exc)) from exc
    if start >= end:
        raise ImportError_("school.csv call_window_start must be earlier than call_window_end")

    school = School(
        school_name=clean_text(row["school_name"], max_length=120),
        timezone=row["timezone"].strip(),
        call_window_start=row["call_window_start"].strip(),
        call_window_end=row["call_window_end"].strip(),
        first_day_process_description=clean_text(
            row.get("first_day_process_description"), max_length=400
        ),
        attendance_officer_name=clean_text(row.get("attendance_officer_name"), max_length=80),
        dsl_name=clean_text(row.get("dsl_name"), max_length=80),
    )
    report.accepted["school"] = 1
    return school


def load_pupils(path: Path, report: ImportReport) -> dict[str, Pupil]:
    pupils: dict[str, Pupil] = {}
    for number, row in _rows(path, ["pupil_id", "first_name", "last_name", "vulnerable_flag"]):
        pupil_id = row["pupil_id"]
        if not pupil_id:
            report.reject("pupils.csv", number, "missing pupil_id")
            continue
        if pupil_id in pupils:
            report.reject("pupils.csv", number, "duplicate pupil_id", pupil_id)
            continue
        if not row["first_name"]:
            report.reject("pupils.csv", number, "missing first_name", pupil_id)
            continue
        pupils[pupil_id] = Pupil(
            pupil_id=pupil_id,
            first_name=clean_text(row["first_name"], max_length=60),
            last_name=clean_text(row["last_name"], max_length=60),
            year_group=clean_text(row.get("year_group"), max_length=20),
            form_group=clean_text(row.get("form_group"), max_length=20),
            vulnerable=_yes(row["vulnerable_flag"]),
            notes_for_staff=clean_text(row.get("notes_for_staff"), max_length=400),
        )
    report.accepted["pupils"] = len(pupils)
    return pupils


def load_contacts(
    path: Path, pupils: dict[str, Pupil], report: ImportReport
) -> list[Contact]:
    contacts: list[Contact] = []
    seen: set[str] = set()
    for number, row in _rows(
        path,
        ["contact_id", "pupil_id", "contact_order", "contact_name", "phone_e164",
         "is_emergency_contact"],
    ):
        contact_id = row["contact_id"]
        if not contact_id:
            report.reject("contacts.csv", number, "missing contact_id")
            continue
        if contact_id in seen:
            report.reject("contacts.csv", number, "duplicate contact_id", contact_id)
            continue
        if row["pupil_id"] not in pupils:
            report.reject(
                "contacts.csv", number, "pupil_id does not match any pupil", row["pupil_id"]
            )
            continue
        if not row["contact_name"]:
            report.reject("contacts.csv", number, "missing contact_name", contact_id)
            continue
        try:
            order = int(row["contact_order"])
        except ValueError:
            report.reject("contacts.csv", number, "contact_order is not a number", contact_id)
            continue

        # Every number that fails E.164 is rejected here, with its reason, and
        # never repaired. It is reported masked, because the report is displayed
        # and exported.
        try:
            phone = validate_e164(row["phone_e164"])
        except InvalidPhoneNumber as exc:
            report.reject(
                "contacts.csv",
                number,
                f"invalid phone number: {exc.reason}",
                f"{contact_id} {mask(row['phone_e164'])}",
            )
            continue

        seen.add(contact_id)
        contacts.append(
            Contact(
                contact_id=contact_id,
                pupil_id=row["pupil_id"],
                contact_order=order,
                contact_name=clean_text(row["contact_name"], max_length=80),
                phone_e164=phone,
                relationship=clean_text(row.get("relationship"), max_length=40),
                language=clean_text(row.get("language"), max_length=40) or "English",
                is_emergency_contact=_yes(row["is_emergency_contact"]),
                do_not_call=not _no(row.get("do_not_call")),
            )
        )
    report.accepted["contacts"] = len(contacts)
    return contacts


def load_calendar(path: Path, report: ImportReport) -> dict[date, CalendarDay]:
    calendar: dict[date, CalendarDay] = {}
    for number, row in _rows(path, ["date", "day_type"]):
        try:
            day = _parse_date(row["date"])
        except ValueError:
            report.reject("school_calendar.csv", number, "date is not YYYY-MM-DD", row["date"])
            continue
        try:
            day_type = DayType(row["day_type"].strip().upper())
        except ValueError:
            report.reject(
                "school_calendar.csv", number, "unknown day_type", row["day_type"]
            )
            continue
        if day in calendar:
            report.reject("school_calendar.csv", number, "duplicate date", row["date"])
            continue
        calendar[day] = CalendarDay(
            day=day, day_type=day_type, note=clean_text(row.get("note"), max_length=120)
        )
    report.accepted["calendar_days"] = len(calendar)
    return calendar


def load_register(
    path: Path, pupils: dict[str, Pupil], report: ImportReport
) -> list[RegisterSession]:
    sessions: list[RegisterSession] = []
    seen: set[tuple[str, date, SessionSlot]] = set()
    for number, row in _rows(path, ["pupil_id", "date", "session", "code"]):
        if row["pupil_id"] not in pupils:
            report.reject(
                "register.csv", number, "pupil_id does not match any pupil", row["pupil_id"]
            )
            continue
        try:
            day = _parse_date(row["date"])
        except ValueError:
            report.reject("register.csv", number, "date is not YYYY-MM-DD", row["date"])
            continue
        try:
            slot = SessionSlot(row["session"].strip().upper())
        except ValueError:
            report.reject("register.csv", number, "session must be AM or PM", row["session"])
            continue
        code = row["code"].strip().upper()
        # National attendance marks are single characters but not all letters:
        # "/" is present (AM), "\" is present (PM), and "#" marks a planned
        # whole-school closure. Rejecting non-letters would throw away most of a
        # real register.
        if len(code) != 1 or not (code.isalpha() or code in VALID_NON_ALPHA_CODES):
            report.reject("register.csv", number, "code must be a single attendance mark", code)
            continue
        key = (row["pupil_id"], day, slot)
        if key in seen:
            report.reject("register.csv", number, "duplicate session for this pupil", row["date"])
            continue
        seen.add(key)
        sessions.append(
            RegisterSession(
                pupil_id=row["pupil_id"],
                session_date=day,
                slot=slot,
                code=code,
                reason_recorded=clean_text(row.get("reason_recorded"), max_length=200),
            )
        )
    report.accepted["register_sessions"] = len(sessions)
    return sessions


def load_dataset(data_dir: str | Path) -> tuple[Dataset, ImportReport]:
    """Read all five files. Returns the dataset and a report.

    On a structural problem the report carries ``fatal`` and the dataset is
    empty: nothing is half-imported.
    """
    root = Path(data_dir)
    report = ImportReport()
    try:
        missing = [name for name in REQUIRED_FILES if not (root / name).exists()]
        if missing:
            raise ImportError_(f"missing required file(s): {', '.join(missing)}")
        report.files_read = list(REQUIRED_FILES)

        school = load_school(root / "school.csv", report)
        pupils = load_pupils(root / "pupils.csv", report)
        contacts = load_contacts(root / "contacts.csv", pupils, report)
        calendar = load_calendar(root / "school_calendar.csv", report)
        sessions = load_register(root / "register.csv", pupils, report)

        # A register date the calendar does not describe is fatal, not a row
        # rejection: the session chain and the statutory deadline both depend on
        # knowing whether that date was a school day.
        gaps = missing_calendar_dates(sessions, calendar)
        if gaps:
            raise CalendarCoverageError(gaps)

    except (ImportError_, CalendarCoverageError) as exc:
        report.fatal = str(exc)
        return Dataset(), report

    return (
        Dataset(
            school=school,
            pupils=pupils,
            contacts=contacts,
            sessions=sessions,
            calendar=calendar,
        ),
        report,
    )


def language_supported(contact: Contact) -> bool:
    """English only on UK lines.

    CALL-E lists English as the only language for GB (docs/SOURCES.md §2.8).
    Calling a family in a language they may not speak, about their child's
    absence, would be worse than not calling -- but silently skipping them would
    hide a population from the school, so this produces a staff task instead.
    """
    return contact.language.strip().lower() in ENGLISH_LANGUAGES
