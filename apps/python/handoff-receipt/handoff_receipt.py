#!/usr/bin/env python3
"""Handoff Receipt — bounded CALL-E verification of an inter-organization handoff."""
from __future__ import annotations
import argparse, hashlib, json, os, re, time
from pathlib import Path
from urllib import request as urlrequest

API="https://api.heycall-e.com"
E164=re.compile(r"^\+[1-9][0-9]{6,14}$",re.ASCII)
PHONE_LIKE=re.compile(r"(?<![0-9])\+?[0-9][0-9 ()-]{5,}[0-9](?![0-9])",re.ASCII)
TERMINAL={"completed","failed","canceled"}

SENDER_SCHEMA={"type":"object","additionalProperties":False,"required":["reached","handoff_claimed","receiver_name","case_reference","next_owner_claim","handoff_quote","ownership_quote"],"properties":{"reached":{"type":"string","enum":["yes","no","unknown"]},"handoff_claimed":{"type":"string","enum":["yes","no","unknown"]},"receiver_name":{"type":"string"},"case_reference":{"type":"string"},"next_owner_claim":{"type":"string","enum":["sender","receiver","third_party","unknown"]},"handoff_quote":{"type":"string"},"ownership_quote":{"type":"string"}}}
RECEIVER_SCHEMA={"type":"object","additionalProperties":False,"required":["reached","case_recognized","case_reference","ownership_status","recognition_quote","ownership_quote"],"properties":{"reached":{"type":"string","enum":["yes","no","unknown"]},"case_recognized":{"type":"string","enum":["yes","no","unknown"]},"case_reference":{"type":"string"},"ownership_status":{"type":"string","enum":["owns_next_action","not_owner","unknown"]},"recognition_quote":{"type":"string"},"ownership_quote":{"type":"string"}}}

def load(p): return json.loads(Path(p).read_text(encoding="utf-8"))
def dump(o): return json.dumps(o,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def digest(o): return hashlib.sha256(dump(o).encode()).hexdigest()
def mask(p): return p[:2]+"*"*max(3,len(p)-6)+p[-4:]
def redact(v): return PHONE_LIKE.sub("[REDACTED_PHONE]",str(v or ""))
def safe_ref(v): return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/#-]{2,79}",str(v or "").strip()))
def quote_ok(q, turns):
    q=" ".join(str(q or "").split()).casefold()
    if not q: return False
    return any(t.get("role")=="recipient" and q in " ".join(str(t.get("content","")).split()).casefold() for t in turns)

def validate(r):
    if set(r)!={"handoff_id","subject","sender","receiver","max_calls"} or r["max_calls"]!=2: raise ValueError("invalid request envelope")
    if r["sender"]["phone"]==r["receiver"]["phone"]: raise ValueError("sender and receiver must differ")
    for role in ("sender","receiver"):
        p=r[role]
        if not E164.fullmatch(p["phone"]): raise ValueError(f"invalid {role} phone")
        if not isinstance(p.get("authorized"),bool): raise ValueError(f"invalid {role} authorization")
        if p["authorized"] and len(str(p.get("authorization_basis","")).strip())<5: raise ValueError(f"missing {role} authorization basis")
    return r

def sender_task(r):
    return f"You are an AI assistant verifying one administrative handoff. Disclose that you are an AI. Call {r['sender']['name']} and ask only whether it has ALREADY COMPLETED the handoff of '{r['subject']}' to {r['receiver']['name']}. If yes, ask for the exact case/reference and who owns the immediate next action RIGHT NOW. Capture exact recipient quotes. Do not negotiate, decide fault, change the case, disclose secrets, or make commitments. Unknown is valid."

def receiver_task(r,s):
    return f"You are an AI assistant verifying the receiving side of one administrative handoff. Disclose that you are an AI. Call {r['receiver']['name']}. Ask whether it CURRENTLY recognizes reference '{s['case_reference']}' for '{r['subject']}' and whether it owns the immediate next action RIGHT NOW. Capture exact recipient quotes. Do not negotiate, decide fault, change the case, disclose secrets, or make commitments. Unknown is valid."

def normalize(payload, schema, role):
    if str(payload.get("status","")).lower()!="completed" or payload.get("task_completed") is not True: return None
    recs=payload.get("recipients") or []
    if len(recs)!=1 or not isinstance(recs[0],dict): return None
    rec=recs[0]; sr=rec.get("structured_result"); turns=rec.get("transcript") or []
    if not isinstance(sr,dict) or set(sr)!=set(schema["required"]) or not isinstance(turns,list): return None
    for k,spec in schema["properties"].items():
        if not isinstance(sr.get(k),str) or ("enum" in spec and sr[k] not in spec["enum"]): return None
    q1="handoff_quote" if role=="sender" else "recognition_quote"
    if not quote_ok(sr[q1],turns): return None
    if sr.get("ownership_quote") and not quote_ok(sr["ownership_quote"],turns): return None
    return sr

def outcome(verdict,reason): return {"verdict":verdict,"reason":reason,"advisory":True}
def reconcile(s,r):
    if not s: return outcome("UNKNOWN","sender_evidence_unusable")
    if s["reached"]!="yes": return outcome("UNKNOWN","sender_not_reached")
    if s["handoff_claimed"]=="no": return outcome("SENDER_DENIES_HANDOFF","sender_explicitly_denies_transfer")
    if s["handoff_claimed"]!="yes" or not safe_ref(s["case_reference"]): return outcome("UNKNOWN","sender_handoff_unproven")
    if not r: return outcome("UNKNOWN","receiver_evidence_unusable")
    if r["reached"]!="yes": return outcome("UNKNOWN","receiver_not_reached")
    if s["case_reference"].casefold()!=r["case_reference"].casefold(): return outcome("REFERENCE_MISMATCH","references_differ")
    if r["case_recognized"]=="no": return outcome("HANDOFF_NOT_ACKNOWLEDGED","receiver_does_not_recognize_reference")
    if r["case_recognized"]!="yes": return outcome("UNKNOWN","receiver_recognition_unknown")
    if s["next_owner_claim"]=="receiver" and r["ownership_status"]=="owns_next_action": return outcome("ACKNOWLEDGED_MATCH","same_reference_and_receiver_ownership_align")
    if s["next_owner_claim"]=="receiver" and r["ownership_status"]=="not_owner": return outcome("OWNERSHIP_CONTRADICTION","ownership_claims_conflict")
    return outcome("HANDOFF_ACKNOWLEDGED_OWNERSHIP_UNRESOLVED","reference_acknowledged_owner_unresolved")

def sender_allows_receiver(s):
    return bool(s and s.get("reached")=="yes" and s.get("handoff_claimed")=="yes" and safe_ref(s.get("case_reference")))

def idem(r,role,task):
    p=r[role]
    return "handoff-receipt:"+digest({"handoff_id":r["handoff_id"],"role":role,"phone":p["phone"],"region":p["region"],"locale":p["locale"],"authorization_basis":p["authorization_basis"],"task":task})[:40]

class RejectRedirects(urlrequest.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise RuntimeError("authenticated redirect rejected")

OPENER=urlrequest.build_opener(RejectRedirects)
def open_api(req,timeout=30): return OPENER.open(req,timeout=timeout)

def call(r,role,task,schema,state_path):
    p=r[role]
    if not p["authorized"]: raise RuntimeError(f"{role} not authorized")
    key=os.environ.get("CALLE_API_KEY")
    if not key: raise RuntimeError("CALLE_API_KEY required")
    body={"task":task,"recipients":[{"phones":[p["phone"]],"region":p["region"],"locale":p["locale"]}],"recipient_result_schema":schema,"metadata":{"workflow":"handoff-receipt","handoff_id":r["handoff_id"],"phase":role}}
    ik=idem(r,role,task); dg=digest(body); sp=Path(state_path); st=load(sp) if sp.exists() else {}; op=st.get(role)
    if op:
        if op.get("digest")!=dg or op.get("idempotency_key")!=ik: raise RuntimeError("saved operation binding mismatch")
        cid=op.get("call_id")
        if not cid: raise RuntimeError("creation unresolved; reconcile existing operation, do not redial")
    else:
        st[role]={"digest":dg,"idempotency_key":ik,"call_id":None,"status":"create_pending"}; sp.write_text(json.dumps(st,indent=2),encoding="utf-8")
        req=urlrequest.Request(API+"/v1/calls",data=json.dumps(body).encode(),method="POST",headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":ik})
        try:
            with open_api(req,timeout=30) as resp: created=json.loads(resp.read())
        except Exception as e:
            st[role]["status"]="creation_unresolved"; st[role]["error"]=redact(e); sp.write_text(json.dumps(st,indent=2),encoding="utf-8"); raise RuntimeError(redact(e)) from None
        cid=created.get("id") or created.get("call_id")
        if not cid: raise RuntimeError("create returned no call id")
        st[role].update({"call_id":cid,"status":"created"}); sp.write_text(json.dumps(st,indent=2),encoding="utf-8")
    end=time.time()+300
    while time.time()<end:
        req=urlrequest.Request(API+"/v1/calls/"+cid,headers={"Authorization":"Bearer "+key})
        try:
            with open_api(req,timeout=30) as resp: payload=json.loads(resp.read())
        except Exception as e: raise RuntimeError(redact(e)) from None
        status=str(payload.get("status","unknown")).lower(); st[role]["status"]=status; sp.write_text(json.dumps(st,indent=2),encoding="utf-8")
        if status in TERMINAL: return payload
        time.sleep(5)
    raise RuntimeError("poll timeout; reconcile saved call id, do not redial; stopping locally does not prove remote cancellation")

def view(r): return {"handoff_id":redact(r["handoff_id"]),"subject":redact(r["subject"]),"sender":{"name":redact(r["sender"]["name"]),"phone":mask(r["sender"]["phone"])},"receiver":{"name":redact(r["receiver"]["name"]),"phone":mask(r["receiver"]["phone"])}}

def main(argv=None):
    ap=argparse.ArgumentParser(); ap.add_argument("--request",required=True); ap.add_argument("--fixture"); ap.add_argument("--live",action="store_true"); ap.add_argument("--confirm",default=""); ap.add_argument("--state",default="handoff-receipt-state.json"); a=ap.parse_args(argv)
    r=validate(load(a.request))
    if a.fixture:
        s=normalize(load(Path(a.fixture)/"sender.json"),SENDER_SCHEMA,"sender"); rr=normalize(load(Path(a.fixture)/"receiver.json"),RECEIVER_SCHEMA,"receiver")
        print(json.dumps({**view(r),"result":reconcile(s,rr),"simulated":True},indent=2)); return
    if not a.live:
        print(json.dumps({**view(r),"mode":"PREVIEW_NO_CALL","sender_task":redact(sender_task(r)),"side_effects":False},indent=2)); return
    if a.confirm!="I_AUTHORIZE_UP_TO_TWO_CALLS": raise SystemExit("live mode requires explicit confirmation")
    sp=call(r,"sender",sender_task(r),SENDER_SCHEMA,a.state); s=normalize(sp,SENDER_SCHEMA,"sender")
    first=reconcile(s,None)
    if not sender_allows_receiver(s):
        print(json.dumps({**view(r),"result":first,"simulated":False},indent=2)); return
    rp=call(r,"receiver",receiver_task(r,s),RECEIVER_SCHEMA,a.state); rr=normalize(rp,RECEIVER_SCHEMA,"receiver")
    print(json.dumps({**view(r),"result":reconcile(s,rr),"simulated":False},indent=2))
if __name__=="__main__": main()
