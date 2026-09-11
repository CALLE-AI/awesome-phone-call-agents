import asyncio
import json
import os
import re
import uuid
from ipaddress import ip_address
from enum import Enum
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

CALLE_API_BASE = "https://api.heycall-e.com/v1"
TERMINAL = {"completed", "failed", "canceled"}
LIVE_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "live_hotline_unresolved.json"

app = FastAPI(
    title="CallProof",
    version="0.3.1",
    description="Phone-verified operational claims with bounded, authority-aware verdicts.",
)


class Verdict(str, Enum):
    VERIFIED = "VERIFIED"
    CONTRADICTED = "CONTRADICTED"
    UNRESOLVED = "UNRESOLVED"


class VerifyRequest(BaseModel):
    claim: str = Field(min_length=8, max_length=1000)
    phone: str = Field(min_length=7, max_length=32)
    contact_context: str = Field(default="Operational contact", max_length=300)
    region: str = Field(default="GB", min_length=2, max_length=2)
    locale: str = Field(default="en-GB", min_length=2, max_length=16)
    authorized: bool = False


def is_loopback(host: str | None) -> bool:
    if host == "localhost":
        return True
    try:
        return ip_address(host or "").is_loopback
    except ValueError:
        return False


@app.middleware("http")
async def local_live_only(request: Request, call_next):
    if request.url.path == "/verify" and (
        not request.client
        or not is_loopback(request.client.host)
        or not is_loopback(request.url.hostname)
    ):
        return JSONResponse(status_code=403, content={"detail": "Live verification is local-only; use the documented loopback server."})
    return await call_next(request)


def mask_phone_text(value: str) -> str:
    return re.sub(
        r"\+[1-9](?:[ ()-]*[0-9]){7,14}(?![0-9])",
        lambda match: "+***" + re.sub(r"[^0-9]", "", match.group())[-4:],
        value,
    )


def masked_result(value: Any) -> Any:
    if isinstance(value, str):
        return mask_phone_text(value)
    if isinstance(value, list):
        return [masked_result(item) for item in value]
    if isinstance(value, dict):
        return {key: masked_result(item) for key, item in value.items()}
    return value


class VerifyResponse(BaseModel):
    verification_id: str
    verdict: Verdict
    claim: str
    evidence: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    call_id: str | None = None
    summary: str | None = None
    raw_status: str | None = None
    authority_status: str = "unknown"
    evidence_quality: str = "insufficient"
    qualifier: str | None = None
    provenance: str | None = None


RECIPIENT_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "claim_status",
        "answer",
        "authority_status",
        "evidence_quality",
        "qualifier",
    ],
    "properties": {
        "claim_status": {
            "type": "string",
            "enum": ["confirmed", "contradicted", "unknown"],
            "description": (
                "Use confirmed only when the recipient clearly confirms the claim. "
                "Use contradicted only when the recipient clearly rejects or corrects it. "
                "Use unknown if the answer is ambiguous or cannot be established."
            ),
        },
        "answer": {
            "type": "string",
            "description": "Concise factual answer obtained from the recipient, without embellishment.",
        },
        "authority_status": {
            "type": "string",
            "enum": ["authoritative", "non_authoritative", "unknown"],
            "description": (
                "authoritative = the recipient is clearly competent to confirm this operational fact; "
                "non_authoritative = they explicitly lack that authority; "
                "unknown = authority was not established."
            ),
        },
        "evidence_quality": {
            "type": "string",
            "enum": ["direct", "qualified", "insufficient"],
            "description": (
                "direct = authoritative and unambiguous wording; "
                "qualified = answer contains material conditions or caveats; "
                "insufficient = no reliable answer was obtained."
            ),
        },
        "qualifier": {
            "type": "string",
            "description": (
                "Any material condition, permission, time window, dependency, named approver, "
                "or other caveat. Use an empty string if none was stated."
            ),
        },
    },
    "additionalProperties": False,
}


def task_for(req: VerifyRequest) -> str:
    return f"""
You are verifying one operational claim for a decision-support system.

Claim: {req.claim}
Contact context: {req.contact_context}

Call the recipient and identify yourself as an AI assistant making a verification call on behalf of an operator.
Ask only what is necessary to determine whether the claim is currently true.
Establish whether the person answering is actually authoritative for this operational fact.
Where an answer depends on a condition, permission, time window, named approver, or other qualifier, ask one concise follow-up to capture it.
Do not persuade, negotiate, make commitments, or infer beyond what the recipient says.
If the recipient is not authoritative, cannot confirm, or gives an ambiguous answer, return unknown rather than guessing.
Return the factual answer, authority status, evidence quality, and any material qualifier.
""".strip()


def map_verdict(structured: dict[str, Any] | None) -> Verdict:
    data = structured or {}
    status = data.get("claim_status")
    quality = data.get("evidence_quality")
    authority = data.get("authority_status")

    # Contact is not proof. An operational verdict requires established authority.
    if authority != "authoritative":
        return Verdict.UNRESOLVED
    if status == "confirmed" and quality == "direct":
        return Verdict.VERIFIED
    if status == "contradicted" and quality in {"direct", "qualified"}:
        return Verdict.CONTRADICTED
    return Verdict.UNRESOLVED


def confidence_for(call: dict[str, Any]) -> float:
    """Confidence in the evidence/result, not probability that the claim is true."""
    raw = call.get("completion_confidence") or {}
    score = raw.get("score") if isinstance(raw, dict) else None
    return max(0.0, min(1.0, float(score))) if isinstance(score, (int, float)) else 0.5


def first_recipient(call: dict[str, Any]) -> dict[str, Any]:
    recipients = call.get("recipients") or []
    return recipients[0] if recipients and isinstance(recipients[0], dict) else {}


async def create_call(req: VerifyRequest) -> dict[str, Any]:
    if not req.authorized:
        raise HTTPException(status_code=403, detail="Confirm authorization to contact this recipient for this live run.")
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", req.phone):
        raise HTTPException(status_code=422, detail="Supply a valid E.164 destination with a leading + and ASCII digits.")
    api_key = os.getenv("CALLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="CALLE_API_KEY is not configured")

    verification_id = str(uuid.uuid4())
    payload = {
        "task": task_for(req),
        "recipients": [
            {
                "phones": [req.phone],
                "region": req.region.upper(),
                "locale": req.locale,
            }
        ],
        "recipient_result_schema": RECIPIENT_RESULT_SCHEMA,
        "metadata": {"app": "callproof", "verification_id": verification_id},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": f"callproof-{verification_id}",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{CALLE_API_BASE}/calls", json=payload, headers=headers)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"CALL-E create returned HTTP {response.status_code}. Do not redial until the provider outcome is reconciled.")
        return response.json()


async def wait_for_terminal(call_id: str, *, max_wait_seconds: int = 240) -> dict[str, Any]:
    api_key = os.getenv("CALLE_API_KEY")
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = asyncio.get_running_loop().time() + max_wait_seconds

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            response = await client.get(f"{CALLE_API_BASE}/calls/{call_id}", headers=headers)
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"CALL-E status returned HTTP {response.status_code}. The call may still be running; reconcile before redialing.")
            call = response.json()
            if str(call.get("status", "")).lower() in TERMINAL:
                return call
            if asyncio.get_running_loop().time() >= deadline:
                raise HTTPException(status_code=504, detail="Verification call did not reach a terminal state in time")
            await asyncio.sleep(5)


@app.get("/", response_class=HTMLResponse)
async def home() -> str:
    live_available = "true" if os.getenv("CALLE_API_KEY") else "false"
    html = """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CallProof</title>
<style>
:root{--bg:#090c11;--panel:#121720;--panel2:#0d1219;--line:#263140;--text:#eef3f8;--muted:#94a3b8;--green:#5ee39a;--amber:#f7c873;--red:#ff8b8b;--blue:#83b8ff}
*{box-sizing:border-box}body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:radial-gradient(circle at 25% 0,#17202d 0,#090c11 38%);color:var(--text);margin:0}
.wrap{max-width:1080px;margin:0 auto;padding:30px 24px 56px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.brand{font-weight:850;letter-spacing:-.03em;font-size:22px}.tag{border:1px solid var(--line);color:var(--muted);padding:7px 10px;border-radius:999px;font-size:12px}
h1{font-size:clamp(38px,5.5vw,62px);line-height:1;letter-spacing:-.05em;margin:0;max-width:900px}.sub{max-width:790px;color:#b8c4d3;font-size:18px;line-height:1.45;margin:16px 0 24px}
.rail{display:grid;grid-template-columns:1fr 28px 1fr 28px 1fr;align-items:center;margin:20px 0 24px}.step{background:rgba(18,23,32,.8);border:1px solid var(--line);border-radius:15px;padding:13px 15px}
.step span,.eyebrow{display:block;color:var(--muted);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:5px}.arrow{text-align:center;color:#64748b}
.grid{display:grid;grid-template-columns:.92fr 1.08fr;gap:18px;align-items:stretch}.card{background:rgba(18,23,32,.92);border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.18)}
#result{min-height:548px}.card h2{margin:0 0 4px;font-size:18px}.hint{color:var(--muted);font-size:13px;margin:0 0 18px;line-height:1.4}
label{display:block;color:#9eacbd;font-size:12px;margin:14px 0 6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
input,textarea{width:100%;background:var(--panel2);color:var(--text);border:1px solid #354154;border-radius:10px;padding:12px;font:inherit;outline:none}
input:focus,textarea:focus{border-color:#6c87aa}.buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:17px}
button{border:1px solid #374559;background:#1a2330;color:var(--text);border-radius:10px;padding:11px 14px;font-weight:720;cursor:pointer}
button.primary{background:#eef3f8;color:#0b1016;border-color:#eef3f8}button:hover:not(:disabled){filter:brightness(1.08)}button:disabled{opacity:.48;cursor:not-allowed}
button.live{border-style:dashed}.empty{display:flex;min-height:495px;align-items:center;justify-content:center;text-align:center;color:var(--muted);padding:40px}
.verdict{font-size:44px;font-weight:900;letter-spacing:-.025em;margin:7px 0 10px}.VERIFIED{color:var(--green)}.CONTRADICTED{color:var(--red)}.UNRESOLVED{color:var(--amber)}
.claim{font-size:13px;color:#c5d0dc;border-left:2px solid #475569;padding-left:12px;margin:12px 0 18px}.summary{font-size:16px;line-height:1.55;max-width:52ch}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0}.chip{font-size:11px;border:1px solid #344156;background:#0d1219;padding:7px 9px;border-radius:999px;color:#c5d0dc}
.evidence{margin:18px 0 0;padding:0;list-style:none}.evidence li{border-top:1px solid #273241;padding:11px 0 0;margin-top:11px;line-height:1.45;font-size:14px}
.prov{font-size:11px;color:#8492a5;margin-top:18px;border-top:1px solid #273241;padding-top:12px;line-height:1.45}.prov b{color:#aab8c9;letter-spacing:.08em}.note{margin-top:18px;border:1px solid #3b4656;background:#0d1219;border-radius:12px;padding:12px;color:#aebacc;font-size:12px;line-height:1.5}
.footer{color:#65758a;font-size:12px;margin-top:22px}
@media(max-width:800px){.grid{grid-template-columns:1fr}.rail{grid-template-columns:1fr}.arrow{transform:rotate(90deg);padding:4px}.top{margin-bottom:22px}.wrap{padding-top:24px}#result{min-height:auto}.empty{min-height:260px}}
</style>
</head>
<body><div class="wrap">
<div class="top"><div class="brand">CallProof</div><div class="tag">CALL-E · bounded operational verification</div></div>
<h1>Don’t ask whether the call completed. Ask what the evidence warrants.</h1>
<div class="sub">CallProof turns a fragile real-world assumption into a phone-verified operational verdict: <strong>VERIFIED</strong>, <strong>CONTRADICTED</strong>, or <strong>UNRESOLVED</strong>.</div>

<div class="rail">
  <div class="step"><span>01 · Claim</span><b>State the operational assumption</b></div><div class="arrow">→</div>
  <div class="step"><span>02 · CALL-E</span><b>Ask the accountable real world</b></div><div class="arrow">→</div>
  <div class="step"><span>03 · Warrant</span><b>Return only what was established</b></div>
</div>

<div class="grid">
<div class="card">
<h2>Operational claim</h2><p class="hint">The claim should be specific enough that the answer changes what happens next.</p>
<label>Claim</label><textarea id="claim" rows="4">A 7.5-tonne production vehicle may enter the site at 05:30 tomorrow</textarea>
<label>Phone</label><input id="phone" placeholder="+44…">
<label>Contact context</label><input id="context" value="Site operations contact responsible for vehicle access">
<div class="row"><div><label>Region</label><input id="region" value="GB"></div><div><label>Locale</label><input id="locale" value="en-GB"></div></div>
<label><input id="authorized" type="checkbox" style="width:auto"> I am authorized to contact this recipient and intend one real call now.</label>
<div class="buttons">
<button class="primary" onclick="run('demo')">Production scenario</button>
<button onclick="run('fixture')">Recorded live proof</button>
<button class="live" id="liveButton" onclick="run('live')">Run live API verification</button>
</div>
<div class="note"><strong>Decision rule:</strong> a claim is never verified merely because a call connected. The answer must be direct and the recipient must be authoritative for that fact.</div>
</div>

<div class="card" id="result"><div class="empty"><div><b>No verdict yet.</b><br><br>Contact is an event.<br>Evidence is a warrant.</div></div></div>
</div>
<div class="footer">CallProof v0.3.1 · Result confidence measures confidence in the evidence/result, not probability that the claim itself is true.</div>
</div>

<script>
const LIVE_AVAILABLE=__LIVE_AVAILABLE__;
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const liveButton=document.getElementById('liveButton');
if(!LIVE_AVAILABLE){liveButton.disabled=true;liveButton.textContent='Live API unavailable locally';liveButton.title='Set CALLE_API_KEY to enable the Developer API path.';}
async function run(mode){
 const r=document.getElementById('result');
 if(mode==='live'&&!document.getElementById('authorized').checked){r.textContent='Confirm recipient authorization before a live call.';return;}
 r.innerHTML='<div class="empty"><div><b>Resolving evidence…</b><br><br>CALL-E is testing the claim against the real world.</div></div>';
 const url=mode==='demo'?'/verify/demo':mode==='fixture'?'/verify/live-fixture':'/verify';
 const opts={method:'POST',headers:{'Content-Type':'application/json'}};
 if(mode==='live'){opts.body=JSON.stringify({claim:claim.value,phone:phone.value,contact_context:context.value,region:region.value,locale:locale.value,authorized:true});document.getElementById('authorized').checked=false;liveButton.disabled=true;}
 try{
   const res=await fetch(url,opts);const d=await res.json();if(!res.ok)throw new Error(d.detail||'Verification failed');
   const evidence=(d.evidence||[]).map(x=>`<li>${esc(x)}</li>`).join('');
   const q=d.qualifier?`<div class="note"><strong>Material qualifier:</strong> ${esc(d.qualifier)}</div>`:'';
   r.innerHTML=`<div class="eyebrow">03 · Warrant</div><div class="verdict ${esc(d.verdict)}">${esc(d.verdict)}</div>
     <div class="claim">${esc(d.claim)}</div>
     <div class="summary">${esc(d.summary||'')}</div>
     <div class="chips">
       <span class="chip">Result confidence ${Math.round((d.confidence||0)*100)}%</span>
       <span class="chip">Authority ${esc(d.authority_status)}</span>
       <span class="chip">Evidence ${esc(d.evidence_quality)}</span>
     </div>${q}
     <ul class="evidence">${evidence}</ul>
     <div class="prov"><b>PROVENANCE</b><br>${esc(d.provenance||'CALL-E')}<br>Trace ${esc(d.call_id||d.verification_id||'unavailable')}</div>`;
 }catch(e){
   r.innerHTML=`<div class="eyebrow">03 · Warrant</div><div class="verdict UNRESOLVED">UNRESOLVED</div><div class="summary">${esc(e.message)}</div>
   <div class="note">Infrastructure failure is never upgraded into a claim verdict.</div>`;
 }finally{if(mode==='live')liveButton.disabled=!LIVE_AVAILABLE;}
}
</script>
</body></html>
"""
    return html.replace("__LIVE_AVAILABLE__", live_available)


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "app": "callproof",
        "version": "0.3.1",
        "developer_api_configured": bool(os.getenv("CALLE_API_KEY")),
    }


@app.post("/verify", response_model=VerifyResponse)
async def verify(req: VerifyRequest) -> VerifyResponse:
    created = await create_call(req)
    call = masked_result(await wait_for_terminal(created["id"]))
    recipient = first_recipient(call)
    structured = recipient.get("structured_result") or call.get("structured_result") or {}
    verdict = map_verdict(structured)

    evidence = list(call.get("evidence") or [])
    answer = structured.get("answer")
    if answer and answer not in evidence:
        evidence.insert(0, answer)

    verification_id = (call.get("metadata") or {}).get("verification_id") or str(uuid.uuid4())
    return VerifyResponse(
        verification_id=verification_id,
        verdict=verdict,
        claim=mask_phone_text(req.claim),
        evidence=evidence,
        confidence=confidence_for(call),
        call_id=call.get("id") or call.get("call_id"),
        summary=recipient.get("summary") or call.get("summary"),
        raw_status=call.get("status"),
        authority_status=structured.get("authority_status", "unknown"),
        evidence_quality=structured.get("evidence_quality", "insufficient"),
        qualifier=structured.get("qualifier") or None,
        provenance="Live CALL-E Developer API result",
    )


@app.post("/verify/demo", response_model=VerifyResponse)
async def verify_demo() -> VerifyResponse:
    return VerifyResponse(
        verification_id="demo_7p5t_0530",
        verdict=Verdict.CONTRADICTED,
        claim="A 7.5-tonne production vehicle may enter the site at 05:30 tomorrow",
        evidence=[
            "Site operations stated that normal vehicle access begins at 06:00.",
            "The 05:30 arrival is not authorized under the current plan.",
        ],
        confidence=0.94,
        call_id="scenario_demo",
        summary="The 05:30 access assumption is contradicted by the accountable site contact.",
        raw_status="completed",
        authority_status="authoritative",
        evidence_quality="direct",
        qualifier="Earlier access requires written approval from the duty manager.",
        provenance="Deterministic production-access scenario",
    )


@app.post("/verify/live-fixture", response_model=VerifyResponse)
async def verify_live_fixture() -> VerifyResponse:
    if not LIVE_FIXTURE_PATH.exists():
        raise HTTPException(status_code=404, detail="Live CALL-E evidence fixture is missing")
    fixture = json.loads(LIVE_FIXTURE_PATH.read_text(encoding="utf-8"))
    return VerifyResponse(
        verification_id=fixture["run_id"],
        verdict=Verdict(fixture["verdict"]),
        claim=fixture["claim"],
        evidence=fixture["evidence"],
        confidence=float(fixture["completion_confidence"]["score"]),
        call_id=fixture["call_id"],
        summary=fixture["summary"],
        raw_status=fixture["status"].lower(),
        authority_status=fixture.get("authority_status", "unknown"),
        evidence_quality=fixture.get("evidence_quality", "insufficient"),
        qualifier=fixture.get("qualifier") or None,
        provenance=fixture.get("source", "CALL-E live run fixture"),
    )
