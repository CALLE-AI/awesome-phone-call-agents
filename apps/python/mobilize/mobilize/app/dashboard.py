"""Live web dashboard: watch a mobilization unfold in real time over a
WebSocket, wave by wave, candidate by candidate. Runs entirely against the
free simulator by default -- this is the visual centerpiece for the demo
video, not a production service.

    python -m mobilize.app.dashboard
    open http://localhost:8000
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import Need
from mobilize.sim.population import generate_population
from mobilize.transports.simulated import SimulatedTransport

app = FastAPI(title="mobilize dashboard")


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return _PAGE


@app.websocket("/ws/run")
async def run_mobilization(ws: WebSocket) -> None:
    await ws.accept()
    try:
        params = await ws.receive_json()
        pool_size = int(params.get("pool_size", 150))
        need_count = int(params.get("need_count", 3))
        max_calls = int(params.get("max_calls", 40))
        seed = int(params.get("seed", 42))

        donors = generate_population(pool_size, seed=seed)
        pool = [d.candidate for d in donors]
        transport = SimulatedTransport(donors, seed=seed)
        need = Need(label="O-negative blood needed urgently", count=need_count,
                    deadline_minutes=60, location="City Hospital", max_calls=max_calls)
        ledger = Ledger("/tmp/mobilize_dashboard_ledger.jsonl")

        loop = asyncio.get_event_loop()

        def on_progress(event: str, data: dict[str, Any]) -> None:
            asyncio.run_coroutine_threadsafe(ws.send_json({"event": event, "data": data}), loop)

        result = await mobilize(need, pool, transport, ledger=ledger, on_progress=on_progress,
                                 mobilization_id=f"dash_{seed}_{id(ws)}")

        await ws.send_json({
            "event": "final",
            "data": {
                "filled": result.filled,
                "confirmed": len(result.confirmed),
                "need_count": need_count,
                "calls_used": result.calls_used,
                "waves": len(result.waves),
                "time_to_fill_seconds": result.time_to_fill_seconds,
                "over_recruitment_ratio": result.over_recruitment_ratio,
                "pool_size": pool_size,
                "never_called": pool_size - result.calls_used,
            },
        })
    except WebSocketDisconnect:
        pass


_PAGE = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>mobilize — live dispatch</title>
<style>
  body { background: #0b0e14; color: #e6e6e6; font-family: -apple-system, "SF Mono", Menlo, monospace; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; color: #fff; }
  #controls { margin-bottom: 16px; }
  input { width: 60px; background: #171c26; color: #e6e6e6; border: 1px solid #2a3140; border-radius: 4px; padding: 4px 6px; }
  button { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-weight: 600; }
  button:hover { background: #1d4ed8; }
  #map { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin: 16px 0; max-width: 640px; }
  .node { width: 100%; aspect-ratio: 1; border-radius: 50%; background: #2a3140; transition: all 0.3s; }
  .node.dialing { background: #f59e0b; animation: pulse 0.8s infinite; }
  .node.firm_yes { background: #22c55e; }
  .node.soft_yes { background: #eab308; }
  .node.no, .node.no_answer { background: #3f4656; }
  .node.never { background: #1a1f2a; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  #log { background: #10141c; border: 1px solid #2a3140; border-radius: 6px; padding: 12px; height: 240px; overflow-y: auto; font-size: 13px; margin-top: 16px; }
  .line { padding: 2px 0; }
  .firm_yes { color: #22c55e; }
  .soft_yes { color: #eab308; }
  .no, .no_answer { color: #6b7280; }
  #summary { margin-top: 16px; font-size: 14px; color: #9ca3af; }
  #summary b { color: #fff; }
</style>
</head>
<body>
  <h1>mobilize — live dispatch (simulated, zero cost)</h1>
  <div id="controls">
    pool <input id="pool_size" value="150"> need <input id="need_count" value="3">
    max calls <input id="max_calls" value="40"> seed <input id="seed" value="7">
    <button onclick="run()">Run mobilization</button>
  </div>
  <div id="map"></div>
  <div id="log"></div>
  <div id="summary"></div>

<script>
let nodes = {};
function run() {
  document.getElementById('map').innerHTML = '';
  document.getElementById('log').innerHTML = '';
  document.getElementById('summary').innerHTML = '';
  nodes = {};

  const ws = new WebSocket(`ws://${location.host}/ws/run`);
  ws.onopen = () => ws.send(JSON.stringify({
    pool_size: +document.getElementById('pool_size').value,
    need_count: +document.getElementById('need_count').value,
    max_calls: +document.getElementById('max_calls').value,
    seed: +document.getElementById('seed').value,
  }));
  ws.onmessage = (msg) => {
    const {event, data} = JSON.parse(msg.data);
    const log = document.getElementById('log');
    if (event === 'wave_dispatch') {
      for (const cid of data.candidates) {
        if (!nodes[cid]) {
          const el = document.createElement('div');
          el.className = 'node dialing';
          el.title = cid;
          document.getElementById('map').appendChild(el);
          nodes[cid] = el;
        } else {
          nodes[cid].className = 'node dialing';
        }
      }
      log.innerHTML += `<div class="line">— wave ${data.wave}: dialing ${data.candidates.length} in parallel</div>`;
    } else if (event === 'call_result') {
      if (nodes[data.candidate_id]) nodes[data.candidate_id].className = 'node ' + data.outcome;
      log.innerHTML += `<div class="line ${data.outcome}">${data.candidate_id}  ${data.outcome}  commitment=${data.commitment.toFixed(2)}</div>`;
    } else if (event === 'need_met') {
      log.innerHTML += `<div class="line firm_yes">✓ need met at ${data.time_to_fill_seconds.toFixed(1)}s — no further wave dispatched</div>`;
    } else if (event === 'final') {
      document.getElementById('summary').innerHTML =
        `<b>${data.confirmed}/${data.need_count}</b> confirmed · <b>${data.calls_used}</b> calls used · ` +
        `<b>${data.never_called}</b> of ${data.pool_size} never called · ` +
        (data.time_to_fill_seconds ? `filled in <b>${data.time_to_fill_seconds.toFixed(1)}s</b>` : 'not filled');
    }
    log.scrollTop = log.scrollHeight;
  };
}
</script>
</body>
</html>
"""


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("MOBILIZE_DASHBOARD_PORT", 8731))
    uvicorn.run(app, host="0.0.0.0", port=port)
