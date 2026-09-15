import os, requests, uuid
from .dry_run import simulate
from .db import now

BASE=os.getenv('CALLE_BASE_URL','https://api.heycall-e.com').rstrip('/')
API_KEY=os.getenv('CALLE_API_KEY','')
DRY_RUN=(not API_KEY) or os.getenv('CALLE_DRY_RUN','true').lower()=='true'

def create_call(task, entity, result_schema, metadata):
    if DRY_RUN:
        return {'id':'dryrun_'+uuid.uuid4().hex,'status':'completed','metadata':metadata,'dry_run':True,'simulated':True}
    payload={'task':task,'recipients':[{'phones':[entity['phone']],'region':'US','locale':'en-US'}], 'result_schema':result_schema,'metadata':metadata}
    r=requests.post(f'{BASE}/v1/calls',headers={'Authorization':f'Bearer {API_KEY}','Content-Type':'application/json','Idempotency-Key':uuid.uuid4().hex},json=payload,timeout=30)
    r.raise_for_status(); return r.json() | {'dry_run':False}

def get_call(call_id):
    if call_id.startswith('dryrun_'): return None
    r=requests.get(f'{BASE}/v1/calls/{call_id}',headers={'Authorization':f'Bearer {API_KEY}'},timeout=30); r.raise_for_status(); return r.json()
