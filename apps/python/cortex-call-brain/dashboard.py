"""Cortex — operator console for a call agent that learns from every call.

Read-only Streamlit view over the same SQLite file the campaign writes to (the
connection is opened read-only, so it can never corrupt a live run). It shows,
at a glance, that the brain is *learning*: candidate facts hardening into
canonical knowledge as distinct callers corroborate them, per-caller sub-brains
filling in, and aggregate signals crossing the staff-review line.

Design language: tactical-telemetry / Swiss-industrial. Strict monochrome, mono
+ grotesk type, hairline dividers, real Lucide line icons (no emoji), inverted
blocks for emphasis. Dark and light are both first-class — toggle up top.

    .venv/bin/streamlit run dashboard.py
    CORTEX_DB=/path/to/cortex.db .venv/bin/streamlit run dashboard.py
"""

from __future__ import annotations

import html
import json
import os
import sqlite3
import time

import streamlit as st
import streamlit.components.v1 as components

from cortex.memory import Memory
from cortex.util import mask_phone, plain as _plain, safe_json as _safe_json

DB_PATH = os.environ.get("CORTEX_DB", os.path.join(os.path.dirname(__file__), "cortex.db"))
STAFF_ALERT_MIN = int(os.environ.get("CORTEX_SIGNAL_ALERT_MIN", 2))
AUTO_MIN = int(os.environ.get("CORTEX_SIGNAL_AUTO_APPROVE_MIN", 4))
PROMOTION_MIN = int(os.environ.get("CORTEX_FACT_PROMOTION_MIN", 2))
BUDGET_USD = float(os.environ.get("CORTEX_BUDGET_USD", 5.0))


def _symptom_of(d):
    k = d.get("key", "")
    return k.split("symptom:", 1)[1] if "symptom:" in k else (d.get("description") or "")

# ---- monochrome palettes (the only two themes) ---------------------------
DARK = dict(BG="#0A0A0A", PANEL="#0F0F0F", PANEL2="#141414",
            LINE="rgba(255,255,255,0.10)", LINE2="rgba(255,255,255,0.20)",
            INK="#F2F2F2", MUTE="#8C8C8C", FAINT="#565656",
            INVBG="#F2F2F2", INVINK="#0A0A0A", TRACK="#242424", FILL="#F2F2F2",
            GRID="rgba(255,255,255,0.035)")
LIGHT = dict(BG="#F5F4F1", PANEL="#FFFFFF", PANEL2="#FBFAF8",
             LINE="rgba(0,0,0,0.12)", LINE2="rgba(0,0,0,0.24)",
             INK="#111111", MUTE="#6B6B6B", FAINT="#9A9A9A",
             INVBG="#111111", INVINK="#F5F4F1", TRACK="#E6E4DF", FILL="#111111",
             GRID="rgba(0,0,0,0.030)")

# ---- Lucide icons (extracted from the local lucide package) --------------
_P = {
    "brain": ('<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>'
              '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>'
              '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>'
              '<path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>'
              '<path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/>'
              '<path d="M19.967 17.484A4 4 0 0 1 18 18"/>'),
    "phone": ('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
              '<path d="M14.05 2a9 9 0 0 1 8 7.94"/><path d="M14.05 6A5 5 0 0 1 18 10"/>'),
    "check": '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    "shield": ('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'
               '<path d="m9 12 2 2 4-4"/>'),
    "users": ('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
              '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    "layers": ('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>'
               '<path d="m6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59"/>'
               '<path d="m6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59"/>'),
    "activity": '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    "alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "rupee": '<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>',
    "sun": ('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/>'
            '<path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    "moon": '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
}


def icon(name, size=17, sw=1.6):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" '
            f'stroke-linejoin="round" class="cx-ic">{_P[name]}</svg>')


def _conn():
    c = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def _q(conn, sql, params=()):
    try:
        return [dict(r) for r in conn.execute(sql, params)]
    except sqlite3.OperationalError:
        return []


def _ago(ts):
    if not ts:
        return "--"
    d = time.time() - float(ts)
    if d < 60:
        return f"{int(d)}s"
    if d < 3600:
        return f"{int(d // 60)}m"
    if d < 86400:
        return f"{int(d // 3600)}h"
    return f"{int(d // 86400)}d"


def esc(s):
    return html.escape(str(s if s is not None else ""))


# ==========================================================================
st.set_page_config(page_title="CORTEX — operator console", page_icon="◧", layout="wide")

# theme toggle (both are first-class)
if "theme" not in st.session_state:
    st.session_state.theme = "Dark"
tcol = st.columns([6, 1])[1]
with tcol:
    choice = st.segmented_control("theme", ["Dark", "Light"], key="theme",
                                  label_visibility="collapsed")
P = DARK if (st.session_state.theme or "Dark") == "Dark" else LIGHT

CSS_TMPL = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

.stApp {
  background:
    linear-gradient(@GRID@ 1px, transparent 1px) 0 0 / 100% 30px,
    @BG@;
  color: @INK@;
}
html, body, [class*="css"] { font-family:'Space Grotesk', -apple-system, sans-serif; }
#MainMenu, header, footer { visibility:hidden; }
.block-container { padding-top:1rem; padding-bottom:3rem; max-width:1480px; }
code, .mono { font-family:'JetBrains Mono', monospace; }
.cx-ic { display:inline-block; vertical-align:-3px; }

/* theme control — forced monochrome via aria-checked (segmented buttons only) */
button[aria-checked] {
  font-family:'JetBrains Mono',monospace !important; font-size:.66rem !important;
  letter-spacing:.16em !important; text-transform:uppercase;
  border-radius:0 !important; border:1px solid @LINE2@ !important;
  background:transparent !important; box-shadow:none !important; min-height:30px !important;
}
button[aria-checked] p { font-family:'JetBrains Mono',monospace !important; letter-spacing:.16em !important; }
button[aria-checked="false"], button[aria-checked="false"] p { color:@MUTE@ !important; }
button[aria-checked="false"]:hover { border-color:@INK@ !important; }
button[aria-checked="false"]:hover p { color:@INK@ !important; }
button[aria-checked="true"] { background:@INVBG@ !important; border-color:@INVBG@ !important; }
button[aria-checked="true"] p, button[aria-checked="true"] * { color:@INVINK@ !important; }

/* ---- masthead ---- */
.cx-top { display:flex; align-items:flex-end; gap:16px; border-bottom:1px solid @LINE2@;
  padding:6px 0 16px; margin-bottom:0; }
.cx-mark { width:46px; height:46px; border:1px solid @LINE2@; display:grid; place-items:center;
  color:@INK@; }
.cx-name { font-size:1.75rem; font-weight:700; letter-spacing:.18em; line-height:1; }
.cx-tagline { font-family:'JetBrains Mono',monospace; color:@MUTE@; font-size:.72rem;
  letter-spacing:.05em; margin-top:7px; }
.cx-status { margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:.66rem;
  letter-spacing:.12em; color:@MUTE@; text-align:right; line-height:1.9; }
.cx-status b { color:@INK@; }
.cx-live { display:inline-flex; align-items:center; gap:6px; color:@INK@; }
.cx-blip { width:6px; height:6px; background:@INK@; border-radius:50%;
  animation:cxb 1.4s ease-in-out infinite; }
@keyframes cxb { 0%,100%{opacity:.25} 50%{opacity:1} }

/* ---- KPI band ---- */
.cx-kpis { display:grid; grid-template-columns:repeat(5,1fr); border:1px solid @LINE@;
  border-top:none; }
.cx-kpi { padding:16px 18px 15px; border-right:1px solid @LINE@; position:relative; }
.cx-kpi:last-child { border-right:none; }
.cx-kpi .lbl { font-family:'JetBrains Mono',monospace; font-size:.64rem; letter-spacing:.14em;
  text-transform:uppercase; color:@MUTE@; display:flex; align-items:center; gap:7px; }
.cx-kpi .val { font-size:2.3rem; font-weight:600; letter-spacing:-.02em; margin-top:10px;
  font-variant-numeric:tabular-nums; line-height:1; }
.cx-kpi .foot { font-family:'JetBrains Mono',monospace; font-size:.64rem; color:@FAINT@;
  margin-top:8px; letter-spacing:.03em; }
.cx-kpi.inv { background:@INVBG@; color:@INVINK@; }
.cx-kpi.inv .lbl, .cx-kpi.inv .foot { color:rgba(128,128,128,.9); }
.cx-kpi .idx { position:absolute; top:12px; right:14px; font-family:'JetBrains Mono',monospace;
  font-size:.6rem; color:@FAINT@; }

/* ---- section headers ---- */
.cx-sec { font-family:'JetBrains Mono',monospace; font-size:.7rem; letter-spacing:.18em;
  text-transform:uppercase; color:@INK@; display:flex; align-items:center; gap:9px;
  padding:26px 0 4px; }
.cx-sec .n { color:@FAINT@; }
.cx-note { font-family:'JetBrains Mono',monospace; font-size:.68rem; color:@MUTE@;
  line-height:1.7; margin-bottom:13px; max-width:60ch; }
.cx-note b { color:@INK@; font-weight:600; }

/* ---- fact rows ---- */
.cx-fact { border:1px solid @LINE@; border-left:2px solid @LINE2@; padding:13px 15px;
  margin-bottom:8px; display:flex; align-items:center; gap:14px; }
.cx-fact.canon { border-left-color:@INK@; }
.cx-fact .txt { flex:1; font-size:.98rem; font-weight:500; letter-spacing:-.01em; }
.cx-fact .sub { font-family:'JetBrains Mono',monospace; font-size:.63rem; color:@MUTE@;
  letter-spacing:.04em; margin-top:5px; }
.cx-chip { font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.1em;
  padding:3px 8px; border:1px solid @LINE2@; display:inline-flex; align-items:center; gap:5px;
  white-space:nowrap; text-transform:uppercase; }
.cx-chip.inv { background:@INVBG@; color:@INVINK@; border-color:@INVBG@; }
.cx-seg { display:inline-flex; gap:3px; }
.cx-seg i { width:14px; height:5px; background:@TRACK@; display:block; }
.cx-seg i.on { background:@FILL@; }

/* ---- signal rows ---- */
.cx-sig { border:1px solid @LINE@; padding:12px 15px; margin-bottom:8px; }
.cx-sig.alert { border-color:@LINE2@; box-shadow:inset 3px 0 0 @INK@; }
.cx-sig .row { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.cx-sig .d { font-size:.9rem; font-weight:500; display:flex; align-items:center; gap:9px; }
.cx-sig .c { font-family:'JetBrains Mono',monospace; font-size:.66rem; color:@MUTE@; white-space:nowrap;
  letter-spacing:.06em; }
.cx-track { height:4px; background:@TRACK@; margin-top:11px; }
.cx-track > i { display:block; height:100%; background:@FILL@; }
.cx-tag { font-family:'JetBrains Mono',monospace; font-size:.58rem; letter-spacing:.12em;
  background:@INVBG@; color:@INVINK@; padding:2px 6px; }

/* ---- sub-brain cards ---- */
.cx-sb { border:1px solid @LINE@; padding:13px 15px; margin-bottom:8px; }
.cx-sb .h { display:flex; align-items:center; gap:9px; }
.cx-sb .nm { font-weight:600; font-size:.94rem; letter-spacing:.01em; flex:1; }
.cx-sb .when { font-family:'JetBrains Mono',monospace; font-size:.62rem; color:@FAINT@; }
.cx-sb .con { font-family:'JetBrains Mono',monospace; font-size:.56rem; letter-spacing:.1em;
  border:1px solid @LINE2@; padding:2px 6px; text-transform:uppercase; color:@MUTE@; }
.cx-sb .sum { font-size:.84rem; color:@INK@; opacity:.86; line-height:1.55; margin-top:9px; }
.cx-sb .oi { font-family:'JetBrains Mono',monospace; font-size:.64rem; color:@MUTE@; margin-top:9px;
  border-top:1px dashed @LINE@; padding-top:8px; letter-spacing:.03em; }
.cx-sb .oi b { color:@INK@; }

/* ---- call log ---- */
.cx-log { width:100%; border-collapse:collapse; font-family:'JetBrains Mono',monospace;
  font-size:.72rem; }
.cx-log th { text-align:left; color:@MUTE@; font-weight:500; letter-spacing:.1em; font-size:.6rem;
  text-transform:uppercase; padding:8px 10px; border-bottom:1px solid @LINE2@; }
.cx-log td { padding:9px 10px; border-bottom:1px solid @LINE@; color:@INK@; }
.cx-log tr:last-child td { border-bottom:none; }

.cx-empty { font-family:'JetBrains Mono',monospace; font-size:.7rem; color:@FAINT@;
  border:1px dashed @LINE@; padding:14px; text-align:center; letter-spacing:.05em; }
.cx-foot { font-family:'JetBrains Mono',monospace; font-size:.63rem; color:@FAINT@;
  border-top:1px solid @LINE@; margin-top:30px; padding-top:14px; letter-spacing:.06em;
  display:flex; gap:22px; flex-wrap:wrap; }

/* ---- admin approval panel ---- */
.cx-admin { border:1px solid @LINE2@; border-top:none; padding:16px 18px 6px; }
.cx-admin .bar { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
.cx-admin .ttl { font-family:'JetBrains Mono',monospace; font-size:.7rem; letter-spacing:.16em;
  text-transform:uppercase; color:@INK@; }
.cx-admin .pol { margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:.62rem;
  letter-spacing:.1em; color:@MUTE@; }
.cx-prop { font-size:.95rem; font-weight:500; letter-spacing:-.01em; }
.cx-prop .q { color:@INK@; }
.cx-prop .m { font-family:'JetBrains Mono',monospace; font-size:.63rem; color:@MUTE@;
  margin-top:5px; letter-spacing:.04em; }
.cx-live-d { border:1px solid @LINE@; border-left:2px solid @INK@; padding:11px 14px; margin-bottom:8px; }
.cx-live-d .q { font-size:.9rem; font-weight:500; }
.cx-live-d .m { font-family:'JetBrains Mono',monospace; font-size:.61rem; color:@MUTE@;
  margin-top:4px; letter-spacing:.06em; }

/* Streamlit buttons -> monochrome, squared, mono type */
div[data-testid="stButton"] > button {
  font-family:'JetBrains Mono',monospace !important; text-transform:uppercase;
  letter-spacing:.12em; font-size:.62rem !important; border-radius:0 !important;
  border:1px solid @LINE2@ !important; background:transparent !important; color:@INK@ !important;
  box-shadow:none !important; min-height:34px; width:100%; }
div[data-testid="stButton"] > button:hover { border-color:@INK@ !important; }
div[data-testid="stButton"] > button[kind="primary"] {
  background:@INVBG@ !important; color:@INVINK@ !important; border-color:@INVBG@ !important; }
div[data-testid="stButton"] > button[kind="primary"]:hover { opacity:.88; }
</style>
"""


def css():
    s = CSS_TMPL
    for k, v in P.items():
        s = s.replace(f"@{k}@", v)
    return s


st.markdown(css(), unsafe_allow_html=True)

# ---- load ----------------------------------------------------------------
if not os.path.exists(DB_PATH):
    st.markdown(
        f"<div class='cx-top'><div class='cx-mark'>{icon('brain',24)}</div>"
        f"<div><div class='cx-name'>CORTEX</div>"
        f"<div class='cx-tagline'>NO BRAIN AT {esc(DB_PATH)} — run seed_demo.py, then refresh</div></div></div>",
        unsafe_allow_html=True)
    st.stop()

conn = _conn()
patients = _q(conn, "SELECT * FROM patients ORDER BY updated_at DESC")
facts = _q(conn, "SELECT * FROM facts ORDER BY corroborations DESC, updated_at DESC")
signals = _q(conn, "SELECT * FROM signals ORDER BY count DESC")
calls = _q(conn, "SELECT * FROM calls ORDER BY ts DESC")

canonical = [f for f in facts if f["status"] == "canonical"]
candidate = [f for f in facts if f["status"] != "canonical"]
alerts = [s for s in signals if s["count"] >= STAFF_ALERT_MIN]
spend = sum(float(c.get("cost_usd") or 0) for c in calls)

# ---- masthead ------------------------------------------------------------
st.markdown(
    "<div class='cx-top'>"
    f"<div class='cx-mark'>{icon('brain',24)}</div>"
    "<div><div class='cx-name'>CORTEX</div>"
    "<div class='cx-tagline'>OUTBOUND CALL AGENT / TWO-TIER MEMORY / EVERY CALL TRAINS THE NEXT</div></div>"
    "<div class='cx-status'>"
    f"<span class='cx-live'><span class='cx-blip'></span>SYSTEM LIVE</span><br>"
    f"ADMIN CONSOLE · <b>{len(calls)}</b> CALLS LOGGED</div>"
    "</div>", unsafe_allow_html=True)

# ---- KPI band ------------------------------------------------------------
pct = min(100, int(spend / BUDGET_USD * 100)) if BUDGET_USD else 0
kpis = [
    ("01", "users", "Sub-brains", str(len(patients)), "CALLERS REMEMBERED", False),
    ("02", "check", "Canonical", str(len(canonical)), f"CORROBORATED ≥{PROMOTION_MIN} SRC", True),
    ("03", "clock", "Learning", str(len(candidate)), "HEARD ONCE / UNCONFIRMED", False),
    ("04", "alert", "Staff alerts", str(len(alerts)), "PATTERNS TO REVIEW", False),
    ("05", "rupee", "Spend", f"${spend:.2f}", f"{pct}% OF ${BUDGET_USD:.0f} CAP", False),
]
band = "".join(
    f"<div class='cx-kpi{' inv' if inv else ''}'><span class='idx'>{i}</span>"
    f"<div class='lbl'>{icon(ic,13)} {esc(lbl)}</div>"
    f"<div class='val'>{esc(val)}</div><div class='foot'>{esc(foot)}</div></div>"
    for i, ic, lbl, val, foot, inv in kpis)
st.markdown(f"<div class='cx-kpis'>{band}</div>", unsafe_allow_html=True)

# ---- ADMIN · PROMPT APPROVAL --------------------------------------------
# The USP: the brain PROPOSES prompt changes; strong signals auto-apply, weaker
# ones wait for an admin click. Approved patterns become proactive questions the
# agent asks on the NEXT call. This is the only write-capable part of the app.
admin = Memory(db_path=DB_PATH)
policy = admin.directive_policy()
pending = admin.pending_directives()
approved = admin.approved_directives()


def _proposal_line(sym, count):
    return (f"Ask new callers: <span class='q'>“Have you noticed any {esc(sym)}?”</span> "
            f"— and if not, remind them to contact the pharmacy if they ever do.")


st.markdown(
    "<div class='cx-admin'><div class='bar'>"
    f"{icon('shield',15)}<span class='ttl'>Admin · Prompt Approval</span>"
    f"<span class='pol'>AUTO-APPLIES AT {AUTO_MIN} CALLERS · POLICY:</span></div></div>",
    unsafe_allow_html=True)

pc1, pc2 = st.columns([3, 5])
with pc1:
    mode = st.segmented_control("policy", ["Auto", "Manual"],
                                default="Auto" if policy == "auto" else "Manual",
                                key="policy_ctl", label_visibility="collapsed")
    if mode and mode.lower() != policy:
        admin.set_setting("directive_policy", mode.lower())
        st.rerun()
with pc2:
    st.markdown(
        f"<div style='font-family:JetBrains Mono,monospace;font-size:.64rem;color:{P['MUTE']};"
        f"padding-top:6px;letter-spacing:.04em'>"
        + ("A pattern seen by ≥%d distinct callers changes the prompt on its own; "
           "2–%d wait here for your decision." % (AUTO_MIN, AUTO_MIN - 1) if policy == "auto"
           else "Every prompt change waits for your click, no matter how many callers report it.")
        + "</div>", unsafe_allow_html=True)

if pending:
    st.markdown(f"<div style='height:6px'></div>"
                f"<div class='cx-note'><b>{len(pending)} pattern(s)</b> the agent is NOT yet "
                "asking about — confirm to add each to the call script:</div>",
                unsafe_allow_html=True)
    for d in pending:
        sym = _symptom_of(d)
        col_txt, col_ok, col_no = st.columns([6, 1.3, 1.3])
        with col_txt:
            st.markdown(
                f"<div class='cx-prop'><div>{_proposal_line(sym, d['count'])}</div>"
                f"<div class='m'>REPORTED BY {d['count']} DISTINCT CALLERS · "
                f"{'RECOMMENDED' if d['count'] >= STAFF_ALERT_MIN else 'EMERGING'}</div></div>",
                unsafe_allow_html=True)
        if col_ok.button("Confirm", key=f"ok_{d['key']}", type="primary"):
            admin.approve_signal(d["key"], by="admin")
            st.toast(f"Added “{sym}” to the call script.")
            st.rerun()
        if col_no.button("Dismiss", key=f"no_{d['key']}"):
            admin.dismiss_signal(d["key"])
            st.toast(f"Dismissed “{sym}”.")
            st.rerun()

if approved:
    st.markdown("<div style='height:10px'></div>"
                f"<div class='cx-note'>{icon('check',13)} <b>Live in the call script</b> — "
                "the agent proactively asks about these:</div>", unsafe_allow_html=True)
    for d in approved:
        sym = _symptom_of(d)
        by = (d.get("approved_by") or "admin").upper()
        col_txt, col_rev = st.columns([7, 1.3])
        with col_txt:
            st.markdown(
                f"<div class='cx-live-d'><div class='q'>Asks: “Have you noticed any {esc(sym)}?”</div>"
                f"<div class='m'>{d['count']} CALLERS · CLEARED BY {esc(by)}</div></div>",
                unsafe_allow_html=True)
        if col_rev.button("Revoke", key=f"rev_{d['key']}"):
            admin.revoke_signal(d["key"])
            st.toast(f"Removed “{sym}” from the call script.")
            st.rerun()

if not pending and not approved:
    st.markdown("<div class='cx-empty'>NO PROMPT CHANGES PROPOSED YET — "
                "PATTERNS APPEAR HERE ONCE ≥2 DISTINCT CALLERS REPORT THEM</div>",
                unsafe_allow_html=True)

st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)

left, right = st.columns([3, 2], gap="large")

# ---- MASTER BRAIN --------------------------------------------------------
with left:
    st.markdown(f"<div class='cx-sec'>{icon('layers',15)}<span class='n'>A /</span> MASTER BRAIN</div>"
                "<div class='cx-note'>Knowledge shared across every call. A fact stays a "
                "<b>CANDIDATE</b> until distinct callers corroborate it — the same caller "
                "repeating themselves never counts. That gate is what makes it poison-resistant.</div>",
                unsafe_allow_html=True)

    def fact_row(f, kind):
        srcs = len(json.loads(f["sources"] or "[]"))
        corr = f["corroborations"]
        seg = "".join(f"<i class='{'on' if i < min(corr, PROMOTION_MIN) else ''}'></i>"
                      for i in range(PROMOTION_MIN))
        if kind == "canon":
            chip = f"<span class='cx-chip inv'>{icon('check',12)} CANONICAL</span>"
            sub = f"{srcs} DISTINCT SOURCES · ACTED ON IN CALLS"
        else:
            chip = f"<span class='cx-chip'>{icon('clock',12)} CANDIDATE</span>"
            sub = f"NEEDS {max(0, PROMOTION_MIN - srcs)} MORE DISTINCT SOURCE(S)"
        return (f"<div class='cx-fact {kind}'>"
                f"<div><div class='txt'>{esc(f['text'])}</div><div class='sub'>{sub}</div></div>"
                f"<span class='cx-seg'>{seg}</span>{chip}</div>")

    rows = "".join(fact_row(f, "canon") for f in canonical) + \
           "".join(fact_row(f, "cand") for f in candidate)
    st.markdown(rows or "<div class='cx-empty'>NO FACTS LEARNED YET</div>", unsafe_allow_html=True)

    st.markdown(f"<div class='cx-sec'>{icon('alert',15)}<span class='n'>B /</span> AGGREGATE SIGNALS → STAFF</div>"
                "<div class='cx-note'>Anonymized patterns across callers — never attributed to a "
                f"person. Crosses the review line at <b>{STAFF_ALERT_MIN}</b>.</div>",
                unsafe_allow_html=True)
    if signals:
        approved_keys = {d["key"] for d in approved}
        sig_html = ""
        for s in signals:
            hot = s["count"] >= STAFF_ALERT_MIN
            frac = min(1.0, s["count"] / max(AUTO_MIN, 1))
            tags = ""
            if s["key"] in approved_keys:
                tags += "<span class='cx-tag'>IN SCRIPT</span> "
            if hot:
                tags += "<span class='cx-tag'>ALERT</span>"
            sig_html += (
                f"<div class='cx-sig{' alert' if hot else ''}'>"
                f"<div class='row'><div class='d'>{icon('activity',14)}"
                f"{esc(s['description'])} {tags}</div>"
                f"<div class='c'>{s['count']} / {AUTO_MIN} to auto-apply</div></div>"
                f"<div class='cx-track'><i style='width:{int(frac*100)}%'></i></div></div>")
        st.markdown(sig_html, unsafe_allow_html=True)
    else:
        st.markdown("<div class='cx-empty'>NO SIGNALS YET</div>", unsafe_allow_html=True)

# ---- SUB-BRAINS + CALL LOG -----------------------------------------------
with right:
    st.markdown(f"<div class='cx-sec'>{icon('users',15)}<span class='n'>C /</span> SUB-BRAINS · PER CALLER</div>"
                "<div class='cx-note'>Private memory (summary + open items). PII lives only here, "
                "never in the master brain — and can be force-forgotten.</div>",
                unsafe_allow_html=True)
    if patients:
        sb = ""
        for p in patients:
            items = json.loads(p["open_items"] or "[]")
            con = "CONSENTED" if p["consent"] else "NO CONSENT"
            oi = ("<div class='oi'><b>NEXT →</b> " + " · ".join(esc(i) for i in items) + "</div>") if items else ""
            cb = p.get("callback_reason")
            cbline = (f"<div class='oi'><b>CALLBACK →</b> open next call by asking how "
                      f"“{esc(cb)}” went</div>") if cb else ""
            sb += (f"<div class='cx-sb'><div class='h'>{icon('phone',15)}"
                   f"<span class='nm'>{esc(p['name'] or mask_phone(p['phone']))}</span>"
                   f"<span class='con'>{con}</span><span class='when'>{_ago(p['last_call_ts'] or p['updated_at'])} ago</span></div>"
                   f"<div class='sum'>{esc(p['summary'] or 'No summary yet.')}</div>{cbline}{oi}</div>")
        st.markdown(sb, unsafe_allow_html=True)
    else:
        st.markdown("<div class='cx-empty'>NO CALLERS YET</div>", unsafe_allow_html=True)

    st.markdown(f"<div class='cx-sec'>{icon('phone',15)}<span class='n'>D /</span> CALL LOG</div>",
                unsafe_allow_html=True)
    if calls:
        body = "".join(
            f"<tr><td>{_ago(c['ts'])} ago</td><td>{esc(mask_phone(c['phone']))}</td>"
            f"<td>{esc(c['outcome'])}</td><td>${float(c.get('cost_usd') or 0):.2f}</td></tr>"
            for c in calls)
        st.markdown(f"<table class='cx-log'><thead><tr><th>WHEN</th><th>NUMBER</th>"
                    f"<th>OUTCOME</th><th>COST</th></tr></thead><tbody>{body}</tbody></table>",
                    unsafe_allow_html=True)
    else:
        st.markdown("<div class='cx-empty'>NO CALLS RECORDED</div>", unsafe_allow_html=True)

# ---- E / BRAIN MAP -------------------------------------------------------
# The Obsidian-style picture of the whole thing: one MASTER brain at the centre,
# a sub-brain per caller orbiting it, and edges showing who taught the brain what.
import re as _re


def _fact_label(text):
    m = _re.search(r"cause (.+?) in some", text or "")
    return (m.group(1) if m else (text or ""))[:20]


# _plain and _safe_json now live in cortex.util (imported above) so they can be
# unit-tested without importing this Streamlit module.


def brain_graph_html(pal, pats, fcts, source_id):
    nodes = [{"id": "MASTER", "label": "MASTER\nBRAIN", "shape": "circle", "margin": 16,
              "color": {"background": pal["INK"], "border": pal["INK"]}, "borderWidth": 0,
              "font": {"color": pal["BG"], "size": 15, "face": "JetBrains Mono"}}]
    edges = []
    for f in fcts:
        fid = f"F{f['id']}"
        canon = f["status"] == "canonical"
        nodes.append({
            "id": fid, "label": _fact_label(f["text"]), "shape": "diamond",
            "size": 15 if canon else 11,
            "color": {"background": pal["INK"] if canon else pal["BG"],
                      "border": pal["INK"] if canon else pal["MUTE"]},
            "borderWidth": 0 if canon else 1.5,
            "font": {"color": pal["MUTE"], "size": 11, "face": "JetBrains Mono"},
            "title": _plain(f"{f['text']} ({f['status']}, {f['corroborations']}x)")})
        edges.append({"from": "MASTER", "to": fid, "width": 1.6 if canon else 1,
                      "dashes": not canon,
                      "color": {"color": pal["INK"] if canon else pal["MUTE"]}})
    for p in pats:
        pid = f"P{source_id(p['phone'])}"  # keyed HMAC — no reversible number in the DOM
        nodes.append({
            "id": pid, "label": p["name"] or mask_phone(p["phone"]), "shape": "dot", "size": 19,
            "color": {"background": pal["PANEL"], "border": pal["INK"]}, "borderWidth": 2,
            "font": {"color": pal["INK"], "size": 12, "face": "JetBrains Mono"},
            "title": _plain(p["summary"] or "")})
        edges.append({"from": "MASTER", "to": pid, "width": 1.4,
                      "color": {"color": pal["LINE2"]}})
        h = source_id(p["phone"])
        for f in fcts:
            if h in set(json.loads(f["sources"] or "[]")):
                edges.append({"from": pid, "to": f"F{f['id']}", "width": 1,
                              "dashes": [2, 3], "color": {"color": pal["FAINT"]}})
    H = 540
    tmpl = """<html><head>
<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap');
html,body{margin:0;background:@BG@;height:100%;overflow:hidden;}#net{width:100%;height:@H@px;}</style>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js" integrity="sha384-yxKDWWf0wwdUj/gPeuL11czrnKFQROnLgY8ll7En9NYoXibgg3C6NK/UDHNtUgWJ" crossorigin="anonymous"></script>
</head><body><div id="net"></div><script>
var nodes=new vis.DataSet(@NODES@), edges=new vis.DataSet(@EDGES@);
var opts={physics:{barnesHut:{gravitationalConstant:-4200,springLength:135,springConstant:0.03,damping:0.4},stabilization:{iterations:200}},
interaction:{hover:true,tooltipDelay:120,zoomView:true,dragView:true},edges:{smooth:{type:'continuous'}}};
var net=new vis.Network(document.getElementById('net'),{nodes:nodes,edges:edges},opts);
net.once('stabilizationIterationsDone',function(){net.fit({animation:{duration:400}});});
</script></body></html>"""
    return (tmpl.replace("@BG@", pal["BG"]).replace("@H@", str(H))
            .replace("@NODES@", _safe_json(nodes)).replace("@EDGES@", _safe_json(edges))), H


st.markdown(f"<div class='cx-sec'>{icon('brain',15)}<span class='n'>E /</span> BRAIN MAP · "
            "ONE BRAIN, MANY SUB-BRAINS</div>"
            "<div class='cx-note'>The whole system at a glance: the <b>master brain</b> at the "
            "centre, a <b>sub-brain per caller</b> around it, and dashed lines showing which "
            "callers taught which facts. Filled diamonds are canonical; hollow are candidates. "
            "Drag to explore.</div>", unsafe_allow_html=True)
if patients or facts:
    _html, _h = brain_graph_html(P, patients, facts, admin.source_id)
    components.html(_html, height=_h + 6, scrolling=False)
else:
    st.markdown("<div class='cx-empty'>BRAIN MAP APPEARS AFTER THE FIRST CALL</div>",
                unsafe_allow_html=True)

st.markdown(
    "<div class='cx-foot'>"
    f"<span>{icon('shield',13)} CORROBORATION GATE</span>"
    "<span>ANONYMIZED SIGNALS</span><span>RIGHT-TO-FORGET</span>"
    "<span>HUMAN-IN-THE-LOOP PROMPT CONTROL</span><span>PRESS R TO REFRESH</span></div>",
    unsafe_allow_html=True)
