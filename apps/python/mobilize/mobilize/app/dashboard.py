"""The coordinator-facing product: load a registry, describe a need, watch
it fill, get an actionable list back. This is the thing a real donor
coordinator could actually use -- not a developer demo of the engine.

    python -m mobilize.app.dashboard
    open http://localhost:8731

Ships with a sample registry (mobilize/app/sample_data/sample_registry.csv)
so it works with zero setup. Runs entirely against the free simulator by
default; a real mobilization is a separate, explicit, confirmed action --
see registry_real_dispatch below -- never triggered by the same button that
runs the free preview.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.registry import (
    Registry,
    RegistryError,
    load_registry_csv,
    load_registry_json,
    record_outcomes,
    save_registry_json,
)
from mobilize.core.types import Need
from mobilize.sim.population import generate_population
from mobilize.transports.simulated import SimulatedTransport

APP_DIR = Path(__file__).resolve().parent
SAMPLE_REGISTRY_CSV = APP_DIR / "sample_data" / "sample_registry.csv"
REGISTRY_STATE_PATH = Path("/tmp/mobilize_dashboard_registry.json")
# Separate from REGISTRY_STATE_PATH on purpose: the state file gets written
# automatically the first time the bundled sample is loaded, so its mere
# existence can't distinguish "sample, persisted" from "a coordinator
# actually uploaded their own list" -- that provenance is tracked here.
REGISTRY_SOURCE_MARKER_PATH = Path("/tmp/mobilize_dashboard_registry_source.txt")

app = FastAPI(title="mobilize")


def _current_registry() -> Registry:
    """The coordinator's working registry: whatever they've loaded and
    however outcomes have updated it since, persisted between page loads
    the same way a real tool would remember your list."""
    if REGISTRY_STATE_PATH.exists():
        registry = load_registry_json(REGISTRY_STATE_PATH)
        if len(registry):
            return registry
    registry = load_registry_csv(SAMPLE_REGISTRY_CSV)
    save_registry_json(registry, REGISTRY_STATE_PATH)
    if not REGISTRY_SOURCE_MARKER_PATH.exists():
        REGISTRY_SOURCE_MARKER_PATH.write_text("sample")
    return registry


def _registry_source_label() -> str:
    marker = REGISTRY_SOURCE_MARKER_PATH.read_text().strip() if REGISTRY_SOURCE_MARKER_PATH.exists() else "sample"
    return "your uploaded list" if marker == "uploaded" else "sample registry"


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return _PAGE


@app.get("/api/registry")
async def get_registry() -> dict:
    registry = _current_registry()
    today = date.today()
    people = [
        {
            "id": p.id, "name": p.name, "phone": _mask(p.phone), "timezone": p.timezone,
            "days_since_donation": round(p.days_since_last_donation(today)),
            "eligible": p.is_eligible(56, today),
            "accept_rate": round(p.accept_rate, 2), "showup_rate": round(p.showup_rate, 2),
            "times_called": p.times_called,
        }
        for p in sorted(registry.all(), key=lambda x: -x.to_candidate().prior_score())
    ]
    return {"count": len(registry), "source": _registry_source_label(), "people": people}


@app.post("/api/registry/upload")
async def upload_registry(payload: dict) -> dict:
    """Accepts raw CSV text pasted or uploaded from the browser -- no
    command line required. This is the actual product surface: a
    coordinator's own spreadsheet becomes a working registry in one step."""
    csv_text = payload.get("csv", "")
    tmp_path = Path("/tmp/mobilize_uploaded_registry.csv")
    tmp_path.write_text(csv_text)
    try:
        registry = load_registry_csv(tmp_path)
    except RegistryError as exc:
        return {"error": str(exc)}
    save_registry_json(registry, REGISTRY_STATE_PATH)
    REGISTRY_SOURCE_MARKER_PATH.write_text("uploaded")
    return {"count": len(registry), "message": f"Loaded {len(registry)} people."}


@app.post("/api/registry/reset")
async def reset_registry() -> dict:
    if REGISTRY_STATE_PATH.exists():
        REGISTRY_STATE_PATH.unlink()
    if REGISTRY_SOURCE_MARKER_PATH.exists():
        REGISTRY_SOURCE_MARKER_PATH.unlink()
    registry = _current_registry()
    return {"count": len(registry), "message": "Reset to the sample registry."}


@app.websocket("/ws/run")
async def run_mobilization(ws: WebSocket) -> None:
    await ws.accept()
    try:
        params = await ws.receive_json()
        need_label = params.get("need_label", "Urgent help needed")
        need_count = int(params.get("need_count", 3))
        deadline_minutes = float(params.get("deadline_minutes", 60))
        max_calls = int(params.get("max_calls", 40))
        location = params.get("location", "")
        use_simulated_outcomes = bool(params.get("simulate", True))

        registry = _current_registry()
        candidates = registry.candidates(min_days_between_donations=56)
        need = Need(label=need_label, count=need_count, deadline_minutes=deadline_minutes,
                    location=location, max_calls=max_calls)
        ledger = Ledger("/tmp/mobilize_dashboard_ledger.jsonl")

        if use_simulated_outcomes:
            # The registry is real (your actual people, your actual
            # learned rates); the CALL responses are simulated from each
            # person's own accept/show-up rate, so a coordinator can
            # rehearse against their real list at zero cost before
            # spending real credits. This is not the evaluation harness's
            # synthetic population -- it's your registry, simulated.
            transport = _RegistryBackedSimulatedTransport(registry)
        else:
            from mobilize.transports.calle import CalleTransport
            transport = CalleTransport()

        loop = asyncio.get_event_loop()

        def on_progress(event: str, data: dict[str, Any]) -> None:
            safe_data = dict(data)
            if "candidate_id" in safe_data:
                person = registry.get(safe_data["candidate_id"])
                if person:
                    safe_data["name"] = person.name
            if "candidates" in safe_data:
                safe_data["names"] = [registry.get(c).name if registry.get(c) else c for c in safe_data["candidates"]]
            asyncio.run_coroutine_threadsafe(ws.send_json({"event": event, "data": safe_data}), loop)

        result = await mobilize(need, candidates, transport, ledger=ledger, on_progress=on_progress,
                                 mobilization_id=f"dash_{id(ws)}")

        updated_ids = record_outcomes(registry, result.all_results)
        save_registry_json(registry, REGISTRY_STATE_PATH)

        confirmed_people = [
            {"id": r.candidate_id, "name": registry.get(r.candidate_id).name if registry.get(r.candidate_id) else r.candidate_id,
             "phone": _mask(registry.get(r.candidate_id).phone) if registry.get(r.candidate_id) else "",
             "commitment": round(r.commitment_score, 2), "evidence": r.evidence}
            for r in result.confirmed
        ]

        await ws.send_json({
            "event": "final",
            "data": {
                "filled": result.filled,
                "confirmed": confirmed_people,
                "need_count": need_count,
                "calls_used": result.calls_used,
                "waves": len(result.waves),
                "time_to_fill_seconds": result.time_to_fill_seconds,
                "over_recruitment_ratio": result.over_recruitment_ratio,
                "registry_size": len(registry),
                "never_called": len(registry) - result.calls_used,
                "learned_from_outcomes": len(updated_ids),
            },
        })
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # surfaced to the UI instead of a silent disconnect
        try:
            await ws.send_json({"event": "error", "data": {"message": str(exc)}})
        except Exception:
            pass


class _RegistryBackedSimulatedTransport:
    """Simulates call outcomes drawn from each REAL registry person's own
    learned accept/show-up rates, instead of a synthetic population. This
    is what makes the dashboard rehearsable against your actual list before
    spending a real credit -- the ranking and the rehearsal both use the
    same numbers a real run would use."""

    def __init__(self, registry: Registry) -> None:
        import random
        self._registry = registry
        self._rng = random.Random()
        self._pending: dict[str, tuple[str, float, bool, bool, str]] = {}

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        import time as _time
        import uuid

        call_id = f"reg_{uuid.uuid4().hex[:10]}"
        person = self._registry.get(candidate.id)
        accept_rate = person.accept_rate if person else 0.5
        showup_rate = person.showup_rate if person else 0.5

        picked_up = self._rng.random() < 0.75
        accepted = picked_up and self._rng.random() < accept_rate
        evidence = "leaving now, ten minutes" if (accepted and self._rng.random() < showup_rate) else \
                   ("I'll try, maybe" if accepted else ("no answer" if not picked_up else "can't make it"))
        latency = self._rng.uniform(0.05, 0.35)

        self._pending[call_id] = (candidate.id, _time.monotonic() + latency, picked_up, accepted, evidence)
        return call_id

    async def poll(self, call_id: str, *, expected_candidate=None):
        import time as _time
        from mobilize.core.commitment import calibrated_commitment
        from mobilize.core.types import CallOutcome, CallResult, utcnow

        entry = self._pending.get(call_id)
        if entry is None:
            return None
        candidate_id, ready_at, picked_up, accepted, evidence = entry
        if _time.monotonic() < ready_at:
            return None

        person = self._registry.get(candidate_id)
        showup_rate = person.showup_rate if person else 0.5

        if not picked_up:
            return CallResult(call_id=call_id, candidate_id=candidate_id, outcome=CallOutcome.NO_ANSWER,
                               commitment_score=0.0, stated_yes=False, evidence="No answer.")
        if not accepted:
            return CallResult(call_id=call_id, candidate_id=candidate_id, outcome=CallOutcome.NO,
                               commitment_score=0.0, stated_yes=False, evidence=evidence)

        commitment = calibrated_commitment(evidence=evidence, candidate_prior_showup_rate=showup_rate)
        outcome = CallOutcome.FIRM_YES if commitment >= 0.6 else CallOutcome.SOFT_YES
        return CallResult(call_id=call_id, candidate_id=candidate_id, outcome=outcome,
                           commitment_score=commitment, stated_yes=True, evidence=evidence)


def _mask(phone: str) -> str:
    if len(phone) <= 4:
        return phone
    return phone[:3] + "*" * (len(phone) - 6) + phone[-3:]


_PAGE = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>mobilize</title>
<style>
  * { box-sizing: border-box; }
  body { background: #0b0e14; color: #e6e6e6; font-family: -apple-system, "SF Pro Text", "Segoe UI", sans-serif; padding: 24px; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 4px; }
  .subtitle { color: #9ca3af; font-size: 13px; margin-bottom: 20px; }
  .panel { background: #10141c; border: 1px solid #232a38; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #9ca3af; margin: 0 0 12px 0; }
  label { display: block; font-size: 12px; color: #9ca3af; margin: 10px 0 4px; }
  input, textarea { width: 100%; background: #171c26; color: #e6e6e6; border: 1px solid #2a3140; border-radius: 6px; padding: 8px 10px; font-family: inherit; font-size: 13px; }
  textarea { font-family: "SF Mono", monospace; font-size: 11px; height: 90px; }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 9px 16px; cursor: pointer; font-weight: 600; font-size: 13px; margin-top: 12px; }
  button:hover { background: #1d4ed8; }
  button.secondary { background: #232a38; }
  button.secondary:hover { background: #2a3140; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #9ca3af; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #232a38; }
  td { padding: 6px 8px; border-bottom: 1px solid #171c26; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
  .badge.eligible { background: #14301f; color: #4ade80; }
  .badge.ineligible { background: #301414; color: #f87171; }
  #map { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin: 12px 0; }
  .node { width: 100%; aspect-ratio: 1; border-radius: 50%; background: #2a3140; transition: all 0.3s; }
  .node.dialing { background: #f59e0b; animation: pulse 0.8s infinite; }
  .node.firm_yes { background: #22c55e; }
  .node.soft_yes { background: #eab308; }
  .node.no, .node.no_answer, .node.failed { background: #3f4656; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  #log { background: #0d1017; border-radius: 6px; padding: 10px; height: 180px; overflow-y: auto; font-size: 12px; font-family: "SF Mono", monospace; }
  .line { padding: 2px 0; }
  .firm_yes { color: #22c55e; } .soft_yes { color: #eab308; } .no, .no_answer, .failed { color: #6b7280; }
  #results { font-size: 13px; }
  #results .confirmed-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #171c26; }
  .pill { background: #1e293b; border-radius: 999px; padding: 2px 10px; font-size: 11px; color: #93c5fd; }
  .summary { display: flex; gap: 24px; margin: 12px 0; }
  .summary .stat { text-align: center; }
  .summary .stat .n { font-size: 22px; font-weight: 700; color: #fff; }
  .summary .stat .l { font-size: 10px; color: #9ca3af; text-transform: uppercase; }
  .msg { font-size: 12px; padding: 8px; border-radius: 6px; margin-top: 8px; }
  .msg.error { background: #301414; color: #f87171; }
  .msg.ok { background: #14301f; color: #4ade80; }
</style>
</head>
<body>
  <h1>mobilize</h1>
  <div class="subtitle">Load your registry, describe who you need, watch it fill. Free rehearsal against your own list by default -- no real calls unless you ask for them.</div>

  <div class="panel">
    <h2>1 · Registry</h2>
    <div id="registry-summary">Loading...</div>
    <label>Paste your own CSV (columns: name, phone, timezone -- optionally last_donation, distance_km, accept_rate, showup_rate)</label>
    <textarea id="csv-input" placeholder="name,phone,timezone
Asha Rao,+15550101001,Asia/Kolkata"></textarea>
    <button onclick="uploadRegistry()">Load this list</button>
    <button class="secondary" onclick="resetRegistry()">Reset to sample registry</button>
    <div id="upload-msg"></div>
    <div id="registry-table" style="margin-top:12px; max-height:200px; overflow-y:auto;"></div>
  </div>

  <div class="panel">
    <h2>2 · What do you need</h2>
    <div class="row">
      <div><label>Describe the need</label><input id="need_label" value="O-negative blood needed urgently"></div>
      <div><label>Location</label><input id="location" value="City Hospital"></div>
    </div>
    <div class="row">
      <div><label>How many confirmed</label><input id="need_count" type="number" value="3"></div>
      <div><label>Deadline (minutes)</label><input id="deadline_minutes" type="number" value="60"></div>
      <div><label>Max calls</label><input id="max_calls" type="number" value="40"></div>
    </div>
    <button onclick="run(true)">Run rehearsal (free, simulated on your list)</button>
    <button class="secondary" onclick="run(false)" id="real-btn">Run for real (spends CALL-E credits)</button>
  </div>

  <div class="panel">
    <h2>3 · Live dispatch</h2>
    <div id="map"></div>
    <div id="log"></div>
  </div>

  <div class="panel">
    <h2>4 · Result</h2>
    <div id="results">Run a mobilization to see who confirmed.</div>
  </div>

<script>
let nodes = {};

async function loadRegistrySummary() {
  const r = await fetch('/api/registry').then(r => r.json());
  document.getElementById('registry-summary').innerHTML =
    `<b>${r.count}</b> people loaded (${r.source}). Ranked by likelihood to confirm and follow through.`;
  const rows = r.people.slice(0, 30).map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.phone}</td>
      <td>${p.timezone}</td>
      <td><span class="badge ${p.eligible ? 'eligible' : 'ineligible'}">${p.eligible ? 'eligible' : 'not yet'}</span></td>
      <td>${(p.accept_rate*100).toFixed(0)}% accept</td>
      <td>${(p.showup_rate*100).toFixed(0)}% show-up</td>
      <td>${p.times_called}x called</td>
    </tr>`).join('');
  document.getElementById('registry-table').innerHTML =
    `<table><thead><tr><th>Name</th><th>Phone</th><th>TZ</th><th>Status</th><th>Accept</th><th>Show-up</th><th>History</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function uploadRegistry() {
  const csv = document.getElementById('csv-input').value.trim();
  if (!csv) return;
  const res = await fetch('/api/registry/upload', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({csv})
  }).then(r => r.json());
  const msgEl = document.getElementById('upload-msg');
  if (res.error) {
    msgEl.innerHTML = `<div class="msg error">${res.error}</div>`;
  } else {
    msgEl.innerHTML = `<div class="msg ok">${res.message}</div>`;
    loadRegistrySummary();
  }
}

async function resetRegistry() {
  await fetch('/api/registry/reset', {method: 'POST'});
  document.getElementById('upload-msg').innerHTML = '';
  loadRegistrySummary();
}

function run(simulate) {
  if (!simulate) {
    if (!confirm('This places REAL CALL-E calls and spends real credits. Continue?')) return;
  }
  document.getElementById('map').innerHTML = '';
  document.getElementById('log').innerHTML = '';
  document.getElementById('results').innerHTML = 'Running...';
  nodes = {};

  const ws = new WebSocket(`ws://${location.host}/ws/run`);
  ws.onopen = () => ws.send(JSON.stringify({
    need_label: document.getElementById('need_label').value,
    location: document.getElementById('location').value,
    need_count: +document.getElementById('need_count').value,
    deadline_minutes: +document.getElementById('deadline_minutes').value,
    max_calls: +document.getElementById('max_calls').value,
    simulate: simulate,
  }));
  ws.onmessage = (msg) => {
    const {event, data} = JSON.parse(msg.data);
    const log = document.getElementById('log');
    if (event === 'error') {
      document.getElementById('results').innerHTML = `<div class="msg error">${data.message}</div>`;
    } else if (event === 'wave_dispatch') {
      (data.names || data.candidates).forEach((name, i) => {
        const cid = data.candidates[i];
        if (!nodes[cid]) {
          const el = document.createElement('div');
          el.className = 'node dialing'; el.title = name;
          document.getElementById('map').appendChild(el);
          nodes[cid] = el;
        } else { nodes[cid].className = 'node dialing'; }
      });
      log.innerHTML += `<div class="line">— wave ${data.wave}: dialing ${data.candidates.length} in parallel</div>`;
    } else if (event === 'call_result') {
      if (nodes[data.candidate_id]) nodes[data.candidate_id].className = 'node ' + data.outcome;
      log.innerHTML += `<div class="line ${data.outcome}">${data.name || data.candidate_id}  ${data.outcome}  commitment=${data.commitment.toFixed(2)}</div>`;
    } else if (event === 'need_met') {
      log.innerHTML += `<div class="line firm_yes">✓ need met at ${data.time_to_fill_seconds.toFixed(1)}s — no further wave dispatched</div>`;
    } else if (event === 'opted_out') {
      log.innerHTML += `<div class="line failed">${data.candidate_id} asked not to be contacted again — added to do-not-call</div>`;
    } else if (event === 'final') {
      const confirmedRows = data.confirmed.map(c =>
        `<div class="confirmed-row"><span>${c.name} · ${c.phone}</span><span class="pill">commitment ${c.commitment}</span></div>`
      ).join('') || '<div style="color:#9ca3af">Nobody confirmed.</div>';
      document.getElementById('results').innerHTML = `
        <div class="summary">
          <div class="stat"><div class="n">${data.confirmed.length}/${data.need_count}</div><div class="l">confirmed</div></div>
          <div class="stat"><div class="n">${data.calls_used}</div><div class="l">calls used</div></div>
          <div class="stat"><div class="n">${data.never_called}</div><div class="l">never called</div></div>
          <div class="stat"><div class="n">${data.time_to_fill_seconds ? data.time_to_fill_seconds.toFixed(1)+'s' : '—'}</div><div class="l">time to fill</div></div>
        </div>
        ${confirmedRows}
        <div style="margin-top:10px; color:#9ca3af; font-size:11px;">Registry updated from ${data.learned_from_outcomes} outcome(s) — rankings above will reflect this next run.</div>
      `;
      loadRegistrySummary();
    }
    log.scrollTop = log.scrollHeight;
  };
}

loadRegistrySummary();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("MOBILIZE_DASHBOARD_PORT", 8731))
    uvicorn.run(app, host="0.0.0.0", port=port)
