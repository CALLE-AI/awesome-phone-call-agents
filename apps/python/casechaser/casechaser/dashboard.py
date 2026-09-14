"""Local dashboard: one HTML page plus a small JSON API on the standard library HTTP server.

Fixture and preview runs are one click. A live run is deliberately not exposed here; it needs
the CLI with --mode live --yes so a real call is always an explicit, logged decision.
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

from . import engine, policy
from .client import LOOPBACK_HOSTS, CalleClient, FakeCalleServer
from .models import Ledger, mask_phone


def _host_is_loopback(host_header: str) -> bool:
    host = host_header.rsplit(":", 1)[0] if host_header.count(":") == 1 else host_header
    return host.strip("[]") in LOOPBACK_HOSTS

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>CaseChaser</title>
<style>
body{font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#f4f6fa;color:#1c2230}
header{background:#152238;color:#fff;padding:14px 22px}header h1{margin:0;font-size:18px}header small{opacity:.75}
main{display:grid;grid-template-columns:360px 1fr;gap:16px;padding:16px}
.card{background:#fff;border:1px solid #dde3ec;border-radius:10px;padding:14px;margin-bottom:12px}
.case{cursor:pointer}.case.active{outline:2px solid #2b6cb0}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:#e6ecf5;margin-right:4px}
.tag.needs_human{background:#fde8e8;color:#9b1c1c}.tag.resolved{background:#e3f6ea;color:#1e6b3a}.tag.waiting_on_company{background:#fff4d6;color:#8a5a00}
button{background:#2b6cb0;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;font:inherit}button.ghost{background:#e6ecf5;color:#1c2230}
select,input,textarea{font:inherit;padding:6px;border:1px solid #cbd5e1;border-radius:6px}
.q{background:#fff7ed;border-left:4px solid #f59e0b;padding:8px 10px;margin:8px 0}
.commit{border-left:4px solid #94a3b8;padding:6px 10px;margin:6px 0;background:#f8fafc}.commit.broken{border-color:#dc2626}.commit.kept{border-color:#16a34a}
.turn{margin:2px 0}.turn b{color:#2b6cb0}.turn.recipient b{color:#7c3aed}
pre{white-space:pre-wrap;background:#f8fafc;padding:8px;border-radius:6px;max-height:280px;overflow:auto;font-size:12px}
.held{color:#8a5a00;font-size:12px}.ok{color:#1e6b3a;font-size:12px}
</style></head><body>
<header><h1>CaseChaser</h1><small>chase an open case to closure by phone; money and legal decisions stop at you</small></header>
<main><aside id="list"></aside><section id="detail"><div class="card">Select a case.</div></section></main>
<script>
let cases=[],sel=null;
const HDR={'content-type':'application/json','x-casechaser':'dashboard'};async function api(p,o){const r=await fetch(p,o);return r.json()}
let lastJson='';async function load(){const j=await fetch('/api/cases').then(r=>r.text());if(j===lastJson)return;lastJson=j;cases=JSON.parse(j);renderList();if(sel&&document.activeElement?.id!=='dec')renderDetail()}
function renderList(){document.getElementById('list').innerHTML=cases.map(c=>`<div class="card case ${sel===c.id?'active':''}" data-id="${esc(c.id)}">
<b>${esc(c.company)}</b> <span class="tag ${cls(c.status)}">${esc(c.status.replace(/_/g,' '))}</span><br><small>${esc(c.reference)} for ${esc(c.customer_name)} (${esc(String(c.case_type).replace(/_/g,' '))})</small><br>
<small>calls ${Number(c.calls.length)} | escalation ${esc(['agent','supervisor','written complaint','regulator'][c.escalation_level]||'agent')}</small><br>
${c.gate.length?`<span class="held">held: ${esc(c.gate[0][0])}</span>`:`<span class="ok">callable now</span>`}</div>`).join('')}
function cls(s){return String(s??'').replace(/[^a-z_]/g,'')}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
document.getElementById('list').addEventListener('click',e=>{const el=e.target.closest('.case');if(!el)return;sel=el.dataset.id;renderList();renderDetail()});
function renderDetail(){const c=cases.find(x=>x.id===sel);if(!c)return;
let h=`<div class="card"><h2 style="margin:0 0 4px">${esc(c.company)} <span class="tag ${cls(c.status)}">${esc(c.status.replace(/_/g,' '))}</span></h2>
<div>${esc(c.reference)} for ${esc(c.customer_name)} | hotline ${esc(c.hotline_masked)} (${esc(c.region)}) | opened ${esc(c.opened_on)}</div>
<div style="margin:6px 0"><b>Owed:</b> ${esc(c.what_is_owed)}</div>
${c.gate.length?`<div class="held">Not callable now: ${c.gate.map(g=>esc(g[1])).join(' ')}</div>`:'<div class="ok">Policy: callable now.</div>'}
${c.pending_question?`<div class="q"><b>Needs your decision:</b> ${esc(c.pending_question)}<br><textarea id="dec" rows="2" style="width:100%;margin-top:6px" placeholder="Your decision, carried into the next call"></textarea><br>
<button onclick="decide()">Record decision and resume</button> <button class="ghost" onclick="decide('resolve')">Close as resolved</button> <button class="ghost" onclick="decide('abandon')">Abandon</button></div>`:''}
<div style="margin-top:10px"><select id="sc">${['first_call_commitment','broken_promise_supervisor','offer_made','needs_customer_action','identity_refused','unreached_voicemail','resolved'].map(s=>`<option>${esc(s)}</option>`).join('')}</select>
<button onclick="run('fixture')">Run fixture call (no real call)</button> <button class="ghost" onclick="run('preview')">Preview task</button> <label><input type="checkbox" id="force"> ignore policy holds (fixture demo only; never applies to live)</label>
<a style="margin-left:10px" href="/api/evidence/${encodeURIComponent(c.id)}" target="_blank">Evidence pack</a></div>
<div id="out"></div></div>`;
h+=`<div class="card"><h3 style="margin:0 0 6px">Commitments</h3>${c.commitments.length?c.commitments.map(k=>`<div class="commit ${cls(k.status)}"><b>${esc(k.status)}</b> ${esc(k.action)} by ${esc(k.by_date||'unspecified')}<br><i>"${esc(k.quote)}"</i> (${esc(k.who)})</div>`).join(''):'<small>none yet</small>'}</div>`;
h+=`<div class="card"><h3 style="margin:0 0 6px">Calls</h3>${[...c.calls].reverse().map(k=>{const r=k.structured_result||{};return `<div class="commit"><b>${esc(k.created_at.slice(0,16).replace('T',' '))}</b> [${esc(k.mode)}] outcome <b>${esc(r.outcome||k.status)}</b> -> ${esc(k.disposition)}${r.representative?` | spoke to ${esc(r.representative)}`:''}${r.reference_number?` | ref ${esc(r.reference_number)}`:''}<br>
${r.status_statement?`<i>"${esc(r.status_statement)}"</i><br>`:''}${(k.evidence||[]).map(e=>`<small>evidence: ${esc(e)}</small><br>`).join('')}
<details><summary>transcript (${(k.transcript||[]).length} turns)</summary>${(k.transcript||[]).map(t=>`<div class="turn ${cls(t.speaker)}"><b>${esc(t.speaker)}</b> ${esc(t.text)}</div>`).join('')}</details></div>`}).join('')||'<small>no calls yet</small>'}</div>`;
document.getElementById('detail').innerHTML=h}
async function run(mode){const c=cases.find(x=>x.id===sel);const body={case:c.id,mode,scenario:document.getElementById('sc').value,force:document.getElementById('force').checked};
const r=await api('/api/run',{method:'POST',headers:HDR,body:JSON.stringify(body)});
await load();const o=document.getElementById('out');if(o)o.innerHTML=r.request?`<pre>${esc(r.request.task)}</pre>`:`<pre>${esc(r.placed?('call placed: '+r.reason):'NO CALL: '+r.reason)}</pre>`}
async function decide(close){const c=cases.find(x=>x.id===sel);const d=document.getElementById('dec').value||(close?'closed by customer':'');
await api('/api/decide',{method:'POST',headers:HDR,body:JSON.stringify({case:c.id,decision:d,close:close||null})});await load()}
load();setInterval(()=>{if(document.activeElement?.id!=='dec')load()},5000);
</script></body></html>"""


def serve(data_dir: str, host: str, port: int, fixtures_dir: str) -> int:
    if host not in LOOPBACK_HOSTS:
        raise SystemExit(f"the dashboard has no authentication and only binds to loopback ({', '.join(LOOPBACK_HOSTS)}); refusing {host!r}")
    ledger = Ledger(data_dir)
    fake = FakeCalleServer(fixtures_dir).start()
    client = CalleClient("fixture-key", fake.base_url, allow_local_fake=True)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a: Any) -> None:
            pass

        def _json(self, code: int, payload: Any) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def _text(self, code: int, text: str, ctype: str = "text/html; charset=utf-8") -> None:
            body = text.encode("utf-8")
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def _guard(self, mutating: bool) -> bool:
            # Host check defeats DNS rebinding; the custom header on writes defeats cross-site form posts.
            if not _host_is_loopback(self.headers.get("Host", "")):
                self._json(403, {"error": "loopback only"}); return False
            if mutating and self.headers.get("X-CaseChaser") != "dashboard":
                self._json(403, {"error": "missing X-CaseChaser header"}); return False
            return True

        def do_GET(self) -> None:
            if not self._guard(False):
                return
            u = urlparse(self.path)
            if u.path == "/":
                return self._text(200, PAGE)
            if u.path == "/api/cases":
                out = []
                for c in ledger.list_cases():
                    c = dict(c); c["gate"] = policy.suppression_reasons(c)
                    c["hotline_masked"] = mask_phone(c["hotline"]); c["hotline"] = c["hotline_masked"]; out.append(c)
                return self._json(200, out)
            if u.path.startswith("/api/evidence/"):
                cid = u.path.rsplit("/", 1)[1]
                try:
                    return self._text(200, engine.evidence_pack(ledger.get(cid)), "text/plain; charset=utf-8")
                except KeyError:
                    return self._json(404, {"error": "no such case"})
            self._json(404, {"error": "not found"})

        def do_POST(self) -> None:
            if not self._guard(True):
                return
            u = urlparse(self.path)
            n = int(self.headers.get("Content-Length", "0")); body: Dict[str, Any] = json.loads(self.rfile.read(n) or b"{}")
            if u.path == "/api/run":
                mode = body.get("mode", "preview")
                if mode not in ("preview", "fixture"):
                    return self._json(403, {"placed": False, "reason": "live calls are only available from the CLI with --mode live --yes and an authorization record"})
                try:
                    res = engine.run_cycle(ledger, body["case"], mode, client=client, fixture_scenario=body.get("scenario"), force=bool(body.get("force")))
                except KeyError:
                    return self._json(404, {"error": "no such case"})
                return self._json(200, {k: v for k, v in res.items() if k != "case"})
            if u.path == "/api/decide":
                try:
                    case = engine.record_decision(ledger, body["case"], str(body.get("decision", ""))[:2000], resume=not body.get("close"))
                except KeyError:
                    return self._json(404, {"error": "no such case"})
                if body.get("close"):
                    case["status"] = "abandoned" if body["close"] == "abandon" else "resolved"; ledger.upsert(case)
                return self._json(200, {"status": case["status"]})
            self._json(404, {"error": "not found"})

    httpd = ThreadingHTTPServer((host, port), H)
    print(f"CaseChaser dashboard at http://{host}:{port}  (loopback only, no authentication; fixture CALL-E at {fake.base_url}; no real calls from this UI)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        fake.stop(); httpd.server_close()
    return 0
