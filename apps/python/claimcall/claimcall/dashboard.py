"""Local dashboard: the seven-step demo workflow on one page (standard library HTTP server).

Preview and fixture runs are one click behind an approval checkbox. Live runs are
refused unless the server was started with --allow-live and CALLE_API_KEY is set;
even then they need the same explicit approval plus an exact-destination repeat.
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.parse import urlparse

from . import engine
from .analysis import analyze_case
from .calle_client import LOOPBACK_HOSTS, OFFICIAL_ORIGIN, CalleClient, CalleError, FakeCalleServer, friendly_error
from .call_plan import build_plan, build_task
from .display import mask_output
from .models import Store, mask_phone, new_case


def seed_demo_case(store: Store, app_dir: str) -> Dict[str, Any]:
    """Create the synthetic demo case. Only when none exists; never overwrites."""
    if store.exists():
        raise KeyError("a case already exists")
    with open(os.path.join(app_dir, "examples", "demo-case.json"), "r", encoding="utf-8") as f:
        seed = json.load(f)
    seed.pop("synthetic", None)
    seed.pop("note", None)
    case = new_case(**seed)
    store.save(case)
    return case


def _host_is_loopback(host_header: str) -> bool:
    host = host_header.rsplit(":", 1)[0] if host_header.count(":") == 1 else host_header
    return host.strip("[]") in LOOPBACK_HOSTS


def state_payload(case: Dict[str, Any], live_available: bool) -> Dict[str, Any]:
    analysis = analyze_case(case)
    plan = build_plan(case, analysis["missing_information"])
    out = dict(case)
    out["hotline_masked"] = mask_phone(case["airline_hotline"])
    out["airline_hotline"] = out["hotline_masked"]
    return mask_output({
        "case": out,
        "analysis": analysis,
        "plan": plan,
        "task": build_task(case, plan),
        "live_available": live_available,
    })


PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>ClaimCall</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#f4f6fa;color:#1c2230}
header{background:#152238;color:#fff;padding:14px 22px}header h1{margin:0;font-size:18px}header small{opacity:.75}
.banner{background:#fff3cd;border-bottom:1px solid #e6c200;padding:6px 22px;font-size:12px}
main{max-width:960px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid #dde3ec;border-radius:10px;padding:14px;margin-bottom:12px}
.card h2{margin:0 0 8px;font-size:15px;color:#2b6cb0}
table.ba{border-collapse:collapse;width:100%}table.ba th,table.ba td{border:1px solid #dde3ec;padding:6px 8px;text-align:left;font-size:13px}
table.ba th{background:#eef2f7}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:#e6ecf5;margin-right:4px}
.tag.resolved{background:#e3f6ea;color:#1e6b3a}.tag.needs_human{background:#fde8e8;color:#9b1c1c}.tag.partially_resolved{background:#fff4d6;color:#8a5a00}
button{background:#2b6cb0;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;font:inherit}button.ghost{background:#e6ecf5;color:#1c2230}
button:disabled{opacity:.45;cursor:not-allowed}
.commit{border-left:4px solid #16a34a;padding:6px 10px;margin:6px 0;background:#f8fafc}
.ev{background:#f8fafc;padding:6px 10px;margin:6px 0;border-left:4px solid #7c3aed;font-size:13px}
.turn{margin:2px 0;font-size:13px}.turn b{color:#2b6cb0}.turn.recipient b{color:#7c3aed}
pre{white-space:pre-wrap;background:#f8fafc;padding:8px;border-radius:6px;max-height:240px;overflow:auto;font-size:12px}
.next{background:#eef6ff;border-left:4px solid #2b6cb0;padding:8px 10px;margin:8px 0}
.q{background:#fff7ed;border-left:4px solid #f59e0b;padding:8px 10px;margin:8px 0}
small.mut{color:#64748b}
</style></head><body>
<header><h1>ClaimCall</h1><small>Your AI agent that calls airlines so you don't have to</small></header>
<div class="banner">SYNTHETIC DEMO — NOT A REAL BOOKING. Preview and fixture modes place no call.</div>
<main>
<div class="card"><h2>1. Disruption Case</h2><div id="case"></div></div>
<div class="card"><h2>2. Missing Information</h2><div id="missing"></div></div>
<div class="card"><h2>3. Call Plan</h2><div id="plan"></div></div>
<div class="card"><h2>4. Human Approval</h2>
<div id="why"></div>
<label>Call my mobile (live only, E.164): <input id="dest" placeholder="+15551234567" style="width:170px"></label><br><br>
<label><input type="checkbox" id="approve"> I approve <b>one</b> call for exactly these objectives.</label><br><br>
<select id="mode"><option value="preview">preview (no call)</option><option value="fixture" selected>fixture (synthetic, no call)</option><option value="live">live (real CALL-E call)</option></select>
<button id="go" onclick="run()">Resolve by Phone — Approve &amp; Call</button>
<span id="livestate"></span><div id="out"></div></div>
<div class="card"><h2>5. CALL-E Execution</h2><div id="exec"><small class="mut">No call yet.</small></div></div>
<div class="card"><h2>6 + 7. Outcome — Before vs After</h2><div id="outcome"><small class="mut">Run the workflow to see the state change.</small></div></div>
</main>
<script>
let S=null;
const HDR={'content-type':'application/json','x-claimcall':'dashboard'};
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function load(){const r=await fetch('/api/state');if(r.status===404){document.querySelector('main').innerHTML=`<div class="card"><h2>No case yet</h2><p>SYNTHETIC DEMO — NOT A REAL BOOKING.</p><button onclick="seed()">Load synthetic demo case</button></div>`;return}S=await r.json();render()}
async function seed(){await fetch('/api/init-demo',{method:'POST',headers:HDR});location.reload()}
function render(){
 const c=S.case;
 document.getElementById('case').innerHTML=`<b>${esc(c.passenger_name)}</b> | ${esc(c.airline)} ${esc(c.flight_no)} ${esc(c.origin)} &rarr; ${esc(c.destination)} | booking ${esc(c.booking_ref)} | <b>${esc(c.flight_status)}</b> <span class="tag ${esc(c.status)}">${esc(c.status.replace(/_/g,' '))}</span><br><small class="mut">Airline line ${esc(c.hotline_masked)} (${esc(c.region)})</small>`;
 document.getElementById('missing').innerHTML=S.analysis.missing_information.length?`<ul>${S.analysis.missing_information.map(m=>`<li>${esc(m)}</li>`).join('')}</ul><small class="mut">${esc(S.analysis.reason)} Phone call recommended: <b>${S.analysis.phone_call_recommended}</b></small>`:'<i>Nothing missing — no call needed.</i>';
 document.getElementById('plan').innerHTML=`<div><b>Purpose:</b> ${esc(S.plan.purpose)}</div><ol>${S.plan.objectives.map(o=>`<li>${esc(o)}</li>`).join('')}</ol><div><b>Restrictions:</b><ul>${S.plan.constraints.map(o=>`<li>${esc(o)}</li>`).join('')}</ul></div><details><summary>Exact CALL-E task text</summary><pre>${esc(S.task)}</pre></details>`;
 document.getElementById('why').innerHTML=`<p><b>Why is ClaimCall making this call?</b> ${esc(S.analysis.reason)} The call asks only for the ${S.analysis.missing_information.length} missing facts above.</p><p><b>What is ClaimCall allowed to do?</b> Ask the listed objectives and nothing else — no purchases, no payment details, no extra charges, no changes to unrelated bookings, no compensation decisions.</p>`;
 document.getElementById('livestate').innerHTML=S.live_available?' <small class="mut">Live CALL-E available.</small>':' <small class="mut">Live unavailable (start with --allow-live and CALLE_API_KEY).</small>';
 const last=[...c.calls].pop();
 if(last){const r=last.structured_result||{};
  document.getElementById('exec').innerHTML=`Call <b>${esc(last.id)}</b> [${esc(last.mode)}] status <b>${esc(last.status)}</b>${last.task_completed===true?' — task completed':''}<br><small class="mut">Result confidence: ${esc(last.completion_confidence||'n/a')} | idempotency ${esc(last.idempotency_key||'')}</small>${last.result_problems&&last.result_problems.length?`<div class="q">Result rejected, nothing changed: ${esc(last.result_problems.join('; '))}</div>`:''}`;
  let h='';
  if(c.before_after)h+=`<table class="ba"><tr><th></th><th>BEFORE CALL</th><th>AFTER CALL</th></tr>${c.before_after.map(x=>`<tr><td><b>${esc(x.field)}</b></td><td>${esc(x.before)}</td><td>${esc(x.after)}</td></tr>`).join('')}</table>`;
  if((c.representative_commitments||[]).length)h+=`<h3>Commitments obtained</h3>${c.representative_commitments.map(k=>`<div class="commit">&#10003; ${esc(k)}</div>`).join('')}`;
  if((last.evidence||[]).length)h+=`<h3>Evidence</h3>${last.evidence.map(e=>`<div class="ev">${esc(e)}</div>`).join('')}<details><summary>Transcript (${(last.transcript||[]).length} turns)</summary>${(last.transcript||[]).map(t=>`<div class="turn ${esc(t.speaker)}"><b>${esc(t.speaker)}</b> ${esc(t.text)}</div>`).join('')}</details>`;
  if(c.recommended_next_action)h+=`<div class="next">${esc(c.recommended_next_action)}</div>`;
  if(c.pending_question)h+=`<div class="q"><b>Needs your review:</b> ${esc(c.pending_question)}</div>`;
  document.getElementById('outcome').innerHTML=h||'<small class="mut">Call recorded but no usable result.</small>';
 }
}
async function run(){const body={mode:document.getElementById('mode').value,approved:document.getElementById('approve').checked,destination:document.getElementById('dest').value};
 const r=await fetch('/api/run',{method:'POST',headers:HDR,body:JSON.stringify(body)}).then(r=>r.json());
 const o=document.getElementById('out');
 if(r.task&&!r.placed){o.innerHTML=`<pre>${esc('PREVIEW — would dial '+r.masked_destination+'. Nothing sent.')}\n${esc(r.task)}</pre>`;return}
 if(!r.placed){o.innerHTML=`<div class="q">NO CALL: ${esc(r.reason)}</div>`;return}
 o.innerHTML='';await load()}
load();
</script></body></html>"""


def _env(key: str, app_dir: str) -> str:
    if key in os.environ:
        return os.environ[key]
    candidates = [os.path.join(app_dir, ".env")]
    here = os.path.abspath(os.getcwd())
    for _ in range(5):  # current dir, then ancestors up to the repo root
        candidates.append(os.path.join(here, ".env"))
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    for name in candidates:
        if os.path.exists(name):
            with open(name, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        if k.strip() == key:
                            return v.strip().strip('"')
    return ""


def serve(data_dir: str, host: str, port: int, fixtures_dir: str, allow_live: bool = False) -> int:
    if host not in LOOPBACK_HOSTS:
        raise SystemExit(f"the dashboard has no authentication and only binds to loopback ({', '.join(LOOPBACK_HOSTS)}); refusing {host!r}")
    store = Store(data_dir)
    app_dir = os.path.dirname(os.path.abspath(__file__))
    app_dir = os.path.dirname(app_dir)
    fake = FakeCalleServer(fixtures_dir).start()
    fixture_client = CalleClient("fixture-key", fake.base_url, allow_local_fake=True)
    live_key = _env("CALLE_API_KEY", app_dir) if allow_live else ""
    allowlist = _env("CLAIMCALL_ALLOWLIST", app_dir)
    live_available = bool(allow_live and live_key)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a: Any) -> None:
            pass

        def _json(self, code: int, payload: Any) -> None:
            body = json.dumps(mask_output(payload)).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _text(self, code: int, text: str, ctype: str = "text/html; charset=utf-8") -> None:
            body = text.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _guard(self, mutating: bool) -> bool:
            if not _host_is_loopback(self.headers.get("Host", "")):
                self._json(403, {"error": "loopback only"})
                return False
            if mutating and self.headers.get("X-ClaimCall") != "dashboard":
                self._json(403, {"error": "missing X-ClaimCall header"})
                return False
            return True

        def do_GET(self) -> None:
            if not self._guard(False):
                return
            u = urlparse(self.path)
            if u.path == "/":
                return self._text(200, PAGE)
            if u.path == "/api/state":
                if not store.exists():
                    return self._json(404, {"error": "no case; run `init-demo` first"})
                try:
                    return self._json(200, state_payload(store.load(), live_available))
                except KeyError as e:
                    return self._json(404, {"error": f"unknown case {e}"})
            return self._json(404, {"error": "not found"})

        def do_POST(self) -> None:
            if not self._guard(True):
                return
            path = urlparse(self.path).path
            if path == "/api/init-demo":
                try:
                    seed_demo_case(store, app_dir)
                except KeyError:
                    return self._json(409, {"error": "a case already exists"})
                return self._json(200, {"ok": True})
            if path != "/api/run":
                return self._json(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self._json(400, {"error": "invalid JSON"})
            mode = body.get("mode", "preview")
            approved = body.get("approved") is True
            destination = (body.get("destination") or "").strip() or None
            if not store.exists():
                return self._json(404, {"placed": False, "reason": "no case; run `init-demo` first"})
            case = store.load()
            if mode == "preview":
                res = engine.preview(case)
                return self._json(200, {"placed": False, "task": res["task"], "masked_destination": res["masked_destination"]})
            if not approved:
                return self._json(200, {"placed": False, "reason": "refused: tick the approval checkbox to approve exactly one call"})
            try:
                if mode == "fixture":
                    res = engine.run(case, "fixture", client=fixture_client, approved=True)
                elif mode == "live":
                    if not live_available:
                        return self._json(200, {"placed": False,
                                                "reason": "refused: live calls need --allow-live plus CALLE_API_KEY on the server"})
                    client = CalleClient(live_key, OFFICIAL_ORIGIN)
                    res = engine.run(case, "live", client=client, approved=True,
                                     allowlist=allowlist, api_key_present=True,
                                     live_destination=destination)
                else:
                    return self._json(400, {"placed": False, "reason": f"unknown mode {mode!r}"})
            except CalleError as e:
                return self._json(200, {"placed": False, "reason": friendly_error(e)})
            if res.get("placed"):
                store.save(case)
                return self._json(200, {"placed": True, "reason": "ok"})
            return self._json(200, {"placed": False, "reason": res.get("reason", "refused")})

    print(f"ClaimCall dashboard at http://{host}:{port} (loopback only; SYNTHETIC DEMO, no real booking)")
    try:
        ThreadingHTTPServer((host, port), H).serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        fake.stop()
    return 0
