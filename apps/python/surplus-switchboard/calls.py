"""CALL-E single-contact adapter with durable no-retry safety boundaries.
Only LiveTransport can place calls. CLI defaults to preview. Never auto-dispatches food.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib import request
from optimizer import Invalid, integer

SCHEMA={'type':'object','additionalProperties':False,
 'required':['willing','capacity_portions','evidence_quote'],
 'properties':{'willing':{'type':'string','enum':['yes','no','unknown']},
 'capacity_portions':{'type':'integer','description':'Exact affirmed capacity. Use 0 when willing is no or unknown; never guess a quantity.'},
 'evidence_quote':{'type':'string'}}}

RESULT_FORMAT='surplus-switchboard-call-e-result-v1'
TERMINAL_STATUSES=frozenset(('completed','failed','canceled'))


def monitoring_state(status):
    if status=='completed': return 'completed'
    if status in TERMINAL_STATUSES: return 'terminal_hold'
    return 'pending_resume_same_call'

def provider_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}',value):
        raise Invalid('Invalid provider call ID; reconcile manually')
    return value

def strict_json(raw):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result: raise Invalid('Duplicate JSON field')
            result[key]=value
        return result
    def constant(_): raise Invalid('Non-finite JSON number')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant)

def save_private_json(path,value):
    """Exclusive creation avoids overwriting the reviewed source or prior receipt."""
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as stream:
        json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n')

def build_request(context: dict, now: int) -> tuple[dict,str]:
    if not isinstance(context,dict): raise Invalid('Context must be an object')
    integer(now,'now',0,10**12)
    if context.get('consented') is not True:
        raise Invalid('Explicit recipient permission is required')
    if (not isinstance(context.get('consent_reference'),str) or not context['consent_reference'].strip()
        or len(context['consent_reference'])>500 or any(ord(c)<32 for c in context['consent_reference'])):
        raise Invalid('Record how permission was obtained')
    if not isinstance(context.get('region','US'),str) or not re.fullmatch(r'[A-Z]{2}',context.get('region','US')):
        raise Invalid('Invalid region')
    if not isinstance(context.get('locale','en-US'),str) or not re.fullmatch(r'[a-z]{2,3}-[A-Z]{2}',context.get('locale','en-US')):
        raise Invalid('Invalid locale')
    begin=integer(context.get('call_not_before'),'call_not_before',0,10**12)
    end=integer(context.get('call_before'),'call_before',0,10**12)
    if not begin <= now < end:
        raise Invalid('Outside the operator-approved calling window')
    phone=context.get('phone')
    if not isinstance(phone,str) or not re.fullmatch(r'\+[1-9][0-9]{7,14}',phone):
        raise Invalid('Provide an E.164 phone number')
    for key in ('partner_id','batch_id','category','operator_name'):
        if not isinstance(context.get(key),str) or not 1 <= len(context[key]) <= 100 or any(ord(c)<32 for c in context[key]):
            raise Invalid(f'Invalid {key}')
    quantity=integer(context.get('offered_portions'),'offered_portions',1,10000)
    task=(f'You are an AI assistant calling with prior permission on behalf of {context["operator_name"]}. '
          f'At the beginning disclose that you are an AI assistant. Ask whether this organization is '
          f'willing and able to receive up to {quantity} portions in category {context["category"]}. '
          'Ask for the exact maximum number they can accept. Explain that this is a capacity inquiry '
          'only: no donation, pickup, delivery, purchase, safety certification or reservation is being made. '
          'Do not make claims about ingredients, allergens, temperature, quality or suitability. '
          'Any food-safety, timing or logistical question goes to the human operator. '
          'Read back the number and request confirmation. If the person declines, asks you to stop, '
          'or says it is the wrong contact, politely stop; do not persuade or retry. '
          'For voicemail or uncertainty report willing=unknown and capacity_portions=0. '
          'For refusal report willing=no and capacity_portions=0. '
          'Only report willing=yes with an explicitly affirmed positive quantity within the offered amount. '
          'Return an exact recipient quote supporting willingness and capacity, or an empty evidence_quote '
          'when no such statement was made. Never use your own words as recipient evidence.')
    payload={'task':task,'recipients':[{'phones':[phone],'region':context.get('region','US'),
             'locale':context.get('locale','en-US')}],
             'result_schema':SCHEMA,'recipient_result_schema':SCHEMA,
             'metadata':{'workflow':'surplus-switchboard','partner_id':context['partner_id'],
                         'batch_id':context['batch_id']}}
    # Consent and exact calling window are included in approval binding, but not sent to provider.
    digest=hashlib.sha256(json.dumps({'payload':payload,'consent':context['consent_reference'],
                         'window':[begin,end]},sort_keys=True).encode()).hexdigest()
    return payload,digest

class LiveTransport:
    """No redirects, no retries, fixed provider origin; timeout may mean call exists."""
    def __init__(self, api_key: str):
        if not isinstance(api_key,str) or not api_key or any(ord(c)<33 or ord(c)>126 for c in api_key):
            raise Invalid('A valid CALLE_API_KEY is required')
        self.key=api_key
    def create(self,payload:dict,key:str)->dict:
        return self._request('/v1/calls','POST',payload,key)
    def read(self,call_id:str)->dict:
        return self._request('/v1/calls/'+provider_id(call_id),'GET')
    def _request(self,path,method,payload=None,key=None):
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs): return None
        headers={'Authorization':'Bearer '+self.key,'Accept':'application/json'}
        if payload is not None: headers['Content-Type']='application/json'
        if key is not None: headers['Idempotency-Key']=key
        req=request.Request('https://api.heycall-e.com'+path,
            data=None if payload is None else json.dumps(payload).encode(),method=method,headers=headers)
        with request.build_opener(NoRedirect).open(req,timeout=20) as response:
            raw=response.read(2_000_001)
        if len(raw)>2_000_000: raise Invalid('Provider response too large')
        result=strict_json(raw)
        if not isinstance(result,dict): raise Invalid('Unexpected provider response')
        return result

class Ledger:
    def __init__(self,path:str|Path):
        self.path=str(path)
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS calls (digest TEXT PRIMARY KEY, state TEXT NOT NULL, provider_id TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS requests (digest TEXT PRIMARY KEY, details TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS results (digest TEXT PRIMARY KEY, envelope TEXT NOT NULL)')
        try: os.chmod(self.path,0o600)
        except OSError: pass
    @contextmanager
    def connection(self):
        # sqlite's transaction context manager does not close the connection.
        db=sqlite3.connect(self.path,timeout=10)
        try:
            with db: yield db
        finally: db.close()
    def state(self,digest):
        with self.connection() as db:
            row=db.execute('SELECT state,provider_id FROM calls WHERE digest=?',(digest,)).fetchone()
        return None if not row else {'state':row[0],'provider_id':row[1]}
    def start(self,context:dict,approved_sha:str,now:int,transport)->dict:
        payload,digest=build_request(context,now)  # permission rechecked immediately before creation
        if approved_sha!=digest: raise Invalid('Approval does not match exact request')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT state,provider_id FROM calls WHERE digest=?',(digest,)).fetchone()
            if row: return {'state':row[0],'provider_id':row[1],'request_sha':digest,'created':False}
            history=db.execute('SELECT c.state,r.details FROM calls c LEFT JOIN requests r ON r.digest=c.digest').fetchall()
            for state,raw_details in history:
                if raw_details is None and state in ('submitting','unknown_reconcile_manually'):
                    raise Invalid('Unresolved historical creation; inspect dashboard before a new request')
                if raw_details:
                    prior=strict_json(raw_details)
                    if (prior['partner_id'],prior['batch_id'])==(context['partner_id'],context['batch_id']):
                        raise Invalid('This partner and batch already have an attempt. Resume or reconcile it; do not redial.')
            db.execute('INSERT INTO calls VALUES (?, ?, NULL)',(digest,'submitting'))
            details={key:context[key] for key in ('partner_id','batch_id','category','offered_portions')}
            details['requested_at']=now
            db.execute('INSERT INTO requests VALUES (?,?)',(digest,json.dumps(details,sort_keys=True)))
        # Durable state exists before side effects. A crash stays submitting and blocks replay.
        try:
            result=transport.create(payload,digest)
            if not isinstance(result,dict): raise Invalid('Unexpected provider response')
            cid=provider_id(result.get('call_id',result.get('id')))
            if 'call_id' in result and 'id' in result and result['call_id']!=result['id']:
                raise Invalid('Conflicting provider IDs')
        except Exception:
            with self.connection() as db:
                db.execute('UPDATE calls SET state=? WHERE digest=?',('unknown_reconcile_manually',digest))
            raise Invalid('Creation outcome unknown. Do NOT redial; inspect provider dashboard.') from None
        with self.connection() as db:
            db.execute('UPDATE calls SET state=?,provider_id=? WHERE digest=?',('submitted',cid,digest))
        return {'state':'submitted','provider_id':cid,'request_sha':digest,'created':True}

    def _cached_terminal(self,db,digest,raw):
        cached=strict_json(raw)
        if cached['result'].get('status') not in TERMINAL_STATUSES: return None
        monitoring=monitoring_state(cached['result']['status'])
        if cached.get('monitoring')!=monitoring:
            # Upgrade an older pending label without refetching or renewing its evidence.
            cached['monitoring']=monitoring
            db.execute('UPDATE results SET envelope=? WHERE digest=?',(json.dumps(cached,sort_keys=True),digest))
        return cached

    def read_result(self,digest,transport,*,max_reads=1,interval=5,clock=time.time,sleep=time.sleep):
        """Read an existing call only. A monitoring limit never redials or cancels.
        Cache all documented terminal outcomes; failed/canceled stay held.
        Unknown future statuses are held and never inferred to mean completion.
        """
        integer(max_reads,'max_reads',1,12);integer(interval,'interval',5,10)
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT state,provider_id FROM calls WHERE digest=?',(digest,)).fetchone()
            detail=db.execute('SELECT details FROM requests WHERE digest=?',(digest,)).fetchone()
            saved=db.execute('SELECT envelope FROM results WHERE digest=?',(digest,)).fetchone()
            if not row or row[0]!='submitted' or not detail:
                raise Invalid('No durably identified call with request context; inspect dashboard, do not redial')
            cid=provider_id(row[1]);details=strict_json(detail[0])
            if saved:
                cached=self._cached_terminal(db,digest,saved[0])
                if cached is not None: return cached
        for index in range(max_reads):
            if index: sleep(interval)
            try:
                result=normalize_provider_result(transport.read(cid),cid)
            except Exception:
                raise Invalid('Result read failed or schema mismatched. Resume this call ID; do not redial.') from None
            fetched_at=integer(int(clock()),'fetched_at',0,10**12)
            envelope={'format':RESULT_FORMAT,'source':'call-e-rest-get','request_sha':digest,
                      'provider_id':cid,'request':details,'fetched_at':fetched_at,'result':result,
                      'monitoring':monitoring_state(result['status'])}
            with self.connection() as db:
                db.execute('BEGIN IMMEDIATE')
                previous=db.execute('SELECT envelope FROM results WHERE digest=?',(digest,)).fetchone()
                if previous:
                    cached=self._cached_terminal(db,digest,previous[0])
                    if cached is not None: return cached
                db.execute('INSERT OR REPLACE INTO results VALUES (?,?)',(digest,json.dumps(envelope,sort_keys=True)))
            if result['status'] in TERMINAL_STATUSES: break
        return envelope

    def verify_envelope(self,envelope):
        """Bind import to the saved read and original ledger request, not an edited JSON file."""
        if not isinstance(envelope,dict):raise Invalid('Invalid result envelope')
        digest=envelope.get('request_sha')
        if not isinstance(digest,str):raise Invalid('Missing request approval reference')
        with self.connection() as db:
            row=db.execute('SELECT envelope FROM results WHERE digest=?',(digest,)).fetchone()
            detail=db.execute('SELECT details FROM requests WHERE digest=?',(digest,)).fetchone()
            call=db.execute('SELECT state,provider_id FROM calls WHERE digest=?',(digest,)).fetchone()
        if not row or not detail or not call or call[0]!='submitted':
            raise Invalid('Result has no matching durable create/read record')
        if (strict_json(row[0])!=envelope or strict_json(detail[0])!=envelope.get('request')
            or call[1]!=envelope.get('provider_id')):
            raise Invalid('Result differs from the durable provider read or original request')


def normalize_provider_result(result,expected_id):
    """Accept the documented REST object only; do not guess SDK/MCP wrappers."""
    provider_id(expected_id)
    if not isinstance(result,dict) or not isinstance(result.get('status'),str) or not result['status'].strip():
        raise Invalid('Expected a REST result object with status')
    for key in ('call_id','id'):
        if key in result and result[key]!=expected_id: raise Invalid('Result belongs to another call')
    if 'task_completed' in result and result['task_completed'] is not None and type(result['task_completed']) is not bool:
        raise Invalid('Invalid task_completed type')
    if result['status']=='completed' and ('task_completed' not in result or not isinstance(result.get('recipients'),list)):
        raise Invalid('Completed response is missing documented fields')
    return result

def interpret(result:dict,offered:int)->dict:
    """Conservative one-recipient result interpretation. Human must verify the actual statement.
    This checks syntax and a transcript substring, NOT semantic truth or caller identity.
    """
    integer(offered,'offered',1,10000)
    hold=lambda why:{'disposition':'hold','capacity':0,'reason':why,'requires_human_review':True}
    if not isinstance(result,dict) or result.get('status')!='completed' or result.get('task_completed') is not True:
        return hold('Provider task not successfully completed')
    recipients=result.get('recipients')
    if not isinstance(recipients,list) or len(recipients)!=1 or not isinstance(recipients[0],dict):
        return hold('Exactly one recipient result required')
    r=recipients[0]; value=r.get('structured_result')
    if not isinstance(value,dict) or set(value)!={'willing','capacity_portions','evidence_quote'}:
        return hold('Missing or unexpected structured fields')
    willing=value['willing']; cap=value['capacity_portions']; quote=value['evidence_quote']
    if willing not in ('yes','no','unknown'): return hold('Invalid willingness')
    if willing!='yes': return hold('No affirmative capacity confirmation')
    if type(cap) is not int or not 1<=cap<=offered: return hold('Capacity outside offered range')
    if not isinstance(quote,str) or not quote.strip(): return hold('No supporting quote')
    spoken=[]
    attempts=r.get('attempts',[])
    if not isinstance(attempts,list) or len(attempts)!=1:
        return hold('Exactly one attempt required; review multiple attempts manually')
    for attempt in attempts:
        if not isinstance(attempt,dict): return hold('Malformed attempt')
        turns=attempt.get('transcript_turns',[])
        if not isinstance(turns,list): return hold('Malformed transcript')
        for turn in turns:
            if not isinstance(turn,dict) or turn.get('speaker') not in ('bot','user','unknown') or not isinstance(turn.get('text'),str):
                return hold('Malformed transcript turn')
            # Documented unknown speakers stay in raw evidence, but cannot establish recipient capacity.
            if turn['speaker']=='user':
                spoken.append(turn['text'])
    if not any(quote in turn for turn in spoken): return hold('Quote not found in a recipient turn')
    return {'disposition':'candidate_confirmation','capacity':cap,'quote':quote,
            'requires_human_review':True,'warning':'Substring evidence is not semantic or identity verification.'}

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('context',nargs='?');ap.add_argument('--db',default='calls.sqlite3')
    ap.add_argument('--allow-live-call',action='store_true')
    ap.add_argument('--acknowledge-authorization',action='store_true')
    ap.add_argument('--approve-sha')
    ap.add_argument('--read-request-sha',help='Read an existing durably recorded call; never creates a call')
    ap.add_argument('--max-reads',type=int,default=1);ap.add_argument('--interval',type=int,default=5)
    ap.add_argument('--output',help='New private result file; existing paths are never overwritten')
    args=ap.parse_args()
    try:
        if args.read_request_sha:
            if args.allow_live_call or args.context or args.approve_sha or not args.output:
                raise Invalid('Read mode requires --output and no context or create approval flags')
            output=Ledger(args.db).read_result(args.read_request_sha,LiveTransport(os.environ.get('CALLE_API_KEY','')),
                                               max_reads=args.max_reads,interval=args.interval)
            save_private_json(args.output,output)
            print(json.dumps({'provider_id':output['provider_id'],'monitoring':output['monitoring'],
                              'result_saved':True,'note':'Inspect private evidence; no call was created.'},indent=2))
        else:
            if not args.context: raise Invalid('A private context file is required for preview or create')
            if args.allow_live_call and args.output:
                raise Invalid('--output is for previews and reads; creation receipts are durably recorded in --db')
            context=strict_json(Path(args.context).read_text());now=int(time.time())
            payload,digest=build_request(context,now)
        if not args.read_request_sha and not args.allow_live_call:
            if args.output:
                save_private_json(args.output,{'mode':'private_preview_no_call','approval_sha':digest,'payload':payload,
                    'consent_reference':context['consent_reference'],
                    'calling_window_utc_epoch':[context['call_not_before'],context['call_before']]})
            payload['recipients'][0]['phones']=['[REDACTED]']
            print(json.dumps({'mode':'preview_no_call','approval_sha':digest,'payload':payload,
                'calling_window_utc_epoch':[context['call_not_before'],context['call_before']],
                'note':'Inspect the full phone number and permission record in the private context or --output preview file.'},indent=2))
        elif args.allow_live_call:
            if not args.acknowledge_authorization or not args.approve_sha:
                raise Invalid('Live calls require authorization acknowledgment and exact preview SHA')
            print(json.dumps(Ledger(args.db).start(context,args.approve_sha,now,
                LiveTransport(os.environ.get('CALLE_API_KEY',''))),indent=2))
    except (Invalid,OSError,json.JSONDecodeError) as exc: ap.error(str(exc))
