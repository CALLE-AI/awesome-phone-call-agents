"""Generate the HTML card scenes for the demo video (1920x1080)."""
import json, html, sys
from pathlib import Path

OUT = Path(__file__).parent / "scenes"
OUT.mkdir(exist_ok=True)

BASE_CSS = """
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
@import url('http://127.0.0.1:8811/fonts/fonts.css');
body{font-family:Inter,'DejaVu Sans',system-ui,sans-serif;color:#12213f;background:#f7f3ec}
.brand{position:absolute;top:44px;left:64px;font:700 36px Fraunces,serif;letter-spacing:.2px}.brand span{color:#b8862b}
.tag{position:absolute;top:52px;right:64px;font-size:22px;color:#6b7590}
h1,.h{font-family:Fraunces,serif}
.fade{animation:fade .8s ease-out both}@keyframes fade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
"""

def page(name, body, extra_css="", script=""):
    (OUT / f"{name}.html").write_text(f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}{extra_css}</style></head>
<body><div class="brand">Nota<span>.</span>Lawyer</div><div class="tag">CALL-E · Your Code Is Calling</div>{body}<script>{script}</script></body></html>""", encoding="utf-8")

# ---- s1 title
page("s1_title", """
<div class="fade" style="position:absolute;left:64px;top:300px;max-width:1500px">
  <div class="h" style="font-size:118px;font-weight:700;line-height:1.02;letter-spacing:-.01em">Tell us what you need.<br><span style="color:#8f6717">We'll call you back<br>in a minute.</span></div>
  <div style="font-size:32px;margin-top:54px;color:#6b7590">Nota.Lawyer intake by phone · real estate · wills · trusts · lawsuits · built on CALL-E</div>
</div>""")

# ---- s4 call playback (bubbles revealed on a schedule passed via ?s=)
page("s4_call", """
<div id="ring" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column">
  <div style="font-size:120px">📞</div>
  <div class="h" style="font-size:72px;font-weight:700;margin-top:24px">Calling +1 917 ··· 4219</div>
  <div id="dots" style="font-size:40px;color:#5b6478;margin-top:18px">CALL-E is dialing</div>
  <div style="position:absolute;bottom:70px;font-size:26px;color:#5b6478">Real call · recorded on the client's phone · abridged</div>
</div>
<div id="chat" style="position:absolute;left:260px;right:260px;top:150px;bottom:110px;display:none;flex-direction:column;justify-content:flex-end;gap:18px"></div>
<div id="foot" style="position:absolute;bottom:40px;left:0;right:0;text-align:center;font-size:24px;color:#5b6478;display:none">Real call (Sept 8, 2026) · both voices as recorded on the client's phone · abridged</div>
""", """
.b{max-width:1150px;padding:22px 32px;border-radius:26px;font-size:40px;line-height:1.3;animation:fade .35s ease-out both}
.bot{align-self:flex-start;background:#fffdf9;border:2px solid #e6dfd2}.user{align-self:flex-end;background:#0b7a75;color:#fff}
.who{font-size:22px;opacity:.7;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px}
""", """
const S=JSON.parse(decodeURIComponent(location.search.slice(3)));
let n=0;setInterval(()=>{document.getElementById('dots').textContent='CALL-E is dialing'+'.'.repeat(n++%4)},400);
setTimeout(()=>{document.getElementById('ring').style.display='none';const c=document.getElementById('chat');c.style.display='flex';document.getElementById('foot').style.display='block';
  for(const t of S.turns){setTimeout(()=>{const d=document.createElement('div');d.className='b '+(t.speaker==='bot'?'bot':'user');
    d.innerHTML='<div class="who">'+(t.speaker==='bot'?'Not a Lawyer intake assistant':'Client (Derek)')+'</div>'+t.html;c.appendChild(d);
    while(c.children.length>7)c.removeChild(c.firstChild);},(t.at-S.chat_at)*1000);}
},S.chat_at*1000);
""")

# ---- s8 limits (terminal)
page("s8_limits", """
<div class="fade" style="position:absolute;left:64px;top:150px;right:64px">
  <div class="h" style="font-size:64px;font-weight:700">One limit, stated plainly</div>
  <div style="font-size:30px;color:#5b6478;margin-top:10px">Spanish is not carried on US (+1) lines today — tested three ways, all declined before dialing</div>
  <pre style="margin-top:40px;background:#12213f;color:#dfe7ff;border-radius:18px;padding:36px 44px;font-size:27px;line-height:1.5;font-family:'DejaVu Sans Mono',monospace;white-space:pre-wrap">
<span style="color:#8fd3cf">$ POST /v1/calls  locale:"es"  region:"US"</span>
call_not_ready — "Spanish calling for US numbers isn't supported."

<span style="color:#8fd3cf">$ POST /v1/calls  locale:"en-US"  task written in Spanish</span>
call_not_ready — "…las llamadas en español para Estados Unidos no están disponibles."

<span style="color:#8fd3cf">$ calle call plan --language Spanish --region US</span>
ready_to_run: false — options: "English for US", "Bahasa for US"

<span style="color:#ffd27a">$ POST /v1/calls  locale:"id"  region:"US"   → ACCEPTED, call completed (Bahasa Indonesia)</span></pre>
  <div style="font-size:30px;margin-top:34px;color:#14213d">Spanish script: written and wired. When CALL-E enables it, the change is one row in <code>regions.json</code>. Until then, US Spanish speakers are routed to a human — and the form says so.</div>
</div>""")

# ---- s9 architecture
page("s9_arch", """
<div class="fade" style="position:absolute;left:64px;top:150px;right:64px">
  <div class="h" style="font-size:64px;font-weight:700">No servers</div>
  <div style="display:flex;align-items:center;gap:26px;margin-top:70px;font-size:30px">
    <div class="box">Client<br><small>form · EN · ES · ID<br>real estate · will · trust · lawsuit</small></div><div class="arr">→</div>
    <div class="box">Cloudflare Pages<br>+ Functions<br><small>/api/intake · /api/calle-webhook<br>/api/intakes · /api/remind</small></div><div class="arr">→</div>
    <div class="box hi">CALL-E<br><small>POST /v1/calls · per-type task<br>per-type result schema · webhook<br>Idempotency-Key · GET /v1/calls/{id}</small></div><div class="arr">→</div>
    <div class="box">📞 Client's phone<br><small>interview in their<br>number's language</small></div>
  </div>
  <div style="display:flex;align-items:center;gap:26px;margin-top:50px;font-size:30px;margin-left:520px">
    <div class="box">KV<br><small>intake records<br>transcripts · confidence</small></div><div class="arr">→</div>
    <div class="box">Attorney console<br><small>/review · conflict check<br>one-click reminder call</small></div>
  </div>
  <div style="font-size:34px;margin-top:80px;color:#5b6478">github.com/banksythequantLab/nota-intake &nbsp;·&nbsp; nota-intake.pages.dev</div>
</div>""", """
.box{background:#fffdf9;border:2px solid #e6dfd2;border-radius:20px;padding:26px 34px;text-align:center;font-weight:700;min-width:300px;line-height:1.25}
.box small{display:block;font-weight:400;color:#5b6478;font-size:23px;margin-top:10px}.box.hi{border-color:#b8862b;background:#fff8e8}
.arr{font-size:48px;color:#0b7a75}
""")
print("cards written to", OUT)
