"""
Web dashboard for Vendor Discovery & Outreach.
Run: python dashboard.py
Open: http://127.0.0.1:5000
"""
import json
import os as _os
import winreg as _winreg

def _load_user_env_vars():
    """Pull GROQ_API_KEY* from Windows user environment (registry) so the dashboard
    works regardless of which shell or launcher invokes it."""
    try:
        key = _winreg.OpenKey(_winreg.HKEY_CURRENT_USER, r"Environment")
        i = 0
        while True:
            try:
                name, value, _ = _winreg.EnumValue(key, i)
                if name.startswith("GROQ_API_KEY") and not _os.environ.get(name):
                    _os.environ[name] = value
                i += 1
            except OSError:
                break
        _winreg.CloseKey(key)
    except Exception:
        pass

_load_user_env_vars()

from flask import Flask, jsonify, render_template_string, Response, stream_with_context, request
import queue as _queue
from models import get_conn, init_db, _mask_phone
from scheduler import start_scheduler_thread

app = Flask(__name__)

_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CALL-E | Outreach Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
/* ═══════════════════════════════════════════════════════════════
   CALL-E — Outreach Intelligence · Redesigned app shell
   Design language: Linear / Vercel / Supabase / Mixpanel
   ═══════════════════════════════════════════════════════════════ */
:root{
  --bg:#07080f;
  --sidebar:rgba(12,13,22,.95);
  --card:rgba(18,20,34,.8);
  --card-solid:#12141f;
  --accent:#6366f1;
  --accent-2:#8b5cf6;
  --success:#22c55e;
  --warning:#f59e0b;
  --error:#ef4444;
  --info:#3b82f6;
  --border:rgba(255,255,255,.06);
  --border-strong:rgba(255,255,255,.1);
  --txt:#c7ccd6;
  --txt-bright:#f0f4ff;
  --txt-dim:#6b7280;
  --sidebar-w:220px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{
  font-family:'Inter','Segoe UI',system-ui,sans-serif;
  background:var(--bg);
  background-image:
    radial-gradient(1100px 560px at 8% -10%,rgba(99,102,241,.10),transparent 60%),
    radial-gradient(1000px 620px at 100% 0%,rgba(139,92,246,.09),transparent 60%),
    radial-gradient(900px 900px at 50% 130%,rgba(59,130,246,.05),transparent 60%);
  background-attachment:fixed;
  color:var(--txt);
  font-size:14px;
  letter-spacing:.004em;
  min-height:100vh;
}
::selection{background:rgba(99,102,241,.34);color:#fff}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(139,146,166,.2);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(139,146,166,.4);background-clip:padding-box}
h1{color:var(--accent);font-size:1.35rem;margin-bottom:2px}
.sub{color:var(--txt-dim);font-size:.72rem}
.sub a{color:#818cf8;text-decoration:none;transition:color .15s}
.sub a:hover{color:#a5b4fc}

/* ══════════ APP SHELL ══════════ */
.app-shell{display:flex;min-height:100vh;align-items:stretch}

/* ── SIDEBAR ── */
.sidebar{
  width:var(--sidebar-w);flex-shrink:0;position:sticky;top:0;align-self:flex-start;
  height:100vh;display:flex;flex-direction:column;
  background:var(--sidebar);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border-right:1px solid var(--border);
  padding:20px 14px;z-index:60;
  animation:sidebar-in .5s cubic-bezier(.22,1,.36,1);
}
@keyframes sidebar-in{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)}}
.sb-brand{display:flex;align-items:center;gap:11px;padding:6px 8px 4px}
.sb-logo{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,rgba(99,102,241,.22),rgba(139,92,246,.2));
  border:1px solid rgba(99,102,241,.4);box-shadow:0 0 20px rgba(99,102,241,.28);flex-shrink:0}
.sb-brand-txt{line-height:1.15}
.sb-name{font-size:1.02rem;font-weight:800;letter-spacing:.4px;
  background:linear-gradient(90deg,#a5b4fc,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent}
.sb-sub{font-size:.6rem;color:#8b93a7;letter-spacing:.4px;text-transform:uppercase;font-weight:600}
.sb-divider{height:1px;background:var(--border);margin:16px 6px}
.sb-nav{display:flex;flex-direction:column;gap:3px;flex:1}
.sb-nav-label{font-size:.6rem;color:#565d6e;text-transform:uppercase;letter-spacing:.1em;font-weight:700;padding:0 10px 8px}
.sb-item{
  display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;
  color:#9aa1b3;font-size:.86rem;font-weight:500;cursor:pointer;border:none;background:transparent;
  font-family:inherit;text-align:left;width:100%;
  transition:transform .16s cubic-bezier(.22,1,.36,1),color .16s,background .16s;
}
.sb-item .sb-ico{font-size:1rem;width:20px;text-align:center;flex-shrink:0;line-height:1}
.sb-item:hover{background:rgba(255,255,255,.04);color:#e6e9f0;transform:translateX(2px)}
.sb-item.active{
  background:linear-gradient(135deg,rgba(99,102,241,.9),rgba(139,92,246,.85));
  color:#fff;box-shadow:0 6px 18px -6px rgba(99,102,241,.7),0 1px 0 rgba(255,255,255,.2) inset;
}
.sb-item.active:hover{transform:translateX(0)}
.sb-newcamp{
  margin-top:12px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;
  background:linear-gradient(135deg,var(--accent),var(--accent-2));border:none;color:#fff;
  font-size:.85rem;font-weight:700;padding:11px;border-radius:11px;cursor:pointer;font-family:inherit;
  box-shadow:0 8px 24px -8px rgba(99,102,241,.7),0 1px 0 rgba(255,255,255,.18) inset;
  transition:transform .18s,box-shadow .18s;
}
.sb-newcamp:hover{transform:translateY(-1px);box-shadow:0 14px 30px -8px rgba(139,92,246,.8)}
.sb-newcamp.active{background:rgba(22,25,37,.85);border:1px solid rgba(99,102,241,.5);color:#a5b4fc;box-shadow:none}
.sb-foot{padding:10px 8px 2px;font-size:.6rem;color:#4a5060;line-height:1.5}
.sb-foot a{color:#6b7280;text-decoration:none}
.sb-foot a:hover{color:#818cf8}

/* ── MAIN CONTENT ── */
.main{flex:1;min-width:0;padding:28px;max-height:100vh;overflow-y:auto}

/* ── TOP BAR ── */
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap}
.topbar-title{font-size:1.4rem;font-weight:800;letter-spacing:-.025em;color:var(--txt-bright);
  background:linear-gradient(120deg,#eef2ff 0%,#c7d2fe 55%,#ddd6fe 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.topbar-sub{font-size:.72rem;color:var(--txt-dim);margin-top:2px;font-weight:450}
.topbar-right{display:flex;align-items:center;gap:12px}
.live-badge{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;font-size:.66rem;font-weight:700;letter-spacing:.6px;color:#4ade80;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.26)}
.live-dot-nav{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 0 0 rgba(34,197,94,.55);animation:livePulse 1.6s infinite}
@keyframes livePulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.refresh-tag{font-size:.66rem;color:#7a8290;background:rgba(18,20,34,.7);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--border);padding:5px 12px;border-radius:20px;font-variant-numeric:tabular-nums}

/* ══════════ SECTION HEADERS ══════════ */
.section-head{display:flex;align-items:center;gap:12px;margin:6px 0 16px;flex-wrap:wrap}
.section-head h2{font-size:1.1rem;font-weight:700;color:var(--txt-bright);letter-spacing:-.02em}
.section-count{font-size:.7rem;font-weight:700;color:#a5b4fc;background:rgba(99,102,241,.14);border:1px solid rgba(99,102,241,.3);border-radius:20px;padding:2px 10px}
.filter-pills{display:flex;gap:6px;margin-left:auto}
.filter-pill{font-size:.72rem;font-weight:600;color:#9aa1b3;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:5px 13px;cursor:pointer;font-family:inherit;transition:all .15s}
.filter-pill:hover{color:#e6e9f0;border-color:var(--border-strong)}
.filter-pill.active{color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2));border-color:transparent;box-shadow:0 6px 16px -8px rgba(99,102,241,.7)}

/* ══════════ HERO METRIC CARDS ══════════ */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:26px}
@media(max-width:1000px){.stats{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.stats{grid-template-columns:1fr}}
.stat{
  position:relative;background:linear-gradient(180deg,rgba(24,27,44,.85),rgba(15,17,30,.85));
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid var(--border);border-radius:16px;padding:20px 22px 18px;overflow:hidden;
  box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 12px 34px -20px rgba(0,0,0,.9);
  opacity:0;animation:metric-in .5s cubic-bezier(.22,1,.36,1) forwards;
  transition:transform .22s cubic-bezier(.34,1.4,.5,1),border-color .22s,box-shadow .22s;
}
.stat:nth-child(1){animation-delay:0s}
.stat:nth-child(2){animation-delay:.08s}
.stat:nth-child(3){animation-delay:.16s}
.stat:nth-child(4){animation-delay:.24s}
.stat:nth-child(5){animation-delay:.32s}
@keyframes metric-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.stat:hover{transform:translateY(-3px);border-color:rgba(99,102,241,.36);box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 20px 44px -20px rgba(99,102,241,.5)}
.stat-n{font-size:2rem;font-weight:800;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums;
  background:linear-gradient(120deg,#c7d2fe,#ddd6fe);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#c7d2fe}
.stat-l{font-size:.66rem;color:var(--txt-dim);text-transform:uppercase;letter-spacing:.09em;font-weight:600;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.stat-trend{font-size:.66rem;font-weight:700;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;gap:2px}
.stat-trend.up{color:#4ade80}
.stat-trend.down{color:#f87171}
.stat-trend.flat{color:#9aa1b3}
.stat-spark{position:absolute;bottom:0;left:0;right:0;height:34px;opacity:.55;pointer-events:none}

/* Scheduled calls banner */
.sched-banner{background:#162016;border:1px solid #2a5a2a;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:.82rem}
.sched-banner h3{color:#56d364;font-size:.85rem;margin-bottom:6px}
.sched-item{display:flex;gap:10px;padding:4px 0;border-bottom:1px solid #1e3a1e;align-items:center}
.sched-item:last-child{border-bottom:none}
.sched-time{color:#e3b341;min-width:160px;font-size:.78rem}
.sched-status{font-size:.7rem;padding:1px 7px;border-radius:8px}
.ss-pending{background:#1a3a1a;color:#56d364}
.ss-fired{background:#1a2a3a;color:#58a6ff}
.ss-failed{background:#3a1a1a;color:#f85149}
.ss-skipped{background:#21262d;color:#888}

/* Campaign card */
.campaign{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:20px}
.camp-hdr{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #21262d;flex-wrap:wrap;gap:6px}
.camp-title{font-size:.95rem;font-weight:600;color:#f0f6fc}
.camp-meta{font-size:.72rem;color:#666}
.consent-ok{font-size:.68rem;padding:2px 8px;border-radius:10px;background:#1a3a1a;color:#56d364;border:1px solid #2a5a2a}
.consent-no{font-size:.68rem;padding:2px 8px;border-radius:10px;background:#3a1a1a;color:#f85149;border:1px solid #5a2a2a}

/* Table */
table{width:100%;border-collapse:collapse;font-size:.8rem}
thead th{background:#21262d;color:#8b949e;text-align:left;padding:7px 10px;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #30363d}
tbody tr.lead-row{cursor:pointer;transition:background .15s}
tbody tr.lead-row:hover{background:#1c2128}
tbody tr.lead-row td{padding:8px 10px;border-bottom:1px solid #21262d;vertical-align:middle}
tbody tr.lead-row:last-of-type td{border-bottom:none}

/* Expand panel */
tr.expand-row{display:none}
tr.expand-row.open{display:table-row}
tr.expand-row td{padding:0}
.expand-inner{background:#0d1117;border-top:1px solid #30363d;padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:700px){.expand-inner{grid-template-columns:1fr}}
.exp-section{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:12px}
.exp-section h4{font-size:.75rem;text-transform:uppercase;letter-spacing:.07em;color:#8b949e;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #21262d}
.exp-section.full{grid-column:1/-1}

/* Transcript */
.transcript-line{display:flex;gap:8px;padding:3px 0;font-size:.78rem;border-bottom:1px solid #1a1f26}
.transcript-line:last-child{border-bottom:none}
.t-time{color:#555;min-width:55px;font-family:monospace}
.t-bot{color:#58a6ff;min-width:45px;font-weight:600}
.t-user{color:#56d364;min-width:45px;font-weight:600}
.t-text{color:#c9d1d9;flex:1}

/* Inference grid */
.inf-row{display:flex;padding:3px 0;border-bottom:1px solid #1a1f26;font-size:.78rem}
.inf-row:last-child{border-bottom:none}
.inf-key{color:#8b949e;min-width:130px;flex-shrink:0}
.inf-val{color:#c9d1d9;flex:1;word-break:break-word}

/* Raw JSON modal */
.modal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;align-items:center;justify-content:center}
.modal-backdrop.open{display:flex}
.modal-box{background:#161b22;border:1px solid #30363d;border-radius:10px;width:min(90vw,780px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #30363d}
.modal-head h3{font-size:.85rem;color:#f0f6fc}
.modal-close{background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;padding:0 4px;line-height:1}
.modal-close:hover{color:#f85149}
.modal-body{overflow:auto;padding:14px 16px;flex:1}
pre.json-view{font-family:monospace;font-size:.76rem;color:#c9d1d9;white-space:pre-wrap;word-break:break-all;margin:0}
.raw-btn{font-size:.62rem;background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:1px 7px;cursor:pointer;margin-left:6px;vertical-align:middle}
.raw-btn:hover{color:#58a6ff;border-color:#58a6ff}

/* Address */
.address-tag{font-size:.72rem;color:#8b949e;font-style:italic;padding:2px 0}

/* Scheduled tag on lead row */
.sched-tag{font-size:.68rem;background:#162016;color:#56d364;border:1px solid #2a4a2a;border-radius:8px;padding:1px 7px;white-space:nowrap}

/* Status badges */
.status{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:600}
.s-positive{background:#1a3a1a;color:#56d364}
.s-negative{background:#3a1a1a;color:#f85149}
.s-no_answer{background:#2a2a1a;color:#e3b341}
.s-completed{background:#1a2a3a;color:#58a6ff}
.s-not_called{background:#21262d;color:#8b949e}
.s-failed{background:#3a1a1a;color:#f85149}
.s-skipped{background:#21262d;color:#666}
.s-positive_r2{background:#1a2a3a;color:#58a6ff}

/* Chevron */
.chev{color:#444;font-size:.9rem;transition:transform .2s;display:inline-block;margin-right:4px}
.chev.open{transform:rotate(90deg)}

/* Copy button */
.copy-btn{font-size:.65rem;background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:1px 5px;cursor:pointer}
.copy-btn:hover{color:#58a6ff}

/* Tabs (legacy — hidden; nav lives in sidebar now) */
.tabs{display:none}
.view{display:none;animation:view-in .35s cubic-bezier(.22,1,.36,1)}
.view.active{display:block}
@keyframes view-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

/* ══════════ ANALYTICS — BENTO GRID ══════════ */
.chart-grid{display:grid;grid-template-columns:1fr 2fr;grid-auto-rows:auto;gap:18px;margin-bottom:22px}
.chart-grid .chart-card:nth-child(3){grid-column:1 / -1}
@media(max-width:900px){.chart-grid{grid-template-columns:1fr}.chart-grid .chart-card:nth-child(3){grid-column:auto}}
.chart-card{background:linear-gradient(180deg,rgba(20,22,38,.82),rgba(13,15,26,.85));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:18px;padding:20px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 44px -30px rgba(0,0,0,.9);transition:transform .22s cubic-bezier(.34,1.4,.5,1),border-color .22s}
.chart-card:hover{transform:translateY(-2px);border-color:rgba(139,92,246,.3)}
.chart-card h3{font-size:.72rem;color:#8b92a6;text-transform:uppercase;letter-spacing:.09em;margin-bottom:14px;font-weight:700}
.bench-card{background:linear-gradient(180deg,rgba(20,22,38,.82),rgba(13,15,26,.85));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:18px;padding:20px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 44px -30px rgba(0,0,0,.9)}
.bench-card h3{font-size:.95rem;color:var(--txt-bright);margin-bottom:14px;font-weight:700;letter-spacing:-.015em}
#map-view .campaign{margin-bottom:0}
#map-view{position:relative;border-radius:16px;overflow:hidden;border:1px solid var(--border);box-shadow:0 20px 44px -30px rgba(0,0,0,.9)}
.leaflet-popup-content-wrapper{background:rgba(18,20,34,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:12px;color:#c7ccd6;box-shadow:0 20px 60px rgba(0,0,0,0.8)}
.leaflet-popup-tip{background:rgba(18,20,34,0.97)}
.leaflet-popup-close-button{color:#8b92a6!important}
.leaflet-popup-close-button:hover{color:#ff6b64!important}
/* Map filter bar */
.map-filter-bar{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:600;display:flex;gap:6px;background:rgba(12,13,22,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:5px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 12px 30px -12px rgba(0,0,0,.8)}
.map-filter-btn{font-size:.7rem;font-weight:600;color:#9aa1b3;background:transparent;border:none;border-radius:7px;padding:5px 11px;cursor:pointer;font-family:inherit;transition:all .15s}
.map-filter-btn:hover{color:#e6e9f0;background:rgba(255,255,255,.05)}
.map-filter-btn.active{color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2))}
/* Map stats overlay */
.map-stats-ctrl{background:rgba(12,13,22,0.95)!important;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 13px;font-size:11px;line-height:1.7;color:#c7ccd6;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 12px 30px -12px rgba(0,0,0,.8)}
.map-stats-ctrl .mst-title{font-weight:700;color:#c7d2fe;margin-bottom:3px}
.map-stats-ctrl .mst-row{display:flex;gap:10px;flex-wrap:wrap}

/* ══════════ LIVE CONSOLE — TERMINAL ══════════ */
.live-term-head{display:flex;align-items:center;gap:9px;background:#0b0c12;border:1px solid var(--border);border-bottom:none;border-radius:12px 12px 0 0;padding:9px 14px;font-family:'JetBrains Mono',monospace;font-size:.7rem;letter-spacing:.12em;font-weight:600;color:#8b92a6}
.live-term-head .lt-dot{width:9px;height:9px;border-radius:50%;background:var(--error);box-shadow:0 0 10px var(--error);animation:pulse 1.3s infinite}
.live-term-head .lt-dots{display:flex;gap:6px;margin-left:auto}
.live-term-head .lt-dots span{width:9px;height:9px;border-radius:50%}
.live-term-head .lt-dots span:nth-child(1){background:#ff5f57}
.live-term-head .lt-dots span:nth-child(2){background:#febc2e}
.live-term-head .lt-dots span:nth-child(3){background:#28c840}
.live-console{background:#050508;border:1px solid var(--border);border-radius:0 0 12px 12px;padding:16px;font-family:'JetBrains Mono',monospace;font-size:.78rem;min-height:120px;max-height:420px;overflow-y:auto;box-shadow:inset 0 2px 26px rgba(0,0,0,.7);line-height:1.65}
.live-console::after{content:'▊';color:#22c55e;animation:cursor-blink 1s step-end infinite;display:inline-block;margin-top:2px}
@keyframes cursor-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
.live-line{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03);display:flex;gap:10px;animation:live-in .3s ease}
@keyframes live-in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
.live-line:last-child{border-bottom:none}
.live-ts{color:#4a5060;min-width:56px}
.live-status{color:#22c55e;font-weight:600;min-width:80px}
.live-text{color:#c7ccd6;flex:1}
.live-empty{color:#565d6e;font-style:italic;font-size:.75rem;padding:8px 0}
.live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* Reliability badge */
.rel-badge{font-size:.62rem;padding:1px 6px;border-radius:8px;font-weight:600;margin-left:4px}
.rel-green{background:#1a3a1a;color:#56d364;border:1px solid #2a5a2a}
.rel-amber{background:#2a2a1a;color:#e3b341;border:1px solid #4a4a2a}
.rel-red{background:#3a1a1a;color:#f85149;border:1px solid #5a2a2a}
.rel-grey{background:#21262d;color:#666}

/* Template selector */
.tpl-bar{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:.8rem}
.tpl-bar label{color:#8b949e;font-size:.75rem}
.tpl-select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:4px;padding:3px 8px;font-size:.78rem}
.tpl-save-btn{font-size:.72rem;background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:3px 10px;cursor:pointer}
.tpl-save-btn:hover{color:#58a6ff;border-color:#58a6ff}

/* ── New Campaign Wizard ── */
.nc-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.nc-open-btn{background:#1f6feb;border:none;color:#fff;font-size:.82rem;font-weight:600;padding:7px 18px;border-radius:6px;cursor:pointer;transition:background .15s;font-family:inherit}
.nc-open-btn:hover{background:#388bfd}
.nc-open-btn.active{background:#21262d;border:1px solid #388bfd;color:#58a6ff}
.wizard{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px 22px;margin-bottom:20px;display:none}
.wizard.open{display:block}
.wizard h2{font-size:.9rem;font-weight:700;color:#f0f6fc;margin-bottom:16px;letter-spacing:.04em;text-transform:uppercase}
.wiz-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:650px){.wiz-form{grid-template-columns:1fr}}
.wiz-field{display:flex;flex-direction:column;gap:5px}
.wiz-field.full{grid-column:1/-1}
.wiz-label{font-size:.72rem;color:#8b949e;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.wiz-input{background:#0d1117;border:1px solid #30363d;color:#e0e0e0;border-radius:6px;padding:8px 12px;font-size:.85rem;font-family:inherit;outline:none;transition:border .15s}
.wiz-input:focus{border-color:#388bfd}
.wiz-select{background:#0d1117;border:1px solid #30363d;color:#e0e0e0;border-radius:6px;padding:8px 12px;font-size:.85rem;font-family:inherit;outline:none;cursor:pointer}
.wiz-actions{grid-column:1/-1;display:flex;gap:10px;align-items:center;margin-top:4px}
.btn-primary{background:#1f6feb;border:none;color:#fff;font-size:.85rem;font-weight:600;padding:9px 24px;border-radius:6px;cursor:pointer;font-family:inherit;transition:background .15s}
.btn-primary:hover{background:#388bfd}
.btn-primary:disabled{background:#21262d;color:#555;cursor:not-allowed}
.btn-secondary{background:#21262d;border:1px solid #30363d;color:#8b949e;font-size:.82rem;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:inherit}
.btn-secondary:hover{color:#c9d1d9;border-color:#58a6ff}
.wiz-error{color:#f85149;font-size:.78rem;margin-top:4px}
.wiz-spinner{display:none;align-items:center;gap:8px;color:#8b949e;font-size:.8rem}
.wiz-spinner.on{display:flex}
.spin{width:14px;height:14px;border:2px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
/* Step 2 - Vendor Preview */
.vendor-preview{margin-top:16px;display:none}
.vendor-preview.on{display:block}
.preview-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px}
.preview-title{font-size:.88rem;font-weight:600;color:#f0f6fc}
.preview-meta{font-size:.73rem;color:#8b949e}
.preview-table{width:100%;border-collapse:collapse;font-size:.8rem;margin-bottom:16px}
.preview-table th{background:#21262d;color:#8b949e;text-align:left;padding:6px 10px;font-size:.67rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #30363d}
.preview-table td{padding:7px 10px;border-bottom:1px solid #21262d;vertical-align:middle;color:#c9d1d9}
.preview-table tr:last-child td{border-bottom:none}
.score-pill{display:inline-block;padding:2px 9px;border-radius:10px;font-size:.7rem;font-weight:700}
.score-hi{background:#1a3a1a;color:#56d364}
.score-mid{background:#2a2a1a;color:#e3b341}
.score-lo{background:#3a1a1a;color:#f85149}
.start-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.calling-status{font-size:.8rem;color:#56d364;display:none}
.calling-status.on{display:block}

/* ── Callie AI Chatbot ── */
.callie-btn{position:fixed;bottom:24px;right:24px;z-index:9000;cursor:pointer;border:none;background:none;padding:0;display:flex;flex-direction:column;align-items:center;gap:4px}
.callie-orb{width:54px;height:54px;border-radius:50%;background:transparent;display:flex;align-items:center;justify-content:center;transition:transform .25s cubic-bezier(.34,1.56,.64,1),filter .25s ease;position:relative;filter:drop-shadow(0 0 1px rgba(88,166,255,.8)) drop-shadow(0 6px 18px rgba(37,99,235,.45));animation:callie-breathe 4s ease-in-out infinite}
.callie-orb:hover{transform:translateY(-3px) scale(1.06);filter:drop-shadow(0 0 2px rgba(88,166,255,1)) drop-shadow(0 0 14px rgba(124,58,237,.65)) drop-shadow(0 10px 24px rgba(37,99,235,.55))}
.callie-orb.pulse::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(124,58,237,.4);animation:callie-ring 2s ease-out infinite}
@keyframes callie-ring{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.55)}}
@keyframes callie-breathe{0%,100%{filter:drop-shadow(0 0 1px rgba(88,166,255,.8)) drop-shadow(0 6px 18px rgba(37,99,235,.45))}50%{filter:drop-shadow(0 0 3px rgba(88,166,255,1)) drop-shadow(0 8px 22px rgba(37,99,235,.6))}}
@keyframes callie-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(0.1)}}
@keyframes callie-spark-twinkle{0%,100%{opacity:.85;transform:scale(1) rotate(0deg)}50%{opacity:1;transform:scale(1.2) rotate(90deg)}}
@keyframes callie-hl-pulse{0%,100%{box-shadow:0 0 0 3px rgba(124,58,237,.9),0 0 18px rgba(124,58,237,.6)}50%{box-shadow:0 0 0 6px rgba(124,58,237,.4),0 0 26px rgba(124,58,237,.8)}}
.callie-face-eyes{transform-box:fill-box;transform-origin:center;animation:callie-blink 6s ease-in-out infinite}
.callie-face-spark{transform-box:fill-box;transform-origin:40.5px 15.5px;animation:callie-spark-twinkle 3.5s ease-in-out infinite}
.callie-label{font-size:.6rem;color:#7c3aed;font-weight:700;letter-spacing:.1em;text-shadow:0 0 8px rgba(124,58,237,.4)}
.callie-badge{position:absolute;top:-1px;right:-1px;width:16px;height:16px;border-radius:50%;background:#f85149;font-size:.55rem;color:#fff;display:none;align-items:center;justify-content:center;font-weight:700;border:2px solid #0f1117}
.callie-badge.on{display:flex}
.callie-panel{position:fixed;bottom:100px;right:20px;z-index:9001;width:388px;max-width:calc(100vw - 24px);background:#161b22;border:1px solid #30363d;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.7),0 0 0 1px rgba(124,58,237,.08);display:none;flex-direction:column;overflow:hidden;max-height:580px}
.callie-panel.open{display:flex}
.callie-header{background:linear-gradient(135deg,#1a0835 0%,#0a1535 100%);padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(124,58,237,.2);flex-shrink:0}
.callie-avatar-sm{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#2563eb);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1rem;box-shadow:0 0 12px rgba(124,58,237,.4)}
.callie-header-name{font-size:.92rem;font-weight:700;color:#f0f6fc;letter-spacing:.03em}
.callie-header-status{font-size:.66rem;color:#8b949e;display:flex;align-items:center;gap:4px;margin-top:1px}
.callie-online-dot{width:6px;height:6px;border-radius:50%;background:#56d364;flex-shrink:0}
.callie-close{background:none;border:none;color:#555;cursor:pointer;font-size:.9rem;padding:5px 7px;line-height:1;margin-left:auto;border-radius:5px;transition:color .15s,background .15s}
.callie-close:hover{color:#c9d1d9;background:#21262d}
.callie-messages{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px;min-height:180px;scroll-behavior:smooth}
.callie-messages::-webkit-scrollbar{width:3px}
.callie-messages::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
.c-msg{display:flex;gap:8px;max-width:100%}
.c-msg.user{flex-direction:row-reverse;align-self:flex-end;max-width:88%}
.c-msg.callie{align-self:flex-start;max-width:94%}
.c-bubble{padding:9px 13px;border-radius:14px;font-size:.82rem;line-height:1.55;color:#c9d1d9;word-break:break-word}
.c-msg.callie .c-bubble{background:#1e2430;border:1px solid #2d3748;border-top-left-radius:4px}
.c-msg.user .c-bubble{background:linear-gradient(135deg,#1d4ed8,#6d28d9);color:#fff;border-top-right-radius:4px;border:none}
.c-mini-avatar{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#2563eb);flex-shrink:0;margin-top:3px;display:flex;align-items:center;justify-content:center;font-size:.65rem}
.c-time{font-size:.58rem;color:#555;margin-top:3px;padding:0 3px}
.c-msg.user .c-time{text-align:right}
.c-typing-bubble{display:flex;gap:4px;padding:9px 14px;background:#1e2430;border:1px solid #2d3748;border-radius:14px;border-top-left-radius:4px;align-items:center}
.c-typing-bubble span{width:5px;height:5px;border-radius:50%;background:#555;animation:c-bounce .9s infinite}
.c-typing-bubble span:nth-child(2){animation-delay:.15s}
.c-typing-bubble span:nth-child(3){animation-delay:.3s}
@keyframes c-bounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-4px);opacity:1}}
.c-card{background:#0d1117;border:1px solid #21262d;border-radius:8px;overflow:hidden;margin-top:6px}
.c-card-title{background:#21262d;padding:5px 10px;color:#8b949e;font-size:.63rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.c-table{width:100%;border-collapse:collapse;font-size:.76rem}
.c-table td{padding:5px 10px;border-bottom:1px solid #1a1f26;color:#c9d1d9;vertical-align:middle}
.c-table tr:last-child td{border-bottom:none}
.c-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px}
.c-stat{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 10px;text-align:center}
.c-stat-n{font-size:1.25rem;font-weight:700;color:#58a6ff}
.c-stat-l{font-size:.58rem;color:#666;text-transform:uppercase;letter-spacing:.04em}
.c-inline-btn{display:inline-block;background:#1f6feb;border:none;color:#fff;font-size:.7rem;font-weight:600;padding:4px 12px;border-radius:6px;cursor:pointer;margin:6px 3px 2px 0;font-family:inherit;transition:background .15s}
.c-inline-btn:hover{background:#388bfd}
.c-inline-btn.sec{background:#21262d;border:1px solid #30363d;color:#8b949e}
.c-inline-btn.sec:hover{color:#c9d1d9;border-color:#58a6ff}
.callie-pills{display:flex;gap:6px;padding:6px 12px 8px;flex-wrap:wrap;flex-shrink:0;border-top:1px solid #21262d}
.c-pill{background:#21262d;border:1px solid #30363d;color:#8b949e;font-size:.66rem;padding:3px 10px;border-radius:10px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .15s}
.c-pill:hover{background:#2d3748;color:#c9d1d9;border-color:#7c3aed}
.callie-input-row{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #21262d;flex-shrink:0;background:#0d1117}
.callie-input{flex:1;background:#161b22;border:1px solid #30363d;color:#e0e0e0;border-radius:10px;padding:8px 12px;font-size:.82rem;font-family:inherit;outline:none;resize:none;min-height:36px;max-height:100px;transition:border .15s;line-height:1.4}
.callie-input:focus{border-color:#7c3aed}
.callie-send{background:linear-gradient(135deg,#7c3aed,#2563eb);border:none;color:#fff;border-radius:10px;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s,transform .15s;align-self:flex-end}
.callie-send:hover{opacity:.85;transform:scale(1.05)}
.callie-send:disabled{opacity:.35;cursor:not-allowed;transform:none}
.callie-setup{padding:24px 20px 20px;display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center}
.callie-setup h3{color:#f0f6fc;font-size:1rem;font-weight:700}
.callie-setup p{color:#8b949e;font-size:.78rem;line-height:1.6;max-width:300px}
.callie-setup-input{width:100%;background:#0d1117;border:1px solid #30363d;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:.85rem;font-family:inherit;outline:none;transition:border .15s}
.callie-setup-input:focus{border-color:#7c3aed}
.callie-setup-btn{width:100%;background:linear-gradient(135deg,#7c3aed,#2563eb);border:none;color:#fff;font-size:.85rem;font-weight:600;padding:10px;border-radius:8px;cursor:pointer;font-family:inherit;transition:opacity .15s}
.callie-setup-btn:hover{opacity:.88}

.tab-ico{font-size:.85rem;line-height:1}

/* ══════════ CAMPAIGN CARDS ══════════ */
.campaign{position:relative;background:linear-gradient(180deg,rgba(20,22,38,.8),rgba(13,15,25,.84));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:16px;margin-bottom:18px;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 24px 50px -32px rgba(0,0,0,.95);transition:border-color .2s,box-shadow .2s,transform .2s}
.campaign.stat-active{border-left-color:var(--success)}
.campaign.stat-completed{border-left-color:var(--info)}
.campaign.stat-idle{border-left-color:var(--txt-dim)}
.campaign:hover{border-top-color:var(--border-strong);border-right-color:var(--border-strong);border-bottom-color:var(--border-strong);box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 30px 60px -34px rgba(0,0,0,1)}
.camp-hdr{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:12px;background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)}
.camp-title{font-size:1rem;font-weight:700;letter-spacing:-.015em;color:var(--txt-bright)}
.camp-meta{font-size:.72rem;color:var(--txt-dim);font-weight:450}
.camp-progress{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.camp-bar{width:120px;height:6px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
.camp-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--success),#4ade80);transition:width .5s cubic-bezier(.22,1,.36,1)}
.camp-bar-label{font-size:.68rem;color:#9aa1b3;font-variant-numeric:tabular-nums;font-weight:600}
.consent-ok{font-size:.66rem;padding:3px 10px;border-radius:20px;background:rgba(86,211,100,.12);color:#67e08a;border:1px solid rgba(86,211,100,.28);font-weight:600;display:inline-flex;align-items:center;gap:6px}
.consent-ok::before{content:'';width:6px;height:6px;border-radius:50%;background:#67e08a;box-shadow:0 0 8px rgba(86,211,100,.8)}
.consent-no{font-size:.66rem;padding:3px 10px;border-radius:20px;background:rgba(248,81,73,.12);color:#ff6b64;border:1px solid rgba(248,81,73,.3);font-weight:600;display:inline-flex;align-items:center;gap:6px}
.consent-no::before{content:'';width:6px;height:6px;border-radius:50%;background:#ff6b64;box-shadow:0 0 8px rgba(248,81,73,.8)}
.consent-approve-btn {
  font-size:.68rem; padding:5px 14px; border-radius:20px;
  background:linear-gradient(135deg,#22c55e,#16a34a);
  border:none; color:#fff; cursor:pointer; font-weight:600;
  font-family:inherit; transition:transform .15s, box-shadow .15s;
  box-shadow:0 4px 12px -4px rgba(34,197,94,.5);
}
.consent-approve-btn:hover { transform:translateY(-1px); box-shadow:0 8px 18px -4px rgba(34,197,94,.6); }

/* TABLE */
table{width:100%;border-collapse:separate;border-spacing:0;font-size:.82rem}
thead th{background:rgba(255,255,255,.02);color:#8b92a6;text-align:left;padding:11px 14px;font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;font-weight:600;border-bottom:1px solid rgba(255,255,255,.07)}
tbody tr.lead-row{cursor:pointer;transition:background .16s}
tbody tr.lead-row:hover{background:linear-gradient(90deg,rgba(79,142,247,.08),rgba(139,92,246,.05))}
tbody tr.lead-row td{padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.045);vertical-align:middle;color:#c7ccd6}
tbody tr.lead-row:hover td{color:#e6e9f0}
tbody tr.lead-row:last-of-type td{border-bottom:none}
.expand-inner{background:rgba(8,9,15,.6);border-top:1px solid rgba(79,142,247,.15);padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:16px;animation:expand-fade .3s ease}
@keyframes expand-fade{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:700px){.expand-inner{grid-template-columns:1fr}}
.exp-section{background:linear-gradient(180deg,rgba(24,27,40,.6),rgba(17,19,29,.6));border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px 16px;box-shadow:0 8px 24px -20px rgba(0,0,0,.9)}
.exp-section h4{font-size:.7rem;text-transform:uppercase;letter-spacing:.09em;color:#8b92a6;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);font-weight:700}

/* STATUS BADGES — dot style */
.status{display:inline-flex;align-items:center;gap:6px;padding:3px 11px;border-radius:20px;font-size:.66rem;font-weight:600;letter-spacing:.01em;border:1px solid transparent}
.status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor;flex-shrink:0}
.s-positive{background:rgba(86,211,100,.12);color:#67e08a;border-color:rgba(86,211,100,.28)}
.s-negative{background:rgba(248,81,73,.12);color:#ff6b64;border-color:rgba(248,81,73,.3)}
.s-no_answer{background:rgba(233,196,106,.12);color:#e9c46a;border-color:rgba(233,196,106,.28)}
.s-completed{background:rgba(79,142,247,.12);color:#7aa7ff;border-color:rgba(79,142,247,.28)}
.s-not_called{background:rgba(139,146,166,.1);color:#9aa1b3;border-color:rgba(139,146,166,.22)}
.s-failed{background:rgba(248,81,73,.12);color:#ff6b64;border-color:rgba(248,81,73,.3)}
.s-skipped{background:rgba(139,146,166,.08);color:#767d8f;border-color:rgba(139,146,166,.18)}
.s-positive_r2{background:rgba(139,92,246,.14);color:#b79bff;border-color:rgba(139,92,246,.3)}
.chev{color:#565d6e;font-size:.9rem;transition:transform .22s cubic-bezier(.34,1.4,.5,1),color .2s;display:inline-block;margin-right:6px}
tr.lead-row:hover .chev{color:#7aa7ff}
.chev.open{transform:rotate(90deg);color:#7aa7ff}

/* SCORE PILLS */
.score-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 11px;border-radius:20px;font-size:.7rem;font-weight:700;border:1px solid transparent}
.score-pill::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.score-hi{background:rgba(86,211,100,.12);color:#67e08a;border-color:rgba(86,211,100,.28)}
.score-mid{background:rgba(233,196,106,.12);color:#e9c46a;border-color:rgba(233,196,106,.28)}
.score-lo{background:rgba(248,81,73,.12);color:#ff6b64;border-color:rgba(248,81,73,.3)}

/* BUTTONS */
.btn-primary{background:linear-gradient(135deg,#4f8ef7,#8b5cf6);border:none;color:#fff;font-size:.85rem;font-weight:600;padding:10px 26px;border-radius:10px;cursor:pointer;font-family:inherit;transition:transform .18s,box-shadow .18s;box-shadow:0 8px 22px -8px rgba(79,142,247,.6),0 1px 0 rgba(255,255,255,.15) inset}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 14px 30px -8px rgba(139,92,246,.7),0 1px 0 rgba(255,255,255,.2) inset}
.btn-primary:disabled{background:rgba(255,255,255,.05);color:#565d6e;cursor:not-allowed;box-shadow:none;transform:none}
.btn-secondary{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#9aa1b3;font-size:.82rem;padding:9px 18px;border-radius:10px;cursor:pointer;font-family:inherit;transition:all .15s}
.btn-secondary:hover{color:#eef2ff;border-color:rgba(79,142,247,.5);background:rgba(79,142,247,.08)}
.nc-open-btn{background:linear-gradient(135deg,#4f8ef7,#8b5cf6);border:none;color:#fff;font-size:.82rem;font-weight:600;padding:9px 20px;border-radius:10px;cursor:pointer;transition:transform .18s,box-shadow .18s;font-family:inherit;box-shadow:0 8px 22px -8px rgba(79,142,247,.6)}
.nc-open-btn:hover{transform:translateY(-1px);box-shadow:0 12px 28px -8px rgba(139,92,246,.7)}
.nc-open-btn.active{background:rgba(22,25,37,.8);border:1px solid rgba(79,142,247,.5);color:#7aa7ff;box-shadow:none}
.raw-btn{font-size:.62rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#8b92a6;border-radius:6px;padding:2px 9px;cursor:pointer;margin-left:6px;vertical-align:middle;transition:all .15s;font-weight:500}
.raw-btn:hover{color:#7aa7ff;border-color:rgba(79,142,247,.5);background:rgba(79,142,247,.1)}
.copy-btn{font-size:.65rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#8b92a6;border-radius:6px;padding:2px 7px;cursor:pointer;transition:all .15s}
.copy-btn:hover{color:#7aa7ff;border-color:rgba(79,142,247,.5)}

/* WIZARD */
.wizard{background:linear-gradient(180deg,rgba(22,25,38,.82),rgba(15,17,27,.86));backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:24px 26px;margin-bottom:22px;display:none;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 30px 60px -34px rgba(0,0,0,1)}
.wizard.open{display:block;animation:view-in .35s ease}
.wizard h2{font-size:.86rem;font-weight:800;color:#f0f3fa;margin-bottom:18px;letter-spacing:.06em;text-transform:uppercase}
.wiz-input{background:rgba(6,7,12,.7);border:1px solid rgba(255,255,255,.09);color:#eef2ff;border-radius:10px;padding:10px 14px;font-size:.85rem;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.wiz-input:focus{border-color:rgba(79,142,247,.65);box-shadow:0 0 0 3px rgba(79,142,247,.16)}
.wiz-input::placeholder{color:#565d6e}
.wiz-select{background:rgba(6,7,12,.7);border:1px solid rgba(255,255,255,.09);color:#eef2ff;border-radius:10px;padding:10px 14px;font-size:.85rem;font-family:inherit;outline:none;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.wiz-select:focus{border-color:rgba(79,142,247,.65);box-shadow:0 0 0 3px rgba(79,142,247,.16)}
.wiz-label{font-size:.7rem;color:#8b92a6;font-weight:700;text-transform:uppercase;letter-spacing:.07em}
.wiz-error{color:#ff6b64;font-size:.78rem;margin-top:4px}

/* CHARTS / ANALYTICS */
.chart-card{background:linear-gradient(180deg,rgba(22,25,38,.78),rgba(15,17,27,.82));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 44px -30px rgba(0,0,0,.9);transition:transform .22s cubic-bezier(.34,1.4,.5,1),border-color .22s}
.chart-card:hover{transform:translateY(-2px);border-color:rgba(139,92,246,.3)}
.chart-card h3{font-size:.74rem;color:#8b92a6;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;font-weight:700}
.bench-card{background:linear-gradient(180deg,rgba(22,25,38,.78),rgba(15,17,27,.82));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 44px -30px rgba(0,0,0,.9)}
.bench-card h3{font-size:.9rem;color:#f0f3fa;margin-bottom:12px;font-weight:700;letter-spacing:-.01em}

/* LIVE */
.live-console{background:rgba(6,7,12,.7);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px;font-family:'JetBrains Mono',monospace;font-size:.78rem;min-height:120px;max-height:400px;overflow-y:auto;box-shadow:inset 0 2px 20px rgba(0,0,0,.5);line-height:1.6}
.live-line{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03);display:flex;gap:10px;animation:live-in .3s ease}
@keyframes live-in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
.live-line:last-child{border-bottom:none}
.live-ts{color:#565d6e;min-width:56px;font-family:'JetBrains Mono',monospace}
.live-status{color:#e9c46a;font-weight:600;min-width:80px}
.t-time{color:#565d6e;min-width:56px;font-family:'JetBrains Mono',monospace;font-size:.72rem}
.t-bot{color:#7aa7ff;min-width:46px;font-weight:700}
.t-user{color:#67e08a;min-width:46px;font-weight:700}
pre.json-view{font-family:'JetBrains Mono',monospace;font-size:.76rem;color:#c7ccd6;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.6}

/* SCHED BANNER */
.sched-banner{background:linear-gradient(180deg,rgba(20,32,26,.8),rgba(14,22,18,.8));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(86,211,100,.22);border-radius:14px;padding:14px 18px;margin-bottom:20px;font-size:.82rem;box-shadow:0 10px 30px -22px rgba(86,211,100,.6)}
.sched-banner h3{color:#67e08a;font-size:.85rem;margin-bottom:8px;font-weight:700}
.ss-pending{background:rgba(86,211,100,.12);color:#67e08a;border:1px solid rgba(86,211,100,.25)}
.ss-fired{background:rgba(79,142,247,.12);color:#7aa7ff;border:1px solid rgba(79,142,247,.25)}
.ss-failed{background:rgba(248,81,73,.12);color:#ff6b64;border:1px solid rgba(248,81,73,.28)}
.ss-skipped{background:rgba(139,146,166,.1);color:#8b92a6;border:1px solid rgba(139,146,166,.2)}
.sched-tag{font-size:.66rem;background:rgba(86,211,100,.1);color:#67e08a;border:1px solid rgba(86,211,100,.28);border-radius:20px;padding:2px 9px;white-space:nowrap;font-weight:500}

/* TEMPLATE BAR */
.tpl-bar{background:linear-gradient(180deg,rgba(22,25,38,.75),rgba(15,17,27,.8));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:.8rem}
.tpl-select{background:rgba(6,7,12,.7);border:1px solid rgba(255,255,255,.09);color:#dfe3ea;border-radius:8px;padding:6px 10px;font-size:.78rem;font-family:inherit;outline:none;cursor:pointer}
.tpl-select:focus{border-color:rgba(79,142,247,.6);box-shadow:0 0 0 3px rgba(79,142,247,.15)}
.tpl-save-btn{font-size:.72rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:#8b92a6;border-radius:8px;padding:5px 12px;cursor:pointer;transition:all .15s;font-weight:500}
.tpl-save-btn:hover{color:#7aa7ff;border-color:rgba(79,142,247,.5);background:rgba(79,142,247,.1)}

/* PREVIEW TABLE */
.preview-table{width:100%;border-collapse:separate;border-spacing:0;font-size:.8rem;margin-bottom:16px;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden}
.preview-table th{background:rgba(255,255,255,.03);color:#8b92a6;text-align:left;padding:9px 12px;font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid rgba(255,255,255,.07)}
.preview-table td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.045);vertical-align:middle;color:#c7ccd6}
.preview-table tr:hover td{background:rgba(79,142,247,.05)}
.preview-table tr:last-child td{border-bottom:none}

/* MODAL */
.modal-backdrop{display:none;position:fixed;inset:0;background:rgba(4,5,10,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:1000;align-items:center;justify-content:center}
.modal-backdrop.open{display:flex}
.modal-box{background:linear-gradient(180deg,rgba(24,27,40,.96),rgba(16,18,28,.98));backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:18px;width:min(90vw,780px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 40px 100px -30px rgba(0,0,0,1),0 0 0 1px rgba(79,142,247,.08);animation:modal-pop .28s cubic-bezier(.34,1.4,.5,1)}
@keyframes modal-pop{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.modal-close{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#8b92a6;font-size:1.1rem;cursor:pointer;padding:2px 10px;line-height:1;border-radius:8px;transition:all .15s}
.modal-close:hover{color:#ff6b64;border-color:rgba(248,81,73,.4);background:rgba(248,81,73,.1)}

/* CALLIE PANEL */
.callie-panel{position:fixed;bottom:104px;right:22px;z-index:9001;width:392px;max-width:calc(100vw - 24px);background:linear-gradient(180deg,rgba(22,25,38,.96),rgba(14,16,26,.98));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.09);border-radius:20px;box-shadow:0 30px 80px -20px rgba(0,0,0,.85),0 0 0 1px rgba(139,92,246,.12),0 0 40px -10px rgba(79,142,247,.3);display:none;flex-direction:column;overflow:hidden;max-height:582px}
.callie-panel.open{display:flex;animation:callie-pop .32s cubic-bezier(.34,1.4,.5,1)}
@keyframes callie-pop{from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
.callie-header{background:linear-gradient(135deg,rgba(139,92,246,.28),rgba(79,142,247,.22));padding:15px 17px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
.callie-close{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#8b92a6;cursor:pointer;font-size:.9rem;padding:5px 9px;line-height:1;margin-left:auto;border-radius:8px;transition:all .15s}
.callie-close:hover{color:#eef2ff;background:rgba(255,255,255,.1)}
.c-msg{display:flex;gap:9px;max-width:100%;animation:msg-in .3s ease}
@keyframes msg-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.c-msg.user .c-bubble{background:linear-gradient(135deg,#4f8ef7,#8b5cf6);color:#fff;border-top-right-radius:5px;border:none;box-shadow:0 6px 18px -8px rgba(79,142,247,.6)}
.c-msg.callie .c-bubble{background:rgba(30,36,48,.85);border:1px solid rgba(255,255,255,.07);border-top-left-radius:5px;color:#dfe3ea}
.c-pill{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#9aa1b3;font-size:.66rem;padding:4px 11px;border-radius:20px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .15s}
.c-pill:hover{background:rgba(139,92,246,.14);color:#dfe3ea;border-color:rgba(139,92,246,.5)}
.callie-input{flex:1;background:rgba(22,25,37,.8);border:1px solid rgba(255,255,255,.1);color:#eef2ff;border-radius:12px;padding:9px 13px;font-size:.82rem;font-family:inherit;outline:none;resize:none;min-height:38px;max-height:100px;transition:border-color .15s,box-shadow .15s;line-height:1.4}
.callie-input:focus{border-color:rgba(139,92,246,.6);box-shadow:0 0 0 3px rgba(139,92,246,.15)}
.callie-input::placeholder{color:#565d6e}
.callie-send{background:linear-gradient(135deg,#8b5cf6,#4f8ef7);border:none;color:#fff;border-radius:12px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .15s,box-shadow .15s;align-self:flex-end;box-shadow:0 6px 18px -8px rgba(139,92,246,.7)}
.callie-send:hover{transform:scale(1.06) translateY(-1px);box-shadow:0 10px 22px -8px rgba(139,92,246,.8)}
.callie-send:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.callie-setup-btn{width:100%;background:linear-gradient(135deg,#8b5cf6,#4f8ef7);border:none;color:#fff;font-size:.85rem;font-weight:600;padding:11px;border-radius:10px;cursor:pointer;font-family:inherit;transition:transform .15s,box-shadow .15s;box-shadow:0 8px 22px -8px rgba(139,92,246,.7)}
.callie-setup-btn:hover{transform:translateY(-1px);box-shadow:0 12px 28px -8px rgba(139,92,246,.8)}
.callie-orb{filter:drop-shadow(0 0 2px rgba(79,142,247,.85)) drop-shadow(0 6px 20px rgba(79,142,247,.5));animation:callie-breathe 4s ease-in-out infinite}
.callie-orb:hover{transform:translateY(-4px) scale(1.08);filter:drop-shadow(0 0 3px rgba(79,142,247,1)) drop-shadow(0 0 16px rgba(139,92,246,.7)) drop-shadow(0 12px 26px rgba(79,142,247,.6))}
.callie-label{font-size:.58rem;color:#b79bff;font-weight:800;letter-spacing:.12em;text-transform:uppercase;text-shadow:0 0 10px rgba(139,92,246,.5)}
.callie-badge{background:#ff5147;border:2px solid #0a0b12;box-shadow:0 0 10px rgba(248,81,73,.8)}
.c-stat-n{font-size:1.3rem;font-weight:800;background:linear-gradient(120deg,#8fb6ff,#c4b5fd);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#8fb6ff}
.c-inline-btn{display:inline-block;background:linear-gradient(135deg,#4f8ef7,#8b5cf6);border:none;color:#fff;font-size:.7rem;font-weight:600;padding:5px 13px;border-radius:8px;cursor:pointer;margin:6px 3px 2px 0;font-family:inherit;transition:transform .15s,box-shadow .15s;box-shadow:0 6px 16px -8px rgba(79,142,247,.6)}
.c-inline-btn:hover{transform:translateY(-1px);box-shadow:0 10px 20px -8px rgba(139,92,246,.7)}
.c-inline-btn.sec{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#9aa1b3;box-shadow:none}
.rel-badge{font-size:.62rem;padding:2px 8px;border-radius:20px;font-weight:600;margin-left:4px;display:inline-flex;align-items:center;gap:5px}
.rel-badge::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor}
.rel-green{background:rgba(86,211,100,.12);color:#67e08a;border:1px solid rgba(86,211,100,.28)}
.rel-amber{background:rgba(233,196,106,.12);color:#e9c46a;border:1px solid rgba(233,196,106,.28)}
.rel-red{background:rgba(248,81,73,.12);color:#ff6b64;border:1px solid rgba(248,81,73,.3)}
.rel-grey{background:rgba(139,146,166,.1);color:#8b92a6;border:1px solid rgba(139,146,166,.2)}

/* ══════════ ACCENT UNIFICATION (indigo/purple) ══════════ */
.btn-primary,.nc-open-btn,.sb-newcamp{background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.wiz-input:focus,.wiz-select:focus{border-color:rgba(99,102,241,.65);box-shadow:0 0 0 3px rgba(99,102,241,.16)}
.callie-input:focus{border-color:rgba(139,92,246,.6);box-shadow:0 0 0 3px rgba(139,92,246,.15)}
tbody tr.lead-row:hover{background:linear-gradient(90deg,rgba(99,102,241,.08),rgba(139,92,246,.05))}
.chev.open,tr.lead-row:hover .chev{color:#a5b4fc}
.expand-inner{border-top:1px solid rgba(99,102,241,.16)}

/* Legacy navbar (removed from DOM) */
.navbar{display:none}

/* Wizard host in main content */
.wizard{margin-bottom:24px}
</style>
<style id="callie-theme-override"></style>
</head>
<body>

<div class="app-shell">

  <!-- ═══════ SIDEBAR ═══════ -->
  <aside class="sidebar">
    <div class="sb-brand">
      <div class="sb-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <defs>
            <linearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#8b5cf6"/>
              <stop offset="100%" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
          <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" fill="url(#boltGrad)"/>
        </svg>
      </div>
      <div class="sb-brand-txt">
        <div class="sb-name">CALL-E</div>
        <div class="sb-sub">Outreach Intel</div>
      </div>
    </div>

    <div class="sb-divider"></div>

    <nav class="sb-nav">
      <div class="sb-nav-label">Workspace</div>
      <button class="sb-item active" id="tab-leads" onclick="switchTab('leads')"><span class="sb-ico">&#9889;</span>Leads</button>
      <button class="sb-item" id="tab-analytics" onclick="switchTab('analytics')"><span class="sb-ico">&#128202;</span>Analytics</button>
      <button class="sb-item" id="tab-map" onclick="switchTab('map')"><span class="sb-ico">&#128506;&#65039;</span>Map</button>
      <button class="sb-item" id="tab-live" onclick="switchTab('live')"><span class="sb-ico">&#128308;</span>Live Console</button>

      <button class="sb-newcamp" id="nc-open-btn" onclick="toggleWizard()"><span>&#43;</span>New Campaign</button>
    </nav>

    <div class="sb-foot">
      Data &copy; <a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors (ODbL)</a>
    </div>
  </aside>

  <!-- ═══════ MAIN CONTENT ═══════ -->
  <main class="main">

  <!-- Top bar -->
  <div class="topbar">
    <div>
      <div class="topbar-title" id="page-title">Leads</div>
      <div class="topbar-sub">AI voice-calling campaigns &amp; lead intelligence</div>
    </div>
    <div class="topbar-right">
      <div class="refresh-tag">Refresh in <span id="cd">8</span>s</div>
      <div class="live-badge"><span class="live-dot-nav"></span>LIVE</div>
    </div>
  </div>

<!-- Raw JSON modal -->
<div class="modal-backdrop" id="raw-modal" onclick="if(event.target===this)closeModal()">
  <div class="modal-box">
    <div class="modal-head">
      <h3 id="raw-modal-title">Full Inference JSON</h3>
      <button class="modal-close" onclick="closeModal()">&#x2715;</button>
    </div>
    <div class="modal-body"><pre class="json-view" id="raw-modal-body"></pre></div>
  </div>
</div>

<div class="wizard" id="wizard">
  <h2>&#128269; New Campaign</h2>

  <!-- Step 1: Form -->
  <div id="wiz-step1">
    <div class="wiz-form">
      <div class="wiz-field full">
        <label class="wiz-label">What do you want to source?</label>
        <input class="wiz-input" id="wiz-product" placeholder="e.g. organic rice in bulk, office furniture, stationery supplies" />
      </div>
      <div class="wiz-field full">
        <label class="wiz-label">Where? (city, area, neighbourhood)</label>
        <input class="wiz-input" id="wiz-location" placeholder="e.g. Connaught Place, Delhi" />
      </div>
      <div class="wiz-field">
        <label class="wiz-label">Max vendors to find</label>
        <input class="wiz-input" id="wiz-limit" type="number" min="3" max="50" value="15" />
      </div>
      <div class="wiz-field">
        <label class="wiz-label">Call language</label>
        <select class="wiz-select" id="wiz-language">
          <option value="Hindi">Hindi</option>
          <option value="English">English</option>
          <option value="Hindi and English">Hinglish</option>
        </select>
      </div>
      <div class="wiz-actions">
        <button class="btn-primary" id="wiz-discover-btn" onclick="discoverVendors()">&#128269; Discover Vendors</button>
        <div class="wiz-spinner" id="wiz-spinner"><div class="spin"></div> Searching OpenStreetMap &amp; scoring vendors&hellip;</div>
        <span class="wiz-error" id="wiz-error"></span>
      </div>
    </div>
  </div>

  <!-- Step 2: Vendor Preview + Start -->
  <div class="vendor-preview" id="wiz-step2">
    <div class="preview-header">
      <div>
        <span class="preview-title" id="preview-title">Found 0 vendors</span>
        <span class="preview-meta" id="preview-meta"></span>
      </div>
      <button class="btn-secondary" onclick="resetWizard()">&#8592; New Search</button>
    </div>
    <table class="preview-table">
      <thead><tr><th>Score</th><th>Name</th><th>Category</th><th>Address</th><th>Phone</th></tr></thead>
      <tbody id="preview-tbody"></tbody>
    </table>
    <div style="margin-bottom:12px;padding:10px 14px;background:#162016;border:1px solid #2a5a2a;border-radius:6px;display:flex;align-items:flex-start;gap:10px">
      <input type="checkbox" id="wiz-consent" onchange="toggleStartBtn()" style="margin-top:3px;accent-color:#56d364;width:15px;height:15px;flex-shrink:0">
      <label for="wiz-consent" style="font-size:.8rem;color:#c9d1d9;cursor:pointer;line-height:1.5">
        I confirm I have a <strong style="color:#56d364">legitimate business reason</strong> to contact these vendors and understand that calls will be made on my behalf. I take responsibility for any outreach initiated.
      </label>
    </div>
    <div class="start-row">
      <button class="btn-primary" id="wiz-start-btn" onclick="startCalling()" disabled style="opacity:.4;cursor:not-allowed">&#128222; Start Calling All</button>
      <span class="calling-status" id="calling-status">&#9679; Calling pipeline started &mdash; watch the Live Console tab and dashboard below</span>
    </div>
  </div>
</div>

<div id="stats" class="stats"></div>

<div id="leads-view" class="view active">
  <div class="section-head">
    <h2>Campaigns</h2>
    <span class="section-count" id="camp-count">0</span>
    <div class="filter-pills">
      <button class="filter-pill active" id="fp-all" onclick="filterCampaigns('all')">All</button>
      <button class="filter-pill" id="fp-active" onclick="filterCampaigns('active')">Active</button>
      <button class="filter-pill" id="fp-completed" onclick="filterCampaigns('completed')">Completed</button>
    </div>
  </div>
  <div class="tpl-bar" id="tpl-bar">
    <label>Templates:</label>
    <select class="tpl-select" id="tpl-select" onchange="applyTemplate()">
      <option value="">-- select a template --</option>
    </select>
    <span id="tpl-info" style="color:#8b949e;font-size:.72rem;flex:1"></span>
    <button class="tpl-save-btn" onclick="promptSaveTemplate()">&#128190; Save current as template</button>
  </div>
  <div id="sched" style="display:none" class="sched-banner">
    <h3>&#128197; Scheduled Follow-up Calls</h3>
    <div id="sched-list"></div>
  </div>
  <div id="campaigns"></div>
</div>

<div id="analytics-view" class="view">
  <div class="section-head"><h2>Analytics</h2></div>
  <div class="chart-grid">
    <div class="chart-card"><h3>Outcomes</h3><div style="position:relative;height:280px"><canvas id="chart-outcomes"></canvas></div></div>
    <div class="chart-card"><h3>Interest Level</h3><div style="position:relative;height:280px"><canvas id="chart-interest"></canvas></div></div>
    <div class="chart-card"><h3>Sentiment Trend</h3><div style="position:relative;height:280px"><canvas id="chart-sentiment"></canvas></div></div>
  </div>
  <div class="bench-card">
    <h3>Price Intelligence</h3>
    <div id="bench-body"></div>
  </div>
</div>

<div id="map-view" class="view" style="height:calc(100vh - 120px);min-height:400px"></div>

<div id="live-view" class="view">
  <div class="live-term-head">
    <span class="lt-dot"></span> LIVE CONSOLE
    <span id="live-indicator" style="display:none;margin-left:6px"><span class="live-dot"></span></span>
    <span class="lt-dots"><span></span><span></span><span></span></span>
  </div>
  <div id="live-console" class="live-console">
    <div class="live-empty">No active calls. Start a campaign to see live updates here.</div>
  </div>
</div>

  </main>
</div>

<script>
const SC = {
  positive:'s-positive', negative:'s-negative', no_answer:'s-no_answer',
  completed:'s-completed', not_called:'s-not_called', failed:'s-failed',
  skipped:'s-skipped', positive_r2:'s-positive_r2'
};

let _lastData = [];
let _activeTab = 'leads';
const _charts = {};
let _map = null;
let _mapMarkers = [];
let _mapFilter = 'all';       // all | positive | negative | no_answer | not_called
let _mapStatsCtrl = null;     // Leaflet control for live stats overlay

const _PAGE_TITLES = {leads:'Leads', analytics:'Analytics', map:'Map', live:'Live Console'};
function switchTab(name){
  _activeTab = name;
  ['leads','analytics','map','live'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active', t===name);
    document.getElementById(t+'-view').classList.toggle('active', t===name);
  });
  const pt = document.getElementById('page-title');
  if(pt) pt.textContent = _PAGE_TITLES[name] || name;
  if(name==='analytics') renderAnalytics(_lastData);
  if(name==='map'){ renderMap(_lastData); setTimeout(()=>{ if(_map) _map.invalidateSize(); }, 420); }
}

// Campaign filter pills (All / Active / Completed)
let _campFilter = 'all';
function filterCampaigns(mode){
  _campFilter = mode;
  ['all','active','completed'].forEach(m=>{
    const el = document.getElementById('fp-'+m);
    if(el) el.classList.toggle('active', m===mode);
  });
  document.querySelectorAll('#campaigns .campaign').forEach(card=>{
    const st = card.dataset.status || 'idle';
    let show = true;
    if(mode==='active')    show = (st==='active');
    else if(mode==='completed') show = (st==='completed');
    card.style.display = show ? '' : 'none';
  });
}

const CHART_TXT = '#c9d1d9', CHART_GRID = '#30363d';

function renderAnalytics(data){
  // Outcomes donut
  const outColors = {positive:'#56d364',negative:'#f85149',no_answer:'#e3b341',completed:'#58a6ff',failed:'#f85149',skipped:'#666'};
  const outKeys = ['positive','negative','no_answer','completed','failed','skipped'];
  const outCounts = Object.fromEntries(outKeys.map(k=>[k,0]));
  data.forEach(c=>c.leads.forEach(l=>{ if(l.status in outCounts) outCounts[l.status]++; }));

  // Interest bar
  const intKeys = ['high','medium','low','none','unknown'];
  const intColors = {high:'#56d364',medium:'#e3b341',low:'#f85149',none:'#666',unknown:'#8b949e'};
  const intCounts = Object.fromEntries(intKeys.map(k=>[k,0]));
  data.forEach(c=>c.leads.forEach(l=>{
    const v = (l.r1_inference && l.r1_inference.interest_level) ? String(l.r1_inference.interest_level).toLowerCase() : 'unknown';
    intCounts[v in intCounts ? v : 'unknown']++;
  }));

  // Sentiment trend: one point per campaign
  const labels = [], pos = [], neu = [], neg = [];
  data.forEach(c=>{
    let p=0,n=0,g=0;
    c.leads.forEach(l=>{
      const s = (l.r1_inference && l.r1_inference.sentiment) ? String(l.r1_inference.sentiment).toLowerCase() : '';
      if(s==='positive') p++; else if(s==='neutral') n++; else if(s==='negative') g++;
    });
    labels.push(trunc(c.product_description||('#'+c.id), 12));
    pos.push(p); neu.push(n); neg.push(g);
  });

  const noGrid = {grid:{color:CHART_GRID,display:false},ticks:{color:CHART_TXT}};
  const legendTop = {position:'top',labels:{color:CHART_TXT}};

  _charts['outcomes']?.destroy();
  _charts['outcomes'] = new Chart(document.getElementById('chart-outcomes'),{
    type:'doughnut',
    data:{labels:outKeys,datasets:[{data:outKeys.map(k=>outCounts[k]),backgroundColor:outKeys.map(k=>outColors[k]),borderColor:'#161b22'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:legendTop}}
  });

  _charts['interest']?.destroy();
  _charts['interest'] = new Chart(document.getElementById('chart-interest'),{
    type:'bar',
    data:{labels:intKeys,datasets:[{data:intKeys.map(k=>intCounts[k]),backgroundColor:intKeys.map(k=>intColors[k])}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:noGrid,y:{...noGrid,beginAtZero:true}}}
  });

  _charts['sentiment']?.destroy();
  _charts['sentiment'] = new Chart(document.getElementById('chart-sentiment'),{
    type:'line',
    data:{labels:labels,datasets:[
      {label:'positive',data:pos,borderColor:'#56d364',backgroundColor:'#56d364',tension:.2},
      {label:'neutral',data:neu,borderColor:'#e3b341',backgroundColor:'#e3b341',tension:.2},
      {label:'negative',data:neg,borderColor:'#f85149',backgroundColor:'#f85149',tension:.2},
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:legendTop},scales:{x:noGrid,y:{...noGrid,beginAtZero:true}}}
  });

  renderBenchmark(data);
}

function renderBenchmark(data){
  const order = {high:0,medium:1,low:2,none:3,unknown:4};
  const rows = [];
  data.forEach(c=>c.leads.forEach(l=>{
    const pr = l.r2_inference && l.r2_inference.price_range;
    if(pr!==null && pr!==undefined && String(pr).trim()!==''){
      rows.push({
        name: l.masked_phone || l.name || '?',
        price: String(pr),
        interest: (l.r1_inference && l.r1_inference.interest_level) ? String(l.r1_inference.interest_level).toLowerCase() : 'unknown',
      });
    }
  }));
  const box = document.getElementById('bench-body');
  if(!rows.length){ box.innerHTML = '<span style="color:#555;font-size:.8rem">No R2 price data yet</span>'; return; }
  rows.sort((a,b)=>(order[a.interest]??9)-(order[b.interest]??9));
  box.innerHTML = `<table><thead><tr><th>Name</th><th>Price Range</th><th>Interest Level</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="lead-row">
      <td style="font-family:monospace;color:#79c0ff">${escHtml(r.name)}</td>
      <td style="color:#c9d1d9">${escHtml(r.price)}</td>
      <td>${escHtml(r.interest)}</td></tr>`).join('')}</tbody></table>`;
}

// Statuses where a human actually picked up the phone
const MAP_ANSWERED = new Set(['positive','negative','unknown','completed']);
const MAP_COLOR = {
  positive: '#56d364',
  negative: '#f85149',
  unknown:  '#bc8cff',
  completed:'#58a6ff',
  no_answer:'#e3b341',
  busy:     '#e3b341',
  failed:   '#666',
  skipped:  '#555',
};

// Bucket a lead's status into the filter categories
function mapFilterBucket(status){
  if(status==='positive') return 'positive';
  if(status==='negative') return 'negative';
  if(status==='no_answer' || status==='busy' || status==='failed') return 'no_answer';
  if(status==='not_called' || status==='skipped' || !status) return 'not_called';
  return 'other'; // completed / unknown -> answered but uncategorised
}

function setMapFilter(mode){
  _mapFilter = mode;
  renderMap(_lastData);
}

function renderMap(data){
  const pts = [];
  data.forEach(c=>c.leads.forEach(l=>{
    if(l.lat!==null && l.lat!==undefined && l.lon!==null && l.lon!==undefined)
      pts.push({...l, _campaign: c.product_description});
  }));

  // Empty state — only when the map has never been initialised
  if(pts.length === 0 && !_map){
    document.getElementById('map-view').innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#6b7280"><div style="font-size:2rem">🗺️</div><div style="font-weight:600;color:#9aa1b3">No mapped leads yet</div><div style="font-size:.8rem">Discover vendors to see them appear here</div></div>';
    return;
  }

  // De-dupe overlapping coordinates: jitter any point sharing a ~0.001° cell
  const seen = {};
  pts.forEach(l=>{
    const key = `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`;
    if(seen[key]){ l.lat += (Math.random()-.5)*0.001; l.lon += (Math.random()-.5)*0.001; }
    else seen[key] = true;
  });

  if(!_map){
    const clat = pts.length ? pts.reduce((s,l)=>s+l.lat,0)/pts.length : 20.5937;
    const clon = pts.length ? pts.reduce((s,l)=>s+l.lon,0)/pts.length : 78.9629;
    _map = L.map('map-view', {zoomControl:true}).setView([clat,clon], pts.length?6:5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(_map);

    // Legend (dark theme)
    const legend = L.control({position:'bottomright'});
    legend.onAdd = function(){
      const d = L.DomUtil.create('div');
      d.style.cssText = 'background:rgba(12,13,22,0.95);color:#c7ccd6;padding:10px 14px;border-radius:10px;font-size:11px;line-height:1.8;border:1px solid rgba(255,255,255,0.08);box-shadow:0 12px 30px -12px rgba(0,0,0,.8)';
      d.innerHTML = [
        '<b style="color:#a5b4fc">Map Legend</b>',
        '<div style="margin-top:4px"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#56d364;border:2px solid #fff;margin-right:6px;vertical-align:middle"></span>Answered &mdash; positive</div>',
        '<div><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f85149;border:2px solid #fff;margin-right:6px;vertical-align:middle"></span>Answered &mdash; negative</div>',
        '<div><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#bc8cff;border:2px solid #fff;margin-right:6px;vertical-align:middle"></span>Answered &mdash; inconclusive</div>',
        '<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e3b341;margin-right:6px;vertical-align:middle;margin-left:2px"></span>No answer / busy</div>',
        '<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#8b949e;margin-right:6px;vertical-align:middle;margin-left:2px"></span>Not yet called</div>',
      ].join('');
      return d;
    };
    legend.addTo(_map);

    // Live stats overlay (top-left)
    _mapStatsCtrl = L.control({position:'topleft'});
    _mapStatsCtrl.onAdd = function(){
      const d = L.DomUtil.create('div', 'map-stats-ctrl');
      d.id = 'map-stats-box';
      return d;
    };
    _mapStatsCtrl.addTo(_map);
  }

  // Filter bar (injected once into the map container)
  if(!document.getElementById('map-filter-bar')){
    const bar = document.createElement('div');
    bar.className = 'map-filter-bar';
    bar.id = 'map-filter-bar';
    const opts = [['all','All'],['positive','Positive'],['negative','Negative'],['no_answer','No Answer'],['not_called','Not Called']];
    bar.innerHTML = opts.map(([k,lbl])=>`<button class="map-filter-btn" data-f="${k}" onclick="setMapFilter('${k}')">${lbl}</button>`).join('');
    document.getElementById('map-view').appendChild(bar);
  }
  document.querySelectorAll('#map-filter-bar .map-filter-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.f===_mapFilter);
  });

  _mapMarkers.forEach(m=>_map.removeLayer(m));
  _mapMarkers = [];

  const ANSWERED = MAP_ANSWERED;
  const COLOR = MAP_COLOR;

  // Draw not-answered first (bottom layer), answered on top
  const [notAnswered, answered] = pts.reduce(([n,a],l)=>
    ANSWERED.has(l.r1_status) ? [n,[...a,l]] : [[...n,l],a], [[],[]]);

  [...notAnswered, ...answered].forEach(l=>{
    const wasAnswered = ANSWERED.has(l.r1_status);
    const col = COLOR[l.r1_status] || '#8b949e';

    // Filter dimming: markers not matching the active filter fade to 0.2
    const inFilter = (_mapFilter==='all') || (mapFilterBucket(l.r1_status)===_mapFilter);
    const dim = inFilter ? 1 : 0.2;

    // Outer pulse ring for answered calls
    if(wasAnswered){
      const ring = L.circleMarker([l.lat,l.lon], {
        radius:16, color:col, fillColor:col, fillOpacity:.12*dim, opacity:dim, weight:1.5,
        interactive:false
      });
      ring.addTo(_map);
      _mapMarkers.push(ring);
    }

    const m = L.circleMarker([l.lat,l.lon], {
      radius:     wasAnswered ? 10 : 6,
      color:      wasAnswered ? '#ffffff' : col,
      fillColor:  col,
      fillOpacity:(wasAnswered ? 0.92 : 0.45)*dim,
      opacity:    dim,
      weight:     wasAnswered ? 2.5 : 1,
    });

    // Build popup — Inter font, design-system colours
    const statusBadge = wasAnswered
      ? `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:.66rem;font-weight:600;background:${col}22;color:${col};border:1px solid ${col}55">${escHtml(l.r1_status)} · answered</span>`
      : `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:.66rem;font-weight:600;background:rgba(139,146,166,.12);color:#9aa1b3;border:1px solid rgba(139,146,166,.25)">${escHtml(l.r1_status||'not called')}</span>`;

    let inferenceBlock = '';
    if(wasAnswered && l.r1_inference){
      const inf = l.r1_inference;
      const parts = [];
      if(inf.interest_level) parts.push(`Interest: <b style="color:#c7d2fe">${escHtml(inf.interest_level)}</b>`);
      if(inf.sentiment)      parts.push(`Sentiment: <b style="color:#c7d2fe">${escHtml(inf.sentiment)}</b>`);
      if(parts.length) inferenceBlock += `<div style="font-size:.72rem;color:#9aa1b3;margin-bottom:4px">${parts.join(' · ')}</div>`;
      if(inf.summary) inferenceBlock += `<div style="font-size:.72rem;color:#8b92a6;font-style:italic;margin-bottom:4px">${escHtml(String(inf.summary).slice(0,120))}</div>`;
    }

    let transcriptBlock = '';
    if(wasAnswered && l.transcript && l.transcript.length){
      const userLines = l.transcript.filter(x=>x.speaker&&x.speaker.toUpperCase()==='USER');
      if(userLines.length){
        const snippet = userLines.slice(0,2).map(x=>x.text).join(' / ').slice(0,120);
        transcriptBlock = `<div style="margin-top:6px;padding:6px 9px;background:rgba(8,9,15,.6);border-left:3px solid ${col};font-size:.72rem;color:#c7ccd6;border-radius:6px">"${escHtml(snippet)}"</div>`;
      }
    }

    const addressBlock = l.address
      ? `<div style="font-size:.66rem;color:#6b7280;margin-top:6px">${escHtml(l.address)}</div>` : '';

    m.bindPopup(`
      <div style="font-family:'Inter',sans-serif;min-width:220px;max-width:300px">
        <div style="font-size:.9rem;font-weight:700;color:#f0f3fa;margin-bottom:2px">${escHtml(l.name||'Unknown')}</div>
        <div style="font-size:.72rem;color:#6b7280;margin-bottom:6px">${escHtml(l.category||'')} · ${escHtml(l._campaign||'')}</div>
        <div style="margin-bottom:6px">${statusBadge}</div>
        ${inferenceBlock}
        ${transcriptBlock}
        ${addressBlock}
      </div>
    `, {maxWidth:320});

    m.addTo(_map);
    _mapMarkers.push(m);
  });

  // Live stats overlay content
  const box = document.getElementById('map-stats-box');
  if(box){
    let pos=0,neg=0,na=0;
    pts.forEach(l=>{
      const b = mapFilterBucket(l.r1_status);
      if(b==='positive') pos++; else if(b==='negative') neg++; else if(b==='no_answer') na++;
    });
    box.innerHTML = `<div class="mst-title">📍 ${pts.length} vendors mapped</div>`
      + `<div class="mst-row"><span style="color:#67e08a">✅ ${pos} positive</span>`
      + `<span style="color:#ff6b64">❌ ${neg} negative</span>`
      + `<span style="color:#e9c46a">📞 ${na} no answer</span></div>`;
  }

  setTimeout(()=>_map.invalidateSize(), 420);
}
function badge(s){ return `<span class="status ${SC[s]||'s-not_called'}">${s||'?'}</span>`; }
function trunc(s,n){ return s&&s.length>n?s.slice(0,n)+'...':s||''; }
function escHtml(s){ return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''; }

// Decorative sparkline for metric cards (static shape, tinted per-metric)
function _spark(color){
  const pts=[3,6,4,8,5,9,7,11,9,13,11,10,14,12].map((v,i)=>`${i*13},${34-v*2}`).join(' ');
  const gid='sg'+Math.random().toString(36).slice(2,7);
  return `<svg class="stat-spark" viewBox="0 0 170 34" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".35"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="0,34 ${pts} 170,34" fill="url(#${gid})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-opacity=".85"/>
  </svg>`;
}

function renderTranscript(lines){
  if(!lines||!lines.length) return '<span style="color:#555;font-size:.75rem">No transcript available</span>';
  return lines.map(l=>{
    const isBOT = l.speaker&&l.speaker.toUpperCase()==='BOT';
    return `<div class="transcript-line">
      <span class="t-time">${escHtml(l.time)}</span>
      <span class="${isBOT?'t-bot':'t-user'}">${escHtml(l.speaker)}</span>
      <span class="t-text">${escHtml(l.text)}</span>
    </div>`;
  }).join('');
}

// Store raw inference objects for modal display (avoids inline JSON injection)
const _rawStore = {};
let _storeIdx = 0;

function openModalByKey(key){
  const entry = _rawStore[key];
  if(!entry) return;
  document.getElementById('raw-modal-title').textContent = entry.title;
  document.getElementById('raw-modal-body').textContent = JSON.stringify(entry.data, null, 2);
  document.getElementById('raw-modal').classList.add('open');
}
function closeModal(){
  document.getElementById('raw-modal').classList.remove('open');
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

// ── Live console ──────────────────────────────────────────────
let _liveSource = null;
let _liveRunId  = null;

function appendLiveLine(ts, statusText, text){
  const c = document.getElementById('live-console');
  if(c.querySelector('.live-empty')) c.innerHTML='';
  const d = document.createElement('div');
  d.className='live-line';
  d.innerHTML=`<span class="live-ts">${escHtml(ts||'')}</span><span class="live-status">${escHtml(statusText)}</span><span class="live-text">${escHtml(text||'')}</span>`;
  c.appendChild(d);
  c.scrollTop=c.scrollHeight;
}

function openLiveStream(runId){
  if(_liveSource){ _liveSource.close(); }
  _liveRunId = runId;
  _liveSource = new EventSource('/api/live/'+runId);
  document.getElementById('live-indicator').style.display='inline';
  _liveSource.onmessage = function(e){
    const ev = JSON.parse(e.data);
    if(ev.type==='status'){
      appendLiveLine(new Date().toLocaleTimeString(), ev.status, ev.summary||'');
      if(ev.transcript&&ev.transcript.length){
        ev.transcript.forEach(l=>appendLiveLine(l.time, l.speaker, l.text));
      }
    } else if(ev.type==='done'){
      appendLiveLine('', 'DONE', ev.status||'');
      document.getElementById('live-indicator').style.display='none';
      _liveSource.close(); _liveSource=null;
    }
  };
}

async function pollLiveRuns(){
  try {
    const runs = await fetch('/api/live-runs').then(r=>r.json());
    if(runs.length>0 && runs[0]!==_liveRunId){
      openLiveStream(runs[0]);
      // Auto-switch to Live tab if not already there
      if(document.getElementById('live-view') && !document.getElementById('live-view').classList.contains('active')){
        switchTab('live');
      }
    }
  } catch(e){}
}

// ── Templates ─────────────────────────────────────────────────
async function loadTemplates(){
  try {
    const tpls = await fetch('/api/templates').then(r=>r.json());
    const sel = document.getElementById('tpl-select');
    if(!sel) return;
    // Keep the blank first option
    while(sel.options.length>1) sel.remove(1);
    tpls.forEach(t=>{
      const o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name;
      o.dataset.tpl = JSON.stringify(t);
      sel.appendChild(o);
    });
  } catch(e){}
}

function applyTemplate(){
  const sel = document.getElementById('tpl-select');
  const opt = sel.options[sel.selectedIndex];
  if(!opt||!opt.dataset.tpl) { document.getElementById('tpl-info').textContent=''; return; }
  const t = JSON.parse(opt.dataset.tpl);
  const info = [t.region&&'Region: '+t.region, t.language&&'Lang: '+t.language, t.persona_name&&'Persona: '+t.persona_name].filter(Boolean).join(' · ');
  document.getElementById('tpl-info').textContent = info;
}

async function promptSaveTemplate(){
  const name = prompt('Template name (used with --template NAME flag):');
  if(!name||!name.trim()) return;
  // Save the first campaign's goal_script as a template
  if(!_lastData||!_lastData.length){ alert('No campaign data loaded yet.'); return; }
  const c = _lastData[0];
  try {
    const r = await fetch('/api/templates', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name: name.trim(), goal_script: c.goal_script||'', region:'', language:''})
    });
    const res = await r.json();
    if(res.ok){ alert('Template "'+name+'" saved!'); loadTemplates(); }
    else { alert('Save failed: '+(res.error||'unknown')); }
  } catch(e){ alert('Error: '+e); }
}

function renderInference(inf, label){
  if(!inf||Object.keys(inf).length===0)
    return `<span style="color:#555;font-size:.75rem">No ${label} inference</span>`;

  // Register in store so the View Raw button can access full data safely
  const key = 'inf_' + (_storeIdx++);
  _rawStore[key] = {title: label + ' — Full JSON', data: inf};

  // Show all fields except transcript blob (rendered separately); show raw_inference & error
  const SKIP = new Set(['transcript']);
  const rows = Object.entries(inf)
    .filter(([k])=>!SKIP.has(k))
    .map(([k,v])=>{
      const val = Array.isArray(v)?v.join(', '):String(v??'—');
      // Long values: show first 120 chars + "more" inline expand
      if(val.length > 120){
        return `<div class="inf-row">
          <span class="inf-key">${escHtml(k.replace(/_/g,' '))}</span>
          <span class="inf-val">
            <span class="val-short">${escHtml(val.slice(0,120))}&hellip;
              <button class="raw-btn" onclick="event.stopPropagation();this.closest('.inf-val').querySelector('.val-full').style.display='inline';this.parentNode.style.display='none'">more</button>
            </span>
            <span class="val-full" style="display:none">${escHtml(val)}</span>
          </span>
        </div>`;
      }
      return `<div class="inf-row">
        <span class="inf-key">${escHtml(k.replace(/_/g,' '))}</span>
        <span class="inf-val">${escHtml(val)}</span>
      </div>`;
    }).join('');

  const rawBtn = `<button class="raw-btn" onclick="event.stopPropagation();openModalByKey('${key}')">&#123;&#125; View Raw</button>`;
  return `<div style="display:flex;justify-content:flex-end;margin-bottom:6px">${rawBtn}</div>${rows}`;
}

function toggleExpand(leadId){
  const row = document.getElementById('exp-'+leadId);
  const chev = document.getElementById('chev-'+leadId);
  if(!row) return;
  const isOpen = row.classList.contains('open');
  row.classList.toggle('open', !isOpen);
  chev.classList.toggle('open', !isOpen);
}

async function load(){
  const [data, sched] = await Promise.all([
    fetch('/api/campaigns').then(r=>r.json()),
    fetch('/api/scheduled').then(r=>r.json()),
  ]);
  _lastData = data;

  loadTemplates();
  pollLiveRuns();

  // Stats → hero metric cards
  let totLeads=0, totPos=0, totDone=0, totSched=0;
  data.forEach(c=>c.leads.forEach(l=>{
    totLeads++;
    if(l.status==='positive') totPos++;
    if(l.status==='completed') totDone++;
  }));
  totSched = sched.filter(s=>s.status==='pending').length;
  const posRate = totLeads ? Math.round(totPos/totLeads*100) : 0;
  const doneRate = totLeads ? Math.round(totDone/totLeads*100) : 0;
  const metricCard = (n,label,accent,trendHtml)=>`
    <div class="stat">
      <div class="stat-n">${n}</div>
      <div class="stat-l"><span>${label}</span>${trendHtml||''}</div>
      ${_spark(accent)}
    </div>`;
  document.getElementById('stats').innerHTML =
      metricCard(data.length,'Campaigns','#6366f1',`<span class="stat-trend flat">&#9679; live</span>`)
    + metricCard(totLeads,'Total Leads','#8b5cf6',`<span class="stat-trend up">&#9650; ${totSched} queued</span>`)
    + metricCard(totPos,'R1 Positive','#22c55e',`<span class="stat-trend ${posRate>=30?'up':'flat'}">&#9650; ${posRate}%</span>`)
    + metricCard(totDone,'R2 Completed','#3b82f6',`<span class="stat-trend ${doneRate>0?'up':'flat'}">&#9650; ${doneRate}%</span>`);

  // Scheduled banner
  const schedBox = document.getElementById('sched');
  const schedList = document.getElementById('sched-list');
  if(sched.length>0){
    schedBox.style.display='block';
    schedList.innerHTML = sched.map(s=>`
      <div class="sched-item">
        <span class="sched-time">&#128337; ${escHtml(s.local_time)}</span>
        <span style="color:#c9d1d9;flex:1;font-size:.78rem">${escHtml(s.lead_name||s.masked_phone)} &mdash; ${escHtml(s.product)}</span>
        <span class="sched-status ss-${escHtml(s.status)}">${escHtml(s.status)}</span>
      </div>`).join('');
  } else {
    schedBox.style.display='none';
  }

  // Preserve which expand rows are currently open before re-render
  const _openIds = new Set(
    [...document.querySelectorAll('.expand-row.open')].map(el => el.id.replace('exp-',''))
  );

  // Campaigns
  document.getElementById('campaigns').innerHTML = data.map(c=>{
    const nLeads = c.leads.length;
    const nCalled = c.leads.filter(l=>l.status!=='not_called' && l.status!=='skipped').length;
    const nPos = c.leads.filter(l=>l.status==='positive').length;
    const pctPos = nLeads ? Math.round(nPos/nLeads*100) : 0;
    // Derive campaign status: active if any lead still uncalled but some called; completed if all called
    let cstatus='idle';
    if(nCalled>0 && nCalled<nLeads) cstatus='active';
    else if(nLeads>0 && nCalled===nLeads) cstatus='completed';
    const statusBadge = cstatus==='active'
      ? '<span class="status s-positive">active</span>'
      : cstatus==='completed'
        ? '<span class="status s-completed">completed</span>'
        : '<span class="status s-not_called">idle</span>';
    return `
    <div class="campaign stat-${cstatus}" data-status="${cstatus}">
      <div class="camp-hdr">
        <div>
          <span class="camp-title">#${c.id} &mdash; ${escHtml(c.product_description)}</span>
          &nbsp;<span class="camp-meta">@ ${escHtml(c.location)} &middot; ${nLeads} leads</span>
        </div>
        <div class="camp-progress">
          <div class="camp-bar" title="${pctPos}% positive"><div class="camp-bar-fill" style="width:${pctPos}%"></div></div>
          <span class="camp-bar-label">${pctPos}% positive</span>
          ${statusBadge}
          ${c.consent_approved_at
            ? `<span class="consent-ok">&#10003; Consent</span>`
            : '<span class="consent-no">&#10007; No gate</span>'}
          ${!c.consent_approved_at
            ? `<button class="consent-approve-btn" onclick="approveCampaign(${c.id})">&#9654; Give Consent &amp; Call</button>`
            : ''}
        </div>
      </div>
      <table>
        <thead><tr>
          <th style="width:28px"></th>
          <th>Name</th><th>Phone</th><th>Category</th>
          <th>R1</th><th>R2</th><th>Quick Summary</th>
        </tr></thead>
        <tbody>
          ${c.leads.map(l=>`
            <tr class="lead-row" onclick="toggleExpand(${l.id})">
              <td><span class="chev" id="chev-${l.id}">&#9658;</span></td>
              <td>
                <div>${escHtml(trunc(l.name,28))}</div>
                ${l.address?`<div class="address-tag">&#128205; ${escHtml(trunc(l.address,40))}</div>`:''}
              </td>
              <td style="font-family:monospace;color:#79c0ff">${escHtml(l.masked_phone)}</td>
              <td style="color:#d2a8ff">${escHtml(trunc(l.category,18))}</td>
              <td>${badge(l.r1_status)}</td>
              <td>${l.r2_status?badge(l.r2_status):'<span style="color:#444">—</span>'}
                  ${l.scheduled_at?`<br><span class="sched-tag">&#128197; ${escHtml(l.scheduled_local)}</span>`:''}
                  ${l.reliability&&l.reliability.score?`<span class="rel-badge rel-${escHtml(l.reliability.score)}">${l.reliability.score==='green'?'✓ reliable':l.reliability.score==='red'?'✗ low':'~ ok'}</span>`:''}
              </td>
              <td style="color:#8b949e;font-size:.75rem">${escHtml(trunc(l.summary,60))}</td>
            </tr>
            <tr class="expand-row" id="exp-${l.id}">
              <td colspan="7">
                <div class="expand-inner">

                  <div class="exp-section">
                    <h4>&#128222; Lead Details</h4>
                    ${renderInference({
                      'Name': l.name,
                      'Phone (masked)': l.masked_phone,
                      'Category': l.category,
                      'Address': l.address||'Not available in OSM',
                      'Candidate ID': l.candidate_id||'—',
                      'Status': l.status,
                      'Skip reason': l.skip_reason||'—',
                    }, 'lead')}
                    ${l.scheduled_at?`
                    <div style="margin-top:8px;padding:6px;background:#162016;border-radius:4px;font-size:.75rem">
                      <span style="color:#56d364">&#128197; Scheduled R2 call:</span>
                      <span style="color:#e3b341"> ${escHtml(l.scheduled_local)}</span>
                      <span style="color:#56d364"> (${escHtml(l.scheduled_tz)})</span>
                    </div>`:''}
                  </div>

                  <div class="exp-section">
                    <h4>&#129302; R1 Inference (Qualification)</h4>
                    ${renderInference(l.r1_inference,'R1')}
                  </div>

                  <div class="exp-section">
                    <h4>&#128203; R2 Inference (Data Capture)</h4>
                    ${renderInference(l.r2_inference,'R2')}
                  </div>

                  <div class="exp-section">
                    <h4>&#128172; Full Transcript</h4>
                    ${renderTranscript(l.transcript)}
                  </div>

                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `; }).join('');

  // Re-apply active campaign filter after re-render
  if(typeof filterCampaigns==='function') filterCampaigns(_campFilter);

  // Update campaign count badge
  const _cc = document.getElementById('camp-count');
  if(_cc) _cc.textContent = data.length;

  // Restore previously open expand rows so refresh doesn't collapse them
  _openIds.forEach(id => {
    const row  = document.getElementById('exp-' + id);
    const chev = document.getElementById('chev-' + id);
    if (row)  row.classList.add('open');
    if (chev) chev.classList.add('open');
  });

  if(_activeTab==='analytics') renderAnalytics(data);
  if(_activeTab==='map') renderMap(data);
}

// ── New Campaign Wizard ──────────────────────────────────────────
let _wizCampaignId = null;
let _wizLanguage = 'Hindi';

function toggleWizard(){
  const w = document.getElementById('wizard');
  const btn = document.getElementById('nc-open-btn');
  const open = w.classList.toggle('open');
  btn.classList.toggle('active', open);
  btn.textContent = open ? '✕ Close' : '＋ New Campaign';
}

function toggleStartBtn(){
  const checked = document.getElementById('wiz-consent').checked;
  const btn = document.getElementById('wiz-start-btn');
  btn.disabled = !checked;
  btn.style.opacity = checked ? '1' : '0.4';
  btn.style.cursor = checked ? 'pointer' : 'not-allowed';
}

function resetWizard(){
  _wizCampaignId = null;
  document.getElementById('wiz-step1').style.display = '';
  document.getElementById('wiz-step2').classList.remove('on');
  document.getElementById('wiz-discover-btn').disabled = false;
  document.getElementById('wiz-spinner').classList.remove('on');
  document.getElementById('wiz-error').textContent = '';
  document.getElementById('calling-status').classList.remove('on');
  document.getElementById('wiz-start-btn').disabled = true;
  document.getElementById('wiz-start-btn').style.opacity = '0.4';
  document.getElementById('wiz-start-btn').textContent = '📞 Start Calling All';
  document.getElementById('wiz-consent').checked = false;
}

async function discoverVendors(){
  const product  = document.getElementById('wiz-product').value.trim();
  const location = document.getElementById('wiz-location').value.trim();
  const limit    = parseInt(document.getElementById('wiz-limit').value) || 15;
  _wizLanguage   = document.getElementById('wiz-language').value;

  if(!product || !location){
    document.getElementById('wiz-error').textContent = 'Fill in product and location first.';
    return;
  }
  document.getElementById('wiz-error').textContent = '';
  document.getElementById('wiz-discover-btn').disabled = true;
  document.getElementById('wiz-spinner').classList.add('on');

  try {
    const res = await fetch('/api/discover', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({product, location, max_vendors: limit, language: _wizLanguage, region: 'IN'})
    });
    const data = await res.json();
    if(!res.ok || data.error){
      const msg = data.error || 'Discovery failed.';
      const friendly = msg.includes('429') || msg.includes('Too many')
        ? '⏳ Map server is rate-limited — please wait 60 seconds and try again.'
        : msg.includes('No vendors') ? '🔍 No vendors found — try a broader location (e.g. "Delhi" instead of a street name).'
        : msg;
      document.getElementById('wiz-error').textContent = friendly;
      document.getElementById('wiz-discover-btn').disabled = false;
      document.getElementById('wiz-spinner').classList.remove('on');
      return;
    }

    _wizCampaignId = data.campaign_id;
    document.getElementById('wiz-spinner').classList.remove('on');
    document.getElementById('wiz-step1').style.display = 'none';

    // Populate preview table
    document.getElementById('preview-title').textContent =
      `Found ${data.vendors.length} vendor${data.vendors.length!==1?'s':''} — Campaign #${data.campaign_id}`;
    document.getElementById('preview-meta').textContent =
      ` · ${escHtml(data.product)} in ${escHtml(data.location)}`;

    const scoreClass = s => s>=8?'score-hi':s>=5?'score-mid':'score-lo';
    document.getElementById('preview-tbody').innerHTML = data.vendors.map(v=>`
      <tr>
        <td><span class="score-pill ${scoreClass(v.score)}">${v.score}/10</span></td>
        <td style="font-weight:500">${escHtml(v.name||'Unknown')}</td>
        <td style="color:#d2a8ff">${escHtml(v.category||'—')}</td>
        <td style="color:#8b949e;font-size:.75rem">${escHtml((v.address||'—').slice(0,45))}</td>
        <td style="font-family:monospace;color:#79c0ff">${escHtml(v.masked_phone)}</td>
      </tr>`).join('');

    document.getElementById('wiz-start-btn').textContent =
      `📞 Start Calling All ${data.vendors.length} Vendors`;
    document.getElementById('wiz-step2').classList.add('on');
  } catch(e){
    document.getElementById('wiz-error').textContent = 'Network error: ' + e.message;
    document.getElementById('wiz-discover-btn').disabled = false;
    document.getElementById('wiz-spinner').classList.remove('on');
  }
}

async function startCalling(){
  if(!_wizCampaignId) return;
  document.getElementById('wiz-start-btn').disabled = true;
  document.getElementById('wiz-start-btn').textContent = 'Launching…';

  try {
    const res = await fetch(`/api/campaigns/${_wizCampaignId}/start`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({language: _wizLanguage, region: 'IN'})
    });
    const data = await res.json();
    if(data.started){
      document.getElementById('wiz-start-btn').textContent = '✓ Pipeline Running';
      document.getElementById('calling-status').classList.add('on');
      switchTab('live');
    } else {
      document.getElementById('wiz-start-btn').textContent = 'Error — try again';
      document.getElementById('wiz-start-btn').disabled = false;
    }
  } catch(e){
    document.getElementById('wiz-start-btn').textContent = 'Error — try again';
    document.getElementById('wiz-start-btn').disabled = false;
  }
}

// Countdown + auto-refresh
let t=8;
setInterval(()=>{ t--; document.getElementById('cd').textContent=t; if(t<=0){t=8;load();pollLiveRuns();} },1000);
load();

// ──── Callie AI Chatbot ────
let _callieMsgs = [];
let _callieOpen = false;
let _callieBiz = localStorage.getItem('callie_biz') || '';

function callieToggle() {
  _callieOpen = !_callieOpen;
  const panel = document.getElementById('callie-panel');
  if (_callieOpen) {
    panel.classList.add('open');
    _callieOrb.classList.remove('pulse');
    clearInterval(_calliePulseTimer);  // stop pulsing once user engages
    document.getElementById('callie-badge').classList.remove('on');
    if (!_callieBiz) {
      _callieScreen('setup');
      setTimeout(() => document.getElementById('callie-biz-input').focus(), 80);
    } else {
      _callieScreen('chat');
      // Reset textarea height on reopen
      const inp = document.getElementById('callie-input');
      inp.style.height = '';
      if (_callieMsgs.length === 0) _callieGreet();
      else setTimeout(() => inp.focus(), 80);
    }
  } else {
    panel.classList.remove('open');
  }
}

function _callieScreen(s) {
  document.getElementById('callie-setup-screen').style.display = s==='setup' ? '' : 'none';
  document.getElementById('callie-messages').style.display    = s==='chat'  ? '' : 'none';
  document.getElementById('callie-pills').style.display       = s==='chat'  ? '' : 'none';
  document.getElementById('callie-input-row').style.display   = s==='chat'  ? '' : 'none';
}

function callieSetupDone() {
  const n = document.getElementById('callie-biz-input').value.trim();
  if (!n) { document.getElementById('callie-biz-input').focus(); return; }
  _callieBiz = n;
  localStorage.setItem('callie_biz', n);
  _callieScreen('chat');
  _callieGreet();
}

function _callieGreet() {
  callieAddMsg('callie', `Hi! I'm **Callie**, your AI outreach assistant for **${escHtml(_callieBiz)}**. ✦\n\nI have full access to your CALL-E pipeline. Ask me to find vendors, start campaigns, check call results, or send WhatsApp messages — I'll handle it directly.`);
}

const _CALLIE_MINI_SVG = `<svg width="24" height="24" viewBox="0 0 54 54" fill="none"><defs><linearGradient id="cgm" x1="8" y1="6" x2="46" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#2563eb"/></linearGradient><radialGradient id="cem" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9ecbff"/></radialGradient></defs><circle cx="27" cy="27" r="25" fill="url(#cgm)"/><circle cx="27" cy="27" r="25" fill="none" stroke="#58a6ff" stroke-opacity=".4" stroke-width="1"/><rect x="18.5" y="22" width="4.2" height="9" rx="2.1" fill="url(#cem)"/><rect x="31.3" y="22" width="4.2" height="9" rx="2.1" fill="url(#cem)"/><path d="M20.5 36 Q27 41 33.5 36" stroke="#e0f2ff" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>`;

function callieAddMsg(role, text, html) {
  if (text) _callieMsgs.push({ role, text });  // skip empty entries to avoid Groq 400
  const msgs = document.getElementById('callie-messages');
  const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'c-msg ' + role;
  // Always escape first, then apply markdown — never inject raw html from LLM/tools
  const content = _callieMd(text || '');
  if (role === 'callie') {
    div.innerHTML = `<div class="c-mini-avatar">${_CALLIE_MINI_SVG}</div><div><div class="c-bubble">${content}</div><div class="c-time">${now}</div></div>`;
  } else {
    div.innerHTML = `<div><div class="c-bubble">${content}</div><div class="c-time">${now}</div></div>`;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function _callieMd(t) {
  // Escape ALL HTML first, then selectively re-introduce safe tags only
  return (t || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code style="background:#0d1117;padding:1px 4px;border-radius:3px;font-family:monospace">$1</code>')
    .replace(/\n/g,'<br>');
}

function callieShowTyping() {
  const msgs = document.getElementById('callie-messages');
  const div = document.createElement('div');
  div.className='c-msg callie'; div.id='callie-typing-el';
  div.innerHTML=`<div class="c-mini-avatar">${_CALLIE_MINI_SVG}</div><div class="c-typing-bubble"><span></span><span></span><span></span></div>`;
  msgs.appendChild(div); msgs.scrollTop=msgs.scrollHeight;
}
function callieHideTyping(){const el=document.getElementById('callie-typing-el');if(el)el.remove();}

let _callieBusy = false;

function _callieSetBusy(busy) {
  _callieBusy = busy;
  document.getElementById('callie-send-btn').disabled = busy;
  document.querySelectorAll('.c-pill').forEach(p => p.disabled = busy);
  document.getElementById('callie-input').disabled = busy;
}

function callieKeydown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();callieSend();}}

function callieQuick(text){
  if(_callieBusy) return;
  callieAddMsg('user',text); callieRequest(text);
}

async function callieSend(){
  if(_callieBusy) return;
  const inp=document.getElementById('callie-input');
  const text=inp.value.trim(); if(!text)return;
  inp.value=''; inp.style.height='';
  callieAddMsg('user',text); await callieRequest(text);
}

async function callieRequest(msg){
  _callieSetBusy(true);
  callieShowTyping();
  try{
    const res=await fetch('/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg,history:_callieMsgs.slice(-6),business_name:_callieBiz})
    });
    const data=await res.json();
    callieHideTyping();
    if(data.reply) callieAddMsg('callie',data.reply);
    if(data.actions&&data.actions.length) data.actions.forEach(callieExecAction);
  }catch(e){
    callieHideTyping();
    callieAddMsg('callie',`⚠️ Connection error: ${e.message}`);
  }finally{
    _callieSetBusy(false);
    setTimeout(()=>document.getElementById('callie-input').focus(),50);
  }
}

function callieExecAction(a){
  if(a.type==='navigate_to'){switchTab(a.tab);callieToast('Switched to '+a.tab+' tab');}
  else if(a.type==='open_wizard'){if(!document.getElementById('wizard').classList.contains('open'))toggleWizard();callieToast('Campaign wizard opened');}
  else if(a.type==='refresh'){load();}
  else if(a.type==='toast'){callieToast(a.message);}
  else if(a.type==='fill_wizard'){callieFillWizard(a);}
  else if(a.type==='highlight_element'){callieHighlight(a.selector,a.message);}
  else if(a.type==='show_lead_detail'){callieShowLeadDetail(a.lead_id);}
  else if(a.type==='filter_leads'){callieFilterLeads(a.status);}
  else if(a.type==='show_stats_popup'){callieStatsPopup(a.stats);}
  else if(a.type==='change_theme'){callieApplyTheme(a.theme);}
  else if(a.type==='start_tour'){callieStartTour(a.tour_name);}
  else if(a.type==='stop_tour'){_callieTourActive=false;callieToast('Tour stopped');}
}

function callieFillWizard(a){
  if(!document.getElementById('wizard').classList.contains('open')) toggleWizard();
  const setV=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null)el.value=v;};
  setV('wiz-product',a.product); setV('wiz-location',a.location);
  if(a.limit) setV('wiz-limit',a.limit);
  if(a.language){const sel=document.getElementById('wiz-language');if(sel)[...sel.options].forEach(o=>{if(o.value===a.language||o.text===a.language)sel.value=o.value;});}
  document.getElementById('wizard').scrollIntoView({behavior:'smooth',block:'center'});
  callieHighlight('#wiz-discover-btn','Click here to discover vendors!');
}

let _callieHl=null;
function callieHighlight(selector,message){
  if(_callieHl){_callieHl.el.style.boxShadow=_callieHl.prev;_callieHl.el.style.animation='';if(_callieHl.tip)_callieHl.tip.remove();_callieHl=null;}
  const el=document.querySelector(selector); if(!el)return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  const prev=el.style.boxShadow;
  el.style.transition='box-shadow .2s'; el.style.boxShadow='0 0 0 3px rgba(124,58,237,.9),0 0 18px rgba(124,58,237,.6)'; el.style.animation='callie-hl-pulse 1.1s ease-in-out 3';
  let tip=null;
  if(message){tip=document.createElement('div');tip.textContent=message;tip.style.cssText='position:fixed;z-index:9500;background:#1a0835;color:#e0e0e0;border:1px solid #7c3aed;padding:6px 12px;border-radius:8px;font-size:.75rem;max-width:220px;box-shadow:0 6px 24px rgba(0,0,0,.5);pointer-events:none';document.body.appendChild(tip);const r=el.getBoundingClientRect();tip.style.top=Math.max(8,r.top-44)+'px';tip.style.left=r.left+'px';}
  _callieHl={el,prev,tip};
  setTimeout(()=>{if(_callieHl&&_callieHl.el===el){el.style.boxShadow=prev;el.style.animation='';if(tip)tip.remove();_callieHl=null;}},4500);
}

function callieShowLeadDetail(leadId){
  if(typeof _activeTab!=='undefined'&&_activeTab!=='leads')switchTab('leads');
  const row=document.getElementById('exp-'+leadId);
  if(!row){callieToast('Refreshing to find that lead...');load();return;}
  if(!row.classList.contains('open'))toggleExpand(leadId);
  row.scrollIntoView({behavior:'smooth',block:'center'});
  callieHighlight('#exp-'+leadId,'Full details for this lead');
}

function callieFilterLeads(status){
  if(typeof _activeTab!=='undefined'&&_activeTab!=='leads')switchTab('leads');
  document.querySelectorAll('tr.lead-row').forEach(tr=>{
    const badge=tr.querySelector('.status');
    const s=badge?badge.textContent.trim():'';
    tr.style.display=(!status||status==='all'||s===status)?'':'none';
  });
  callieToast(status&&status!=='all'?('Showing '+status+' leads'):'Showing all leads');
}

function callieStatsPopup(stats){
  const s=(typeof stats==='string')?JSON.parse(stats):(stats||{});
  document.getElementById('callie-stats-popup')?.remove();
  const box=document.createElement('div'); box.id='callie-stats-popup';
  box.style.cssText='position:fixed;bottom:100px;right:420px;z-index:9002;background:#161b22;border:1px solid #7c3aed;border-radius:12px;padding:12px 14px;box-shadow:0 12px 40px rgba(0,0,0,.6);max-width:230px;font-size:.78rem';
  const rows=Object.entries(s).map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px solid #21262d"><span style="color:#8b949e">${escHtml(k.replace(/_/g,' '))}</span><span style="color:#58a6ff;font-weight:700">${escHtml(String(v))}</span></div>`).join('');
  box.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="color:#f0f6fc;font-weight:700;font-size:.8rem">Quick Stats</span><button onclick="this.closest('[id]').remove()" style="background:none;border:none;color:#666;cursor:pointer;font-size:.9rem">&#x2715;</button></div>${rows}`;
  document.body.appendChild(box);
  setTimeout(()=>{box.style.transition='opacity .4s';box.style.opacity='0';setTimeout(()=>box.remove(),400);},12000);
}

function callieToast(msg){
  const t=document.createElement('div');
  t.style.cssText='position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#161b22;border:1px solid #7c3aed;color:#c9d1d9;padding:7px 18px;border-radius:8px;font-size:.78rem;z-index:9999;pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.4)';
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),300);},2500);
}

async function approveCampaign(campId){
  try{
    const res = await fetch(`/api/campaign/${campId}/approve`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({})
    });
    const j = await res.json();
    if(!res.ok || !j.ok){
      callieToast(j.message || 'Could not approve campaign');
      return;
    }
  }catch(e){
    callieToast('Approve failed: '+e);
    return;
  }
  callieToast('Campaign approved — calling pipeline started!');
  switchTab('live');
  if(typeof load==='function') load();
}

// Pulse orb periodically when closed; cleared once user opens Callie
const _callieOrb = document.getElementById('callie-orb');
const _calliePulseTimer = setInterval(()=>{
  if(!_callieOpen) _callieOrb.classList.add('pulse');
},60000);

// ── Callie Theme System ──
var _callieThemes={midnight:{bg:'#0f1117',card:'#161b22',border:'#30363d',accent:'#58a6ff'},purple_haze:{bg:'#0d0a14',card:'#130a24',border:'#3d1f6e',accent:'#a855f7'},emerald:{bg:'#0a110d',card:'#0f1a12',border:'#1a3a22',accent:'#34d399'},ocean:{bg:'#091119',card:'#0d1820',border:'#0e3a4a',accent:'#22d3ee'}};
function callieApplyTheme(themeName){var t=_callieThemes[themeName]||_callieThemes.midnight;var css='body{background-color:'+t.bg+';color:#e6edf3}'+'h1,.stat-n,.sub a,.t-bot{color:'+t.accent+'}'+'.stat,.campaign,.exp-section,.modal-box,.callie-panel,.expand-inner{background:'+t.card+';border-color:'+t.border+'}'+'thead th{background:'+t.card+'}'+'.callie-orb{filter:drop-shadow(0 0 8px '+t.accent+')}';document.getElementById('callie-theme-override').textContent=css;callieToast('Theme: '+themeName+' ✨');}

// ── Callie Guided Tours ──
var _callieTourActive=false;
var _callieTours={onboarding:[{selector:'#tab-leads',msg:"This is the Leads tab — all your discovered vendors live here 👀"},{selector:'.stats',msg:"Quick stats: total leads, positives, pending, and more"},{selector:'#tab-analytics',msg:"Analytics shows charts of your campaign performance 📊"},{selector:'#tab-map',msg:"Map view plots all vendors geographically 🗺️"},{selector:'#tab-live',msg:"Live tab — watch AI calls happen in real time 🔴"},{selector:'.callie-btn',msg:"And I'm always here to help! Just click me anytime 💜"}],campaign_flow:[{selector:'.callie-btn',msg:"Step 1: Tell me what you need — e.g. 'Find grocery vendors in Delhi'"},{selector:'#tab-leads',msg:"Step 2: Vendors appear here, each scored 1-10 for quality"},{selector:'#tab-live',msg:"Step 3: Start calling and watch it live"},{selector:'#tab-analytics',msg:"Step 4: Check your success rate in Analytics after calls"}],whatsapp_flow:[{selector:'#tab-leads',msg:"First: go to Leads and filter by 'positive' status"},{selector:'.callie-panel',msg:"Then ask me: 'Send WhatsApp to all positive leads in campaign X'"}]};
function _callieTourIndicator(cur,total){var el=document.getElementById('callie-tour-ind');if(!el){el=document.createElement('div');el.id='callie-tour-ind';el.style.cssText='position:fixed;bottom:20px;left:20px;z-index:99999;background:#161b22;border:1px solid #7c3aed;color:#e6edf3;padding:8px 14px;border-radius:8px;font-size:13px;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,.4)';document.body.appendChild(el);}el.textContent='Tour: '+cur+'/'+total;}
function _callieTourEnd(){var el=document.getElementById('callie-tour-ind');if(el)el.remove();_callieTourActive=false;}
function callieStartTour(tourName){var steps=_callieTours[tourName];if(!steps)return;_callieTourActive=true;var i=0;function run(){if(!_callieTourActive){_callieTourEnd();return;}if(i>=steps.length){_callieTourEnd();callieToast('Tour complete! 🎉');return;}var step=steps[i];_callieTourIndicator(i+1,steps.length);if(step.tab&&typeof switchTab==='function')switchTab(step.tab);callieHighlight(step.selector,step.msg);i++;setTimeout(run,3500);}run();}
</script>

<!-- ── Callie Floating Avatar ── -->
<button class="callie-btn" onclick="callieToggle()" id="callie-btn" title="Chat with Callie">
  <div class="callie-orb pulse" id="callie-orb">
    <svg width="54" height="54" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="callieGrad" x1="8" y1="6" x2="46" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
        <radialGradient id="callieGloss" cx="0.35" cy="0.28" r="0.75"><stop offset="0" stop-color="#ffffff" stop-opacity="0.4"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.05"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
        <radialGradient id="callieEye" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#e0f2ff"/><stop offset="1" stop-color="#9ecbff"/></radialGradient>
        <filter id="callieSoft"><feGaussianBlur stdDeviation="0.5"/></filter>
      </defs>
      <circle cx="27" cy="27" r="25" fill="url(#callieGrad)"/>
      <circle cx="27" cy="27" r="25" fill="none" stroke="#58a6ff" stroke-opacity="0.5" stroke-width="1.2"/>
      <circle cx="27" cy="27" r="24" fill="url(#callieGloss)"/>
      <g class="callie-face-eyes" filter="url(#callieSoft)">
        <rect x="18.5" y="22" width="4.2" height="9" rx="2.1" fill="url(#callieEye)"/>
        <rect x="31.3" y="22" width="4.2" height="9" rx="2.1" fill="url(#callieEye)"/>
        <circle cx="20.6" cy="24.4" r="0.9" fill="#ffffff"/>
        <circle cx="33.4" cy="24.4" r="0.9" fill="#ffffff"/>
      </g>
      <path d="M20.5 36 Q27 41 33.5 36" stroke="#e0f2ff" stroke-width="2.2" stroke-linecap="round" fill="none" stroke-opacity="0.92"/>
      <g class="callie-face-spark"><path d="M40.5 12C40.9 14.1 41.9 15.1 44 15.5C41.9 15.9 40.9 16.9 40.5 19C40.1 16.9 39.1 15.9 37 15.5C39.1 15.1 40.1 14.1 40.5 12Z" fill="#e0f2ff"/></g>
    </svg>
    <div class="callie-badge" id="callie-badge">!</div>
  </div>
  <span class="callie-label">CALLIE</span>
</button>

<!-- Callie Chat Panel -->
<div class="callie-panel" id="callie-panel">
  <!-- Header -->
  <div class="callie-header">
    <svg width="36" height="36" viewBox="0 0 54 54" fill="none" style="flex-shrink:0;filter:drop-shadow(0 2px 8px rgba(124,58,237,.5))">
      <defs>
        <linearGradient id="callieGrad2" x1="8" y1="6" x2="46" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
        <radialGradient id="callieEye2" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9ecbff"/></radialGradient>
      </defs>
      <circle cx="27" cy="27" r="25" fill="url(#callieGrad2)"/>
      <circle cx="27" cy="27" r="25" fill="none" stroke="#58a6ff" stroke-opacity="0.4" stroke-width="1"/>
      <rect x="18.5" y="22" width="4.2" height="9" rx="2.1" fill="url(#callieEye2)"/>
      <rect x="31.3" y="22" width="4.2" height="9" rx="2.1" fill="url(#callieEye2)"/>
      <path d="M20.5 36 Q27 41 33.5 36" stroke="#e0f2ff" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    </svg>
    <div>
      <div class="callie-header-name">Callie</div>
      <div class="callie-header-status"><div class="callie-online-dot"></div>&nbsp;AI Outreach Assistant</div>
    </div>
    <button class="callie-close" onclick="callieToggle()" title="Close">&#x2715;</button>
  </div>
  <!-- First-use setup -->
  <div id="callie-setup-screen" class="callie-setup">
    <svg width="48" height="48" viewBox="0 0 54 54" fill="none" style="margin-bottom:4px;filter:drop-shadow(0 4px 12px rgba(124,58,237,.5))">
      <defs>
        <linearGradient id="callieGrad3" x1="8" y1="6" x2="46" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
        <radialGradient id="callieEye3" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9ecbff"/></radialGradient>
      </defs>
      <circle cx="27" cy="27" r="25" fill="url(#callieGrad3)"/>
      <circle cx="27" cy="27" r="25" fill="none" stroke="#58a6ff" stroke-opacity="0.5" stroke-width="1.2"/>
      <rect x="18.5" y="22" width="4.2" height="9" rx="2.1" fill="url(#callieEye3)"/>
      <rect x="31.3" y="22" width="4.2" height="9" rx="2.1" fill="url(#callieEye3)"/>
      <circle cx="20.6" cy="24.4" r="0.9" fill="#ffffff"/>
      <circle cx="33.4" cy="24.4" r="0.9" fill="#ffffff"/>
      <path d="M20.5 36 Q27 41 33.5 36" stroke="#e0f2ff" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <path d="M40.5 12C40.9 14.1 41.9 15.1 44 15.5C41.9 15.9 40.9 16.9 40.5 19C40.1 16.9 39.1 15.9 37 15.5C39.1 15.1 40.1 14.1 40.5 12Z" fill="#e0f2ff"/>
    </svg>
    <h3>Hey! I'm Callie 👋</h3>
    <p>Your AI outreach sidekick — I've got full access to your CALL-E pipeline. I can find vendors, run campaigns, check calls, send WhatsApp messages, and guide you through everything.</p>
    <p style="color:#555;font-size:.72rem;margin-top:-4px">What's your business called?</p>
    <input class="callie-setup-input" type="text" id="callie-biz-input" placeholder="e.g. Acme Supplies Pvt Ltd" onkeydown="if(event.key==='Enter')callieSetupDone()"/>
    <button class="callie-setup-btn" onclick="callieSetupDone()">Let's go! &#8594;</button>
  </div>
  <!-- Messages -->
  <div class="callie-messages" id="callie-messages" style="display:none"></div>
  <!-- Quick pills -->
  <div class="callie-pills" id="callie-pills" style="display:none">
    <button class="c-pill" onclick="callieQuick('Give me a full campaign and call status overview')">&#128202; Status</button>
    <button class="c-pill" onclick="callieQuick('Help me find vendors')">&#128269; Find Vendors</button>
    <button class="c-pill" onclick="callieQuick('Show recent call results')">&#128222; Call Results</button>
    <button class="c-pill" onclick="callieQuick('Check WhatsApp status and recent messages')">&#128172; WhatsApp</button>
  </div>
  <!-- Input -->
  <div class="callie-input-row" id="callie-input-row" style="display:none">
    <textarea class="callie-input" id="callie-input" placeholder="Ask Callie anything…" rows="1"
      onkeydown="callieKeydown(event)"
      oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"></textarea>
    <button class="callie-send" id="callie-send-btn" onclick="callieSend()" title="Send">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    </button>
  </div>
</div>
</body>
</html>
"""


@app.route("/")
def index():
    return render_template_string(_HTML)


@app.route("/api/campaigns")
def api_campaigns():
    from reliability import compute_all_reliability
    init_db()
    with get_conn() as conn:
        campaigns = conn.execute(
            "SELECT id,product_description,location,consent_basis,consent_approved_at,created_at "
            "FROM campaigns ORDER BY id DESC"
        ).fetchall()

        # Scheduled calls lookup: lead_id -> row
        sched_rows = conn.execute(
            "SELECT * FROM scheduled_calls WHERE status IN ('pending','in_progress') ORDER BY lead_id, scheduled_at"
        ).fetchall()
        sched_by_lead = {}
        for s in sched_rows:
            # Keep earliest pending call per lead (query ordered by lead_id, scheduled_at)
            if s["lead_id"] not in sched_by_lead:
                sched_by_lead[s["lead_id"]] = s

        # Cap synchronous Nominatim geocodes per request. Each lookup is a blocking
        # HTTP call (up to ~5s); without a budget an uncached campaign would stall the
        # /api/campaigns endpoint for many seconds on every 8s poll (N+1 network calls).
        _geocode_budget = 3

        result = []
        for c in campaigns:
            leads_raw = conn.execute(
                """SELECT l.id, l.name, l.masked_phone, l.phone, l.category, l.status,
                          l.address, l.candidate_id, l.skip_reason,
                          l.round1_call_id, l.round2_call_id, l.lat, l.lon,
                          r1log.extracted_fields AS r1_fields,
                          r2log.extracted_fields AS r2_fields
                   FROM leads l
                   LEFT JOIN (
                       SELECT lead_id, extracted_fields FROM call_logs
                       WHERE id IN (SELECT MAX(id) FROM call_logs WHERE round=1 GROUP BY lead_id)
                   ) r1log ON r1log.lead_id=l.id
                   LEFT JOIN (
                       SELECT lead_id, extracted_fields FROM call_logs
                       WHERE id IN (SELECT MAX(id) FROM call_logs WHERE round=2 GROUP BY lead_id)
                   ) r2log ON r2log.lead_id=l.id
                   WHERE l.campaign_id=? ORDER BY l.id""",
                (c["id"],)
            ).fetchall()

            try:
                rel_map = compute_all_reliability(conn, c["id"])
            except Exception:
                rel_map = {}

            leads = []
            for l in leads_raw:
                r1_ef = json.loads(l["r1_fields"]) if l["r1_fields"] else {}
                r2_ef = json.loads(l["r2_fields"]) if l["r2_fields"] else {}

                # Separate transcript from inference; handle string vs list format
                raw_tr = r1_ef.pop("transcript", [])
                if isinstance(raw_tr, str):
                    from caller import parse_transcript_to_json
                    transcript = parse_transcript_to_json({"result": {"transcript": raw_tr}})
                else:
                    transcript = raw_tr or []
                # Also check r2 for transcript if r1 has none
                if not transcript:
                    raw_tr2 = r2_ef.pop("transcript", [])
                    if isinstance(raw_tr2, str):
                        from caller import parse_transcript_to_json
                        transcript = parse_transcript_to_json({"result": {"transcript": raw_tr2}})
                    else:
                        transcript = raw_tr2 or []
                else:
                    r2_ef.pop("transcript", None)
                summary = (r2_ef.get("summary") or r1_ef.get("summary")
                           or r2_ef.get("transcript_summary","")
                           or r1_ef.get("transcript_summary",""))

                # Determine R1 / R2 display status
                has_r2 = bool(l["round2_call_id"])
                r1_status = l["status"]
                r2_status = l["status"] if has_r2 else None

                # Scheduled call info
                sc = sched_by_lead.get(l["id"])
                sched_local = None
                sched_tz    = None
                if sc:
                    try:
                        from datetime import datetime, timezone
                        from zoneinfo import ZoneInfo
                        tz = ZoneInfo(sc["timezone"] or "UTC")
                        dt = datetime.fromisoformat(sc["scheduled_at"])
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        sched_local = dt.astimezone(tz).strftime("%b %d %H:%M")
                        sched_tz    = sc["timezone"]
                    except Exception:
                        sched_local = sc["scheduled_at"][:16]

                # Lazy geocode: if lead has no coords but was called, try Nominatim once.
                # Bounded by _geocode_budget so a single request can't stall on many
                # blocking HTTP lookups (see budget note above the campaigns loop).
                lead_lat, lead_lon = l["lat"], l["lon"]
                if (lead_lat is None) and _geocode_budget > 0 and l["status"] not in ("not_called", "skipped") and l["name"]:
                    _geocode_budget -= 1
                    try:
                        import urllib.request as _ur, urllib.parse as _up
                        _q = _up.urlencode({"q": f"{l['name']}, {c['location']}", "format": "json", "limit": 1})
                        _req = _ur.Request(f"https://nominatim.openstreetmap.org/search?{_q}",
                                           headers={"User-Agent": "calle-dashboard/1.0"})
                        with _ur.urlopen(_req, timeout=5) as _r:
                            _res = __import__("json").loads(_r.read())
                            if _res:
                                lead_lat = float(_res[0]["lat"])
                                lead_lon = float(_res[0]["lon"])
                                conn.execute("UPDATE leads SET lat=?, lon=? WHERE id=?",
                                             (lead_lat, lead_lon, l["id"]))
                                conn.commit()
                    except Exception:
                        pass

                leads.append({
                    "id":             l["id"],
                    "name":           l["name"],
                    "masked_phone":   l["masked_phone"] or _mask_phone(l["phone"]),
                    "category":       l["category"],
                    "address":        l["address"],
                    "candidate_id":   l["candidate_id"],
                    "skip_reason":    l["skip_reason"],
                    "status":         l["status"],
                    "lat":            lead_lat,
                    "lon":            lead_lon,
                    "r1_status":      r1_status,
                    "r2_status":      r2_status,
                    "summary":        summary,
                    "transcript":     transcript,
                    "r1_inference":   r1_ef,
                    "r2_inference":   r2_ef,
                    "scheduled_at":   sc["scheduled_at"] if sc else None,
                    "scheduled_local":sched_local,
                    "scheduled_tz":   sched_tz,
                    "reliability":    rel_map.get(l["id"], {"score": "grey", "answer_rate": 0, "attempts": 0}),
                })

            result.append({
                "id":                  c["id"],
                "product_description": c["product_description"],
                "location":            c["location"],
                "consent_basis":       c["consent_basis"],
                "consent_approved_at": c["consent_approved_at"],
                "created_at":          c["created_at"],
                "leads":               leads,
            })

    return jsonify(result)


@app.route("/api/scheduled")
def api_scheduled():
    init_db()
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT sc.*, l.name AS lead_name, l.masked_phone, l.phone,
                      c.product_description AS product
               FROM scheduled_calls sc
               JOIN leads l ON l.id=sc.lead_id
               JOIN campaigns c ON c.id=sc.campaign_id
               ORDER BY sc.scheduled_at"""
        ).fetchall()
        result = []
        for r in rows:
            local_time = r["scheduled_at"]
            try:
                from datetime import datetime, timezone
                from zoneinfo import ZoneInfo
                tz = ZoneInfo(r["timezone"] or "UTC")
                dt = datetime.fromisoformat(r["scheduled_at"])
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                local_time = dt.astimezone(tz).strftime("%Y-%m-%d %H:%M %Z")
            except Exception:
                pass
            result.append({
                "id":         r["id"],
                "lead_name":  r["lead_name"],
                "masked_phone": r["masked_phone"] or _mask_phone(r["phone"]),
                "product":    r["product"],
                "status":     r["status"],
                "local_time": local_time,
                "timezone":   r["timezone"],
            })
    return jsonify(result)


@app.route("/api/live-runs")
def api_live_runs():
    """Returns list of run_ids currently being polled."""
    try:
        from caller import active_live_runs
        return jsonify(active_live_runs())
    except Exception:
        return jsonify([])


@app.route("/api/live/<run_id>")
def api_live_stream(run_id):
    """SSE stream for a live call run."""
    from caller import register_live_queue, unregister_live_queue
    q = register_live_queue(run_id)

    def _generate():
        try:
            while True:
                try:
                    event = q.get(timeout=20)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") == "done":
                        break
                except _queue.Empty:
                    yield ": ping\n\n"  # keep-alive
        finally:
            unregister_live_queue(run_id)

    return Response(stream_with_context(_generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/templates", methods=["GET"])
def api_templates_get():
    from models import list_templates
    return jsonify(list_templates())


@app.route("/api/templates", methods=["POST"])
def api_templates_post():
    from models import save_template, init_db
    init_db()
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    try:
        save_template(
            name=name,
            goal_script=data.get("goal_script"),
            persona_name=data.get("persona_name"),
            persona_tone=data.get("persona_tone", "professional"),
            region=data.get("region"),
            language=data.get("language"),
        )
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


_running_campaigns: set = set()
_running_campaigns_lock = __import__("threading").Lock()

def _run_pipeline_bg(campaign_id: int, language: str, region: str):
    """Background thread: call not_called leads for a campaign. Guards against duplicate threads."""
    import threading, json as _json
    with _running_campaigns_lock:
        if campaign_id in _running_campaigns:
            print(f"[Pipeline] Campaign #{campaign_id} already running — skipping duplicate start.")
            return
        _running_campaigns.add(campaign_id)
    try:
        _run_pipeline_bg_inner(campaign_id, language, region)
    finally:
        with _running_campaigns_lock:
            _running_campaigns.discard(campaign_id)


def _run_pipeline_bg_inner(campaign_id: int, language: str, region: str):
    """Inner pipeline logic."""
    import threading, json as _json
    from datetime import datetime, timezone

    try:
        from script_gen import generate_goal
        from caller import (execute_call_pipeline, classify_round1,
                            parse_transcript_to_json, infer_from_transcript)
        from scheduler import schedule_retry

        with get_conn() as conn:
            camp = conn.execute(
                "SELECT product_description, consent_approved_at FROM campaigns WHERE id=?", (campaign_id,)
            ).fetchone()
            if not camp:
                return
            if not camp["consent_approved_at"]:
                # No real call is dispatched without an explicit consent gate having
                # already been recorded (see POST /api/campaign/<id>/approve). This
                # function used to stamp consent itself here, which meant any caller
                # (including the unauthenticated /start route and Callie's tools)
                # could trigger real outbound calls with zero human approval.
                print(f"[Pipeline] Campaign #{campaign_id} has no recorded consent — refusing to call.")
                return
            product = camp["product_description"]
            leads = conn.execute(
                "SELECT * FROM leads WHERE campaign_id=? AND status='not_called' ORDER BY lead_score DESC",
                (campaign_id,)
            ).fetchall()

        r1_goal = generate_goal(product, round_num=1)

        for lead in leads:
            try:
                status_output = execute_call_pipeline(
                    lead["phone"], r1_goal,
                    region=region, language=language,
                    lat=lead["lat"], lon=lead["lon"],
                    campaign_id=campaign_id,
                )
                if status_output.get("status") == "SKIPPED":
                    with get_conn() as conn:
                        conn.execute(
                            "UPDATE leads SET status='skipped', skip_reason=? WHERE id=?",
                            (status_output.get("skip_reason"), lead["id"])
                        )
                        conn.commit()
                    continue

                call_id = status_output.get("run_id") or "unknown"
                outcome = classify_round1(status_output)

                transcript_lines = parse_transcript_to_json(status_output)
                inference = {}
                if transcript_lines:
                    try:
                        inference = infer_from_transcript(transcript_lines, product, round_num=1)
                    except Exception:
                        pass

                with get_conn() as conn:
                    conn.execute(
                        "UPDATE leads SET status=?, round1_call_id=? WHERE id=?",
                        (outcome, call_id, lead["id"])
                    )
                    conn.execute(
                        """INSERT INTO call_logs
                           (lead_id, call_id, round, raw_status_output, extracted_fields)
                           VALUES (?,?,?,?,?)""",
                        (lead["id"], call_id, 1,
                         _json.dumps(status_output),
                         _json.dumps({"transcript": transcript_lines, **inference}))
                    )
                    conn.commit()

                if outcome in ("no_answer", "unknown", "failed", "busy") and lead["osm_id"]:
                    schedule_retry(
                        lead_id=lead["id"], campaign_id=campaign_id,
                        product=product, attempt=0,
                        lat=lead["lat"], lon=lead["lon"],
                        region=region, language=language,
                    )
            except Exception as e:
                with get_conn() as conn:
                    conn.execute("UPDATE leads SET status='failed' WHERE id=?", (lead["id"],))
                    conn.commit()
    except Exception:
        pass


@app.route("/api/discover", methods=["POST"])
def api_discover():
    data = request.get_json(force=True) or {}
    product  = (data.get("product") or "").strip()
    location = (data.get("location") or "").strip()
    limit    = min(int(data.get("max_vendors", 15)), 50)
    language = data.get("language", "Hindi")
    region   = data.get("region", "IN")

    if not product or not location:
        return jsonify({"error": "product and location required"}), 400

    try:
        from discovery import discover_vendors, _looks_spam
        from scoring import score_lead
        from models import Campaign, Lead
        from datetime import datetime, timezone

        _db_fallback = False
        try:
            vendors = discover_vendors(product, location, limit)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "Too many" in err_str.lower() or "rate" in err_str.lower() or "failed" in err_str.lower() or "timed out" in err_str.lower() or "timeout" in err_str.lower():
                # Overpass unavailable — cascade DB fallback: specific → broad → any
                parts = [p.strip().lower() for p in location.split(",")]
                vendors = []
                with get_conn() as conn:
                    for part in parts:
                        if len(part) < 3:
                            continue
                        rows = conn.execute(
                            """SELECT l.name, l.phone, l.category, l.address, l.lat, l.lon, l.osm_id
                               FROM leads l JOIN campaigns c ON c.id=l.campaign_id
                               WHERE lower(c.location) LIKE ? AND l.phone IS NOT NULL
                               ORDER BY l.id DESC LIMIT ?""",
                            (f"%{part}%", limit)
                        ).fetchall()
                        if rows:
                            vendors = [dict(r) for r in rows]
                            break
                    if not vendors:
                        rows = conn.execute(
                            "SELECT name, phone, category, address, lat, lon, osm_id FROM leads WHERE phone IS NOT NULL ORDER BY id DESC LIMIT ?",
                            (limit,)
                        ).fetchall()
                        vendors = [dict(r) for r in rows]
                if not vendors:
                    return jsonify({"error": "⏳ Map server unavailable. Please wait 2 minutes and try again."}), 503
                _db_fallback = True
            else:
                raise
        if not vendors and not _db_fallback:
            # Try DB fallback before giving up
            parts = [p.strip().lower() for p in location.split(",")]
            with get_conn() as conn:
                for part in parts:
                    if len(part) < 3:
                        continue
                    rows = conn.execute(
                        """SELECT l.name, l.phone, l.category, l.address, l.lat, l.lon, l.osm_id
                           FROM leads l JOIN campaigns c ON c.id=l.campaign_id
                           WHERE lower(c.location) LIKE ? AND l.phone IS NOT NULL
                           ORDER BY l.id DESC LIMIT ?""",
                        (f"%{part}%", limit)
                    ).fetchall()
                    if rows:
                        vendors = [dict(r) for r in rows]
                        _db_fallback = True
                        break
        if not vendors:
            return jsonify({"error": "No vendors found — try a broader location like 'Delhi' or 'Mumbai'"}), 404

        # Create campaign (consent pre-approved by client clicking Start)
        with get_conn() as conn:
            campaign = Campaign(
                product_description=product,
                location=location,
                consent_basis="client-reviewed-and-approved",
                consent_approved_at=None,
            )
            campaign.save(conn)
            campaign_id = campaign.id
            conn.commit()

        result_vendors = []
        if _db_fallback:
            # Vendors are already in DB — just score and return as preview (no re-insert)
            for v in vendors:
                try:
                    score, _ = score_lead(v)
                except Exception:
                    score = 5
                result_vendors.append({
                    "id":           None,
                    "name":         v.get("name") or "Unknown",
                    "category":     v.get("category") or "",
                    "address":      v.get("address") or "",
                    "masked_phone": _mask_phone(v["phone"]),
                    "score":        score,
                })
        else:
            with get_conn() as conn:
                for v in vendors:
                    if _looks_spam(v["phone"]):
                        continue
                    dup = conn.execute("SELECT id FROM leads WHERE phone=?", (v["phone"],)).fetchone()
                    if dup:
                        continue
                    try:
                        score, reasons = score_lead(v)
                    except Exception:
                        score, reasons = 5, []

                    lead = Lead(
                        phone=v["phone"],
                        campaign_id=campaign_id,
                        name=v.get("name"),
                        category=v.get("category"),
                        lat=v.get("lat"),
                        lon=v.get("lon"),
                        osm_id=v.get("osm_id"),
                        candidate_id=f"osm:{v['osm_id']}" if v.get("osm_id") else None,
                        address=v.get("address"),
                    )
                    lead.save(conn)
                    conn.execute(
                        "UPDATE leads SET lead_score=?, score_reasons=? WHERE id=?",
                        (score, json.dumps(reasons), lead.id)
                    )
                    conn.commit()

                    result_vendors.append({
                        "id":           lead.id,
                        "name":         v.get("name") or "Unknown",
                        "category":     v.get("category") or "",
                        "address":      v.get("address") or "",
                        "masked_phone": _mask_phone(v["phone"]),
                        "score":        score,
                    })

        result_vendors.sort(key=lambda x: x["score"], reverse=True)
        return jsonify({
            "campaign_id": campaign_id,
            "vendors":     result_vendors,
            "count":       len(result_vendors),
            "product":     product,
            "location":    location,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/campaigns/<int:campaign_id>/start", methods=["POST"])
def api_campaign_start(campaign_id):
    data     = request.get_json(force=True) or {}
    language = data.get("language", "Hindi")
    region   = data.get("region", "IN")

    init_db()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT consent_approved_at FROM campaigns WHERE id=?", (campaign_id,)
        ).fetchone()
    if not row:
        return jsonify({"started": False, "message": f"Campaign #{campaign_id} not found."}), 404
    if not row["consent_approved_at"]:
        return jsonify({
            "started": False,
            "message": f"Campaign #{campaign_id} has not been approved yet. "
                       f"Call POST /api/campaign/{campaign_id}/approve first."
        }), 400

    import threading
    t = threading.Thread(
        target=_run_pipeline_bg,
        args=(campaign_id, language, region),
        daemon=True,
    )
    t.start()
    return jsonify({"started": True, "campaign_id": campaign_id})


@app.route("/api/campaign/<int:camp_id>/approve", methods=["POST"])
def api_approve_campaign(camp_id):
    """Give consent for a campaign that was created without a consent gate,
    then kick off the calling pipeline in a background thread."""
    from datetime import datetime, timezone
    data     = request.get_json(silent=True) or {}
    language = data.get("language", "Hindi")
    region   = data.get("region", "IN")

    init_db()
    with get_conn() as conn:
        row = conn.execute("SELECT id, consent_approved_at FROM campaigns WHERE id=?", (camp_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "message": f"Campaign #{camp_id} not found."}), 404
        # Guard: don't re-approve an already-approved campaign that may already be running
        if row["consent_approved_at"]:
            not_called = conn.execute(
                "SELECT COUNT(*) FROM leads WHERE campaign_id=? AND status='not_called'", (camp_id,)
            ).fetchone()[0]
            if not_called == 0:
                return jsonify({"ok": False, "message": f"Campaign #{camp_id} already approved and has no uncalled leads."}), 400
        conn.execute(
            "UPDATE campaigns SET consent_approved_at=? WHERE id=? AND consent_approved_at IS NULL",
            (datetime.now(timezone.utc).isoformat(), camp_id)
        )
        conn.commit()

    import threading
    t = threading.Thread(
        target=_run_pipeline_bg,
        args=(camp_id, language, region),
        daemon=True,
    )
    t.start()
    return jsonify({"ok": True, "campaign_id": camp_id,
                    "message": f"Consent recorded — calling pipeline started for campaign #{camp_id}."})


def _callie_build_context():
    """Compact live-state snapshot injected into Callie's system prompt."""
    try:
        init_db()
        with get_conn() as conn:
            s = conn.execute(
                """SELECT COUNT(*) total,
                   SUM(CASE WHEN status='positive' THEN 1 ELSE 0 END) pos,
                   SUM(CASE WHEN status='negative' THEN 1 ELSE 0 END) neg,
                   SUM(CASE WHEN status='no_answer' THEN 1 ELSE 0 END) noanswer,
                   SUM(CASE WHEN status='not_called' THEN 1 ELSE 0 END) pending
                   FROM leads"""
            ).fetchone()
            camps = conn.execute(
                "SELECT id, product_description, location FROM campaigns ORDER BY id DESC LIMIT 5"
            ).fetchall()
            recent = conn.execute(
                """SELECT l.name, l.status, c.product_description FROM leads l
                   JOIN campaigns c ON c.id=l.campaign_id
                   WHERE l.status NOT IN ('not_called','skipped')
                   ORDER BY l.id DESC LIMIT 6"""
            ).fetchall()
            try:
                sched = conn.execute(
                    "SELECT COUNT(*) FROM scheduled_calls WHERE status='pending'"
                ).fetchone()[0]
            except Exception:
                sched = 0
            camp_count = conn.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0]
        camp_list = ", ".join(
            [f"#{c['id']} ({c['product_description'][:22]} in {c['location']})" for c in camps]
        ) or "none yet"
        recent_str = "\n".join(
            [f"  - {r['name']}: {r['status']} ({r['product_description'][:22]})" for r in recent]
        ) or "  none yet"
        return (
            f"Campaigns ({camp_count} total, showing latest 5): {camp_list}\n"
            f"Lead totals: {s['total'] or 0} total | {s['pos'] or 0} positive | "
            f"{s['neg'] or 0} negative | {s['noanswer'] or 0} no-answer | {s['pending'] or 0} not-called\n"
            f"Scheduled (pending) calls: {sched}\n"
            f"Recent outcomes:\n{recent_str}"
        )
    except Exception as e:
        return f"(context unavailable: {e})"


def _callie_tools():
    return [
        {"type": "function", "function": {
            "name": "discover_vendors",
            "description": "Find vendors via OpenStreetMap, create campaign, return scored list.",
            "parameters": {"type": "object", "properties": {
                "product":     {"type": "string"},
                "location":    {"type": "string"},
                "max_vendors": {"type": "integer"},
            }, "required": ["product", "location"]}
        }},
        {"type": "function", "function": {
            "name": "start_campaign",
            "description": "Start AI voice calling pipeline for a campaign.",
            "parameters": {"type": "object", "properties": {
                "campaign_id": {"type": "integer"},
                "language":    {"type": "string", "description": "Hindi / English / Hindi and English"},
            }, "required": ["campaign_id"]}
        }},
        {"type": "function", "function": {
            "name": "get_campaigns",
            "description": "List all campaigns with lead counts and status breakdown.",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "get_leads",
            "description": "Get leads filtered by campaign or status.",
            "parameters": {"type": "object", "properties": {
                "campaign_id": {"type": "integer"},
                "status":      {"type": "string", "enum": ["positive","negative","no_answer","not_called","failed","skipped","unknown","completed"]},
                "limit":       {"type": "integer"},
            }}
        }},
        {"type": "function", "function": {
            "name": "send_whatsapp",
            "description": "Send WhatsApp text message.",
            "parameters": {"type": "object", "properties": {
                "phone":   {"type": "string"},
                "message": {"type": "string"},
            }, "required": ["phone", "message"]}
        }},
        {"type": "function", "function": {
            "name": "check_whatsapp",
            "description": "Check WhatsApp status and inbox.",
            "parameters": {"type": "object", "properties": {
                "from_number": {"type": "string"},
            }}
        }},
        {"type": "function", "function": {
            "name": "navigate_dashboard",
            "description": "Switch dashboard tab or open wizard.",
            "parameters": {"type": "object", "properties": {
                "destination": {"type": "string", "enum": ["leads","analytics","map","live","wizard"]},
            }, "required": ["destination"]}
        }},
        {"type": "function", "function": {
            "name": "get_call_stats",
            "description": "Get overall pipeline stats: totals, positive rate.",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "run_discovery_and_call",
            "description": "Discover vendors for a product+location and stage them as a new campaign. "
                           "Does NOT call anyone — the user must still confirm (say yes/confirm/proceed) "
                           "and you must then call start_campaign, or they click Give Consent & Call.",
            "parameters": {"type": "object", "properties": {
                "product":     {"type": "string"},
                "location":    {"type": "string"},
                "max_vendors": {"type": "integer"},
                "language":    {"type": "string", "description": "Hindi / English / Hindi and English"},
            }, "required": ["product", "location"]}
        }},
        {"type": "function", "function": {
            "name": "get_positive_leads",
            "description": "Get positive (interested) leads with call summaries, ready for WhatsApp follow-up.",
            "parameters": {"type": "object", "properties": {
                "campaign_id": {"type": "integer"},
                "limit":       {"type": "integer"},
            }}
        }},
        {"type": "function", "function": {
            "name": "bulk_whatsapp",
            "description": "Send a WhatsApp message to ALL positive leads in a campaign.",
            "parameters": {"type": "object", "properties": {
                "campaign_id": {"type": "integer"},
                "message":     {"type": "string"},
            }, "required": ["campaign_id", "message"]}
        }},
        {"type": "function", "function": {
            "name": "get_campaign_analytics",
            "description": "Detailed analytics for a campaign: success rate, avg score, timeline.",
            "parameters": {"type": "object", "properties": {
                "campaign_id": {"type": "integer"},
            }, "required": ["campaign_id"]}
        }},
        {"type": "function", "function": {
            "name": "skip_lead",
            "description": "Mark a lead as skipped so it won't be called.",
            "parameters": {"type": "object", "properties": {
                "lead_id":    {"type": "integer"},
                "phone":      {"type": "string", "description": "Use phone if lead_id unknown"},
            }}
        }},
        {"type": "function", "function": {
            "name": "reschedule_pending",
            "description": "Force-reschedule all no_answer leads in a campaign so they get called again soon.",
            "parameters": {"type": "object", "properties": {
                "campaign_id": {"type": "integer"},
            }, "required": ["campaign_id"]}
        }},
        {"type": "function", "function": {
            "name": "change_theme",
            "description": "Change the dashboard's visual theme/color scheme.",
            "parameters": {"type": "object", "properties": {
                "theme": {"type": "string", "enum": ["midnight", "purple_haze", "emerald", "ocean"]},
            }, "required": ["theme"]}
        }},
        {"type": "function", "function": {
            "name": "start_tour",
            "description": "Start an interactive guided tour of a dashboard feature.",
            "parameters": {"type": "object", "properties": {
                "tour_name": {"type": "string", "enum": ["onboarding", "campaign_flow", "whatsapp_flow"]},
            }, "required": ["tour_name"]}
        }},
        {"type": "function", "function": {
            "name": "web_search",
            "description": "Search the web for current information, prices, news, company info, or anything the user asks about that isn't in the dashboard data. Use for questions like 'what is the price of X', 'who is Y company', 'latest news on Z'.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string", "description": "The search query"},
                "max_results": {"type": "integer", "description": "Number of results (default 4, max 6)"},
            }, "required": ["query"]}
        }},
    ]


_CONFIRM_WORDS = ("yes", "yeah", "yep", "yup", "sure", "confirm", "confirmed",
                  "proceed", "go ahead", "do it", "approve", "approved", "affirmative")

def _has_human_confirmation(user_msg: str) -> bool:
    """True if the human's own typed message (not the LLM's tool-call args) this
    turn reads as an explicit go-ahead. This is what actually gates start_campaign —
    trusting the model's own judgment on when it was "confirmed" is what let it
    place real calls unattended."""
    text = (user_msg or "").strip().lower()
    if not text:
        return False
    return any(w in text for w in _CONFIRM_WORDS)


def _callie_exec_tool(fn_name, fn_args, user_msg=""):
    """Execute a Callie tool. Returns (result_dict, optional_ui_action_dict)."""
    try:
        if fn_name == "discover_vendors":
            from discovery import discover_vendors as _dv, _looks_spam
            from scoring import score_lead
            from models import Campaign, Lead
            product  = fn_args.get("product", "")
            location = fn_args.get("location", "")
            limit    = min(int(fn_args.get("max_vendors", 15)), 30)
            try:
                vendors = _dv(product, location, limit)
            except Exception:
                vendors = []
            if not vendors:
                return {"error": "No vendors found — try a broader location like 'Delhi'."}, None
            with get_conn() as conn:
                campaign = Campaign(product_description=product, location=location,
                                    consent_basis="client-reviewed-and-approved", consent_approved_at=None)
                campaign.save(conn)
                camp_id = campaign.id
                scored = []
                for v in vendors:
                    if not v.get("phone") or _looks_spam(v["phone"]):
                        continue
                    if conn.execute("SELECT id FROM leads WHERE phone=?", (v["phone"],)).fetchone():
                        continue
                    try:
                        score, _ = score_lead(v)
                    except Exception:
                        score = 5
                    lead = Lead(phone=v["phone"], campaign_id=camp_id, name=v.get("name"),
                                category=v.get("category"), lat=v.get("lat"), lon=v.get("lon"),
                                osm_id=v.get("osm_id"), address=v.get("address"))
                    lead.save(conn)
                    conn.execute("UPDATE leads SET lead_score=? WHERE id=?", (score, lead.id))
                    scored.append({"name": v.get("name") or "Unknown", "category": v.get("category") or "",
                                   "score": score, "address": (v.get("address") or "")[:50]})
                conn.commit()
            return {
                "campaign_id": camp_id, "vendor_count": len(scored),
                "vendors": scored[:12],
                "message": f"Created campaign #{camp_id} with {len(scored)} vendors ready to call."
            }, {"type": "navigate_to", "tab": "leads"}

        elif fn_name == "start_campaign":
            import threading
            camp_id  = int(fn_args.get("campaign_id"))
            language = fn_args.get("language", "Hindi")
            with get_conn() as conn:
                if not conn.execute("SELECT id FROM campaigns WHERE id=?", (camp_id,)).fetchone():
                    return {"error": f"Campaign #{camp_id} not found."}, None
            if not _has_human_confirmation(user_msg):
                # The model deciding on its own that "the user seems fine with it" is
                # exactly how this tool used to place real calls with zero human
                # confirmation. Require the human's own message this turn to actually
                # contain a yes/confirm/proceed — not just infer it from context.
                return {"error": "Not started — I need you to explicitly say yes/confirm/proceed "
                                  "before I dial real numbers for this campaign."}, None
            from datetime import datetime as _dt, timezone as _tz
            with get_conn() as conn:
                conn.execute(
                    "UPDATE campaigns SET consent_approved_at=? WHERE id=? AND consent_approved_at IS NULL",
                    (_dt.now(_tz.utc).isoformat(), camp_id)
                )
                conn.commit()
            t = threading.Thread(target=_run_pipeline_bg, args=(camp_id, language, "IN"), daemon=True)
            t.start()
            return {"started": True, "campaign_id": camp_id,
                    "message": f"Calling pipeline started for campaign #{camp_id} in {language}."}, \
                   {"type": "navigate_to", "tab": "live"}

        elif fn_name == "get_campaigns":
            with get_conn() as conn:
                camps = conn.execute(
                    "SELECT id, product_description, location, created_at FROM campaigns ORDER BY id DESC LIMIT 10"
                ).fetchall()
                result = []
                for c in camps:
                    st = conn.execute(
                        """SELECT COUNT(*) total,
                           SUM(CASE WHEN status='positive' THEN 1 ELSE 0 END) pos,
                           SUM(CASE WHEN status='negative' THEN 1 ELSE 0 END) neg,
                           SUM(CASE WHEN status='no_answer' THEN 1 ELSE 0 END) noanswer,
                           SUM(CASE WHEN status='not_called' THEN 1 ELSE 0 END) pending
                           FROM leads WHERE campaign_id=?""", (c["id"],)
                    ).fetchone()
                    result.append({"id": c["id"], "product": c["product_description"],
                                   "location": c["location"], "created": (c["created_at"] or "")[:10],
                                   "total": st["total"] or 0, "positive": st["pos"] or 0,
                                   "negative": st["neg"] or 0, "no_answer": st["noanswer"] or 0,
                                   "pending": st["pending"] or 0})
            return {"campaigns": result, "count": len(result)}, None

        elif fn_name == "get_leads":
            with get_conn() as conn:
                camp_id = fn_args.get("campaign_id")
                status  = fn_args.get("status")
                limit   = min(int(fn_args.get("limit", 20)), 50)
                where, params = [], []
                if camp_id:
                    where.append("l.campaign_id=?"); params.append(int(camp_id))
                if status:
                    where.append("l.status=?"); params.append(status)
                params.append(limit)
                q = ("""SELECT l.name, l.masked_phone, l.phone, l.category, l.status, l.address,
                               c.product_description AS product, c.location
                        FROM leads l JOIN campaigns c ON c.id=l.campaign_id"""
                     + (f" WHERE {' AND '.join(where)}" if where else "")
                     + " ORDER BY l.id DESC LIMIT ?")
                rows = conn.execute(q, params).fetchall()
                leads = [{"name": r["name"], "masked_phone": r["masked_phone"] or _mask_phone(r["phone"]),
                          "category": r["category"], "status": r["status"],
                          "address": (r["address"] or "")[:50],
                          "product": r["product"], "location": r["location"]} for r in rows]
            return {"leads": leads, "count": len(leads)}, None

        elif fn_name == "send_whatsapp":
            import urllib.request as _ur
            phone   = fn_args.get("phone", "")
            message = fn_args.get("message", "")
            payload = json.dumps({"phone": phone, "message": message}).encode()
            req = _ur.Request("http://localhost:3001/send", data=payload,
                              headers={"Content-Type": "application/json"}, method="POST")
            try:
                with _ur.urlopen(req, timeout=8) as r:
                    resp = json.loads(r.read())
                return {"sent": resp.get("ok"), "jid": resp.get("jid"),
                        "message": f"Sent to {phone}" if resp.get("ok") else resp.get("error")}, None
            except Exception as e:
                return {"error": str(e)}, None

        elif fn_name == "check_whatsapp":
            import urllib.request as _ur
            try:
                with _ur.urlopen("http://localhost:3001/status", timeout=4) as r:
                    status = json.loads(r.read())
            except Exception:
                status = {"ready": False, "status": "server_offline"}
            inbox = []
            try:
                from_num = fn_args.get("from_number", "")
                url = f"http://localhost:3001/inbox?from={from_num}" if from_num else "http://localhost:3001/inbox"
                with _ur.urlopen(url, timeout=4) as r:
                    inbox = json.loads(r.read())[:10]
            except Exception:
                pass
            return {"whatsapp": status, "inbox": inbox, "inbox_count": len(inbox)}, None

        elif fn_name == "navigate_dashboard":
            dest = fn_args.get("destination", "leads")
            if dest == "wizard":
                return {"navigated": "wizard"}, {"type": "open_wizard"}
            return {"navigated": dest}, {"type": "navigate_to", "tab": dest}

        elif fn_name == "get_call_stats":
            with get_conn() as conn:
                s = conn.execute(
                    """SELECT COUNT(*) total,
                       SUM(CASE WHEN status='positive' THEN 1 ELSE 0 END) pos,
                       SUM(CASE WHEN status='negative' THEN 1 ELSE 0 END) neg,
                       SUM(CASE WHEN status='no_answer' THEN 1 ELSE 0 END) noanswer,
                       SUM(CASE WHEN status='not_called' THEN 1 ELSE 0 END) pending,
                       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
                       FROM leads"""
                ).fetchone()
                camps = conn.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0]
            total = s["total"] or 1
            return {"campaigns": camps, "total_leads": s["total"] or 0,
                    "positive": s["pos"] or 0, "negative": s["neg"] or 0,
                    "no_answer": s["noanswer"] or 0, "pending": s["pending"] or 0,
                    "failed": s["failed"] or 0,
                    "positive_rate": f"{int((s['pos'] or 0) * 100 / total)}%"}, None

        elif fn_name == "run_discovery_and_call":
            import threading
            from datetime import datetime
            from discovery import discover_vendors as _dv, _looks_spam
            from scoring import score_lead
            from models import Campaign, Lead
            product  = fn_args.get("product", "")
            location = fn_args.get("location", "")
            language = fn_args.get("language", "Hindi")
            limit    = min(int(fn_args.get("max_vendors", 15)), 30)
            try:
                vendors = _dv(product, location, limit)
            except Exception:
                vendors = []
            if not vendors:
                return {"error": "No vendors found — try a broader location."}, None
            with get_conn() as conn:
                # consent_approved_at stays unset here on purpose: discovering vendors
                # and dialing them are two different levels of consequence, and no
                # call should go out until a human has actually seen this vendor list
                # and clicked "Give Consent & Call". That click is what calls
                # POST /api/campaign/<id>/approve and starts the pipeline — this tool
                # only gets the campaign to the point where that button appears.
                campaign = Campaign(product_description=product, location=location,
                                    consent_basis="client-reviewed-and-approved",
                                    consent_approved_at=None)
                campaign.save(conn)
                camp_id = campaign.id
                count = 0
                for v in vendors:
                    if not v.get("phone") or _looks_spam(v["phone"]):
                        continue
                    if conn.execute("SELECT id FROM leads WHERE phone=?", (v["phone"],)).fetchone():
                        continue
                    try:
                        score, _ = score_lead(v)
                    except Exception:
                        score = 5
                    lead = Lead(phone=v["phone"], campaign_id=camp_id, name=v.get("name"),
                                category=v.get("category"), lat=v.get("lat"), lon=v.get("lon"),
                                osm_id=v.get("osm_id"), address=v.get("address"))
                    lead.save(conn)
                    conn.execute("UPDATE leads SET lead_score=? WHERE id=?", (score, lead.id))
                    count += 1
                conn.commit()
            return {
                "campaign_id": camp_id, "vendor_count": count,
                "message": f"Found {count} vendors and created campaign #{camp_id} — nothing has been "
                           f"called yet. Show the user this list and have them click 'Give Consent & Call' "
                           f"on the campaign card to actually start dialing."
            }, [{"type": "navigate_to", "tab": "leads"}]

        elif fn_name == "get_positive_leads":
            with get_conn() as conn:
                camp_id = fn_args.get("campaign_id")
                limit   = min(int(fn_args.get("limit", 20)), 50)
                where, params = ["l.status='positive'"], []
                if camp_id:
                    where.append("l.campaign_id=?"); params.append(int(camp_id))
                params.append(limit)
                q = ("""SELECT l.id, l.name, l.phone, l.masked_phone, l.category, l.address,
                               l.lead_score, c.product_description AS product, c.location
                        FROM leads l JOIN campaigns c ON c.id=l.campaign_id
                        WHERE """ + " AND ".join(where) + " ORDER BY l.lead_score DESC LIMIT ?")
                rows = conn.execute(q, params).fetchall()
                # Try to pull a call outcome summary for each
                leads = []
                for r in rows:
                    fields_row = conn.execute(
                        "SELECT extracted_fields FROM call_logs WHERE lead_id=? ORDER BY id DESC LIMIT 1",
                        (r["id"],)
                    ).fetchone()
                    summary = None
                    if fields_row and fields_row["extracted_fields"]:
                        try:
                            summary = json.loads(fields_row["extracted_fields"]).get("summary")
                        except Exception:
                            pass
                    leads.append({
                        "id": r["id"],
                        "name": r["name"] or "Unknown",
                        "masked_phone": r["masked_phone"] or _mask_phone(r["phone"]),
                        "phone": r["phone"],
                        "category": r["category"],
                        "score": r["lead_score"],
                        "address": (r["address"] or "")[:50],
                        "product": r["product"],
                        "summary": summary
                    })
            return {"positive_leads": leads, "count": len(leads)}, \
                   {"type": "filter_leads", "status": "positive"}

        elif fn_name == "bulk_whatsapp":
            import urllib.request as _ur
            camp_id = int(fn_args.get("campaign_id"))
            message = fn_args.get("message", "")
            with get_conn() as conn:
                rows = conn.execute(
                    "SELECT phone FROM leads WHERE campaign_id=? AND status='positive'", (camp_id,)
                ).fetchall()
            sent, failed = 0, 0
            for row in rows:
                phone = row["phone"]
                payload = json.dumps({"phone": phone, "message": message}).encode()
                req = _ur.Request("http://localhost:3001/send", data=payload,
                                  headers={"Content-Type": "application/json"}, method="POST")
                try:
                    with _ur.urlopen(req, timeout=8) as r:
                        resp = json.loads(r.read())
                    if resp.get("ok"):
                        sent += 1
                    else:
                        failed += 1
                except Exception:
                    failed += 1
            return {
                "campaign_id": camp_id, "sent": sent, "failed": failed,
                "message": f"Blasted WhatsApp to {sent} positive leads from campaign #{camp_id}. {failed} failed."
            }, None

        elif fn_name == "get_campaign_analytics":
            camp_id = int(fn_args.get("campaign_id"))
            with get_conn() as conn:
                camp = conn.execute(
                    "SELECT product_description, location, created_at FROM campaigns WHERE id=?", (camp_id,)
                ).fetchone()
                if not camp:
                    return {"error": f"Campaign #{camp_id} not found."}, None
                s = conn.execute(
                    """SELECT COUNT(*) total,
                       SUM(CASE WHEN status='positive' THEN 1 ELSE 0 END) pos,
                       SUM(CASE WHEN status='negative' THEN 1 ELSE 0 END) neg,
                       SUM(CASE WHEN status='no_answer' THEN 1 ELSE 0 END) noanswer,
                       SUM(CASE WHEN status='not_called' THEN 1 ELSE 0 END) pending,
                       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
                       AVG(lead_score) avg_score
                       FROM leads WHERE campaign_id=?""", (camp_id,)
                ).fetchone()
                call_count = conn.execute(
                    """SELECT COUNT(*) FROM call_logs cl
                       JOIN leads l ON l.id = cl.lead_id
                       WHERE l.campaign_id=?""", (camp_id,)
                ).fetchone()[0]
            total = s["total"] or 1
            return {
                "campaign_id": camp_id,
                "product": camp["product_description"], "location": camp["location"],
                "created": (camp["created_at"] or "")[:10],
                "total_leads": s["total"] or 0, "positive": s["pos"] or 0,
                "negative": s["neg"] or 0, "no_answer": s["noanswer"] or 0,
                "pending": s["pending"] or 0, "failed": s["failed"] or 0,
                "success_rate": f"{int((s['pos'] or 0) * 100 / total)}%",
                "avg_lead_score": round(s["avg_score"] or 0, 1),
                "total_calls_made": call_count
            }, {"type": "navigate_to", "tab": "analytics"}

        elif fn_name == "skip_lead":
            lead_id = fn_args.get("lead_id")
            phone   = fn_args.get("phone", "")
            with get_conn() as conn:
                if lead_id:
                    conn.execute("UPDATE leads SET status='skipped' WHERE id=?", (int(lead_id),))
                elif phone:
                    conn.execute("UPDATE leads SET status='skipped' WHERE phone=?", (phone,))
                else:
                    return {"error": "Provide lead_id or phone."}, None
                conn.commit()
            return {"skipped": True, "lead_id": lead_id, "phone": phone}, None

        elif fn_name == "reschedule_pending":
            camp_id = int(fn_args.get("campaign_id"))
            with get_conn() as conn:
                if not conn.execute("SELECT id FROM campaigns WHERE id=?", (camp_id,)).fetchone():
                    return {"error": f"Campaign #{camp_id} not found."}, None
                result = conn.execute(
                    """UPDATE scheduled_calls SET scheduled_at=datetime('now', '+2 minutes'),
                       status='pending'
                       WHERE lead_id IN (SELECT id FROM leads WHERE campaign_id=? AND status='no_answer')""",
                    (camp_id,)
                )
                # Also insert new schedule rows for no_answer leads without an existing schedule
                no_ans = conn.execute(
                    """SELECT id FROM leads WHERE campaign_id=? AND status='no_answer'
                       AND id NOT IN (SELECT lead_id FROM scheduled_calls WHERE lead_id IS NOT NULL)""",
                    (camp_id,)
                ).fetchall()
                for row in no_ans:
                    conn.execute(
                        """INSERT INTO scheduled_calls (lead_id, campaign_id, scheduled_at, status)
                           VALUES (?, ?, datetime('now', '+2 minutes'), 'pending')""",
                        (row["id"], camp_id)
                    )
                conn.commit()
                rescheduled = conn.execute(
                    "SELECT COUNT(*) FROM leads WHERE campaign_id=? AND status='no_answer'", (camp_id,)
                ).fetchone()[0]
            return {
                "campaign_id": camp_id, "rescheduled": rescheduled,
                "message": f"Rescheduled {rescheduled} no-answer leads in campaign #{camp_id} — they'll get called again in ~2 min."
            }, None

        elif fn_name == "change_theme":
            theme = fn_args.get("theme", "midnight")
            return {"changed": True, "theme": theme}, {"type": "change_theme", "theme": theme}

        elif fn_name == "start_tour":
            tour_name = fn_args.get("tour_name", "onboarding")
            return {"tour_started": True, "tour_name": tour_name}, {"type": "start_tour", "tour_name": tour_name}

        elif fn_name == "web_search":
            query = fn_args.get("query", "")
            max_r = min(int(fn_args.get("max_results", 4)), 6)
            if not query:
                return {"error": "No query provided."}, None
            try:
                from ddgs import DDGS
                raw = list(DDGS().text(query, max_results=max_r))
                results = [{"title": r.get("title",""), "url": r.get("href",""), "snippet": r.get("body","")} for r in raw]
                return {"query": query, "results": results, "count": len(results)}, None
            except Exception as e:
                return {"error": f"Search failed: {str(e)}"}, None

        else:
            return {"error": f"Unknown tool: {fn_name}"}, None

    except Exception as e:
        return {"error": str(e)}, None


@app.route("/api/chat", methods=["POST"])
def api_chat():
    import os
    import urllib.request as _ur
    import urllib.error as _ue

    data         = request.get_json(force=True) or {}
    user_msg     = (data.get("message") or "").strip()
    history      = data.get("history", [])[-6:]
    biz_name     = (data.get("business_name") or data.get("biz_name") or "the client").strip()

    if not user_msg:
        return jsonify({"reply": "How can I help you?"}), 200

    # Collect all available keys: GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3, ...
    _all_keys = [k for k in [
        os.environ.get("GROQ_API_KEY", ""),
        os.environ.get("GROQ_API_KEY_2", ""),
        os.environ.get("GROQ_API_KEY_3", ""),
        os.environ.get("GROQ_API_KEY_4", ""),
        os.environ.get("GROQ_API_KEY_5", ""),
    ] if k]
    if not _all_keys:
        return jsonify({"reply": "⚠️ No GROQ_API_KEY set. Restart the dashboard after setting it."}), 200
    api_key = _all_keys[0]  # start with first; rotated on 429 below

    ctx = _callie_build_context()

    system = f"""You are Callie, the AI copilot inside {biz_name}'s lead-gen dashboard 👋 Talk like a smart, energetic friend — warm, concise, zero corporate fluff. Use {biz_name} naturally. Keep replies short and punchy.

WHAT CALL-E DOES:
- Discovery: find vendors/suppliers by product + city using OpenStreetMap, auto-score them 1-10.
- Campaigns: launch AI voice-calling campaigns, track status, view per-campaign analytics.
- Leads: browse, filter (positive/negative/no_answer/pending), skip, bulk-WhatsApp, reschedule.
- Calls: AI voice agent runs R1 (intro call) and R2 (follow-up for no-answers, auto-scheduled).
- WhatsApp: send single or bulk messages to warm leads, check delivery status.
- Tabs: Leads (all vendors), Analytics (charts), Map (geo view), Live (watch calls happen), Wizard (step-by-step campaign builder).
- Themes: change the dashboard's look (midnight/purple_haze/emerald/ocean).
- Tours: start a guided walkthrough (onboarding/campaign_flow/whatsapp_flow).
- Web Search: I can search the internet for current prices, news, company info, or any general question.

LIVE DATA for {biz_name}:
{ctx}

GUIDE based on data: no campaigns yet → nudge "Find vendors". Campaigns with nobody called → suggest starting. Low positives → suggest different location/product. Lots of no-answers → reassure retry is automatic.

GENERAL QUESTIONS: You can answer anything — coding, advice, definitions. Be brief and helpful, then offer to get back to outreach.

PLATFORM GUIDE (common questions):
- "How do I find vendors?" → Use Discovery: tell me the product + city. Offer the campaign_flow tour.
- "Why no positive leads?" → Try a different location or product; low scores = weak matches.
- "What happens after a call?" → Outcome logged, R2 auto-scheduled if no answer, WhatsApp for positives.

CAMPAIGN FLOW: When user asks to find vendors/start a campaign:
1. Call discover_vendors → show the vendor list to user
2. ALWAYS ask: "Found X vendors for [product] in [location]. Confirm you have a legitimate business reason to contact them? Type YES to start calling."
3. Only call start_campaign after user explicitly says yes/confirm/proceed.
4. Never call run_discovery_and_call directly — always use the 2-step flow.

WEB SEARCH: Use web_search for any question about current events, prices, companies, or general knowledge not found in the dashboard. Keep search queries concise and specific.

RULES: Before a tool runs, say what you're doing. After, react to data — don't just dump it. Use tools for real numbers, never make them up. Confirm every action. Never say "I can't" — always offer a workaround."""

    messages = [{"role": "system", "content": system}]
    for h in history:
        txt = (h.get("text") or "").strip()
        if not txt:
            continue  # skip empty entries — Groq rejects empty content strings
        if h.get("role") == "user":
            messages.append({"role": "user", "content": txt})
        elif h.get("role") == "callie":
            messages.append({"role": "assistant", "content": txt})

    messages.append({"role": "user", "content": user_msg})

    # Intent classification — skip tools on turn 0 for simple/general chat (saves ~900 tokens)
    _TOOL_KEYWORDS = {
        "campaign","lead","vendor","discover","call","whatsapp","analytics","stats",
        "positive","negative","score","wizard","find","start","send","show","get",
        "list","filter","skip","bulk","reschedule","tour","theme","color","template",
        "schedule","scheduled","navigate","switch","open","overview","results","result",
        "retry","message","map","status","pending","no answer","no-answer","launch",
        "supplier","numbers","rate","success","dashboard","tab","walkthrough","guide me",
        "search","google","look up","news","price","current","latest","who is",
        "what is the price","internet","web",
        "yes","confirm","proceed",
    }
    _SIMPLE_PATTERNS = (
        "hi","hello","hey","thanks","thank you","ok","okay","cool","nice","what","who",
        "how are","what is","whats","what's","explain","help me understand","tell me about",
        "what can you","how do","why","good morning","good evening","yo","sup",
    )
    _msg_lc = user_msg.lower().strip()
    _has_tool_kw = any(kw in _msg_lc for kw in _TOOL_KEYWORDS)
    _matches_simple = any(
        _msg_lc == p or _msg_lc.startswith(p + " ") or _msg_lc.startswith(p + "?")
        for p in _SIMPLE_PATTERNS
    )
    _skip_tools_first_turn = (len(_msg_lc) < 35 and not _has_tool_kw and _matches_simple)

    tools    = _callie_tools()
    actions  = []
    key_idx  = 0

    # Model selection: groq/compound does NOT support tool calling (returns 400).
    # Use a tool-capable model when tools are needed, and the faster compound model
    # for pure chat turns. gpt-oss-20b is the non-429 fallback for the tools model.
    _TOOLS_MODEL      = "openai/gpt-oss-120b"   # tool calling ✓ (best quality)
    _TOOLS_MODEL_FB   = "openai/gpt-oss-20b"    # tool calling ✓ (fallback, faster)
    _CHAT_MODEL       = "groq/compound"         # chat only, NO tools (fast/free)
    _API_URL          = "https://api.groq.com/openai/v1/chat/completions"

    def _post_groq(model, msgs, use_tools, api_key, max_tokens):
        """Single HTTP call. Returns (json|None, http_code|None, body_str)."""
        payload_dict = {
            "model": model,
            "messages": msgs,
            "max_tokens": max_tokens,
            "temperature": 0.65,
        }
        if use_tools:
            payload_dict["tools"] = tools
            payload_dict["tool_choice"] = "auto"
        req = _ur.Request(
            _API_URL,
            data=json.dumps(payload_dict).encode(),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "CALLE-Dashboard/1.0",
                "Accept": "application/json",
            },
            method="POST"
        )
        try:
            with _ur.urlopen(req, timeout=25) as r:
                return json.loads(r.read()), None, ""
        except _ue.HTTPError as e:
            return None, e.code, e.read().decode("utf-8", errors="replace")
        except Exception as e:
            return None, -1, str(e)

    def _groq_call(msgs, use_tools):
        """Two-model call with key rotation on 429 and model fallback on other errors."""
        nonlocal key_idx
        model      = _TOOLS_MODEL if use_tools else _CHAT_MODEL
        max_tokens = 1200 if use_tools else 800
        fell_back  = False
        # Try every key at least once (rotating on 429).
        for _attempt in range(len(_all_keys) + 1):
            api_key = _all_keys[key_idx % len(_all_keys)]
            resp, code, body = _post_groq(model, msgs, use_tools, api_key, max_tokens)
            if resp is not None:
                return resp, None

            if code == 429:
                key_idx += 1
                if key_idx >= len(_all_keys):
                    return None, f"All {len(_all_keys)} Groq keys are rate-limited. Try again in a moment!"
                print(f"[Callie] 429 on key {key_idx-1} ({model}), rotating to key {key_idx}")
                continue

            # 400 malformed tool call → retry same model once WITHOUT tools.
            if code == 400 and use_tools and "tool_use_failed" in body:
                resp2, code2, body2 = _post_groq(model, msgs, False, api_key, max_tokens)
                if resp2 is not None:
                    return resp2, None
                body, code = body2, code2  # fall through to model fallback / error

            # Any other non-429 failure on the tools model → fall back to smaller
            # tool-capable model once, on the SAME key, then keep the rotation loop.
            if use_tools and not fell_back and model != _TOOLS_MODEL_FB:
                print(f"[Callie] {model} failed (code {code}), falling back to {_TOOLS_MODEL_FB}")
                model     = _TOOLS_MODEL_FB
                fell_back = True
                continue

            return None, f"Groq error {code}: {str(body)[:200]}"
        return None, f"All {len(_all_keys)} Groq keys are rate-limited. Try again in a moment!"

    # Track results of tools we ran so we can still confirm success even if the
    # follow-up summarization call fails (e.g. all Groq keys hit 429 mid-request).
    ran_tools = []  # list of (fn_name, result_dict)

    def _fallback_reply():
        """Human-friendly confirmation built from tool results when Groq can't
        summarize. Prefer a tool's own 'message', else acknowledge the action."""
        if ran_tools:
            msgs, errs = [], []
            for _fn, _res in ran_tools:
                if isinstance(_res, dict):
                    if _res.get("message"):
                        msgs.append(str(_res["message"]))
                    elif _res.get("error"):
                        errs.append(str(_res["error"]))
                    else:
                        msgs.append(f"Done: {_fn.replace('_', ' ')}.")
                else:
                    msgs.append(f"Done: {_fn.replace('_', ' ')}.")
            if msgs:
                return " ".join(msgs)
            if errs:
                return "I hit a problem running that: " + "; ".join(errs)
        return None

    for turn in range(3):
        use_tools = (turn < 2) and not (turn == 0 and _skip_tools_first_turn)
        resp, err = _groq_call(messages, use_tools)
        if err:
            fb = _fallback_reply()
            if fb:
                # Tools already succeeded — confirm the action instead of dumping the error.
                return jsonify({"reply": fb, "actions": actions}), 200
            return jsonify({"reply": f"Hmm, hit a snag — {err}", "actions": actions}), 200

        choice = resp["choices"][0]
        msg    = choice["message"]
        messages.append(msg)

        if choice.get("finish_reason") == "tool_calls" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                fn_name = tc["function"]["name"]
                try:
                    fn_args = json.loads(tc["function"]["arguments"])
                except Exception:
                    fn_args = {}
                result, action = _callie_exec_tool(fn_name, fn_args, user_msg=user_msg)
                ran_tools.append((fn_name, result))
                if action:
                    actions.extend(action if isinstance(action, list) else [action])
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                })
        else:
            reply = (msg.get("content") or "").strip()
            if not reply:
                # Model returned empty content — fall back to a tool-based confirmation.
                reply = _fallback_reply() or "Done! Anything else?"
            return jsonify({"reply": reply, "actions": actions}), 200

    # Loop exhausted (model kept calling tools). Confirm what actually ran.
    return jsonify({"reply": _fallback_reply() or "I ran into a loop — could you rephrase?",
                    "actions": actions}), 200


if __name__ == "__main__":
    init_db()
    start_scheduler_thread()
    print("Dashboard: http://127.0.0.1:5000")
    app.run(host="127.0.0.1", debug=False, port=5000)
