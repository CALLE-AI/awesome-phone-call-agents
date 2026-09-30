from __future__ import annotations

import html
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def write_demo_reports(
    output_dir: str | Path, packet: dict[str, Any]
) -> tuple[Path, Path]:
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    json_path = target / "pawpassage-demo-report.json"
    html_path = target / "pawpassage-demo-report.html"
    json_path.write_text(
        json.dumps(packet, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    html_path.write_text(_render_html(packet), encoding="utf-8")
    return json_path, html_path


def build_demo_packet(
    *,
    route_label: str,
    overall_disposition: str,
    reports: list[dict[str, Any]],
    duplicate_checks: list[dict[str, Any]],
    fake_server: dict[str, int],
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "product": "PawPassage",
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "mode": "FAKE_SERVER_NO_CALL",
        "routeLabel": route_label,
        "overallDisposition": overall_disposition,
        "reports": reports,
        "duplicateChecks": duplicate_checks,
        "providerBoundary": {
            "sdk": "calle-ai==0.7.0",
            "fakeServerCreateRequests": fake_server["createRequests"],
            "fakeServerReadRequests": fake_server["readRequests"],
            "fakeServerUniqueCalls": fake_server["uniqueCalls"],
            "realCalls": 0,
        },
        "authorityBoundary": (
            "This packet is evidence for human review. It is not a booking, payment, "
            "health certificate, legal determination, or travel clearance."
        ),
    }


def _render_html(packet: dict[str, Any]) -> str:
    cards = "".join(_card(report) for report in packet["reports"])
    overall = html.escape(packet["overallDisposition"])
    route = html.escape(packet["routeLabel"])
    provider = packet["providerBoundary"]
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PawPassage demo evidence</title>
  <style>
    :root {{ color-scheme: light; --ink:#17211b; --muted:#65736a; --paper:#f3f6f1; --card:#fff; --green:#1f6b46; --amber:#9b5d09; --red:#9a3840; --line:#dce4dc; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:linear-gradient(145deg,#edf4ec,#f7f2e9); }}
    main {{ max-width:1120px; margin:0 auto; padding:48px 24px 64px; }}
    .eyebrow {{ letter-spacing:.12em; text-transform:uppercase; color:var(--green); font-weight:750; font-size:.78rem; }}
    h1 {{ font-size:clamp(2.4rem,6vw,4.8rem); line-height:.96; letter-spacing:-.05em; margin:.3rem 0 1rem; }}
    .lead {{ max-width:760px; color:var(--muted); font-size:1.12rem; }}
    .status {{ display:inline-block; margin:20px 0 32px; padding:10px 14px; background:#fff3d8; color:var(--amber); border:1px solid #ead4a7; border-radius:999px; font-weight:750; }}
    .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }}
    article {{ background:rgba(255,255,255,.92); border:1px solid var(--line); border-radius:18px; padding:22px; box-shadow:0 12px 40px rgba(45,63,50,.07); }}
    article h2 {{ margin:0 0 4px; font-size:1.1rem; }}
    .pill {{ display:inline-block; padding:4px 9px; border-radius:999px; background:#edf5ee; color:var(--green); font-weight:700; font-size:.75rem; }}
    .pill.warn {{ background:#fff0e0; color:var(--amber); }}
    .pill.stop {{ background:#fde8e9; color:var(--red); }}
    dl {{ display:grid; grid-template-columns:auto 1fr; gap:7px 12px; margin:18px 0 0; font-size:.9rem; }}
    dt {{ color:var(--muted); }} dd {{ margin:0; font-weight:620; overflow-wrap:anywhere; }}
    .boundary {{ margin-top:22px; padding:18px 20px; border-left:4px solid var(--green); background:rgba(255,255,255,.7); }}
    .metrics {{ display:flex; flex-wrap:wrap; gap:18px; margin-top:24px; color:var(--muted); font-size:.9rem; }}
    .metrics strong {{ color:var(--ink); font-size:1.25rem; display:block; }}
  </style>
</head>
<body><main>
  <div class="eyebrow">Credential-free CALL-E integration demo</div>
  <h1>PawPassage</h1>
  <p class="lead">A bounded evidence matrix for cross-border pet journeys. Three frozen questions per official service desk; no booking, payment, health decision, or travel clearance.</p>
  <p><strong>{route}</strong></p>
  <div class="status">{overall}</div>
  <section class="grid">{cards}</section>
  <div class="boundary"><strong>Human authority stays outside the call.</strong><br>{html.escape(packet["authorityBoundary"])}</div>
  <div class="metrics">
    <div><strong>{provider["fakeServerCreateRequests"]}</strong>fake SDK submissions</div>
    <div><strong>{provider["fakeServerUniqueCalls"]}</strong>unique fake calls</div>
    <div><strong>{provider["realCalls"]}</strong>real calls</div>
    <div><strong>{len(packet["duplicateChecks"])}</strong>duplicate attempts blocked</div>
  </div>
</main></body></html>"""


def _card(report: dict[str, Any]) -> str:
    disposition = str(report["disposition"])
    class_name = "pill"
    if "GAP" in disposition or "HUMAN" in disposition:
        class_name += " warn"
    if "STOP" in disposition or "DO_NOT" in disposition:
        class_name += " stop"
    reasons = ", ".join(report.get("reason_codes") or ["none"])
    call_id = report.get("provider_call_id") or "not issued"
    diagnostic = report.get("provider_diagnostic")
    diagnostic_row = (
        f"<dt>Provider response</dt><dd>{html.escape(str(diagnostic))}</dd>"
        if diagnostic
        else ""
    )
    return f"""<article>
      <h2>{html.escape(str(report["checkpoint_id"]))}</h2>
      <span class="{class_name}">{html.escape(disposition)}</span>
      <dl>
        <dt>Recipient</dt><dd>{html.escape(str(report["recipient_masked"]))}</dd>
        <dt>Ledger</dt><dd>{html.escape(str(report["ledger_state"]))}</dd>
        <dt>Reasons</dt><dd>{html.escape(reasons)}</dd>
        {diagnostic_row}
        <dt>Call ref</dt><dd>{html.escape(str(call_id))}</dd>
      </dl>
    </article>"""
