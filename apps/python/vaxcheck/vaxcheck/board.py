"""Immunisation-day board: the roster as a single self-contained HTML page.

The text report is for a terminal; this is for the school nurse's laptop at
7 a.m. Same data, same rules, same ordering: the review queue first, the settled
rows last, and the nurse's line at the bottom of every board.

No JavaScript, no external assets. Phone numbers arrive already masked.
"""

from __future__ import annotations

import html
import json
from typing import Any

from .triage import CLEARED, DECLINED, NURSE_REVIEW, PRIVATE_PROVIDER, UNREACHABLE

_ORDER = [NURSE_REVIEW, UNREACHABLE, PRIVATE_PROVIDER, DECLINED, CLEARED]
_LABEL = {
    NURSE_REVIEW: "Nurse review required",
    UNREACHABLE: "Not reached · retry",
    PRIVATE_PROVIDER: "Own doctor · do not vaccinate",
    DECLINED: "Declined · do not vaccinate",
    CLEARED: "Cleared for session",
}
_TONE = {
    NURSE_REVIEW: "review",
    UNREACHABLE: "retry",
    PRIVATE_PROVIDER: "settled",
    DECLINED: "settled",
    CLEARED: "clear",
}
_FIELD_LABEL = {
    "consent": "Consent",
    "route": "Route",
    "allergy_reported": "Allergy",
    "allergy_detail": "Allergy detail",
    "prior_dose_reported": "Prior dose",
    "prior_dose_detail": "Prior dose detail",
    "unwell_today": "Unwell today",
    "guardian_questions": "Guardian asked",
    "callback_requested": "Callback requested",
    "identity_confirmed": "Identity confirmed",
    "reached_guardian": "Reached",
}

CSS = """
:root{--paper:#FAF7EF;--paper2:#F1EBDD;--ink:#111111;--amber:#F2B640;--teal:#8FD3C0;--coral:#F28B6E;--grey:#D8D2C4;--shadow:#111111}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.4 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 32px 72px;position:relative}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:22px;border-bottom:5px solid var(--ink)}
.brand{font-weight:800;font-size:28px;letter-spacing:-.01em;background:var(--ink);color:var(--paper);padding:10px 18px;border:4px solid var(--ink);box-shadow:6px 6px 0 var(--amber);transform:rotate(-2deg)}
.session h1{font-size:46px;font-weight:800;margin:0 0 8px;letter-spacing:-.03em;line-height:1}
.session .meta{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.counts{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;margin:30px 0 38px}
.count{background:#fff;border:4px solid var(--ink);box-shadow:7px 7px 0 var(--shadow);padding:16px 16px 14px}
.count b{display:block;font-size:56px;font-weight:800;line-height:.95;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.count span{display:block;margin-top:10px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.count.review{background:var(--amber)} .count.clear{background:var(--teal)} .count.retry{background:var(--paper2)}
section{margin-top:34px}
h2{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 14px;display:flex;align-items:center;gap:10px}
h2 .n{background:var(--ink);color:var(--paper);padding:3px 10px;border:3px solid var(--ink)}
.card{background:#fff;border:4px solid var(--ink);box-shadow:8px 8px 0 var(--shadow);padding:18px 22px 20px;margin-bottom:22px;display:grid;grid-template-columns:1fr 1.4fr;gap:10px 28px;position:relative}
.tag{position:absolute;top:-16px;left:18px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:4px 10px;border:3px solid var(--ink);background:var(--paper2)}
.card.review .tag{background:var(--amber)} .card.clear .tag{background:var(--teal)} .card.retry .tag{background:var(--grey)} .card.settled .tag{background:#fff}
.who{font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1.05;padding-top:6px}
.who small{display:block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;font-weight:600;margin-top:8px;letter-spacing:.02em}
.reasons{margin:0;padding:8px 0 0;list-style:none}
.reasons li{padding-left:22px;position:relative;margin:4px 0;font-weight:600;font-size:18px}
.reasons li::before{content:"";position:absolute;left:0;top:.45em;width:11px;height:11px;background:var(--ink)}
.card.review .reasons li::before{background:var(--amber);outline:3px solid var(--ink)}
.reported{grid-column:1/-1;border-top:3px solid var(--ink);padding-top:14px;margin-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 18px}
.reported div{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.reported div b{display:block;font-family:"Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;font-size:19px;font-weight:800;text-transform:none;letter-spacing:-.01em;margin-top:3px;line-height:1.2}
.reported div.flag b{background:var(--amber);display:inline;padding:1px 6px;box-decoration-break:clone;-webkit-box-decoration-break:clone;border:2px solid var(--ink)}
.conf{position:absolute;right:16px;top:-16px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;font-weight:700;background:#fff;border:3px solid var(--ink);padding:4px 10px;letter-spacing:.06em}
.checks{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.check{background:#fff;border:4px solid var(--ink);box-shadow:6px 6px 0 var(--shadow);padding:14px 16px;display:grid;grid-template-columns:84px 1fr;gap:14px;align-items:center}
.check b{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;font-weight:800;letter-spacing:.1em;padding:6px 0;text-align:center;border:3px solid var(--ink)}
.check.pass b{background:var(--teal)}.check.warn b{background:var(--amber)}.check.fail b{background:var(--coral)}
.check span{font-size:17px;font-weight:700}.check span small{display:block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;font-weight:500;margin-top:3px}
.pf{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.pf div{background:#fff;border:4px solid var(--ink);box-shadow:5px 5px 0 var(--shadow);padding:12px 14px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:14px;font-weight:700;display:flex;justify-content:space-between;align-items:center}
.pf .ok,.pf .blocked{font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;border:3px solid var(--ink)}
.pf .ok{background:var(--teal)}.pf .blocked{background:var(--coral)}
footer{margin-top:46px;background:var(--ink);color:var(--paper);padding:20px 24px;font-size:20px;font-weight:700;line-height:1.35;border:4px solid var(--ink);box-shadow:8px 8px 0 var(--amber)}
"""


def _status(v: Any) -> str:
    """doctor.py reports ok/warn/fail; the board shows PASS/WARN/FAIL."""
    return {"ok": "pass", "pass": "pass", "warn": "warn"}.get(str(v).lower(), "fail")


def _esc(v: Any) -> str:
    return html.escape("" if v is None else str(v))


def _reported(result: dict[str, Any], sid: str = "") -> str:
    cells = []
    for key in ("consent", "route", "allergy_reported", "unwell_today", "prior_dose_reported",
                "callback_requested", "guardian_questions", "allergy_detail", "prior_dose_detail"):
        val = result.get(key)
        if val in (None, ""):
            continue
        flag = (key == "allergy_reported" and val in ("severe", "unsure")) or \
               (key == "unwell_today" and val in ("yes", "unsure")) or \
               (key == "prior_dose_reported" and val in ("yes", "unsure")) or \
               (key == "guardian_questions") or (key == "callback_requested" and val == "yes")
        cells.append(f'<div class="{"flag" if flag else ""}" id="cell-{_esc(sid)}-{key}">{_esc(_FIELD_LABEL.get(key, key))}<b>{_esc(str(val).replace("_", " "))}</b></div>')
    return f'<div class="reported">{"".join(cells)}</div>' if cells else ""


def _card(s: dict[str, Any]) -> str:
    tone = _TONE.get(s["disposition"], "settled")
    reasons = "".join(f"<li>{_esc(r)}</li>" for r in s.get("reasons", []))
    conf = s.get("completion_confidence")
    conf_html = f'<div class="conf">confidence {conf:.2f}</div>' if isinstance(conf, (int, float)) else ""
    tag = {"review": "Review", "clear": "Cleared", "retry": "Retry", "settled": "Settled"}[tone]
    return (
        f'<div class="card {tone}" id="card-{_esc(s["student_id"])}"><span class="tag">{tag}</span>{conf_html}'
        f'<div class="who">{_esc(s["student_name"])}<small>{_esc(s["class_name"])} · {_esc(s["student_id"])} · guardian {_esc(s["guardian_phone"])}</small></div>'
        f'<ul class="reasons">{reasons}</ul>'
        f'{_reported(s.get("result") or {}, s["student_id"])}'
        f"</div>"
    )


def render(roster: dict[str, Any], doctor: list[dict[str, Any]] | None = None,
           preflight: list[dict[str, Any]] | None = None) -> str:
    """Render the board from the JSON the CLI writes with --out."""
    sess = roster["session"]
    students = roster["students"]
    counts = roster.get("counts", {})
    by = {d: [s for s in students if s["disposition"] == d] for d in _ORDER}

    count_tiles = "".join(
        f'<div class="count {_TONE[d]}"><b>{len(by[d])}</b><span>{_esc(_LABEL[d])}</span></div>' for d in _ORDER
    )
    sections = []
    for d in _ORDER:
        if not by[d]:
            continue
        sections.append(f'<section><h2>{_esc(_LABEL[d])} <span class="n">{len(by[d])}</span></h2>{"".join(_card(s) for s in by[d])}</section>')

    live = ""
    if doctor:
        checks = "".join(
            f'<div class="check {_status(c["status"])}" id="check-{i}"><b>{_status(c["status"]).upper()}</b><span>{_esc(c["name"])}<small>{_esc(c["detail"])}</small></span></div>'
            for i, c in enumerate(doctor)
        )
        live += f'<section id="sec-readiness"><h2>Readiness · live CALL-E checks</h2><div class="checks">{checks}</div></section>'
    if preflight:
        rows = "".join(
            f'<div id="pf-{_esc(p["student_id"])}"><span>{_esc(p["student_id"])} · {_esc(p["guardian_phone"])}</span><span class="{"ok" if p["ready_to_run"] else "blocked"}">{"ready" if p["ready_to_run"] else "blocked"}</span></div>'
            for p in preflight
        )
        ready = sum(1 for p in preflight if p["ready_to_run"])
        live += f'<section id="sec-preflight"><h2>Preflight · plan_call per student <span class="n">{ready}/{len(preflight)} ready</span></h2><div class="pf">{rows}</div></section>'

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VaxCheck · {_esc(sess["school_name"])} · {_esc(sess["session_date"])}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>{CSS}</style></head>
<body><div class="wrap">
<header id="board-header"><div class="session"><h1>{_esc(sess["school_name"])}</h1><div class="meta">{_esc(sess["vaccine_name"])} · session {_esc(sess["session_date"])} · {_esc(sess["region"])}/{_esc(sess["language"])} · {len(students)} students</div></div><div class="brand">VaxCheck</div></header>
<div class="counts" id="counts">{count_tiles}</div>
{live}
{"".join(sections)}
<footer id="board-footer">No student is vaccinated on this board alone. A nurse confirms the final list, and every review row must be resolved by a person first.</footer>
</div></body></html>"""


def render_file(roster_path: str, out_path: str, doctor_path: str | None = None,
                preflight_path: str | None = None) -> None:
    roster = json.load(open(roster_path, encoding="utf-8"))
    doctor = json.load(open(doctor_path, encoding="utf-8")) if doctor_path else None
    preflight = json.load(open(preflight_path, encoding="utf-8")) if preflight_path else None
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(render(roster, doctor, preflight))
