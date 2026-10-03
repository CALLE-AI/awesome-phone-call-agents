"""The one renderer behind the live review screen and the static proof page.

D3 (locked): one deterministic renderer produces both surfaces. The live
screen is what an operator sees after a call: every field with exactly one
evidence-class pill, the private transcript as a local-only link, and the
three decisions — Approve, Refuse, Return to digital — behind a CSRF
protected form. The static proof page is a byte-stable saved instance of the
same template with the decision area showing the recorded withheld state
instead of a form. A decision receipt is the same template again, after the
human has decided.

Determinism rules: no clock, no randomness, no environment reads; every
dynamic value passes through :func:`html.escape`; the page is a pure
function of its model. The same model renders byte-identically forever,
which is what makes ``--verify-proof-screen`` a real check.
"""

from __future__ import annotations

import html
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Optional

from .receipt import EvidenceClass
from .review import ReviewPacket

__all__ = [
    "DECISION_PENDING",
    "DecisionState",
    "ReviewScreenModel",
    "ScreenRow",
    "build_live_model",
    "build_static_model",
    "render_review_screen",
]

#: Decision-area modes. ``pending`` renders the form (live) or the withheld
#: state (static); the other three render a recorded decision.
DECISION_PENDING = "PENDING"

_PILL_CLASS = {
    EvidenceClass.RECORDED.value: "recorded",
    EvidenceClass.SYNTHETIC.value: "synthetic",
    EvidenceClass.FICTIONAL.value: "fictional",
}


@dataclass(frozen=True)
class ScreenRow:
    """One visible field: label, value, exactly one evidence-class pill."""

    label: str
    value: str
    pill: str
    quote: str = ""
    note: str = ""


@dataclass(frozen=True)
class DecisionState:
    """What the decision area shows."""

    mode: str = DECISION_PENDING  # PENDING | APPROVE | REFUSE | RETURN_TO_DIGITAL
    operator_id: str = ""
    decided_at: str = ""
    write_back: str = ""
    note_id: str = ""
    replayed: bool = False
    refusal: str = ""


@dataclass(frozen=True)
class ReviewScreenModel:
    """Everything the template renders. Pure data, no behaviour."""

    page_kind: str  # "live-review" | "static-proof" | "decision-receipt"
    claim_id: str
    organization: str
    counterparty: str
    amount_display: str
    situation: str
    administrator: str = ""
    #: The one runtime marker every runtime row carries. Never mixes
    #: Recorded and Synthetic inside one instance.
    runtime_marker: str = EvidenceClass.SYNTHETIC.value
    routes_exhausted: tuple[str, ...] = ()
    economics: tuple[str, ...] = ()
    before_lines: tuple[str, ...] = ()
    after_lines: tuple[str, ...] = ()
    controls: tuple[Mapping[str, str], ...] = ()
    runtime_lines: tuple[str, ...] = ()
    runtime_limitation: str = ""
    receipt_link: str = ""
    # Result rows (each pillled).
    transport_row: Optional[ScreenRow] = None
    person_row: Optional[ScreenRow] = None
    business_row: Optional[ScreenRow] = None
    status_row: Optional[ScreenRow] = None
    requirement_row: Optional[ScreenRow] = None
    reference_row: Optional[ScreenRow] = None
    terminal_row: Optional[ScreenRow] = None
    # Review plumbing.
    review_id: str = ""
    packet_sha256: str = ""
    transcript_path: str = ""
    transcript_available: bool = False
    csrf_token: str = ""
    decision: DecisionState = field(default_factory=DecisionState)
    reveal_labels: Mapping[str, str] = field(default_factory=dict[str, str])


def _row(
    label: str, value: str, pill: str, quote: str = "", note: str = ""
) -> ScreenRow:
    return ScreenRow(label=label, value=value, pill=pill, quote=quote, note=note)


def build_static_model(fixture: Mapping[str, Any]) -> ReviewScreenModel:
    """Convert the checked-in proof fixture into the static page's model.

    The fixture stays the single source of the R1 proof facts; this builder
    only arranges them into rows, assigning each row the evidence class the
    fixture's own provenance dictates: the runtime rows carry the Recorded
    marker (this page is the saved R1 instance), the claim context rows
    carry Fictional case data.
    """

    claim = fixture.get("claim") or {}
    outcome = fixture.get("outcome") or {}
    reference = outcome.get("reference") or {}
    runtime = fixture.get("runtime") or {}
    recorded = EvidenceClass.RECORDED.value
    status_value = outcome.get("claim_status", "UNKNOWN")
    stated = "not provided on the call → " + status_value
    return ReviewScreenModel(
        page_kind="static-proof",
        claim_id=str(claim.get("id", "")),
        organization=str(claim.get("organization", "")),
        counterparty=str(claim.get("counterparty", "")),
        amount_display=str(claim.get("amount_display", "")),
        situation=str(claim.get("situation", "")),
        administrator=str(claim.get("administrator", "")),
        runtime_marker=recorded,
        routes_exhausted=tuple(str(r) for r in fixture.get("routes_exhausted", ())),
        economics=tuple(str(line) for line in fixture.get("economics", ())),
        before_lines=tuple(str(x) for x in (fixture.get("before") or {}).get("lines", ())),
        after_lines=tuple(str(x) for x in (fixture.get("after") or {}).get("lines", ())),
        controls=tuple(dict(item) for item in fixture.get("controls", ())),
        runtime_lines=(
            f"Provider {runtime.get('provider', '')} performed the phone interaction",
            f"Recorded calls: {runtime.get('recorded_calls', '')}",
            f"Call id (masked): {runtime.get('masked_call_id', '')}",
        ),
        runtime_limitation=str(runtime.get("limitation", "")),
        receipt_link=str((fixture.get("boundary") or {}).get("receipt", "")),
        transport_row=_row(
            "Transport", str(runtime.get("transport_state", "")), recorded
        ),
        status_row=_row(
            "Stated status", stated, recorded, note=str(outcome.get("trust_note", ""))
        ),
        requirement_row=_row(
            "Missing requirement",
            str(outcome.get("missing_requirement", "")),
            recorded,
        ),
        reference_row=(
            _row(
                "Confirmed reference",
                str(reference.get("display", "")),
                recorded,
                quote=str(reference.get("quote", "")),
                note=str(reference.get("method_display", "")),
            )
            if reference
            else None
        ),
        terminal_row=_row(
            "Terminal state", str(outcome.get("terminal_state", "")), recorded
        ),
        decision=DecisionState(write_back=str((fixture.get("boundary") or {}).get("write_back", ""))),
        reveal_labels=dict(fixture.get("replay") or {}),
    )


def build_live_model(
    packet: ReviewPacket,
    *,
    claim_id: str,
    organization: str,
    counterparty: str,
    amount_display: str,
    situation: str,
    administrator: str = "",
    routes_exhausted: tuple[str, ...] = (),
    economics: tuple[str, ...] = (),
    before_lines: tuple[str, ...] = (),
    after_lines: tuple[str, ...] = (),
    controls: tuple[Mapping[str, str], ...] = (),
    runtime_lines: tuple[str, ...] = (),
    runtime_limitation: str = "",
    receipt_link: str = "",
    person_indicator: str = "",
    transcript_path: str = "",
    transcript_available: bool = False,
    csrf_token: str = "",
    runtime_marker: str = EvidenceClass.SYNTHETIC.value,
    decision: Optional[DecisionState] = None,
) -> ReviewScreenModel:
    """Build the live screen's model from a review packet and claim facts.

    ``packet`` is a :class:`~warrantyops.review.ReviewPacket`. Runtime rows
    carry ``runtime_marker`` — Synthetic for a FakeCalle demonstration,
    Recorded only for a real saved runtime result. The claim-context facts
    (amount, routes, policy arithmetic) carry Fictional case data: they are
    the demonstration envelope, not the call.
    """

    business = packet.business or {}
    evidence = {item.get("field"): item for item in business.get("evidence", ())}

    status = business.get("claim_status", "UNKNOWN")
    status_note = ""
    if status == "UNKNOWN":
        status_note = "The counterparty did not establish the status; WarrantyOps refuses to invent it."

    requirement_value = " · ".join(
        part
        for part in (
            business.get("required_correction"),
            *(business.get("required_documents") or ()),
        )
        if part
    )
    requirement_quote = ""
    requirement_evidence = evidence.get("required_documents") or evidence.get(
        "required_correction"
    )
    if requirement_evidence:
        requirement_quote = str(requirement_evidence.get("quote", ""))

    reference = business.get("confirmed_reference")
    reference_row = None
    if reference:
        item = evidence.get("confirmed_reference") or {}
        reference_row = _row(
            "Confirmed reference",
            str(reference.get("value", "")),
            runtime_marker,
            quote=str(item.get("quote", "")),
            note=str(item.get("method", "")),
        )

    transport_row = _row("Transport", str(packet.transport_state), runtime_marker)
    person_row = (
        _row("Derived person indicator", person_indicator, runtime_marker)
        if person_indicator
        else None
    )
    business_row = _row(
        "Business evidence",
        "usable" if business.get("claim_status") else "none",
        runtime_marker,
    )
    status_row = _row(
        "Stated status", str(status), runtime_marker, note=status_note
    )
    requirement_row = (
        _row(
            "Missing requirement",
            requirement_value,
            runtime_marker,
            quote=requirement_quote,
        )
        if requirement_value
        else None
    )
    terminal_row = _row("Terminal state", str(packet.terminal_state), runtime_marker)

    return ReviewScreenModel(
        page_kind="decision-receipt" if decision and decision.mode != DECISION_PENDING else "live-review",
        claim_id=claim_id,
        organization=organization,
        counterparty=counterparty,
        amount_display=amount_display,
        situation=situation,
        administrator=administrator,
        runtime_marker=runtime_marker,
        routes_exhausted=routes_exhausted,
        economics=economics,
        before_lines=before_lines,
        after_lines=after_lines,
        controls=controls,
        runtime_lines=runtime_lines,
        runtime_limitation=runtime_limitation,
        receipt_link=receipt_link,
        transport_row=transport_row,
        person_row=person_row,
        business_row=business_row,
        status_row=status_row,
        requirement_row=requirement_row,
        reference_row=reference_row,
        terminal_row=terminal_row,
        review_id=str(packet.review_id),
        packet_sha256=str(packet.packet_sha256),
        transcript_path=transcript_path,
        transcript_available=transcript_available,
        csrf_token=csrf_token,
        decision=decision or DecisionState(),
    )


# --- the template pieces ------------------------------------------------------

_CSS = """
  :root{
    --ink:#0f172a; --muted:#55627a; --line:#e2e8f0; --paper:#f6f8fb; --card:#ffffff;
    --control:#1d4ed8; --control-soft:#e8effd;
    --runtime:#6d28d9; --runtime-soft:#f1eafd;
    --boundary:#b45309; --boundary-soft:#fdf3e3;
    --unknown:#3f4c66; --unknown-line:#94a3b8;
    --good:#166534; --good-soft:#ecfdf3;
  }
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       color:var(--ink);background:var(--paper)}
  .wrap{max-width:1180px;margin:0 auto;padding:20px 24px 28px}
  header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}
  .brand{display:flex;align-items:baseline;gap:10px;font-weight:650}
  .brand small{color:var(--muted);font-weight:450}
  .claimbar{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;background:var(--card);
            border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:14px}
  .claimbar .who{font-weight:650}
  .claimbar .muted{color:var(--muted)}
  .muted{color:var(--muted)}
  .pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:600}
  .pill.recorded{background:var(--runtime-soft);color:var(--runtime)}
  .pill.synthetic{background:var(--good-soft);color:var(--good)}
  .pill.fictional{background:#eef1f6;color:var(--muted);border:1px dashed var(--unknown-line)}
  .pill.boundary{background:var(--boundary-soft);color:var(--boundary)}
  .claim-tag{display:inline-flex;gap:8px;align-items:baseline;border:1px solid var(--line);
             background:var(--card);border-radius:10px;padding:5px 12px}
  .claim-tag-label{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .duo{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
  .card h2{margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .before ul,.after ul{margin:0;padding-left:18px}
  .before li,.after li{margin:4px 0}
  .result{display:grid;gap:10px}
  .kv{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}
  .kv .k{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);min-width:150px}
  .kv .v{font-weight:620}
  .kv .pill{margin-left:4px}
  .rownote{width:100%;color:var(--muted);font-size:13px;max-width:52ch}
  .quote{border-left:3px solid var(--runtime);background:var(--runtime-soft);border-radius:0 8px 8px 0;
         padding:6px 10px;font-size:13.5px;margin-top:2px;width:100%}
  .unknown-pill{display:inline-flex;align-items:center;gap:8px;border:2px dashed var(--unknown-line);
                color:var(--unknown);border-radius:10px;padding:3px 10px;font-weight:700;letter-spacing:.04em}
  ul.checks{list-style:none;margin:0;padding:0}
  ul.checks li{display:flex;gap:8px;align-items:flex-start;margin:7px 0}
  ul.checks .tick{color:var(--control);font-weight:800}
  ul.checks .sub{display:block;color:var(--muted);font-size:12.5px}
  .trio{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
  .trio .card h2 .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
  .dot.control{background:var(--control)} .dot.runtime{background:var(--runtime)} .dot.boundary{background:var(--boundary)}
  .boundary-line{display:flex;gap:8px;align-items:flex-start;margin:7px 0}
  .boundary-line .mark{color:var(--boundary);font-weight:800}
  .limitation{margin-top:10px;background:var(--boundary-soft);border:1px solid #ecd9b0;color:#7c4a03;
              border-radius:9px;padding:8px 10px;font-size:13px}
  .decision{display:grid;gap:10px}
  .decision .why{color:var(--muted);font-size:13.5px;max-width:64ch}
  button{font:inherit;font-weight:650;color:#fff;background:var(--control);border:0;border-radius:10px;
         padding:10px 16px;cursor:pointer}
  button:focus-visible{outline:3px solid var(--control);outline-offset:2px}
  button.refuse{background:#9f1239}
  button.return{background:var(--unknown)}
  button[disabled]{background:#9db4e8;cursor:default}
  .decisionrow{display:flex;flex-wrap:wrap;gap:10px}
  .decisionmeta{color:var(--muted);font-size:13px}
  .transcript-link{font-size:13.5px}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
  footer{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;
         margin-top:14px;color:var(--muted);font-size:12.5px}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  @media (max-width:900px){ .duo,.trio{grid-template-columns:1fr} .kv .k{min-width:0} }
  @media (prefers-reduced-motion:reduce){ *{transition:none!important;animation:none!important} }
"""


def _esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def _pill(text: str, extra: str = "") -> str:
    klass = _PILL_CLASS.get(text, "fictional")
    combined = f"pill {klass}" + (f" {extra}" if extra else "")
    return f'<span class="{combined}">{_esc(text)}</span>'


def _row_html(row: ScreenRow) -> str:
    parts = [
        f'<div class="kv"><span class="k">{_esc(row.label)}</span>',
        f'<span class="v">{_esc(row.value)}</span>{_pill(row.pill)}',
    ]
    if row.note:
        parts.append(f'<span class="rownote">{_esc(row.note)}</span>')
    if row.quote:
        parts.append(
            f'<span class="quote">&ldquo;{_esc(row.quote)}&rdquo; '
            "<span class=\"muted\">— verbatim counterparty quote</span></span>"
        )
    parts.append("</div>")
    return "".join(parts)


def _head(model: ReviewScreenModel) -> str:
    title = {
        "static-proof": f"WarrantyOps — Claim Exception Proof — {model.claim_id}",
        "live-review": f"WarrantyOps — Review — {model.claim_id}",
        "decision-receipt": f"WarrantyOps — Decision Record — {model.claim_id}",
    }.get(model.page_kind, "WarrantyOps")
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{_esc(title)}</title>\n"
        f"<style>{_CSS}</style>\n</head>\n<body>\n"
        '<div class="wrap" id="top">\n'
    )


def _claimbar(model: ReviewScreenModel) -> str:
    who = f"{model.administrator} · {model.organization}" if model.administrator else model.organization
    return (
        '<header><div class="brand">WarrantyOps '
        "<small>claim exception review</small></div>"
        '<span class="claim-tag"><span class="claim-tag-label">Claim</span>'
        f"<strong>{_esc(model.claim_id)} — {_esc(model.organization)}</strong></span></header>\n"
        '<div class="claimbar">'
        f'<span class="who">{_esc(who)}</span>'
        f"<span>Claim <strong>{_esc(model.claim_id)}</strong> · <strong>{_esc(model.amount_display)}</strong></span>"
        f"<span>Counterparty: <strong>{_esc(model.counterparty)}</strong></span>"
        f'<span class="muted">{_esc(model.situation)}</span>'
        f"{_pill(EvidenceClass.FICTIONAL.value)}"
        f"{_pill(model.runtime_marker)}"
        "</div>\n"
    )


def _gates_card(model: ReviewScreenModel) -> str:
    lines = "".join(f"<li>{_esc(route)}</li>" for route in model.routes_exhausted)
    econ = "".join(f"<li>{_esc(line)}</li>" for line in model.economics)
    fictional = EvidenceClass.FICTIONAL.value
    return (
        '<section class="card" aria-labelledby="gates-h">'
        '<h2 id="gates-h">Deterministic gates</h2>'
        '<div class="boundary-line"><span class="tick">✓</span><span>Digital routes exhausted '
        f"{_pill(fictional)}<ul class=\"checks\">{lines}</ul></span></div>"
        '<div class="boundary-line"><span class="tick">✓</span><span>Economic gate — supplied '
        f"arithmetic {_pill(fictional)}<ul class=\"checks\">{econ}</ul></span></div>"
        "</section>\n"
    )


def _checks_card(model: ReviewScreenModel) -> str:
    items = "".join(
        f"<li><span class=\"tick\">✓</span><span>{_esc(control.get('label', ''))}"
        f"<span class=\"sub\">{_esc(control.get('detail', ''))}</span></span></li>"
        for control in model.controls
    )
    if not items:
        return ""
    return (
        '<section class="card" aria-labelledby="controls-h">'
        '<h2 id="controls-h"><span class="dot control"></span>Controls the run passed</h2>'
        f'<ul class="checks">{items}</ul></section>\n'
    )


def _result_card(model: ReviewScreenModel, *, locked: bool) -> str:
    rows = "".join(
        _row_html(row)
        for row in (
            model.transport_row,
            model.person_row,
            model.business_row,
            model.status_row,
            model.requirement_row,
            model.reference_row,
            model.terminal_row,
        )
        if row is not None
    )
    inner = f'<div class="result">{rows}</div>'
    if not locked:
        return (
            '<section class="card after" aria-labelledby="after-h">'
            '<h2 id="after-h">Result of the call</h2>' + inner + "</section>\n"
        )
    # The static proof instance withholds the saved result behind the same
    # reveal control the checked-in page always had.
    labels = model.reveal_labels
    button = labels.get("button_label", "Reveal recorded result")
    hint = labels.get("hint", "Reveals the saved, sanitized runtime result; never starts a live call.")
    return (
        '<section class="card after" id="after-card" data-state="locked" aria-labelledby="after-h">'
        '<h2 id="after-h">Result of the call</h2>'
        '<div class="locked" id="after-locked">'
        f'<div class="why">{_esc(hint)}</div>'
        f'<button id="reveal" type="button">{_esc(button)}</button>'
        "</div>"
        f'<div id="after-result" hidden>{inner}</div>'
        "</section>\n"
    )


def _before_card(model: ReviewScreenModel) -> str:
    if not model.before_lines:
        return ""
    lines = "".join(f"<li>{_esc(line)}</li>" for line in model.before_lines)
    return (
        '<section class="card before" aria-labelledby="before-h">'
        '<h2 id="before-h">Before</h2><ul>' + lines + "</ul></section>\n"
    )


def _boundary_card(model: ReviewScreenModel) -> str:
    transcript = (
        f'<div class="boundary-line"><span class="mark">◂</span><span>Private transcript: '
        f'<a class="transcript-link" href="{_esc(model.transcript_path)}">local-only link</a> '
        "(served from this machine only)</span></div>"
        if model.transcript_available
        else '<div class="boundary-line"><span class="mark">◂</span><span>Private transcript: '
        "not published on this page</span></div>"
    )
    review_line = (
        f'<div class="mono">review {model.review_id[:12]}… · packet {_esc(model.packet_sha256[:16])}…</div>'
        if model.review_id
        else ""
    )
    return (
        '<section class="card" aria-labelledby="boundary-h">'
        '<h2 id="boundary-h"><span class="dot boundary"></span>Human &amp; evidence boundary</h2>'
        + transcript
        + '<div class="boundary-line"><span class="mark">◂</span><span>'
        "System will not write until a named human approves</span></div>"
        + review_line
        + '<div class="boundary-line"><span class="mark">◂</span><span>Write-back: '
        f"{_esc(model.decision.write_back or 'WITHHELD_PENDING_REVIEW')}</span></div>"
        "</section>\n"
    )


def _runtime_card(model: ReviewScreenModel) -> str:
    limitation = (
        f'<div class="limitation">{_esc(model.runtime_limitation)}</div>'
        if model.runtime_limitation
        else ""
    )
    facts = "".join(
        f"<li><span class=\"tick\">▸</span><span>{_esc(line)}</span></li>"
        for line in model.runtime_lines
    )
    return (
        '<section class="card" aria-labelledby="runtime-h">'
        '<h2 id="runtime-h"><span class="dot runtime"></span>Runtime record</h2>'
        f'<ul class="checks"><li><span class="tick">▸</span><span>Runtime marker: '
        f"{_pill(model.runtime_marker)}</span></li>{facts}"
        "<li><span class=\"tick\">▸</span><span>Exactly one call per claim version</span></li></ul>"
        + limitation
        + "</section>\n"
    )


def _decision_area(model: ReviewScreenModel) -> str:
    decision = model.decision
    if model.page_kind == "static-proof":
        return ""  # the static proof page shows the withheld state, no form
    if decision.mode == DECISION_PENDING:
        if not model.csrf_token:
            return ""  # a live review without a CSRF token renders no form
        return (
            '<section class="card" aria-labelledby="decision-h">'
            '<h2 id="decision-h">Decision</h2><div class="decision">'
            '<p class="why">You are the named human this boundary requires. Approve writes the '
            "reviewed note once, after the source version is re-read; Refuse and Return to "
            "digital record a safe non-write.</p>"
            f'<form method="post" action="/review/{_esc(model.review_id)}/decision">'
            f'<input type="hidden" name="csrf_token" value="{_esc(model.csrf_token)}">'
            f'<input type="hidden" name="packet_sha256" value="{_esc(model.packet_sha256)}">'
            '<div class="decisionrow">'
            '<button type="submit" name="decision" value="APPROVE">Approve note</button>'
            '<button type="submit" name="decision" value="REFUSE" class="refuse">Refuse</button>'
            '<button type="submit" name="decision" value="RETURN_TO_DIGITAL" class="return">'
            "Return to digital route</button>"
            "</div></form></div></section>\n"
        )
    # A recorded decision: the decision-receipt page.
    label = {
        "APPROVE": "Approved",
        "REFUSE": "Refused",
        "RETURN_TO_DIGITAL": "Returned to digital route",
    }.get(decision.mode, decision.mode)
    replay_note = " (idempotent replay — the note was already written)" if decision.replayed else ""
    refusal_note = (
        f'<div class="limitation">Refused: {_esc(decision.refusal)}</div>'
        if decision.refusal
        else ""
    )
    note_line = (
        f'<div class="mono">note {_esc(decision.note_id)}</div>' if decision.note_id else ""
    )
    return (
        '<section class="card" aria-labelledby="decision-h">'
        '<h2 id="decision-h">Recorded decision</h2><div class="decision">'
        f"<div><strong>{_esc(label)}</strong>{_esc(replay_note)}</div>"
        f'<div class="decisionmeta">operator {_esc(decision.operator_id)} · '
        f"{_esc(decision.decided_at)}</div>"
        f"<div>Write-back: {_esc(decision.write_back)}</div>"
        + note_line
        + refusal_note
        + "</div></section>\n"
    )


def _footer(model: ReviewScreenModel) -> str:
    receipt = (
        f'public receipt: <a href="{_esc(model.receipt_link)}">{_esc(model.receipt_link)}</a>'
        if model.receipt_link
        else "no public receipt on this surface"
    )
    offline = (
        "static sanitized instance · no network · no live call can be triggered from this page"
        if model.page_kind == "static-proof"
        else "local-only review surface · loopback service · no CORS"
    )
    return (
        "<footer><span>Evidence classes: Recorded CALL-E result · Synthetic scenario · "
        f"Fictional case data — one per field · {receipt}</span>"
        f"<span>{offline}</span></footer>\n"
        '<div class="sr" role="status" aria-live="polite" id="announcer"></div>\n'
    )


_REVEAL_SCRIPT = """
<script>
(function () {
  "use strict";
  var button = document.getElementById("reveal");
  if (!button) { return; }
  var data = JSON.parse(document.getElementById("reveal-data").textContent);
  button.addEventListener("click", function () {
    document.getElementById("after-locked").hidden = true;
    document.getElementById("after-result").hidden = false;
    document.getElementById("after-card").dataset.state = "revealed";
    button.disabled = true;
    button.textContent = data.revealed_label || "Recorded result revealed";
    document.getElementById("announcer").textContent = data.announce || "";
  });
})();
</script>
"""


def render_review_screen(model: ReviewScreenModel) -> str:
    """Render one deterministic page from the model. Pure function."""

    locked = model.page_kind == "static-proof"
    body = "".join(
        [
            _head(model),
            _claimbar(model),
            '<div class="duo">',
            _before_card(model),
            _result_card(model, locked=locked),
            "</div>\n",
            '<div class="trio">',
            _gates_card(model),
            _checks_card(model) or "",
            _runtime_card(model),
            "</div>\n",
            '<div class="duo">',
            _boundary_card(model),
            _decision_area(model),
            "</div>\n",
            _footer(model),
            "</div>\n",
        ]
    )
    if locked:
        reveal_payload = json.dumps(
            {
                "revealed_label": model.reveal_labels.get("revealed_label", ""),
                "announce": model.reveal_labels.get("announce", ""),
            },
            sort_keys=True,
        )
        body += (
            '<script type="application/json" id="reveal-data">'
            + reveal_payload
            + "</script>"
            + _REVEAL_SCRIPT
        )
    body += "</body>\n</html>\n"
    return body
