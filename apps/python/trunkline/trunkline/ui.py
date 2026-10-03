"""Presentation for the local Trunkline payer-operations console.

The server exposes only JSON and one approval action. The browser turns those
records into a compact operating surface and writes every ledger value through
``textContent`` so provider-derived text is never parsed as markup.
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import hold
from .models import (
    ANSWERED,
    CLOSED,
    NEEDS_HUMAN,
    PENDING_CALL,
    PENDING_RECONCILIATION,
    QUEUED,
    Ledger,
)

REACHED_OUTCOMES = ("answered", "partial", "not_on_file")


_NODES: List[Dict[str, Any]] = [
    {
        "id": "intake",
        "kind": "start",
        "label": "Backlog imported",
        "sub": "Claims enter without patient identifiers",
        "detail": "Claims arrive with a payer, workflow, billed amount, and filing deadline. Patient identifiers remain behind an opaque vault reference.",
    },
    {
        "id": "score",
        "kind": "step",
        "label": "Priority scored",
        "sub": "Value and deadline pressure",
        "detail": "Claims closest to timely filing rise first. Work already past its deadline is suppressed because a call can no longer change the outcome.",
    },
    {
        "id": "bundle",
        "kind": "step",
        "label": "Bundled by payer",
        "sub": "One queue wait covers several claims",
        "detail": "Claims sharing a payer and workflow ride one call, up to the payer's own cap.",
    },
    {
        "id": "gate",
        "kind": "decision",
        "label": "Cleared to call",
        "sub": "Authorization and cost controls",
        "detail": "Calling window, hold budget, call cap, filing deadline, reconciliation state, vault record, kill switch, and authorization are checked before dispatch.",
    },
    {
        "id": "call",
        "kind": "call",
        "label": "Payer contacted",
        "sub": "Menu, queue, hold, and representative",
        "detail": "The agent works the payer menu, waits in queue, and gathers a representative's answer. Hold is measured from transcript offsets.",
    },
    {
        "id": "ground",
        "kind": "decision",
        "label": "Evidence verified",
        "sub": "Every answer must match the transcript",
        "detail": "Structured answers are checked locally and their evidence quote must be found in the transcript. Unsupported fields return to unknown.",
    },
    {
        "id": "approve",
        "kind": "human",
        "label": "Human sign-off",
        "sub": "A biller owns the final decision",
        "detail": "Trunkline gathers and structures. A person decides whether an answer is ready to close and export.",
    },
    {
        "id": "closed",
        "kind": "end",
        "label": "Closed",
        "sub": "Exportable without patient identifiers",
        "detail": "Approved answers can be exported with claim numbers, plan answers, and supporting quotes, but no patient identifiers.",
    },
]

_EDGES = [
    {"from": "intake", "to": "score"},
    {"from": "score", "to": "bundle"},
    {"from": "bundle", "to": "gate"},
    {"from": "gate", "to": "call"},
    {"from": "call", "to": "ground"},
    {"from": "ground", "to": "approve"},
    {"from": "approve", "to": "closed"},
]


def _counts(ledger: Ledger) -> Dict[str, int]:
    by_state: Dict[str, int] = {}
    for claim in ledger.claims:
        by_state[claim.state] = by_state.get(claim.state, 0) + 1

    reached = [call for call in ledger.calls if call.outcome in REACHED_OUTCOMES]
    grounded = 0
    ungrounded = 0
    for record in ledger.calls:
        for fields in record.per_claim.values():
            if not isinstance(fields, dict):
                continue
            if fields.get("_grounded"):
                grounded += 1
            else:
                ungrounded += 1

    return {
        "intake": len(ledger.claims),
        "score": len(ledger.claims),
        "bundle": len(ledger.calls),
        "gate": len(ledger.calls),
        "call": len(reached),
        "ground": grounded,
        "approve": by_state.get(ANSWERED, 0),
        "closed": by_state.get(CLOSED, 0),
        "_queued": by_state.get(QUEUED, 0),
        "_in_flight": by_state.get(PENDING_CALL, 0) + by_state.get(PENDING_RECONCILIATION, 0),
        "_review": by_state.get(NEEDS_HUMAN, 0),
        "_ungrounded": ungrounded,
    }


def graph(ledger: Ledger) -> Dict[str, Any]:
    """Return the compact process model with counts from the current ledger."""
    counts = _counts(ledger)
    nodes = []
    for node in _NODES:
        entry = dict(node)
        entry["count"] = counts.get(node["id"], 0)
        nodes.append(entry)
    return {
        "nodes": nodes,
        "edges": _EDGES,
        "totals": {
            "claims": len(ledger.claims),
            "calls": len(ledger.calls),
            "hold_seconds": sum(call.hold_seconds for call in ledger.calls),
            "hold_human": hold.format_duration(sum(call.hold_seconds for call in ledger.calls)),
            "queued": counts["_queued"],
            "in_flight": counts["_in_flight"],
            "review": counts["_review"],
            "awaiting_approval": counts["approve"],
            "closed": counts["closed"],
            "ungrounded": counts["_ungrounded"],
        },
    }


STYLE = """
:root{
  --canvas:#f4f6f5;--surface:#ffffff;--surface-2:#f8faf9;--ink:#17201e;
  --muted:#68736f;--faint:#8b9591;--line:#dfe5e2;--line-strong:#c8d1cd;
  --sidebar:#17201e;--sidebar-2:#222c29;--sidebar-text:#f5f8f6;--sidebar-muted:#9eaaa6;
  --brand:#ff7b5f;--accent:#176b57;--accent-soft:#e5f2ed;--blue:#315fbd;--blue-soft:#eaf0fb;
  --amber:#9a6813;--amber-soft:#fbf1dc;--danger:#a5433b;--danger-soft:#f9e9e7;
  --violet:#7446a7;--magenta:#b13b91;
  --shadow:0 1px 2px rgba(20,32,28,.04),0 8px 24px rgba(20,32,28,.05);
  --radius:6px;
}
:root[data-theme="dark"]{
  --canvas:#100c1b;--surface:rgba(31,24,51,.76);--surface-2:rgba(255,255,255,.045);--ink:#f7f4ff;
  --muted:#bbb3cb;--faint:#877f9a;--line:rgba(255,255,255,.095);--line-strong:rgba(255,255,255,.17);
  --sidebar:rgba(12,9,22,.9);--sidebar-2:rgba(255,255,255,.075);--sidebar-text:#f8f5ff;--sidebar-muted:#8f879f;
  --brand:#9cff67;--accent:#64e5c4;--accent-soft:rgba(57,218,186,.12);--blue:#8aafff;--blue-soft:rgba(88,133,238,.14);
  --amber:#ffd06a;--amber-soft:rgba(255,191,76,.12);--danger:#ff83ab;--danger-soft:rgba(244,76,143,.12);
  --violet:#b782ff;--magenta:#ef63d2;
  --shadow:0 18px 55px rgba(4,2,12,.28),inset 0 1px 0 rgba(255,255,255,.035);
}
*{box-sizing:border-box;}
html,body{height:100%;}
body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.45 -apple-system,
  BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;}
button,input{font:inherit;color:inherit;}
button{letter-spacing:0;}
button:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:2px;}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;}
.num{font-variant-numeric:tabular-nums;}
.app{display:grid;grid-template-columns:224px minmax(0,1fr);grid-template-rows:64px minmax(0,1fr);height:100vh;}
.sidebar{grid-row:1/-1;background:var(--sidebar);color:var(--sidebar-text);display:flex;
  flex-direction:column;padding:19px 12px 14px;min-height:0;}
:root[data-theme="dark"] .sidebar{backdrop-filter:blur(30px) saturate(130%);box-shadow:20px 0 70px rgba(3,1,10,.18);}
.brand{height:36px;display:flex;align-items:center;gap:10px;padding:0 8px;margin-bottom:23px;}
.brandmark{width:28px;height:28px;display:grid;place-items:center;background:var(--brand);color:#17201e;
  border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);}
.brandmark svg{width:16px;height:16px;}
.brandcopy{display:flex;flex-direction:column;line-height:1.08;}
.brandcopy strong{font-size:15px;font-weight:720;}
.brandcopy span{font-size:10px;color:var(--sidebar-muted);margin-top:4px;letter-spacing:.08em;text-transform:uppercase;}
nav{display:flex;flex-direction:column;gap:4px;}
.nav-label{padding:0 10px;margin:0 0 6px;color:var(--sidebar-muted);font-size:10px;
  font-weight:700;letter-spacing:.1em;text-transform:uppercase;}
.navitem{position:relative;width:100%;height:40px;border:0;background:transparent;color:var(--sidebar-muted);
  border-radius:5px;display:flex;align-items:center;gap:11px;padding:0 10px;cursor:pointer;text-align:left;}
.navitem:hover{background:var(--sidebar-2);color:var(--sidebar-text);}
.navitem[aria-current="true"]{background:var(--sidebar-2);color:var(--sidebar-text);}
.navitem[aria-current="true"]:before{content:"";position:absolute;left:-12px;width:3px;height:22px;background:var(--brand);}
.navitem svg{width:17px;height:17px;flex:none;}
.navitem .navtext{font-size:13px;font-weight:600;}
.navitem .navcount{margin-left:auto;color:var(--sidebar-muted);font-size:10px;font-variant-numeric:tabular-nums;}
.sidebar-foot{margin-top:auto;border-top:1px solid rgba(255,255,255,.09);padding:14px 8px 3px;
  color:var(--sidebar-muted);font-size:11px;display:flex;align-items:center;gap:8px;}
header{grid-column:2;display:flex;align-items:center;gap:16px;padding:0 24px;background:var(--surface);
  border-bottom:1px solid var(--line);min-width:0;}
:root[data-theme="dark"] header{backdrop-filter:blur(28px) saturate(130%);}
.head-context{display:flex;align-items:baseline;gap:9px;min-width:0;}
.head-context strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.head-context span{font-size:12px;color:var(--faint);white-space:nowrap;}
.header-actions{margin-left:auto;display:flex;align-items:center;gap:9px;}
.workspace-state{padding-right:12px;color:var(--faint);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.header-action{height:32px;border:1px solid var(--line);border-radius:5px;background:var(--surface);
  padding:0 10px;display:flex;align-items:center;gap:7px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:620;}
.header-action:hover{border-color:var(--line-strong);color:var(--ink);}
.header-action svg{width:15px;height:15px;}
.header-action .alert-count{padding-left:7px;border-left:1px solid var(--line);color:var(--danger);font-size:10px;}
.icon-btn{width:34px;height:34px;border:1px solid var(--line);border-radius:5px;background:var(--surface);
  display:grid;place-items:center;cursor:pointer;color:var(--muted);flex:none;}
.icon-btn:hover{border-color:var(--line-strong);color:var(--ink);}
.icon-btn svg{width:16px;height:16px;}
main{position:relative;overflow:auto;min-width:0;background-color:var(--canvas);}
:root[data-theme="dark"] main:before{content:"";position:fixed;inset:64px 0 0 224px;pointer-events:none;
  background:linear-gradient(118deg,transparent 5%,rgba(31,207,226,.2) 34%,transparent 58%),
    linear-gradient(52deg,transparent 39%,rgba(234,55,207,.23) 64%,transparent 89%);
  filter:blur(68px);opacity:.9;}
.pad{position:relative;z-index:1;width:min(100%,1320px);margin:0 auto;padding:34px 34px 64px;}
.eyebrow{font-size:10.5px;font-weight:750;color:var(--accent);letter-spacing:.09em;text-transform:uppercase;margin-bottom:8px;}
.page-row{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:25px;}
.pagehead{font-size:26px;line-height:1.15;margin:0;font-weight:720;letter-spacing:0;}
.pagesub{margin:7px 0 0;color:var(--muted);max-width:700px;}
.page-actions{display:flex;align-items:center;gap:9px;flex:none;}
.btn{height:36px;border:1px solid var(--line-strong);border-radius:5px;background:var(--surface);
  padding:0 13px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-weight:650;font-size:12.5px;}
.btn:hover{border-color:var(--ink);}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
:root[data-theme="dark"] .btn.primary{color:#102019;}
.btn.primary:hover{background:#115b49;border-color:#115b49;}
.btn:disabled{opacity:.55;cursor:not-allowed;}
.btn svg{width:15px;height:15px;}
.text-btn{border:0;background:transparent;color:var(--accent);cursor:pointer;font-weight:650;font-size:12px;padding:4px 0;}
.crumb{border:0;background:transparent;color:var(--muted);cursor:pointer;padding:0;margin:0 0 18px;
  display:flex;align-items:center;gap:7px;font-size:12px;font-weight:650;}
.crumb:hover{color:var(--ink);}
.crumb svg{width:14px;height:14px;}
.metric-rail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px;}
.metric{min-height:112px;padding:19px 20px;display:grid;grid-template-columns:28px 1fr;gap:12px;align-content:center;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);backdrop-filter:blur(22px) saturate(130%);}
.metric-icon{width:28px;height:28px;display:grid;place-items:center;color:var(--muted);}
.metric-icon svg{width:16px;height:16px;}
.metric[data-tone="action"] .metric-icon{color:var(--amber);}
.metric[data-tone="danger"] .metric-icon{color:var(--danger);}
.metric[data-tone="accent"] .metric-icon{color:var(--accent);}
:root[data-theme="dark"] .metric[data-tone="action"]{background:rgba(105,57,143,.58);border-color:rgba(202,130,255,.22);}
:root[data-theme="dark"] .metric[data-tone="action"] .metric-icon{color:#dbb4ff;}
:root[data-theme="dark"] .metric[data-tone="danger"]{background:rgba(113,35,90,.5);border-color:rgba(255,102,184,.2);}
:root[data-theme="dark"] .metric[data-tone="danger"] .metric-icon{color:#ff9fcf;}
:root[data-theme="dark"] .metric[data-tone="accent"]{background:rgba(24,88,96,.48);border-color:rgba(82,229,214,.2);}
:root[data-theme="dark"] .metric[data-tone="accent"] .metric-icon{color:#75f0dc;}
:root[data-theme="dark"] .metric:not([data-tone]){background:rgba(46,51,98,.5);border-color:rgba(127,160,255,.18);}
.metric-copy b{display:block;font-size:22px;line-height:1.05;font-weight:720;font-variant-numeric:tabular-nums;}
.metric-copy span{display:block;margin-top:7px;color:var(--muted);font-size:11.5px;}
.overview-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.8fr);gap:18px;margin-bottom:18px;}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);
  min-width:0;backdrop-filter:blur(24px) saturate(135%);}
.panel-head{min-height:56px;padding:0 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;}
.panel-head h2{margin:0;font-size:13px;font-weight:720;}
.panel-head p{margin:2px 0 0;color:var(--faint);font-size:11.5px;}
.panel-head .text-btn{margin-left:auto;}
.attention-list{display:flex;flex-direction:column;}
.attention-row{width:100%;min-height:66px;border:0;border-bottom:1px solid var(--line);background:transparent;
  display:grid;grid-template-columns:minmax(0,1.3fr) minmax(120px,.75fr) 92px 28px;align-items:center;
  gap:14px;padding:10px 17px;text-align:left;cursor:pointer;}
.attention-row:last-child{border-bottom:0;}
.attention-row:hover{background:var(--surface-2);}
.row-primary{min-width:0;}
.row-primary strong{display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.row-primary span{display:block;margin-top:4px;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.row-secondary{font-size:11.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.row-amount{text-align:right;font-size:12px;font-weight:680;font-variant-numeric:tabular-nums;}
.row-chevron{display:grid;place-items:center;color:var(--faint);}
.row-chevron svg{width:15px;height:15px;}
.health-body{padding:8px 18px 15px;}
.health-row{min-height:55px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;}
.health-row:last-child{border-bottom:0;}
.health-ico{width:26px;height:26px;display:grid;place-items:center;color:var(--accent);}
.health-ico.warn{color:var(--danger);}
.health-ico svg{width:13px;height:13px;}
.health-copy strong{display:block;font-size:12px;}
.health-copy span{display:block;color:var(--faint);font-size:11px;margin-top:2px;}
.health-value{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;}
.process-panel{margin-bottom:18px;overflow:hidden;}
.process-strip{display:grid;grid-template-columns:repeat(7,minmax(118px,1fr));overflow-x:auto;}
.process-stage{position:relative;min-width:118px;min-height:104px;border:0;border-right:1px solid var(--line);
  background:transparent;padding:16px 16px 15px;text-align:left;cursor:pointer;}
.process-stage:last-child{border-right:0;}
.process-stage:hover{background:var(--surface-2);}
.process-stage:after{content:"";position:absolute;right:-5px;top:49px;width:9px;height:9px;border-top:1px solid var(--line-strong);
  border-right:1px solid var(--line-strong);background:var(--surface);transform:rotate(45deg);z-index:2;}
.process-stage:last-child:after{display:none;}
.process-stage:hover:after{background:var(--surface-2);}
.process-num{display:block;color:var(--accent);font-size:19px;line-height:1;font-weight:720;font-variant-numeric:tabular-nums;}
.process-stage strong{display:block;margin-top:11px;font-size:11.5px;}
.process-stage span:last-child{display:block;margin-top:3px;color:var(--faint);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.table-tools{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px;}
.segments{display:inline-flex;border:1px solid var(--line);border-radius:5px;padding:3px;background:var(--surface);}
.segment{height:29px;border:0;border-radius:3px;background:transparent;padding:0 11px;color:var(--muted);cursor:pointer;font-size:11.5px;font-weight:650;}
.segment[aria-pressed="true"]{background:var(--ink);color:var(--surface);}
.search{position:relative;width:238px;}
.search svg{position:absolute;left:10px;top:9px;width:15px;height:15px;color:var(--faint);pointer-events:none;}
.search input{width:100%;height:34px;border:1px solid var(--line);border-radius:5px;background:var(--surface);padding:0 10px 0 32px;font-size:12px;}
.search input::placeholder{color:var(--faint);}
.tools-left{display:flex;align-items:center;gap:14px;}
.btn-sm{height:28px;padding:0 10px;font-size:11px;}
.formgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px 16px;padding:16px 18px;}
.formfield{display:flex;flex-direction:column;gap:5px;}
.formfield label{font-size:10.5px;color:var(--faint);font-weight:650;text-transform:uppercase;letter-spacing:.05em;}
.formfield input,.formfield select{height:34px;border:1px solid var(--line);border-radius:5px;
  background:var(--surface);padding:0 10px;font-size:12.5px;}
.formfield[hidden]{display:none;}
.formactions{display:flex;align-items:center;gap:12px;padding:0 18px 18px;}
.formmsg{font-size:12px;color:var(--faint);}
.formmsg.ok{color:var(--accent);}
.formmsg.bad{color:var(--danger);}
.formhint{margin:0;padding:0 18px 14px;color:var(--faint);font-size:11.5px;line-height:1.5;}
.table-wrap{overflow:auto;}
table{width:100%;border-collapse:collapse;table-layout:auto;font-size:12px;}
th,td{height:48px;padding:8px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle;white-space:nowrap;}
thead th{height:40px;background:var(--surface-2);color:var(--faint);font-size:10px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;}
tbody tr:last-child td{border-bottom:0;}
tbody tr.clickable{cursor:pointer;}
tbody tr.clickable:hover{background:var(--surface-2);}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;}
.badge{display:inline-flex;align-items:center;min-height:22px;padding:0;background:transparent;color:var(--muted);
  font-size:10px;font-weight:720;letter-spacing:.055em;text-transform:uppercase;white-space:nowrap;}
.badge:before{display:none;}
.badge.ok{background:transparent;color:var(--accent);}
.badge.warn{background:transparent;color:var(--amber);}
.badge.bad{background:transparent;color:var(--danger);}
.badge.blue{background:transparent;color:var(--blue);}
.empty{padding:46px 22px;text-align:center;color:var(--faint);}
.empty svg{display:block;width:22px;height:22px;margin:0 auto 10px;}
.review-shell{display:grid;grid-template-columns:minmax(270px,.72fr) minmax(0,1.45fr);min-height:560px;overflow:hidden;}
.review-list{border-right:1px solid var(--line);min-width:0;}
.review-list-head{height:48px;padding:0 16px;display:flex;align-items:center;border-bottom:1px solid var(--line);
  color:var(--muted);font-size:11px;font-weight:680;}
.review-choice{width:100%;min-height:70px;border:0;border-bottom:1px solid var(--line);background:transparent;
  padding:12px 15px;text-align:left;cursor:pointer;display:block;}
.review-choice:hover{background:var(--surface-2);}
.review-choice[aria-current="true"]{background:rgba(150,78,202,.16);box-shadow:inset 2px 0 var(--magenta);}
.review-choice-top{display:flex;align-items:center;gap:8px;min-width:0;}
.review-choice strong{font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.review-choice .badge{margin-left:auto;}
.review-choice p{margin:6px 0 0;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.review-detail{padding:24px 26px;min-width:0;}
.detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:19px;border-bottom:1px solid var(--line);}
.detail-head h2{font-size:18px;margin:0 0 6px;}
.detail-meta{color:var(--muted);font-size:11.5px;}
.section-label{margin:23px 0 10px;color:var(--faint);font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;}
.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--line);border-radius:5px;overflow:hidden;}
.field{min-height:59px;padding:10px 13px;border-bottom:1px solid var(--line);}
.field:nth-child(odd){border-right:1px solid var(--line);}
.field:nth-last-child(-n+2){border-bottom:0;}
.field:last-child:nth-child(odd){border-bottom:0;}
.field span{display:block;color:var(--faint);font-size:10.5px;margin-bottom:5px;text-transform:capitalize;}
.field strong{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600;word-break:break-word;}
.evidence{margin:0;padding:15px 16px;border-left:2px solid var(--accent);background:var(--accent-soft);color:var(--ink);font-size:12.5px;line-height:1.6;}
.evidence.bad{border-left-color:var(--danger);background:var(--danger-soft);color:var(--danger);}
.detail-actions{display:flex;gap:9px;align-items:center;margin-top:22px;}
.detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow);}
.detail-stat{padding:17px 18px;min-height:82px;}
.detail-stat+.detail-stat{border-left:1px solid var(--line);}
.detail-stat b{display:block;font-size:18px;font-weight:720;font-variant-numeric:tabular-nums;}
.detail-stat span{display:block;color:var(--faint);font-size:10.5px;margin-top:6px;}
.stack{display:flex;flex-direction:column;gap:12px;margin-top:14px;}
.claim-card{padding:18px 19px;}
.claim-card-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:15px;}
.claim-card-head strong{margin-right:auto;}
.kv{display:grid;grid-template-columns:minmax(150px,.45fr) minmax(0,1fr);gap:0;border-top:1px solid var(--line);}
.kv dt,.kv dd{margin:0;padding:8px 0;border-bottom:1px solid var(--line);}
.kv dt{color:var(--faint);font-size:11px;text-transform:capitalize;}
.kv dd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-word;}
.quote{margin:15px 0 0;padding:13px 15px;background:var(--accent-soft);border-left:2px solid var(--accent);font-size:12.5px;line-height:1.6;}
.alert{margin-top:14px;padding:13px 15px;border:1px solid var(--line);border-left:3px solid var(--amber);background:var(--surface);border-radius:4px;color:var(--muted);}
.alert strong{display:block;color:var(--ink);font-size:12px;margin-bottom:4px;}
.alert ul{margin:5px 0 0;padding-left:18px;}
.transcript{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;}
.turn{display:grid;grid-template-columns:62px 94px minmax(0,1fr);gap:12px;padding:10px 14px;border-bottom:1px solid var(--line);}
.turn:last-child{border-bottom:0;}
.turn.bot{background:var(--surface-2);}
.turn-time{color:var(--faint);font-size:11px;font-variant-numeric:tabular-nums;}
.turn-speaker{font-size:11px;font-weight:700;}
.turn-copy{font-size:12px;line-height:1.55;}
.holdgap{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--amber-soft);color:var(--amber);
  border-bottom:1px solid var(--line);font-size:10.5px;font-weight:720;letter-spacing:.04em;text-transform:uppercase;}
.holdgap svg{width:13px;height:13px;}
.note{color:var(--faint);font-size:11px;line-height:1.6;margin:15px 0 0;}
@media (max-width:1050px){
  .metric-rail{grid-template-columns:repeat(2,1fr);}
  .overview-grid{grid-template-columns:1fr;}
  .detail-grid{grid-template-columns:repeat(2,1fr);}
  .detail-stat:nth-child(3){border-left:0;border-top:1px solid var(--line);}
  .detail-stat:nth-child(4){border-top:1px solid var(--line);}
}
@media (max-width:780px){
  .app{grid-template-columns:1fr;grid-template-rows:56px minmax(0,1fr);padding-bottom:68px;}
  .sidebar{position:fixed;left:0;right:0;bottom:0;height:68px;z-index:20;padding:7px 8px;display:block;border-top:1px solid rgba(255,255,255,.1);}
  .brand,.nav-label,.sidebar-foot{display:none;}
  nav{display:grid;grid-template-columns:repeat(4,1fr);height:100%;gap:4px;}
  .navitem{height:54px;justify-content:center;flex-direction:column;gap:3px;padding:4px;}
  .navitem[aria-current="true"]:before{left:25%;right:25%;top:-7px;width:auto;height:3px;}
  .navitem .navtext{font-size:10px;}
  .navitem .navcount{position:absolute;right:calc(50% - 27px);top:3px;margin:0;font-size:9px;}
  header{grid-column:1;padding:0 16px;}
  main{grid-row:2;}
  :root[data-theme="dark"] main:before{inset:56px 0 68px 0;}
  .pad{padding:26px 18px 50px;}
  .review-shell{grid-template-columns:1fr;}
  .review-list{border-right:0;border-bottom:1px solid var(--line);max-height:272px;overflow:auto;}
  .review-detail{padding:20px 18px;}
}
@media (max-width:600px){
  .head-context span{display:none;}
  .header-action .header-action-label{display:none;}
  .page-row{align-items:flex-start;flex-direction:column;margin-bottom:20px;}
  .pagehead{font-size:23px;}
  .metric-rail{grid-template-columns:1fr 1fr;}
  .metric{min-height:96px;padding:14px;grid-template-columns:1fr;gap:8px;}
  .metric-icon{width:27px;height:27px;}
  .attention-row{grid-template-columns:minmax(0,1fr) 74px 24px;}
  .attention-row .row-secondary{display:none;}
  .table-tools{align-items:stretch;flex-direction:column;}
  .segments{overflow-x:auto;}
  .search{width:100%;}
  .field-grid{grid-template-columns:1fr;}
  .field:nth-child(odd){border-right:0;}
  .field:nth-last-child(-n+2){border-bottom:1px solid var(--line);}
  .field:last-child{border-bottom:0;}
  .detail-grid{grid-template-columns:1fr 1fr;}
  .detail-stat{padding:13px;}
  .turn{grid-template-columns:50px minmax(0,1fr);}
  .turn-speaker{grid-column:2;grid-row:1;}
  .turn-copy{grid-column:2;}
}
"""


ICONS = {
    "overview": "<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><rect x='14' y='14' width='7' height='7' rx='1'/>",
    "claims": "<path d='M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z'/><path d='M8 8h8M8 12h8M8 16h5'/>",
    "call": "<path d='M5 4h3l2 5-2 1.5a12 12 0 005.5 5.5L15 14l5 2v3a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z'/>",
    "review": "<circle cx='12' cy='8' r='3.5'/><path d='M5 20a7 7 0 0114 0'/><path d='M18 4l1.5 1.5L22 3'/>",
    "clock": "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
    "alert": "<path d='M12 3L2.5 20h19z'/><path d='M12 9v4M12 17h.01'/>",
    "check": "<path d='M5 12.5l4 4L19 6.5'/>",
    "shield": "<path d='M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z'/><path d='M9 12l2 2 4-4'/>",
    "search": "<circle cx='11' cy='11' r='7'/><path d='M20 20l-4-4'/>",
    "arrow": "<path d='M5 12h14M14 7l5 5-5 5'/>",
    "back": "<path d='M19 12H5M10 7l-5 5 5 5'/>",
    "sun": "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/>",
    "moon": "<path d='M20 15.2A8.5 8.5 0 118.8 4a7 7 0 0011.2 11.2z'/>",
    "file": "<path d='M6 3h8l4 4v14H6z'/><path d='M14 3v5h5M9 13h6M9 17h4'/>",
    "phone_in": "<path d='M15 3h6v6M21 3l-7 7'/><path d='M5 4h3l2 5-2 1.5a12 12 0 005.5 5.5L15 14l5 2v3a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z'/>",
    "empty": "<path d='M4 7h16v12H4z'/><path d='M8 11h8M9 3h6'/>",
    "plus": "<path d='M12 5v14M5 12h14'/>",
}


SCRIPT = r"""
'use strict';
var S={view:'overview',detail:null,graph:null,claims:[],calls:[],review:[],reviewId:null,claimFilter:'all',query:''};
var ICONS=__ICONS__;
function api(path){return fetch(path,{headers:{Accept:'application/json'}}).then(function(response){if(!response.ok)throw new Error(String(response.status));return response.json();});}
function el(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!==undefined&&text!==null)node.textContent=String(text);return node;}
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function svgIcon(name){var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.innerHTML=ICONS[name]||ICONS.file;return svg;}
function money(value){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value||0));}
function human(value){return String(value||'').replace(/_/g,' ').replace(/\b\w/g,function(letter){return letter.toUpperCase();});}
function shortDate(value){if(!value)return 'Not recorded';var date=new Date(value.length===10?value+'T00:00:00':value);if(Number.isNaN(date.getTime()))return value;return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function nodeById(id){return (S.graph.nodes||[]).find(function(node){return node.id===id;})||{count:0,sub:''};}
function activeView(){if(S.view==='claim'||S.view==='new-claim')return 'claims';if(S.view==='call')return 'calls';return S.view;}
function actionButton(label,primary,iconName,onClick){var button=el('button','btn'+(primary?' primary':''));button.type='button';if(iconName)button.appendChild(svgIcon(iconName));button.appendChild(document.createTextNode(label));if(onClick)button.addEventListener('click',onClick);return button;}
function textButton(label,onClick){var button=el('button','text-btn',label);button.type='button';button.addEventListener('click',onClick);return button;}
function initTheme(){var saved='dark';try{saved=localStorage.getItem('tl-theme')||'dark';}catch(error){}document.documentElement.setAttribute('data-theme',saved);paintTheme();document.getElementById('theme').addEventListener('click',function(){var current=document.documentElement.getAttribute('data-theme');document.documentElement.setAttribute('data-theme',current==='dark'?'light':'dark');try{localStorage.setItem('tl-theme',document.documentElement.getAttribute('data-theme'));}catch(error){}paintTheme();});}
function paintTheme(){var button=document.getElementById('theme');if(!button)return;clear(button);var dark=document.documentElement.getAttribute('data-theme')==='dark';button.appendChild(svgIcon(dark?'sun':'moon'));button.title=dark?'Use light theme':'Use dark theme';button.setAttribute('aria-label',button.title);}
function go(view,detail){S.view=view;S.detail=detail||null;var hash='#/'+view+(detail?'/'+encodeURIComponent(detail):'');if(location.hash!==hash)location.hash=hash;else render();}
function fromHash(){var parts=(location.hash||'#/overview').replace(/^#\//,'').split('/');S.view=parts[0]==='workflow'?'overview':(parts[0]||'overview');S.detail=parts[1]?decodeURIComponent(parts[1]):null;render();}
var NAV=[['overview','Overview','overview'],['claims','Claims','claims'],['calls','Call history','call'],['review','Review','review']];
function paintNav(){var totals=S.graph?S.graph.totals:{};var counts={claims:S.claims.length,calls:S.calls.length,review:(totals.review||0)+(totals.awaiting_approval||0)};var nav=document.getElementById('nav');clear(nav);nav.appendChild(el('div','nav-label','Workspace'));NAV.forEach(function(item){var button=el('button','navitem');button.type='button';button.setAttribute('aria-current',activeView()===item[0]?'true':'false');button.appendChild(svgIcon(item[2]));button.appendChild(el('span','navtext',item[1]));if(item[0]!=='overview')button.appendChild(el('span','navcount',counts[item[0]]||0));button.addEventListener('click',function(){go(item[0]);});nav.appendChild(button);});}
function paintHeader(){var totals=S.graph?S.graph.totals:{};var box=document.getElementById('header-actions');clear(box);var label=S.graph&&S.graph.public_demo?'Synthetic public demo':(S.calls.some(function(call){return call.mode==='live';})?'Live workspace':'Demo workspace');box.appendChild(el('span','workspace-state',label));var count=(totals.review||0)+(totals.awaiting_approval||0);var review=el('button','header-action');review.type='button';review.appendChild(svgIcon('review'));review.appendChild(el('span','header-action-label','Review queue'));review.appendChild(el('span','alert-count',count));review.addEventListener('click',function(){go('review');});box.appendChild(review);}
function pageIntro(parent,eyebrow,title,subtitle){parent.appendChild(el('div','eyebrow',eyebrow));var row=el('div','page-row');var copy=el('div');copy.appendChild(el('h1','pagehead',title));copy.appendChild(el('p','pagesub',subtitle));row.appendChild(copy);parent.appendChild(row);return row;}
function panelHead(title,subtitle,action){var head=el('div','panel-head');var copy=el('div');copy.appendChild(el('h2',null,title));if(subtitle)copy.appendChild(el('p',null,subtitle));head.appendChild(copy);if(action)head.appendChild(action);return head;}
function badge(state){var className='badge';var label=human(state);if(state==='answered'||state==='closed'||state==='grounded')className+=' ok';else if(state==='needs_human'||state==='partial'||state==='pending_reconciliation')className+=' warn';else if(state==='unsupported'||state==='unusable'||state==='no_quote')className+=' bad';else if(state==='pending_call')className+=' blue';return el('span',className,label);}
function emptyState(text){var box=el('div','empty');box.appendChild(svgIcon('empty'));box.appendChild(el('span',null,text));return box;}
function metric(iconName,value,label,tone){var box=el('div','metric');if(tone)box.dataset.tone=tone;var icon=el('div','metric-icon');icon.appendChild(svgIcon(iconName));box.appendChild(icon);var copy=el('div','metric-copy');copy.appendChild(el('b',null,value));copy.appendChild(el('span',null,label));box.appendChild(copy);return box;}
function reviewRow(record){var row=el('button','attention-row');row.type='button';var primary=el('div','row-primary');primary.appendChild(el('strong','mono',record.claim_number));primary.appendChild(el('span',null,record.payer+' · '+human(record.workflow)));row.appendChild(primary);row.appendChild(el('span','row-secondary',record.state==='needs_human'?'Evidence exception':'Ready for sign-off'));row.appendChild(el('span','row-amount',money(record.billed_amount)));var chevron=el('span','row-chevron');chevron.appendChild(svgIcon('arrow'));row.appendChild(chevron);row.addEventListener('click',function(){S.reviewId=record.id;go('review');});return row;}
function renderOverview(main){var pad=el('div','pad');pageIntro(pad,'Revenue cycle','Claims operations','Payer answers, evidence, and human sign-off in one operating view.');var totals=S.graph.totals;var metrics=el('section','metric-rail');metrics.appendChild(metric('review',totals.awaiting_approval||0,'Ready for sign-off','action'));metrics.appendChild(metric('alert',totals.review||0,'Needs investigation','danger'));metrics.appendChild(metric('clock',totals.hold_human||'0m','Staff hold time returned','accent'));metrics.appendChild(metric('phone_in',totals.calls||0,'Completed payer calls'));pad.appendChild(metrics);var grid=el('div','overview-grid');var attention=el('section','panel');attention.appendChild(panelHead('Attention queue','Exceptions first, then grounded answers',textButton('Open review',function(){go('review');})));var list=el('div','attention-list');var rows=S.review.slice(0,5);if(!rows.length)list.appendChild(emptyState('Nothing needs review.'));else rows.forEach(function(row){list.appendChild(reviewRow(row));});attention.appendChild(list);grid.appendChild(attention);var health=el('section','panel');health.appendChild(panelHead('Run health','Current ledger'));var body=el('div','health-body');var checks=[['shield','Evidence verified',nodeById('ground').count+' grounded answers',nodeById('ground').count,false],['alert','Evidence exceptions',(totals.ungrounded||0)+' returned to unknown',totals.ungrounded||0,(totals.ungrounded||0)>0],['clock','Pending reconciliation',(totals.in_flight||0)+' calls waiting',totals.in_flight||0,(totals.in_flight||0)>0]];checks.forEach(function(item){var row=el('div','health-row');var ico=el('div','health-ico'+(item[5]?' warn':''));ico.appendChild(svgIcon(item[0]));row.appendChild(ico);var copy=el('div','health-copy');copy.appendChild(el('strong',null,item[1]));copy.appendChild(el('span',null,item[2]));row.appendChild(copy);row.appendChild(el('span','health-value',item[3]));body.appendChild(row);});health.appendChild(body);grid.appendChild(health);pad.appendChild(grid);var process=el('section','panel process-panel');process.appendChild(panelHead('Claim path','Live counts through the controlled workflow'));var strip=el('div','process-strip');var stages=[['intake','Imported','claims'],['bundle','Bundled','calls'],['gate','Cleared','calls'],['call','Reached payer','calls'],['ground','Grounded','review'],['approve','Sign-off','review'],['closed','Closed','claims']];stages.forEach(function(stage){var button=el('button','process-stage');button.type='button';button.appendChild(el('span','process-num',nodeById(stage[0]).count));button.appendChild(el('strong',null,stage[1]));button.appendChild(el('span',null,nodeById(stage[0]).sub));button.addEventListener('click',function(){if(stage[0]==='closed')S.claimFilter='closed';go(stage[2]);});strip.appendChild(button);});process.appendChild(strip);pad.appendChild(process);var recent=el('section','panel');recent.appendChild(panelHead('Recent payer calls','Measured hold and evidence receipts',textButton('View all',function(){go('calls');})));recent.appendChild(callsTable(S.calls.slice(0,4)));pad.appendChild(recent);main.appendChild(pad);}
function placeTestCall(payerId,workflow,button){button.disabled=true;clear(button);button.appendChild(document.createTextNode('Calling…'));var params=new URLSearchParams();params.set('payer_id',payerId);params.set('workflow',workflow);fetch('/call',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Trunkline':'1'},body:params.toString()}).then(function(response){return response.json().catch(function(){return{};}).then(function(data){if(!response.ok)throw new Error(data.reasons?data.reasons.join(', '):'call failed');return data;});}).then(function(){return boot();}).then(function(){render();}).catch(function(error){button.disabled=false;clear(button);button.appendChild(document.createTextNode('Failed: '+error.message));});}
function claimsTable(rows){if(!rows.length)return emptyState('No claims match this view.');var wrap=el('div','table-wrap');var table=el('table');var head=el('thead');var header=el('tr');['Claim','Payer','Work type','Billed','Filing deadline','State','Evidence',''].forEach(function(label,index){header.appendChild(el('th',index===3?'r':null,label));});head.appendChild(header);table.appendChild(head);var body=el('tbody');rows.forEach(function(record){var row=el('tr','clickable');row.appendChild(el('td','mono',record.claim_number));row.appendChild(el('td',null,record.payer));row.appendChild(el('td',null,human(record.workflow)));row.appendChild(el('td','r',money(record.billed_amount)));row.appendChild(el('td',null,shortDate(record.filing_deadline)));var state=el('td');state.appendChild(badge(record.state));row.appendChild(state);var evidence=el('td');if(record.has_result)evidence.appendChild(badge(record.grounded?'grounded':'no_quote'));else evidence.textContent='—';row.appendChild(evidence);var actionCell=el('td');if(record.state==='queued'){var callBtn=el('button','btn btn-sm');callBtn.type='button';callBtn.appendChild(svgIcon('phone_in'));callBtn.appendChild(document.createTextNode('Call (fixture)'));callBtn.addEventListener('click',function(event){event.stopPropagation();placeTestCall(record.payer_id,record.workflow,event.currentTarget);});actionCell.appendChild(callBtn);}row.appendChild(actionCell);row.addEventListener('click',function(){go('claim',record.id);});body.appendChild(row);});table.appendChild(body);wrap.appendChild(table);return wrap;}
function filteredClaims(){var query=S.query.trim().toLowerCase();return S.claims.filter(function(record){var pass=S.claimFilter==='all'||(S.claimFilter==='action'&&(record.state==='answered'||record.state==='needs_human'))||(S.claimFilter==='exceptions'&&record.state==='needs_human')||(S.claimFilter==='closed'&&record.state==='closed');var text=(record.claim_number+' '+record.payer+' '+record.workflow).toLowerCase();return pass&&(!query||text.indexOf(query)!==-1);});}
function renderClaims(main){var pad=el('div','pad');pageIntro(pad,'Work inventory','Claims','Every payer inquiry, ordered by filing risk and value.');var tools=el('div','table-tools');var left=el('div','tools-left');var segments=el('div','segments');[['all','All'],['action','Action needed'],['exceptions','Exceptions'],['closed','Closed']].forEach(function(item){var button=el('button','segment',item[1]);button.type='button';button.setAttribute('aria-pressed',S.claimFilter===item[0]?'true':'false');button.addEventListener('click',function(){S.claimFilter=item[0];render();});segments.appendChild(button);});left.appendChild(segments);var search=el('label','search');search.appendChild(svgIcon('search'));var input=el('input');input.type='search';input.placeholder='Search claim or payer';input.value=S.query;input.addEventListener('input',function(){S.query=input.value;var body=document.getElementById('claims-table');clear(body);body.appendChild(claimsTable(filteredClaims()));});search.appendChild(input);left.appendChild(search);tools.appendChild(left);if(!(S.graph&&S.graph.public_demo))tools.appendChild(actionButton('Add claim',true,'plus',function(){go('new-claim');}));pad.appendChild(tools);var panel=el('section','panel');var body=el('div');body.id='claims-table';body.appendChild(claimsTable(filteredClaims()));panel.appendChild(body);pad.appendChild(panel);main.appendChild(pad);}
var WORKFLOW_NAMES=['claim_status','denial_reason','prior_auth_status','eligibility'];
function renderNewClaim(main){var pad=el('div','pad');pad.appendChild(backButton('claims','All claims'));pageIntro(pad,'Work inventory','Add a claim','Queues a claim for the fixture-mode call button below. No live call, no real patient data required.');var panel=el('section','panel');panel.appendChild(panelHead('Claim details','Only the identifiers each workflow is allowed to disclose are accepted.'));var payerSel=el('select');var workflowSel=el('select');WORKFLOW_NAMES.forEach(function(name){var opt=el('option');opt.value=name;opt.textContent=human(name);workflowSel.appendChild(opt);});function fieldWrap(labelText,input){var wrap=el('div','formfield');wrap.appendChild(el('label',null,labelText));wrap.appendChild(input);return wrap;}var grid=el('div','formgrid');grid.appendChild(fieldWrap('Payer',payerSel));grid.appendChild(fieldWrap('Workflow',workflowSel));var claimNumber=el('input');claimNumber.type='text';claimNumber.placeholder='CLM-2026-000123';grid.appendChild(fieldWrap('Claim number',claimNumber));var dos=el('input');dos.type='date';grid.appendChild(fieldWrap('Date of service',dos));var billed=el('input');billed.type='number';billed.step='0.01';billed.min='0';billed.placeholder='0.00';grid.appendChild(fieldWrap('Billed amount',billed));var deadline=el('input');deadline.type='date';grid.appendChild(fieldWrap('Filing deadline',deadline));var memberId=el('input');memberId.type='text';var mIdWrap=fieldWrap('Member ID',memberId);grid.appendChild(mIdWrap);var dob=el('input');dob.type='date';var dobWrap=fieldWrap('Date of birth',dob);grid.appendChild(dobWrap);var lastName=el('input');lastName.type='text';var lnWrap=fieldWrap('Patient last name',lastName);grid.appendChild(lnWrap);panel.appendChild(grid);var envelopes={};function applyEnvelope(){var allowed=envelopes[workflowSel.value]||[];lnWrap.hidden=allowed.indexOf('patient_last_name')===-1;}workflowSel.addEventListener('change',applyEnvelope);api('/api/new-claim-form').then(function(data){envelopes=data.envelopes;data.payers.forEach(function(p){var opt=el('option');opt.value=p.id;opt.textContent=p.name;payerSel.appendChild(opt);});applyEnvelope();}).catch(function(){});panel.appendChild(el('p','formhint','This claim is added to the ledger only. Placing a call still requires the "Call (fixture)" button on the Claims table — the console can run a fixture-mode call, never a live one.'));var actions=el('div','formactions');var msg=el('span','formmsg');var submit=actionButton('Add claim',true,'check',function(){msg.className='formmsg';msg.textContent='';var params=new URLSearchParams();params.set('payer_id',payerSel.value);params.set('workflow',workflowSel.value);params.set('claim_number',claimNumber.value);params.set('date_of_service',dos.value);params.set('billed_amount',billed.value);params.set('filing_deadline',deadline.value);params.set('member_id',memberId.value);params.set('date_of_birth',dob.value);params.set('patient_last_name',lastName.value);submit.disabled=true;fetch('/add-claim',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Trunkline':'1'},body:params.toString()}).then(function(response){return response.text().then(function(text){if(!response.ok)throw new Error(text);return text;});}).then(function(){return boot();}).then(function(){go('claims');}).catch(function(error){submit.disabled=false;msg.className='formmsg bad';msg.textContent=error.message;});});actions.appendChild(submit);actions.appendChild(msg);panel.appendChild(actions);pad.appendChild(panel);main.appendChild(pad);}
function callsTable(rows){if(!rows.length)return emptyState('No payer calls recorded.');var wrap=el('div','table-wrap');var table=el('table');var head=el('thead');var header=el('tr');['Payer','Work type','Outcome','Claims','Hold','Call length','Reference'].forEach(function(label){header.appendChild(el('th',null,label));});head.appendChild(header);table.appendChild(head);var body=el('tbody');rows.forEach(function(record){var row=el('tr','clickable');var payer=el('td');payer.appendChild(el('strong',null,record.payer));payer.appendChild(el('div','mono',record.phone));row.appendChild(payer);row.appendChild(el('td',null,human(record.workflow)));var outcome=el('td');outcome.appendChild(badge(record.outcome));row.appendChild(outcome);row.appendChild(el('td','num',record.claims));row.appendChild(el('td','num',record.hold_human));row.appendChild(el('td','num',record.total_human));row.appendChild(el('td','mono',record.reference_number||'Not recorded'));row.addEventListener('click',function(){go('call',record.id);});body.appendChild(row);});table.appendChild(body);wrap.appendChild(table);return wrap;}
function detailStat(value,label){var item=el('div','detail-stat');item.appendChild(el('b',null,value));item.appendChild(el('span',null,label));return item;}
function renderCalls(main){var pad=el('div','pad');pageIntro(pad,'Payer contact','Call history','Measured queue time, representative details, and transcript-backed outcomes.');var totals=S.graph.totals;var details=el('div','detail-grid');details.appendChild(detailStat(totals.calls||0,'Calls recorded'));details.appendChild(detailStat(totals.hold_human||'0m','Total hold absorbed'));details.appendChild(detailStat(nodeById('ground').count,'Grounded answers'));details.appendChild(detailStat(totals.ungrounded||0,'Evidence exceptions'));pad.appendChild(details);var panel=el('section','panel');panel.style.marginTop='18px';panel.appendChild(callsTable(S.calls));pad.appendChild(panel);main.appendChild(pad);}
function fields(parent,result){var entries=Object.keys(result||{}).filter(function(key){return key.charAt(0)!=='_'&&key!=='claim_number'&&key!=='evidence_quote';}).sort();var grid=el('div','field-grid');entries.forEach(function(key){var item=el('div','field');item.appendChild(el('span',null,human(key)));item.appendChild(el('strong',null,result[key]===null?'Not recorded':result[key]));grid.appendChild(item);});parent.appendChild(grid);}
function renderReviewDetail(parent,record){clear(parent);if(!record){parent.appendChild(emptyState('Nothing needs review.'));return;}var head=el('div','detail-head');var copy=el('div');copy.appendChild(el('h2','mono',record.claim_number));copy.appendChild(el('div','detail-meta',record.payer+' · '+human(record.workflow)+' · '+money(record.billed_amount)));head.appendChild(copy);head.appendChild(badge(record.state));parent.appendChild(head);parent.appendChild(el('div','section-label','Extracted answer'));fields(parent,record.result||{});parent.appendChild(el('div','section-label','Supporting evidence'));var quote=record.result&&record.result.evidence_quote;parent.appendChild(el('p','evidence'+(record.grounded?'':' bad'),record.grounded&&quote&&quote!=='unknown'?'“'+quote+'”':'No transcript quote supports this answer. Substantive fields were returned to unknown.'));var actions=el('div','detail-actions');if(record.call_id)actions.appendChild(actionButton('Open call',false,'phone_in',function(){go('call',record.call_id);}));if(record.state==='answered')actions.appendChild(actionButton('Approve answer',true,'check',function(event){approve(record.id,event.currentTarget);}));parent.appendChild(actions);}
function renderReview(main){var pad=el('div','pad');pageIntro(pad,'Human control','Review','Evidence exceptions first, followed by answers ready for sign-off.');if(!S.review.length){var empty=el('section','panel');empty.appendChild(emptyState('The review queue is clear.'));pad.appendChild(empty);main.appendChild(pad);return;}var selected=S.review.find(function(record){return record.id===S.reviewId;})||S.review[0];S.reviewId=selected.id;var shell=el('section','panel review-shell');var list=el('div','review-list');list.appendChild(el('div','review-list-head',S.review.length+' claims require attention'));S.review.forEach(function(record){var choice=el('button','review-choice');choice.type='button';choice.setAttribute('aria-current',record.id===selected.id?'true':'false');var top=el('div','review-choice-top');top.appendChild(el('strong','mono',record.claim_number));top.appendChild(badge(record.state));choice.appendChild(top);choice.appendChild(el('p',null,record.payer+' · '+money(record.billed_amount)));choice.addEventListener('click',function(){S.reviewId=record.id;render();});list.appendChild(choice);});shell.appendChild(list);var detail=el('div','review-detail');renderReviewDetail(detail,selected);shell.appendChild(detail);pad.appendChild(shell);main.appendChild(pad);}
function approve(id,button){button.disabled=true;clear(button);button.appendChild(document.createTextNode('Approving…'));fetch('/approve',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Trunkline':'1'},body:'claim_id='+encodeURIComponent(id)}).then(function(response){if(!response.ok)throw new Error();return boot();}).then(function(){S.reviewId=null;render();}).catch(function(){button.disabled=false;clear(button);button.appendChild(document.createTextNode('Approval failed · retry'));});}
function backButton(view,label){var button=el('button','crumb');button.type='button';button.appendChild(svgIcon('back'));button.appendChild(document.createTextNode(label));button.addEventListener('click',function(){go(view);});return button;}
function definitionList(result){var dl=el('dl','kv');Object.keys(result||{}).sort().forEach(function(key){if(key.charAt(0)==='_'||key==='claim_number'||key==='evidence_quote')return;dl.appendChild(el('dt',null,human(key)));dl.appendChild(el('dd',null,result[key]));});return dl;}
function renderClaim(main,id){var pad=el('div','pad');pad.appendChild(backButton('claims','All claims'));var record=S.claims.find(function(item){return item.id===id;});if(!record){pad.appendChild(emptyState('Claim not found.'));main.appendChild(pad);return;}api('/api/claim?id='+encodeURIComponent(id)).then(function(detail){pad.appendChild(el('div','eyebrow','Claim record'));var row=el('div','page-row');var copy=el('div');copy.appendChild(el('h1','pagehead',detail.claim_number));copy.appendChild(el('p','pagesub',detail.payer+' · '+human(detail.workflow)+' · '+money(detail.billed_amount)+' billed · files '+shortDate(detail.filing_deadline)));row.appendChild(copy);var actions=el('div','page-actions');actions.appendChild(badge(detail.state));row.appendChild(actions);pad.appendChild(row);var card=el('section','panel claim-card');var head=el('div','claim-card-head');head.appendChild(el('strong',null,'Payer response'));if(detail.has_result)head.appendChild(badge(detail.grounded?'grounded':'no_quote'));card.appendChild(head);card.appendChild(definitionList(detail.result||{}));if(detail.result&&detail.result.evidence_quote&&detail.result.evidence_quote!=='unknown')card.appendChild(el('p','quote','“'+detail.result.evidence_quote+'”'));pad.appendChild(card);var bar=el('div','detail-actions');if(detail.call_id)bar.appendChild(actionButton('Open call',false,'phone_in',function(){go('call',detail.call_id);}));if(detail.state==='answered')bar.appendChild(actionButton('Approve answer',true,'check',function(event){approve(detail.id,event.currentTarget);}));pad.appendChild(bar);}).catch(function(){pad.appendChild(emptyState('Could not load this claim.'));});main.appendChild(pad);}
function renderCall(main,id){var pad=el('div','pad');pad.appendChild(backButton('calls','Call history'));api('/api/call?id='+encodeURIComponent(id)).then(function(record){pad.appendChild(el('div','eyebrow','Call receipt'));var row=el('div','page-row');var copy=el('div');copy.appendChild(el('h1','pagehead',record.payer));copy.appendChild(el('p','pagesub',human(record.workflow)+' · '+record.phone+' · '+shortDate(record.created_at)+' · '+record.mode+' workspace'));row.appendChild(copy);var state=el('div','page-actions');state.appendChild(badge(record.outcome));row.appendChild(state);pad.appendChild(row);var stats=el('div','detail-grid');stats.appendChild(detailStat(record.hold_human,'On hold'));stats.appendChild(detailStat(record.talk_human,'With representative'));stats.appendChild(detailStat(record.total_human,'Total call'));stats.appendChild(detailStat(money(record.cost_estimate_usd),'Estimated cost'));pad.appendChild(stats);if(record.findings&&record.findings.length){var alert=el('div','alert');alert.appendChild(el('strong',null,'Verification findings'));var list=el('ul');record.findings.forEach(function(item){list.appendChild(el('li',null,item));});alert.appendChild(list);pad.appendChild(alert);}var stack=el('div','stack');record.claims.forEach(function(claim){var card=el('section','panel claim-card');var head=el('div','claim-card-head');head.appendChild(el('strong','mono',claim.claim_number));head.appendChild(badge(claim.grounded?'grounded':'no_quote'));head.appendChild(badge(claim.state));card.appendChild(head);card.appendChild(definitionList(claim.fields));if(claim.fields.evidence_quote&&claim.fields.evidence_quote!=='unknown')card.appendChild(el('p','quote','“'+claim.fields.evidence_quote+'”'));stack.appendChild(card);});pad.appendChild(stack);pad.appendChild(el('div','section-label','Transcript'));var transcript=el('section','transcript');record.transcript.forEach(function(turn){if(turn.hold_before){var gap=el('div','holdgap');gap.appendChild(svgIcon('clock'));gap.appendChild(document.createTextNode('Hold · '+turn.hold_before));transcript.appendChild(gap);}var item=el('div','turn'+(turn.speaker==='bot'?' bot':''));item.appendChild(el('span','turn-time',turn.at));item.appendChild(el('span','turn-speaker',turn.speaker==='bot'?'Trunkline':'Payer'));item.appendChild(el('span','turn-copy',turn.text));transcript.appendChild(item);});pad.appendChild(transcript);pad.appendChild(el('p','note','Patient identifiers were removed before this transcript was stored. Claim numbers remain available for reconciliation.'));}).catch(function(){pad.appendChild(emptyState('Could not load this call.'));});main.appendChild(pad);}
function render(){paintNav();paintHeader();var main=document.getElementById('main');clear(main);if(S.view==='new-claim'&&S.graph&&S.graph.public_demo)S.view='claims';if(S.view==='overview')renderOverview(main);else if(S.view==='claims')renderClaims(main);else if(S.view==='new-claim')renderNewClaim(main);else if(S.view==='calls')renderCalls(main);else if(S.view==='review')renderReview(main);else if(S.view==='claim')renderClaim(main,S.detail);else if(S.view==='call')renderCall(main,S.detail);else{S.view='overview';renderOverview(main);}}
function boot(){return Promise.all([api('/api/graph'),api('/api/claims'),api('/api/calls'),api('/api/claims?review=1')]).then(function(results){S.graph=results[0];S.claims=results[1];S.calls=results[2];S.review=results[3];document.getElementById('practice').textContent=S.graph.practice||'Practice workspace';return S.graph;});}
window.addEventListener('hashchange',fromHash);initTheme();boot().then(fromHash).catch(function(){document.getElementById('main').appendChild(emptyState('Could not read the Trunkline ledger.'));});
"""


def script() -> str:
    import json as _json

    return SCRIPT.replace("__ICONS__", _json.dumps(ICONS))


def shell() -> bytes:
    """Return the static shell; all ledger values arrive through JSON."""
    return (
        "<!doctype html><html lang='en' data-theme='dark'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta name='color-scheme' content='light dark'>"
        "<title>Trunkline · Payer operations</title><style>" + STYLE + "</style></head><body>"
        "<div class='app'><aside class='sidebar'>"
        "<div class='brand'><span class='brandmark'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 4h3l2 5-2 1.5a12 12 0 005.5 5.5L15 14l5 2v3a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z'/></svg></span>"
        "<span class='brandcopy'><strong>Trunkline</strong><span>Payer desk</span></span></div>"
        "<nav id='nav'></nav><div class='sidebar-foot'>Local review console</div></aside>"
        "<header><div class='head-context'><strong id='practice'>Practice workspace</strong><span>Payer operations</span></div>"
        "<div class='header-actions' id='header-actions'></div>"
        "<button class='icon-btn' id='theme' type='button' title='Use dark theme' aria-label='Use dark theme'></button></header>"
        "<main id='main'></main></div><script>" + script() + "</script></body></html>"
    ).encode("utf-8")
