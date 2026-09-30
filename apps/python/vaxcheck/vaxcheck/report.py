"""Day-of roster rendering.

The output is designed to be read by a school nurse at 7am on session day, so
the review queue comes first and the cleared list comes last. Phone numbers are
masked in every line.
"""

from __future__ import annotations

import json
from typing import Any

from .classify import StudentRecord
from .triage import (
    CLEARED,
    DECLINED,
    NURSE_REVIEW,
    PRIVATE_PROVIDER,
    UNREACHABLE,
)

_LABEL = {
    NURSE_REVIEW: "NURSE REVIEW REQUIRED",
    UNREACHABLE: "NOT REACHED - RETRY",
    CLEARED: "CLEARED FOR SESSION",
    PRIVATE_PROVIDER: "OWN DOCTOR - DO NOT VACCINATE",
    DECLINED: "DECLINED - DO NOT VACCINATE",
}

# Review first, then everything that still needs an action, then the settled rows.
_ORDER = [NURSE_REVIEW, UNREACHABLE, PRIVATE_PROVIDER, DECLINED, CLEARED]


def to_json(records: list[StudentRecord], session: Any) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for r in records:
        counts[r.triage.disposition] = counts.get(r.triage.disposition, 0) + 1
    return {
        "session": {
            "school_name": session.school_name,
            "vaccine_name": session.vaccine_name,
            "session_date": session.session_date,
            "region": session.region,
            "language": session.language,
        },
        "counts": counts,
        "total": len(records),
        "students": [r.to_dict() for r in records],
    }


def render(records: list[StudentRecord], session: Any) -> str:
    lines: list[str] = []
    add = lines.append

    add("=" * 70)
    add(f"IMMUNISATION DAY ROSTER  -  {session.school_name}")
    add(f"{session.vaccine_name}  |  {session.session_date}")
    add("=" * 70)

    grouped: dict[str, list[StudentRecord]] = {}
    for r in records:
        grouped.setdefault(r.triage.disposition, []).append(r)

    for disposition in _ORDER:
        bucket = grouped.get(disposition)
        if not bucket:
            continue
        add("")
        add(f"--- {_LABEL.get(disposition, disposition)}  ({len(bucket)}) ---")
        for r in bucket:
            add(f"  [{r.student_id}] {r.student_name}  ({r.class_name})  {r.masked_phone}")
            for reason in r.triage.reasons:
                add(f"        - {reason}")
            detail = _detail(r)
            if detail:
                add(f"        reported: {detail}")

    add("")
    add("-" * 70)
    total = len(records)
    cleared = len(grouped.get(CLEARED, []))
    review = len(grouped.get(NURSE_REVIEW, []))
    add(f"  {total} students   {cleared} cleared   {review} need nurse review")
    for disposition in _ORDER:
        n = len(grouped.get(disposition, []))
        if n and disposition not in (CLEARED, NURSE_REVIEW):
            add(f"  {n} {_LABEL.get(disposition, disposition).lower()}")
    add("-" * 70)
    add("  No student is vaccinated on this roster alone. A nurse confirms the")
    add("  final list, and every review row must be resolved by a person first.")
    return "\n".join(lines)


def _detail(record: StudentRecord) -> str:
    r = record.result
    if not r:
        return ""
    bits = []
    if r.get("allergy_reported") and r["allergy_reported"] != "none":
        bits.append(f"allergy={r['allergy_reported']}")
        if r.get("allergy_detail"):
            bits.append(f"\"{r['allergy_detail'][:60]}\"")
    if r.get("prior_dose_reported") == "yes":
        bits.append("prior dose reported")
    if r.get("unwell_today") in ("yes", "unsure"):
        bits.append(f"unwell={r['unwell_today']}")
    if r.get("guardian_questions"):
        bits.append(f"asked: \"{r['guardian_questions'][:60]}\"")
    return "; ".join(bits)


def dumps(records: list[StudentRecord], session: Any) -> str:
    return json.dumps(to_json(records, session), indent=2, ensure_ascii=False)
